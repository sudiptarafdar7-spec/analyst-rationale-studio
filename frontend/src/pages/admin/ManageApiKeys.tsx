import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  Bot,
  CheckCircle2,
  Eye,
  KeyRound,
  LineChart,
  Loader2,
  Pencil,
  Sparkles,
  Stars,
  Trash2,
  XCircle,
  Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";
import Modal from "../../components/Modal";

type Provider = "openai" | "anthropic" | "gemini" | "deepgram" | "youtube" | "dhan";

interface ApiKeyRow {
  provider: Provider;
  is_set: boolean;
  masked: string | null;
  label: string | null;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  updated_at: string | null;
}

const META: Record<Provider, { name: string; icon: LucideIcon; hint: string }> = {
  openai: { name: "OpenAI", icon: Bot, hint: "GPT models for translate / extract / polish" },
  anthropic: { name: "Anthropic", icon: Sparkles, hint: "Claude models" },
  gemini: { name: "Gemini", icon: Stars, hint: "Google Gemini models" },
  deepgram: { name: "Deepgram", icon: AudioLines, hint: "Audio transcription (Step 1)" },
  youtube: { name: "YouTube Data API", icon: Youtube, hint: "Video metadata autofill" },
  dhan: { name: "Dhan", icon: LineChart, hint: "Market data: CMP + charts" },
};

const ORDER: Provider[] = ["openai", "anthropic", "gemini", "deepgram", "youtube", "dhan"];

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusPill({ row }: { row: ApiKeyRow }) {
  if (!row.is_set)
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Not set</span>;
  if (row.last_test_ok === true)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
        <CheckCircle2 size={13} /> Connected · {timeAgo(row.last_tested_at)}
      </span>
    );
  if (row.last_test_ok === false)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">
        <XCircle size={13} /> Failed · {timeAgo(row.last_tested_at)}
      </span>
    );
  return <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning">Untested</span>;
}

export default function ManageApiKeys() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api.get<ApiKeyRow[]>("/admin/api-keys"),
  });

  const [editing, setEditing] = useState<Provider | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [label, setLabel] = useState("");
  const [showKey, setShowKey] = useState(false);

  const [revealing, setRevealing] = useState<Provider | null>(null);
  const [revealPw, setRevealPw] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  const [testing, setTesting] = useState<Provider | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["api-keys"] });

  const saveMut = useMutation({
    mutationFn: (p: Provider) =>
      api.put(`/admin/api-keys/${p}`, { key_value: keyValue, label: label || null }),
    onSuccess: () => {
      toast.success("API key saved");
      setEditing(null);
      setKeyValue("");
      setLabel("");
      setShowKey(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save key"),
  });

  const removeMut = useMutation({
    mutationFn: (p: Provider) => api.del(`/admin/api-keys/${p}`),
    onSuccess: () => {
      toast.success("API key removed");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not remove key"),
  });

  const onTest = async (p: Provider) => {
    setTesting(p);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/admin/api-keys/${p}/test`);
      res.ok ? toast.success(res.message) : toast.error(res.message);
      invalidate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Test failed");
    } finally {
      setTesting(null);
    }
  };

  const onReveal = async (p: Provider) => {
    try {
      const res = await api.post<{ key_value: string }>(`/admin/api-keys/${p}/reveal`, {
        password: revealPw,
      });
      setRevealed(res.key_value);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not reveal key");
    }
  };

  const byProvider = (p: Provider) =>
    data?.find((r) => r.provider === p) ?? { provider: p, is_set: false, masked: null, label: null, last_tested_at: null, last_test_ok: null, updated_at: null };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <KeyRound size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Manage API Keys</h1>
          <p className="text-sm text-slate-500">Keys are encrypted at rest and never leave the server in plaintext.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="animate-spin text-slate-300" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {ORDER.map((p) => {
            const row = byProvider(p);
            const meta = META[p];
            const Icon = meta.icon;
            return (
              <div key={p} className="card flex flex-col p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600">
                      <Icon size={20} />
                    </span>
                    <div>
                      <div className="font-semibold">{meta.name}</div>
                      <div className="text-xs text-slate-400">{meta.hint}</div>
                    </div>
                  </div>
                  <StatusPill row={row} />
                </div>

                <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 font-mono text-sm text-slate-600">
                  {row.is_set ? row.masked : "— no key set —"}
                  {row.label && <span className="ml-2 font-sans text-xs text-slate-400">({row.label})</span>}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="btn-ghost px-3 py-2 text-xs"
                    disabled={!row.is_set || testing === p}
                    onClick={() => onTest(p)}
                  >
                    {testing === p ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Test
                  </button>
                  <button
                    className="btn-ghost px-3 py-2 text-xs"
                    disabled={!row.is_set}
                    onClick={() => {
                      setRevealing(p);
                      setRevealPw("");
                      setRevealed(null);
                    }}
                  >
                    <Eye size={14} /> Reveal
                  </button>
                  <button
                    className="btn-ghost px-3 py-2 text-xs"
                    onClick={() => {
                      setEditing(p);
                      setKeyValue("");
                      setLabel(row.label ?? "");
                      setShowKey(false);
                    }}
                  >
                    <Pencil size={14} /> {row.is_set ? "Replace" : "Set key"}
                  </button>
                  <button
                    className="btn-ghost px-3 py-2 text-xs text-danger"
                    disabled={!row.is_set || removeMut.isPending}
                    onClick={() => removeMut.mutate(p)}
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Set / replace key */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `${META[editing].name} API key` : ""}
        description="Paste the secret. It’s encrypted before being stored."
      >
        <div className="space-y-4">
          <div>
            <label className="label">Secret key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                className="input pr-11 font-mono"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder="Paste key…"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-slate-600"
              >
                <Eye size={18} />
              </button>
            </div>
          </div>
          <div>
            <label className="label">Label (optional)</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. production" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={!keyValue || saveMut.isPending}
              onClick={() => editing && saveMut.mutate(editing)}
            >
              {saveMut.isPending && <Loader2 size={18} className="animate-spin" />}
              Save key
            </button>
          </div>
        </div>
      </Modal>

      {/* Reveal (re-auth) */}
      <Modal
        open={revealing !== null}
        onClose={() => setRevealing(null)}
        title={revealing ? `Reveal ${META[revealing].name} key` : ""}
        description="Confirm your password to view the secret once."
      >
        {revealed ? (
          <div className="space-y-4">
            <div className="break-all rounded-xl bg-slate-900 px-4 py-3 font-mono text-sm text-emerald-300">
              {revealed}
            </div>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setRevealing(null)}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label">Your password</label>
              <input
                type="password"
                className="input"
                value={revealPw}
                onChange={(e) => setRevealPw(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && revealing && onReveal(revealing)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setRevealing(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={!revealPw} onClick={() => revealing && onReveal(revealing)}>
                Reveal
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
