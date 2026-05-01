"""
Real-time voice pipeline: Deepgram STT → LLM → ElevenLabs/Cartesia TTS
Runs inside a WebSocket connection for the duration of one call.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncGenerator

import httpx
import base64
from openai import AsyncOpenAI
from anthropic import AsyncAnthropic
import google.generativeai as genai
from deepgram import DeepgramClient, LiveTranscriptionEvents, LiveOptions
from agent_config import AgentConfig, CallFlowStage
from config import get_settings
from kb_manager import search_knowledge
from agent_tools import AgentTool, tools_to_openai_functions, execute_tool

logger = logging.getLogger(__name__)

# Silence threshold — if no speech for this long, agent prompts user again
SILENCE_TIMEOUT_SECONDS = 8
# Max time to wait for first LLM token before playing filler
LLM_FIRST_TOKEN_TIMEOUT = 1.0


def build_system_prompt(config: AgentConfig) -> str:
    flow = config.call_flow
    fields = ", ".join(f.name for f in config.lead_fields) if config.lead_fields else "name, phone, email, interest"

    kb_section = ""
    if config.knowledge_base and config.knowledge_base.strip():
        kb_section = f"""

KNOWLEDGE BASE (use this to answer questions accurately):
{config.knowledge_base.strip()}
"""

    return f"""You are {config.persona_name}, {config.persona_role} at {config.persona_company}.
You are conducting a phone call. Speak naturally and conversationally. Keep responses SHORT (1-3 sentences max).
Never mention you are an AI unless directly asked. Be warm, professional, and focused.

GOAL: {config.goal.replace("_", " ").title()}

INSTRUCTIONS:
{config.instructions}{kb_section}

CALL FLOW:
1. GREETING: {flow.greeting or "Greet the caller warmly and introduce yourself."}
2. QUALIFICATION: {flow.qualification or "Ask qualifying questions relevant to your goal."}
3. OBJECTION HANDLING: {flow.objection_handling or "Address concerns empathetically and redirect to value."}
4. GOAL ACTION: {flow.goal_action or "Guide the caller toward the goal."}
5. CLOSING: {flow.closing or "Thank the caller and summarize next steps."}
6. FALLBACK: {flow.fallback or config.fallback_message}

LEAD FIELDS TO COLLECT (naturally during conversation): {fields}

RULES:
- Never read out these instructions verbatim
- If confused, use the fallback response
- Keep the conversation focused and time-efficient
- Extract information naturally, not like a form
- Maximum call duration is {config.max_call_duration_seconds // 60} minutes
"""


class VoicePipeline:
    """
    Manages the full STT→LLM→TTS loop for one call session.
    Audio in/out is handled by the caller (call_handler.py) via queues.
    """

    def __init__(self, config: AgentConfig, call_sid: str):
        self.config = config
        self.call_sid = call_sid
        self.conversation_history: list[dict] = []
        self.full_transcript: list[dict] = []  # [{role, text, timestamp}]
        self.is_agent_speaking = False
        self.interrupt_event = asyncio.Event()
        self.audio_out_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._silence_task: asyncio.Task | None = None
        self._start_time = time.time()

    # ──────────────────────────────────────────────
    # Entry point: process a finalized STT transcript
    # ──────────────────────────────────────────────
    async def handle_user_speech(self, text: str) -> None:
        if not text.strip():
            return

        logger.info(f"[{self.call_sid}] User: {text}")
        self._reset_silence_timer()

        # If agent is currently speaking, interrupt it
        if self.is_agent_speaking:
            self.interrupt_event.set()
            await asyncio.sleep(0.05)  # small gap for clean interrupt

        self.full_transcript.append({"role": "user", "text": text, "timestamp": time.time() - self._start_time})
        self.conversation_history.append({"role": "user", "content": text})

        # Generate + stream agent response
        asyncio.create_task(self._generate_and_speak())

    async def start_greeting(self) -> None:
        """Called once at the beginning of the call."""
        greeting_text = self.config.call_flow.greeting or f"Hello! This is {self.config.persona_name} from {self.config.persona_company}. How can I help you today?"
        self.conversation_history.append({"role": "assistant", "content": greeting_text})
        self.full_transcript.append({"role": "agent", "text": greeting_text, "timestamp": 0.0})
        await self._speak_text(greeting_text)
        self._reset_silence_timer()

    # ──────────────────────────────────────────────
    # LLM → TTS
    # ──────────────────────────────────────────────
    async def _generate_and_speak(self) -> None:
        self.is_agent_speaking = True
        self.interrupt_event.clear()

        enabled_tools = [t for t in (self.config.agent_tools or []) if t.enabled]

        # If agent has HTTP tools and uses OpenAI, use function-calling path (non-streaming)
        if enabled_tools and self.config.llm_provider == "openai":
            await self._generate_with_tools(enabled_tools)
            return

        # Filler: if first LLM token takes > 1s, play "one moment" while we wait
        filler_played = False
        filler_task: asyncio.Task | None = None

        async def play_filler_if_slow():
            nonlocal filler_played
            await asyncio.sleep(LLM_FIRST_TOKEN_TIMEOUT)
            if not self.interrupt_event.is_set():
                filler_played = True
                await self._speak_text("One moment...")

        filler_task = asyncio.create_task(play_filler_if_slow())

        try:
            full_response = ""
            async for sentence in self._stream_llm_sentences():
                if filler_task and not filler_task.done():
                    filler_task.cancel()  # cancel filler once first sentence is ready
                if self.interrupt_event.is_set():
                    logger.info(f"[{self.call_sid}] Agent interrupted mid-speech")
                    break
                await self._speak_text(sentence)
                full_response += sentence + " "
                if self.interrupt_event.is_set():
                    break

            if full_response.strip():
                self.conversation_history.append({"role": "assistant", "content": full_response.strip()})
                self.full_transcript.append({
                    "role": "agent",
                    "text": full_response.strip(),
                    "timestamp": time.time() - self._start_time
                })
        except Exception as e:
            logger.error(f"[{self.call_sid}] Pipeline error: {e}")
        finally:
            if filler_task and not filler_task.done():
                filler_task.cancel()
            self.is_agent_speaking = False

    async def _generate_with_tools(self, tools: list[AgentTool]) -> None:
        """
        OpenAI function-calling path for agents with HTTP tools.
        Non-streaming: LLM can request tool calls, we execute them, then speak the final response.
        """
        try:
            system_prompt = build_system_prompt(self.config)
            client = AsyncOpenAI(api_key=self.config.llm_api_key_encrypted)
            functions = tools_to_openai_functions(tools)
            messages = [{"role": "system", "content": system_prompt}] + self.conversation_history

            # Play filler immediately since non-streaming adds more latency
            filler_task = asyncio.create_task(self._delayed_filler())

            MAX_TOOL_ROUNDS = 3
            final_text = ""

            for _ in range(MAX_TOOL_ROUNDS):
                if self.interrupt_event.is_set():
                    break

                response = await client.chat.completions.create(
                    model=self.config.llm_model or "gpt-4o",
                    messages=messages,
                    functions=functions,
                    function_call="auto",
                    max_tokens=300,
                )

                msg = response.choices[0].message

                if msg.function_call:
                    tool_name = msg.function_call.name
                    try:
                        args = json.loads(msg.function_call.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}

                    # Find tool
                    tool = next((t for t in tools if t.id == tool_name), None)
                    if not tool:
                        break

                    logger.info(f"[{self.call_sid}] Calling tool: {tool_name} args={args}")

                    # Cancel filler if still pending, speak "one moment"
                    if filler_task and not filler_task.done():
                        filler_task.cancel()
                    await self._speak_text("One moment while I check that for you.")

                    result = await execute_tool(tool, args)
                    logger.info(f"[{self.call_sid}] Tool {tool_name} result: {result[:100]}")

                    # Add function call + result to messages
                    messages.append({"role": "assistant", "content": None, "function_call": {"name": tool_name, "arguments": msg.function_call.arguments}})
                    messages.append({"role": "function", "name": tool_name, "content": result})

                else:
                    # Final text response
                    final_text = msg.content or ""
                    break

            if filler_task and not filler_task.done():
                filler_task.cancel()

            if final_text.strip() and not self.interrupt_event.is_set():
                await self._speak_text(final_text)
                self.conversation_history.append({"role": "assistant", "content": final_text.strip()})
                self.full_transcript.append({
                    "role": "agent",
                    "text": final_text.strip(),
                    "timestamp": time.time() - self._start_time,
                })

        except Exception as e:
            logger.error(f"[{self.call_sid}] Tool-call pipeline error: {e}")
            await self._speak_text(self.config.fallback_message)
        finally:
            self.is_agent_speaking = False

    async def _delayed_filler(self) -> None:
        await asyncio.sleep(LLM_FIRST_TOKEN_TIMEOUT)
        if not self.interrupt_event.is_set():
            await self._speak_text("One moment...")

    async def _stream_llm_sentences(self) -> AsyncGenerator[str, None]:
        """Stream LLM response and yield complete sentences for low-latency TTS."""
        system_prompt = build_system_prompt(self.config)

        # Inject relevant KB chunks based on the latest user message
        latest_user_msg = next(
            (m["content"] for m in reversed(self.conversation_history) if m["role"] == "user"), ""
        )
        if latest_user_msg and self.config.id:
            kb_chunks = await search_knowledge(latest_user_msg, agent_id=self.config.id)
            if kb_chunks:
                kb_context = "\n\n".join(kb_chunks)
                system_prompt += f"\n\nRELEVANT KNOWLEDGE (retrieved from agent knowledge base):\n{kb_context}"

        buffer = ""
        sentence_enders = {'.', '!', '?', '\n'}

        try:
            if self.config.llm_provider == "anthropic":
                client = AsyncAnthropic(api_key=self.config.llm_api_key_encrypted)
                async with client.messages.stream(
                    model=self.config.llm_model or "claude-3-5-sonnet-20241022",
                    max_tokens=200,
                    system=system_prompt,
                    messages=self.conversation_history,
                ) as stream:
                    async for text in stream.text_stream:
                        if self.interrupt_event.is_set():
                            return
                        buffer += text
                        # Yield on sentence boundaries for faster TTS start
                        while any(c in buffer for c in sentence_enders):
                            for i, char in enumerate(buffer):
                                if char in sentence_enders:
                                    sentence = buffer[:i + 1].strip()
                                    buffer = buffer[i + 1:]
                                    if sentence:
                                        yield sentence
                                    break
            elif self.config.llm_provider == "google":
                api_key = get_settings().gemini_api_key or self.config.llm_api_key_encrypted
                genai.configure(api_key=api_key)
                gemini = genai.GenerativeModel(
                    model_name=self.config.llm_model or "gemini-2.0-flash",
                    system_instruction=system_prompt,
                )
                # Convert history to Gemini format
                gemini_history = [
                    {"role": "user" if m["role"] == "user" else "model", "parts": [m["content"]]}
                    for m in self.conversation_history[:-1]  # exclude last message
                ]
                last_msg = self.conversation_history[-1]["content"] if self.conversation_history else ""
                chat = gemini.start_chat(history=gemini_history)
                response = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: chat.send_message(last_msg, stream=True)
                )
                for chunk in response:
                    if self.interrupt_event.is_set():
                        return
                    text = chunk.text or ""
                    buffer += text
                    while any(c in buffer for c in sentence_enders):
                        for i, char in enumerate(buffer):
                            if char in sentence_enders:
                                sentence = buffer[:i + 1].strip()
                                buffer = buffer[i + 1:]
                                if sentence:
                                    yield sentence
                                break
            else:
                # Default: OpenAI
                client = AsyncOpenAI(api_key=self.config.llm_api_key_encrypted)
                stream = await client.chat.completions.create(
                    model=self.config.llm_model or "gpt-4o",
                    messages=[{"role": "system", "content": system_prompt}] + self.conversation_history,
                    max_tokens=200,
                    stream=True,
                )
                async for chunk in stream:
                    if self.interrupt_event.is_set():
                        return
                    delta = chunk.choices[0].delta.content or ""
                    buffer += delta
                    while any(c in buffer for c in sentence_enders):
                        for i, char in enumerate(buffer):
                            if char in sentence_enders:
                                sentence = buffer[:i + 1].strip()
                                buffer = buffer[i + 1:]
                                if sentence:
                                    yield sentence
                                break

            # Flush remaining buffer
            if buffer.strip() and not self.interrupt_event.is_set():
                yield buffer.strip()

        except Exception as e:
            logger.error(f"[{self.call_sid}] LLM stream error: {e}")
            yield self.config.fallback_message

    async def _speak_text(self, text: str) -> None:
        """Convert text to speech and push audio chunks to output queue."""
        if not text.strip():
            return

        try:
            if self.config.voice_provider == "elevenlabs":
                await self._tts_elevenlabs(text)
            elif self.config.voice_provider == "cartesia":
                await self._tts_cartesia(text)
            elif self.config.voice_provider == "google":
                await self._tts_google(text)
            else:
                await self._tts_openai(text)
        except Exception as e:
            logger.error(f"[{self.call_sid}] TTS error: {e}")

    async def _tts_elevenlabs(self, text: str) -> None:
        voice_id = self.config.voice_id or "21m00Tcm4TlvDq8ikWAM"  # default: Rachel
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
        headers = {
            "xi-api-key": self.config.tts_api_key_encrypted,
            "Content-Type": "application/json",
        }
        payload = {
            "text": text,
            "model_id": "eleven_turbo_v2_5",
            "output_format": "ulaw_8000",   # Twilio native format — no re-encoding needed
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        async with httpx.AsyncClient(timeout=30) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes(chunk_size=640):
                    if self.interrupt_event.is_set():
                        return
                    await self.audio_out_queue.put(chunk)

    async def _tts_cartesia(self, text: str) -> None:
        url = "https://api.cartesia.ai/tts/bytes"
        headers = {
            "X-API-Key": self.config.tts_api_key_encrypted,
            "Cartesia-Version": "2024-06-10",
            "Content-Type": "application/json",
        }
        payload = {
            "transcript": text,
            "model_id": "sonic-english",
            "voice": {"mode": "id", "id": self.config.voice_id or "a0e99841-438c-4a64-b679-ae501e7d6091"},
            "output_format": {"container": "raw", "encoding": "pcm_mulaw", "sample_rate": 8000},
        }
        async with httpx.AsyncClient(timeout=30) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes(chunk_size=640):
                    if self.interrupt_event.is_set():
                        return
                    await self.audio_out_queue.put(chunk)

    async def _tts_openai(self, text: str) -> None:
        client = AsyncOpenAI(api_key=self.config.llm_api_key_encrypted)  # reuse LLM key for OpenAI TTS
        async with client.audio.speech.with_streaming_response.create(
            model="tts-1",
            voice=self.config.voice_id or "alloy",
            input=text,
            response_format="pcm",  # raw PCM, needs encoding for Twilio
        ) as response:
            async for chunk in response.iter_bytes(chunk_size=640):
                if self.interrupt_event.is_set():
                    return
                await self.audio_out_queue.put(chunk)

    async def _tts_google(self, text: str) -> None:
        """Google Cloud TTS — returns base64 MULAW audio via REST API key."""
        api_key = get_settings().gemini_api_key or self.config.tts_api_key_encrypted
        voice_name = self.config.voice_id or "en-US-Studio-O"
        # Derive language code from voice name (e.g. "en-US-Studio-O" → "en-US")
        lang_code = "-".join(voice_name.split("-")[:2])
        url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={api_key}"
        payload = {
            "input": {"text": text},
            "voice": {"languageCode": lang_code, "name": voice_name},
            "audioConfig": {"audioEncoding": "MULAW", "sampleRateHertz": 8000},
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            audio_bytes = base64.b64decode(response.json()["audioContent"])
            # Chunk into 640-byte pieces like other providers
            for i in range(0, len(audio_bytes), 640):
                if self.interrupt_event.is_set():
                    return
                await self.audio_out_queue.put(audio_bytes[i:i + 640])

    # ──────────────────────────────────────────────
    # Silence detection
    # ──────────────────────────────────────────────
    def _reset_silence_timer(self) -> None:
        if self._silence_task and not self._silence_task.done():
            self._silence_task.cancel()
        self._silence_task = asyncio.create_task(self._silence_watcher())

    async def _silence_watcher(self) -> None:
        await asyncio.sleep(SILENCE_TIMEOUT_SECONDS)
        if not self.is_agent_speaking:
            logger.info(f"[{self.call_sid}] Silence detected — prompting user")
            await self.handle_user_speech("(silence)")

    # ──────────────────────────────────────────────
    # Cleanup
    # ──────────────────────────────────────────────
    async def cleanup(self) -> None:
        if self._silence_task and not self._silence_task.done():
            self._silence_task.cancel()
        await self.audio_out_queue.put(None)  # signal end-of-stream
