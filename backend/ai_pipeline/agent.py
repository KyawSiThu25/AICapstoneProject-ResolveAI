import os
import re
import json
import asyncio
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv
from sqlmodel import Session, select

from database import engine
from models import Message, now_utc
from .rag import query_knowledge
from .gemini import generate_with_fallback
from .tools import (
    describe_catalog,
    check_calendar_availability,
    book_calendar_appointment,
    trigger_human_handoff,
    resolve_date_phrase,
)

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=ENV_PATH)
load_dotenv()

# Explicit requests for a person. Matched on whole words/phrases only, so
# "personal" or "agency" don't trigger a handoff. Topics that *may* need a human
# (refunds, billing disputes) are left to the model's trigger_human_handoff tool.
HANDOFF_KEYWORDS = [
    "human", "agent", "representative", "real person", "person", "operator",
    "talk to someone", "customer service", "speak to a human", "live agent",
    "complaint", "frustrated", "manager"
]

BOOKING_KEYWORDS = ["book", "schedule", "reserve", "appointment", "meeting", "consultation"]
AVAILABILITY_KEYWORDS = ["available", "availability", "open slot", "free time", "what time", "when can"]

HISTORY_LIMIT = 20
MAX_TOOL_ROUNDS = 4
# Cosine distance above which a retrieved chunk is treated as unrelated (not cited).
RAG_CITATION_MAX_DISTANCE = 0.7


def _contains_phrase(text: str, phrases: List[str]) -> bool:
    lower = text.lower()
    return any(re.search(rf"\b{re.escape(p.lower().strip())}\b", lower) for p in phrases if p.strip())


def matches_handoff(text: str, keywords: Optional[List[str]] = None) -> bool:
    return _contains_phrase(text, keywords if keywords is not None else HANDOFF_KEYWORDS)


def format_rag_context(chunks: List[Dict[str, Any]]) -> str:
    """Format ChromaDB search results into a clean context block."""
    if not chunks:
        return "No specific company knowledge found for this query."
    formatted = []
    for i, c in enumerate(chunks, 1):
        title = c.get("metadata", {}).get("title", "Document")
        content = c.get("content", "")
        formatted.append(f"[Source {i} - {title}]:\n{content}")
    return "\n\n".join(formatted)


def relevant_sources(chunks: List[Dict[str, Any]]) -> List[str]:
    return [
        c.get("metadata", {}).get("title", "Doc")
        for c in chunks
        if c.get("distance", 0.0) <= RAG_CITATION_MAX_DISTANCE
    ]


def _mentioned_service(message: str) -> Optional[str]:
    """Name of an active service mentioned in the message, for the rule-based fallback."""
    from models import Service
    with Session(engine) as session:
        services = session.exec(select(Service).where(Service.is_active == True)).all()  # noqa: E712
    lower = message.lower()
    # Prefer the longest name so "Haircut + Beard Combo" wins over "Haircut"
    for s in sorted(services, key=lambda s: len(s.name), reverse=True):
        if s.name.lower() in lower:
            return s.name
    return None


def _last_discussed_date(conversation_id: str) -> Optional[str]:
    """Date from the most recent calendar tool result in this conversation (for follow-ups like 'book the 10:30 one')."""
    with Session(engine) as session:
        rows = session.exec(
            select(Message)
            .where(Message.conversation_id == conversation_id, Message.sender == "ai")
            .order_by(Message.created_at.desc())
            .limit(5)
        ).all()
    for m in rows:
        try:
            result = json.loads(m.metadata_json or "{}").get("tool_result") or {}
        except ValueError:
            continue
        candidates = [result] + [c.get("result") or {} for c in result.get("calls", [])]
        for r in reversed(candidates):
            if isinstance(r, dict) and r.get("date"):
                return r["date"]
    return None


def _handoff_result(conversation_id: str, user_message: str, reply: str, mode: str) -> Dict[str, Any]:
    handoff_result = trigger_human_handoff(conversation_id, reason=f"Visitor requested human assistance: '{user_message}'")
    return {
        "reply": reply,
        "sources": [],
        "tool_called": "trigger_human_handoff",
        "tool_result": handoff_result,
        "handoff_triggered": True,
        "mode": mode
    }


def rule_based_fallback_agent(
    conversation_id: str,
    visitor_name: str,
    message: str,
    rag_chunks: List[Dict[str, Any]],
    handoff_keywords: Optional[List[str]] = None,
    enable_calendar_tool: bool = True
) -> Dict[str, Any]:
    """
    Deterministic fallback used when no Gemini API key is configured or the API call fails.
    """
    lower = message.lower()

    # 1. Human handoff intent
    if matches_handoff(message, handoff_keywords):
        return _handoff_result(
            conversation_id, message,
            "I've escalated this chat to our human support team. A representative will join shortly to assist you. Please hold on!",
            "fallback_rules"
        )

    if enable_calendar_tool:
        time_match = re.search(r"\b(\d{1,2}:\d{2})\b", message)
        wants_booking = _contains_phrase(lower, BOOKING_KEYWORDS)
        date_str = resolve_date_phrase(message)
        if not date_str and wants_booking and time_match:
            date_str = _last_discussed_date(conversation_id)

        # 2. Booking: needs both a date and a time; otherwise show availability and ask.
        if wants_booking and date_str and time_match:
            result = book_calendar_appointment(
                conversation_id=conversation_id,
                visitor_name=visitor_name,
                date_str=date_str,
                time_str=time_match.group(1),
                service_type=_mentioned_service(message),
            )
            if result.get("status") == "confirmed":
                with_whom = f" with {result['staff']}" if result.get("staff") else ""
                reply = (
                    f"You're booked! {result['service']}{with_whom} on **{result['date']}** at **{result['time']} UTC** "
                    f"(Booking ID: #{result['booking_id']})."
                )
            elif result.get("status") == "needs_service":
                reply = result["message"]
            else:
                reply = f"I couldn't book that slot. {result.get('message', '')}"
            return {
                "reply": reply,
                "sources": ["Calendar Service"],
                "tool_called": "book_calendar_appointment",
                "tool_result": result,
                "handoff_triggered": False,
                "mode": "fallback_rules"
            }

        # 3. Availability (or a booking request missing a date/time)
        if wants_booking or _contains_phrase(lower, AVAILABILITY_KEYWORDS):
            if not date_str:
                return {
                    "reply": "Which day would you like? Consultations run Monday to Friday. Tell me a date (e.g. 2026-10-12) or say \"tomorrow\".",
                    "sources": [],
                    "tool_called": None,
                    "tool_result": None,
                    "handoff_triggered": False,
                    "mode": "fallback_rules"
                }
            avail = check_calendar_availability(date_str, _mentioned_service(message))
            slots = avail.get("available_slots", [])
            if slots:
                reply = (
                    f"Open slots on **{avail['date']}** (UTC): **{', '.join(slots)}**.\n\n"
                    f"Tell me which time you'd like and I'll book it."
                )
            else:
                reply = f"There are no open slots on {avail['date']}. {avail.get('message', '')} Would you like to try another day?"
            return {
                "reply": reply,
                "sources": ["Calendar Service"],
                "tool_called": "check_calendar_availability",
                "tool_result": avail,
                "handoff_triggered": False,
                "mode": "fallback_rules"
            }

    # 4. RAG-grounded answering
    sources = relevant_sources(rag_chunks)
    if sources:
        top_chunk = rag_chunks[0]
        title = top_chunk.get("metadata", {}).get("title", "Company Knowledge")
        reply = (
            f"Based on our company documentation ({title}):\n\n"
            f"{top_chunk.get('content', '')}\n\n"
            f"Is there anything specific you would like more details on, or would you like to schedule a call with our team?"
        )
        return {
            "reply": reply,
            "sources": [title],
            "tool_called": "rag_query",
            "tool_result": {"matched_docs": len(sources)},
            "handoff_triggered": False,
            "mode": "fallback_rules"
        }

    return {
        "reply": (
            "I don't have information about that yet. Would you like me to connect you with a member of our team? "
            "Just say \"talk to a person\". I can also check appointment times or book one for you."
        ),
        "sources": [],
        "tool_called": None,
        "tool_result": None,
        "handoff_triggered": False,
        "mode": "fallback_rules"
    }


# --- Gemini function-calling agent ---

def _tool_declarations(types, enable_calendar_tool: bool):
    declarations = [
        types.FunctionDeclaration(
            name="trigger_human_handoff",
            description=(
                "Escalates the conversation to a human support agent and pauses the AI. Use when the visitor "
                "asks for a person, is frustrated, has a billing dispute or refund request that needs action, "
                "or when the question cannot be answered from the company knowledge."
            ),
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "reason": types.Schema(type="STRING", description="Short reason for the escalation"),
                },
                required=["reason"],
            ),
        )
    ]
    if enable_calendar_tool:
        declarations += [
            types.FunctionDeclaration(
                name="check_calendar_availability",
                description=(
                    "Checks open start times (UTC) on a date for a service, optionally with a specific team member. "
                    "Returns available_slots and, when staff are set up, which team members are free at each time."
                ),
                parameters=types.Schema(
                    type="OBJECT",
                    properties={
                        "date_str": types.Schema(type="STRING", description="Date in YYYY-MM-DD format"),
                        "service_type": types.Schema(type="STRING", description="Exact service name from the Bookable services list, if known"),
                        "staff_name": types.Schema(type="STRING", description="Team member the visitor asked for, if any"),
                    },
                    required=["date_str"],
                ),
            ),
            types.FunctionDeclaration(
                name="book_calendar_appointment",
                description=(
                    "Books a service for the visitor. Only call this once the visitor has confirmed the service, "
                    "the date and one of the available times. A free, qualified team member is assigned automatically "
                    "unless staff_name is given."
                ),
                parameters=types.Schema(
                    type="OBJECT",
                    properties={
                        "date_str": types.Schema(type="STRING", description="Date in YYYY-MM-DD format"),
                        "time_str": types.Schema(type="STRING", description="Time in HH:MM 24-hour format, e.g. 14:30"),
                        "service_type": types.Schema(type="STRING", description="Exact service name from the Bookable services list"),
                        "staff_name": types.Schema(type="STRING", description="Team member the visitor asked for; omit to assign anyone free"),
                        "contact_info": types.Schema(type="STRING", description="Visitor email or phone, if given"),
                    },
                    required=["date_str", "time_str"],
                ),
            ),
        ]
    return [types.Tool(function_declarations=declarations)]


def _load_history(conversation_id: str, types, user_message: str) -> list:
    """Builds Gemini contents from the stored conversation (most recent HISTORY_LIMIT messages)."""
    with Session(engine) as session:
        rows = session.exec(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(HISTORY_LIMIT)
        ).all()
    rows = list(reversed(rows))

    contents = []
    for m in rows:
        if m.sender == "visitor":
            contents.append(types.Content(role="user", parts=[types.Part(text=m.content)]))
        elif m.sender in ("ai", "agent"):
            text = m.content if m.sender == "ai" else f"[Human support agent replied]: {m.content}"
            contents.append(types.Content(role="model", parts=[types.Part(text=text)]))

    # Conversations must start with a user turn and end with the current message.
    while contents and contents[0].role != "user":
        contents.pop(0)
    if not contents or contents[-1].role != "user" or contents[-1].parts[0].text != user_message:
        contents.append(types.Content(role="user", parts=[types.Part(text=user_message)]))
    return contents


def _build_system_instruction(settings: Dict[str, Any], visitor_name: str, context_text: str, catalog_text: str = "") -> str:
    base_system_prompt = settings.get("system_instruction") or (
        "You are the friendly AI customer support assistant for this business. "
        "Take the business name, services, prices and policies from the Company Knowledge.\n"
        "Use the provided Company Knowledge to answer customer questions accurately.\n"
        "Keep your answers concise, professional, and friendly."
    )
    today = now_utc()
    rules = [
        f"Today is {today.strftime('%A')}, {today.date().isoformat()} (UTC). Resolve relative dates like 'tomorrow' from this.",
        f"The visitor's name is {visitor_name}.",
        *([f"The business is called {settings['business_name'].strip()}. Always use this name."]
          if (settings.get("business_name") or "").strip() else []),
        "For bookings: find out which service the visitor wants (ask if unclear), check availability, then book. "
        "Only mention a specific team member if the visitor asks for one or after booking (say who they're booked with). "
        "Never claim a booking succeeded unless book_calendar_appointment returned status 'confirmed'.",
        "If the visitor asks for a human, is upset, or needs an action you cannot perform (such as issuing a refund), call trigger_human_handoff.",
    ]
    if catalog_text and settings.get("enable_calendar_tool", True):
        context_text = f"{context_text}\n\n=== BOOKING CATALOG (live) ===\n{catalog_text}"
    if settings.get("strict_grounding", True):
        rules.append(
            "Answer company questions ONLY from the Company Knowledge below. If the answer is not there, say you don't know "
            "and offer to connect the visitor with a human agent. Do not invent prices, policies, or features."
        )
    return (
        f"{base_system_prompt}\n\n"
        + "\n".join(f"- {r}" for r in rules)
        + f"\n\n=== COMPANY KNOWLEDGE BASE (ChromaDB) ===\n{context_text}\n"
    )


async def run_gemini_agent(
    api_key: str,
    settings: Dict[str, Any],
    conversation_id: str,
    visitor_name: str,
    user_message: str,
    rag_chunks: List[Dict[str, Any]]
) -> Dict[str, Any]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    contents = await asyncio.to_thread(_load_history, conversation_id, types, user_message)
    catalog_text = await asyncio.to_thread(describe_catalog)

    config = types.GenerateContentConfig(
        system_instruction=_build_system_instruction(settings, visitor_name, format_rag_context(rag_chunks), catalog_text),
        temperature=float(settings.get("temperature", 0.2)),
        max_output_tokens=int(settings.get("max_output_tokens", 600)),
        tools=_tool_declarations(types, settings.get("enable_calendar_tool", True)),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    model_name = settings.get("model", "gemini-2.5-flash")

    tools_called: List[Dict[str, Any]] = []
    handoff_triggered = False
    reply_text = ""

    for _ in range(MAX_TOOL_ROUNDS):
        # Once a model answers, stay on it for the remaining tool rounds of this turn
        response, model_name = await generate_with_fallback(client, model_name, contents, config)
        calls = response.function_calls or []
        if not calls:
            reply_text = response.text or ""
            break

        contents.append(response.candidates[0].content)
        response_parts = []
        for call in calls:
            args = dict(call.args or {})
            if call.name == "check_calendar_availability":
                result = await asyncio.to_thread(
                    check_calendar_availability,
                    args.get("date_str", ""),
                    args.get("service_type"),
                    args.get("staff_name"),
                )
            elif call.name == "book_calendar_appointment":
                result = await asyncio.to_thread(
                    book_calendar_appointment,
                    conversation_id=conversation_id,
                    visitor_name=visitor_name,
                    date_str=args.get("date_str", ""),
                    time_str=args.get("time_str", ""),
                    service_type=args.get("service_type"),
                    contact_info=args.get("contact_info"),
                    staff_name=args.get("staff_name"),
                )
            elif call.name == "trigger_human_handoff":
                result = await asyncio.to_thread(
                    trigger_human_handoff, conversation_id, args.get("reason", "Escalated by AI assistant")
                )
                handoff_triggered = result.get("status") == "handed_off"
            else:
                result = {"status": "error", "message": f"Unknown tool {call.name}"}

            tools_called.append({"name": call.name, "args": args, "result": result})
            response_parts.append(types.Part.from_function_response(name=call.name, response={"result": result}))
        contents.append(types.Content(role="user", parts=response_parts))
    else:
        reply_text = ""

    if not reply_text.strip():
        reply_text = (
            "I'm handing you over to a human representative now. Please hold on!"
            if handoff_triggered
            else "I'm here to help. Could you please clarify your question?"
        )

    last_tool = tools_called[-1] if tools_called else None
    used_calendar = any(t["name"] != "trigger_human_handoff" for t in tools_called)
    sources = relevant_sources(rag_chunks)
    if used_calendar:
        sources = ["Calendar Service"] + sources

    return {
        "reply": reply_text,
        "sources": [] if handoff_triggered else sources,
        "tool_called": last_tool["name"] if last_tool else ("rag_query" if rag_chunks else None),
        "tool_result": (
            {"calls": [{"name": t["name"], "args": t["args"], "result": t["result"]} for t in tools_called]}
            if tools_called else {"retrieved_chunks": len(rag_chunks)}
        ),
        "handoff_triggered": handoff_triggered,
        "mode": "gemini",
        "model": model_name
    }


async def run_agent_pipeline(
    conversation_id: str,
    visitor_name: str,
    user_message: str,
    conversation_status: str
) -> Optional[Dict[str, Any]]:
    """
    Main AI pipeline:
    - If status is 'human_handover', the AI does NOT auto-reply.
    - Explicit requests for a human are escalated immediately (whole-word keyword match).
    - Queries ChromaDB RAG, then runs Gemini with function calling (calendar + handoff tools)
      over the conversation history.
    - Without an API key (or if Gemini fails), falls back to the deterministic RAG + tool agent.
    """
    if conversation_status == "human_handover":
        print(f"[Agent] Conversation {conversation_id} is in human_handover mode. AI auto-responder paused.")
        return None

    from .settings import get_raw_ai_settings
    settings = get_raw_ai_settings()
    handoff_keywords = settings.get("handoff_keywords", HANDOFF_KEYWORDS)
    enable_calendar = settings.get("enable_calendar_tool", True)

    top_k = int(settings.get("rag_top_k", 2))
    rag_chunks = await asyncio.to_thread(query_knowledge, user_message, top_k)

    api_key = settings.get("api_key", "").strip() or os.getenv("GEMINI_API_KEY", "")
    mode = "gemini" if api_key else "fallback_rules"

    if matches_handoff(user_message, handoff_keywords):
        return await asyncio.to_thread(
            _handoff_result, conversation_id, user_message,
            "I understand. I'm handing you over to a human representative right away. Please hold on!",
            mode
        )

    if not api_key:
        print("[Agent] GEMINI_API_KEY not found. Using RAG + tool fallback agent.")
        return await asyncio.to_thread(
            rule_based_fallback_agent, conversation_id, visitor_name, user_message,
            rag_chunks, handoff_keywords, enable_calendar
        )

    try:
        return await run_gemini_agent(api_key, settings, conversation_id, visitor_name, user_message, rag_chunks)
    except Exception as e:
        print(f"[Agent] Error calling Gemini API: {e}. Falling back to rule-based agent.")
        return await asyncio.to_thread(
            rule_based_fallback_agent, conversation_id, visitor_name, user_message,
            rag_chunks, handoff_keywords, enable_calendar
        )
