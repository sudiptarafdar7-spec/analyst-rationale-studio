import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CloudUpload,
  Facebook,
  FileDown,
  Globe,
  Instagram,
  Loader2,
  MessageCircle,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
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
interface Job {
  id: string;
  platform_id: string | null;
  platform_name: string | null;
  platform_type: PlatformType | null;
  platform_logo: string | null;
  analyst_id: string | null;
  analyst_name: string | null;
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

const PLATFORM_META: Record<PlatformType, { icon: LucideIcon; color: string }> = {
  youtube: { icon: Youtube, color: "text-red-600 bg-red-50" },
  facebook: { icon: Facebook, color: "text-blue-600 bg-blue-50" },
  instagram: { icon: Instagram, color: "text-pink-600 bg-pink-50" },
  telegram: { icon: Send, color: "text-sky-600 bg-sky-50" },
  whatsapp: { icon: MessageCircle, color: "text-emerald-600 bg-emerald-50" },
  other: { icon: Globe, color: "text-slate-600 bg-slate-100" },
};

const STATUS_META: Record<JobStatus, { label: string; cls: string; pulse?: boolean }> = {
  pending: { label: "Pending", cls: "bg-slate-100 text-slate-600" },
  running: { label: "Running", cls: "bg-blue-100 text-blue-700", pulse: true },
  paused_review: { label: "Needs review", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700" },
  saved: { label: "Saved", cls: "bg-violet-100 text-violet-700" },
};

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
  const date = new Date(`${d}T${(t ?? "00:00:00")}`);
  if (Number.isNaN(date.getTime())) return `${d}${t ? " " + t : ""}`;
  return date.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    ...(t ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/** POST multipart with real upload progress via XHR (fetch lacks upload progress). */
function uploadWithProgress(path: string, fd: FormData, onProgress: (pct: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    const token = useAuthStore.getState().accessToken;
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
      } else {
        let detail = "Upload failed";
        try {
          const b = JSON.parse(xhr.responseText);
          detail = typeof b.detail === "string" ? b.detail : detail;
        } catch { /* ignore */ }
        reject(new ApiError(xhr.status, detail));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));
    xhr.send(fd);
  });
}

interface FormState {
  id?: string;
  platform_id: string;
  analyst_id: string;
  title: string;
  youtube_url: string;
  video_date: string;
  video_time: string;
  extract_all_stocks: boolean;
  audioFile: File | null;
}
const EMPTY: FormState = {
  platform_id: "", analyst_id: "", title: "", youtube_url: "",
  video_date: "", video_time: "", extract_all_stocks: false, audioFile: null,
};

export default function MediaPresence() {
  const qc = useQueryClient();
  const audioRef = useRef<HTMLInputElement>(null);

  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<Job[]>("/jobs") });
  const platforms = useQuery({ queryKey: ["platforms"], queryFn: () => api.get<Platform[]>("/platforms") });
  const analysts = useQuery({ queryKey: ["analysts"], queryFn: () => api.get<Analyst[]>("/analysts") });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<Job | null>(null);
  const [playing, setPlaying] = useState<Job | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const isEdit = Boolean(form.id);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["jobs"] });

  const openCreate = () => { setForm(EMPTY); setProgress(null); setOpen(true); };
  const openEdit = (j: Job) => {
    setMenuFor(null);
    setForm({
      id: j.id,
      platform_id: j.platform_id ?? "",
      analyst_id: j.analyst_id ?? "",
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

  const save = useMutation({
    mutationFn: async () => {
      if (form.id) {
        return api.patch(`/jobs/${form.id}`, {
          platform_id: form.platform_id || null,
          analyst_id: form.analyst_id || null,
          title: form.title || null,
          youtube_url: form.youtube_url || null,
          video_date: form.video_date || null,
          video_time: form.video_time || null,
          extract_all_stocks: form.extract_all_stocks,
        });
      }
      const fd = new FormData();
      fd.append("platform_id", form.platform_id);
      if (form.analyst_id) fd.append("analyst_id", form.analyst_id);
      fd.append("extract_all_stocks", String(form.extract_all_stocks));
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
      setOpen(false);
      setProgress(null);
      invalidate();
    },
    onError: (e) => {
      setProgress(null);
      toast.error(e instanceof ApiError ? e.message : "Could not save entry");
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/jobs/${id}`),
    onSuccess: () => { toast.success("Entry deleted"); setConfirmDel(null); invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not delete"),
  });

  const start = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/start`),
    onSuccess: () => { toast.success("Pipeline started"); invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not start"),
  });
  const restart = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/restart`),
    onSuccess: () => { toast.success("Restarting from step 1"); setMenuFor(null); invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not restart"),
  });

  const pickAudio = (f: File | undefined) => {
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!AUDIO_EXTS.includes(ext)) {
      toast.error("Audio must be mp3, m4a, wav or aac");
      return;
    }
    setForm((s) => ({ ...s, audioFile: f }));
  };

  const fetchDetails = async () => {
    if (!form.youtube_url.trim()) { toast.error("Paste the video URL first"); return; }
    setFetching(true);
    try {
      const r = await api.get<{ channel: string; title: string; upload_date: string | null; upload_time: string | null }>(
        `/youtube/metadata?url=${encodeURIComponent(form.youtube_url.trim())}`,
      );
      setForm((s) => ({
        ...s,
        title: r.title || s.title,
        video_date: r.upload_date || s.video_date,
        video_time: r.upload_time || s.video_time,
      }));
      toast.success(`Fetched: ${r.channel}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not fetch video details");
    } finally {
      setFetching(false);
    }
  };

  const selectedAnalyst = analysts.data?.find((a) => a.id === form.analyst_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <Radio size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Media Presence</h1>
            <p className="text-sm text-slate-500">Log each media appearance, then turn it into a compliance rationale.</p>
          </div>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={18} /> Add entry
        </button>
      </div>

      {jobs.isLoading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : jobs.data && jobs.data.length > 0 ? (
        <div className="card divide-y divide-slate-100">
          {jobs.data.map((j) => {
            const meta = PLATFORM_META[j.platform_type ?? "other"];
            const Icon = meta.icon;
            const st = STATUS_META[j.status];
            return (
              <div key={j.id} className="flex items-center gap-4 p-4">
                {j.platform_logo ? (
                  <img src={j.platform_logo} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
                ) : (
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${meta.color}`}><Icon size={20} /></span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{j.title || j.platform_name || "Untitled appearance"}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                      {st.pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />}
                      {st.label}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-500">
                    {j.platform_name ?? "—"}
                    {j.analyst_name ? <> · <span className="text-slate-600">{j.analyst_name}</span></> : null}
                    {" · "}{fmtDateTime(j.video_date, j.video_time)}
                  </div>
                </div>

                {(j.youtube_url || j.audio_url) && (
                  <button className="btn-ghost px-3 py-2 text-xs" onClick={() => setPlaying(j)} title="Play">
                    <Play size={14} /> Play
                  </button>
                )}
                {j.status === "completed" && j.pdf_url && (
                  <a className="btn-ghost px-3 py-2 text-xs" href={j.pdf_url} target="_blank" rel="noreferrer">
                    <FileDown size={14} /> PDF
                  </a>
                )}
                {j.status === "pending" && (
                  <button className="btn-primary px-3 py-2 text-xs" disabled={start.isPending}
                    onClick={() => start.mutate(j.id)}>
                    <Sparkles size={14} /> Start making rationale
                  </button>
                )}

                <div className="relative">
                  <button className="btn-ghost px-2 py-2" onClick={() => setMenuFor(menuFor === j.id ? null : j.id)} aria-label="Actions">
                    <MoreVertical size={16} />
                  </button>
                  {menuFor === j.id && (
                    <>
                      <button className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuFor(null)} aria-hidden tabIndex={-1} />
                      <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50" onClick={() => openEdit(j)}>
                          <Pencil size={14} /> Edit
                        </button>
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                          disabled={restart.isPending} onClick={() => restart.mutate(j.id)}>
                          <RotateCcw size={14} /> Restart
                        </button>
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-red-50"
                          onClick={() => { setMenuFor(null); setConfirmDel(j); }}>
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card grid place-items-center p-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Radio size={22} /></span>
          <h2 className="mt-4 text-lg font-semibold">No media appearances yet</h2>
          <p className="mt-1 text-sm text-slate-500">Add an appearance to start building a rationale.</p>
          <button className="btn-primary mt-4" onClick={openCreate}><Plus size={18} /> Add entry</button>
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={isEdit ? "Edit entry" : "Add media presence"}
        description="Pick the channel, add the video/audio, and choose the target analyst." maxWidth="max-w-2xl">
        <div className="space-y-5">
          {/* Platform / channel select */}
          <div>
            <label className="label">Channel</label>
            {platforms.data && platforms.data.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {platforms.data.map((p) => {
                  const m = PLATFORM_META[p.platform_type];
                  const Icon = m.icon;
                  const active = form.platform_id === p.id;
                  return (
                    <button key={p.id} type="button" onClick={() => setForm((s) => ({ ...s, platform_id: p.id }))}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                        active ? "border-brand bg-brand-50 ring-2 ring-brand/20" : "border-slate-200 hover:border-slate-300"}`}>
                      {p.channel_logo_path ? (
                        <img src={p.channel_logo_path} alt="" className="h-7 w-7 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${m.color}`}><Icon size={14} /></span>
                      )}
                      <span className="truncate font-medium text-slate-700">{p.channel_name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No platforms yet — add one under Manage Platform first.</p>
            )}
          </div>

          {/* Video URL + fetch */}
          <div>
            <label className="label">Video URL <span className="text-slate-400">(YouTube — fetch to autofill)</span></label>
            <div className="flex gap-2">
              <input className="input" value={form.youtube_url} placeholder="https://youtu.be/…"
                onChange={(e) => setForm((s) => ({ ...s, youtube_url: e.target.value }))} />
              <button type="button" className="btn-ghost whitespace-nowrap" disabled={fetching || !form.youtube_url.trim()} onClick={fetchDetails}>
                {fetching ? <Loader2 size={16} className="animate-spin" /> : <Youtube size={16} />} Fetch details
              </button>
            </div>
          </div>

          {/* autofilled, editable fields */}
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

          {/* Audio dropzone (create only) */}
          {!isEdit && (
            <div>
              <label className="label">Audio file</label>
              <div
                onClick={() => audioRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); pickAudio(e.dataTransfer.files?.[0]); }}
                className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 px-4 py-5 transition hover:border-brand/50 hover:bg-brand-50/40">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500"><CloudUpload size={20} /></span>
                <div className="min-w-0 flex-1">
                  {form.audioFile ? (
                    <p className="truncate text-sm font-medium text-slate-700">{form.audioFile.name}</p>
                  ) : (
                    <p className="text-sm text-slate-500">Drop an mp3 / m4a / wav / aac, or click to browse</p>
                  )}
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

          {/* Analyst + extract-all */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Target analyst</label>
              <div className="flex items-center gap-2">
                {selectedAnalyst?.avatar_path ? (
                  <img src={selectedAnalyst.avatar_path} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                    {selectedAnalyst?.name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                )}
                <select className="input" value={form.analyst_id} onChange={(e) => setForm((s) => ({ ...s, analyst_id: e.target.value }))}>
                  <option value="">Select analyst…</option>
                  {analysts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Stocks</label>
              <button type="button" onClick={() => setForm((s) => ({ ...s, extract_all_stocks: !s.extract_all_stocks }))}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition ${
                  form.extract_all_stocks ? "border-brand bg-brand-50" : "border-slate-200"}`}>
                <span className="text-slate-700">Extract all stocks from this video</span>
                <span className={`relative h-5 w-9 rounded-full transition ${form.extract_all_stocks ? "bg-brand" : "bg-slate-300"}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${form.extract_all_stocks ? "left-[18px]" : "left-0.5"}`} />
                </span>
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={!form.platform_id || save.isPending}
              onClick={() => save.mutate()}>
              {save.isPending && <Loader2 size={18} className="animate-spin" />}
              {isEdit ? "Save changes" : "Add entry"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Play popup */}
      <PlayPopup job={playing} onClose={() => setPlaying(null)} />

      {/* Delete confirm */}
      <Modal open={confirmDel !== null} onClose={() => setConfirmDel(null)} title="Delete entry?" maxWidth="max-w-md">
        <p className="text-sm text-slate-600">
          Remove <span className="font-medium">{confirmDel?.title || confirmDel?.platform_name || "this entry"}</span>?
          This deletes the job and all of its files.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn bg-danger text-white hover:bg-danger/90 focus:ring-danger/25"
            disabled={del.isPending} onClick={() => confirmDel && del.mutate(confirmDel.id)}>
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
        loading ? (
          <div className="grid h-24 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
        ) : audioUrl ? (
          <audio controls autoPlay className="w-full" src={audioUrl} />
        ) : (
          <p className="text-sm text-slate-500">Audio unavailable.</p>
        )
      ) : (
        <p className="text-sm text-slate-500">No video or audio attached to this entry.</p>
      )}
    </Modal>
  );
}
