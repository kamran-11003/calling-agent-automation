"""
lead_extractor.py
Post-call: send transcript to LLM with function calling → extract structured lead data.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from openai import AsyncOpenAI
from anthropic import AsyncAnthropic
from agent_config import AgentConfig, LeadField

logger = logging.getLogger(__name__)


async def extract_lead(
    transcript: list[dict],
    config: AgentConfig,
) -> dict[str, Any]:
    """
    Returns a dict with:
      - extracted_fields: {field_name: value, ...}
      - lead_score: "hot" | "warm" | "cold"
      - summary: one-line call summary
      - outcome: "interested" | "not_interested" | "booked" | "voicemail" | "unknown"
    """
    if not transcript:
        return _empty_result()

    transcript_text = "\n".join(
        f"{t['role'].upper()}: {t['text']}" for t in transcript
    )

    fields = config.lead_fields or [
        LeadField(name="name", description="Full name of the caller"),
        LeadField(name="email", description="Email address"),
        LeadField(name="phone", description="Phone number if mentioned"),
        LeadField(name="interest", description="What they are interested in"),
        LeadField(name="budget", description="Budget or price range if mentioned"),
    ]

    field_schema = {
        f.name: {"type": "string", "description": f.description}
        for f in fields
    }

    function_def = {
        "name": "save_lead",
        "description": "Extract structured lead data from the call transcript",
        "parameters": {
            "type": "object",
            "properties": {
                **field_schema,
                "lead_score": {
                    "type": "string",
                    "enum": ["hot", "warm", "cold"],
                    "description": "hot=ready to buy/very interested, warm=interested but not ready, cold=not interested",
                },
                "outcome": {
                    "type": "string",
                    "enum": ["interested", "not_interested", "booked", "voicemail", "unknown"],
                    "description": "The outcome of the call",
                },
                "summary": {
                    "type": "string",
                    "description": "One sentence summary of the call",
                },
            },
            "required": ["lead_score", "outcome", "summary"],
        },
    }

    scoring_context = f"\nLead scoring rules: {config.lead_scoring_rules}" if config.lead_scoring_rules else ""

    prompt = f"""Analyze this phone call transcript and extract the lead information.{scoring_context}

TRANSCRIPT:
{transcript_text}"""

    try:
        if config.llm_provider == "anthropic":
            return await _extract_anthropic(prompt, function_def, config)
        else:
            return await _extract_openai(prompt, function_def, config)
    except Exception as e:
        logger.error(f"Lead extraction error: {e}")
        return _empty_result()


async def _extract_openai(prompt: str, function_def: dict, config: AgentConfig) -> dict:
    client = AsyncOpenAI(api_key=config.llm_api_key_encrypted)
    response = await client.chat.completions.create(
        model=config.llm_model or "gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        tools=[{"type": "function", "function": function_def}],
        tool_choice={"type": "function", "function": {"name": "save_lead"}},
        max_tokens=500,
    )
    tool_call = response.choices[0].message.tool_calls[0]
    data = json.loads(tool_call.function.arguments)
    return _normalize(data)


async def _extract_anthropic(prompt: str, function_def: dict, config: AgentConfig) -> dict:
    client = AsyncAnthropic(api_key=config.llm_api_key_encrypted)
    response = await client.messages.create(
        model=config.llm_model or "claude-3-5-sonnet-20241022",
        max_tokens=500,
        tools=[function_def],
        tool_choice={"type": "tool", "name": "save_lead"},
        messages=[{"role": "user", "content": prompt}],
    )
    for block in response.content:
        if block.type == "tool_use":
            return _normalize(block.input)
    return _empty_result()


def _normalize(data: dict) -> dict:
    score = data.pop("lead_score", "cold")
    outcome = data.pop("outcome", "unknown")
    summary = data.pop("summary", "")
    return {
        "extracted_fields": data,
        "lead_score": score,
        "outcome": outcome,
        "summary": summary,
    }


def _empty_result() -> dict:
    return {
        "extracted_fields": {},
        "lead_score": "cold",
        "outcome": "unknown",
        "summary": "",
    }
