import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, Trash2, XCircle, Zap } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { toast } from "../store/toast";

interface KeyStatus {
  provider: string;
  is_set: boolean;
  label: string | null;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  updated_at: string | null;
}

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini",
  deepgram: "Deepgram", youtube: "YouTube", dhan: "Dhan",
};

function KeyCard({ k, onChanged }: { k: KeyStatus; onChanged: () => void }) {
  const [value, setValue] = useState("");
  const [label, setLabel] = useState(k.label ?? "");

  const save = useMutation({
    mutationFn: () => api.put(`/apikeys/${k.provider}`, { key_value: value, label: label || null }),
    onSuccess: () => { toast.success(`${PROVIDER_LABEL[k.provider] ?? k.provider} key updated`); setValue(""); onChanged(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not update key"),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/apikeys/${k.provider}`),
    onSuccess: () => { toast.success(`${PROVIDER_LABEL[k.provider] ?? k.provider} key removed`); onChanged(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not remove key"),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/apikeys/${k.provider}/test`, {}),
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Test failed"),
  });

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><KeyRound size={19} /></span>
          <div>
            <div className="font-semibold text-slate-800">{PROVIDER_LABEL[k.provider] ?? k.provider}</div>
            <div className="flex items-center gap-2 text-xs">
              {k.is_set
                ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} /> Key set</span>
                : <span className="inline-flex items-center gap-1 text-slate-400"><XCircle size={12} /> Not set</span>}
              {k.last_test_ok === true && <span className="text-emerald-600">· tested OK</span>}
              {k.last_test_ok === false && <span className="text-red-500">· last test failed</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {k.is_set && <button className="btn-ghost px-2.5 py-1 text-xs" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Test</button>}
          {k.is_set && <button className="btn-ghost px-2.5 py-1 text-xs text-danger hover:text-danger" disabled={remove.isPending} onClick={() => { if (confirm(`Remove the ${PROVIDER_LABEL[k.provider] ?? k.provider} key?`)) remove.mutate(); }}>{remove.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Remove</button>}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_200px_auto]">
        <input className="input font-mono text-sm" type="password" placeholder={k.is_set ? "Enter a new key to replace it…" : "Paste the API key…"} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        <input className="input text-sm" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn-primary" disabled={!value.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} {k.is_set ? "Replace" : "Save"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">For security the existing key can’t be viewed — you can only replace it with a new one or remove it.</p>
    </div>
  );
}

export default function ApiAccess() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["my-apikeys"], queryFn: () => api.get<KeyStatus[]>("/apikeys") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-apikeys"] });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><KeyRound size={20} /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Access</h1>
          <p className="text-sm text-slate-500">Update the API keys you’ve been granted access to. Keys are write-only — replace or remove, never view.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : (data ?? []).length === 0 ? (
        <div className="card grid place-items-center p-12 text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><KeyRound size={22} /></span>
          <h2 className="text-lg font-semibold">No API keys assigned</h2>
          <p className="mt-1 text-sm text-slate-500">An admin can grant you access to specific API keys under User Management.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(data ?? []).map((k) => <KeyCard key={k.provider} k={k} onChanged={refresh} />)}
        </div>
      )}
    </div>
  );
}
