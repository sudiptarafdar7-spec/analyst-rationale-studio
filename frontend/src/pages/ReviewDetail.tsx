import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CalendarClock, CheckCircle2, Download, Facebook, FileText, Globe, Instagram,
  Loader2, MessageCircle, PenLine, Send, ShieldCheck, Users, Video, Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "../store/toast";
import { useAuthStore } from "../store/auth";
import { hasPerm } from "../lib/perms";
import SignPanel from "../components/SignPanel";
import { pdfFileName } from "../lib/pdfName";

interface AnalystRef { id: string; name: string; avatar_path: string | null }
interface JobDetail {
  id: string; title: string | null; platform_name: string | null; platform_type: string | null;
  platform_logo: string | null; youtube_url: string | null; status: string;
  signed_at: string | null; pdf_url: string | null; video_date: string | null; video_time: string | null;
  extract_all_stocks?: boolean; analysts?: AnalystRef[];
}

const PMETA: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  youtube: { label: "YouTube", icon: Youtube, color: "text-red-600 bg-red-50" },
  facebook: { label: "Facebook", icon: Facebook, color: "text-blue-600 bg-blue-50" },
  instagram: { label: "Instagram", icon: Instagram, color: "text-pink-600 bg-pink-50" },
  telegram: { label: "Telegram", icon: Send, color: "text-sky-600 bg-sky-50" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "text-emerald-600 bg-emerald-50" },
  other: { label: "Other", icon: Globe, color: "text-slate-600 bg-slate-100" },
};

function fmtDateTime(d: string | null, t: string | null): string {
  if (!d) return "Date not set";
  const date = new Date(`${d}T${t ?? "00:00:00"}`);
  if (Number.isNaN(date.getTime())) return `${d}${t ? " " + t : ""}`;
  return date.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    ...(t ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function embedUrl(url: string | null): string | null {
  if (!url) return null;
  // Support every YouTube URL shape: watch?v=, youtu.be/, /embed/, /shorts/,
  // and live streams (/live/ or watch?v= while live). Falls back to null for
  // non-YouTube links so the page shows an "Open video" button instead.
  const yt = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  // Bare 11-char id fallback (e.g. someone pasted just the id).
  const bare = url.match(/^[\w-]{11}$/);
  if (bare) return `https://www.youtube.com/embed/${bare[0]}`;
  return null;
}

export default function ReviewDetail() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const canSign = hasPerm(me, "review:sign");

  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`) });
  const data = job.data;
  const isSigned = data?.status === "signed";

  const [extract, setExtract] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Show the reviewer-EDITED extract (bulk-input-english.txt, saved at the
    // step-4 review gate). Fall back to the raw AI extract if edits were never
    // saved on this job.
    const load = async () => {
      for (const key of ["bulk_input_english", "extracted"]) {
        try {
          const b = await api.getBlob(`/jobs/${jobId}/artifact?key=${key}`);
          const t = (await b.text()).trim();
          if (t) { if (!cancelled) setExtract(t.slice(0, 60000)); return; }
        } catch { /* try next key */ }
      }
      if (!cancelled) setExtract("");
    };
    void load();
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    if (!data) return;
    let url: string | null = null;
    const path = isSigned ? `/review/${jobId}/signed-pdf` : `/jobs/${jobId}/pdf`;
    api.getBlob(path).then((b) => { url = URL.createObjectURL(b); setPdfUrl(url); }).catch(() => setPdfUrl(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [jobId, data, isSigned]);

  const download = async () => {
    if (!data) return;
    try {
      const path = isSigned ? `/review/${jobId}/signed-pdf` : `/jobs/${jobId}/pdf`;
      const blob = await api.getBlob(path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = pdfFileName(data, isSigned);
      a.click(); URL.revokeObjectURL(url);
    } catch { toast.error("Could not download PDF"); }
  };

  const onSigned = () => {
    qc.invalidateQueries({ queryKey: ["job", jobId] });
    qc.invalidateQueries({ queryKey: ["pending"] });
    qc.invalidateQueries({ queryKey: ["signed"] });
    navigate("/signed");
  };

  if (job.isLoading) return <div className="grid h-80 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>;
  if (!data) return <div className="card p-8 text-center text-slate-500">Job not found.</div>;
  const embed = embedUrl(data.youtube_url);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button className="btn-ghost px-2 py-2" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={18} /></button>
          {(() => { const m = PMETA[data.platform_type ?? "other"] ?? PMETA.other; const PIcon = m.icon;
            return <span title={m.label} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${m.color}`}><PIcon size={19} /></span>; })()}
          {data.platform_logo ? (
            <img src={data.platform_logo} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-500">{(data.platform_name ?? "?")[0]?.toUpperCase()}</span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight">{data.platform_name ?? "Rationale"}</h1>
              {isSigned
                ? <span className="shrink-0 text-sm font-semibold text-emerald-600">Signed</span>
                : <span className="shrink-0 text-sm font-semibold text-violet-600">Pending review</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {fmtDateTime(data.video_date, data.video_time)}</span>
              {(data.extract_all_stocks || (data.analysts?.length ?? 0) > 0) && <span className="text-slate-300">·</span>}
              {data.extract_all_stocks ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600"><Users size={11} /> All analysts</span>
              ) : (data.analysts ?? []).map((a) => (
                <span key={a.id} title={a.name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2 font-medium text-slate-700">
                  {a.avatar_path
                    ? <img src={a.avatar_path} alt="" className="h-4 w-4 rounded-full object-cover" />
                    : <span className="grid h-4 w-4 place-items-center rounded-full bg-brand-100 text-[8px] font-semibold text-brand-700">{a.name[0]?.toUpperCase()}</span>}
                  <span className="max-w-[140px] truncate">{a.name}</span>
                </span>
              ))}
            </div>
            {data.title && <p className="mt-0.5 truncate text-xs text-slate-400" title={data.title}>{data.title}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {canSign && !isSigned && (
            <button className="btn-primary" onClick={() => setSignOpen(true)}><PenLine size={16} /> Sign document</button>
          )}
          {isSigned && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-700">
              <ShieldCheck size={16} /> Signed{data.signed_at ? ` · ${new Date(data.signed_at).toLocaleString()}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:h-[calc(100vh-9rem)] lg:grid-cols-2 lg:items-stretch">
        {/* Left: video + extract */}
        <div className="flex min-h-0 flex-col gap-5">
          <div className="card shrink-0 overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm font-semibold"><Video size={15} /> Source video</div>
            {embed ? (
              <div className="aspect-video w-full bg-black"><iframe title="video" src={embed} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div>
            ) : data.youtube_url ? (
              <div className="p-4 text-sm"><a className="text-brand underline" href={data.youtube_url} target="_blank" rel="noreferrer">Open video</a></div>
            ) : <div className="p-6 text-center text-sm text-slate-400">No video URL on this job.</div>}
          </div>

          <div className="card flex min-h-0 flex-1 flex-col p-0">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">
              <FileText size={15} /> Output — Extract analysis
              <span className="ml-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">reviewed</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              {extract ? <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-slate-700">{extract}</pre>
                : <p className="text-sm text-slate-400">No extract output available.</p>}
            </div>
          </div>
        </div>

        {/* Right: pdf + actions */}
        <div className="card flex min-h-0 flex-col p-0">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold"><FileText size={15} /> {isSigned ? "Signed PDF" : "Rationale PDF"}</span>
            <button className="btn-ghost px-2.5 py-1 text-xs" onClick={download}><Download size={13} /> Download</button>
          </div>
          {pdfUrl ? <iframe title="pdf" src={pdfUrl} className="min-h-[520px] w-full flex-1" />
            : <div className="grid min-h-[520px] flex-1 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>}
          {isSigned && (
            <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-emerald-700">
              <CheckCircle2 size={14} /> This rationale is signed and archived under Signed Rationale.
            </div>
          )}
        </div>
      </div>

      <SignPanel open={signOpen} onClose={() => setSignOpen(false)} jobId={jobId} title={data.title}
        platformType={data.platform_type} platformName={data.platform_name} platformLogo={data.platform_logo}
        videoDate={data.video_date} videoTime={data.video_time} mode="sign" onSigned={onSigned} />
    </div>
  );
}
