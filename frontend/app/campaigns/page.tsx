"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { API_URL } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  PhoneCall, LayoutDashboard, Plus, Play, Pause, StopCircle,
  Trash2, Upload, Users, CheckCircle2, Loader2, ArrowLeft,
  Phone, Clock, X, RefreshCw, Bot, BarChart3, Sparkles,
  Send, Settings, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  agent_id: string | null;
  status: "draft" | "running" | "paused" | "completed" | "cancelled";
  description?: string;
  schedule_start?: string;
  schedule_timezone: string;
  calling_hours_start: string;
  calling_hours_end: string;
  calling_days: string[];
  max_retries: number;
  retry_delay_hours: number;
  voicemail_drop_url: string;
  dnc_numbers: string[];
  total_contacts: number;
  called: number;
  answered: number;
  voicemail: number;
  failed: number;
  created_at: string;
}

interface AgentSummary {
  id: string;
  name: string;
  phone_number: string;
  goal: string;
}

interface CampaignContact {
  id: string;
  phone: string;
  name: string;
  status: string;
  attempts: number;
  last_called_at: string | null;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-700 text-zinc-300",
  running: "bg-green-500/20 text-green-400 border-green-500/30",
  paused: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  completed: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
};

const CONTACT_STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-700 text-zinc-300",
  calling: "bg-blue-500/20 text-blue-400",
  answered: "bg-green-500/20 text-green-400",
  voicemail: "bg-purple-500/20 text-purple-400",
  failed: "bg-red-500/20 text-red-400",
  dnc: "bg-zinc-600 text-zinc-400",
  completed: "bg-indigo-500/20 text-indigo-400",
  skipped: "bg-zinc-700 text-zinc-500",
};

const DAY_OPTIONS = [
  { value: "mon", label: "Mon" }, { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" }, { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" }, { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Phoenix", "America/Anchorage",
  "Pacific/Honolulu", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo",
  "Australia/Sydney",
];

const DEFAULT_CAMPAIGN: Partial<Campaign> = {
  name: "", description: "", agent_id: null, status: "draft",
  schedule_start: "", schedule_timezone: "America/New_York",
  calling_hours_start: "09:00", calling_hours_end: "17:00",
  calling_days: ["mon", "tue", "wed", "thu", "fri"],
  max_retries: 2, retry_delay_hours: 4,
  voicemail_drop_url: "", dnc_numbers: [],
};

// ─────────────────────────────────────────────────────────────
// Campaign Copilot Sidebar
// ─────────────────────────────────────────────────────────────

interface CopilotMsg { role: "user" | "assistant"; content: string }

const QUICK_PROMPTS = [
  "Suggest best calling hours for B2B leads",
  "How many retries should I use for cold outreach?",
  "What should my voicemail script say?",
  "What's a good calling schedule for real estate?",
  "Help me optimize this campaign for more answers",
];

function CampaignCopilot({ campaign, agents }: { campaign: Campaign | null; agents: AgentSummary[] }) {
  const [messages, setMessages] = useState<CopilotMsg[]>([
    { role: "assistant", content: "Hi! I'm your Campaign Copilot. I can help you plan calling schedules, write voicemail scripts, optimize retry rules, and improve your outbound campaigns. What would you like help with?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function sendMessage(text?: string) {
    const msg = text || input.trim();
    if (!msg) return;
    setInput("");
    const newMessages: CopilotMsg[] = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    setLoading(true);

    const ctx = campaign
      ? `Campaign: "${campaign.name}". Agent: ${agents.find(a => a.id === campaign.agent_id)?.name || "none"}. ` +
        `Hours: ${campaign.calling_hours_start}–${campaign.calling_hours_end} ${campaign.schedule_timezone}. ` +
        `Days: ${campaign.calling_days.join(",")}. Retries: ${campaign.max_retries}. ` +
        `Contacts: ${campaign.total_contacts}, Called: ${campaign.called}, Answered: ${campaign.answered}.`
      : "No campaign open.";

    try {
      const res = await fetch(`${API_URL}/api/copilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `[Campaign context: ${ctx}]\n\nUser question: ${msg}`,
          current_config: campaign || {},
          conversation_history: newMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMessages([...newMessages, { role: "assistant", content: data.message || "Let me help you with that." }]);
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 mt-0.5">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
            )}
            <div className={cn("max-w-[85%] rounded-xl px-3 py-2 leading-relaxed text-xs", m.role === "user" ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-200")}>
              {m.content.split("\n").map((line, j) => <p key={j} className={j > 0 ? "mt-1" : ""}>{line}</p>)}
            </div>
            {m.role === "user" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-700 mt-0.5">
                <Bot className="h-3 w-3 text-zinc-300" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 mt-0.5">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
            <div className="bg-zinc-800 rounded-xl px-3 py-2"><Loader2 className="h-4 w-4 animate-spin text-zinc-400" /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length === 1 && (
        <div className="px-4 pb-2 space-y-1">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Quick Start</p>
          {QUICK_PROMPTS.map(p => (
            <button key={p} onClick={() => sendMessage(p)}
              className="w-full text-left text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">
              → {p}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pb-4 pt-2 border-t border-zinc-800">
        <form onSubmit={e => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
          <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask anything about campaigns..." disabled={loading} className="flex-1 text-xs" />
          <Button type="submit" size="icon" disabled={loading || !input.trim()}><Send className="h-4 w-4" /></Button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Campaign Settings Editor
// ─────────────────────────────────────────────────────────────

function CampaignSettingsPanel({ campaign, agents, onSaved }: { campaign: Campaign; agents: AgentSummary[]; onSaved: (c: Campaign) => void }) {
  const [form, setForm] = useState<Partial<Campaign>>({ ...campaign });
  const [saving, setSaving] = useState(false);
  const [dncInput, setDncInput] = useState("");
  const canEdit = ["draft", "paused"].includes(campaign.status);

  function toggleDay(day: string) {
    const days = form.calling_days || [];
    setForm(p => ({ ...p, calling_days: days.includes(day) ? days.filter(d => d !== day) : [...days, day] }));
  }

  function addDnc() {
    const num = dncInput.trim();
    if (!num) return;
    setForm(p => ({ ...p, dnc_numbers: [...(p.dnc_numbers || []), num] }));
    setDncInput("");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast.success("Settings saved");
      onSaved(await res.json());
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-5 py-4 space-y-5 overflow-y-auto">
      {!canEdit && (
        <div className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
          Pause the campaign to edit settings.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-300">Campaign Name</label>
          <Input value={form.name || ""} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-300">Description / Goal</label>
          <Input placeholder="e.g. Q4 solar panel lead gen" value={form.description || ""} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} disabled={!canEdit} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-300">AI Agent</label>
        <select
          disabled={!canEdit}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          value={form.agent_id || ""}
          onChange={e => setForm(p => ({ ...p, agent_id: e.target.value || null }))}
        >
          <option value="">Select agent...</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name} {a.phone_number ? `(${a.phone_number})` : "(no number)"}</option>)}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-300">Schedule Start Date</label>
        <Input type="datetime-local" value={form.schedule_start ? form.schedule_start.slice(0, 16) : ""} onChange={e => setForm(p => ({ ...p, schedule_start: e.target.value }))} disabled={!canEdit} />
        <p className="text-xs text-zinc-500">Leave blank to start immediately when you click Start.</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-zinc-300">Calling Hours</label>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Start</label>
            <Input type="time" value={form.calling_hours_start || "09:00"} onChange={e => setForm(p => ({ ...p, calling_hours_start: e.target.value }))} disabled={!canEdit} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">End</label>
            <Input type="time" value={form.calling_hours_end || "17:00"} onChange={e => setForm(p => ({ ...p, calling_hours_end: e.target.value }))} disabled={!canEdit} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Timezone</label>
            <select disabled={!canEdit} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-100 focus:outline-none disabled:opacity-50" value={form.schedule_timezone || "America/New_York"} onChange={e => setForm(p => ({ ...p, schedule_timezone: e.target.value }))}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-1.5">
          {DAY_OPTIONS.map(d => (
            <button key={d.value} disabled={!canEdit} onClick={() => toggleDay(d.value)}
              className={cn("px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50", (form.calling_days || []).includes(d.value) ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700")}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-300">Max Retries</label>
          <Input type="number" min={0} max={10} value={form.max_retries ?? 2} onChange={e => setForm(p => ({ ...p, max_retries: parseInt(e.target.value) || 0 }))} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-300">Retry After (hours)</label>
          <Input type="number" min={1} max={72} value={form.retry_delay_hours ?? 4} onChange={e => setForm(p => ({ ...p, retry_delay_hours: parseInt(e.target.value) || 1 }))} disabled={!canEdit} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-300">Voicemail Drop URL</label>
        <Input placeholder="https://... (MP3/WAV)" value={form.voicemail_drop_url || ""} onChange={e => setForm(p => ({ ...p, voicemail_drop_url: e.target.value }))} disabled={!canEdit} />
        <p className="text-xs text-zinc-500">Audio played automatically when voicemail is detected. Leave blank to hang up.</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-300">Do Not Call (DNC) Numbers</label>
        {canEdit && (
          <div className="flex gap-2">
            <Input placeholder="+12125551234" value={dncInput} onChange={e => setDncInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addDnc())} />
            <Button variant="outline" size="sm" onClick={addDnc}>Add</Button>
          </div>
        )}
        {(form.dnc_numbers || []).length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {(form.dnc_numbers || []).map(n => (
              <span key={n} className="flex items-center gap-1 text-xs bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full">
                {n}
                {canEdit && <button onClick={() => setForm(p => ({ ...p, dnc_numbers: (p.dnc_numbers || []).filter(x => x !== n) }))} className="text-zinc-500 hover:text-red-400"><X className="h-2.5 w-2.5" /></button>}
              </span>
            ))}
          </div>
        ) : <p className="text-xs text-zinc-600">No DNC numbers. Contacts on this list will be skipped automatically.</p>}
      </div>

      {canEdit && (
        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Save className="h-3 w-3 mr-2" />}
          Save Settings
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Contact Upload
// ─────────────────────────────────────────────────────────────

function ContactUploader({ campaignId, onUploaded }: { campaignId: string; onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".csv")) return toast.error("Only CSV files supported");
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_URL}/api/campaigns/${campaignId}/contacts/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      toast.success(`Imported ${data.imported} contacts`);
      onUploaded();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <Button variant="outline" size="sm" className="text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
        {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
        Upload CSV
      </Button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Campaign Detail (contacts + settings/copilot right panel)
// ─────────────────────────────────────────────────────────────

function CampaignDetail({ campaign: init, agents, onBack, onRefresh }: { campaign: Campaign; agents: AgentSummary[]; onBack: () => void; onRefresh: () => void }) {
  const [campaign, setCampaign] = useState(init);
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [panel, setPanel] = useState<"copilot" | "settings">("copilot");

  const agent = agents.find(a => a.id === campaign.agent_id);

  useEffect(() => { loadContacts(); }, [campaign.id]);

  async function loadContacts() {
    setLoadingContacts(true);
    try {
      const res = await fetch(`${API_URL}/api/campaigns/${campaign.id}/contacts?limit=500`);
      setContacts(await res.json());
    } catch {
      toast.error("Failed to load contacts");
    } finally {
      setLoadingContacts(false);
    }
  }

  async function doAction(action: "start" | "pause" | "resume" | "cancel") {
    setActionLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/campaigns/${campaign.id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success({ start: "Campaign started!", pause: "Paused", resume: "Resumed!", cancel: "Cancelled" }[action]);
      const updated = await fetch(`${API_URL}/api/campaigns/${campaign.id}`);
      if (updated.ok) setCampaign(await updated.json());
      onRefresh();
    } catch {
      toast.error("Action failed");
    } finally {
      setActionLoading(false);
    }
  }

  const progress = campaign.total_contacts > 0 ? Math.round((campaign.called / campaign.total_contacts) * 100) : 0;
  const filtered = contacts.filter(c => !filter || c.phone.includes(filter) || c.name.toLowerCase().includes(filter.toLowerCase()) || c.status.includes(filter));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 shrink-0 bg-zinc-950">
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-200"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-zinc-100 truncate">{campaign.name}</h2>
            <Badge className={`text-[10px] shrink-0 ${STATUS_COLORS[campaign.status]}`}>{campaign.status}</Badge>
          </div>
          <p className="text-xs text-zinc-500 truncate">
            {agent ? agent.name : "No agent"} · {campaign.calling_hours_start}–{campaign.calling_hours_end} {campaign.schedule_timezone}
            {campaign.description ? ` · ${campaign.description}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {campaign.status === "draft" && (
            <Button size="sm" className="text-xs h-8" onClick={() => doAction("start")} disabled={actionLoading || campaign.total_contacts === 0}>
              {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Start
            </Button>
          )}
          {campaign.status === "running" && (
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => doAction("pause")} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />} Pause
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button size="sm" className="text-xs h-8" onClick={() => doAction("resume")} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Resume
            </Button>
          )}
          {["draft", "paused"].includes(campaign.status) && (
            <Button size="sm" variant="outline" className="text-xs h-8 text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => doAction("cancel")} disabled={actionLoading}>
              <StopCircle className="h-3 w-3" /> Cancel
            </Button>
          )}
          <ContactUploader campaignId={campaign.id} onUploaded={loadContacts} />
          <button onClick={() => { onRefresh(); loadContacts(); }} className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body: left contacts + right panel */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Stats + Contacts ────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Stats row */}
          <div className="grid grid-cols-5 gap-2 px-5 py-3 shrink-0 border-b border-zinc-800">
            {[
              { label: "Total", value: campaign.total_contacts, icon: Users, color: "text-zinc-300" },
              { label: "Called", value: campaign.called, icon: PhoneCall, color: "text-blue-400" },
              { label: "Answered", value: campaign.answered, icon: CheckCircle2, color: "text-green-400" },
              { label: "Voicemail", value: campaign.voicemail, icon: Phone, color: "text-purple-400" },
              { label: "Failed", value: campaign.failed, icon: X, color: "text-red-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="flex flex-col items-center justify-center bg-zinc-900 rounded-lg p-2">
                <Icon className={`h-3.5 w-3.5 mb-0.5 ${color}`} />
                <span className="text-lg font-bold text-zinc-100">{value}</span>
                <span className="text-[10px] text-zinc-500">{label}</span>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {campaign.total_contacts > 0 && (
            <div className="px-5 py-2.5 shrink-0 border-b border-zinc-800">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-zinc-400">Progress</span>
                <span className="text-xs text-zinc-400">{progress}% · {campaign.called}/{campaign.total_contacts}</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Empty state */}
          {campaign.total_contacts === 0 && !loadingContacts && (
            <div className="px-6 py-10 text-center text-zinc-500">
              <Upload className="h-10 w-10 mx-auto mb-3 text-zinc-700" />
              <p className="text-sm font-medium text-zinc-300">No contacts yet</p>
              <p className="text-xs mt-1">Upload a CSV with a <span className="text-indigo-400 font-medium">phone</span> column to get started.</p>
              <p className="text-xs text-zinc-600 mt-1">Optional columns: name, email, company, or any custom field</p>
            </div>
          )}

          {/* Contacts table */}
          {contacts.length > 0 && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-5 py-2 border-b border-zinc-800 shrink-0">
                <Input placeholder="Filter by name, phone, or status..." className="text-xs h-7" value={filter} onChange={e => setFilter(e.target.value)} />
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-950 border-b border-zinc-800">
                    <tr>
                      {["Name", "Phone", "Status", "Attempts", "Last Called"].map(h => (
                        <th key={h} className="px-5 py-2 text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {filtered.map(c => (
                      <tr key={c.id} className="hover:bg-zinc-900/50">
                        <td className="px-5 py-2.5 text-zinc-300 text-xs">{c.name || <span className="text-zinc-600">—</span>}</td>
                        <td className="px-5 py-2.5 text-zinc-300 font-mono text-xs">{c.phone}</td>
                        <td className="px-5 py-2.5">
                          <Badge className={`text-[10px] ${CONTACT_STATUS_COLORS[c.status] || "bg-zinc-700 text-zinc-300"}`}>{c.status}</Badge>
                        </td>
                        <td className="px-5 py-2.5 text-zinc-400 text-xs">{c.attempts}</td>
                        <td className="px-5 py-2.5 text-zinc-500 text-xs">
                          {c.last_called_at ? new Date(c.last_called_at).toLocaleString() : <span className="text-zinc-700">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Copilot / Settings panel ──────────── */}
        <div className="w-[360px] shrink-0 flex flex-col overflow-hidden border-l border-zinc-800">
          {/* Tab toggle */}
          <div className="flex border-b border-zinc-800 shrink-0">
            <button onClick={() => setPanel("copilot")}
              className={cn("flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors", panel === "copilot" ? "text-indigo-400 border-b-2 border-indigo-500" : "text-zinc-500 hover:text-zinc-300")}>
              <Sparkles className="h-3 w-3" /> Copilot
            </button>
            <button onClick={() => setPanel("settings")}
              className={cn("flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors", panel === "settings" ? "text-indigo-400 border-b-2 border-indigo-500" : "text-zinc-500 hover:text-zinc-300")}>
              <Settings className="h-3 w-3" /> Settings
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            {panel === "copilot"
              ? <CampaignCopilot campaign={campaign} agents={agents} />
              : <div className="overflow-y-auto h-full"><CampaignSettingsPanel campaign={campaign} agents={agents} onSaved={c => { setCampaign(c); onRefresh(); }} /></div>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Create Campaign Modal
// ─────────────────────────────────────────────────────────────

function CampaignFormModal({ agents, onClose, onCreated }: { agents: AgentSummary[]; onClose: () => void; onCreated: (c: Campaign) => void }) {
  const [form, setForm] = useState<Partial<Campaign>>({ ...DEFAULT_CAMPAIGN });
  const [saving, setSaving] = useState(false);
  const [dncInput, setDncInput] = useState("");

  function toggleDay(day: string) {
    const days = form.calling_days || [];
    setForm(p => ({ ...p, calling_days: days.includes(day) ? days.filter(d => d !== day) : [...days, day] }));
  }

  async function handleSave() {
    if (!form.name?.trim()) return toast.error("Campaign name is required");
    if (!form.agent_id) return toast.error("Select an agent for this campaign");
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/campaigns`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast.success("Campaign created!");
      onCreated(await res.json());
    } catch {
      toast.error("Failed to create campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <span className="font-semibold text-zinc-100">New Campaign</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name + Description */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">Campaign Name *</label>
              <Input placeholder="e.g. Q4 Solar Lead Gen" value={form.name || ""} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">Description / Goal</label>
              <Input placeholder="e.g. Solar panel leads" value={form.description || ""} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
          </div>

          {/* Agent */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">AI Agent *</label>
            <select
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={form.agent_id || ""}
              onChange={e => setForm(p => ({ ...p, agent_id: e.target.value || null }))}
            >
              <option value="">Select agent...</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name} {a.phone_number ? `(${a.phone_number})` : "(no number)"}</option>)}
            </select>
            {agents.length === 0 && <p className="text-xs text-yellow-400">No agents found. <Link href="/" className="underline">Create one first.</Link></p>}
          </div>

          {/* Schedule start */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Schedule Start (optional)</label>
            <Input type="datetime-local" value={form.schedule_start || ""} onChange={e => setForm(p => ({ ...p, schedule_start: e.target.value }))} />
            <p className="text-xs text-zinc-500">Leave blank to start immediately when you click Start.</p>
          </div>

          {/* Calling schedule */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">Calling Schedule</label>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Start Time</label>
                <Input type="time" value={form.calling_hours_start || "09:00"} onChange={e => setForm(p => ({ ...p, calling_hours_start: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">End Time</label>
                <Input type="time" value={form.calling_hours_end || "17:00"} onChange={e => setForm(p => ({ ...p, calling_hours_end: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Timezone</label>
                <select className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-100 focus:outline-none" value={form.schedule_timezone || "America/New_York"} onChange={e => setForm(p => ({ ...p, schedule_timezone: e.target.value }))}>
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-1.5">
              {DAY_OPTIONS.map(d => (
                <button key={d.value} onClick={() => toggleDay(d.value)}
                  className={cn("px-2.5 py-1 rounded text-xs font-medium transition-colors", (form.calling_days || []).includes(d.value) ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700")}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Retry */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">Max Retries</label>
              <Input type="number" min={0} max={10} value={form.max_retries ?? 2} onChange={e => setForm(p => ({ ...p, max_retries: parseInt(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">Retry After (hours)</label>
              <Input type="number" min={1} max={72} value={form.retry_delay_hours ?? 4} onChange={e => setForm(p => ({ ...p, retry_delay_hours: parseInt(e.target.value) || 1 }))} />
            </div>
          </div>

          {/* Voicemail */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Voicemail Drop URL (optional)</label>
            <Input placeholder="https://... (MP3/WAV URL)" value={form.voicemail_drop_url || ""} onChange={e => setForm(p => ({ ...p, voicemail_drop_url: e.target.value }))} />
          </div>

          {/* DNC */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">DNC Numbers (optional)</label>
            <div className="flex gap-2">
              <Input placeholder="+12125551234" value={dncInput} onChange={e => setDncInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), (() => { if (dncInput.trim()) { setForm(p => ({ ...p, dnc_numbers: [...(p.dnc_numbers || []), dncInput.trim()] })); setDncInput(""); } })())} />
              <Button variant="outline" size="sm" onClick={() => { if (dncInput.trim()) { setForm(p => ({ ...p, dnc_numbers: [...(p.dnc_numbers || []), dncInput.trim()] })); setDncInput(""); } }}>Add</Button>
            </div>
            {(form.dnc_numbers || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(form.dnc_numbers || []).map(n => (
                  <span key={n} className="flex items-center gap-1 text-xs bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full">
                    {n}<button onClick={() => setForm(p => ({ ...p, dnc_numbers: (p.dnc_numbers || []).filter(x => x !== n) }))}><X className="h-2.5 w-2.5 text-zinc-500 hover:text-red-400" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-zinc-800 flex justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Create Campaign
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [campRes, agentRes] = await Promise.all([fetch(`${API_URL}/api/campaigns`), fetch(`${API_URL}/api/agents`)]);
      const [campData, agentData] = await Promise.all([campRes.json(), agentRes.json()]);
      setCampaigns(campData);
      setAgents(agentData);
      if (selected) {
        const updated = campData.find((c: Campaign) => c.id === selected.id);
        if (updated) setSelected(updated);
      }
    } catch {
      toast.error("Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this campaign and all its contacts?")) return;
    setDeletingId(id);
    try {
      await fetch(`${API_URL}/api/campaigns/${id}`, { method: "DELETE" });
      setCampaigns(prev => prev.filter(c => c.id !== id));
      if (selected?.id === id) setSelected(null);
      toast.success("Campaign deleted");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeletingId(null);
    }
  }

  if (selected) {
    return (
      <div className="flex flex-col h-screen bg-zinc-950">
        <Header />
        <div className="flex-1 overflow-hidden">
          <CampaignDetail campaign={selected} agents={agents} onBack={() => setSelected(null)} onRefresh={loadAll} />
        </div>
      </div>
    );
  }

  const totalCalled = campaigns.reduce((s, c) => s + c.called, 0);
  const totalAnswered = campaigns.reduce((s, c) => s + c.answered, 0);
  const running = campaigns.filter(c => c.status === "running").length;

  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      <Header />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-zinc-100">Outbound Campaigns</h1>
              <p className="text-sm text-zinc-400 mt-1">Upload contact lists, schedule calls, and run automated outbound campaigns with AI agents.</p>
            </div>
            <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" />New Campaign</Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[
              { label: "Total Campaigns", value: campaigns.length, icon: BarChart3, color: "text-indigo-400" },
              { label: "Running Now", value: running, icon: Play, color: "text-green-400" },
              { label: "Total Called", value: totalCalled, icon: PhoneCall, color: "text-blue-400" },
              { label: "Leads Answered", value: totalAnswered, icon: CheckCircle2, color: "text-emerald-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-zinc-800 ${color}`}><Icon className="h-4 w-4" /></div>
                <div><div className="text-xl font-bold text-zinc-100">{value}</div><div className="text-xs text-zinc-500">{label}</div></div>
              </div>
            ))}
          </div>

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-20 bg-zinc-900 rounded-xl border border-zinc-800">
              <PhoneCall className="h-12 w-12 mx-auto mb-4 text-zinc-700" />
              <h3 className="text-lg font-semibold text-zinc-300">No campaigns yet</h3>
              <p className="text-sm text-zinc-500 mt-2 max-w-sm mx-auto">Create a campaign to start making automated outbound calls with your AI agents.</p>
              <Button className="mt-6" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" />Create First Campaign</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map(c => {
                const a = agents.find(ag => ag.id === c.agent_id);
                const prog = c.total_contacts > 0 ? Math.round((c.called / c.total_contacts) * 100) : 0;
                return (
                  <div key={c.id} onClick={() => setSelected(c)} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 cursor-pointer hover:border-zinc-600 transition-colors group">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-zinc-100 truncate">{c.name}</span>
                          <Badge className={`text-[10px] shrink-0 ${STATUS_COLORS[c.status]}`}>{c.status}</Badge>
                        </div>
                        {c.description && <p className="text-xs text-zinc-500 mb-1">{c.description}</p>}
                        <div className="flex items-center gap-3 text-xs text-zinc-500">
                          <span className="flex items-center gap-1"><Bot className="h-3 w-3" />{a ? a.name : "No agent"}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{c.calling_hours_start}–{c.calling_hours_end}</span>
                          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.total_contacts} contacts</span>
                        </div>
                        {c.total_contacts > 0 && (
                          <div className="mt-2">
                            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${prog}%` }} />
                            </div>
                            <div className="flex gap-4 mt-1 text-xs text-zinc-500">
                              <span>{c.called} called</span>
                              <span className="text-green-400">{c.answered} answered</span>
                              <span className="text-purple-400">{c.voicemail} voicemail</span>
                              <span className="text-red-400">{c.failed} failed</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <button onClick={e => handleDelete(c.id, e)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-zinc-600 hover:text-red-400 transition-all shrink-0">
                        {deletingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* CSV guide */}
          <div className="mt-8 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">CSV Format Guide</h4>
            <p className="text-xs text-zinc-500 mb-2">
              Must include a <code className="text-indigo-400 bg-zinc-800 px-1 rounded">phone</code> column. All other columns are stored as custom fields on each contact.
            </p>
            <div className="font-mono text-xs bg-zinc-950 rounded-lg p-3 text-zinc-400 overflow-x-auto">
              <div className="text-zinc-300">phone,name,email,company</div>
              <div>+12125551234,John Smith,john@acme.com,Acme Corp</div>
              <div>+13105559876,Jane Doe,jane@example.com,Example Inc</div>
            </div>
          </div>
        </div>
      </main>

      {creating && (
        <CampaignFormModal
          agents={agents}
          onClose={() => setCreating(false)}
          onCreated={c => { setCampaigns(prev => [c, ...prev]); setCreating(false); setSelected(c); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared Nav Header
// ─────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="flex items-center gap-4 px-5 py-3 border-b border-zinc-800 bg-zinc-950 shrink-0">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
          <PhoneCall className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="font-bold text-zinc-100 text-sm">VoiceFlow</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Link href="/"><Button variant="ghost" size="sm" className="text-xs"><Bot className="h-3.5 w-3.5" />Agents</Button></Link>
        <Link href="/campaigns"><Button variant="ghost" size="sm" className="text-xs bg-zinc-800"><PhoneCall className="h-3.5 w-3.5" />Campaigns</Button></Link>
        <Link href="/dashboard"><Button variant="ghost" size="sm" className="text-xs"><LayoutDashboard className="h-3.5 w-3.5" />Dashboard</Button></Link>
      </div>
    </header>
  );
}
