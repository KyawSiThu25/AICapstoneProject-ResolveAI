import time
import hashlib
from typing import Dict, Any, List

from .rag import list_all_knowledge_docs
from .settings import get_raw_ai_settings
from .gemini import generate_with_fallback

# Generated intros are cached per knowledge/persona version so the Gemini free-tier
# quota is only spent when the business actually changes its knowledge.
_cache: Dict[str, Any] = {"key": None, "value": None, "expires": 0.0}
FALLBACK_TTL_SECONDS = 60

CALENDAR_PROMPT = "What times are free tomorrow?"
HUMAN_PROMPT = "I'd like to talk to a person"
DEFAULT_GREETING = "Hi there! Ask me anything, or I can book an appointment for you."


def _cache_key(docs: List[Dict[str, Any]], settings: Dict[str, Any]) -> str:
    parts = sorted(f"{d['id']}|{(d.get('metadata') or {}).get('title', '')}" for d in docs)
    parts.append(settings.get("system_instruction", ""))
    parts.append(settings.get("business_name", ""))
    parts.append(str(settings.get("enable_calendar_tool", True)))
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def _with_fixed_prompts(questions: List[str], settings: Dict[str, Any]) -> List[str]:
    prompts = [q for q in questions if q][:4]
    if settings.get("enable_calendar_tool", True):
        prompts.append(CALENDAR_PROMPT)
    prompts.append(HUMAN_PROMPT)
    return prompts


def _fallback_intro(docs: List[Dict[str, Any]], settings: Dict[str, Any]) -> Dict[str, Any]:
    titles = [(d.get("metadata") or {}).get("title") for d in docs]
    questions = [f"Tell me about {t[0].lower() + t[1:]}" for t in titles if t][:4]
    return {
        "business_name": "",
        "greeting": DEFAULT_GREETING,
        "suggestions": _with_fixed_prompts(questions, settings),
        "source": "fallback",
    }


async def _generate_with_gemini(api_key: str, docs: List[Dict[str, Any]], settings: Dict[str, Any]) -> Dict[str, Any]:
    from google import genai
    from google.genai import types

    knowledge = "\n\n".join(
        f"# {(d.get('metadata') or {}).get('title', 'Document')}\n{(d.get('content') or '')[:700]}"
        for d in docs
    )
    configured_name = (settings.get("business_name") or "").strip()
    name_hint = f"The business is called \"{configured_name}\". " if configured_name else ""
    prompt = (
        f"You are setting up the website chat widget for a business. {name_hint}Based on the business persona and "
        "knowledge base below, return:\n"
        "- business_name: the business's name if it is stated, otherwise an empty string\n"
        "- greeting: a warm 1-2 sentence welcome message from the business's AI assistant, mentioning what it can help with\n"
        "- questions: exactly 4 short questions (max 50 characters each) a first-time visitor would ask, "
        "each answerable from the knowledge base, covering different topics\n\n"
        f"=== PERSONA ===\n{settings.get('system_instruction', '')}\n\n=== KNOWLEDGE BASE ===\n{knowledge}"
    )
    client = genai.Client(api_key=api_key)
    response, _ = await generate_with_fallback(
        client,
        settings.get("model", "gemini-2.5-flash"),
        prompt,
        config=types.GenerateContentConfig(
            temperature=0.4,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            response_mime_type="application/json",
            response_schema=types.Schema(
                type="OBJECT",
                properties={
                    "business_name": types.Schema(type="STRING"),
                    "greeting": types.Schema(type="STRING"),
                    "questions": types.Schema(type="ARRAY", items=types.Schema(type="STRING")),
                },
                required=["business_name", "greeting", "questions"],
            ),
        ),
    )
    data = response.parsed if isinstance(response.parsed, dict) else {}
    questions = [q.strip() for q in data.get("questions", []) if isinstance(q, str) and q.strip()]
    if not questions:
        raise ValueError("Gemini returned no suggestions")
    return {
        "business_name": (data.get("business_name") or "").strip(),
        "greeting": (data.get("greeting") or "").strip() or DEFAULT_GREETING,
        "suggestions": _with_fixed_prompts(questions, settings),
        "source": "gemini",
    }


async def get_chat_intro() -> Dict[str, Any]:
    """Greeting, business name and quick-reply suggestions for the visitor chat, based on current knowledge."""
    settings = get_raw_ai_settings()
    docs = list_all_knowledge_docs()
    key = _cache_key(docs, settings)
    if _cache["key"] == key and time.time() < _cache["expires"]:
        return _cache["value"]

    configured_name = (settings.get("business_name") or "").strip()
    api_key = (settings.get("api_key") or "").strip()
    if docs and api_key:
        try:
            value = await _generate_with_gemini(api_key, docs, settings)
            # The name the business typed in always wins over the one inferred from knowledge
            if configured_name:
                value["business_name"] = configured_name
            _cache.update(key=key, value=value, expires=float("inf"))
            return value
        except Exception as e:
            print(f"[Suggestions] Gemini generation failed, using title-based suggestions: {e}")

    value = _fallback_intro(docs, settings)
    value["business_name"] = configured_name
    # Retry Gemini soon (e.g. after a rate limit) rather than caching the fallback forever
    _cache.update(key=key, value=value, expires=time.time() + FALLBACK_TTL_SECONDS)
    return value
