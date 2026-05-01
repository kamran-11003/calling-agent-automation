"""
main.py — FastAPI application entrypoint
Routes:
  POST /twilio/inbound          — Twilio voice webhook (returns TwiML)
  WS   /ws/call/{call_sid}      — Twilio Media Stream WebSocket
  POST /api/agents              — Create/update agent
  GET  /api/agents              — List agents
  GET  /api/agents/{id}         — Get agent
  DELETE /api/agents/{id}       — Delete agent
  POST /api/copilot             — Copilot chat
  POST /api/copilot/simulate    — Simulate conversation
  POST /api/voice/preview       — TTS voice preview
  GET  /api/calls               — List calls (dashboard)
  GET  /api/calls/{id}          — Get call detail + transcript
  PATCH /api/calls/{id}/status  — Update lead status
  GET  /api/calls/export        — Export CSV
  POST /api/knowledge/upload    — Upload KB document
  GET  /api/knowledge           — List KB documents
  DELETE /api/knowledge/{id}    — Delete KB document
"""
# Note: No `from __future__ import annotations` — needed for slowapi + FastAPI to resolve type hints correctly

import csv
import io
import logging
import uuid
from typing import Any, Optional

import httpx
from fastapi import FastAPI, Request, WebSocket, HTTPException, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from agent_config import AgentConfig, save_agent, get_agent_by_id, list_agents
from call_handler import build_twiml_response, handle_call_websocket
from copilot import run_copilot, simulate_conversation
from database import get_db
from config import get_settings
from kb_manager import upload_document, search_knowledge, list_documents, delete_document
import campaigns as campaign_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)

# ─── Rate limiter ────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Voice AI Platform API", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ─── CORS ────────────────────────────────────────────────────
_settings = get_settings()
_raw_origins = _settings.allowed_origins or ""
_allowed_origins: list[str] = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else ["http://localhost:3000", "http://127.0.0.1:3000"]
)
# In development, always allow localhost
if _settings.environment == "development":
    _allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)


# ─── Request ID middleware ────────────────────────────────────
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# ─────────────────────────────────────────────────────────────
# Twilio Webhook
# ─────────────────────────────────────────────────────────────

@app.post("/twilio/inbound", response_class=PlainTextResponse)
async def twilio_inbound(request: Request):
    """Twilio calls this when an inbound (or outbound-answered) call arrives. Returns TwiML."""
    form = await request.form()
    call_sid = str(form.get("CallSid", "unknown"))
    # Sanitize call_sid — only alphanumeric and underscores
    if not call_sid.replace("_", "").isalnum():
        call_sid = "unknown"
    # For outbound campaigns, pass the contact_id through the stream so the pipeline
    # can personalize the greeting with the contact's name
    outbound_contact_id = request.query_params.get("outbound_contact_id", "")
    settings = get_settings()
    twiml = build_twiml_response(settings.app_url, call_sid, outbound_contact_id=outbound_contact_id)
    logger.info(f"Inbound call: {call_sid} (outbound_contact_id={outbound_contact_id or 'none'})")
    return PlainTextResponse(content=twiml, media_type="application/xml")


# ─────────────────────────────────────────────────────────────
# WebSocket — Twilio Media Stream
# ─────────────────────────────────────────────────────────────

@app.websocket("/ws/call/{call_sid}")
async def call_websocket(websocket: WebSocket, call_sid: str):
    await handle_call_websocket(websocket, call_sid)


# ─────────────────────────────────────────────────────────────
# Agent CRUD
# ─────────────────────────────────────────────────────────────

@app.get("/api/agents")
async def api_list_agents():
    return list_agents()


@app.get("/api/agents/{agent_id}")
async def api_get_agent(agent_id: str):
    agent = get_agent_by_id(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    # Mask sensitive keys in response
    data = agent.model_dump()
    for key in ("llm_api_key_encrypted", "tts_api_key_encrypted", "twilio_account_sid_encrypted", "twilio_auth_token_encrypted"):
        if data.get(key):
            data[key] = "••••••••"
    if data.get("crm_integration", {}).get("api_key"):
        data["crm_integration"]["api_key"] = "••••••••"
    return data


@app.post("/api/agents")
@limiter.limit("30/minute")
async def api_save_agent(request: Request, config: AgentConfig):
    # Validate input lengths
    if len(config.instructions) > 10_000:
        raise HTTPException(status_code=400, detail="Instructions too long (max 10,000 chars)")
    if len(config.name) > 200:
        raise HTTPException(status_code=400, detail="Name too long")
    if config.max_call_duration_seconds < 30 or config.max_call_duration_seconds > 3600:
        raise HTTPException(status_code=400, detail="max_call_duration_seconds must be 30-3600")
    saved = save_agent(config)
    return {"id": saved.id, "message": "Agent saved successfully"}


@app.delete("/api/agents/{agent_id}")
async def api_delete_agent(agent_id: str):
    db = get_db()
    db.table("agents").delete().eq("id", agent_id).execute()
    return {"message": "Agent deleted"}


# ─────────────────────────────────────────────────────────────
# Copilot
# ─────────────────────────────────────────────────────────────

class CopilotRequest(BaseModel):
    message: str
    current_config: dict[str, Any] = {}
    conversation_history: list[dict] = []
    openai_api_key: str = ""  # ignored — platform key is used

    @field_validator("message")
    @classmethod
    def message_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message cannot be empty")
        return v[:4000]  # hard cap


class SimulateRequest(BaseModel):
    config: dict[str, Any]
    scenario: str = "typical interested caller"
    openai_api_key: str = ""  # ignored — platform key is used


@app.post("/api/copilot")
@limiter.limit("20/minute")
async def api_copilot(request: Request, body: CopilotRequest):
    result = await run_copilot(
        user_message=body.message,
        current_config=body.current_config,
        conversation_history=body.conversation_history,
        openai_api_key=body.openai_api_key,
    )
    return result


@app.post("/api/copilot/simulate")
@limiter.limit("10/minute")
async def api_simulate(request: Request, body: SimulateRequest):
    conversation = await simulate_conversation(
        config=body.config,
        openai_api_key=body.openai_api_key,
        scenario=body.scenario,
    )
    return {"conversation": conversation}


# ─────────────────────────────────────────────────────────────
# Voice Preview
# ─────────────────────────────────────────────────────────────

class VoicePreviewRequest(BaseModel):
    voice_provider: str
    voice_id: str
    tts_api_key: str
    text: str = "Hi there! I'm Alex, your AI assistant. How can I help you today?"


@app.post("/api/voice/preview")
@limiter.limit("10/minute")
async def api_voice_preview(request: Request, body: VoicePreviewRequest):
    """Returns audio/mpeg stream for voice preview in the UI."""
    if body.voice_provider == "elevenlabs":
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{body.voice_id}"
        headers = {"xi-api-key": body.tts_api_key, "Content-Type": "application/json"}
        payload = {
            "text": body.text[:500],
            "model_id": "eleven_turbo_v2_5",
            "output_format": "mp3_44100_128",
        }
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            return StreamingResponse(
                iter([response.content]),
                media_type="audio/mpeg",
            )
    raise HTTPException(status_code=400, detail=f"Preview not supported for {body.voice_provider}")


# ─────────────────────────────────────────────────────────────
# Dashboard — Calls
# ─────────────────────────────────────────────────────────────

@app.get("/api/calls")
async def api_list_calls(
    agent_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    db = get_db()
    query = db.table("calls").select(
        "id, call_sid, agent_id, phone_number, duration_seconds, lead_score, outcome, summary, status, created_at"
    ).order("created_at", desc=True).range(offset, offset + limit - 1)

    if agent_id:
        query = query.eq("agent_id", agent_id)

    result = query.execute()
    return result.data or []


@app.get("/api/calls/export")
async def api_export_calls(agent_id: str | None = Query(None)):
    db = get_db()
    query = db.table("calls").select("*").order("created_at", desc=True).limit(5000)
    if agent_id:
        query = query.eq("agent_id", agent_id)
    result = query.execute()
    calls = result.data or []

    output = io.StringIO()
    if calls:
        # Flatten extracted_fields into columns
        all_field_keys: set[str] = set()
        for call in calls:
            all_field_keys.update((call.get("extracted_fields") or {}).keys())

        base_cols = ["call_sid", "phone_number", "duration_seconds", "lead_score", "outcome", "summary", "status", "created_at"]
        fieldnames = base_cols + sorted(all_field_keys)

        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for call in calls:
            row = {k: call.get(k) for k in base_cols}
            row.update(call.get("extracted_fields") or {})
            writer.writerow(row)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leads.csv"},
    )


@app.get("/api/calls/{call_id}")
async def api_get_call(call_id: str):
    db = get_db()
    result = db.table("calls").select("*").eq("id", call_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Call not found")
    return result.data


class UpdateCallStatus(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        allowed = {"hot", "warm", "cold", "converted", "rejected", "completed"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v


@app.patch("/api/calls/{call_id}/status")
async def api_update_call_status(call_id: str, body: UpdateCallStatus):
    db = get_db()
    db.table("calls").update({"status": body.status}).eq("id", call_id).execute()
    return {"message": "Status updated"}


# ─────────────────────────────────────────────────────────────
# Knowledge Base
# ─────────────────────────────────────────────────────────────

MAX_KB_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@app.post("/api/knowledge/upload")
@limiter.limit("20/minute")
async def api_kb_upload(
    request: Request,
    file: UploadFile = File(...),
    agent_id: str | None = Form(None),
):
    """Upload a PDF or text file and embed it into the knowledge base."""
    contents = await file.read()
    if len(contents) > MAX_KB_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
    filename = file.filename or "untitled"
    # Validate extension
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("pdf", "txt", "md"):
        raise HTTPException(status_code=400, detail="Only PDF, TXT, and MD files are supported")
    try:
        result = await upload_document(contents, filename, agent_id or None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@app.get("/api/knowledge")
async def api_kb_list(agent_id: str | None = Query(None)):
    """List uploaded knowledge base documents for an agent or the app-level KB."""
    return list_documents(agent_id or None)


@app.delete("/api/knowledge/{doc_id}")
async def api_kb_delete(doc_id: str):
    delete_document(doc_id)
    return {"message": "Document deleted"}


# ─────────────────────────────────────────────────────────────
# Outbound Campaigns
# ─────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str
    agent_id: Optional[str] = None
    schedule_start: Optional[str] = None
    schedule_timezone: str = "America/New_York"
    calling_hours_start: str = "09:00"
    calling_hours_end: str = "17:00"
    calling_days: list[str] = ["mon", "tue", "wed", "thu", "fri"]
    max_retries: int = 2
    retry_delay_hours: int = 4
    voicemail_drop_url: str = ""
    dnc_numbers: list[str] = []


@app.get("/api/campaigns")
async def api_list_campaigns():
    return await campaign_engine.list_campaigns()


@app.post("/api/campaigns", status_code=201)
async def api_create_campaign(data: CampaignCreate):
    return await campaign_engine.create_campaign(data.model_dump())


@app.get("/api/campaigns/{campaign_id}")
async def api_get_campaign(campaign_id: str):
    c = await campaign_engine.get_campaign(campaign_id)
    if not c:
        raise HTTPException(404, "Campaign not found")
    return c


@app.patch("/api/campaigns/{campaign_id}")
async def api_update_campaign(campaign_id: str, data: dict):
    return await campaign_engine.update_campaign(campaign_id, data)


@app.delete("/api/campaigns/{campaign_id}", status_code=204)
async def api_delete_campaign(campaign_id: str):
    await campaign_engine.cancel_campaign(campaign_id)
    await campaign_engine.delete_campaign(campaign_id)


@app.post("/api/campaigns/{campaign_id}/start")
async def api_start_campaign(campaign_id: str):
    c = await campaign_engine.get_campaign(campaign_id)
    if not c:
        raise HTTPException(404, "Campaign not found")
    await campaign_engine.start_campaign(campaign_id)
    return {"status": "running"}


@app.post("/api/campaigns/{campaign_id}/pause")
async def api_pause_campaign(campaign_id: str):
    await campaign_engine.pause_campaign(campaign_id)
    return {"status": "paused"}


@app.post("/api/campaigns/{campaign_id}/resume")
async def api_resume_campaign(campaign_id: str):
    await campaign_engine.resume_campaign(campaign_id)
    return {"status": "running"}


@app.post("/api/campaigns/{campaign_id}/cancel")
async def api_cancel_campaign(campaign_id: str):
    await campaign_engine.cancel_campaign(campaign_id)
    return {"status": "cancelled"}


@app.post("/api/campaigns/{campaign_id}/contacts/upload", status_code=201)
async def api_upload_contacts(campaign_id: str, file: UploadFile = File(...)):
    c = await campaign_engine.get_campaign(campaign_id)
    if not c:
        raise HTTPException(404, "Campaign not found")
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only CSV files are supported")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(413, "CSV too large (5MB max)")
    contacts = campaign_engine.parse_csv_contacts(contents)
    if not contacts:
        raise HTTPException(400, "No valid contacts found in CSV. Ensure a 'phone' column exists.")
    count = await campaign_engine.import_contacts(campaign_id, contacts)
    return {"imported": count}


@app.get("/api/campaigns/{campaign_id}/contacts")
async def api_get_contacts(
    campaign_id: str,
    status: Optional[str] = Query(None),
    limit: int = Query(200, le=500),
    offset: int = Query(0),
):
    return await campaign_engine.get_contacts(campaign_id, status=status, limit=limit, offset=offset)


@app.post("/twilio/outbound-status")
async def twilio_outbound_status(
    request: Request,
    contact_id: str = Query(...),
    campaign_id: str = Query(...),
):
    """Twilio status callback for outbound calls."""
    form = await request.form()
    call_status = form.get("CallStatus", "")
    answered_by = form.get("AnsweredBy") or None
    await campaign_engine.handle_outbound_status(contact_id, campaign_id, call_status, answered_by)
    return PlainTextResponse("")


# ─────────────────────────────────────────────────────────────
# Health check
# ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=settings.environment == "development")
