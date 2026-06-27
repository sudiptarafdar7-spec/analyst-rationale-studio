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
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
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
    api.getBlob(`/jobs/${jobId}/artifact?key=extracted`).then((b) => b.text())
      .then((t) => { if (!cancelled) setExtract(t.slice(0, 40000)); }).catch(() => setExtract(""));
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

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left: video + extract */}
        <div className="space-y-5">
          <div className="card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm font-semibold"><Video size={15} /> Source video</div>
            {embed ? (
              <div className="aspect-video w-full bg-black"><iframe title="video" src={embed} className="h-full w-full" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>
            ) : data.youtube_url ? (
              <div className="p-4 text-sm"><a className="text-brand underline" href={data.youtube_url} target="_blank" rel="noreferrer">Open video</a></div>
            ) : <div className="p-6 text-center text-sm text-slate-400">No video URL on this job.</div>}
          </div>

          <div className="card p-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm font-semibold"><FileText size={15} /> Output — Extract analysis</div>
            <div className="max-h-[420px] overflow-auto px-4 py-3">
              {extract ? <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-700">{extract}</pre>
                : <p className="text-sm text-slate-400">No extract output available.</p>}
            </div>
          </div>
        </div>

        {/* Right: pdf + actions */}
        <div className="card flex flex-col p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
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
          {pdfUrl ? <iframe title="pdf" src={pdfUrl} className="h-[640px] w-full" />
            : <div className="grid h-[640px] place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>}
          {isSigned && (
            <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-emerald-700">
              <CheckCircle2 size={14} /> This rationale is signed and archived under Signed Rationale.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
