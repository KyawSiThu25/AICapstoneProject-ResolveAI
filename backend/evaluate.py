"""
Evaluation script for the Resolve AI pipeline.

Runs a small test set through the real AI pipeline (retrieval, Gemini function calling,
tools, handoff) and scores retrieval, answer accuracy, refusals, tool use, handoff and latency.
Test conversations and bookings are tagged "eval_" and deleted at the end.

Usage (from backend/, with the venv active):  python evaluate.py
"""
import asyncio
import json
import statistics
import sys
import time
import warnings
from datetime import timedelta

warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8")

from sqlmodel import Session, select, delete

from database import engine, create_db_and_tables
from models import Conversation, Message, CalendarBooking, now_utc
from ai_pipeline.agent import run_agent_pipeline
from ai_pipeline.rag import query_knowledge

PAUSE_SECONDS = 4  # stay under the Gemini free-tier requests-per-minute limit


def next_weekday(offset_days: int = 1) -> str:
    d = now_utc().date() + timedelta(days=offset_days)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat()


def next_sunday() -> str:
    d = now_utc().date() + timedelta(days=1)
    while d.weekday() != 6:
        d += timedelta(days=1)
    return d.isoformat()


BOOK_DAY = next_weekday(2)

# category, question, expected document (retrieval), any-of expected phrases (answer), expected tool / outcome
TEST_SET = [
    {"cat": "factual", "q": "How much is a skin fade?", "doc": "Haircut & Grooming Services Menu", "facts": ["$35", "35"]},
    {"cat": "factual", "q": "What time do you open on Saturday?", "doc": "Opening Hours, Location & Booking", "facts": ["09:00", "9:00", "9am", "9 am", "9 a.m"]},
    {"cat": "factual", "q": "Do you sell anything for an itchy beard?", "doc": "Hair & Beard Products For Sale", "facts": ["beard oil", "Beard Oil", "balm", "Balm"]},
    {"cat": "factual", "q": "What happens if I'm not happy with my haircut?", "doc": "Cancellation, Late Arrival & Refund Policy", "facts": ["7 days", "seven days", "free", "fix"]},
    {"cat": "factual", "q": "Which barber is best for curly hair?", "doc": "Meet Our Barbers & Shop Story", "facts": ["Leo"]},
    {"cat": "out_of_scope", "q": "Do you do perms?"},
    {"cat": "out_of_scope", "q": "Can you dye my hair bright blue for a wedding?"},
    {"cat": "out_of_scope", "q": "Do you offer nail manicures?"},
    {"cat": "booking", "q": f"What times are free on {BOOK_DAY}?", "tool": "check_calendar_availability", "expect": "slots"},
    {"cat": "booking", "q": f"Please book me an appointment on {BOOK_DAY} at 10:00.", "tool": "book_calendar_appointment", "expect": "confirmed"},
    {"cat": "booking", "q": f"Can you book me on {next_sunday()} at 10:00?", "tool": None, "expect": "refused"},
    {"cat": "handoff", "q": "I want to speak with a real person please."},
    {"cat": "handoff", "q": "This is ridiculous, I'm frustrated, get me a manager."},
]

REFUSAL_PHRASES = ["don't have", "do not have", "don't know", "not sure", "not able", "unable", "no information",
                   "isn't something", "not something", "don't offer", "do not offer", "not offer", "not listed",
                   "can't find", "cannot find", "doesn't mention", "not mentioned", "team member", "human", "person"]


def tool_calls(result) -> list:
    tr = result.get("tool_result") or {}
    calls = tr.get("calls") if isinstance(tr, dict) else None
    if calls:
        return calls
    if result.get("tool_called") and result["tool_called"] != "rag_query":
        return [{"name": result["tool_called"], "result": tr}]
    return []


async def run_case(i: int, case: dict) -> dict:
    conv_id = f"eval_{int(time.time())}_{i}"
    with Session(engine) as s:
        s.add(Conversation(id=conv_id, visitor_name="Eval Visitor", status="ai_active"))
        s.add(Message(conversation_id=conv_id, sender="visitor", content=case["q"]))
        s.commit()

    retrieved = [h["metadata"]["title"] for h in query_knowledge(case["q"], 2)]
    start = time.perf_counter()
    result = await run_agent_pipeline(conv_id, "Eval Visitor", case["q"], "ai_active") or {}
    latency = time.perf_counter() - start
    reply = result.get("reply", "")
    calls = tool_calls(result)
    names = [c["name"] for c in calls]
    lower = reply.lower()

    row = {"cat": case["cat"], "q": case["q"], "reply": reply, "tools": names, "latency_s": round(latency, 2),
           "mode": result.get("mode"), "model": result.get("model")}
    if case["cat"] == "factual":
        row["retrieval_hit"] = case["doc"] in retrieved
        row["correct"] = any(f.lower() in lower for f in case["facts"])
    elif case["cat"] == "out_of_scope":
        row["correct"] = any(p in lower for p in REFUSAL_PHRASES) and "book_calendar_appointment" not in names
    elif case["cat"] == "booking":
        booked = any(c["name"] == "book_calendar_appointment" and (c.get("result") or {}).get("status") == "confirmed" for c in calls)
        if case["expect"] == "slots":
            row["correct"] = "check_calendar_availability" in names
        elif case["expect"] == "confirmed":
            row["correct"] = booked
        else:  # refused: nothing booked, and the reply explains it
            row["correct"] = not booked and any(w in lower for w in ["sunday", "closed", "monday", "friday", "not available", "unavailable"])
    elif case["cat"] == "handoff":
        row["correct"] = bool(result.get("handoff_triggered"))
    return row


def cleanup():
    with Session(engine) as s:
        s.exec(delete(CalendarBooking).where(CalendarBooking.conversation_id.like("eval_%")))
        s.exec(delete(Message).where(Message.conversation_id.like("eval_%")))
        s.exec(delete(Conversation).where(Conversation.id.like("eval_%")))
        s.commit()


async def main():
    create_db_and_tables()
    rows = []
    try:
        for i, case in enumerate(TEST_SET, 1):
            row = await run_case(i, case)
            rows.append(row)
            mark = "PASS" if row["correct"] else "FAIL"
            extra = f" retrieval={'hit' if row.get('retrieval_hit') else 'miss'}" if "retrieval_hit" in row else ""
            print(f"[{mark}] {i:>2}. ({row['cat']}) {row['q']}")
            print(f"        tools={row['tools'] or '-'}{extra} latency={row['latency_s']}s model={row['model'] or row['mode']}")
            print(f"        reply: {row['reply'][:160].replace(chr(10), ' ')}")
            await asyncio.sleep(PAUSE_SECONDS)
    finally:
        cleanup()

    def score(cat):
        r = [x for x in rows if x["cat"] == cat]
        return sum(x["correct"] for x in r), len(r)

    fact = [x for x in rows if x["cat"] == "factual"]
    hits = sum(x["retrieval_hit"] for x in fact)
    latencies = [x["latency_s"] for x in rows]
    summary = {
        "retrieval_hit_rate_at_2": f"{hits}/{len(fact)} ({100 * hits / len(fact):.0f}%)",
        "answer_accuracy_factual": "{}/{}".format(*score("factual")),
        "correct_refusals": "{}/{}".format(*score("out_of_scope")),
        "correct_tool_use_booking": "{}/{}".format(*score("booking")),
        "handoff_success": "{}/{}".format(*score("handoff")),
        "overall": f"{sum(x['correct'] for x in rows)}/{len(rows)}",
        "median_latency_s": round(statistics.median(latencies), 2),
    }
    print("\n=== SUMMARY ===")
    for k, v in summary.items():
        print(f"{k:28} {v}")
    with open("evaluation_results.json", "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "rows": rows}, f, indent=2, ensure_ascii=False)
    print("\nDetailed results saved to evaluation_results.json")


if __name__ == "__main__":
    asyncio.run(main())
