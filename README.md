# Resolve AI

An AI customer-support platform for small businesses. Visitors chat on the business's website; an AI assistant answers from the business's own knowledge, books appointments with the right staff member, and hands the conversation to a human when needed. Staff watch every conversation live from an internal inbox and can take over at any time.

Built as an AI capstone project. Everything runs locally: **no Docker, Redis, Celery or external database servers**.

---

## Features

**Visitor chat** (port 5173)
- Full-page chat with real-time replies over WebSockets, with automatic reconnect and REST fallback
- Business name, greeting and suggested questions generated from the business's own knowledge base
- Sources shown under each AI answer; a banner when a team member takes over

**AI pipeline**
- **RAG with ChromaDB**: documents are split into overlapping ~120-word chunks, embedded locally, and retrieved per question. Only relevant documents are cited.
- **Gemini function calling**: the model decides when to check availability, book an appointment or escalate to a human. It sees the last 20 messages of the conversation.
- **Model fallback**: if the selected Gemini model is rate-limited or unavailable, the next model is tried automatically.
- **Rule-based fallback agent**: keeps RAG, booking and handoff working without an API key.
- **Strict grounding** (optional): the AI only answers from the knowledge base and offers a human otherwise.

**Human handoff**
- Explicit requests ("talk to a person") hand off immediately; the AI can also escalate via its handoff tool.
- **Bot pause window**: when staff reply or take over, the AI stays silent for a configurable time, then resumes automatically.

**Agent inbox** (port 5174)
- Live conversation list with filters (needs agent / AI active / resolved) and search
- Reply as staff, take over, return the chat to the AI, or resolve it
- Per-conversation audit of tools called and documents cited

**Calendar & scheduling** (in the agent inbox)
- **Schedule**: week view, plus a day view with one column per staff member. Each booking shows the time, service, staff member and customer. Click a booking to mark it completed or a no-show, or to cancel it.
- **Services**: name, duration and price
- **Staff**: role, working days and the services each person performs
- **Settings**: opening hours, bookable days, slot interval, minimum notice and booking horizon
- Bookings are assigned to a qualified staff member who is free for the whole service duration, with overlap checks per staff member.

**Business settings**
- Business name, AI persona, model, temperature, response length, handoff keywords, RAG top-k, bot pause duration and calendar tool on/off. All are editable from the inbox.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, WebSockets, SQLModel (SQLite) |
| AI | Google Gemini via `google-genai` (function calling, JSON output) |
| Vector store | ChromaDB (local persistent mode, built-in all-MiniLM-L6-v2 embeddings) |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, Lucide icons |

---

## Getting started

### Prerequisites
- Python 3.12+
- Node.js 20+
- A Google AI Studio API key: <https://aistudio.google.com/app/apikey> (optional; without it the rule-based agent is used)

### 1. Backend
```bash
cd backend
python -m venv venv

# Windows
.\venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt

# Add your Gemini API key (or paste it later in AI Settings)
cp .env.example .env        # Windows: copy .env.example .env

uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
API docs: <http://127.0.0.1:8000/docs>

On first start the backend creates `backend/data/` (SQLite database and ChromaDB store) and seeds five sample knowledge documents. Delete them from the Vector Store panel to start fresh; they won't come back.

### 2. Frontend
```bash
cd frontend
npm install
npm run dev:customer    # visitor chat     → http://127.0.0.1:5173
npm run dev:business    # agent inbox      → http://127.0.0.1:5174
```

### Windows shortcut
`start_servers.bat` starts the backend and both frontends in separate windows (after the setup above).

---

## Setting up a business

All of this is done from the agent inbox at <http://127.0.0.1:5174>:

1. **AI Settings → Persona & Grounding**: set the business name and adjust the persona.
2. **Vector Store → Ingest Document**: add knowledge such as services, prices, opening hours, policies and team bios. Long documents are chunked automatically.
3. **Calendar → Services**: add the bookable services with durations and prices.
4. **Calendar → Staff**: add team members, their working days and the services they offer.
5. **Calendar → Settings**: set opening hours and booking rules.

Then open <http://127.0.0.1:5173> and try:

| Ask | What it shows |
|---|---|
| A price or policy question | RAG answer with cited sources |
| "What times are free tomorrow?" | Calendar tool call |
| "Book a skin fade at 10:30 with Dani" | Booking with a specific staff member; appears on the schedule |
| Something not in the knowledge | Grounded "I don't know" plus an offer of a human |
| "I'd like to talk to a person" | Handoff; the conversation is flagged in the inbox |

---

## Project structure

```
backend/
  main.py                 FastAPI app: WebSockets, REST API, bot pause logic
  models.py               SQLModel tables: Conversation, Message, CalendarBooking, Service, StaffMember
  database.py             SQLite engine + lightweight column migrations
  ai_pipeline/
    agent.py              Gemini function-calling agent + rule-based fallback
    gemini.py             Model fallback chain
    rag.py                ChromaDB ingest (chunking), search, catalog
    tools.py              Scheduling engine: availability, booking, handoff
    suggestions.py        Business name, greeting and suggested questions
    settings.py           AI and schedule settings (JSON files)
frontend/src/
  components/
    CustomerApp.tsx       Visitor chat page (port 5173)
    ChatWidget.tsx        Chat UI, WebSocket client
    BusinessApp.tsx       Agent inbox shell (port 5174)
    AgentInbox.tsx        Conversation list, cockpit, inspector
    CalendarModal.tsx     Schedule, services, staff, settings
    KnowledgeBaseModal.tsx  Vector store management
    AiSettingsModal.tsx   AI & automation settings
.agents/skills/           Design references: inbox automation, calendar management, frontend design
```

---

## Key API endpoints

| Method | Path | Purpose |
|---|---|---|
| WS | `/ws/chat/{session_id}` | Visitor chat socket |
| WS | `/ws/agent` | Live feed for agent inboxes |
| GET | `/api/chat/intro` | Business name, greeting, suggested questions |
| GET | `/api/conversations` | Conversation list |
| POST | `/api/conversations/{id}/reply` | Staff reply (starts the bot pause window) |
| POST | `/api/conversations/{id}/resume-ai` | Hand the chat back to the AI |
| GET/POST/DELETE | `/api/knowledge` | Knowledge base documents |
| GET | `/api/calendar/availability` | Open times for a date, service, staff member |
| GET | `/api/calendar/bookings?start=&end=` | Bookings in a date range |
| POST | `/api/calendar/bookings/{id}/status` | Mark completed / no-show / cancelled |
| CRUD | `/api/services`, `/api/staff` | Booking catalog |
| GET/POST | `/api/schedule/settings`, `/api/settings/ai` | Settings |

Full interactive docs at `/docs` while the backend is running.

---

## Notes and limitations

- **Times are in UTC.** Opening hours and bookings are stored and shown in UTC.
- **Gemini free tier** has small per-minute and per-day quotas, and a tool-using reply can take 2–3 requests. The model fallback and rule-based agent keep the chat working when a quota runs out.
- **No authentication.** The agent inbox and settings API are open to anyone who can reach the backend. This is for local or demo use only.
- **Secrets.** The API key is stored in `backend/.env` and `backend/ai_settings.json`. Both are git-ignored; never commit them.
