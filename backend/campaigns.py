"""
campaigns.py — Outbound campaign management & dialing engine
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
from datetime import datetime, time
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from database import get_db
from config import get_settings

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# Models (plain dicts / pydantic via main.py)
# ─────────────────────────────────────────────────────────────

def _default_campaign() -> dict[str, Any]:
    return {
        "name": "",
        "agent_id": None,
        "status": "draft",
        "schedule_start": None,
        "schedule_timezone": "America/New_York",
        "calling_hours_start": "09:00",
        "calling_hours_end": "17:00",
        "calling_days": ["mon", "tue", "wed", "thu", "fri"],
        "max_retries": 2,
        "retry_delay_hours": 4,
        "voicemail_drop_url": "",
        "dnc_numbers": [],
    }


# ─────────────────────────────────────────────────────────────
# CRUD helpers
# ─────────────────────────────────────────────────────────────

async def create_campaign(data: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    payload = {**_default_campaign(), **data}
    # Remove computed/read-only fields if present
    for f in ("id", "total_contacts", "called", "answered", "voicemail", "failed", "created_at", "updated_at"):
        payload.pop(f, None)
    resp = db.table("campaigns").insert(payload).execute()
    return resp.data[0]


async def list_campaigns() -> list[dict[str, Any]]:
    db = get_db()
    resp = db.table("campaigns").select("*").order("created_at", desc=True).execute()
    return resp.data or []


async def get_campaign(campaign_id: str) -> dict[str, Any] | None:
    db = get_db()
    resp = db.table("campaigns").select("*").eq("id", campaign_id).single().execute()
    return resp.data


async def update_campaign(campaign_id: str, data: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    data["updated_at"] = datetime.utcnow().isoformat()
    resp = db.table("campaigns").update(data).eq("id", campaign_id).execute()
    return resp.data[0]


async def delete_campaign(campaign_id: str) -> None:
    db = get_db()
    db.table("campaigns").delete().eq("id", campaign_id).execute()


# ─────────────────────────────────────────────────────────────
# Contact management
# ─────────────────────────────────────────────────────────────

def parse_csv_contacts(csv_bytes: bytes) -> list[dict[str, Any]]:
    """
    Parse a CSV file of contacts.
    Required column: phone (or Phone, phone_number, PhoneNumber, etc.)
    Optional: name (or Name, first_name, etc.)
    Any additional columns go into custom_fields.
    """
    text = csv_bytes.decode("utf-8-sig").strip()
    reader = csv.DictReader(io.StringIO(text))
    contacts: list[dict[str, Any]] = []

    PHONE_ALIASES = {"phone", "phone_number", "phonenumber", "mobile", "cell", "telephone", "number"}
    NAME_ALIASES = {"name", "full_name", "fullname", "contact_name", "first_name", "firstname"}

    for row in reader:
        # Normalize keys
        normalized: dict[str, str] = {k.strip().lower().replace(" ", "_"): v.strip() for k, v in row.items()}

        phone = ""
        for alias in PHONE_ALIASES:
            if alias in normalized and normalized[alias]:
                phone = normalized[alias]
                break
        if not phone:
            continue  # Skip rows with no phone

        # Clean phone number — keep digits, +, spaces, dashes, parens
        phone = "".join(c for c in phone if c in "0123456789+() -")
        if len(phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")) < 7:
            continue  # Too short to be real

        name = ""
        for alias in NAME_ALIASES:
            if alias in normalized and normalized[alias]:
                name = normalized[alias]
                break
        # Handle first_name + last_name
        if not name:
            fn = normalized.get("first_name", "") or normalized.get("firstname", "")
            ln = normalized.get("last_name", "") or normalized.get("lastname", "")
            if fn or ln:
                name = f"{fn} {ln}".strip()

        # Everything else goes to custom_fields
        skip = PHONE_ALIASES | NAME_ALIASES | {"last_name", "lastname"}
        custom = {k: v for k, v in normalized.items() if k not in skip and v}

        contacts.append({"phone": phone, "name": name, "custom_fields": custom})

    return contacts


async def import_contacts(campaign_id: str, contacts: list[dict[str, Any]]) -> int:
    """Bulk-insert contacts for a campaign. Returns count inserted."""
    if not contacts:
        return 0

    db = get_db()

    # Load campaign DNC list
    camp = await get_campaign(campaign_id)
    dnc_set: set[str] = set()
    if camp:
        dnc_set = {_normalize_phone(p) for p in (camp.get("dnc_numbers") or [])}

    rows = []
    for c in contacts:
        normalized = _normalize_phone(c["phone"])
        status = "dnc" if normalized in dnc_set else "pending"
        rows.append({
            "campaign_id": campaign_id,
            "phone": c["phone"],
            "name": c.get("name", ""),
            "custom_fields": c.get("custom_fields", {}),
            "status": status,
        })

    db.table("campaign_contacts").insert(rows).execute()

    # Update total_contacts counter
    total = db.table("campaign_contacts").select("id", count="exact").eq("campaign_id", campaign_id).execute()
    db.table("campaigns").update({"total_contacts": total.count or len(rows)}).eq("id", campaign_id).execute()

    return len(rows)


async def get_contacts(campaign_id: str, status: str | None = None, limit: int = 200, offset: int = 0) -> list[dict[str, Any]]:
    db = get_db()
    q = db.table("campaign_contacts").select("*").eq("campaign_id", campaign_id)
    if status:
        q = q.eq("status", status)
    resp = q.order("created_at").range(offset, offset + limit - 1).execute()
    return resp.data or []


def _normalize_phone(phone: str) -> str:
    """Strip all non-digit characters for DNC comparison."""
    return "".join(c for c in phone if c.isdigit())


# ─────────────────────────────────────────────────────────────
# Scheduling helpers
# ─────────────────────────────────────────────────────────────

_DAY_MAP = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _is_within_calling_hours(campaign: dict[str, Any]) -> bool:
    """Return True if the current time is within the campaign's calling window."""
    try:
        tz = ZoneInfo(campaign.get("schedule_timezone") or "America/New_York")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("America/New_York")

    now = datetime.now(tz)
    weekday = now.weekday()  # 0=Mon

    calling_days = campaign.get("calling_days") or ["mon", "tue", "wed", "thu", "fri"]
    allowed_days = {_DAY_MAP.get(d.lower(), -1) for d in calling_days}
    if weekday not in allowed_days:
        return False

    start_str = campaign.get("calling_hours_start") or "09:00"
    end_str = campaign.get("calling_hours_end") or "17:00"

    def parse_time(t: str) -> time:
        parts = t.split(":")
        return time(int(parts[0]), int(parts[1]))

    start_t = parse_time(start_str)
    end_t = parse_time(end_str)
    return start_t <= now.time() <= end_t


# ─────────────────────────────────────────────────────────────
# Dialing engine
# ─────────────────────────────────────────────────────────────

# Tracks running campaign background tasks: campaign_id -> asyncio.Task
_running_campaigns: dict[str, asyncio.Task] = {}


async def start_campaign(campaign_id: str) -> None:
    """Mark campaign as running and launch the background dialing task."""
    if campaign_id in _running_campaigns:
        return  # already running

    await update_campaign(campaign_id, {"status": "running"})
    task = asyncio.create_task(_dialing_loop(campaign_id))
    _running_campaigns[campaign_id] = task
    task.add_done_callback(lambda t: _running_campaigns.pop(campaign_id, None))


async def pause_campaign(campaign_id: str) -> None:
    """Pause a running campaign."""
    task = _running_campaigns.pop(campaign_id, None)
    if task and not task.done():
        task.cancel()
    await update_campaign(campaign_id, {"status": "paused"})


async def resume_campaign(campaign_id: str) -> None:
    """Resume a paused campaign."""
    await start_campaign(campaign_id)


async def cancel_campaign(campaign_id: str) -> None:
    """Cancel a campaign permanently."""
    task = _running_campaigns.pop(campaign_id, None)
    if task and not task.done():
        task.cancel()
    await update_campaign(campaign_id, {"status": "cancelled"})


async def _dialing_loop(campaign_id: str) -> None:
    """
    Background task: iterates through pending/retry contacts and initiates
    Twilio outbound calls respecting schedule, DNC, and retry rules.
    """
    settings = get_settings()
    db = get_db()
    logger.info(f"Campaign {campaign_id}: dialing loop started")

    try:
        while True:
            # Re-fetch campaign to get latest status / settings
            campaign = await get_campaign(campaign_id)
            if not campaign or campaign["status"] not in ("running",):
                logger.info(f"Campaign {campaign_id}: stopping loop (status={campaign and campaign['status']})")
                break

            # Check calling hours
            if not _is_within_calling_hours(campaign):
                logger.debug(f"Campaign {campaign_id}: outside calling hours, sleeping 60s")
                await asyncio.sleep(60)
                continue

            # Get agent info
            agent_id = campaign.get("agent_id")
            if not agent_id:
                logger.error(f"Campaign {campaign_id}: no agent_id set, pausing")
                await update_campaign(campaign_id, {"status": "paused"})
                break

            agent_resp = db.table("agents").select("*").eq("id", agent_id).single().execute()
            agent = agent_resp.data
            if not agent:
                logger.error(f"Campaign {campaign_id}: agent {agent_id} not found, pausing")
                await update_campaign(campaign_id, {"status": "paused"})
                break

            # Get Twilio credentials from agent
            from crypto import decrypt
            twilio_sid = agent.get("twilio_account_sid", "")
            twilio_auth_raw = agent.get("twilio_auth_token", "")
            phone_number = agent.get("phone_number", "")

            if not twilio_sid or not twilio_auth_raw or not phone_number:
                logger.error(f"Campaign {campaign_id}: agent missing Twilio credentials, pausing")
                await update_campaign(campaign_id, {"status": "paused"})
                break

            try:
                twilio_auth = decrypt(twilio_auth_raw)
            except Exception:
                twilio_auth = twilio_auth_raw

            # Find next pending contact
            pending = db.table("campaign_contacts") \
                .select("*") \
                .eq("campaign_id", campaign_id) \
                .eq("status", "pending") \
                .order("created_at") \
                .limit(1) \
                .execute()

            # Also check contacts ready for retry
            if not (pending.data):
                now_iso = datetime.utcnow().isoformat()
                retry_resp = db.table("campaign_contacts") \
                    .select("*") \
                    .eq("campaign_id", campaign_id) \
                    .eq("status", "failed") \
                    .lte("next_retry_at", now_iso) \
                    .lt("attempts", campaign.get("max_retries", 2) + 1) \
                    .order("next_retry_at") \
                    .limit(1) \
                    .execute()
                contacts_to_call = retry_resp.data or []
            else:
                contacts_to_call = pending.data or []

            if not contacts_to_call:
                # Check if all contacts are done
                remaining = db.table("campaign_contacts") \
                    .select("id", count="exact") \
                    .eq("campaign_id", campaign_id) \
                    .in_("status", ["pending", "failed"]) \
                    .execute()
                if (remaining.count or 0) == 0:
                    logger.info(f"Campaign {campaign_id}: all contacts processed, marking complete")
                    await update_campaign(campaign_id, {"status": "completed"})
                    break
                # Nothing ready yet, wait
                await asyncio.sleep(30)
                continue

            contact = contacts_to_call[0]

            # DNC check
            dnc_set = {_normalize_phone(p) for p in (campaign.get("dnc_numbers") or [])}
            if _normalize_phone(contact["phone"]) in dnc_set:
                db.table("campaign_contacts").update({"status": "dnc"}).eq("id", contact["id"]).execute()
                await asyncio.sleep(0.5)
                continue

            # Mark as calling
            db.table("campaign_contacts").update({
                "status": "calling",
                "attempts": contact.get("attempts", 0) + 1,
                "last_called_at": datetime.utcnow().isoformat(),
            }).eq("id", contact["id"]).execute()

            # Initiate Twilio call
            call_sid = await _make_outbound_call(
                contact=contact,
                agent=agent,
                campaign=campaign,
                twilio_sid=twilio_sid,
                twilio_auth=twilio_auth,
                from_number=phone_number,
                app_url=settings.app_url,
            )

            if call_sid:
                db.table("campaign_contacts").update({"call_sid": call_sid}).eq("id", contact["id"]).execute()
                db.table("campaigns").update({"called": campaign.get("called", 0) + 1}).eq("id", campaign_id).execute()
            else:
                # Failed to initiate call — schedule retry or mark failed
                attempts = contact.get("attempts", 0) + 1
                max_retries = campaign.get("max_retries", 2)
                retry_delay = campaign.get("retry_delay_hours", 4)
                if attempts <= max_retries:
                    from datetime import timedelta
                    next_retry = (datetime.utcnow() + timedelta(hours=retry_delay)).isoformat()
                    db.table("campaign_contacts").update({
                        "status": "failed",
                        "attempts": attempts,
                        "next_retry_at": next_retry,
                    }).eq("id", contact["id"]).execute()
                else:
                    db.table("campaign_contacts").update({"status": "failed"}).eq("id", contact["id"]).execute()
                    db.table("campaigns").update({"failed": campaign.get("failed", 0) + 1}).eq("id", campaign_id).execute()

            # Throttle: 1 call per 3 seconds to avoid Twilio rate limits
            await asyncio.sleep(3)

    except asyncio.CancelledError:
        logger.info(f"Campaign {campaign_id}: dialing loop cancelled")
    except Exception as e:
        logger.error(f"Campaign {campaign_id}: dialing loop error: {e}", exc_info=True)
        try:
            await update_campaign(campaign_id, {"status": "paused"})
        except Exception:
            pass


async def _make_outbound_call(
    contact: dict,
    agent: dict,
    campaign: dict,
    twilio_sid: str,
    twilio_auth: str,
    from_number: str,
    app_url: str,
) -> str | None:
    """
    Initiate a Twilio outbound call.
    Returns call SID on success, None on failure.
    The call will hit /twilio/inbound?outbound_contact_id=<id> when answered.
    """
    try:
        from twilio.rest import Client as TwilioClient
        client = TwilioClient(twilio_sid, twilio_auth)

        # Build TwiML URL — passes contact ID so the pipeline can personalize
        twiml_url = f"{app_url}/twilio/inbound?outbound_contact_id={contact['id']}"
        status_cb = f"{app_url}/twilio/outbound-status?contact_id={contact['id']}&campaign_id={campaign['id']}"

        call = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.calls.create(
                to=contact["phone"],
                from_=from_number,
                url=twiml_url,
                status_callback=status_cb,
                status_callback_method="POST",
                machine_detection="DetectMessageEnd",
                machine_detection_timeout=4,
            ),
        )
        logger.info(f"Outbound call initiated: {call.sid} → {contact['phone']}")
        return call.sid
    except Exception as e:
        logger.error(f"Failed to initiate call to {contact['phone']}: {e}")
        return None


# ─────────────────────────────────────────────────────────────
# Outbound status callback handler (called by Twilio)
# ─────────────────────────────────────────────────────────────

async def handle_outbound_status(
    contact_id: str,
    campaign_id: str,
    call_status: str,
    answered_by: str | None = None,
) -> None:
    """
    Handles Twilio's status callback for outbound calls.
    Updates contact and campaign counters.
    """
    db = get_db()

    contact_resp = db.table("campaign_contacts").select("*").eq("id", contact_id).single().execute()
    contact = contact_resp.data
    if not contact:
        return

    campaign_resp = db.table("campaigns").select("*").eq("id", campaign_id).single().execute()
    campaign = campaign_resp.data
    if not campaign:
        return

    # Map Twilio call status to our contact status
    # Twilio statuses: queued, ringing, in-progress, completed, busy, no-answer, canceled, failed
    if call_status in ("completed",):
        if answered_by in ("machine_end_beep", "machine_end_silence", "machine_end_other", "fax"):
            new_status = "voicemail"
            db.table("campaigns").update({"voicemail": campaign.get("voicemail", 0) + 1}).eq("id", campaign_id).execute()
        else:
            new_status = "answered"
            db.table("campaigns").update({"answered": campaign.get("answered", 0) + 1}).eq("id", campaign_id).execute()
    elif call_status in ("busy", "no-answer", "failed", "canceled"):
        attempts = contact.get("attempts", 0)
        max_retries = campaign.get("max_retries", 2)
        retry_delay = campaign.get("retry_delay_hours", 4)
        if attempts < max_retries:
            from datetime import timedelta
            next_retry = (datetime.utcnow() + timedelta(hours=retry_delay)).isoformat()
            db.table("campaign_contacts").update({
                "status": "failed",
                "next_retry_at": next_retry,
            }).eq("id", contact_id).execute()
            return
        else:
            new_status = "failed"
            db.table("campaigns").update({"failed": campaign.get("failed", 0) + 1}).eq("id", campaign_id).execute()
    else:
        return  # intermediate status, skip

    db.table("campaign_contacts").update({"status": new_status}).eq("id", contact_id).execute()
