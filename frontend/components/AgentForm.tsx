"use client";

import { useState } from "react";
import { AgentConfig, AgentTool, CrmIntegration, CallFlowStage, LeadField, DEFAULT_CRM } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Play, Loader2 } from "lucide-react";
import { API_URL, cn } from "@/lib/utils";
import { toast } from "sonner";
import KnowledgeBasePanel from "@/components/KnowledgeBasePanel";
import AgentToolBuilder from "@/components/AgentToolBuilder";
import CrmIntegrationPanel from "@/components/CrmIntegrationPanel";

const GOALS = [
  { value: "collect_lead",     label: "Collect Lead",          desc: "Capture caller info and intent" },
  { value: "book_appointment", label: "Book Appointment",      desc: "Schedule a meeting or callback" },
  { value: "qualify",          label: "Qualify Prospect",      desc: "Score and filter inbound leads" },
  { value: "survey",           label: "Run Survey",            desc: "Collect structured feedback" },
  { value: "customer_support", label: "Customer Support",      desc: "Handle support requests & FAQs" },
  { value: "ivr_routing",      label: "IVR / Call Routing",   desc: "Route callers to the right dept" },
  { value: "reminder",         label: "Send Reminder",         desc: "Appointment or payment reminders" },
  { value: "custom",           label: "Custom",                desc: "Fully custom instructions" },
];

const VOICES = [
  { provider: "elevenlabs", id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel (ElevenLabs)" },
  { provider: "elevenlabs", id: "AZnzlk1XvdvUeBnXmlld", label: "Domi (ElevenLabs)" },
  { provider: "elevenlabs", id: "EXAVITQu4vr4xnSDxMaL", label: "Bella (ElevenLabs)" },
  { provider: "elevenlabs", id: "ErXwobaYiN019PkySvjV", label: "Antoni (ElevenLabs)" },
  { provider: "openai",     id: "alloy",                label: "Alloy (OpenAI)" },
  { provider: "openai",     id: "echo",                 label: "Echo (OpenAI)" },
  { provider: "openai",     id: "nova",                 label: "Nova (OpenAI)" },
  { provider: "google",     id: "en-US-Studio-O",       label: "Studio O – Female (Google)" },
  { provider: "google",     id: "en-US-Studio-Q",       label: "Studio Q – Male (Google)" },
  { provider: "google",     id: "en-US-Wavenet-F",      label: "Wavenet F – Female (Google)" },
  { provider: "google",     id: "en-US-Wavenet-D",      label: "Wavenet D – Male (Google)" },
  { provider: "google",     id: "en-GB-Studio-B",       label: "Studio B – British Male (Google)" },
  { provider: "google",     id: "en-GB-Studio-C",       label: "Studio C – British Female (Google)" },
];

const LLM_MODELS = [
  { provider: "openai",    model: "gpt-4o",                     label: "GPT-4o" },
  { provider: "openai",    model: "gpt-4o-mini",                label: "GPT-4o Mini (faster)" },
  { provider: "anthropic", model: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
  { provider: "anthropic", model: "claude-3-haiku-20240307",    label: "Claude 3 Haiku (fastest)" },
  { provider: "google",    model: "gemini-2.5-flash-preview",   label: "Gemini 2.5 Flash Preview (free)" },
  { provider: "google",    model: "gemini-2.0-flash",           label: "Gemini 2.0 Flash" },
  { provider: "google",    model: "gemini-1.5-flash",           label: "Gemini 1.5 Flash (faster)" },
  { provider: "google",    model: "gemini-1.5-pro",             label: "Gemini 1.5 Pro" },
];

const LANGUAGES = [
  { value: "en", label: "English" }, { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" }, { value: "it", label: "Italian" },
  { value: "hi", label: "Hindi" },   { value: "ar", label: "Arabic" },
  { value: "ja", label: "Japanese" }, { value: "zh", label: "Chinese" },
];

const FLOW_LABELS: Record<keyof CallFlowStage, string> = {
  greeting: "Greeting", qualification: "Qualification",
  objection_handling: "Objection Handling", goal_action: "Goal Action",
  closing: "Closing", fallback: "Fallback",
};

const FLOW_PLACEHOLDERS: Record<keyof CallFlowStage, string> = {
  greeting: "What does the agent say when the call connects?",
  qualification: "What questions qualify the caller?",
  objection_handling: "How should the agent handle pushback or hesitation?",
  goal_action: "What happens when the goal is reached?",
  closing: "How does the agent wrap up the call?",
  fallback: "What should the agent say when confused or off-topic?",
};

const FLOW_HINTS: Record<keyof CallFlowStage, string> = {
  greeting: "Keep it under 2 sentences. State name and company.",
  qualification: "List 3-5 specific questions you want answered.",
  objection_handling: "Empathise, address concern, pivot back to goal.",
  goal_action: "Confirm details, set expectations for next steps.",
  closing: "Thank the caller and state what happens next.",
  fallback: "Used when STT is unclear or topic is out of scope.",
};

const TABS = [
  { id: "identity",     label: "Identity" },
  { id: "voice",        label: "Voice & AI" },
  { id: "flow",         label: "Call Flow" },
  { id: "data",         label: "Data & Leads" },
  { id: "knowledge",   label: "Knowledge" },
  { id: "integrations", label: "Integrations" },
  { id: "connect",     label: "Connect" },
] as const;

type TabId = typeof TABS[number]["id"];

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs text-zinc-400 mb-1">{children}</label>;
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-zinc-600 mt-1">{children}</p>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-2">{title}</h3>
      {children}
    </div>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

interface Props {
  config: AgentConfig;
  onChange: (updated: AgentConfig) => void;
  onSave: () => void;
  saving: boolean;
}

export default function AgentForm({ config, onChange, onSave: _onSave, saving: _saving }: Props) {
  const [tab, setTab] = useState<TabId>("identity");
  const [previewLoading, setPreviewLoading] = useState(false);

  function set<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
    onChange({ ...config, [key]: value });
  }
  function setFlow(key: keyof CallFlowStage, value: string) {
    onChange({ ...config, call_flow: { ...config.call_flow, [key]: value } });
  }
  function addLeadField() {
    onChange({ ...config, lead_fields: [...config.lead_fields, { name: "", description: "" }] });
  }
  function updateLeadField(i: number, patch: Partial<LeadField>) {
    onChange({ ...config, lead_fields: config.lead_fields.map((f: LeadField, idx: number) => idx === i ? { ...f, ...patch } : f) });
  }
  function removeLeadField(i: number) {
    onChange({ ...config, lead_fields: config.lead_fields.filter((_: LeadField, idx: number) => idx !== i) });
  }
  function setTools(tools: AgentTool[]) {
    onChange({ ...config, agent_tools: tools });
  }
  function setCrm(crm: CrmIntegration) {
    onChange({ ...config, crm_integration: crm });
  }

  async function handleVoicePreview() {
    if (!config.tts_api_key_encrypted) return toast.error("Enter your TTS API key first");
    if (!config.voice_id) return toast.error("Select a voice first");
    setPreviewLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/voice/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_provider: config.voice_provider, voice_id: config.voice_id, tts_api_key: config.tts_api_key_encrypted }),
      });
      if (!res.ok) throw new Error();
      new Audio(URL.createObjectURL(await res.blob())).play();
    } catch { toast.error("Preview failed. Check your API key."); }
    finally { setPreviewLoading(false); }
  }

  const selectedVoiceKey = `${config.voice_provider}:${config.voice_id}`;

  return (
    <div className="flex flex-col h-full">
      {/* Agent name */}
      <div className="px-6 pt-5 pb-3 border-b border-zinc-800/60">
        <Input
          className="text-base font-semibold bg-transparent border-0 border-b border-zinc-800 rounded-none px-0 text-zinc-100 placeholder:text-zinc-600 focus:ring-0 focus:border-indigo-500 h-auto pb-2"
          placeholder="Agent name..."
          value={config.name}
          onChange={(e) => set("name", e.target.value)}
        />
        <p className="text-[11px] text-zinc-600 mt-1.5">
          {config.id ? `ID ${config.id.slice(0, 8)}… · ` : "Unsaved · "}
          {config.enabled ? <span className="text-green-500">Live</span> : <span className="text-zinc-500">Paused</span>}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 px-6 shrink-0 bg-zinc-950">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px whitespace-nowrap",
              tab === t.id ? "border-indigo-500 text-indigo-400" : "border-transparent text-zinc-500 hover:text-zinc-300"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {tab === "identity" && (
          <>
            <Section title="Persona">
              <Row>
                <div>
                  <Label>Persona Name</Label>
                  <Input placeholder="Alex" value={config.persona_name} onChange={(e) => set("persona_name", e.target.value)} />
                  <Hint>The first name the agent uses on calls.</Hint>
                </div>
                <div>
                  <Label>Role / Title</Label>
                  <Input placeholder="Sales Representative" value={config.persona_role} onChange={(e) => set("persona_role", e.target.value)} />
                </div>
              </Row>
              <Row>
                <div>
                  <Label>Company Name</Label>
                  <Input placeholder="Acme Corp" value={config.persona_company} onChange={(e) => set("persona_company", e.target.value)} />
                </div>
                <div>
                  <Label>Language</Label>
                  <select className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    value={config.language} onChange={(e) => set("language", e.target.value)}>
                    {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
              </Row>
            </Section>

            <Section title="Goal">
              <div className="grid grid-cols-2 gap-2">
                {GOALS.map((g) => (
                  <button key={g.value} onClick={() => set("goal", g.value as AgentConfig["goal"])}
                    className={cn("flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      config.goal === g.value
                        ? "border-indigo-500 bg-indigo-600/10 text-indigo-300"
                        : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                    )}>
                    <span className="text-xs font-medium">{g.label}</span>
                    <span className="text-[10px] text-zinc-500 leading-tight">{g.desc}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Instructions">
              <Textarea rows={7}
                placeholder={"Describe how this agent should behave...\n\nExample:\n- Be warm and professional\n- Do not discuss pricing\n- Always confirm caller name before proceeding"}
                value={config.instructions} onChange={(e) => set("instructions", e.target.value)} />
              <Hint>Be specific about tone, rules, and what to avoid. The Copilot can improve this for you.</Hint>
            </Section>

            <Section title="Call Settings">
              <Row>
                <div>
                  <Label>Max Duration (seconds)</Label>
                  <Input type="number" min={60} max={3600} value={config.max_call_duration_seconds}
                    onChange={(e) => set("max_call_duration_seconds", parseInt(e.target.value) || 300)} />
                  <Hint>300 = 5 min. Max 3600 = 1 hr.</Hint>
                </div>
                <div>
                  <Label>Status</Label>
                  <button onClick={() => set("enabled", !config.enabled)}
                    className={cn("mt-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                      config.enabled ? "border-green-700 bg-green-900/30 text-green-400" : "border-zinc-700 bg-zinc-900 text-zinc-500")}>
                    <div className={cn("h-2 w-2 rounded-full", config.enabled ? "bg-green-400" : "bg-zinc-600")} />
                    {config.enabled ? "Agent is live" : "Agent is paused"}
                  </button>
                  <Hint>Only live agents answer calls.</Hint>
                </div>
              </Row>
              <div>
                <Label>Fallback Message</Label>
                <Input placeholder="I am sorry, I am having trouble. Let me connect you with someone who can help."
                  value={config.fallback_message} onChange={(e) => set("fallback_message", e.target.value)} />
                <Hint>Spoken when the agent is confused or encounters an error.</Hint>
              </div>
            </Section>
          </>
        )}

        {tab === "voice" && (
          <>
            <Section title="Text-to-Speech">
              <div>
                <Label>Voice</Label>
                <div className="flex gap-2">
                  <select className="flex-1 h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    value={selectedVoiceKey}
                    onChange={(e) => {
                      const [provider, ...rest] = e.target.value.split(":");
                      set("voice_provider", provider as AgentConfig["voice_provider"]);
                      set("voice_id", rest.join(":"));
                    }}>
                    <option value=":">Select a voice...</option>
                    <optgroup label="ElevenLabs">
                      {VOICES.filter(v => v.provider === "elevenlabs").map(v => (
                        <option key={`${v.provider}:${v.id}`} value={`${v.provider}:${v.id}`}>{v.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="OpenAI TTS">
                      {VOICES.filter(v => v.provider === "openai").map(v => (
                        <option key={`${v.provider}:${v.id}`} value={`${v.provider}:${v.id}`}>{v.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Google TTS (platform key)">
                      {VOICES.filter(v => v.provider === "google").map(v => (
                        <option key={`${v.provider}:${v.id}`} value={`${v.provider}:${v.id}`}>{v.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  <Button variant="outline" size="sm" onClick={handleVoicePreview} disabled={previewLoading} className="shrink-0">
                    {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Preview
                  </Button>
                </div>
                <Hint>ElevenLabs is highest quality. OpenAI voices reuse your LLM key — no extra key needed.</Hint>
              </div>
              <div>
                <Label>TTS API Key</Label>
                <Input type="password" placeholder="ElevenLabs or Cartesia API key"
                  value={config.tts_api_key_encrypted} onChange={(e) => set("tts_api_key_encrypted", e.target.value)} />
                <Hint>Not required for OpenAI voices.</Hint>
              </div>
            </Section>

            <Section title="Language Model">
              <div>
                <Label>Model</Label>
                <select className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    value={`${config.llm_provider}:${config.llm_model}`}
                  onChange={(e) => {
                    const idx = e.target.value.indexOf(":");
                    const provider = e.target.value.slice(0, idx);
                    const model = e.target.value.slice(idx + 1);
                    set("llm_provider", provider as AgentConfig["llm_provider"]);
                    set("llm_model", model);
                  }}>
                  <optgroup label="OpenAI">
                    {LLM_MODELS.filter(m => m.provider === "openai").map(m => (
                      <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>{m.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Anthropic">
                    {LLM_MODELS.filter(m => m.provider === "anthropic").map(m => (
                      <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>{m.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Google (no key needed — uses platform key)">
                    {LLM_MODELS.filter(m => m.provider === "google").map(m => (
                      <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>{m.label}</option>
                    ))}
                  </optgroup>
                </select>
                <Hint>GPT-4o gives best quality. Mini / Haiku are faster and cheaper for high volume. Google models use the platform key — no API key required.</Hint>
              </div>
              {config.llm_provider !== "google" && (
              <div>
                <Label>LLM API Key</Label>
                <Input type="password" placeholder="sk-... (OpenAI) or your Anthropic key"
                  value={config.llm_api_key_encrypted} onChange={(e) => set("llm_api_key_encrypted", e.target.value)} />
                <Hint>Stored encrypted. Used only during live calls.</Hint>
              </div>
              )}
              {config.llm_provider === "google" && (
                <div className="rounded-lg border border-emerald-800/40 bg-emerald-900/10 px-3 py-2 text-xs text-emerald-300">
                  ✓ Google / Gemini — no API key required. Uses the platform-level key configured in the backend.
                </div>
              )}
            </Section>
          </>
        )}

        {tab === "flow" && (
          <Section title="Call Flow Stages">
            <p className="text-xs text-zinc-500 -mt-2">
              Define what the agent says at each stage. Leave blank to rely on instructions. The Copilot can fill these in automatically.
            </p>
            {(Object.keys(FLOW_LABELS) as Array<keyof CallFlowStage>).map((key) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">{FLOW_LABELS[key]}</label>
                <Textarea rows={3} placeholder={FLOW_PLACEHOLDERS[key]}
                  value={config.call_flow[key]} onChange={(e) => setFlow(key, e.target.value)} />
                <p className="text-[11px] text-zinc-600 italic">{FLOW_HINTS[key]}</p>
              </div>
            ))}
          </Section>
        )}

        {tab === "data" && (
          <>
            <Section title="Data to Collect">
              <p className="text-xs text-zinc-500 -mt-2">
                Fields the agent extracts from the conversation. No scripted questions needed — the LLM listens naturally.
              </p>
              <div className="space-y-2">
                {config.lead_fields.map((field: LeadField, i: number) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input placeholder="Field name" className="w-32 shrink-0"
                      value={field.name} onChange={(e) => updateLeadField(i, { name: e.target.value })} />
                    <Input placeholder="What to listen for (e.g. budget range the caller mentions)"
                      value={field.description} onChange={(e) => updateLeadField(i, { description: e.target.value })} />
                    <button onClick={() => removeLeadField(i)} className="shrink-0 text-zinc-600 hover:text-red-400 transition-colors p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addLeadField}><Plus className="h-3 w-3" /> Add Field</Button>
              </div>
            </Section>

            <Section title="Lead Scoring Rules">
              <Textarea rows={4}
                placeholder={"Describe what makes a lead hot, warm, or cold.\n\nExample:\nHot: ready to buy now, has budget, wants a meeting\nWarm: interested but not ready\nCold: just browsing, no intent"}
                value={config.lead_scoring_rules} onChange={(e) => set("lead_scoring_rules", e.target.value)} />
              <Hint>The AI scores leads after each call. Leave blank for default scoring.</Hint>
            </Section>

            <Section title="Post-Call Webhook">
              <div>
                <Label>Webhook URL</Label>
                <Input placeholder="https://your-server.com/webhook/calls"
                  value={config.webhook_url} onChange={(e) => set("webhook_url", e.target.value)} />
                <Hint>We POST the call summary, transcript, and extracted fields as JSON after every call.</Hint>
              </div>
              <div>
                <Label>Webhook Secret (optional)</Label>
                <Input type="password" placeholder="Any secret string"
                  value={config.webhook_secret} onChange={(e) => set("webhook_secret", e.target.value)} />
                <Hint>We sign each payload with HMAC-SHA256 and send it as <code className="bg-zinc-800 px-1 rounded text-indigo-400">X-Signature-SHA256: sha256=...</code> — verify on your end to ensure authenticity.</Hint>
              </div>
            </Section>
          </>
        )}

        {tab === "knowledge" && (
          <>
            <Section title="Quick Knowledge (Text)">
              <Textarea rows={7}
                placeholder={"Paste reference material that will be injected into every call:\n\n- Product names, prices, features\n- FAQs and common objections\n- Company info, office hours, contacts\n- Pricing, policies, procedures"}
                value={config.knowledge_base} onChange={(e) => set("knowledge_base", e.target.value)} />
              <Hint>Added to every call’s system prompt automatically. Use for short, always-relevant facts.</Hint>
            </Section>

            <Section title="Document Knowledge (PDF / TXT)">
              {config.id ? (
                <KnowledgeBasePanel
                  agentId={config.id}
                  label="Agent Documents"
                  hint="Uploaded files are chunked and embedded. The agent retrieves relevant passages per call turn using semantic search."
                />
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-700 py-5 text-center">
                  <p className="text-xs text-zinc-500">Save this agent first to enable document upload</p>
                  <p className="text-[11px] text-zinc-600 mt-1">An agent ID is required to scope the documents</p>
                </div>
              )}
            </Section>
          </>
        )}

        {tab === "integrations" && (
          <>
            <Section title="HTTP Tools (Function Calling)">
              <AgentToolBuilder
                tools={config.agent_tools || []}
                onChange={setTools}
              />
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 mt-2">
                <p className="text-xs text-zinc-400 font-medium mb-1">How HTTP Tools Work</p>
                <ul className="text-xs text-zinc-500 space-y-1 list-disc list-inside">
                  <li>Tools are available to the agent as callable functions during live calls</li>
                  <li>The LLM decides when to call a tool based on the conversation</li>
                  <li>The agent says "one moment" while executing, then speaks the result</li>
                  <li>Only supported with OpenAI models (function calling)</li>
                </ul>
              </div>
            </Section>

            <Section title="CRM Integration">
              <CrmIntegrationPanel
                crm={config.crm_integration || DEFAULT_CRM}
                onChange={setCrm}
              />
            </Section>
          </>
        )}

        {tab === "connect" && (
          <>
            <Card className="border-amber-800/40 bg-amber-900/10">
              <CardContent className="pt-4 text-xs text-amber-300 space-y-1.5">
                <p className="font-semibold text-amber-200">Setup Checklist</p>
                <p>{config.twilio_account_sid_encrypted ? "✅" : "❌"} Twilio Account SID</p>
                <p>{config.twilio_auth_token_encrypted ? "✅" : "❌"} Twilio Auth Token</p>
                <p>{config.phone_number ? "✅" : "❌"} Phone number assigned ({config.phone_number || "none"})</p>
                <p>{(config.llm_api_key_encrypted || config.llm_provider === "google") ? "✅" : "❌"} LLM API key{config.llm_provider === "google" ? " (platform key)" : ""}</p>
                <p>{(config.tts_api_key_encrypted || config.voice_provider === "openai" || config.voice_provider === "google") ? "✅" : "⚠️"} TTS API key{config.voice_provider === "google" ? " (platform key)" : ""}</p>
              </CardContent>
            </Card>

            <Section title="Twilio Credentials">
              <p className="text-xs text-zinc-500 -mt-2">
                Each agent uses its own Twilio account.{" "}
                <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
                  console.twilio.com
                </a>
              </p>
              <div>
                <Label>Account SID</Label>
                <Input type="password" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={config.twilio_account_sid_encrypted} onChange={(e) => set("twilio_account_sid_encrypted", e.target.value)} />
              </div>
              <div>
                <Label>Auth Token</Label>
                <Input type="password" placeholder="Your Twilio Auth Token"
                  value={config.twilio_auth_token_encrypted} onChange={(e) => set("twilio_auth_token_encrypted", e.target.value)} />
              </div>
              <div>
                <Label>Phone Number</Label>
                <Input placeholder="+12025551234"
                  value={config.phone_number} onChange={(e) => set("phone_number", e.target.value)} />
                <Hint>The Twilio number callers dial to reach this agent.</Hint>
              </div>
            </Section>

            <Section title="Twilio Webhook URL">
              <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-3 space-y-2">
                <p className="text-xs text-zinc-400">Set this in Twilio Console <span className="text-zinc-600">→ Phone Numbers → Voice Webhook (HTTP POST):</span></p>
                <div className="font-mono text-xs text-indigo-400 bg-zinc-950 rounded px-2 py-1.5 select-all break-all">
                  https://YOUR-SERVER/twilio/inbound
                </div>
                <p className="text-[11px] text-zinc-600">Replace YOUR-SERVER with your ngrok URL in dev, or Railway/Render URL in production.</p>
              </div>
            </Section>
          </>
        )}

      </div>
    </div>
  );
}