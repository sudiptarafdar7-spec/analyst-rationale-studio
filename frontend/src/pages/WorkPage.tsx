import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, CalendarClock, Check, CheckCircle2, ChevronRight, CloudUpload,
  Download, Eye, EyeOff, Facebook, Globe, Instagram, Loader2, MessageCircle, Play,
  Plus, RotateCcw, Send, Trash2, TrendingUp, Users, X, Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiError } from "../lib/api";
import Modal from "../components/Modal";
import StepStage from "../components/StepStage";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";

type JobStatus = "pending" | "running" | "paused_review" | "completed" | "failed" | "saved" | "signed";
type GateKind = "none" | "extract_review" | "mapping_review" | "chart_upload";
type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

interface StepOut {
  step_no: number;
  step_key: string;
  status: StepStatus;
  log_tail: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}
interface JobDetail {
  id: string;
  title: string | null;
  platform_name: string | null;
  platform_type: string | null;
  platform_logo: string | null;
  video_date: string | null;
  video_time: string | null;
  extract_all_stocks?: boolean;
  status: JobStatus;
  gate: GateKind;
  current_step: number;
  error_message: string | null;
  output_pdf_path: string | null;
  pdf_url: string | null;
  analysts?: { id: string; name: string; avatar_path: string | null }[];
  steps: StepOut[];
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

const STEP_LABELS: Record<number, string> = {
  1: "Transcribe", 2: "Translate", 3: "Detect speakers", 4: "Extract analysis",
  5: "Convert to CSV", 6: "Polish analysis", 7: "Map master file", 8: "Fetch CMP",
  9: "Generate charts", 10: "Generate PDF",
};
const ARTIFACT_KEY: Record<number, string> = {
  1: "transcript", 2: "translated", 3: "speakers", 4: "extracted", 5: "bulk_input",
  6: "polished", 7: "mapped", 8: "cmp", 9: "charts_csv",
};
const GATE_STEP: Record<Exclude<GateKind, "none">, number> = {
  extract_review: 4, mapping_review: 7, chart_upload: 9,
};

export default function WorkPage() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 4000 : false),
  });

  const [activeStep, setActiveStep] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [retryStep, setRetryStep] = useState<number | null>(null);

  const data = job.data;
  const refetch = () => qc.invalidateQueries({ queryKey: ["job", jobId] });

  // Auto-follow the pipeline: jump to the running step as it advances, and land
  // on the gate step while paused for review.
  useEffect(() => {
    if (!data) return;
    const gs = data.gate !== "none" ? GATE_STEP[data.gate] : null;
    const target = data.status === "paused_review" && gs ? gs : Math.min(Math.max(data.current_step || 1, 1), 10);
    setActiveStep(target);
  }, [data?.current_step, data?.status, data?.gate]);

  // Live progress over WS (history is replayed on connect, so refresh rebuilds logs).
  useEffect(() => {
    if (!jobId) return;
    const token = useAuthStore.getState().accessToken ?? "";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/jobs/${jobId}?token=${encodeURIComponent(token)}`);
    ws.onmessage = (e) => {
      let ev: { type: string };
      try { ev = JSON.parse(e.data); } catch { return; }
      if (["step", "gate", "done", "error"].includes(ev.type)) refetch();
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const stepMap = useMemo(() => {
    const m = new Map<number, StepOut>();
    data?.steps.forEach((s) => m.set(s.step_no, s));
    return m;
  }, [data?.steps]);

  async function act(path: string, body?: unknown, okMsg?: string) {
    setBusy(true);
    try {
      await api.post(path, body);
      if (okMsg) toast.success(okMsg);
      setTimeout(refetch, 300);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (job.isLoading) return <div className="grid h-80 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>;
  if (!data) return <div className="card p-8 text-center text-slate-500">Job not found. <Link className="text-brand" to="/ai-rationale">Back</Link></div>;

  const gateStep = data.gate !== "none" ? GATE_STEP[data.gate] : null;
  // Revisiting a passed review gate (step 4 or 7): offer an inline re-edit of the
  // already-reviewed file (no AI re-generation) that re-runs everything after it.
  const liveGate = data.status === "paused_review" && gateStep === activeStep;
  const reeditStep =
    (activeStep === 4 || activeStep === 7) &&
    stepMap.get(activeStep)?.status === "done" &&
    !liveGate && data.status !== "signed" && data.status !== "running"
      ? activeStep : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button className="btn-ghost px-2 py-2" onClick={() => navigate("/ai-rationale")} aria-label="Back"><ArrowLeft size={18} /></button>
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
              <StatusBadge status={data.status} />
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
                  <span className="max-w-[100px] truncate">{a.name}</span>
                </span>
              ))}
            </div>
            {data.title && <p className="mt-0.5 truncate text-xs text-slate-400" title={data.title}>{data.title}</p>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {data.status === "pending" && (
            <button className="btn-primary" disabled={busy} onClick={() => act(`/jobs/${jobId}/start`, undefined, "Pipeline started")}>
              <Play size={16} /> Start
            </button>
          )}
          {(data.status === "saved" || data.status === "completed") && (
            <Link to={`/admin/watchlist?job=${jobId}`} className="btn-ghost" title="View this job's calls in the watchlist">
              <TrendingUp size={16} /> Watchlist
            </Link>
          )}
          {data.status !== "signed" && (
            <button className="btn-ghost" disabled={busy} onClick={() => act(`/jobs/${jobId}/restart`, undefined, "Restarting from step 1")}>
              <RotateCcw size={16} /> Restart
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Stepper */}
        <div className="card h-fit p-3">
          <ol className="space-y-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
              const s = stepMap.get(n);
              const st: StepStatus = s?.status ?? "pending";
              const isActive = n === activeStep;
              return (
                <li key={n} className="group flex items-center gap-1">
                  <button
                    onClick={() => setActiveStep(n)}
                    className={`flex flex-1 items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition ${isActive ? "bg-brand-50 ring-1 ring-brand/20" : "hover:bg-slate-50"}`}
                  >
                    <StepIcon status={st} n={n} />
                    <span className={`flex-1 truncate ${st === "done" ? "text-slate-700" : st === "running" ? "font-medium text-blue-700" : "text-slate-500"}`}>{STEP_LABELS[n]}</span>
                    {gateStep === n && data.status === "paused_review" && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">REVIEW</span>}
                  </button>
                  {data.status !== "signed" && (
                    <button onClick={() => setRetryStep(n)} title={`Restart from step ${n}`}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-brand focus:opacity-100 group-hover:opacity-100">
                      <RotateCcw size={13} />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Main column */}
        <div className="min-w-0 space-y-6">
          {/* Gate / status panel */}
          {data.status === "paused_review" && data.gate === "extract_review" && <ExtractGate jobId={jobId} onDone={refetch} />}
          {data.status === "paused_review" && data.gate === "mapping_review" && <MappingGate jobId={jobId} onDone={refetch} />}
          {data.status === "paused_review" && data.gate === "chart_upload" && <ChartsGate jobId={jobId} onDone={refetch} />}
          {data.status === "completed" && <CompletionPanel job={data} onSaved={refetch} onDeleted={() => navigate("/ai-rationale")} />}
          {data.status === "saved" && <CompletionPanel job={data} saved onSaved={refetch} onDeleted={() => navigate("/ai-rationale")} />}
          {data.status === "signed" && <CompletionPanel job={data} signed onSaved={refetch} onDeleted={() => navigate("/ai-rationale")} />}
          {data.status === "failed" && (
            <FailurePanel job={data} busy={busy}
              onRetry={() => act(`/jobs/${jobId}/retry-step`, { step_no: data.current_step }, `Retrying step ${data.current_step}`)}
              onRestart={() => act(`/jobs/${jobId}/restart`, undefined, "Restarting")} />
          )}

          {/* Re-edit a previously reviewed gate file (step 4 / 7) and re-run downstream. */}
          {reeditStep === 4 && <ExtractGate jobId={jobId} reedit onDone={refetch} />}
          {reeditStep === 7 && <MappingGate jobId={jobId} reedit onDone={refetch} />}

          {/* Animated per-step progress — hidden while a review gate, re-edit
              panel or the completion/PDF panel is showing. */}
          {!reeditStep && data.status !== "paused_review" && data.status !== "completed" && data.status !== "saved" && (
            <StepStage step={activeStep} status={stepMap.get(activeStep)?.status ?? "pending"} label={STEP_LABELS[activeStep]} analysts={data.analysts} />
          )}

          {/* Artifact preview for the active step (hidden when the re-edit panel shows). */}
          {!reeditStep && <ArtifactPreview jobId={jobId} step={activeStep} stepStatus={stepMap.get(activeStep)?.status ?? "pending"} signed={data.status === "signed"} />}
        </div>
      </div>

      <Modal open={retryStep !== null} onClose={() => setRetryStep(null)} title="Restart from this step?" maxWidth="max-w-md">
        <p className="text-sm text-slate-600">
          The job will re-run from <span className="font-medium">step {retryStep} — {retryStep ? STEP_LABELS[retryStep] : ""}</span>. Every later step runs again and its output is overwritten.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setRetryStep(null)}>Cancel</button>
          <button className="btn-primary" disabled={busy}
            onClick={() => { const n = retryStep; setRetryStep(null); if (n) act(`/jobs/${jobId}/retry-step`, { step_no: n }, `Restarting from step ${n}`); }}>
            Yes, restart
          </button>
        </div>
      </Modal>
    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, [string, string]> = {
    pending: ["Pending", "text-slate-500"], running: ["Running", "text-blue-600"],
    paused_review: ["Needs review", "text-amber-600"], completed: ["Completed", "text-emerald-600"],
    failed: ["Failed", "text-red-600"], saved: ["Pending review", "text-violet-600"], signed: ["Signed", "text-emerald-600"],
  };
  const [label, cls] = map[status];
  return <span className={`font-medium ${cls}`}>{label}</span>;
}

function StepIcon({ status, n }: { status: StepStatus; n: number }) {
  if (status === "done") return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check size={14} /></span>;
  if (status === "running") return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-100 text-blue-700"><Loader2 size={13} className="animate-spin" /></span>;
  if (status === "failed") return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-100 text-red-700"><X size={14} /></span>;
  if (status === "skipped") return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-400">–</span>;
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-400">{n}</span>;
}

function ArtifactPreview({ jobId, step, stepStatus, signed = false }: { jobId: string; step: number; stepStatus: StepStatus; signed?: boolean }) {
  const isPdf = step === 10;
  const key = ARTIFACT_KEY[step];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "empty">("idle");

  // Reset whenever the active step changes OR its status changes (e.g. a rerun
  // flips it back to pending, so old output must be dropped). The final PDF
  // auto-opens once it's ready; other steps stay collapsed until "View".
  useEffect(() => {
    setOpen(isPdf && stepStatus === "done"); setText(null); setState("idle");
    setPdfUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
  }, [step, stepStatus, isPdf]);

  // Lazy-load only when the user expands it (each step keeps its own output).
  useEffect(() => {
    if (!open || stepStatus !== "done") return;
    if (isPdf) {
      if (pdfUrl) return;
      setState("loading");
      api.getBlob(signed ? `/review/${jobId}/signed-pdf` : `/jobs/${jobId}/pdf`).then((b) => { setPdfUrl(URL.createObjectURL(b)); setState("idle"); }).catch(() => setState("empty"));
      return;
    }
    if (!key || text !== null) return;
    setState("loading");
    api.getBlob(`/jobs/${jobId}/artifact?key=${key}`).then((b) => b.text())
      .then((t) => { setText(t.slice(0, 20000)); setState("idle"); }).catch(() => setState("empty"));
  }, [open, isPdf, key, stepStatus, jobId, text, pdfUrl, signed]);

  const available = stepStatus === "done" && (isPdf || !!key);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold">{isPdf ? (signed ? "Signed PDF" : "Final PDF") : "Output"} — {STEP_LABELS[step]}</h3>
        {available ? (
          <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setOpen((o) => !o)}>
            {open ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> View</>}
          </button>
        ) : (
          <span className="text-xs text-slate-400">Runs after this step completes</span>
        )}
      </div>
      {open && available && (
        <div className="max-h-[84vh] overflow-auto px-4 py-3">
          {state === "loading" ? <Loader2 className="animate-spin text-slate-300" />
            : isPdf ? (pdfUrl ? <iframe title="PDF preview" src={pdfUrl} className="h-[80vh] w-full rounded-lg border border-slate-200" /> : <p className="text-sm text-slate-400">PDF not available.</p>)
            : text ? <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-700">{text}</pre>
            : <p className="text-sm text-slate-400">No preview available.</p>}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- extract gate ----------------------------- */
// Pixel position of the caret inside a <textarea> (mirror-div technique).
function caretCoords(ta: HTMLTextAreaElement, pos: number): { left: number; top: number; lh: number } {
  const style = getComputedStyle(ta);
  const div = document.createElement("div");
  const props = ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontStyle",
    "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight", "fontFamily", "textAlign",
    "textTransform", "textIndent", "letterSpacing", "wordSpacing"];
  props.forEach((pr) => { (div.style as unknown as Record<string, string>)[pr] = (style as unknown as Record<string, string>)[pr]; });
  div.style.position = "absolute"; div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap"; div.style.wordWrap = "break-word";
  div.style.width = ta.clientWidth + "px";
  div.textContent = ta.value.substring(0, pos);
  const span = document.createElement("span");
  span.textContent = ta.value.substring(pos) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const spanTop = span.offsetTop, spanLeft = span.offsetLeft;
  document.body.removeChild(div);
  const rect = ta.getBoundingClientRect();
  const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  return { left: rect.left + spanLeft - ta.scrollLeft, top: rect.top + spanTop - ta.scrollTop, lh };
}

function ExtractGate({ jobId, onDone, reedit = false }: { jobId: string; onDone: () => void; reedit?: boolean }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [sugg, setSugg] = useState<MasterHit[]>([]);
  const [suggPos, setSuggPos] = useState<{ left: number; top: number } | null>(null);
  const lineRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const tRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    api.get<{ text: string }>(`/jobs/${jobId}/review/extract`).then((r) => setText(r.text)).catch(() => toast.error("Could not load extracted text")).finally(() => setLoading(false));
  }, [jobId]);

  const closeSugg = () => { setSugg([]); setSuggPos(null); };

  // Whenever the caret moves / text changes, decide if the current line looks
  // like a stock heading and, if so, search the scrip master for suggestions.
  const evaluate = () => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const val = ta.value;
    const start = val.lastIndexOf("\n", caret - 1) + 1;
    const nl = val.indexOf("\n", caret);
    const end = nl === -1 ? val.length : nl;
    lineRef.current = { start, end };
    const lineText = val.slice(start, end).trim();
    const words = lineText.split(/\s+/).filter(Boolean).length;
    const looksHeading = lineText.length >= 1 && lineText.length <= 50 && words <= 6 && !lineText.includes(".");
    window.clearTimeout(tRef.current);
    if (!looksHeading) { closeSugg(); return; }
    tRef.current = window.setTimeout(async () => {
      try {
        const r = await api.get<MasterHit[]>(`/tools/master-search?q=${encodeURIComponent(lineText)}&limit=8`);
        if (r.length) { setSugg(r); setSuggPos(caretCoords(ta, caret)); }
        else closeSugg();
      } catch { closeSugg(); }
    }, 220);
  };

  const pick = (h: MasterHit) => {
    const ta = taRef.current;
    if (!ta) return;
    const { start, end } = lineRef.current;
    const insert = h.symbol;
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    closeSugg();
    requestAnimationFrame(() => {
      ta.focus();
      const c = start + insert.length;
      ta.setSelectionRange(c, c);
    });
  };

  const submit = async () => {
    setSaving(true);
    try {
      await api.post(`/jobs/${jobId}/review/extract${reedit ? "/reedit" : ""}`, { text });
      toast.success(reedit ? "Saved — re-running from step 5" : "Saved — resuming from step 5");
      setTimeout(onDone, 400);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Save failed"); } finally { setSaving(false); }
  };

  return (
    <div className={`card p-5 ${reedit ? "border-brand/30" : "border-amber-200"}`}>
      <GateHeader title={reedit ? "Reviewed — Extract analysis" : "Review extracted stock calls"}
        hint={reedit ? "Edit this already-reviewed file for small fixes (no AI re-generation). Saving re-runs every later step and rebuilds their output. Tip: type a stock name on its line to pick the exact scrip." : "Each stock on its own line, followed by its analysis. Type a stock name on its line to pick the exact scrip from the master — this is what the rest of the pipeline parses."} />
      {loading ? <Loader2 className="animate-spin text-slate-300" /> : (
        <textarea
          ref={taRef}
          className="input mt-3 h-[60vh] w-full font-mono text-sm"
          value={text}
          spellCheck={false}
          onChange={(e) => { setText(e.target.value); evaluate(); }}
          onKeyUp={(e) => { if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) evaluate(); if (e.key === "Escape") closeSugg(); }}
          onClick={evaluate}
          onScroll={closeSugg}
          onBlur={() => setTimeout(closeSugg, 150)}
        />
      )}
      {suggPos && sugg.length > 0 && (
        <div style={{ position: "fixed", left: suggPos.left, top: suggPos.top + 18, width: 320 }}
          className="z-50 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-left shadow-xl">
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pick a stock from the master</div>
          {sugg.map((h, k) => (
            <button key={k} type="button" onMouseDown={(e) => { e.preventDefault(); pick(h); }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50">
              <span className="min-w-0 truncate"><span className="font-semibold text-slate-700">{h.symbol}</span> <span className="text-slate-400">{h.listed_name}</span></span>
              <span className="shrink-0 text-[10px] text-slate-400">{h.exchange} · {h.security_id}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" disabled={saving || loading} onClick={submit}>{saving && <Loader2 size={16} className="animate-spin" />} {reedit ? "Save & start from here" : "Save & Continue"} <ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

/* ----------------------------- mapping gate ----------------------------- */
interface MasterHit { symbol: string; short_name: string; listed_name: string; security_id: string; exchange: string; instrument: string }

function StockSymbolCell({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (h: MasterHit) => void }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<MasterHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tRef = useRef<number | undefined>(undefined);

  // Anchor the menu to the input in viewport coords so it is never clipped by
  // the scrollable grid; flip upward when there isn't room below.
  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 248 && r.top > spaceBelow;
    setPos({ left: r.left, top: up ? r.top : r.bottom + 4, width: Math.max(r.width, 280), up });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, results.length]);

  const query = (q: string) => {
    onChange(q);
    setOpen(true);
    window.clearTimeout(tRef.current);
    if (q.trim().length < 1) { setResults([]); return; }
    tRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get<MasterHit[]>(`/tools/master-search?q=${encodeURIComponent(q.trim())}&limit=12`);
        setResults(r);
      } catch { setResults([]); } finally { setLoading(false); }
    }, 250);
  };

  const showMenu = open && (loading || results.length > 0) && pos;
  return (
    <>
      <input ref={inputRef} value={value} onChange={(e) => query(e.target.value)} onFocus={() => { if (value) { setOpen(true); place(); } }}
        placeholder="Type symbol / name…"
        className="w-full bg-transparent px-2 py-1.5 text-xs outline-none focus:bg-brand-50" />
      {showMenu && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-hidden tabIndex={-1} />
          <div
            style={{ position: "fixed", left: pos!.left, top: pos!.top, width: pos!.width, transform: pos!.up ? "translateY(-100%)" : undefined }}
            className="z-50 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-left shadow-xl"
          >
            {loading && results.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
            ) : (
              results.map((h, k) => (
                <button key={k} type="button" onClick={() => { onPick(h); setOpen(false); }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50">
                  <span className="min-w-0 truncate"><span className="font-semibold text-slate-700">{h.symbol}</span> <span className="text-slate-400">{h.listed_name}</span></span>
                  <span className="shrink-0 text-[10px] text-slate-400">{h.exchange} · {h.security_id}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}

const MAP_COLS = ["INPUT STOCK", "STOCK SYMBOL", "SECURITY ID", "EXCHANGE", "CHART TYPE", "ANALYSIS"];
function MappingGate({ jobId, onDone, reedit = false }: { jobId: string; onDone: () => void; reedit?: boolean }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get<{ columns: string[]; rows: Record<string, string>[] }>(`/jobs/${jobId}/review/mapping`)
      .then((r) => setRows(r.rows.map((x) => ({ ...x })))).catch(() => toast.error("Could not load mapping")).finally(() => setLoading(false));
  }, [jobId]);
  const setCell = (i: number, col: string, v: string) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [col]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, Object.fromEntries(MAP_COLS.map((c) => [c, ""]))]);
  const deleteRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const submit = async () => {
    setSaving(true);
    try {
      await api.post(`/jobs/${jobId}/review/mapping${reedit ? "/reedit" : ""}`, { rows });
      toast.success(reedit ? "Saved — re-running from step 8" : "Saved — resuming from step 8");
      setTimeout(onDone, 400);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Save failed"); } finally { setSaving(false); }
  };
  return (
    <div className={`card p-5 ${reedit ? "border-brand/30" : "border-amber-200"}`}>
      <GateHeader title={reedit ? "Reviewed — Map master file" : "Review stock mapping"}
        hint={reedit ? "Edit this already-reviewed mapping for small fixes. Saving re-runs every later step and rebuilds their output." : "Unmatched rows are highlighted. In STOCK SYMBOL, type a symbol or name to search the scrip master — picking a result fills Security ID, Exchange and the names. Every field stays editable."} />
      {loading ? <Loader2 className="animate-spin text-slate-300" /> : (
        <div className="mt-3 max-h-[68vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>{MAP_COLS.map((c) => <th key={c} className="border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-500">{c}</th>)}<th className="w-9 border-b border-slate-200" /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const unmatched = !String(r["SECURITY ID"] ?? "").trim() || !String(r["STOCK SYMBOL"] ?? "").trim();
                return (
                  <tr key={i} className={unmatched ? "bg-amber-50" : "odd:bg-white even:bg-slate-50/40"}>
                    {MAP_COLS.map((c) => (
                      <td key={c} className="border-b border-slate-100 p-0 align-top">
                        {c === "STOCK SYMBOL" ? (
                          <StockSymbolCell
                            value={r[c] ?? ""}
                            onChange={(v) => setCell(i, c, v)}
                            onPick={(h) => setRows((rs) => rs.map((row, idx) => idx === i ? {
                              ...row, "STOCK SYMBOL": h.symbol, "SECURITY ID": h.security_id, "EXCHANGE": h.exchange,
                              "LISTED NAME": h.listed_name, "SHORT NAME": h.short_name, "INSTRUMENT": h.instrument,
                            } : row))}
                          />
                        ) : (
                          <input value={r[c] ?? ""} onChange={(e) => setCell(i, c, e.target.value)}
                            className="w-full bg-transparent px-2 py-1.5 text-xs outline-none focus:bg-brand-50" />
                        )}
                      </td>
                    ))}
                    <td className="border-b border-slate-100 px-1 text-center align-middle">
                      <button type="button" onClick={() => deleteRow(i)} title="Delete row" className="grid h-7 w-7 place-items-center rounded-lg text-slate-300 transition hover:bg-slate-100 hover:text-danger"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between">
        <button type="button" className="btn-ghost" disabled={loading} onClick={addRow}><Plus size={16} /> Add row</button>
        <button className="btn-primary" disabled={saving || loading} onClick={submit}>{saving && <Loader2 size={16} className="animate-spin" />} {reedit ? "Save & start from here" : "Save & Continue"} <ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

/* ----------------------------- charts gate ----------------------------- */
interface FailedChart { index: number; stock_name?: string; symbol?: string; error?: string }
function ChartsGate({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [failed, setFailed] = useState<FailedChart[]>([]);
  const [files, setFiles] = useState<Record<number, File>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get<{ failed: FailedChart[] }>(`/jobs/${jobId}/review/charts`).then((r) => setFailed(r.failed)).catch(() => toast.error("Could not load failed charts")).finally(() => setLoading(false));
  }, [jobId]);
  const submit = async () => {
    const entries = Object.entries(files);
    if (entries.length === 0) { toast.error("Add at least one chart image"); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      entries.forEach(([idx, f]) => { fd.append("indices", idx); fd.append("images", f); });
      await api.postForm(`/jobs/${jobId}/review/charts`, fd);
      toast.success("Uploaded — resuming from step 10"); setTimeout(onDone, 400);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Upload failed"); } finally { setSaving(false); }
  };
  return (
    <div className="card border-amber-200 p-5">
      <GateHeader title="Upload missing charts" hint="Dhan returned no data for these stocks. Upload a chart image for each, then continue." />
      {loading ? <Loader2 className="animate-spin text-slate-300" /> : failed.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No failed charts.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {failed.map((f) => (
            <div key={f.index} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-700">{f.stock_name || f.symbol || `Row ${f.index}`}</p>
                <p className="truncate text-xs text-slate-400">{f.error}</p>
              </div>
              <label className="btn-ghost cursor-pointer text-xs">
                <CloudUpload size={14} /> {files[f.index]?.name ? "Change" : "Choose image"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) setFiles((m) => ({ ...m, [f.index]: file })); }} />
              </label>
              {files[f.index] && <Check size={16} className="text-emerald-600" />}
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" disabled={saving || loading} onClick={submit}>{saving && <Loader2 size={16} className="animate-spin" />} Upload &amp; Continue <ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

function GateHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><AlertTriangle size={18} /></span>
      <div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-0.5 text-sm text-slate-500">{hint}</p></div>
    </div>
  );
}

/* --------------------------- completion / failure --------------------------- */
function CompletionPanel({ job, saved, signed, onSaved, onDeleted }: { job: JobDetail; saved?: boolean; signed?: boolean; onSaved: () => void; onDeleted: () => void }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pdfPath = signed ? `/review/${job.id}/signed-pdf` : `/jobs/${job.id}/pdf`;
  useEffect(() => {
    let u: string | null = null;
    api.getBlob(`${pdfPath}?_=${Date.now()}`).then((b) => { u = URL.createObjectURL(b); setPdfUrl(u); }).catch(() => setPdfUrl(null));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [pdfPath]);
  const send = async () => { setBusy(true); try { await api.post(`/jobs/${job.id}/save`); toast.success("Sent to reviewer"); onSaved(); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not send"); } finally { setBusy(false); } };
  const del = async () => { if (!confirm("Delete this job and its files?")) return; setBusy(true); try { await api.del(`/jobs/${job.id}`); toast.success("Deleted"); onDeleted(); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Delete failed"); } finally { setBusy(false); } };
  const title = signed ? "Signed rationale" : saved ? "Sent for review" : "Rationale complete";
  const subtitle = signed ? "The signed PDF is archived under Signed Rationale." : saved ? "Waiting for a reviewer to sign the PDF." : "The compliance PDF is ready — send it to the reviewer.";
  return (
    <div className="card p-5">
      <div className="flex items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${signed ? "bg-emerald-100 text-emerald-700" : saved ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`}><CheckCircle2 size={18} /></span>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={pdfUrl ?? undefined} download={pdfUrl ? `${job.title || "rationale"}${signed ? "-signed" : ""}.pdf` : undefined}><Download size={16} /> Download</a>
          {!saved && !signed && <button className="btn-primary" disabled={busy} onClick={send}><Send size={16} /> Send to reviewer</button>}
          {(saved || signed) && <Link className="btn-ghost" to={`/review/${job.id}`}><TrendingUp size={16} /> Open review</Link>}
          {!signed && <button className="btn bg-danger text-white hover:bg-danger/90" disabled={busy} onClick={del}><Trash2 size={16} /> Delete</button>}
        </div>
      </div>
    </div>
  );
}

function FailurePanel({ job, busy, onRetry, onRestart }: { job: JobDetail; busy: boolean; onRetry: () => void; onRestart: () => void }) {
  const failing = job.steps.find((s) => s.status === "failed");
  return (
    <div className="card border-red-200 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700"><AlertTriangle size={18} /></span>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Step {job.current_step} failed{failing ? ` — ${STEP_LABELS[failing.step_no]}` : ""}</h2>
          <p className="mt-1 break-words text-sm text-red-700">{job.error_message || failing?.error || "Unknown error"}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" disabled={busy} onClick={onRetry}><RotateCcw size={16} /> Retry step</button>
          <button className="btn-primary" disabled={busy} onClick={onRestart}><RotateCcw size={16} /> Restart</button>
        </div>
      </div>
    </div>
  );
}
