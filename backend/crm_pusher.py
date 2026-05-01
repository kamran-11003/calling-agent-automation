"""
crm_pusher.py — Push extracted lead data to external CRMs after a call.

Supported providers:
  hubspot     — HubSpot CRM (Contacts API v3)
  pipedrive   — Pipedrive (Persons + Deals API)
  airtable    — Airtable (any base/table via REST)
  salesforce  — Salesforce (REST API, requires instance URL + access token)
  webhook     — Generic HTTP POST (same as existing webhook but CRM-scoped)
  none        — Disabled
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from agent_tools import CrmIntegration

logger = logging.getLogger(__name__)

PUSH_TIMEOUT = 15  # seconds


async def push_lead_to_crm(
    crm: CrmIntegration,
    extracted_fields: dict[str, Any],
    call_summary: str,
    lead_score: str,
    outcome: str,
    phone_number: str,
) -> dict[str, Any]:
    """Push a lead to the configured CRM. Returns {success, provider, detail}."""
    if not crm.enabled or crm.provider == "none":
        return {"success": False, "provider": "none", "detail": "CRM not enabled"}

    # Apply field mapping: rename our keys to CRM keys
    mapped: dict[str, Any] = {}
    for our_field, value in extracted_fields.items():
        crm_field = crm.field_mapping.get(our_field, our_field)
        mapped[crm_field] = value

    # Always include meta fields
    mapped.setdefault("phone", phone_number)
    mapped["voiceflow_score"] = lead_score
    mapped["voiceflow_outcome"] = outcome
    mapped["voiceflow_summary"] = call_summary

    try:
        if crm.provider == "hubspot":
            return await _push_hubspot(crm, mapped)
        elif crm.provider == "pipedrive":
            return await _push_pipedrive(crm, mapped)
        elif crm.provider == "airtable":
            return await _push_airtable(crm, mapped)
        elif crm.provider == "salesforce":
            return await _push_salesforce(crm, mapped)
        elif crm.provider == "webhook":
            return await _push_webhook(crm, mapped)
        else:
            return {"success": False, "provider": crm.provider, "detail": "Unknown provider"}
    except Exception as e:
        logger.error(f"CRM push error ({crm.provider}): {e}")
        return {"success": False, "provider": crm.provider, "detail": str(e)[:200]}


# ──────────────────────────────────────────────────────────────
# HubSpot
# ──────────────────────────────────────────────────────────────

async def _push_hubspot(crm: CrmIntegration, fields: dict[str, Any]) -> dict:
    """Create or update a HubSpot contact."""
    # Map fields to HubSpot property format
    properties = {k: str(v) for k, v in fields.items() if v}

    # HubSpot standard field names
    for our, hs in [("name", "firstname"), ("email", "email"), ("phone", "phone")]:
        if our in properties and hs not in properties:
            val = properties.pop(our)
            if our == "name":
                parts = val.split(" ", 1)
                properties["firstname"] = parts[0]
                if len(parts) > 1:
                    properties["lastname"] = parts[1]
            else:
                properties[hs] = val

    payload = {"properties": properties}
    headers = {
        "Authorization": f"Bearer {crm.api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=PUSH_TIMEOUT) as client:
        resp = await client.post(
            "https://api.hubapi.com/crm/v3/objects/contacts",
            json=payload,
            headers=headers,
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            return {"success": True, "provider": "hubspot", "detail": f"Contact created: {data.get('id')}"}
        elif resp.status_code == 409:
            # Already exists — update
            existing_id = resp.json().get("message", "").split(":")[-1].strip()
            if existing_id:
                patch = await client.patch(
                    f"https://api.hubapi.com/crm/v3/objects/contacts/{existing_id}",
                    json=payload,
                    headers=headers,
                )
                return {"success": patch.status_code == 200, "provider": "hubspot", "detail": f"Contact updated: {existing_id}"}
        resp.raise_for_status()
        return {"success": False, "provider": "hubspot", "detail": resp.text[:200]}


# ──────────────────────────────────────────────────────────────
# Pipedrive
# ──────────────────────────────────────────────────────────────

async def _push_pipedrive(crm: CrmIntegration, fields: dict[str, Any]) -> dict:
    """Create a Pipedrive person + deal."""
    base = "https://api.pipedrive.com/v1"
    params = {"api_token": crm.api_key}

    name = fields.get("name") or fields.get("firstname", "Unknown Caller")
    phone = fields.get("phone", "")
    email = fields.get("email", "")

    async with httpx.AsyncClient(timeout=PUSH_TIMEOUT) as client:
        # Create person
        person_payload: dict[str, Any] = {"name": str(name)}
        if phone:
            person_payload["phone"] = [{"value": str(phone), "primary": True}]
        if email:
            person_payload["email"] = [{"value": str(email), "primary": True}]

        resp = await client.post(f"{base}/persons", params=params, json=person_payload)
        resp.raise_for_status()
        person_id = resp.json()["data"]["id"]

        # Create deal
        deal_payload: dict[str, Any] = {
            "title": f"Call Lead — {name}",
            "person_id": person_id,
            "status": "open",
        }
        if crm.pipeline_id:
            deal_payload["pipeline_id"] = int(crm.pipeline_id)

        deal_resp = await client.post(f"{base}/deals", params=params, json=deal_payload)
        deal_resp.raise_for_status()
        deal_id = deal_resp.json()["data"]["id"]

        return {"success": True, "provider": "pipedrive", "detail": f"Person {person_id} + Deal {deal_id} created"}


# ──────────────────────────────────────────────────────────────
# Airtable
# ──────────────────────────────────────────────────────────────

async def _push_airtable(crm: CrmIntegration, fields: dict[str, Any]) -> dict:
    """Append a row to an Airtable table.
    base_url format: base_id/table_name  e.g. appXXXXX/Leads
    """
    if "/" not in crm.base_url:
        return {"success": False, "provider": "airtable", "detail": "base_url must be 'baseId/TableName'"}

    base_id, table = crm.base_url.split("/", 1)
    url = f"https://api.airtable.com/v0/{base_id}/{table}"
    headers = {
        "Authorization": f"Bearer {crm.api_key}",
        "Content-Type": "application/json",
    }
    payload = {"fields": {k: str(v) for k, v in fields.items() if v}}

    async with httpx.AsyncClient(timeout=PUSH_TIMEOUT) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        record_id = resp.json().get("id")
        return {"success": True, "provider": "airtable", "detail": f"Record created: {record_id}"}


# ──────────────────────────────────────────────────────────────
# Salesforce
# ──────────────────────────────────────────────────────────────

async def _push_salesforce(crm: CrmIntegration, fields: dict[str, Any]) -> dict:
    """Create a Salesforce Lead. Requires instance_url in base_url and OAuth access_token in api_key."""
    instance_url = crm.base_url.rstrip("/")
    url = f"{instance_url}/services/data/v58.0/sobjects/Lead/"
    headers = {
        "Authorization": f"Bearer {crm.api_key}",
        "Content-Type": "application/json",
    }

    name = str(fields.get("name", "Unknown"))
    parts = name.split(" ", 1)
    payload: dict[str, Any] = {
        "FirstName": parts[0],
        "LastName": parts[1] if len(parts) > 1 else "Unknown",
        "Phone": str(fields.get("phone", "")),
        "Email": str(fields.get("email", "")),
        "Company": str(fields.get("company", "N/A")),
        "Description": str(fields.get("voiceflow_summary", "")),
        "LeadSource": "Voice AI",
        "Status": "Open",
    }
    # Add any extra mapped fields
    for k, v in fields.items():
        if k not in ("name", "phone", "email", "company", "voiceflow_summary") and v:
            payload[k] = str(v)

    async with httpx.AsyncClient(timeout=PUSH_TIMEOUT) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        sf_id = resp.json().get("id")
        return {"success": True, "provider": "salesforce", "detail": f"Lead created: {sf_id}"}


# ──────────────────────────────────────────────────────────────
# Generic webhook
# ──────────────────────────────────────────────────────────────

async def _push_webhook(crm: CrmIntegration, fields: dict[str, Any]) -> dict:
    """POST to a custom URL — useful for Zapier, Make, n8n."""
    if not crm.base_url:
        return {"success": False, "provider": "webhook", "detail": "No webhook URL configured"}

    headers = {"Content-Type": "application/json"}
    if crm.api_key:
        headers["Authorization"] = f"Bearer {crm.api_key}"

    async with httpx.AsyncClient(timeout=PUSH_TIMEOUT) as client:
        resp = await client.post(crm.base_url, json=fields, headers=headers)
        return {
            "success": resp.status_code < 400,
            "provider": "webhook",
            "detail": f"HTTP {resp.status_code}",
        }
