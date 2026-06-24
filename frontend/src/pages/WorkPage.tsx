import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronRight, Clipboard, CloudUpload,
  Download, Loader2, Play, RotateCcw, Save, Sparkles, Trash2, X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import Modal from "../components/Modal";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";

type JobStatus = "pending" | "running" | "paused_review" | "completed" | "failed" | "saved";
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
  status: JobStatus;
  gate: GateKind;
  current_step: number;
  error_message: string | null;
  output_pdf_path: string | null;
  pdf_url: string | null;
  steps: StepOut[];
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

interface LogLine { step: number; line: string }

export default function WorkPage() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 4000 : false),
  });

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [activeStep, setActiveStep] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [retryStep, setRetryStep] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const userPickedStep = useRef(false);

  const data = job.data;
  const refetch = () => qc.invalidateQueries({ queryKey: ["job", jobId] });

  // Keep the active step following the pipeline unless the user clicked one.
  useEffect(() => {
    if (data && !userPickedStep.current) setActiveStep(Math.min(Math.max(data.current_step || 1, 1), 10));
  }, [data?.current_step]);

  // Live progress over WS (history is replayed on connect, so refresh rebuilds logs).
  useEffect(() => {
    if (!jobId) return;
    const token = useAuthStore.getState().accessToken ?? "";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/jobs/${jobId}?token=${encodeURIComponent(token)}`);
    ws.onmessage = (e) => {
      let ev: { type: string; step_no?: number; line?: string; status?: string };
      try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.type === "log" && ev.step_no != null && ev.line != null) {
        setLogs((ls) => [...ls, { step: ev.step_no!, line: ev.line! }]);
      } else if (ev.type === "step" || ev.type === "gate" || ev.type === "done" || ev.type === "error") {
        refetch();
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

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
  const activeLogs = logs.filter((l) => l.step === activeStep);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button className="btn-ghost px-2 py-2" onClick={() => navigate("/ai-rationale")} aria-label="Back"><ArrowLeft size={18} /></button>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Sparkles size={20} /></span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight">{data.title || "Rationale"}</h1>
            <p className="truncate text-sm text-slate-500">{data.platform_name ?? ""} · <StatusBadge status={data.status} /></p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {data.status === "pending" && (
            <button className="btn-primary" disabled={busy} onClick={() => act(`/jobs/${jobId}/start`, undefined, "Pipeline started")}>
              <Play size={16} /> Start
            </button>
          )}
          <button className="btn-ghost" disabled={busy} onClick={() => act(`/jobs/${jobId}/restart`, undefined, "Restarting from step 1")}>
            <RotateCcw size={16} /> Restart
          </button>
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
                    onClick={() => { userPickedStep.current = true; setActiveStep(n); }}
                    className={`flex flex-1 items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition ${isActive ? "bg-brand-50 ring-1 ring-brand/20" : "hover:bg-slate-50"}`}
                  >
                    <StepIcon status={st} n={n} />
                    <span className={`flex-1 truncate ${st === "done" ? "text-slate-700" : st === "running" ? "font-medium text-blue-700" : "text-slate-500"}`}>{STEP_LABELS[n]}</span>
                    {gateStep === n && data.status === "paused_review" && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">REVIEW</span>}
                  </button>
                  <button onClick={() => setRetryStep(n)} title={`Restart from step ${n}`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-brand focus:opacity-100 group-hover:opacity-100">
                    <RotateCcw size={13} />
                  </button>
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
          {data.status === "failed" && (
            <FailurePanel job={data} busy={busy}
              onRetry={() => act(`/jobs/${jobId}/retry-step`, { step_no: data.current_step }, `Retrying step ${data.current_step}`)}
              onRestart={() => act(`/jobs/${jobId}/restart`, undefined, "Restarting")} />
          )}

          {/* Live log stream */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <h3 className="text-sm font-semibold">Logs — step {activeStep}: {STEP_LABELS[activeStep]}</h3>
              <button className="btn-ghost px-2 py-1 text-xs"
                onClick={() => { navigator.clipboard?.writeText(activeLogs.map((l) => l.line).join("\n")); toast.success("Logs copied"); }}>
                <Clipboard size={13} /> Copy
              </button>
            </div>
            <div ref={logRef} className="max-h-64 overflow-auto bg-slate-950 px-4 py-3 font-mono text-xs leading-relaxed text-slate-200">
              {activeLogs.length === 0 ? (
                <span className="text-slate-500">
                  {stepMap.get(activeStep)?.log_tail || (data.status === "running" ? "Waiting for output…" : "No logs for this step yet.")}
                </span>
              ) : (
                activeLogs.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l.line}</div>)
              )}
            </div>
          </div>

          {/* Artifact preview for the active step */}
          <ArtifactPreview jobId={jobId} step={activeStep} stepStatus={stepMap.get(activeStep)?.status ?? "pending"} />
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
    failed: ["Failed", "text-red-600"], saved: ["Saved", "text-violet-600"],
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

function ArtifactPreview({ jobId, step, stepStatus }: { jobId: string; step: number; stepStatus: StepStatus }) {
  const key = ARTIFACT_KEY[step];
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "empty" | "error">("idle");

  useEffect(() => {
    setText(null);
    if (!key || stepStatus !== "done") { setState("idle"); return; }
    setState("loading");
    api.getBlob(`/jobs/${jobId}/artifact?key=${key}`)
      .then((b) => b.text())
      .then((t) => { setText(t.slice(0, 20000)); setState("idle"); })
      .catch(() => setState("empty"));
  }, [jobId, step, key, stepStatus]);

  if (step === 10) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-2.5"><h3 className="text-sm font-semibold">Output — {STEP_LABELS[step]}</h3></div>
      <div className="max-h-72 overflow-auto px-4 py-3">
        {state === "loading" ? <Loader2 className="animate-spin text-slate-300" />
          : stepStatus !== "done" ? <p className="text-sm text-slate-400">Runs after this step completes.</p>
          : text ? <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-700">{text}</pre>
          : <p className="text-sm text-slate-400">No preview available.</p>}
      </div>
    </div>
  );
}

/* ----------------------------- extract gate ----------------------------- */
function ExtractGate({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get<{ text: string }>(`/jobs/${jobId}/review/extract`).then((r) => setText(r.text)).catch(() => toast.error("Could not load extracted text")).finally(() => setLoading(false));
  }, [jobId]);
  const submit = async () => {
    setSaving(true);
    try { await api.post(`/jobs/${jobId}/review/extract`, { text }); toast.success("Saved — resuming from step 5"); setTimeout(onDone, 400); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Save failed"); } finally { setSaving(false); }
  };
  return (
    <div className="card border-amber-200 p-5">
      <GateHeader title="Review extracted stock calls" hint="Each stock on its own line, followed by its analysis. Edit freely — this is what the rest of the pipeline parses." />
      {loading ? <Loader2 className="animate-spin text-slate-300" /> : (
        <textarea className="input mt-3 h-64 w-full font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      )}
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" disabled={saving || loading} onClick={submit}>{saving && <Loader2 size={16} className="animate-spin" />} Save &amp; Continue <ChevronRight size={16} /></button>
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
  const tRef = useRef<number | undefined>(undefined);
  const query = (q: string) => {
    onChange(q);
    setOpen(true);
    window.clearTimeout(tRef.current);
    if (q.trim().length < 1) { setResults([]); return; }
    tRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get<{ results: MasterHit[] }>(`/tools/master-search?q=${encodeURIComponent(q.trim())}&limit=12`);
        setResults(r.results);
      } catch { setResults([]); } finally { setLoading(false); }
    }, 250);
  };
  return (
    <div className="relative">
      <input value={value} onChange={(e) => query(e.target.value)} onFocus={() => value && setOpen(true)}
        placeholder="Type symbol / name…"
        className="w-full bg-transparent px-2 py-1.5 text-xs outline-none focus:bg-brand-50" />
      {open && (loading || results.length > 0) && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-hidden tabIndex={-1} />
          <div className="absolute z-20 mt-1 max-h-56 w-72 overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-left shadow-lg">
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
    </div>
  );
}

const MAP_COLS = ["INPUT STOCK", "STOCK SYMBOL", "SECURITY ID", "EXCHANGE", "CHART TYPE", "ANALYSIS"];
function MappingGate({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get<{ columns: string[]; rows: Record<string, string>[] }>(`/jobs/${jobId}/review/mapping`)
      .then((r) => setRows(r.rows.map((x) => ({ ...x })))).catch(() => toast.error("Could not load mapping")).finally(() => setLoading(false));
  }, [jobId]);
  const setCell = (i: number, col: string, v: string) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [col]: v } : r)));
  const submit = async () => {
    setSaving(true);
    try { await api.post(`/jobs/${jobId}/review/mapping`, { rows }); toast.success("Saved — resuming from step 8"); setTimeout(onDone, 400); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Save failed"); } finally { setSaving(false); }
  };
  return (
    <div className="card border-amber-200 p-5">
      <GateHeader title="Review stock mapping" hint="Unmatched rows are highlighted. In STOCK SYMBOL, type a symbol or name to search the scrip master — picking a result fills Security ID, Exchange and the names. Every field stays editable." />
      {loading ? <Loader2 className="animate-spin text-slate-300" /> : (
        <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>{MAP_COLS.map((c) => <th key={c} className="border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-500">{c}</th>)}</tr>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" disabled={saving || loading} onClick={submit}>{saving && <Loader2 size={16} className="animate-spin" />} Save &amp; Continue <ChevronRight size={16} /></button>
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
function CompletionPanel({ job, saved, onSaved, onDeleted }: { job: JobDetail; saved?: boolean; onSaved: () => void; onDeleted: () => void }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    api.getBlob(`/jobs/${job.id}/pdf`).then((b) => { u = URL.createObjectURL(b); setPdfUrl(u); }).catch(() => setPdfUrl(null));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [job.id]);
  const save = async () => { setBusy(true); try { await api.post(`/jobs/${job.id}/save`); toast.success("Saved to archive"); onSaved(); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Save failed"); } finally { setBusy(false); } };
  const del = async () => { if (!confirm("Delete this job and its files?")) return; setBusy(true); try { await api.del(`/jobs/${job.id}`); toast.success("Deleted"); onDeleted(); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Delete failed"); } finally { setBusy(false); } };
  return (
    <div className="card p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><CheckCircle2 size={18} /></span>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{saved ? "Saved rationale" : "Rationale complete"}</h2>
          <p className="mt-0.5 text-sm text-slate-500">The compliance PDF is ready.</p>
        </div>
        <div className="flex gap-2">
          <a className="btn-ghost" href={pdfUrl ?? undefined} download={pdfUrl ? `${job.title || "rationale"}.pdf` : undefined}><Download size={16} /> Download</a>
          {!saved && <button className="btn-primary" disabled={busy} onClick={save}><Save size={16} /> Save</button>}
          <button className="btn bg-danger text-white hover:bg-danger/90" disabled={busy} onClick={del}><Trash2 size={16} /> Delete</button>
        </div>
      </div>
      {pdfUrl && <iframe title="PDF preview" src={pdfUrl} className="mt-4 h-[480px] w-full rounded-xl border border-slate-200" />}
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
