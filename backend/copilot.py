"""
copilot.py
AI Copilot endpoint — takes user message + current agent form state
→ returns a JSON patch to update the form fields + a chat reply.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from openai import AsyncOpenAI
from kb_manager import search_knowledge

logger = logging.getLogger(__name__)

COPILOT_SYSTEM_PROMPT = """You are an expert voice AI agent builder assistant inside a no-code platform.
Your job is to help users configure their calling agents through natural conversation.

When a user describes what they want, you:
1. Update the agent configuration fields to match their intent
2. Ask clarifying questions if needed
3. Suggest improvements

You respond with a JSON object containing:
- "message": Your conversational reply to the user (friendly, concise)
- "patch": An object with only the fields to update in the agent config. Use null to skip a field.

AGENT CONFIG FIELDS you can patch:
- name: agent name
- persona_name: the agent's first name (e.g. "Alex")
- persona_role: job title (e.g. "Sales Representative")
- persona_company: company name
- language: language code (e.g. "en", "es")
- voice_provider: "elevenlabs" | "cartesia" | "openai"
- llm_provider: "openai" | "anthropic"
- llm_model: model name
- instructions: detailed behavior instructions (plain text, can be long)
- goal: "collect_lead" | "book_appointment" | "qualify" | "survey" | "custom"
- max_call_duration_seconds: number
- call_flow.greeting: what agent says first
- call_flow.qualification: what questions to ask
- call_flow.objection_handling: how to handle pushback
- call_flow.goal_action: what to do when goal is reached
- call_flow.closing: how to end the call
- call_flow.fallback: what to say when confused
- lead_fields: array of {name, description} objects
- lead_scoring_rules: plain text rules for hot/warm/cold

RULES:
- Always return valid JSON
- Only include fields in patch that should change
- Be encouraging and concise in your message
- If asked to simulate, set "simulate": true in response and provide a mock_conversation array
- If asked to improve instructions, rewrite them completely in the patch

EXAMPLE:
User: "Create a real estate agent that qualifies buyers"
Response:
{
  "message": "Done! I've set up a real estate buyer qualification agent named Alex. I've filled in the call flow and lead fields. Want me to adjust the tone or add specific questions?",
  "patch": {
    "name": "Real Estate Buyer Agent",
    "persona_name": "Alex",
    "persona_role": "Real Estate Advisor",
    "goal": "qualify",
    "instructions": "You qualify potential home buyers by understanding their needs, budget, and timeline. Be warm and professional. Never pressure the caller.",
    "call_flow": {
      "greeting": "Hi! This is Alex from [Company]. I'm here to help you find your perfect home. Do you have a few minutes to chat?",
      "qualification": "Ask about: budget range, desired location, number of bedrooms, timeline to buy, pre-approval status.",
      "objection_handling": "If they say they're just browsing, say you understand and that you'd love to send them some options that match their needs.",
      "goal_action": "Once qualified, offer to schedule a property viewing or send a personalized list of properties.",
      "closing": "Thank them for their time and confirm next steps. Summarize what you'll send them.",
      "fallback": "I'm sorry, could you repeat that? I want to make sure I understand your needs correctly."
    },
    "lead_fields": [
      {"name": "name", "description": "Caller's full name"},
      {"name": "budget", "description": "Home buying budget"},
      {"name": "location", "description": "Preferred area or neighborhood"},
      {"name": "timeline", "description": "When they want to buy"},
      {"name": "bedrooms", "description": "Number of bedrooms needed"},
      {"name": "pre_approved", "description": "Whether they have mortgage pre-approval"}
    ],
    "lead_scoring_rules": "Hot: pre-approved and timeline within 3 months. Warm: interested but timeline 3-12 months. Cold: just browsing or no budget defined."
  }
}"""


def _get_llm_client_and_model(openai_api_key: str = "") -> tuple["AsyncOpenAI", str] | None:
    """
    Returns (AsyncOpenAI client, model name) using the best available key.
    Priority: platform OpenAI key > caller-provided key > platform Gemini key.
    Returns None if no key is available.
    """
    from config import get_settings
    settings = get_settings()

    # 1. OpenAI (platform or caller-provided)
    oai_key = settings.openai_api_key or openai_api_key
    if oai_key:
        return AsyncOpenAI(api_key=oai_key), "gpt-4o"

    # 2. Gemini via OpenAI-compatible endpoint
    gemini_key = settings.gemini_api_key
    if gemini_key:
        client = AsyncOpenAI(
            api_key=gemini_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
        return client, "gemini-3.1-flash-lite-preview"

    return None


async def run_copilot(
    user_message: str,
    current_config: dict[str, Any],
    conversation_history: list[dict],
    openai_api_key: str = "",  # kept for backward compat
) -> dict[str, Any]:
    """
    Runs the copilot LLM call. Uses OpenAI if available, otherwise falls back to Gemini.
    """
    llm = _get_llm_client_and_model(openai_api_key)
    if not llm:
        return {"message": "No AI key is configured. Please set OPENAI_API_KEY or GEMINI_API_KEY in the backend .env file.", "patch": {}}

    client, model = llm

    # Search app-level KB for relevant context
    system = COPILOT_SYSTEM_PROMPT
    try:
        app_kb_chunks = await search_knowledge(user_message, agent_id=None, limit=3)
        if app_kb_chunks:
            kb_context = "\n\n".join(app_kb_chunks)
            system += f"\n\nADDITIONAL CONTEXT FROM APP KNOWLEDGE BASE (use to fill agent config fields):\n{kb_context}"
    except Exception:
        pass

    messages = [
        {"role": "system", "content": system},
        {
            "role": "system",
            "content": f"Current agent config:\n{json.dumps(current_config, indent=2)}",
        },
        *conversation_history,
        {"role": "user", "content": user_message},
    ]

    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        response_format={"type": "json_object"},
        max_tokens=1500,
        temperature=0.4,
    )

    raw = response.choices[0].message.content or "{}"
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"message": "I had trouble processing that. Could you try again?", "patch": {}}

    # Ensure required fields exist
    result.setdefault("message", "")
    result.setdefault("patch", {})
    result.setdefault("simulate", False)
    result.setdefault("mock_conversation", [])

    return result


async def simulate_conversation(
    config: dict[str, Any],
    openai_api_key: str = "",
    scenario: str = "typical interested caller",
) -> list[dict[str, str]]:
    """
    Generate a mock conversation to let user preview agent behavior.
    Returns list of {role: "agent"|"user", text: str}
    """
    llm = _get_llm_client_and_model(openai_api_key)
    if not llm:
        return []
    client, model = llm

    prompt = f"""Simulate a realistic phone call conversation using the agent config below.
Scenario: {scenario}
Generate 6-10 turns (alternating agent/user).
Return a JSON array of objects with "role" ("agent" or "user") and "text" fields.

Agent config:
{json.dumps(config, indent=2)}"""

    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        max_tokens=1000,
        temperature=0.7,
    )

    raw = response.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
        # Handle both {"conversation": [...]} and direct array wrapping
        if isinstance(data, list):
            return data
        return data.get("conversation", data.get("messages", []))
    except Exception:
        return []
