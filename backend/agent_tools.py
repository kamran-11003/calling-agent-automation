"""
agent_tools.py — HTTP tool execution engine for voice agents.

Tools are defined per-agent and exposed to the LLM as OpenAI function definitions.
During a call, when the LLM decides to call a tool the agent executes the HTTP request,
injects the result back into the conversation, and resumes speaking.

Supports: GET, POST, PUT, PATCH
URL / body / headers can use {variable} placeholders filled from conversation context.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

TOOL_TIMEOUT = 8  # seconds — hard cap per tool call


class AgentTool(BaseModel):
    id: str                          # snake_case unique name — used as OpenAI function name
    name: str                        # human-readable label
    description: str                 # what it does — shown to LLM
    method: str = "POST"             # GET | POST | PUT | PATCH
    url: str                         # can contain {variable} path params
    headers: dict[str, str] = {}     # static headers; values can use {variable}
    body_template: str = ""          # JSON string template; use {variable} placeholders
    result_path: str = ""            # dot-path into JSON response e.g. "data.available"
    enabled: bool = True


class CrmIntegration(BaseModel):
    provider: str = "none"           # hubspot | pipedrive | salesforce | airtable | webhook | none
    api_key: str = ""
    portal_id: str = ""              # HubSpot portal / account ID
    pipeline_id: str = ""            # Pipedrive pipeline
    base_url: str = ""               # Salesforce instance URL or Airtable base ID
    field_mapping: dict[str, str] = {}  # our extracted field → CRM field name
    trigger: str = "hot_warm"        # hot_warm | any | hot_only
    enabled: bool = False


# ──────────────────────────────────────────────────────────────
# Tool → OpenAI function definition
# ──────────────────────────────────────────────────────────────

def tools_to_openai_functions(tools: list[AgentTool]) -> list[dict[str, Any]]:
    """Convert agent tools to OpenAI function calling definitions."""
    functions = []
    for tool in tools:
        if not tool.enabled:
            continue
        # Extract all {variable} placeholders from url, headers, body
        all_text = tool.url + tool.body_template + json.dumps(tool.headers)
        params = list(set(re.findall(r"\{(\w+)\}", all_text)))
        properties = {p: {"type": "string", "description": f"Value for {p}"} for p in params}
        functions.append({
            "name": tool.id,
            "description": tool.description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": [],
            },
        })
    return functions


# ──────────────────────────────────────────────────────────────
# Tool execution
# ──────────────────────────────────────────────────────────────

def _fill_template(template: str, variables: dict[str, str]) -> str:
    """Replace {variable} placeholders in a string."""
    result = template
    for key, value in variables.items():
        result = result.replace(f"{{{key}}}", str(value))
    return result


def _extract_value(data: Any, path: str) -> Any:
    """Walk a dot-path into nested JSON. Returns data unchanged if path is empty."""
    if not path:
        return data
    for key in path.split("."):
        if isinstance(data, dict):
            data = data.get(key)
        elif isinstance(data, list) and key.isdigit():
            data = data[int(key)]
        else:
            return None
    return data


async def execute_tool(tool: AgentTool, arguments: dict[str, str]) -> str:
    """Execute an HTTP tool call and return a string result for the LLM."""
    try:
        url = _fill_template(tool.url, arguments)
        headers = {k: _fill_template(v, arguments) for k, v in tool.headers.items()}
        headers.setdefault("Content-Type", "application/json")

        body: Any = None
        if tool.body_template:
            filled = _fill_template(tool.body_template, arguments)
            try:
                body = json.loads(filled)
            except json.JSONDecodeError:
                body = filled

        async with httpx.AsyncClient(timeout=TOOL_TIMEOUT) as client:
            if tool.method.upper() == "GET":
                resp = await client.get(url, headers=headers)
            elif tool.method.upper() == "POST":
                resp = await client.post(url, json=body, headers=headers)
            elif tool.method.upper() == "PUT":
                resp = await client.put(url, json=body, headers=headers)
            else:
                resp = await client.patch(url, json=body, headers=headers)

            resp.raise_for_status()

            try:
                result_data = resp.json()
                extracted = _extract_value(result_data, tool.result_path)
                if extracted is None:
                    return json.dumps(result_data)[:500]
                return str(extracted)
            except Exception:
                return resp.text[:500]

    except httpx.TimeoutException:
        logger.warning(f"Tool {tool.id} timed out")
        return "error: request timed out"
    except httpx.HTTPStatusError as e:
        logger.warning(f"Tool {tool.id} HTTP {e.response.status_code}")
        return f"error: HTTP {e.response.status_code}"
    except Exception as e:
        logger.error(f"Tool {tool.id} error: {e}")
        return f"error: {str(e)[:100]}"
