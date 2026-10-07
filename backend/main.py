import re
import json
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from contextlib import asynccontextmanager


from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select, delete
from pydantic import BaseModel

from database import engine, create_db_and_tables, get_session
from models import Conversation, Message, CalendarBooking, Service, StaffMember, now_utc
from ai_pipeline.rag import init_rag_store, add_knowledge_doc, list_all_knowledge_docs, delete_knowledge_doc
from ai_pipeline.tools import (
    check_calendar_availability,
    book_calendar_appointment,
    check_business_hours,
    set_booking_status,
    staff_service_ids,
    staff_working_days,
)
from ai_pipeline.agent import run_agent_pipeline
from ai_pipeline.suggestions import get_chat_intro
from ai_pipeline.settings import (
    get_public_ai_settings,
    get_raw_ai_settings,
    update_ai_settings,
    get_schedule_settings,
    update_schedule_settings,
    test_gemini_connection
)

# Connection Manager for real-time WebSocket communication
class ConnectionManager:
    def __init__(self):
        # Maps conversation_id -> WebSocket for visitors
        self.visitor_connections: Dict[str, WebSocket] = {}
        # List of WebSockets for human agent dashboards
        self.agent_connections: List[WebSocket] = []

    async def connect_visitor(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.visitor_connections[session_id] = websocket

    def disconnect_visitor(self, session_id: str):
        if session_id in self.visitor_connections:
            del self.visitor_connections[session_id]

    async def connect_agent(self, websocket: WebSocket):
        await websocket.accept()
        self.agent_connections.append(websocket)

    def disconnect_agent(self, websocket: WebSocket):
        if websocket in self.agent_connections:
            self.agent_connections.remove(websocket)

    async def send_to_visitor(self, session_id: str, payload: dict):
        if session_id in self.visitor_connections:
            try:
                await self.visitor_connections[session_id].send_text(json.dumps(payload))
            except Exception as e:
                print(f"[WebSocket] Error sending to visitor {session_id}: {e}")

    async def broadcast_to_agents(self, payload: dict):
        for connection in list(self.agent_connections):
            try:
                await connection.send_text(json.dumps(payload))
            except Exception as e:
                print(f"[WebSocket] Error broadcasting to agent: {e}")
                if connection in self.agent_connections:
                    self.agent_connections.remove(connection)

manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure SQLite tables and ChromaDB initial data are ready
    print("[Startup] Initializing SQLite database and tables...")
    create_db_and_tables()
    print("[Startup] Initializing ChromaDB vector store...")
    init_rag_store()
    yield
    print("[Shutdown] Cleaning up...")

app = FastAPI(title="Resolve AI - Capstone Support & RAG System", lifespan=lifespan)

# Allow CORS for Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite can hand back naive datetimes; treat them as UTC so comparisons never raise."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt

def iso_or_none(dt: Optional[datetime]) -> Optional[str]:
    return as_utc(dt).isoformat() if dt else None

def get_pause_minutes() -> int:
    return int(get_raw_ai_settings().get("bot_pause_duration_minutes", 30))

# Keep references to fire-and-forget tasks so they aren't garbage-collected mid-run
_background_tasks: set = set()

def spawn(coro):
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task

async def notify_status(conversation_id: str, status: str, bot_paused_until: Optional[datetime] = None):
    """Push a conversation state change to the visitor widget and every agent console."""
    await manager.send_to_visitor(conversation_id, {"type": "status", "status": status})
    await manager.broadcast_to_agents({
        "type": "conversation_updated",
        "conversation_id": conversation_id,
        "status": status,
        "bot_paused_until": iso_or_none(bot_paused_until)
    })

async def ingest_visitor_message(session_id: str, user_text: str, visitor_name: str, visitor_email: Optional[str]) -> dict:
    """Stores a visitor message, acknowledges it, and broadcasts it to agent consoles."""
    with Session(engine) as session:
        conv = session.exec(select(Conversation).where(Conversation.id == session_id)).first()
        if not conv:
            conv = Conversation(id=session_id, visitor_name=visitor_name, visitor_email=visitor_email, status="ai_active")
        conv.visitor_name = visitor_name
        if visitor_email:
            conv.visitor_email = visitor_email
        # A new message on a resolved conversation reopens it for the AI
        if conv.status == "resolved":
            conv.status = "ai_active"
            conv.bot_paused_until = None
        conv.updated_at = now_utc()
        session.add(conv)

        v_msg = Message(conversation_id=session_id, sender="visitor", content=user_text)
        session.add(v_msg)
        session.commit()
        session.refresh(v_msg)
        conv_status = conv.status
        current_email = conv.visitor_email
        v_msg_id = v_msg.id
        v_msg_created_at_str = iso_or_none(v_msg.created_at)

    await manager.send_to_visitor(session_id, {
        "type": "message_ack",
        "id": v_msg_id,
        "created_at": v_msg_created_at_str
    })
    await manager.broadcast_to_agents({
        "type": "new_message",
        "conversation_id": session_id,
        "sender": "visitor",
        "content": user_text,
        "visitor_name": visitor_name,
        "visitor_email": current_email,
        "created_at": v_msg_created_at_str,
        "status": conv_status
    })
    return {"id": v_msg_id, "created_at": v_msg_created_at_str}

# Background task to execute AI pipeline
async def handle_ai_message_task(conversation_id: str, visitor_name: str, user_text: str):
    # Check conversation state and Bot Pause Window (Elqen style)
    resumed = False
    suppressed = False
    with Session(engine) as session:
        conv = session.exec(select(Conversation).where(Conversation.id == conversation_id)).first()
        status = conv.status if conv else "ai_active"
        paused_until = as_utc(conv.bot_paused_until) if conv else None
        if paused_until and paused_until > now_utc():
            print(f"[Automation Engine] Bot paused until {paused_until} for {conversation_id}. Suppressing AI response.")
            suppressed = True
        elif paused_until and conv.status == "human_handover":
            # Pause window has expired: hand the conversation back to the AI
            conv.status = "ai_active"
            conv.bot_paused_until = None
            conv.updated_at = now_utc()
            session.add(conv)
            session.commit()
            status = "ai_active"
            resumed = True

    if resumed:
        await notify_status(conversation_id, "ai_active")

    if suppressed or status == "human_handover":
        # Let the visitor widget know a human owns this chat (clears the typing indicator)
        await manager.send_to_visitor(conversation_id, {"type": "status", "status": "human_handover"})
        return

    # Run AI pipeline (RAG -> Tool -> Gemini/Fallback)
    result = await run_agent_pipeline(conversation_id, visitor_name, user_text, status)
    if not result:
        return

    reply_content = result.get("reply", "")
    metadata = {
        "sources": result.get("sources", []),
        "tool_called": result.get("tool_called"),
        "tool_result": result.get("tool_result"),
        "handoff_triggered": result.get("handoff_triggered", False),
        "mode": result.get("mode")
    }

    # Save AI message to database
    with Session(engine) as session:
        ai_msg = Message(
            conversation_id=conversation_id,
            sender="ai",
            content=reply_content,
            metadata_json=json.dumps(metadata)
        )
        session.add(ai_msg)
        
        # If handoff was triggered, update conversation record
        conv = session.exec(select(Conversation).where(Conversation.id == conversation_id)).first()
        if conv:
            if result.get("handoff_triggered"):
                conv.status = "human_handover"
            conv.updated_at = now_utc()
            session.add(conv)
        session.commit()
        session.refresh(ai_msg)
        ai_created_at_str = iso_or_none(ai_msg.created_at)
        final_status = "human_handover" if result.get("handoff_triggered") else status

    # Dispatch to visitor WebSocket
    await manager.send_to_visitor(conversation_id, {
        "type": "message",
        "sender": "ai",
        "content": reply_content,
        "created_at": ai_created_at_str,
        "metadata": metadata
    })

    # Broadcast to agent dashboards
    await manager.broadcast_to_agents({
        "type": "new_message",
        "conversation_id": conversation_id,
        "sender": "ai",
        "content": reply_content,
        "created_at": ai_created_at_str,
        "metadata": metadata,
        "status": final_status
    })


# --- WEBSOCKET ENDPOINTS ---

@app.websocket("/ws/chat/{session_id}")
async def visitor_chat_websocket(websocket: WebSocket, session_id: str):
    await manager.connect_visitor(websocket, session_id)
    
    # Ensure conversation exists in DB
    with Session(engine) as session:
        conv = session.exec(select(Conversation).where(Conversation.id == session_id)).first()
        if not conv:
            conv = Conversation(id=session_id, visitor_name=f"Visitor #{session_id[:6]}", status="ai_active")
            session.add(conv)
            session.commit()

    try:
        while True:
            raw_data = await websocket.receive_text()
            data = json.loads(raw_data)
            user_text = data.get("text", "").strip()
            if not user_text:
                continue

            visitor_name = data.get("visitor_name") or f"Visitor #{session_id[:6]}"
            visitor_email = data.get("visitor_email")

            await ingest_visitor_message(session_id, user_text, visitor_name, visitor_email)

            # Trigger AI processing asynchronously in background
            spawn(handle_ai_message_task(session_id, visitor_name, user_text))

    except WebSocketDisconnect:
        # Only drop the mapping if it still points at this socket (a reconnect may have replaced it)
        if manager.visitor_connections.get(session_id) is websocket:
            manager.disconnect_visitor(session_id)
        print(f"[WebSocket] Visitor {session_id} disconnected.")

@app.websocket("/ws/agent")
async def agent_dashboard_websocket(websocket: WebSocket):
    await manager.connect_agent(websocket)
    try:
        while True:
            # Keep alive and allow receiving agent commands if needed
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_agent(websocket)
        print("[WebSocket] Agent dashboard disconnected.")


# --- REST API ENDPOINTS ---

class AgentReplyRequest(BaseModel):
    content: str

class StatusUpdateRequest(BaseModel):
    status: str  # "ai_active", "human_handover", "resolved"

class KnowledgeDocRequest(BaseModel):
    title: str
    content: str
    category: str = "General"

class BookingRequest(BaseModel):
    conversation_id: str
    visitor_name: str
    date_str: str
    time_str: str
    service_type: Optional[str] = None
    staff_name: Optional[str] = None
    contact_info: Optional[str] = None

class BookingStatusRequest(BaseModel):
    status: str  # "confirmed", "completed", "no_show", "cancelled"

class ServiceRequest(BaseModel):
    name: str
    duration_minutes: int = 30
    price: Optional[float] = None
    is_active: bool = True

class StaffRequest(BaseModel):
    name: str
    role: Optional[str] = None
    service_ids: List[int] = []
    working_days: List[int] = [0, 1, 2, 3, 4]
    is_active: bool = True

class ScheduleSettingsRequest(BaseModel):
    open_time: Optional[str] = None
    close_time: Optional[str] = None
    working_days: Optional[List[int]] = None
    slot_step_minutes: Optional[int] = None
    min_notice_minutes: Optional[int] = None
    max_days_ahead: Optional[int] = None
    default_duration_minutes: Optional[int] = None

class PublicChatMessageRequest(BaseModel):
    session_id: str
    text: str
    visitor_name: Optional[str] = "Website Visitor"
    visitor_email: Optional[str] = None

class VisitorDetailsRequest(BaseModel):
    visitor_name: str
    visitor_email: Optional[str] = None

class AiSettingsUpdateRequest(BaseModel):
    business_name: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    temperature: Optional[float] = None
    max_output_tokens: Optional[int] = None
    system_instruction: Optional[str] = None
    bot_pause_duration_minutes: Optional[int] = None
    handoff_keywords: Optional[List[str]] = None
    rag_top_k: Optional[int] = None
    strict_grounding: Optional[bool] = None
    enable_calendar_tool: Optional[bool] = None

class ResetDataRequest(BaseModel):
    conversations: bool = True
    bookings: bool = True
    knowledge: bool = False
    catalog: bool = False  # services and staff

class AiTestConnectionRequest(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None


@app.get("/")
def health_check():
    return {
        "status": "online",
        "service": "Resolve AI Support & Automation Pipeline",
        "time": now_utc().isoformat()
    }

@app.get("/api/chat/intro")
async def chat_intro():
    """Business-specific greeting and quick-reply suggestions, generated from the knowledge base."""
    return await get_chat_intro()

@app.post("/api/chat/send")
async def send_public_chat_message(req: PublicChatMessageRequest, background_tasks: BackgroundTasks):
    """Elqen-style REST message ingest endpoint."""
    user_text = req.text.strip()
    if not user_text:
        raise HTTPException(status_code=400, detail="Message text cannot be empty")
        
    visitor_name = req.visitor_name or f"Visitor #{req.session_id[:6]}"

    saved = await ingest_visitor_message(req.session_id, user_text, visitor_name, req.visitor_email)

    # Trigger AI processing asynchronously in background
    background_tasks.add_task(handle_ai_message_task, req.session_id, visitor_name, user_text)

    return {
        "status": "queued",
        "id": saved["id"],
        "created_at": saved["created_at"],
        "session_id": req.session_id
    }

@app.post("/api/conversations/{conversation_id}/visitor-details")
async def update_visitor_details(conversation_id: str, req: VisitorDetailsRequest):
    with Session(engine) as session:
        conv = session.exec(select(Conversation).where(Conversation.id == conversation_id)).first()
        if not conv:
            conv = Conversation(
                id=conversation_id,
                visitor_name=req.visitor_name,
                visitor_email=req.visitor_email,
                status="ai_active"
            )
            session.add(conv)
        else:
            conv.visitor_name = req.visitor_name
            conv.visitor_email = req.visitor_email
            conv.updated_at = now_utc()
            session.add(conv)
        session.commit()
        session.refresh(conv)
        
    await manager.broadcast_to_agents({
        "type": "conversation_updated",
        "conversation_id": conversation_id,
        "visitor_name": conv.visitor_name,
        "visitor_email": conv.visitor_email,
        "status": conv.status
    })
    
    return {"status": "updated", "visitor_name": conv.visitor_name, "visitor_email": conv.visitor_email}

@app.get("/api/conversations")
def get_conversations(session: Session = Depends(get_session)):
    conversations = session.exec(select(Conversation).order_by(Conversation.updated_at.desc())).all()
    results = []
    for c in conversations:
        # Get last message
        last_msg = session.exec(
            select(Message).where(Message.conversation_id == c.id).order_by(Message.created_at.desc())
        ).first()
        results.append({
            "id": c.id,
            "visitor_name": c.visitor_name,
            "visitor_email": c.visitor_email,
            "status": c.status,
            "bot_paused_until": iso_or_none(c.bot_paused_until),
            "created_at": iso_or_none(c.created_at),
            "updated_at": iso_or_none(c.updated_at),
            "last_message": last_msg.content if last_msg else None,
            "last_sender": last_msg.sender if last_msg else None,
            "last_message_time": iso_or_none(last_msg.created_at) if last_msg else None
        })
    return results

@app.get("/api/conversations/{conversation_id}/messages")
def get_conversation_messages(conversation_id: str, session: Session = Depends(get_session)):
    messages = session.exec(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at.asc())
    ).all()
    conv = session.exec(select(Conversation).where(Conversation.id == conversation_id)).first()
    return {
        "conversation": conv,
        "messages": [
            {
                "id": m.id,
                "sender": m.sender,
                "content": m.content,
                "created_at": iso_or_none(m.created_at),
                "metadata": json.loads(m.metadata_json) if m.metadata_json else None
            }
            for m in messages
        ]
    }

@app.post("/api/conversations/{conversation_id}/reply")
async def send_agent_reply(conversation_id: str, req: AgentReplyRequest):
    with Session(engine) as session:
        conv = session.exec(select(Conversation).where(Conversation.id == conversation_id)).first()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # When human agent replies, automatically mark conversation as human_handover
        # and activate the Bot Pause Window (Elqen style: pause AI for configured duration)
        conv.status = "human_handover"
        conv.bot_paused_until = now_utc() + timedelta(minutes=get_pause_minutes())
        conv.updated_at = now_utc()
        session.add(conv)

        agent_msg = Message(
            conversation_id=conversation_id,
            sender="agent",
            content=req.content
        )
        session.add(agent_msg)
        session.commit()
        session.refresh(agent_msg)
        agent_msg_id = agent_msg.id
        agent_msg_created_at_str = iso_or_none(agent_msg.created_at)
        conv_status = conv.status
        paused_until_str = iso_or_none(conv.bot_paused_until)

    payload = {
        "type": "message",
        "sender": "agent",
        "content": req.content,
        "created_at": agent_msg_created_at_str
    }
    # Send directly to visitor
    await manager.send_to_visitor(conversation_id, payload)
    # Broadcast to all agent screens
    await manager.broadcast_to_agents({
        "type": "new_message",
        "conversation_id": conversation_id,
        "sender": "agent",
        "content": req.content,
        "created_at": agent_msg_created_at_str,
        "status": conv_status,
        "bot_paused_until": paused_until_str
    })

    return {
        "status": "sent",
        "message_id": agent_msg_id,
        "bot_paused_until": paused_until_str
    }

@app.post("/api/conversations/{conversation_id}/resume-ai")
async def resume_ai_bot(conversation_id: str, session: Session = Depends(get_session)):
    """Resumes the AI assistant and clears the Bot Pause Window."""
    conv = session.exec(select(Conversation).where(Conversation.id == conversation_id)).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    conv.status = "ai_active"
    conv.bot_paused_until = None
    conv.updated_at = now_utc()
    session.add(conv)
    session.commit()
    session.refresh(conv)

    await notify_status(conversation_id, "ai_active")

    return {"status": "resumed", "conversation_id": conversation_id, "mode": "ai_active"}

@app.get("/api/automations/status")
def get_automations_status(session: Session = Depends(get_session)):
    """Returns business hours, timezone, and active bot pause metrics (Elqen style)."""
    hours = check_business_hours()

    # Count conversations where bot is paused
    active_paused = session.exec(
        select(Conversation).where(Conversation.bot_paused_until > now_utc())
    ).all()

    return {
        "business_hours": {
            "status": hours["status"],
            "schedule": hours["business_schedule"],
            "timezone": "UTC",
            "current_time": hours["current_time_utc"]
        },
        "bot_pause_engine": {
            "active_paused_sessions": len(active_paused),
            "default_pause_minutes": get_pause_minutes()
        }
    }

VALID_STATUSES = {"ai_active", "human_handover", "resolved"}

@app.post("/api/conversations/{conversation_id}/status")
async def update_conversation_status(conversation_id: str, req: StatusUpdateRequest, session: Session = Depends(get_session)):
    if req.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(sorted(VALID_STATUSES))}")
    conv = session.exec(select(Conversation).where(Conversation.id == conversation_id)).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    conv.status = req.status
    if req.status == "human_handover":
        # Manual takeover opens the Bot Pause Window, same as an agent reply
        conv.bot_paused_until = now_utc() + timedelta(minutes=get_pause_minutes())
    else:
        conv.bot_paused_until = None
    conv.updated_at = now_utc()
    session.add(conv)
    session.commit()
    session.refresh(conv)

    await notify_status(conversation_id, req.status, conv.bot_paused_until)
    return {"status": "updated", "new_status": req.status, "bot_paused_until": iso_or_none(conv.bot_paused_until)}

# --- KNOWLEDGE BASE / RAG ENDPOINTS ---

@app.get("/api/knowledge")
def get_knowledge_documents():
    return list_all_knowledge_docs()

@app.post("/api/knowledge")
def create_knowledge_document(req: KnowledgeDocRequest):
    import uuid
    doc_id = f"doc_{uuid.uuid4().hex[:8]}"
    return add_knowledge_doc(doc_id, req.title, req.content, req.category)

@app.delete("/api/knowledge/{doc_id}")
def delete_doc(doc_id: str):
    return delete_knowledge_doc(doc_id)

# --- CALENDAR ENDPOINTS ---

@app.get("/api/calendar/availability")
def get_calendar_availability(
    date: str = Query(..., description="Date formatted as YYYY-MM-DD"),
    service: Optional[str] = Query(None, description="Service name"),
    staff: Optional[str] = Query(None, description="Team member name"),
):
    return check_calendar_availability(date, service, staff)

@app.get("/api/calendar/bookings")
def get_all_bookings(
    start: Optional[str] = Query(None, description="First date (YYYY-MM-DD), inclusive"),
    end: Optional[str] = Query(None, description="Last date (YYYY-MM-DD), inclusive"),
    session: Session = Depends(get_session),
):
    stmt = select(CalendarBooking)
    if start:
        stmt = stmt.where(CalendarBooking.booking_date >= start)
    if end:
        stmt = stmt.where(CalendarBooking.booking_date <= end)
    return session.exec(stmt.order_by(CalendarBooking.booking_date, CalendarBooking.booking_time)).all()

@app.post("/api/calendar/book")
def make_booking(req: BookingRequest):
    return book_calendar_appointment(
        conversation_id=req.conversation_id,
        visitor_name=req.visitor_name,
        date_str=req.date_str,
        time_str=req.time_str,
        service_type=req.service_type,
        contact_info=req.contact_info,
        staff_name=req.staff_name,
    )

@app.post("/api/calendar/bookings/{booking_id}/status")
def update_booking_status(booking_id: int, req: BookingStatusRequest):
    result = set_booking_status(booking_id, req.status)
    if result["status"] == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result["booking"]

@app.get("/api/schedule/settings")
def get_schedule_settings_endpoint():
    return get_schedule_settings()

@app.post("/api/schedule/settings")
def update_schedule_settings_endpoint(req: ScheduleSettingsRequest):
    data = req.model_dump(exclude_none=True)
    for key in ("open_time", "close_time"):
        if key in data and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", data[key]):
            raise HTTPException(status_code=400, detail=f"{key} must be HH:MM")
    if "working_days" in data:
        data["working_days"] = sorted({d for d in data["working_days"] if 0 <= d <= 6})
    merged = {**get_schedule_settings(), **data}
    if merged["open_time"] >= merged["close_time"]:
        raise HTTPException(status_code=400, detail="Closing time must be after opening time")
    return update_schedule_settings(data)

# --- SERVICES & STAFF (booking catalog) ---

def staff_to_dict(member: StaffMember) -> dict:
    return {
        "id": member.id,
        "name": member.name,
        "role": member.role,
        "service_ids": staff_service_ids(member),
        "working_days": staff_working_days(member),
        "is_active": member.is_active,
    }

@app.get("/api/services")
def list_services(session: Session = Depends(get_session)):
    return session.exec(select(Service).order_by(Service.name)).all()

@app.post("/api/services")
def create_service(req: ServiceRequest, session: Session = Depends(get_session)):
    if not req.name.strip() or req.duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="A service needs a name and a positive duration")
    service = Service(name=req.name.strip(), duration_minutes=req.duration_minutes, price=req.price, is_active=req.is_active)
    session.add(service)
    session.commit()
    session.refresh(service)
    return service

@app.put("/api/services/{service_id}")
def update_service(service_id: int, req: ServiceRequest, session: Session = Depends(get_session)):
    service = session.get(Service, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    service.name = req.name.strip() or service.name
    service.duration_minutes = req.duration_minutes
    service.price = req.price
    service.is_active = req.is_active
    session.add(service)
    session.commit()
    session.refresh(service)
    return service

@app.delete("/api/services/{service_id}")
def delete_service(service_id: int, session: Session = Depends(get_session)):
    service = session.get(Service, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    session.delete(service)
    # Drop the service from everyone's skill list
    for member in session.exec(select(StaffMember)).all():
        ids = staff_service_ids(member)
        if service_id in ids:
            member.service_ids_json = json.dumps([i for i in ids if i != service_id])
            session.add(member)
    session.commit()
    return {"status": "deleted", "id": service_id}

@app.get("/api/staff")
def list_staff(session: Session = Depends(get_session)):
    return [staff_to_dict(m) for m in session.exec(select(StaffMember).order_by(StaffMember.name)).all()]

def _apply_staff_request(member: StaffMember, req: StaffRequest):
    member.name = req.name.strip() or member.name
    member.role = (req.role or "").strip() or None
    member.service_ids_json = json.dumps(sorted(set(req.service_ids)))
    member.working_days_json = json.dumps(sorted({d for d in req.working_days if 0 <= d <= 6}))
    member.is_active = req.is_active

@app.post("/api/staff")
def create_staff(req: StaffRequest, session: Session = Depends(get_session)):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="A team member needs a name")
    member = StaffMember(name=req.name.strip())
    _apply_staff_request(member, req)
    session.add(member)
    session.commit()
    session.refresh(member)
    return staff_to_dict(member)

@app.put("/api/staff/{staff_id}")
def update_staff(staff_id: int, req: StaffRequest, session: Session = Depends(get_session)):
    member = session.get(StaffMember, staff_id)
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    _apply_staff_request(member, req)
    session.add(member)
    session.commit()
    session.refresh(member)
    return staff_to_dict(member)

@app.delete("/api/staff/{staff_id}")
def delete_staff(staff_id: int, session: Session = Depends(get_session)):
    member = session.get(StaffMember, staff_id)
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    # Existing bookings keep the staff name for history; they just stop linking to the record
    session.delete(member)
    session.commit()
    return {"status": "deleted", "id": staff_id}

# --- DATA RESET ---

@app.post("/api/admin/reset")
async def reset_data(req: ResetDataRequest, session: Session = Depends(get_session)):
    """Deletes the selected kinds of business data. Settings are never touched."""
    deleted = {}
    if req.conversations:
        deleted["messages"] = session.exec(delete(Message)).rowcount
        deleted["conversations"] = session.exec(delete(Conversation)).rowcount
    if req.bookings:
        deleted["bookings"] = session.exec(delete(CalendarBooking)).rowcount
    if req.catalog:
        deleted["staff"] = session.exec(delete(StaffMember)).rowcount
        deleted["services"] = session.exec(delete(Service)).rowcount
    session.commit()

    if req.knowledge:
        docs = list_all_knowledge_docs()
        for doc in docs:
            delete_knowledge_doc(doc["id"])
        deleted["knowledge_documents"] = len(docs)

    # Let every open inbox clear its view
    await manager.broadcast_to_agents({"type": "data_reset", "deleted": deleted})
    return {"status": "reset", "deleted": deleted}

# --- AI & WORKSPACE SETTINGS ENDPOINTS ---

@app.get("/api/settings/ai")
def get_ai_settings_endpoint():
    return get_public_ai_settings()

@app.post("/api/settings/ai")
def update_ai_settings_endpoint(req: AiSettingsUpdateRequest):
    # Support pydantic v1 or v2 model dumping
    data = req.model_dump(exclude_none=True) if hasattr(req, "model_dump") else req.dict(exclude_none=True)
    return update_ai_settings(data)

@app.post("/api/settings/ai/test")
def test_ai_settings_endpoint(req: AiTestConnectionRequest):
    return test_gemini_connection(api_key=req.api_key, model=req.model)

