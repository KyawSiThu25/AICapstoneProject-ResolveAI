import os
import json
import time
from typing import Dict, Any, Optional
from dotenv import load_dotenv

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ai_settings.json")

load_dotenv(dotenv_path=ENV_PATH)
load_dotenv()

DEFAULT_AI_SETTINGS: Dict[str, Any] = {
    "provider": "google_gemini",
    # Shown in the visitor chat header and used by the AI; empty = inferred from the knowledge base
    "business_name": "",
    "model": "gemini-2.5-flash",
    "api_key": "",
    "temperature": 0.2,
    "max_output_tokens": 600,
    "system_instruction": (
        "You are the friendly AI customer support assistant for this business. "
        "Take the business name, services, prices and policies from the Company Knowledge.\n"
        "Use the provided Company Knowledge to answer customer questions accurately.\n"
        "If the information is not in the knowledge base, politely state that you do not know and offer to connect them to a human agent.\n"
        "Keep your answers concise, professional, and friendly."
    ),
    "bot_pause_duration_minutes": 30,
    "handoff_keywords": [
        "human", "agent", "representative", "real person", "person", "operator",
        "talk to someone", "customer service", "speak to a human", "live agent",
        "complaint", "frustrated", "manager"
    ],
    "rag_top_k": 2,
    "strict_grounding": True,
    "enable_calendar_tool": True
}

SCHEDULE_SETTINGS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "schedule_settings.json")

DEFAULT_SCHEDULE_SETTINGS: Dict[str, Any] = {
    "open_time": "09:00",
    "close_time": "18:00",
    "working_days": [0, 1, 2, 3, 4],  # Monday = 0 ... Sunday = 6
    "slot_step_minutes": 30,
    "min_notice_minutes": 120,
    "max_days_ahead": 30,
    "default_duration_minutes": 30,
}

def get_schedule_settings() -> Dict[str, Any]:
    settings = dict(DEFAULT_SCHEDULE_SETTINGS)
    if os.path.exists(SCHEDULE_SETTINGS_FILE):
        try:
            with open(SCHEDULE_SETTINGS_FILE, "r", encoding="utf-8") as f:
                settings.update(json.load(f))
        except Exception as e:
            print(f"[Settings] Error loading {SCHEDULE_SETTINGS_FILE}: {e}")
    return settings

def update_schedule_settings(updates: Dict[str, Any]) -> Dict[str, Any]:
    current = get_schedule_settings()
    for field in DEFAULT_SCHEDULE_SETTINGS:
        if field in updates and updates[field] is not None:
            current[field] = updates[field]
    with open(SCHEDULE_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current

def mask_api_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 12:
        return "********"
    return f"{key[:8]}...{key[-6:]}"

def get_raw_ai_settings() -> Dict[str, Any]:
    """Retrieve full settings dictionary including plaintext API key."""
    settings = dict(DEFAULT_AI_SETTINGS)
    
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                settings.update(saved)
        except Exception as e:
            print(f"[Settings] Error loading {SETTINGS_FILE}: {e}")

    # If api_key in settings is empty, check environment variable
    if not settings.get("api_key"):
        env_key = os.getenv("GEMINI_API_KEY", "")
        if env_key:
            settings["api_key"] = env_key

    return settings

def get_public_ai_settings() -> Dict[str, Any]:
    """Retrieve settings for UI with masked API key for security."""
    raw = get_raw_ai_settings()
    active_key = raw.get("api_key", "")
    public_dict = dict(raw)
    public_dict["api_key_masked"] = mask_api_key(active_key)
    public_dict["has_api_key"] = bool(active_key.strip())
    # Do not expose plaintext key to frontend
    del public_dict["api_key"]
    return public_dict

def update_ai_settings(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Persist updated AI settings and update .env if API key changed."""
    current = get_raw_ai_settings()

    new_api_key = updates.get("api_key")
    # If a new key is provided (not the masked "abcd1234...xyz" display value), update it
    if new_api_key and "..." not in new_api_key and new_api_key != "********":
        clean_key = new_api_key.strip()
        current["api_key"] = clean_key
        os.environ["GEMINI_API_KEY"] = clean_key
        
        # Persist to .env
        try:
            with open(ENV_PATH, "w", encoding="utf-8") as f:
                f.write(f"# Google AI Studio API Key\nGEMINI_API_KEY={clean_key}\n")
        except Exception as e:
            print(f"[Settings] Error writing to .env: {e}")

    # Copy allowed config fields
    allowed_fields = [
        "business_name", "model", "temperature", "max_output_tokens", "system_instruction",
        "bot_pause_duration_minutes", "handoff_keywords", "rag_top_k",
        "strict_grounding", "enable_calendar_tool"
    ]
    for field in allowed_fields:
        if field in updates:
            current[field] = updates[field]

    # Save to ai_settings.json
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
    except Exception as e:
        print(f"[Settings] Error saving {SETTINGS_FILE}: {e}")

    return get_public_ai_settings()

def test_gemini_connection(api_key: Optional[str] = None, model: Optional[str] = None) -> Dict[str, Any]:
    """Test Gemini API connection and latency."""
    raw = get_raw_ai_settings()
    key_to_use = (api_key.strip() if api_key and not "..." in api_key else "") or raw.get("api_key", "")
    model_to_use = model or raw.get("model", "gemini-2.5-flash")

    if not key_to_use:
        return {
            "success": False,
            "error": "No Gemini API Key provided or found in environment."
        }

    try:
        from google import genai
        start_time = time.time()
        client = genai.Client(api_key=key_to_use)
        response = client.models.generate_content(
            model=model_to_use,
            contents="Respond with only the single word: OK"
        )
        latency_ms = int((time.time() - start_time) * 1000)
        reply = (response.text or "").strip()

        return {
            "success": True,
            "latency_ms": latency_ms,
            "model": model_to_use,
            "reply": reply,
            "status": "Connected & Operational"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "model": model_to_use
        }
