from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

class Conversation(SQLModel, table=True):
    id: str = Field(primary_key=True, index=True)
    visitor_name: str = Field(default="Website Visitor")
    visitor_email: Optional[str] = Field(default=None)
    status: str = Field(default="ai_active")  # "ai_active", "human_handover", "resolved"
    summary: Optional[str] = Field(default=None)
    bot_paused_until: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: str = Field(index=True)
    sender: str  # "visitor", "ai", "agent", "system"
    content: str
    created_at: datetime = Field(default_factory=now_utc)
    metadata_json: Optional[str] = Field(default=None)  # JSON string for tool outputs, sources, etc.

class Service(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    duration_minutes: int = Field(default=30)
    price: Optional[float] = Field(default=None)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=now_utc)

class StaffMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    role: Optional[str] = Field(default=None)
    # JSON list of Service ids this person performs; an empty list means every service
    service_ids_json: str = Field(default="[]")
    # JSON list of weekdays worked, Monday = 0 ... Sunday = 6
    working_days_json: str = Field(default="[0, 1, 2, 3, 4]")
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=now_utc)

class CalendarBooking(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: str = Field(index=True)
    visitor_name: str
    email_or_phone: Optional[str] = None
    service_type: str = Field(default="Appointment")
    service_id: Optional[int] = Field(default=None)
    staff_id: Optional[int] = Field(default=None, index=True)
    staff_name: Optional[str] = Field(default=None)
    booking_date: str  # e.g., "2026-10-08"
    booking_time: str  # e.g., "14:00"
    duration_minutes: int = Field(default=30)
    status: str = Field(default="confirmed")  # "confirmed", "completed", "no_show", "cancelled"
    created_at: datetime = Field(default_factory=now_utc)

class KnowledgeDoc(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    doc_id: str = Field(unique=True, index=True)
    title: str
    content: str
    category: str = Field(default="General")
    created_at: datetime = Field(default_factory=now_utc)
