"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, Trash2, FileText, Loader2, BookOpen } from "lucide-react";
import { API_URL, cn } from "@/lib/utils";
import { toast } from "sonner";

interface KBDoc {
  id: string;
  name: string;
  file_type: string;
  size_bytes: number;
  chunk_count: number;
  created_at: string;
}

interface Props {
  /** undefined = app-level Copilot KB; a UUID = agent-level KB */
  agentId?: string;
  label?: string;
  hint?: string;
}

export default function KnowledgeBasePanel({ agentId, label, hint }: Props) {
  const [docs, setDocs] = useState<KBDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDocs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function loadDocs() {
    setLoading(true);
    try {
      const url = agentId
        ? `${API_URL}/api/knowledge?agent_id=${agentId}`
        : `${API_URL}/api/knowledge`;
      const res = await fetch(url);
      if (res.ok) setDocs(await res.json());
    } catch {
      /* backend may not be running */
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (agentId) form.append("agent_id", agentId);
      const res = await fetch(`${API_URL}/api/knowledge/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail || "Upload failed");
      }
      const data = await res.json();
      toast.success(`"${data.name}" uploaded — ${data.chunk_count} chunks indexed`);
      loadDocs();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed. Check OPENAI_API_KEY in backend .env.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(docId: string, name: string) {
    if (!confirm(`Remove "${name}" from the knowledge base?`)) return;
    try {
      await fetch(`${API_URL}/api/knowledge/${docId}`, { method: "DELETE" });
      toast.success("Document removed");
      loadDocs();
    } catch {
      toast.error("Delete failed");
    }
  }

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-zinc-300">{label ?? "Knowledge Base"}</span>
          <span className="text-[10px] text-zinc-500">
            ({docs.length} doc{docs.length !== 1 ? "s" : ""})
          </span>
        </div>
        <label
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors",
            uploading
              ? "bg-zinc-800 text-zinc-500 pointer-events-none"
              : "bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-700/40"
          )}
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {uploading ? "Uploading…" : "Upload PDF / TXT"}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.txt,.md"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
      </div>

      {/* Hint */}
      {hint && <p className="text-[11px] text-zinc-600">{hint}</p>}

      {/* Document list */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-700 py-5 text-center">
          <FileText className="h-6 w-6 text-zinc-700 mx-auto mb-1.5" />
          <p className="text-xs text-zinc-500">No documents yet</p>
          <p className="text-[11px] text-zinc-600 mt-0.5">
            Upload PDFs or text files — chunks are embedded and retrieved at call time
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <FileText className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-300 truncate font-medium">{doc.name}</p>
                <p className="text-[10px] text-zinc-600">
                  {doc.chunk_count} chunks · {(doc.size_bytes / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                onClick={() => handleDelete(doc.id, doc.name)}
                className="p-0.5 rounded text-zinc-600 hover:text-red-400 transition-colors"
                title="Remove document"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
