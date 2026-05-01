"use client";

import { useState } from "react";
import { AgentTool, DEFAULT_TOOL } from "@/lib/types";
import { Plus, Trash2, ChevronDown, ChevronUp, ToggleLeft, ToggleRight } from "lucide-react";

interface Props {
  tools: AgentTool[];
  onChange: (tools: AgentTool[]) => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-900/40 text-emerald-300",
  POST: "bg-blue-900/40 text-blue-300",
  PUT: "bg-amber-900/40 text-amber-300",
  PATCH: "bg-purple-900/40 text-purple-300",
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 40);
}

export default function AgentToolBuilder({ tools, onChange }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const addTool = () => {
    const newTool: AgentTool = { ...DEFAULT_TOOL, id: `tool_${Date.now()}` };
    const updated = [...tools, newTool];
    onChange(updated);
    setExpanded(updated.length - 1);
  };

  const removeTool = (idx: number) => {
    const updated = tools.filter((_, i) => i !== idx);
    onChange(updated);
    if (expanded === idx) setExpanded(null);
  };

  const updateTool = (idx: number, patch: Partial<AgentTool>) => {
    const updated = tools.map((t, i) => {
      if (i !== idx) return t;
      const merged = { ...t, ...patch };
      // Auto-sync id from name if id hasn't been manually edited
      if (patch.name !== undefined) {
        merged.id = slugify(patch.name) || merged.id;
      }
      return merged;
    });
    onChange(updated);
  };

  const updateHeader = (toolIdx: number, key: string, value: string, oldKey?: string) => {
    const tool = tools[toolIdx];
    const headers = { ...tool.headers };
    if (oldKey && oldKey !== key) {
      delete headers[oldKey];
    }
    if (key) headers[key] = value;
    updateTool(toolIdx, { headers });
  };

  const removeHeader = (toolIdx: number, key: string) => {
    const headers = { ...tools[toolIdx].headers };
    delete headers[key];
    updateTool(toolIdx, { headers });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-sm font-medium text-white">HTTP Tools</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Let the agent call external APIs during conversations — check availability, look up records, create tickets.
          </p>
        </div>
        <button
          onClick={addTool}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Tool
        </button>
      </div>

      {tools.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-xl p-6 text-center">
          <p className="text-gray-500 text-sm">No tools yet. Add a tool to let the agent query APIs in real time.</p>
          <p className="text-gray-600 text-xs mt-1">Example: check appointment availability, look up a customer, create a support ticket.</p>
        </div>
      )}

      {tools.map((tool, idx) => (
        <div key={idx} className="border border-white/10 rounded-xl overflow-hidden bg-white/2">
          {/* Header row */}
          <div
            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/3 transition-colors"
            onClick={() => setExpanded(expanded === idx ? null : idx)}
          >
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${METHOD_COLORS[tool.method] || "bg-gray-700 text-gray-300"}`}>
              {tool.method}
            </span>
            <span className="flex-1 text-sm text-white font-medium truncate">
              {tool.name || <span className="text-gray-500 italic">Untitled tool</span>}
            </span>
            {tool.url && (
              <span className="text-xs text-gray-500 truncate max-w-40 hidden sm:block">{tool.url}</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); updateTool(idx, { enabled: !tool.enabled }); }}
              className="ml-2 text-gray-400 hover:text-white transition-colors"
              title={tool.enabled ? "Disable tool" : "Enable tool"}
            >
              {tool.enabled
                ? <ToggleRight className="w-4 h-4 text-blue-400" />
                : <ToggleLeft className="w-4 h-4 text-gray-500" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); removeTool(idx); }}
              className="text-gray-500 hover:text-red-400 transition-colors ml-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            {expanded === idx ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>

          {/* Expanded editor */}
          {expanded === idx && (
            <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Tool Name *</label>
                  <input
                    value={tool.name}
                    onChange={e => updateTool(idx, { name: e.target.value })}
                    placeholder="Check Availability"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Function ID <span className="text-gray-600">(auto)</span>
                  </label>
                  <input
                    value={tool.id}
                    onChange={e => updateTool(idx, { id: slugify(e.target.value) || tool.id })}
                    placeholder="check_availability"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-400 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Description * <span className="text-gray-600">(tell the AI when to use this)</span></label>
                <textarea
                  value={tool.description}
                  onChange={e => updateTool(idx, { description: e.target.value })}
                  placeholder="Call this tool when the user asks about appointment availability or wants to book a time."
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Method</label>
                  <select
                    value={tool.method}
                    onChange={e => updateTool(idx, { method: e.target.value as AgentTool["method"] })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-gray-400 mb-1">
                    URL <span className="text-gray-600">(use {"{variable}"} for dynamic values)</span>
                  </label>
                  <input
                    value={tool.url}
                    onChange={e => updateTool(idx, { url: e.target.value })}
                    placeholder="https://api.example.com/slots?date={date}&service={service}"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Headers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-400">Headers</label>
                  <button
                    onClick={() => updateHeader(idx, `X-Header-${Object.keys(tool.headers).length + 1}`, "")}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    + Add header
                  </button>
                </div>
                {Object.entries(tool.headers).map(([key, value]) => (
                  <div key={key} className="flex gap-2 mb-1.5">
                    <input
                      defaultValue={key}
                      onBlur={e => updateHeader(idx, e.target.value, value, key)}
                      placeholder="Authorization"
                      className="w-2/5 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <input
                      value={value}
                      onChange={e => updateHeader(idx, key, e.target.value)}
                      placeholder="Bearer {api_key}"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <button onClick={() => removeHeader(idx, key)} className="text-gray-500 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Body template (only for non-GET) */}
              {tool.method !== "GET" && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Request Body (JSON) <span className="text-gray-600">(use {"{variable}"} placeholders)</span>
                  </label>
                  <textarea
                    value={tool.body_template}
                    onChange={e => updateTool(idx, { body_template: e.target.value })}
                    placeholder={'{\n  "date": "{date}",\n  "service": "{service}",\n  "customer_name": "{name}"\n}'}
                    rows={4}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono resize-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Result Path <span className="text-gray-600">(dot-path to extract from JSON response, e.g. data.slots)</span>
                </label>
                <input
                  value={tool.result_path}
                  onChange={e => updateTool(idx, { result_path: e.target.value })}
                  placeholder="data.available_slots"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="bg-blue-950/30 border border-blue-500/20 rounded-lg p-3">
                <p className="text-xs text-blue-300 font-medium mb-1">How variables work</p>
                <p className="text-xs text-blue-300/70">
                  Variables like <code className="bg-blue-900/40 px-1 rounded">{"{date}"}</code> in the URL, headers, or body are extracted by the LLM from the conversation. The LLM will ask the user for any missing values before calling the tool.
                </p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
