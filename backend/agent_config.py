"""
Agent config — load/save agent configurations from Supabase.
API keys are encrypted at rest and decrypted only at call time.
"""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel
from database import get_db
from crypto import encrypt, decrypt
from agent_tools import AgentTool, CrmIntegration


class CallFlowStage(BaseModel):
    greeting: str = ""
    qualification: str = ""
    objection_handling: str = ""
    goal_action: str = ""
    closing: str = ""
    fallback: str = ""


class LeadField(BaseModel):
    name: str
    description: str


class AgentConfig(BaseModel):
    id: str | None = None
    name: str = ""
    persona_name: str = "Alex"
    persona_role: str = "Sales Representative"
    persona_company: str = ""
    language: str = "en"
    voice_provider: str = "elevenlabs"          # elevenlabs | cartesia | openai
    voice_id: str = ""                           # provider-specific voice id
    stt_provider: str = "deepgram"              # deepgram | whisper
    llm_provider: str = "openai"                # openai | anthropic | groq
    llm_model: str = "gpt-4o"
    llm_api_key_encrypted: str = ""
    tts_api_key_encrypted: str = ""
    instructions: str = ""
    goal: str = "collect_lead"                  # collect_lead | book_appointment | qualify | survey | customer_support | ivr_routing | reminder | custom
    max_call_duration_seconds: int = 300
    fallback_message: str = "I'm sorry, I'm having trouble understanding. Let me connect you with someone who can help."
    call_flow: CallFlowStage = CallFlowStage()
    lead_fields: list[LeadField] = []
    lead_scoring_rules: str = ""
    webhook_url: str = ""
    webhook_secret: str = ""
    phone_number: str = ""                      # Twilio number assigned to this agent
    twilio_account_sid_encrypted: str = ""     # per-agent Twilio Account SID
    twilio_auth_token_encrypted: str = ""      # per-agent Twilio Auth Token
    knowledge_base: str = ""                   # company/product info injected into every call
    agent_tools: list[AgentTool] = []          # HTTP tools the agent can call during conversations
    crm_integration: CrmIntegration = CrmIntegration()  # post-call CRM push config
    enabled: bool = True


def save_agent(config: AgentConfig) -> AgentConfig:
    db = get_db()
    data = config.model_dump(exclude={"id"})
    # Encrypt API keys before storing
    if config.llm_api_key_encrypted and not config.llm_api_key_encrypted.startswith("gAAA"):
        data["llm_api_key_encrypted"] = encrypt(config.llm_api_key_encrypted)
    if config.tts_api_key_encrypted and not config.tts_api_key_encrypted.startswith("gAAA"):
        data["tts_api_key_encrypted"] = encrypt(config.tts_api_key_encrypted)
    if config.twilio_account_sid_encrypted and not config.twilio_account_sid_encrypted.startswith("gAAA"):
        data["twilio_account_sid_encrypted"] = encrypt(config.twilio_account_sid_encrypted)
    if config.twilio_auth_token_encrypted and not config.twilio_auth_token_encrypted.startswith("gAAA"):
        data["twilio_auth_token_encrypted"] = encrypt(config.twilio_auth_token_encrypted)
    # Encrypt CRM api_key before storing
    crm = config.crm_integration
    if crm.api_key and not crm.api_key.startswith("gAAA"):
        data["crm_integration"]["api_key"] = encrypt(crm.api_key)

    # Supabase upsert
    if config.id:
        result = db.table("agents").update(data).eq("id", config.id).execute()
        row = result.data[0]
    else:
        result = db.table("agents").insert(data).execute()
        row = result.data[0]

    return _row_to_config(row)


def get_agent_by_id(agent_id: str) -> AgentConfig | None:
    db = get_db()
    result = db.table("agents").select("*").eq("id", agent_id).single().execute()
    if not result.data:
        return None
    return _row_to_config(result.data)


def get_agent_by_phone(phone_number: str) -> AgentConfig | None:
    """Load agent config keyed by the Twilio phone number — called at inbound call start."""
    db = get_db()
    result = db.table("agents").select("*").eq("phone_number", phone_number).eq("enabled", True).limit(1).execute()
    if not result.data:
        return None
    return _row_to_config(result.data[0])


def list_agents() -> list[dict[str, Any]]:
    db = get_db()
    result = db.table("agents").select("id, name, phone_number, goal, enabled, created_at").order("created_at", desc=True).execute()
    return result.data or []


def _row_to_config(row: dict[str, Any]) -> AgentConfig:
    config = AgentConfig(**row)
    # Decrypt keys for in-memory use
    if config.llm_api_key_encrypted:
        try:
            config.llm_api_key_encrypted = decrypt(config.llm_api_key_encrypted)
        except Exception:
            pass
    if config.tts_api_key_encrypted:
        try:
            config.tts_api_key_encrypted = decrypt(config.tts_api_key_encrypted)
        except Exception:
            pass
    if config.twilio_account_sid_encrypted:
        try:
            config.twilio_account_sid_encrypted = decrypt(config.twilio_account_sid_encrypted)
        except Exception:
            pass
    if config.twilio_auth_token_encrypted:
        try:
            config.twilio_auth_token_encrypted = decrypt(config.twilio_auth_token_encrypted)
        except Exception:
            pass
    # Decrypt CRM api_key
    if config.crm_integration.api_key:
        try:
            config.crm_integration.api_key = decrypt(config.crm_integration.api_key)
        except Exception:
            pass
    return config
