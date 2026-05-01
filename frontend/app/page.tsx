"use client";

import { useState, useEffect } from "react";
import { AgentConfig, DEFAULT_AGENT } from "@/lib/types";
import AgentForm from "@/components/AgentForm";
import CopilotSidebar from "@/components/CopilotSidebar";
import { Button } from "@/components/ui/button";
import { API_URL, cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  PhoneCall, LayoutDashboard, Plus, CheckCircle2,
  Loader2, Save, Bot, Phone, Trash2, BookOpen, X,
} from "lucide-react";
import Link from "next/link";
import KnowledgeBasePanel from "@/components/KnowledgeBasePanel";

type AgentSummary = { id: string; name: string; phone_number: string; enabled: boolean; goal: string };

const GOAL_ICONS: Record<string, string> = {
  collect_lead: "🎯",
  book_appointment: "📅",
  qualify: "✅",
  survey: "📋",
  customer_support: "🎧",
  ivr_routing: "🔀",
  reminder: "🔔",
  custom: "⚙️",
};

export default function Home() {
  const [config, setConfig] = useState<AgentConfig>({ ...DEFAULT_AGENT });
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [appKbOpen, setAppKbOpen] = useState(false);

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    try {
      const res = await fetch(`${API_URL}/api/agents`);
      const data = await res.json();
      setAgents(data);
    } catch { /* backend not running yet is fine in dev */ }
  }

  async function handleSave() {
    if (!config.name) return toast.error("Give the agent a name first");
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      setConfig((prev: AgentConfig) => ({ ...prev, id: data.id }));
      setSaved(true);
      toast.success("Agent saved!");
      loadAgents();
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast.error("Failed to save agent. Is the backend running?");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this agent?")) return;
    setDeleting(id);
    try {
      await fetch(`${API_URL}/api/agents/${id}`, { method: "DELETE" });
      if (config.id === id) setConfig({ ...DEFAULT_AGENT });
      loadAgents();
      toast.success("Agent deleted");
    } catch {
      toast.error("Failed to delete agent");
    } finally {
      setDeleting(null);
    }
  }

  function loadAgent(id: string) {
    fetch(`${API_URL}/api/agents/${id}`)
      .then((r) => r.json())
      .then((data) => setConfig({ ...DEFAULT_AGENT, ...data }));
  }

  function newAgent() {
    setConfig({ ...DEFAULT_AGENT });
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-zinc-950">
      {/* Top Nav */}
      <header className="flex items-center gap-4 px-5 py-3 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
            <PhoneCall className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="font-bold text-zinc-100 text-sm">VoiceFlow</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-xs bg-zinc-800">
              <Bot className="h-3.5 w-3.5" />
              Agents
            </Button>
          </Link>
          <Link href="/campaigns">
            <Button variant="ghost" size="sm" className="text-xs">
              <PhoneCall className="h-3.5 w-3.5" />
              Campaigns
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="text-xs">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </Button>
          </Link>
        </div>
      </header>

      {/* 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT SIDEBAR: Agent List ─────────────────────── */}
        <aside className="w-60 shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900/50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Agents</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setAppKbOpen(true)}
                className="p-1 rounded-lg text-zinc-500 hover:text-indigo-400 hover:bg-zinc-800 transition-colors"
                title="App Knowledge Base (used by Copilot)"
              >
                <BookOpen className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={newAgent}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
                title="New agent"
              >
                <Plus className="h-3 w-3" /> New
              </button>
            </div>
          </div>

          {/* Agent list */}
          <div className="flex-1 overflow-y-auto py-2">
            {agents.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bot className="h-8 w-8 text-zinc-700 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">No agents yet</p>
                <p className="text-xs text-zinc-600 mt-1">Click New to create one</p>
              </div>
            ) : (
              agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => loadAgent(a.id)}
                  className={cn(
                    "group w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800",
                    config.id === a.id && "bg-zinc-800 border-l-2 border-indigo-500"
                  )}
                >
                  <span className="text-base mt-0.5 shrink-0">{GOAL_ICONS[a.goal] ?? "⚙️"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-zinc-200 font-medium truncate">{a.name}</span>
                      {a.enabled && <div className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" title="Active" />}
                    </div>
                    {a.phone_number ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Phone className="h-2.5 w-2.5 text-zinc-500" />
                        <span className="text-xs text-zinc-500 truncate">{a.phone_number}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">No number</span>
                    )}
                  </div>
                  <button
                    onClick={(e) => handleDelete(a.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-600 hover:text-red-400 transition-all shrink-0"
                    title="Delete agent"
                  >
                    {deleting === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </button>
              ))
            )}
          </div>

          {/* Bottom: current agent quick actions */}
          <div className="border-t border-zinc-800 p-3 space-y-2">
            {saved ? (
              <div className="flex items-center justify-center gap-1.5 text-green-400 text-xs py-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved!
              </div>
            ) : (
              <Button onClick={handleSave} disabled={saving} className="w-full h-8 text-xs">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {saving ? "Saving..." : config.id ? "Save Changes" : "Save Agent"}
              </Button>
            )}
          </div>
        </aside>

        {/* ── CENTER: Agent Form ───────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <AgentForm config={config} onChange={setConfig} onSave={handleSave} saving={saving} />
        </div>

        {/* ── RIGHT: Copilot ───────────────────────────────── */}
        <div className="w-[380px] shrink-0 flex flex-col overflow-hidden border-l border-zinc-800">
          <CopilotSidebar config={config} onConfigChange={setConfig} />
        </div>
      </div>

      {/* ── App Knowledge Base Modal ────────────────────── */}
      {appKbOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-indigo-400" />
                <span className="font-semibold text-sm text-zinc-100">App Knowledge Base</span>
              </div>
              <button onClick={() => setAppKbOpen(false)} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <p className="text-xs text-zinc-400 mb-4">
                Documents uploaded here are available to the <span className="text-indigo-400 font-medium">Copilot assistant</span> in the sidebar.
                Use it to store company information, product details, or setup guides — the Copilot will use them when helping you configure agents.
              </p>
              <KnowledgeBasePanel
                label="Copilot Documents"
                hint="The Copilot retrieves relevant passages when you chat with it, helping it suggest more accurate agent configs."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
