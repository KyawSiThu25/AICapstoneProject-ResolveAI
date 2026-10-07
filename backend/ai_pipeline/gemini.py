from typing import Any, List, Tuple

# Free-tier quotas are counted per model, so when the configured model is rate-limited
# (429), overloaded (503) or retired (404), the next model in this list is tried.
BACKUP_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]
RETRYABLE_CODES = {404, 429, 500, 503}


def model_chain(preferred: str) -> List[str]:
    chain = [preferred] if preferred else []
    return chain + [m for m in BACKUP_MODELS if m not in chain]


async def generate_with_fallback(client: Any, preferred_model: str, contents: Any, config: Any) -> Tuple[Any, str]:
    """Calls generate_content on the preferred model, falling back through BACKUP_MODELS. Returns (response, model_used)."""
    from google.genai import errors

    last_error: Exception = RuntimeError("No Gemini model configured")
    for model in model_chain(preferred_model):
        try:
            response = await client.aio.models.generate_content(model=model, contents=contents, config=config)
            return response, model
        except errors.APIError as e:
            last_error = e
            if e.code not in RETRYABLE_CODES:
                raise
            print(f"[Gemini] {model} unavailable ({e.code}). Trying next model.")
    raise last_error
