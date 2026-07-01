import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CheckCircle2, Download, FileText, Loader2, ShieldCheck, Upload, Video,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { toast } from "../store/toast";
import { useAuthStore } from "../store/auth";
import { hasPerm } from "../lib/perms";

interface JobDetail {
  id: string; title: string | null; platform_name: string | null; youtube_url: string | null;
  status: string; signed_at: string | null; pdf_url: string | null;
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
  const fileRef = useRef<HTMLInputElement>(null);

  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`) });
  const data = job.data;
  const isSigned = data?.status === "signed";

  const [extract, setExtract] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

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
    try {
      const path = isSigned ? `/review/${jobId}/signed-pdf` : `/jobs/${jobId}/pdf`;
      const blob = await api.getBlob(path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${(data?.title || "rationale").replace(/[^\w.-]+/g, "_")}${isSigned ? "-signed" : ""}.pdf`;
      a.click(); URL.revokeObjectURL(url);
    } catch { toast.error("Could not download PDF"); }
  };

  const sign = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("pdf", file); return api.postForm(`/review/${jobId}/sign`, fd); },
    onSuccess: () => { toast.success("Signed PDF uploaded"); qc.invalidateQueries({ queryKey: ["job", jobId] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not upload signed PDF"),
  });

  if (job.isLoading) return <div className="grid h-80 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>;
  if (!data) return <div className="card p-8 text-center text-slate-500">Job not found.</div>;
  const embed = embedUrl(data.youtube_url);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button className="btn-ghost px-2 py-2" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={18} /></button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">{data.platform_name ?? "Rationale"}</h1>
            <p className="truncate text-sm text-slate-500">{data.title || "Review & sign"}</p>
          </div>
        </div>
        {isSigned ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-700">
            <ShieldCheck size={16} /> Signed{data.signed_at ? ` · ${new Date(data.signed_at).toLocaleString()}` : ""}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-700">Pending review</span>
        )}
      </div>

      <div className="grid gap-5 lg:h-[calc(100vh-12rem)] lg:grid-cols-2 lg:items-stretch">
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
            <div className="flex items-center gap-2">
              <button className="btn-ghost px-2.5 py-1 text-xs" onClick={download}><Download size={13} /> Download</button>
              {canSign && (
                <>
                  <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) sign.mutate(f); e.target.value = ""; }} />
                  <button className="btn-primary px-2.5 py-1 text-xs" disabled={sign.isPending} onClick={() => fileRef.current?.click()}>
                    {sign.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {isSigned ? "Replace signed" : "Upload signed"}
                  </button>
                </>
              )}
            </div>
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
    </div>
  );
}
