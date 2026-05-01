"""
call_handler.py
Twilio webhook (TwiML) + WebSocket media stream handler.
One WebSocket connection = one active phone call.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
    DeepgramClientOptions,
)

from agent_config import AgentConfig, get_agent_by_phone
from pipeline import VoicePipeline
from lead_extractor import extract_lead
from crm_pusher import push_lead_to_crm
from database import get_db
from config import get_settings

logger = logging.getLogger(__name__)


def build_twiml_response(app_url: str, call_sid: str, outbound_contact_id: str = "") -> str:
    """Return TwiML that opens a WebSocket media stream back to our server."""
    ws_url = app_url.replace("https://", "wss://").replace("http://", "ws://")
    extra_param = ""
    if outbound_contact_id:
        extra_param = f'\n      <Parameter name="outbound_contact_id" value="{outbound_contact_id}"/>'
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="{ws_url}/ws/call/{call_sid}">
      <Parameter name="call_sid" value="{call_sid}"/>{extra_param}
    </Stream>
  </Connect>
</Response>"""


async def handle_call_websocket(websocket: WebSocket, call_sid: str) -> None:
    """
    Handles the full lifecycle of one call via Twilio Media Stream WebSocket.

    Protocol:
    - Twilio sends JSON messages: {"event": "start|media|stop", ...}
    - We send back JSON messages: {"event": "media", "streamSid": ..., "media": {"payload": <base64 mulaw>}}
    - Twilio also sends "mark" events we can use for sync
    """
    await websocket.accept()
    logger.info(f"[{call_sid}] WebSocket connected")

    config: AgentConfig | None = None
    pipeline: VoicePipeline | None = None
    stream_sid: str = ""
    to_number: str = ""
    deepgram_connection = None
    call_start_time = time.time()

    # Task for sending TTS audio back to Twilio
    send_task: asyncio.Task | None = None

    try:
        async for raw_message in websocket.iter_text():
            message = json.loads(raw_message)
            event = message.get("event")

            # ── START ──────────────────────────────────────────────────────
            if event == "start":
                stream_sid = message["streamSid"]
                start_data = message.get("start", {})
                to_number = start_data.get("to", "")
                from_number = start_data.get("from", "")

                logger.info(f"[{call_sid}] Stream started. To: {to_number} From: {from_number}")

                # Load agent config for this phone number
                config = get_agent_by_phone(to_number)
                if not config:
                    logger.warning(f"[{call_sid}] No agent found for {to_number} — using default")
                    await websocket.close()
                    return

                # For outbound campaigns: personalize greeting with contact name
                outbound_contact_id = start_data.get("customParameters", {}).get("outbound_contact_id", "")
                if outbound_contact_id:
                    try:
                        from database import get_supabase
                        db = get_supabase()
                        contact_resp = db.table("campaign_contacts").select("name, custom_fields").eq("id", outbound_contact_id).single().execute()
                        if contact_resp.data and contact_resp.data.get("name"):
                            contact_name = contact_resp.data["name"]
                            # Prepend contact name to greeting
                            original_greeting = config.call_flow.greeting or f"Hello! This is {config.persona_name}."
                            config.call_flow.greeting = original_greeting.replace("Hello!", f"Hello {contact_name}!").replace("Hi!", f"Hi {contact_name}!")
                            if contact_name not in config.call_flow.greeting:
                                config.call_flow.greeting = f"Hi {contact_name}! " + config.call_flow.greeting
                    except Exception as e:
                        logger.warning(f"[{call_sid}] Could not load outbound contact: {e}")

                # Init pipeline
                pipeline = VoicePipeline(config, call_sid)

                # Start Deepgram streaming STT
                deepgram_connection = await _start_deepgram(pipeline, config)

                # Start audio sender task
                send_task = asyncio.create_task(
                    _send_audio_loop(websocket, pipeline, stream_sid)
                )

                # Play greeting
                asyncio.create_task(pipeline.start_greeting())

            # ── MEDIA (incoming audio from caller) ─────────────────────────
            elif event == "media" and deepgram_connection and pipeline:
                payload_b64 = message["media"]["payload"]
                audio_chunk = base64.b64decode(payload_b64)
                # Feed raw mulaw audio to Deepgram
                await deepgram_connection.send(audio_chunk)

            # ── STOP ───────────────────────────────────────────────────────
            elif event == "stop":
                logger.info(f"[{call_sid}] Call ended")
                break

    except WebSocketDisconnect:
        logger.info(f"[{call_sid}] WebSocket disconnected")
    except Exception as e:
        logger.error(f"[{call_sid}] WebSocket error: {e}", exc_info=True)
    finally:
        # Cleanup
        if send_task:
            send_task.cancel()
        if deepgram_connection:
            try:
                await deepgram_connection.finish()
            except Exception:
                pass
        if pipeline:
            await pipeline.cleanup()
            # Post-call processing
            duration = int(time.time() - call_start_time)
            asyncio.create_task(
                _post_call_processing(pipeline, config, call_sid, to_number, duration)
            )


async def _start_deepgram(pipeline: VoicePipeline, config: AgentConfig):
    """Initialize Deepgram live transcription and wire callbacks to pipeline."""
    settings = get_settings()
    # Use agent's STT key if provided, otherwise fall back to a shared key in env
    dg_key = getattr(config, "stt_api_key", None) or settings.__dict__.get("deepgram_api_key", "")

    dg_client = DeepgramClient(dg_key, DeepgramClientOptions(options={"keepalive": "true"}))

    options = LiveOptions(
        model="nova-2-phonecall",
        language=config.language or "en",
        encoding="mulaw",
        sample_rate=8000,
        channels=1,
        punctuate=True,
        interim_results=True,
        endpointing=300,            # ms of silence to consider utterance complete
        smart_format=True,
        utterance_end_ms=1000,
    )

    connection = dg_client.listen.asyncwebsocket.v("1")

    async def on_transcript(self_dg, result, **kwargs):
        try:
            transcript = result.channel.alternatives[0].transcript
            is_final = result.is_final
            speech_final = result.speech_final

            if transcript and speech_final:
                # Barge-in: even on interim, interrupt agent if user speaks
                if pipeline.is_agent_speaking:
                    pipeline.interrupt_event.set()

            if transcript and is_final and speech_final:
                await pipeline.handle_user_speech(transcript)
        except Exception as e:
            logger.error(f"Deepgram callback error: {e}")

    async def on_utterance_end(self_dg, utterance_end, **kwargs):
        # Fallback: force processing if endpointing missed
        pass

    connection.on(LiveTranscriptionEvents.Transcript, on_transcript)
    connection.on(LiveTranscriptionEvents.UtteranceEnd, on_utterance_end)

    await connection.start(options)
    return connection


async def _send_audio_loop(
    websocket: WebSocket,
    pipeline: VoicePipeline,
    stream_sid: str,
) -> None:
    """Continuously pull audio chunks from pipeline and send to Twilio."""
    while True:
        chunk = await pipeline.audio_out_queue.get()
        if chunk is None:
            break
        payload = base64.b64encode(chunk).decode("utf-8")
        message = {
            "event": "media",
            "streamSid": stream_sid,
            "media": {"payload": payload},
        }
        try:
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error(f"Send audio error: {e}")
            break


async def _post_call_processing(
    pipeline: VoicePipeline,
    config: AgentConfig,
    call_sid: str,
    phone_number: str,
    duration: int,
) -> None:
    """Extract lead data and save call record after call ends."""
    try:
        logger.info(f"[{call_sid}] Running post-call processing")

        # Extract lead
        lead_data = await extract_lead(pipeline.full_transcript, config)

        # Build call record
        call_record = {
            "call_sid": call_sid,
            "agent_id": config.id,
            "phone_number": phone_number,
            "duration_seconds": duration,
            "transcript": pipeline.full_transcript,
            "lead_score": lead_data["lead_score"],
            "outcome": lead_data["outcome"],
            "summary": lead_data["summary"],
            "extracted_fields": lead_data["extracted_fields"],
            "status": "completed",
        }

        db = get_db()
        result = db.table("calls").insert(call_record).execute()
        saved_call = result.data[0] if result.data else {}

        logger.info(f"[{call_sid}] Call saved. Lead score: {lead_data['lead_score']}")

        # Fire webhook if configured
        if config.webhook_url:
            await _fire_webhook(config, saved_call, lead_data)

        # Push to CRM if configured
        if config.crm_integration and config.crm_integration.enabled:
            crm = config.crm_integration
            score = lead_data["lead_score"]
            should_push = (
                crm.trigger == "any"
                or (crm.trigger == "hot_warm" and score in ("hot", "warm"))
                or (crm.trigger == "hot_only" and score == "hot")
            )
            if should_push:
                crm_result = await push_lead_to_crm(
                    crm=crm,
                    extracted_fields=lead_data["extracted_fields"],
                    call_summary=lead_data["summary"],
                    lead_score=score,
                    outcome=lead_data["outcome"],
                    phone_number=phone_number,
                )
                logger.info(f"[{call_sid}] CRM push ({crm.provider}): {crm_result}")

    except Exception as e:
        logger.error(f"[{call_sid}] Post-call processing error: {e}", exc_info=True)


async def _fire_webhook(config: AgentConfig, call_record: dict, lead_data: dict) -> None:
    """POST lead data to the configured webhook URL with HMAC-SHA256 signature."""
    import httpx
    payload = {
        "event": "call.completed",
        "call_sid": call_record.get("call_sid"),
        "agent_id": config.id,
        "agent_name": config.name,
        "phone_number": call_record.get("phone_number"),
        "duration_seconds": call_record.get("duration_seconds"),
        "lead_score": lead_data["lead_score"],
        "outcome": lead_data["outcome"],
        "summary": lead_data["summary"],
        "extracted_fields": lead_data["extracted_fields"],
        "transcript": call_record.get("transcript", []),
    }

    body_bytes = json.dumps(payload, separators=(",", ":")).encode()
    headers: dict[str, str] = {"Content-Type": "application/json"}

    if config.webhook_secret:
        sig = hmac.new(
            config.webhook_secret.encode(),
            body_bytes,
            hashlib.sha256,
        ).hexdigest()
        headers["X-Signature-SHA256"] = f"sha256={sig}"

    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(config.webhook_url, content=body_bytes, headers=headers)
                if response.status_code < 500:
                    logger.info(f"Webhook fired: {response.status_code}")
                    return
                logger.warning(f"Webhook attempt {attempt + 1} got {response.status_code}")
        except Exception as e:
            logger.warning(f"Webhook attempt {attempt + 1} failed: {e}")
        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(2 ** attempt)  # exponential backoff
