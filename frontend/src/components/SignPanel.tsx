import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2, Cloud, Download, FileCheck2, FileText, Loader2, PenLine,
  ShieldCheck, Sparkles, Upload, Usb, X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { toast } from "../store/toast";

type Method = "manual" | "web";

interface SignPanelProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  title?: string | null;
  mode?: "sign" | "resign";
  onSigned?: () => void;
}

export default function SignPanel({ open, onClose, jobId, title, mode = "sign", onSigned }: SignPanelProps) {
  const [method, setMethod] = useState<Method>("manual");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the document to sign: prefer the unsigned rationale, else the current signed copy.
  useEffect(() => {
    if (!open) return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      for (const p of [`/jobs/${jobId}/pdf`, `/review/${jobId}/signed-pdf`]) {
        try {
          const b = await api.getBlob(p);
          if (cancelled) return;
          url = URL.createObjectURL(b);
          setSourceUrl(url);
          return;
        } catch { /* try next */ }
      }
      if (!cancelled) setSourceUrl(null);
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [open, jobId]);

  // Reset transient state whenever the panel opens.
  useEffect(() => {
    if (open) { setFile(null); setVerified(false); setMethod("manual"); }
  }, [open]);

  // Object URL for the uploaded-file preview.
  useEffect(() => {
    if (!file) { setUploadUrl(null); return; }
    const u = URL.createObjectURL(file);
    setUploadUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please choose a PDF file"); return;
    }
    setFile(f); setVerified(false);
  };

  const downloadSource = async () => {
    try {
      const b = await api.getBlob(`/jobs/${jobId}/pdf`).catch(() => api.getBlob(`/review/${jobId}/signed-pdf`));
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || "rationale").replace(/[^\w.-]+/g, "_")}-unsigned.pdf`;
      a.click(); URL.revokeObjectURL(url);
    } catch { toast.error("Could not download the document"); }
  };

  const save = async () => {
    if (!file || !verified) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      await api.postForm(`/review/${jobId}/sign`, fd);
      toast.success(mode === "resign" ? "Document re-signed & saved" : "Document signed & saved");
      onSigned?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save the signed PDF");
    } finally { setSaving(false); }
  };

  const heading = mode === "resign" ? "Re-sign document" : "Sign document";
  const canSave = method === "manual" && !!file && verified && !saving;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => !saving && onClose()} aria-hidden />
          <motion.div
            role="dialog" aria-modal="true" aria-label={heading}
            initial={{ opacity: 0, scale: 0.97, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }} transition={{ type: "spring", duration: 0.35, bounce: 0.18 }}
            className="relative z-10 flex h-[92vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
          >
            {/* Header */}
            <div className="relative shrink-0 border-b border-slate-100">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand via-violet-500 to-emerald-400" />
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-violet-100 text-brand-700 ring-1 ring-brand-100">
                    <PenLine size={20} />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-slate-800">{heading}</h2>
                    <p className="text-xs text-slate-500">{title || "Rationale"} · sign and archive to Signed Rationale</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Method segmented control */}
                  <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                    <button
                      onClick={() => setMethod("manual")}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${method === "manual" ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      <Upload size={14} /> Manual upload
                    </button>
                    <button
                      onClick={() => setMethod("web")}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${method === "web" ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      <Cloud size={14} /> Web sign
                      <span className="ml-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Soon</span>
                    </button>
                  </div>
                  <button onClick={() => !saving && onClose()} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
                    <X size={18} />
                  </button>
                </div>
              </div>
            </div>

            {/* Body */}
            {method === "manual" ? (
              <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
                {/* Left: document to sign */}
                <div className="flex min-h-0 flex-col border-b border-slate-100 lg:border-b-0 lg:border-r">
                  <div className="flex shrink-0 items-center justify-between px-5 py-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-700"><FileText size={15} /> Unsigned document</span>
                    <button onClick={downloadSource} className="btn-ghost px-2.5 py-1 text-xs"><Download size={13} /> Download to sign</button>
                  </div>
                  <div className="mx-5 mb-3 shrink-0 rounded-lg bg-brand-50/60 px-3 py-2 text-[11px] leading-relaxed text-brand-700 ring-1 ring-brand-100">
                    <Usb size={12} className="mb-0.5 mr-1 inline" />
                    Download it, sign in <strong>Adobe Acrobat</strong> with your DSC pendrive token, then upload the signed PDF on the right.
                  </div>
                  <div className="min-h-0 flex-1 bg-slate-50 p-4">
                    {sourceUrl ? <iframe title="unsigned" src={sourceUrl} className="h-full w-full rounded-lg bg-white ring-1 ring-slate-200" />
                      : <div className="grid h-full place-items-center text-sm text-slate-400"><Loader2 className="animate-spin" /></div>}
                  </div>
                </div>

                {/* Right: upload signed */}
                <div className="flex min-h-0 flex-col">
                  <div className="flex shrink-0 items-center justify-between px-5 py-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-700"><FileCheck2 size={15} /> Signed document</span>
                    {file && <button onClick={() => { setFile(null); setVerified(false); }} className="btn-ghost px-2.5 py-1 text-xs">Replace</button>}
                  </div>

                  {!file ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center p-5">
                      <div
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
                        onClick={() => inputRef.current?.click()}
                        className={`flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition ${dragOver ? "border-brand bg-brand-50" : "border-slate-300 bg-slate-50 hover:border-brand hover:bg-brand-50/40"}`}
                      >
                        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm ring-1 ring-slate-200"><Upload size={26} /></span>
                        <div>
                          <div className="text-sm font-semibold text-slate-700">Drop the signed PDF here</div>
                          <div className="text-xs text-slate-400">or click to browse · PDF only</div>
                        </div>
                      </div>
                      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
                    </div>
                  ) : (
                    <>
                      <div className="min-h-0 flex-1 bg-slate-50 p-4">
                        {uploadUrl ? <iframe title="signed" src={uploadUrl} className="h-full w-full rounded-lg bg-white ring-1 ring-slate-200" />
                          : <div className="grid h-full place-items-center text-sm text-slate-400"><Loader2 className="animate-spin" /></div>}
                      </div>
                      <div className="shrink-0 space-y-2 border-t border-slate-100 px-5 py-3">
                        <div className="flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 size={13} /> {file.name} · {(file.size / 1024).toFixed(0)} KB</div>
                        <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-600">
                          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
                          I have reviewed the preview above and confirm this is the correctly signed document.
                        </label>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* Web sign — coming soon */
              <div className="grid min-h-0 flex-1 place-items-center p-8">
                <div className="max-w-lg text-center">
                  <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-violet-100 text-brand-700 ring-1 ring-brand-100"><Sparkles size={28} /></span>
                  <h3 className="text-lg font-bold text-slate-800">Web signing is coming soon</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">
                    In-browser signing via <strong>Adobe Acrobat Sign</strong> is planned. A browser can&rsquo;t talk to a
                    physical DSC pendrive directly, so for now use <button onClick={() => setMethod("manual")} className="font-semibold text-brand-700 underline">Manual upload</button>:
                    download the PDF, sign it in Adobe Acrobat with your DSC token, and upload it back.
                  </p>
                  <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-400">
                    <ShieldCheck size={14} /> Your signature stays on your machine and token.
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className={`flex items-center gap-1 ${file ? "text-emerald-600" : ""}`}>{file ? <CheckCircle2 size={13} /> : <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-slate-300 text-[8px]">1</span>} Upload</span>
                <span className="text-slate-300">›</span>
                <span className={`flex items-center gap-1 ${verified ? "text-emerald-600" : ""}`}>{verified ? <CheckCircle2 size={13} /> : <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-slate-300 text-[8px]">2</span>} Verify</span>
                <span className="text-slate-300">›</span>
                <span className="flex items-center gap-1"><span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-slate-300 text-[8px]">3</span> Save</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => !saving && onClose()} className="btn-ghost">Cancel</button>
                <button onClick={save} disabled={!canSave} className="btn-primary">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  {mode === "resign" ? "Save re-signed PDF" : "Save to Signed Rationale"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
