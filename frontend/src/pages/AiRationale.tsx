import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Clock, Facebook, FileDown, Globe, Instagram, Loader2, MessageCircle, Pencil,
  Radio, RotateCcw, Send, Sparkles, Trash2, Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { toast } from "../store/toast";
import Modal from "../components/Modal";

type PlatformType = "youtube" | "facebook" | "instagram" | "telegram" | "whatsapp" | "other";
type JobStatus = "pending" | "running" | "paused_review" | "completed" | "failed" | "saved";
interface Platform { id: string; platform_type: PlatformType; channel_name: string }
interface Job {
  id: string; platform_id: string | null; platform_name: string | null; platform_type: PlatformType | null;
  platform_logo: string | null; title: string | null; video_date: string | null; video_time: string | null;
  status: JobStatus; current_step: number; started_at: string | null; pdf_url: string | null;
}

const PICON: Record<PlatformType, LucideIcon> = {
  youtube: Youtube, facebook: Facebook, instagram: Instagram, telegram: Send, whatsapp: MessageCircle, other: Globe,
};
const PCOLOR: Record<PlatformType, string> = {
  youtube: "text-red-600 bg-red-50", facebook: "text-blue-600 bg-blue-50", instagram: "text-pink-600 bg-pink-50",
  telegram: "text-sky-600 bg-sky-50", whatsapp: "text-emerald-600 bg-emerald-50", other: "text-slate-600 bg-slate-100",
};
const STATUS: Record<JobStatus, { label: string; cls: string; pulse?: boolean }> = {
  pending: { label: "Pending", cls: "bg-slate-100 text-slate-600" },
  running: { label: "Running", cls: "bg-blue-100 text-blue-700", pulse: true },
  paused_review: { label: "Needs review", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700" },
  saved: { label: "Saved", cls: "bg-violet-100 text-violet-700" },
};
const ROW_BG: Record<JobStatus, string> = {
  pending: "bg-white", running: "bg-slate-50", paused_review: "bg-amber-50/50",
  completed: "bg-emerald-50/50", failed: "bg-red-50/40", saved: "bg-violet-50/40",
};
const TYPES: PlatformType[] = ["youtube", "facebook", "instagram", "telegram", "whatsapp", "other"];

function fmtDate(d: string | null, t: string | null): string {
  if (!d) return "—";
  const x = new Date(`${d}T${t ?? "00:00:00"}`);
  if (Number.isNaN(x.getTime())) return d;
  return x.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", ...(t ? { hour: "2-digit", minute: "2-digit" } : {}) });
}
function fmtStart(s: string | null): string {
  if (!s) return "—";
  const x = new Date(s);
  return Number.isNaN(x.getTime()) ? "—" : x.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
async function downloadJobPdf(job: Job) {
  try {
    const blob = await api.getBlob(`/jobs/${job.id}/pdf`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(job.title || job.platform_name || "rationale").replace(/[^\w.-]+/g, "_")}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not download PDF"); }
}

export default function AiRationale() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<Job[]>("/jobs") });
  const platforms = useQuery({ queryKey: ["platforms"], queryFn: () => api.get<Platform[]>("/platforms") });

  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [ptype, setPtype] = useState(""); const [chan, setChan] = useState(""); const [stat, setStat] = useState("");
  const [confirmReset, setConfirmReset] = useState<Job | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["jobs"] });

  const restart = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/restart`),
    onSuccess: (_d, id) => { toast.success("Restarting from step 1"); invalidate(); navigate(`/ai-rationale/${id}`); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not restart"),
  });
  const reset = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/reset`),
    onSuccess: () => { toast.success("Rationale discarded — entry is back to Pending"); setConfirmReset(null); invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not reset"),
  });

  const rows = jobs.data ?? [];
  const cleared = from || to || ptype || chan || stat;
  const filtered = rows.filter((j) => {
    const d = j.video_date || (j.started_at || "").slice(0, 10);
    if (from && d && d < from) return false;
    if (to && d && d > to) return false;
    if (ptype && j.platform_type !== ptype) return false;
    if (chan && j.platform_id !== chan) return false;
    if (stat && j.status !== stat) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Sparkles size={20} /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Rationale</h1>
          <p className="text-sm text-slate-500">Run and manage the rationale pipeline for each media appearance.</p>
        </div>
      </div>

      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div><label className="mb-1 block text-xs font-medium text-slate-500">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-medium text-slate-500">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Platform</label>
            <select className="input" value={ptype} onChange={(e) => { setPtype(e.target.value); setChan(""); }}>
              <option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Channel</label>
            <select className="input" value={chan} onChange={(e) => setChan(e.target.value)}>
              <option value="">All</option>
              {(platforms.data ?? []).filter((p) => !ptype || p.platform_type === ptype).map((p) => <option key={p.id} value={p.id}>{p.channel_name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Status</label>
            <select className="input" value={stat} onChange={(e) => setStat(e.target.value)}>
              <option value="">All</option>{(Object.keys(STATUS) as JobStatus[]).map((sx) => <option key={sx} value={sx}>{STATUS[sx].label}</option>)}
            </select>
          </div>
        </div>
        {cleared && <button className="mt-2 text-xs font-medium text-slate-400 hover:text-brand" onClick={() => { setFrom(""); setTo(""); setPtype(""); setChan(""); setStat(""); }}>Clear filters</button>}
      </div>

      {jobs.isLoading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : filtered.length > 0 ? (
        <div className="card divide-y divide-slate-100 overflow-x-auto">
          {filtered.map((j) => {
            const type = j.platform_type ?? "other";
            const Icon = PICON[type];
            const st = STATUS[j.status];
            const inProgress = j.status === "running" || j.status === "paused_review";
            return (
              <div key={j.id} className={`group flex min-w-[820px] items-center gap-3 px-4 py-3 transition-colors ${ROW_BG[j.status]} hover:bg-brand-50/40`}>
                <span title={type} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${PCOLOR[type]} transition-transform group-hover:scale-105`}><Icon size={16} /></span>
                {j.platform_logo ? (
                  <img src={j.platform_logo} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">{(j.platform_name ?? "?")[0]?.toUpperCase()}</span>
                )}
                <div className="w-44 shrink-0">
                  <div className="truncate font-medium text-slate-800">{j.platform_name ?? "—"}</div>
                  <div className="truncate text-xs text-slate-400">{j.title || "Untitled appearance"}</div>
                </div>
                <div className="w-32 shrink-0 text-sm text-slate-600">{fmtDate(j.video_date, j.video_time)}</div>
                <div className="w-32 shrink-0 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><Clock size={11} /> {fmtStart(j.started_at)}</span>
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <button onClick={() => navigate(`/ai-rationale/${j.id}`)} title="Open pipeline"
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition hover:ring-2 hover:ring-brand/20 ${st.cls}`}>
                    {st.pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                    {st.label}{inProgress ? ` · ${j.current_step}/10` : ""}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => navigate(`/media-presence?edit=${j.id}`)} title="Edit entry" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand"><Pencil size={15} /></button>
                  <div className="flex w-8 justify-center">
                    {(j.status === "completed" || j.status === "saved") && j.pdf_url && (
                      <button onClick={() => downloadJobPdf(j)} title="Download PDF" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand"><FileDown size={16} /></button>
                    )}
                  </div>
                  <button onClick={() => restart.mutate(j.id)} disabled={restart.isPending} title="Restart pipeline" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand disabled:opacity-40"><RotateCcw size={15} /></button>
                  <button onClick={() => setConfirmReset(j)} title="Discard rationale (back to Pending)" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-danger"><Trash2 size={15} /></button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card grid place-items-center p-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Radio size={22} /></span>
          <h2 className="mt-4 text-lg font-semibold">{rows.length ? "No matching jobs" : "Nothing to process yet"}</h2>
          <p className="mt-1 text-sm text-slate-500">{rows.length ? "Try clearing the filters." : "Add a media appearance first, then start its rationale."}</p>
        </div>
      )}

      <Modal open={confirmReset !== null} onClose={() => setConfirmReset(null)} title="Discard this rationale?" maxWidth="max-w-md">
        <p className="text-sm text-slate-600">
          This clears the pipeline run and outputs for <span className="font-medium">{confirmReset?.title || confirmReset?.platform_name || "this entry"}</span> and sets it back to <span className="font-medium">Pending</span> — the audio and details are kept, and it'll show a Start button in Media Presence again.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmReset(null)}>Cancel</button>
          <button className="btn bg-danger text-white hover:bg-danger/90" disabled={reset.isPending} onClick={() => confirmReset && reset.mutate(confirmReset.id)}>
            {reset.isPending && <Loader2 size={16} className="animate-spin" />} Discard &amp; reset
          </button>
        </div>
      </Modal>
    </div>
  );
}
