"use client";

import { useState, useEffect } from "react";
import { CallRecord } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration, formatDate, API_URL } from "@/lib/utils";
import { Download, PhoneCall, Clock, TrendingUp, RefreshCw, X, ChevronRight } from "lucide-react";
import { toast } from "sonner";

function ScoreBadge({ score }: { score: string }) {
  const variant = score === "hot" ? "hot" : score === "warm" ? "warm" : "cold";
  return <Badge variant={variant}>{score.toUpperCase()}</Badge>;
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold text-zinc-100">{value}</div>
    </div>
  );
}

export default function CallLogDashboard({ agentId }: { agentId?: string }) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CallRecord | null>(null);

  async function loadCalls() {
    setLoading(true);
    try {
      const url = agentId
        ? `${API_URL}/api/calls?agent_id=${agentId}`
        : `${API_URL}/api/calls`;
      const res = await fetch(url);
      const data = await res.json();
      setCalls(data);
    } catch {
      toast.error("Failed to load calls");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCalls(); }, [agentId]);

  async function updateStatus(id: string, status: string) {
    await fetch(`${API_URL}/api/calls/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setCalls((prev: CallRecord[]) => prev.map((c: CallRecord) => c.id === id ? { ...c, status } : c));
    if (selected?.id === id) setSelected((prev: CallRecord | null) => prev ? { ...prev, status } : null);
  }

  function exportCSV() {
    const url = agentId
      ? `${API_URL}/api/calls/export?agent_id=${agentId}`
      : `${API_URL}/api/calls/export`;
    window.open(url, "_blank");
  }

  const total = calls.length;
  const hot = calls.filter((c) => c.lead_score === "hot").length;
  const avgDuration = total
    ? Math.round(calls.reduce((s, c) => s + c.duration_seconds, 0) / total)
    : 0;
  const conversionRate = total ? Math.round((hot / total) * 100) : 0;

  return (
    <div className="flex h-full">
      {/* Main table */}
      <div className="flex-1 overflow-auto p-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Calls" value={total} icon={<PhoneCall className="h-3.5 w-3.5" />} />
          <StatCard label="Hot Leads" value={hot} icon={<TrendingUp className="h-3.5 w-3.5" />} />
          <StatCard label="Avg Duration" value={formatDuration(avgDuration)} icon={<Clock className="h-3.5 w-3.5" />} />
          <StatCard label="Hot Rate" value={`${conversionRate}%`} icon={<TrendingUp className="h-3.5 w-3.5" />} />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-300">Call Log</h2>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={loadCalls} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900 border-b border-zinc-800">
                <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Date</th>
                <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Phone</th>
                <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Duration</th>
                <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Outcome</th>
                <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Score</th>
                <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Summary</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-zinc-500">Loading calls...</td>
                </tr>
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-zinc-500">
                    No calls yet. Assign an agent to a phone number to start receiving calls.
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr
                    key={call.id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                    onClick={() => setSelected(call)}
                  >
                    <td className="px-4 py-3 text-zinc-400 text-xs">{formatDate(call.created_at)}</td>
                    <td className="px-4 py-3 text-zinc-200">{call.phone_number}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">{formatDuration(call.duration_seconds)}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs capitalize">{call.outcome.replace("_", " ")}</td>
                    <td className="px-4 py-3"><ScoreBadge score={call.lead_score} /></td>
                    <td className="px-4 py-3 text-zinc-400 text-xs max-w-xs truncate">{call.summary}</td>
                    <td className="px-4 py-3">
                      <ChevronRight className="h-4 w-4 text-zinc-600" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-96 border-l border-zinc-800 bg-zinc-950 overflow-auto flex-shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">Call Detail</h3>
            <button onClick={() => setSelected(null)} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-5">
            {/* Meta */}
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Phone</span>
                <span className="text-zinc-200">{selected.phone_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Duration</span>
                <span className="text-zinc-200">{formatDuration(selected.duration_seconds)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Score</span>
                <ScoreBadge score={selected.lead_score} />
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Outcome</span>
                <span className="text-zinc-200 capitalize">{selected.outcome.replace("_", " ")}</span>
              </div>
            </div>

            {/* Status update */}
            <div>
              <p className="text-xs text-zinc-500 mb-2">Update Status</p>
              <div className="flex gap-2 flex-wrap">
                {["hot", "warm", "cold", "converted", "rejected"].map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(selected.id, s)}
                    className={`px-2 py-1 text-xs rounded-full border transition-colors capitalize ${
                      selected.status === s
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Extracted fields */}
            {Object.keys(selected.extracted_fields || {}).length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wide">Extracted Lead Data</p>
                <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800">
                  {Object.entries(selected.extracted_fields).map(([k, v]) => (
                    <div key={k} className="flex justify-between px-3 py-2 text-xs">
                      <span className="text-zinc-400 capitalize">{k.replace(/_/g, " ")}</span>
                      <span className="text-zinc-200 max-w-[55%] text-right">{v || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Summary */}
            {selected.summary && (
              <div>
                <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wide">Summary</p>
                <p className="text-xs text-zinc-300 leading-relaxed">{selected.summary}</p>
              </div>
            )}

            {/* Transcript */}
            {selected.transcript?.length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wide">Transcript</p>
                <div className="space-y-2">
                  {selected.transcript.map((t: { role: string; text: string; timestamp: number }, i: number) => (
                    <div key={i} className={`flex gap-2 text-xs ${t.role === "agent" ? "" : "justify-end"}`}>
                      {t.role === "agent" && (
                        <span className="text-[10px] text-indigo-400 shrink-0 mt-0.5">AI</span>
                      )}
                      <span
                        className={`px-2 py-1 rounded-lg max-w-[85%] ${
                          t.role === "agent"
                            ? "bg-zinc-800 text-zinc-300"
                            : "bg-indigo-600/20 text-zinc-300"
                        }`}
                      >
                        {t.text}
                      </span>
                      {t.role === "user" && (
                        <span className="text-[10px] text-zinc-500 shrink-0 mt-0.5">You</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
