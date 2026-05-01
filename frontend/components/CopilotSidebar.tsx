"use client";

import { useState, useRef, useEffect } from "react";
import { AgentConfig, CopilotMessage, SimulationTurn } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, Sparkles, PhoneCall, Loader2, ChevronRight, User, Bot, Wand2 } from "lucide-react";
import { API_URL, cn } from "@/lib/utils";
import { toast } from "sonner";

// Deep-merge patch into config
function applyPatch(config: AgentConfig, patch: Record<string, unknown>): AgentConfig {
  const result = { ...config };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "call_flow" && typeof value === "object" && value !== null) {
      result.call_flow = { ...result.call_flow, ...(value as object) };
    } else if (key === "lead_fields" && Array.isArray(value)) {
      result.lead_fields = value as AgentConfig["lead_fields"];
    } else if (value !== null && value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

interface Props {
  config: AgentConfig;
  onConfigChange: (updated: AgentConfig) => void;
}

const QUICK_PROMPTS = [
  "Create a real estate buyer qualification agent",
  "Build a dental appointment reminder agent",
  "Make a solar panel lead generation agent",
  "Set up a recruitment screening agent",
];

export default function CopilotSidebar({ config, onConfigChange }: Props) {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your AI agent builder. Describe what you want your calling agent to do in plain English and I'll configure it for you.\n\nFor example: *\"Create a real estate agent that qualifies inbound buyers and books viewings\"*",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [simulation, setSimulation] = useState<SimulationTurn[] | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, simulation]);

  async function sendMessage(text?: string) {
    const msg = text || input.trim();
    if (!msg) return;

    setInput("");
    setSimulation(null);
    const newMessages: CopilotMessage[] = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const historyForApi = newMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch(`${API_URL}/api/copilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          current_config: config,
          conversation_history: historyForApi,
        }),
      });

      if (!res.ok) throw new Error("Copilot request failed");
      const data = await res.json();

      // Apply patch to config
      if (data.patch && Object.keys(data.patch).length > 0) {
        onConfigChange(applyPatch(config, data.patch));
      }

      setMessages([...newMessages, { role: "assistant", content: data.message }]);

      // If simulate was requested
      if (data.simulate && data.mock_conversation?.length > 0) {
        setSimulation(data.mock_conversation);
      }
    } catch {
      setMessages([
        ...newMessages,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function runSimulation() {
    setSimLoading(true);
    setSimulation(null);
    try {
      const res = await fetch(`${API_URL}/api/copilot/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          scenario: "typical interested caller",
        }),
      });
      if (!res.ok) throw new Error("Simulation failed");
      const data = await res.json();
      setSimulation(data.conversation || []);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Here's a simulated call conversation based on your current config:" },
      ]);
    } catch {
      toast.error("Simulation failed. Check your config and API key.");
    } finally {
      setSimLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-l border-zinc-800">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="font-semibold text-sm text-zinc-100">Agent Copilot</span>
        <Badge className="ml-auto text-[10px] bg-indigo-600/20 text-indigo-400 border-indigo-500/30">AI</Badge>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 mt-0.5">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 leading-relaxed",
                m.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-800 text-zinc-200"
              )}
            >
              {m.content.split("\n").map((line, j) => (
                <p key={j} className={j > 0 ? "mt-1" : ""}>
                  {line.replace(/\*([^*]+)\*/g, "$1")}
                </p>
              ))}
            </div>
            {m.role === "user" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-700 mt-0.5">
                <User className="h-3 w-3 text-zinc-300" />
              </div>
            )}
          </div>
        ))}

        {/* Simulation */}
        {simulation && simulation.length > 0 && (
          <div className="rounded-xl border border-zinc-700 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border-b border-zinc-700">
              <PhoneCall className="h-3.5 w-3.5 text-green-400" />
              <span className="text-xs font-medium text-zinc-300">Simulated Call Preview</span>
            </div>
            <div className="p-3 space-y-2">
              {simulation.map((turn, i) => (
                <div key={i} className={cn("flex gap-2 text-xs", turn.role === "agent" ? "justify-start" : "justify-end")}>
                  {turn.role === "agent" && (
                    <Bot className="h-3.5 w-3.5 shrink-0 text-indigo-400 mt-0.5" />
                  )}
                  <span
                    className={cn(
                      "px-2 py-1 rounded-lg max-w-[85%]",
                      turn.role === "agent" ? "bg-zinc-700 text-zinc-200" : "bg-indigo-600/30 text-zinc-200"
                    )}
                  >
                    {turn.text}
                  </span>
                  {turn.role === "user" && (
                    <User className="h-3.5 w-3.5 shrink-0 text-zinc-400 mt-0.5" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 mt-0.5">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
            <div className="bg-zinc-800 rounded-xl px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length === 1 && (
        <div className="px-4 pb-2 space-y-1">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Quick Start</p>
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => sendMessage(p)}
              className="w-full text-left text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors flex items-center gap-1"
            >
              <ChevronRight className="h-3 w-3 text-indigo-400 shrink-0" />
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Simulate + Improve buttons */}
      <div className="px-4 pb-2 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={runSimulation}
          disabled={simLoading || !config.name}
        >
          {simLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <PhoneCall className="h-3 w-3" />}
          Simulate Call
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => sendMessage("Improve and rewrite the instructions for this agent. Make them detailed, professional, and specific to the goal.")}
          disabled={loading || !config.name}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          Improve Instructions
        </Button>
      </div>

      {/* Input */}
      <div className="px-4 pb-4">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe what you want..."
            disabled={loading}
            className="flex-1 text-xs"
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
