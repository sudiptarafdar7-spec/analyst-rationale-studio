import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  CloudUpload,
  Facebook,
  FileDown,
  Filter,
  Globe,
  Instagram,
  Loader2,
  MessageCircle,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Send,
  Trash2,
  Users,
  X,
  Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";
import Modal from "../components/Modal";

type PlatformType = "youtube" | "facebook" | "instagram" | "telegram" | "whatsapp" | "other";
type JobStatus = "pending" | "running" | "paused_review" | "completed" | "failed" | "saved";

interface Platform {
  id: string;
  platform_type: PlatformType;
  channel_name: string;
  channel_logo_path: string | null;
}
interface Analyst {
  id: string;
  name: string;
  avatar_path: string | null;
}
interface AnalystRef {
  id: string;
  name: string;
  avatar_path: string | null;
}
interface Job {
  id: string;
  platform_id: string | null;
  platform_name: string | null;
  platform_type: PlatformType | null;
  platform_logo: string | null;
  analysts: AnalystRef[];
  title: string | null;
  youtube_url: string | null;
  video_date: string | null;
  video_time: string | null;
  extract_all_stocks: boolean;
  status: JobStatus;
  audio_url: string | null;
  pdf_url: string | null;
  created_at: string;
}

const TYPES: { value: PlatformType; label: string; icon: LucideIcon; color: string }[] = [
  { value: "youtube", label: "YouTube", icon: Youtube, color: "text-red-600 bg-red-50" },
  { value: "facebook", label: "Facebook", icon: Facebook, color: "text-blue-600 bg-blue-50" },
  { value: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-600 bg-pink-50" },
  { value: "telegram", label: "Telegram", icon: Send, color: "text-sky-600 bg-sky-50" },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "text-emerald-600 bg-emerald-50" },
  { value: "other", label: "Other", icon: Globe, color: "text-slate-600 bg-slate-100" },
];
const PMETA = Object.fromEntries(TYPES.map((t) => [t.value, t])) as Record<PlatformType, (typeof TYPES)[number]>;

const STATUS_META: Record<JobStatus, { label: string; cls: string; pulse?: boolean }> = {
  pending: { label: "Pending", cls: "bg-slate-100 text-slate-600" },
  running: { label: "Running", cls: "bg-blue-100 text-blue-700", pulse: true },
  paused_review: { label: "Needs review", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700" },
  saved: { label: "Saved", cls: "bg-violet-100 text-violet-700" },
};

const ROW_BG: Record<JobStatus, string> = {
  pending: "bg-white",
  running: "bg-slate-50",
  paused_review: "bg-amber-50/50",
  completed: "bg-emerald-50/50",
  failed: "bg-red-50/40",
  saved: "bg-violet-50/40",
};

interface Filters {
  from: string; to: string; platformType: string; channelId: string; status: string; analystId: string;
}
const EMPTY_FILTERS: Filters = { from: "", to: "", platformType: "", channelId: "", status: "", analystId: "" };
const FILTER_KEY = "mp_filters";
const FILTER_HIST_KEY = "mp_filter_history";
function loadJSON<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function isEmptyFilter(f: Filters): boolean {
  return !f.from && !f.to && !f.platformType && !f.channelId && !f.status && !f.analystId;
}
function summarizeFilter(f: Filters, plats: Platform[], ans: Analyst[]): string {
  const parts: string[] = [];
  if (f.from || f.to) parts.push(`${f.from || "\u2026"}\u2192${f.to || "\u2026"}`);
  if (f.platformType) parts.push(f.platformType);
  if (f.channelId) parts.push(plats.find((p) => p.id === f.channelId)?.channel_name ?? "channel");
  if (f.status) parts.push(STATUS_META[f.status as JobStatus]?.label ?? f.status);
  if (f.analystId) parts.push(ans.find((a) => a.id === f.analystId)?.name ?? "analyst");
  return parts.join(" \u00b7 ") || "Filter";
}
async function downloadJobPdf(job: Job): Promise<void> {
  try {
    const blob = await api.getBlob(`/jobs/${job.id}/pdf`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(job.title || job.platform_name || "rationale").replace(/[^\w.-]+/g, "_")}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not download PDF"); }
}

const AUDIO_ACCEPT = ".mp3,.m4a,.wav,.aac,audio/*";
const AUDIO_EXTS = ["mp3", "m4a", "wav", "aac"];

function ytEmbedId(url: string | null): string | null {
  if (!url) return null;
  const m =
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/[?&]v=([\w-]{11})/) ||
    url.match(/youtube\.com\/(?:shorts|live|embed)\/([\w-]{11})/);
  return m ? m[1] : null;
}

function fmtDateTime(d: string | null, t: string | null): string {
  if (!d) return "—";
  const date = new Date(`${d}T${t ?? "00:00:00"}`);
  if (Number.isNaN(date.getTime())) return `${d}${t ? " " + t : ""}`;
  return date.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    ...(t ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function uploadWithProgress(
  path: string,
  fd: FormData,
  onProgress: (pct: number) => void,
  token?: string,
  allowRetry = true,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    const tk = token ?? useAuthStore.getState().accessToken;
    if (tk) xhr.setRequestHeader("Authorization", `Bearer ${tk}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
        return;
      }
      // Token likely expired mid-upload — refresh once and retry (FormData is reusable).
      if (xhr.status === 401 && allowRetry) {
        api.refresh().then((nt) => {
          if (nt) resolve(uploadWithProgress(path, fd, onProgress, nt, false));
          else reject(new ApiError(401, "Your session has expired. Please sign in again."));
        });
        return;
      }
      let detail = `Upload failed (HTTP ${xhr.status})`;
      try {
        const b = JSON.parse(xhr.responseText);
        if (typeof b.detail === "string") detail = b.detail;
        else if (Array.isArray(b.detail) && b.detail.length) {
          detail = b.detail
            .map((d: { loc?: unknown[]; msg?: string }) => {
              const field = Array.isArray(d.loc) ? String(d.loc[d.loc.length - 1]) : "";
              return field ? `${field}: ${d.msg ?? ""}` : d.msg ?? "";
            })
            .join("; ");
        }
      } catch { /* non-JSON body (e.g. plain "Internal Server Error") */ }
      reject(new ApiError(xhr.status, detail));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));
    xhr.send(fd);
  });
}

interface FormState {
  id?: string;
  platform_type: PlatformType;
  platform_id: string;
  analyst_ids: string[];
  title: string;
  youtube_url: string;
  video_date: string;
  video_time: string;
  extract_all_stocks: boolean;
  audioFile: File | null;
}
const EMPTY: FormState = {
  platform_type: "youtube", platform_id: "", analyst_ids: [], title: "",
  youtube_url: "", video_date: "", video_time: "", extract_all_stocks: false, audioFile: null,
};

export default function MediaPresence() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const audioRef = useRef<HTMLInputElement>(null);

  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<Job[]>("/jobs") });
  const platforms = useQuery({ queryKey: ["platforms"], queryFn: () => api.get<Platform[]>("/platforms") });
  const analysts = useQuery({ queryKey: ["analysts"], queryFn: () => api.get<Analyst[]>("/analysts") });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [channelOpen, setChannelOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<Job | null>(null);
  const [playing, setPlaying] = useState<Job | null>(null);
  const [analystOpen, setAnalystOpen] = useState(false);
  const isEdit = Boolean(form.id);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["jobs"] });

  const [filters, setFilters] = useState<Filters>(() => loadJSON(FILTER_KEY, EMPTY_FILTERS));
  const [filterHistory, setFilterHistory] = useState<Filters[]>(() => loadJSON(FILTER_HIST_KEY, []));
  const setFilter = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* ignore */ } }, [filters]);
  useEffect(() => {
    if (isEmptyFilter(filters)) return;
    const t = setTimeout(() => {
      setFilterHistory((h) => {
        const next = [filters, ...h.filter((f) => JSON.stringify(f) !== JSON.stringify(filters))].slice(0, 5);
        try { localStorage.setItem(FILTER_HIST_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [filters]);
  const filtered = (jobs.data ?? []).filter((j) => {
    const d = j.video_date || (j.created_at || "").slice(0, 10);
    if (filters.from && d && d < filters.from) return false;
    if (filters.to && d && d > filters.to) return false;
    if (filters.platformType && j.platform_type !== filters.platformType) return false;
    if (filters.channelId && j.platform_id !== filters.channelId) return false;
    if (filters.status && j.status !== filters.status) return false;
    if (filters.analystId && !j.analysts.some((a) => a.id === filters.analystId)) return false;
    return true;
  });

  const channels = (platforms.data ?? []).filter((p) => p.platform_type === form.platform_type);
  const selectedChannel = platforms.data?.find((p) => p.id === form.platform_id) ?? null;

  const openCreate = () => { setForm(EMPTY); setProgress(null); setOpen(true); };
  const openEdit = (j: Job) => {
    setForm({
      id: j.id,
      platform_type: j.platform_type ?? "youtube",
      platform_id: j.platform_id ?? "",
      analyst_ids: j.analysts.map((a) => a.id),
      title: j.title ?? "",
      youtube_url: j.youtube_url ?? "",
      video_date: j.video_date ?? "",
      video_time: j.video_time ?? "",
      extract_all_stocks: j.extract_all_stocks,
      audioFile: null,
    });
    setProgress(null);
    setOpen(true);
  };

  const setType = (t: PlatformType) =>
    setForm((s) => ({
      ...s,
      platform_type: t,
      platform_id: platforms.data?.some((p) => p.id === s.platform_id && p.platform_type === t) ? s.platform_id : "",
    }));

  const save = useMutation({
    mutationFn: async () => {
      if (form.id) {
        return api.patch(`/jobs/${form.id}`, {
          platform_id: form.platform_id || null,
          analyst_ids: form.extract_all_stocks ? [] : form.analyst_ids,
          title: form.title || null,
          youtube_url: form.youtube_url || null,
          video_date: form.video_date || null,
          video_time: form.video_time || null,
          extract_all_stocks: form.extract_all_stocks,
        });
      }
      const fd = new FormData();
      fd.append("platform_id", form.platform_id);
      fd.append("extract_all_stocks", String(form.extract_all_stocks));
      if (!form.extract_all_stocks) form.analyst_ids.forEach((id) => fd.append("analyst_ids", id));
      if (form.youtube_url) fd.append("youtube_url", form.youtube_url);
      if (form.title) fd.append("title", form.title);
      if (form.video_date) fd.append("video_date", form.video_date);
      if (form.video_time) fd.append("video_time", form.video_time);
      if (form.audioFile) fd.append("audio", form.audioFile);
      setProgress(0);
      return uploadWithProgress("/jobs", fd, setProgress);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Entry updated" : "Media presence added");
      setOpen(false); setProgress(null); invalidate();
    },
    onError: (e) => { setProgress(null); toast.error(e instanceof ApiError ? e.message : "Could not save entry"); },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/jobs/${id}`),
    onSuccess: () => { toast.success("Entry deleted"); setConfirmDel(null); invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not delete"),
  });
  const restart = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/restart`),
    onSuccess: () => { toast.success("Restarting from step 1"); invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not restart"),
  });

  const pickAudio = (f: File | undefined) => {
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!AUDIO_EXTS.includes(ext)) { toast.error("Audio must be mp3, m4a, wav or aac"); return; }
    setForm((s) => ({ ...s, audioFile: f }));
  };

  const fetchDetails = async () => {
    if (!form.youtube_url.trim()) { toast.error("Paste the video URL first"); return; }
    setFetching(true);
    try {
      const r = await api.get<{ channel: string; title: string; upload_date: string | null; upload_time: string | null }>(
        `/youtube/metadata?url=${encodeURIComponent(form.youtube_url.trim())}`,
      );
      const match = (platforms.data ?? []).find(
        (p) => p.platform_type === "youtube" && p.channel_name.trim().toLowerCase() === r.channel.trim().toLowerCase(),
      );
      setForm((s) => ({
        ...s,
        title: r.title || s.title,
        video_date: r.upload_date || s.video_date,
        video_time: r.upload_time || s.video_time,
        platform_id: match ? match.id : s.platform_id,
      }));
      toast.success(match ? `Matched channel: ${r.channel}` : `Fetched: ${r.channel} (no saved channel matched)`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not fetch video details");
    } finally {
      setFetching(false);
    }
  };

  const toggleAnalyst = (id: string) =>
    setForm((s) => ({
      ...s,
      analyst_ids: s.analyst_ids.includes(id) ? s.analyst_ids.filter((x) => x !== id) : [...s.analyst_ids, id],
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Radio size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Media Presence</h1>
            <p className="text-sm text-slate-500">Log each media appearance, then turn it into a compliance rationale.</p>
          </div>
        </div>
        <button className="btn-primary" onClick={openCreate}><Plus size={18} /> Add entry</button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
            <input type="date" className="input" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
            <input type="date" className="input" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Platform</label>
            <select className="input" value={filters.platformType} onChange={(e) => setFilter("platformType", e.target.value)}>
              <option value="">All</option>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Channel</label>
            <select className="input" value={filters.channelId} onChange={(e) => setFilter("channelId", e.target.value)}>
              <option value="">All</option>
              {(platforms.data ?? []).filter((p) => !filters.platformType || p.platform_type === filters.platformType).map((p) => <option key={p.id} value={p.id}>{p.channel_name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Status</label>
            <select className="input" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">All</option>
              {(Object.keys(STATUS_META) as JobStatus[]).map((st) => <option key={st} value={st}>{STATUS_META[st].label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Analyst</label>
            <select className="input" value={filters.analystId} onChange={(e) => setFilter("analystId", e.target.value)}>
              <option value="">All</option>
              {(analysts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        {(!isEmptyFilter(filters) || filterHistory.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!isEmptyFilter(filters) && (
              <button className="text-xs font-medium text-slate-400 hover:text-brand" onClick={clearFilters}>Clear filters</button>
            )}
            {filterHistory.length > 0 && (
              <>
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400"><Filter size={12} /> Recent:</span>
                {filterHistory.map((f, idx) => (
                  <button key={idx} onClick={() => setFilters(f)} title="Apply this filter"
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 transition hover:border-brand/40 hover:bg-brand-50 hover:text-brand-700">
                    {summarizeFilter(f, platforms.data ?? [], analysts.data ?? [])}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {jobs.isLoading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : filtered.length > 0 ? (
        <div className="card divide-y divide-slate-100 overflow-x-auto">
          {filtered.map((j) => {
            const meta = PMETA[j.platform_type ?? "other"];
            const Icon = meta.icon;
            const st = STATUS_META[j.status];
            return (
              <div key={j.id} className={`group flex min-w-[680px] items-center gap-3 px-4 py-3 transition-colors ${ROW_BG[j.status]} hover:bg-brand-50/40`}>
                <span title={meta.label} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${meta.color} transition-transform group-hover:scale-105`}><Icon size={16} /></span>
                {j.platform_logo ? (
                  <img src={j.platform_logo} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">{(j.platform_name ?? "?")[0]?.toUpperCase()}</span>
                )}
                <div className="w-44 shrink-0">
                  <div className="truncate font-medium text-slate-800">{j.platform_name ?? "—"}</div>
                  <div className="truncate text-xs text-slate-400">{j.title || "Untitled appearance"}</div>
                </div>
                <div className="w-32 shrink-0 text-sm text-slate-600">{fmtDateTime(j.video_date, j.video_time)}</div>
                <div className="flex w-28 shrink-0 items-center">
                  {j.extract_all_stocks ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"><Users size={11} /> All</span>
                  ) : j.analysts.length ? (
                    <div className="flex -space-x-2">
                      {j.analysts.slice(0, 4).map((a) => (
                        a.avatar_path ? (
                          <img key={a.id} src={a.avatar_path} alt={a.name} title={a.name} className="h-7 w-7 rounded-full object-cover ring-2 ring-white" />
                        ) : (
                          <span key={a.id} title={a.name} className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700 ring-2 ring-white">{a.name[0]?.toUpperCase()}</span>
                        )
                      ))}
                      {j.analysts.length > 4 && <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500 ring-2 ring-white">+{j.analysts.length - 4}</span>}
                    </div>
                  ) : <span className="text-xs text-slate-400">—</span>}
                </div>
                <div className="flex flex-1 items-center justify-end gap-1">
                  {(j.youtube_url || j.audio_url) && (
                    <button onClick={() => setPlaying(j)} title="Play video" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand"><Play size={16} /></button>
                  )}
                  <button onClick={() => navigate(`/ai-rationale/${j.id}`)} title="Open pipeline"
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition hover:ring-2 hover:ring-brand/20 ${st.cls}`}>
                    {st.pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}{st.label}
                  </button>
                  {(j.status === "completed" || j.status === "saved") && j.pdf_url && (
                    <button onClick={() => downloadJobPdf(j)} title="Download PDF" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand"><FileDown size={16} /></button>
                  )}
                  <button onClick={() => openEdit(j)} title="Edit" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand"><Pencil size={15} /></button>
                  <button onClick={() => restart.mutate(j.id)} disabled={restart.isPending} title="Reload pipeline" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand disabled:opacity-40"><RotateCcw size={15} /></button>
                  <button onClick={() => setConfirmDel(j)} title="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-danger"><Trash2 size={15} /></button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card grid place-items-center p-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Radio size={22} /></span>
          <h2 className="mt-4 text-lg font-semibold">{(jobs.data?.length ?? 0) > 0 ? "No matching entries" : "No media appearances yet"}</h2>
          <p className="mt-1 text-sm text-slate-500">{(jobs.data?.length ?? 0) > 0 ? "Try adjusting or clearing the filters." : "Add an appearance to start building a rationale."}</p>
          {(jobs.data?.length ?? 0) > 0 ? (
            <button className="btn-ghost mt-4" onClick={clearFilters}>Clear filters</button>
          ) : (
            <button className="btn-primary mt-4" onClick={openCreate}><Plus size={18} /> Add entry</button>
          )}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={isEdit ? "Edit entry" : "Add media presence"}
        description="Pick the platform and channel, add the video/audio, and choose target analysts." maxWidth="max-w-2xl">
        <div className="space-y-5">
          <div>
            <label className="label">Platform</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {TYPES.map((t) => {
                const Icon = t.icon;
                const active = form.platform_type === t.value;
                return (
                  <button key={t.value} type="button" onClick={() => setType(t.value)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition ${
                      active ? "border-brand bg-brand-50 text-brand-700 ring-2 ring-brand/20" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                    <Icon size={20} /> {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label">Channel</label>
            <div className="relative">
              <button type="button" onClick={() => setChannelOpen((o) => !o)}
                className="input flex items-center justify-between gap-2 text-left">
                {selectedChannel ? (
                  <span className="flex items-center gap-2 truncate">
                    {selectedChannel.channel_logo_path ? (
                      <img src={selectedChannel.channel_logo_path} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${PMETA[selectedChannel.platform_type].color}`}>
                        {(() => { const I = PMETA[selectedChannel.platform_type].icon; return <I size={12} />; })()}
                      </span>
                    )}
                    <span className="truncate text-slate-700">{selectedChannel.channel_name}</span>
                  </span>
                ) : (
                  <span className="text-slate-400">
                    {channels.length ? `Select a ${PMETA[form.platform_type].label} channel…` : `No ${PMETA[form.platform_type].label} channels yet`}
                  </span>
                )}
                <ChevronDown size={16} className="shrink-0 text-slate-400" />
              </button>
              {channelOpen && (
                <>
                  <button className="fixed inset-0 z-10 cursor-default" onClick={() => setChannelOpen(false)} aria-hidden tabIndex={-1} />
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                    {channels.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-slate-400">Add one under Manage Platform first.</div>
                    ) : (
                      channels.map((p) => {
                        const I = PMETA[p.platform_type].icon;
                        return (
                          <button key={p.id} type="button"
                            onClick={() => { setForm((s) => ({ ...s, platform_id: p.id })); setChannelOpen(false); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                            {p.channel_logo_path ? (
                              <img src={p.channel_logo_path} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover" />
                            ) : (
                              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${PMETA[p.platform_type].color}`}><I size={12} /></span>
                            )}
                            <span className="truncate text-slate-700">{p.channel_name}</span>
                            {form.platform_id === p.id && <Check size={14} className="ml-auto text-brand" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <label className="label">Video URL {form.platform_type === "youtube" && <span className="text-slate-400">(fetch to auto-detect channel + details)</span>}</label>
            <div className="flex gap-2">
              <input className="input" value={form.youtube_url} placeholder="https://youtu.be/…"
                onChange={(e) => setForm((s) => ({ ...s, youtube_url: e.target.value }))} />
              {form.platform_type === "youtube" && (
                <button type="button" className="btn-ghost whitespace-nowrap" disabled={fetching || !form.youtube_url.trim()} onClick={fetchDetails}>
                  {fetching ? <Loader2 size={16} className="animate-spin" /> : <Youtube size={16} />} Fetch details
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Title</label>
              <input className="input" value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} placeholder="Show / segment title" />
            </div>
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" value={form.video_date} onChange={(e) => setForm((s) => ({ ...s, video_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Time</label>
              <input type="time" step={1} className="input" value={form.video_time} onChange={(e) => setForm((s) => ({ ...s, video_time: e.target.value }))} />
            </div>
          </div>

          {!isEdit && (
            <div>
              <label className="label">Audio file</label>
              <div onClick={() => audioRef.current?.click()} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); pickAudio(e.dataTransfer.files?.[0]); }}
                className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 px-4 py-5 transition hover:border-brand/50 hover:bg-brand-50/40">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500"><CloudUpload size={20} /></span>
                <div className="min-w-0 flex-1">
                  {form.audioFile ? <p className="truncate text-sm font-medium text-slate-700">{form.audioFile.name}</p>
                    : <p className="text-sm text-slate-500">Drop an mp3 / m4a / wav / aac, or click to browse</p>}
                </div>
              </div>
              <input ref={audioRef} type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={(e) => pickAudio(e.target.files?.[0] ?? undefined)} />
              {progress !== null && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label">Stocks</label>
            <button type="button" onClick={() => setForm((s) => ({ ...s, extract_all_stocks: !s.extract_all_stocks }))}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition ${form.extract_all_stocks ? "border-brand bg-brand-50" : "border-slate-200"}`}>
              <span className="text-slate-700">Extract stocks of all analysts in this video</span>
              <span className={`relative h-5 w-9 rounded-full transition ${form.extract_all_stocks ? "bg-brand" : "bg-slate-300"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${form.extract_all_stocks ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
          </div>

          {!form.extract_all_stocks && (
            <div>
              <label className="label">Target analysts <span className="text-slate-400">(select one or more)</span></label>
              {analysts.data && analysts.data.length > 0 ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="relative sm:w-60 sm:shrink-0">
                    <button type="button" onClick={() => setAnalystOpen((o) => !o)} className="input flex items-center justify-between gap-2 text-left">
                      <span className="text-slate-400">Add analyst…</span>
                      <ChevronDown size={16} className="shrink-0 text-slate-400" />
                    </button>
                    {analystOpen && (
                      <>
                        <button className="fixed inset-0 z-10 cursor-default" onClick={() => setAnalystOpen(false)} aria-hidden tabIndex={-1} />
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                          {analysts.data.filter((a) => !form.analyst_ids.includes(a.id)).length === 0 ? (
                            <div className="px-3 py-2 text-sm text-slate-400">All analysts selected.</div>
                          ) : (
                            analysts.data
                              .filter((a) => !form.analyst_ids.includes(a.id))
                              .map((a) => (
                                <button key={a.id} type="button" onClick={() => { toggleAnalyst(a.id); setAnalystOpen(false); }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                                  {a.avatar_path ? (
                                    <img src={a.avatar_path} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
                                  ) : (
                                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{a.name[0]?.toUpperCase() ?? "?"}</span>
                                  )}
                                  <span className="truncate text-slate-700">{a.name}</span>
                                </button>
                              ))
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-1 flex-wrap gap-2">
                    {form.analyst_ids.length === 0 ? (
                      <span className="self-center text-sm text-slate-400">No analysts selected yet.</span>
                    ) : (
                      form.analyst_ids.map((id) => {
                        const a = analysts.data!.find((x) => x.id === id);
                        if (!a) return null;
                        return (
                          <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-50 py-1 pl-1 pr-2 text-sm">
                            {a.avatar_path ? (
                              <img src={a.avatar_path} alt="" className="h-6 w-6 rounded-full object-cover" />
                            ) : (
                              <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[10px] font-semibold text-slate-500">{a.name[0]?.toUpperCase() ?? "?"}</span>
                            )}
                            <span className="font-medium text-slate-700">{a.name}</span>
                            <button type="button" onClick={() => toggleAnalyst(id)} className="text-slate-400 hover:text-danger" aria-label={`Remove ${a.name}`}><X size={14} /></button>
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-slate-400"><Users size={14} /> No analysts yet — add them under Analysts Profile.</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={!form.platform_id || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 size={18} className="animate-spin" />}{isEdit ? "Save changes" : "Add entry"}
            </button>
          </div>
        </div>
      </Modal>

      <PlayPopup job={playing} onClose={() => setPlaying(null)} />

      <Modal open={confirmDel !== null} onClose={() => setConfirmDel(null)} title="Delete entry?" maxWidth="max-w-md">
        <p className="text-sm text-slate-600">
          Remove <span className="font-medium">{confirmDel?.title || confirmDel?.platform_name || "this entry"}</span>? This deletes the job and all of its files.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn bg-danger text-white hover:bg-danger/90 focus:ring-danger/25" disabled={del.isPending} onClick={() => confirmDel && del.mutate(confirmDel.id)}>
            {del.isPending && <Loader2 size={18} className="animate-spin" />} Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}

function PlayPopup({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const embedId = ytEmbedId(job?.youtube_url ?? null);

  useEffect(() => {
    let revoked: string | null = null;
    setAudioUrl(null);
    if (job && !embedId && job.audio_url) {
      setLoading(true);
      api.getBlob(`/jobs/${job.id}/audio`)
        .then((b) => { const u = URL.createObjectURL(b); revoked = u; setAudioUrl(u); })
        .catch(() => toast.error("Could not load audio"))
        .finally(() => setLoading(false));
    }
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [job, embedId]);

  return (
    <Modal open={job !== null} onClose={onClose} title={job?.title || job?.platform_name || "Playback"} maxWidth="max-w-2xl">
      {embedId ? (
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <iframe className="h-full w-full" src={`https://www.youtube.com/embed/${embedId}`} title="Video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        </div>
      ) : job?.audio_url ? (
        loading ? <div className="grid h-24 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
          : audioUrl ? <audio controls autoPlay className="w-full" src={audioUrl} />
          : <p className="text-sm text-slate-500">Audio unavailable.</p>
      ) : (
        <p className="text-sm text-slate-500">No video or audio attached to this entry.</p>
      )}
    </Modal>
  );
}
