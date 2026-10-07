import re
import json
from datetime import datetime, timezone, timedelta, date
from typing import List, Dict, Any, Optional, Tuple
from sqlmodel import Session, select
from database import engine
from models import CalendarBooking, Conversation, Service, StaffMember, now_utc
from .settings import get_schedule_settings

WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
# Bookings in these states occupy a slot; "cancelled" and "no_show" free it again
BLOCKING_STATUSES = ("confirmed", "completed")
BOOKING_STATUSES = ("confirmed", "completed", "no_show", "cancelled")


# --- Small helpers ---

def resolve_date_phrase(text: str, today: Optional[date] = None) -> Optional[str]:
    """
    Extracts a calendar date from free text. Supports YYYY-MM-DD, 'today',
    'tomorrow', and weekday names ('monday' = the next upcoming Monday).
    """
    today = today or now_utc().date()
    lower = text.lower()
    iso = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if iso:
        return iso.group(1)
    if re.search(r"\btomorrow\b", lower):
        return (today + timedelta(days=1)).isoformat()
    if re.search(r"\btoday\b", lower):
        return today.isoformat()
    for idx, name in enumerate(WEEKDAY_NAMES):
        if re.search(rf"\b{name}\b", lower):
            delta = (idx - today.weekday()) % 7 or 7
            return (today + timedelta(days=delta)).isoformat()
    return None

def _normalize_time(time_str: str) -> str:
    clean_time = (time_str or "").strip()
    if len(clean_time) == 4 and clean_time[1] == ':':
        clean_time = f"0{clean_time}"
    return clean_time

def hm_to_minutes(hm: str) -> int:
    hour, minute = map(int, hm.split(":"))
    return hour * 60 + minute

def minutes_to_hm(total: int) -> str:
    return f"{total // 60:02d}:{total % 60:02d}"

def _day_names(days: List[int]) -> str:
    return ", ".join(WEEKDAY_NAMES[d][:3].title() for d in sorted(days))

def staff_service_ids(staff: StaffMember) -> List[int]:
    try:
        return [int(x) for x in json.loads(staff.service_ids_json or "[]")]
    except (ValueError, TypeError):
        return []

def staff_working_days(staff: StaffMember) -> List[int]:
    try:
        return [int(x) for x in json.loads(staff.working_days_json or "[]")]
    except (ValueError, TypeError):
        return []

def _overlaps(start_a: int, end_a: int, start_b: int, end_b: int) -> bool:
    return start_a < end_b and end_a > start_b

def _date_problem(target: date, cfg: Dict[str, Any]) -> Optional[str]:
    """Returns a human-readable reason the date cannot be booked, or None."""
    today = now_utc().date()
    if target < today:
        return f"{target.isoformat()} is in the past."
    if target > today + timedelta(days=int(cfg["max_days_ahead"])):
        return f"Bookings can only be made up to {cfg['max_days_ahead']} days ahead."
    if target.weekday() not in cfg["working_days"]:
        return (
            f"{target.isoformat()} is a {WEEKDAY_NAMES[target.weekday()].title()}. "
            f"Appointments can be booked on {_day_names(cfg['working_days'])} only."
        )
    return None

def _candidate_starts(target: date, duration: int, cfg: Dict[str, Any]) -> List[int]:
    """Start times (minutes from midnight) on the slot grid that fit before closing and respect the notice window."""
    open_m, close_m = hm_to_minutes(cfg["open_time"]), hm_to_minutes(cfg["close_time"])
    step = max(5, int(cfg["slot_step_minutes"]))
    earliest = now_utc() + timedelta(minutes=int(cfg["min_notice_minutes"]))
    starts = []
    for start in range(open_m, close_m - duration + 1, step):
        slot_dt = datetime(target.year, target.month, target.day, start // 60, start % 60, tzinfo=timezone.utc)
        if slot_dt >= earliest:
            starts.append(start)
    return starts


# --- Catalog lookups ---

def _active_services(session: Session) -> List[Service]:
    return list(session.exec(select(Service).where(Service.is_active == True).order_by(Service.name)).all())  # noqa: E712

def _active_staff(session: Session) -> List[StaffMember]:
    return list(session.exec(select(StaffMember).where(StaffMember.is_active == True).order_by(StaffMember.name)).all())  # noqa: E712

def _match_by_name(items: list, name: Optional[str]):
    """Case-insensitive match: exact, then first name / word, then substring either way."""
    if not name or not name.strip():
        return None
    wanted = name.strip().lower()
    for item in items:
        if item.name.lower() == wanted:
            return item
    for item in items:
        if wanted in item.name.lower().split():
            return item
    for item in items:
        if wanted in item.name.lower() or item.name.lower() in wanted:
            return item
    return None

def _resolve_service(session: Session, service_type: Optional[str]) -> Tuple[Optional[Service], Optional[Dict[str, Any]]]:
    services = _active_services(session)
    if not services:
        return None, None  # No catalog configured: generic appointments
    if not service_type:
        return None, None
    service = _match_by_name(services, service_type)
    if service:
        return service, None
    return None, {
        "status": "unknown_service",
        "services": [s.name for s in services],
        "message": f"'{service_type}' isn't on our service list. Available services: {', '.join(s.name for s in services)}."
    }

def _qualified_staff(
    session: Session, target: date, service: Optional[Service], staff_name: Optional[str]
) -> Tuple[List[Optional[StaffMember]], Optional[Dict[str, Any]]]:
    """
    Staff who work that weekday and can perform the service. With no staff configured,
    returns [None]: the business is treated as a single bookable resource.
    """
    staff = _active_staff(session)
    if not staff:
        return [None], None

    weekday = target.weekday()
    qualified = [
        s for s in staff
        if weekday in staff_working_days(s)
        and (service is None or not staff_service_ids(s) or service.id in staff_service_ids(s))
    ]
    if staff_name:
        person = _match_by_name(staff, staff_name)
        if not person:
            return [], {
                "status": "unknown_staff",
                "staff": [s.name for s in staff],
                "message": f"We don't have a team member called '{staff_name}'. Our team: {', '.join(s.name for s in staff)}."
            }
        if person not in qualified:
            reason = (
                f"{person.name} doesn't work on {WEEKDAY_NAMES[weekday].title()}s (works {_day_names(staff_working_days(person))})."
                if weekday not in staff_working_days(person)
                else f"{person.name} doesn't offer {service.name if service else 'that service'}."
            )
            return [], {"status": "staff_unavailable", "message": reason}
        return [person], None
    if not qualified:
        return [], {
            "status": "unavailable",
            "message": f"Nobody who offers {service.name if service else 'appointments'} is working on {target.isoformat()}."
        }
    return qualified, None

def _busy_intervals(session: Session, target_date: str, staff: Optional[StaffMember]) -> List[Tuple[int, int]]:
    stmt = select(CalendarBooking).where(
        CalendarBooking.booking_date == target_date,
        CalendarBooking.status.in_(BLOCKING_STATUSES),
    )
    if staff is not None:
        stmt = stmt.where(CalendarBooking.staff_id == staff.id)
    intervals = []
    for b in session.exec(stmt).all():
        start = hm_to_minutes(b.booking_time)
        intervals.append((start, start + (b.duration_minutes or 30)))
    return intervals

def _free_staff_at(busy: Dict[Any, List[Tuple[int, int]]], candidates: List[Optional[StaffMember]], start: int, end: int):
    return [c for c in candidates if not any(_overlaps(start, end, s, e) for s, e in busy[c.id if c else None])]


# --- Public calendar API (used by the AI tools and REST endpoints) ---

def describe_catalog() -> str:
    """Plain-text summary of hours, services and staff for the AI system prompt."""
    cfg = get_schedule_settings()
    lines = [
        f"Appointment hours: {_day_names(cfg['working_days'])}, {cfg['open_time']}-{cfg['close_time']} (UTC), "
        f"start times every {cfg['slot_step_minutes']} minutes, at least {int(cfg['min_notice_minutes']) // 60} hours' notice."
    ]
    with Session(engine) as session:
        services = _active_services(session)
        staff = _active_staff(session)
        if services:
            lines.append("Bookable services:")
            for s in services:
                price = f", ${s.price:g}" if s.price is not None else ""
                lines.append(f"- {s.name} ({s.duration_minutes} min{price})")
        if staff:
            by_id = {s.id: s.name for s in services}
            lines.append("Team members:")
            for p in staff:
                ids = staff_service_ids(p)
                offers = ", ".join(by_id[i] for i in ids if i in by_id) if ids else "all services"
                role = f" ({p.role})" if p.role else ""
                lines.append(f"- {p.name}{role}: {offers}; works {_day_names(staff_working_days(p))}")
    return "\n".join(lines)

def check_calendar_availability(date_str: str, service_type: Optional[str] = None, staff_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Checks open start times on a date (YYYY-MM-DD) for a service, optionally with a specific
    team member. A time is open if at least one qualified team member is free for the whole duration.
    """
    cfg = get_schedule_settings()
    try:
        target = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return {
            "date": date_str,
            "available_slots": [],
            "status": "invalid_date",
            "message": f"'{date_str}' is not a valid date. Use the YYYY-MM-DD format."
        }
    target_date = target.isoformat()

    problem = _date_problem(target, cfg)
    if problem:
        return {"date": target_date, "available_slots": [], "status": "unavailable", "message": problem}

    with Session(engine) as session:
        service, error = _resolve_service(session, service_type)
        if error:
            return {"date": target_date, "available_slots": [], **error}
        duration = service.duration_minutes if service else int(cfg["default_duration_minutes"])

        candidates, error = _qualified_staff(session, target, service, staff_name)
        if error:
            return {"date": target_date, "available_slots": [], **error}

        busy = {c.id if c else None: _busy_intervals(session, target_date, c) for c in candidates}
        available, staff_by_slot = [], {}
        for start in _candidate_starts(target, duration, cfg):
            free = _free_staff_at(busy, candidates, start, start + duration)
            if free:
                hm = minutes_to_hm(start)
                available.append(hm)
                if free[0] is not None:
                    staff_by_slot[hm] = [p.name for p in free]

    label = service.name if service else "an appointment"
    result = {
        "date": target_date,
        "service": service.name if service else None,
        "duration_minutes": duration,
        "available_slots": available,
        "status": "success",
        "message": f"Found {len(available)} open start time(s) for {label} on {target_date} (times in UTC)."
    }
    if staff_by_slot:
        result["staff_by_slot"] = staff_by_slot
    return result

def book_calendar_appointment(
    conversation_id: str,
    visitor_name: str,
    date_str: str,
    time_str: str,
    service_type: Optional[str] = None,
    contact_info: Optional[str] = None,
    staff_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Books a service with a qualified, free team member and stores it in the database.
    Uses the requested team member if given, otherwise assigns the least-busy free one.
    """
    cfg = get_schedule_settings()
    try:
        target = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return {"status": "invalid_date", "date": date_str, "message": f"'{date_str}' is not a valid date. Use the YYYY-MM-DD format."}
    clean_date = target.isoformat()
    clean_time = _normalize_time(time_str)
    if not re.fullmatch(r"\d{2}:\d{2}", clean_time):
        return {"status": "invalid_time", "time": time_str, "message": f"'{time_str}' is not a valid time. Use HH:MM, e.g. 14:30."}

    problem = _date_problem(target, cfg)
    if problem:
        return {"status": "unavailable", "date": clean_date, "time": clean_time, "message": problem}

    with Session(engine) as session:
        services = _active_services(session)
        if services and not service_type:
            return {
                "status": "needs_service",
                "services": [s.name for s in services],
                "message": f"Which service would you like to book? Options: {', '.join(s.name for s in services)}."
            }
        service, error = _resolve_service(session, service_type)
        if error:
            return error
        duration = service.duration_minutes if service else int(cfg["default_duration_minutes"])
        start = hm_to_minutes(clean_time)

        if start not in _candidate_starts(target, duration, cfg):
            open_slots = check_calendar_availability(clean_date, service_type, staff_name).get("available_slots", [])
            return {
                "status": "invalid_time",
                "date": clean_date,
                "time": clean_time,
                "available_slots": open_slots,
                "message": (
                    f"{clean_time} isn't a bookable start time on {clean_date} "
                    f"(hours {cfg['open_time']}-{cfg['close_time']}, every {cfg['slot_step_minutes']} min, "
                    f"{int(cfg['min_notice_minutes']) // 60}h notice). Open times: {', '.join(open_slots) if open_slots else 'none'}."
                )
            }

        candidates, error = _qualified_staff(session, target, service, staff_name)
        if error:
            return error

        busy = {c.id if c else None: _busy_intervals(session, clean_date, c) for c in candidates}
        free = _free_staff_at(busy, candidates, start, start + duration)
        if not free:
            open_slots = check_calendar_availability(clean_date, service_type, staff_name).get("available_slots", [])
            who = f" with {candidates[0].name}" if staff_name and candidates and candidates[0] else ""
            return {
                "status": "conflict",
                "date": clean_date,
                "time": clean_time,
                "available_slots": open_slots,
                "message": f"{clean_time} on {clean_date}{who} is already taken. Open times: {', '.join(open_slots) if open_slots else 'none on this date'}."
            }

        # Spread work evenly: pick the free team member with the fewest bookings that day
        chosen = min(free, key=lambda c: len(busy[c.id if c else None]))
        booking = CalendarBooking(
            conversation_id=conversation_id,
            visitor_name=visitor_name,
            email_or_phone=contact_info,
            service_type=service.name if service else "Appointment",
            service_id=service.id if service else None,
            staff_id=chosen.id if chosen else None,
            staff_name=chosen.name if chosen else None,
            booking_date=clean_date,
            booking_time=clean_time,
            duration_minutes=duration,
            status="confirmed"
        )
        session.add(booking)
        session.commit()
        session.refresh(booking)

        with_whom = f" with {booking.staff_name}" if booking.staff_name else ""
        return {
            "status": "confirmed",
            "booking_id": booking.id,
            "visitor_name": booking.visitor_name,
            "service": booking.service_type,
            "staff": booking.staff_name,
            "date": booking.booking_date,
            "time": booking.booking_time,
            "duration_minutes": booking.duration_minutes,
            "message": f"Appointment #{booking.id}: {booking.service_type}{with_whom} on {booking.booking_date} at {booking.booking_time} (UTC)."
        }

def set_booking_status(booking_id: int, status: str) -> Dict[str, Any]:
    if status not in BOOKING_STATUSES:
        return {"status": "error", "message": f"Status must be one of: {', '.join(BOOKING_STATUSES)}"}
    with Session(engine) as session:
        booking = session.get(CalendarBooking, booking_id)
        if not booking:
            return {"status": "not_found", "message": f"Booking #{booking_id} was not found."}
        booking.status = status
        session.add(booking)
        session.commit()
        session.refresh(booking)
        return {"status": "updated", "booking": booking.model_dump(mode="json")}

def cancel_calendar_appointment(
    booking_id: Optional[int] = None,
    date_str: Optional[str] = None,
    time_str: Optional[str] = None,
    conversation_id: Optional[str] = None,
    visitor_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Cancels an existing appointment booking by ID, or by Date and Time.
    Frees up the slot on the calendar.
    """
    with Session(engine) as session:
        target_booking: Optional[CalendarBooking] = None

        if booking_id:
            target_booking = session.exec(
                select(CalendarBooking).where(CalendarBooking.id == booking_id)
            ).first()

        elif date_str and time_str:
            clean_time = _normalize_time(time_str)

            stmt = select(CalendarBooking).where(
                CalendarBooking.booking_date == date_str,
                CalendarBooking.booking_time == clean_time,
                CalendarBooking.status == "confirmed"
            )
            if conversation_id:
                # Prioritize matching this conversation
                match_conv = session.exec(stmt.where(CalendarBooking.conversation_id == conversation_id)).first()
                target_booking = match_conv or session.exec(stmt).first()
            else:
                target_booking = session.exec(stmt).first()

        elif date_str:
            stmt = select(CalendarBooking).where(
                CalendarBooking.booking_date == date_str,
                CalendarBooking.status == "confirmed"
            )
            if conversation_id:
                target_booking = session.exec(stmt.where(CalendarBooking.conversation_id == conversation_id)).first()
            if not target_booking:
                target_booking = session.exec(stmt).first()

        elif conversation_id:
            target_booking = session.exec(
                select(CalendarBooking)
                .where(CalendarBooking.conversation_id == conversation_id, CalendarBooking.status == "confirmed")
                .order_by(CalendarBooking.created_at.desc())
            ).first()

        if not target_booking:
            return {
                "status": "not_found",
                "message": f"No active confirmed booking found matching the criteria ({date_str or ''} {time_str or ''})."
            }

        target_booking.status = "cancelled"
        session.add(target_booking)
        session.commit()
        session.refresh(target_booking)

        return {
            "status": "cancelled",
            "booking_id": target_booking.id,
            "visitor_name": target_booking.visitor_name,
            "date": target_booking.booking_date,
            "time": target_booking.booking_time,
            "message": f"Appointment #{target_booking.id} for {target_booking.visitor_name} on {target_booking.booking_date} at {target_booking.booking_time} has been successfully cancelled."
        }

def delete_calendar_booking(booking_id: int) -> Dict[str, Any]:
    """
    Hard-deletes an appointment booking completely from SQLite database.
    """
    with Session(engine) as session:
        booking = session.exec(select(CalendarBooking).where(CalendarBooking.id == booking_id)).first()
        if not booking:
            return {"status": "not_found", "message": f"Booking #{booking_id} was not found."}
        session.delete(booking)
        session.commit()
        return {
            "status": "deleted",
            "booking_id": booking_id,
            "message": f"Appointment #{booking_id} has been permanently removed from the ledger."
        }

def trigger_human_handoff(conversation_id: str, reason: str = "Visitor requested human agent or issue requires escalation") -> Dict[str, Any]:
    """
    Triggers an agent handoff by switching conversation status to 'human_handover'.
    """
    with Session(engine) as session:
        statement = select(Conversation).where(Conversation.id == conversation_id)
        conv = session.exec(statement).first()
        if conv:
            conv.status = "human_handover"
            conv.updated_at = now_utc()
            session.add(conv)
            session.commit()
            return {
                "status": "handed_off",
                "conversation_id": conversation_id,
                "reason": reason,
                "message": "Conversation successfully handed off to human agent inbox."
            }
        return {"status": "not_found", "message": "Conversation not found"}

def check_business_hours() -> Dict[str, Any]:
    """
    Checks whether the current time is within the configured business hours (UTC).
    Follows Elqen Zero business hours gating pattern.
    """
    cfg = get_schedule_settings()
    now = datetime.now(timezone.utc)
    minutes = now.hour * 60 + now.minute
    is_open = now.weekday() in cfg["working_days"] and hm_to_minutes(cfg["open_time"]) <= minutes < hm_to_minutes(cfg["close_time"])
    schedule = f"{_day_names(cfg['working_days'])}, {cfg['open_time']} - {cfg['close_time']} UTC"

    return {
        "status": "open" if is_open else "closed",
        "current_time_utc": now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "business_schedule": schedule,
        "is_within_hours": is_open,
        "message": "We are open and our live team is standing by." if is_open else f"We are currently outside business hours ({schedule})."
    }

def apply_bot_pause_window(conversation_id: str, minutes: int = 30) -> Dict[str, Any]:
    """
    Sets the bot_paused_until timestamp to suppress automated AI responses while staff communicates.
    """
    with Session(engine) as session:
        statement = select(Conversation).where(Conversation.id == conversation_id)
        conv = session.exec(statement).first()
        if not conv:
            return {"status": "not_found", "message": "Conversation not found"}

        pause_until = now_utc() + timedelta(minutes=minutes)
        conv.bot_paused_until = pause_until
        conv.status = "human_handover"
        conv.updated_at = now_utc()
        session.add(conv)
        session.commit()

        return {
            "status": "bot_paused",
            "conversation_id": conversation_id,
            "paused_until": pause_until.isoformat(),
            "message": f"Automated bot replies paused for {minutes} minutes."
        }
