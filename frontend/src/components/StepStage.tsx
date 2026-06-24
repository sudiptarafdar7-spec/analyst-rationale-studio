import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle, BarChart3, Check, FileText, IndianRupee, Languages, Loader2,
  Mic, Search, Sparkles, Table, Workflow,
} from "lucide-react";

type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
interface AnalystRef { id: string; name: string; avatar_path: string | null }

const STEP_ICON: Record<number, typeof Mic> = {
  1: Mic, 2: Languages, 3: Search, 4: Workflow, 5: Table,
  6: Sparkles, 7: Search, 8: IndianRupee, 9: BarChart3, 10: FileText,
};

export default function StepStage({ step, status, label, analysts }: {
  step: number; status: StepStatus; label: string; analysts?: AnalystRef[];
}) {
  const running = status === "running";
  const done = status === "done";
  const failed = status === "failed";

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold">Step {step} — {label}</h3>
        {running ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
            <Loader2 size={13} className="animate-spin" /> Working…
          </span>
        ) : done ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"><Check size={13} /> Done</span>
        ) : failed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"><AlertTriangle size={13} /> Failed</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Waiting</span>
        )}
      </div>

      <div className="grid h-48 place-items-center overflow-hidden bg-gradient-to-b from-slate-50 to-white">
        {done ? <DoneScene /> : failed ? <FailScene /> : running ? <Scene step={step} analysts={analysts} /> : <IdleScene step={step} />}
      </div>

      <div className="px-4 py-3">
        {running ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <motion.div className="h-full w-1/3 rounded-full bg-brand"
              animate={{ x: ["-110%", "320%"] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} />
          </div>
        ) : (
          <div className={`h-1.5 w-full rounded-full ${done ? "bg-emerald-500" : failed ? "bg-red-400" : "bg-slate-100"}`} />
        )}
      </div>
    </div>
  );
}

function Scene({ step, analysts }: { step: number; analysts?: AnalystRef[] }) {
  switch (step) {
    case 1: return <TranscribeScene />;
    case 2: return <TranslateScene />;
    case 3: return <SpeakerScene analysts={analysts} />;
    case 4: return <ExtractScene />;
    case 5: return <CsvScene />;
    case 6: return <PolishScene />;
    case 7: return <MapScene />;
    case 8: return <CmpScene />;
    case 9: return <ChartScene />;
    case 10: return <PdfScene />;
    default: return <IdleScene step={step} />;
  }
}

function IdleScene({ step }: { step: number }) {
  const Icon = STEP_ICON[step] ?? Sparkles;
  return (
    <div className="flex flex-col items-center gap-2 text-slate-300">
      <Icon size={34} />
      <span className="text-xs text-slate-400">Waiting to run…</span>
    </div>
  );
}

function DoneScene() {
  return (
    <motion.div className="flex flex-col items-center gap-3"
      initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.5 }}>
      <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15, type: "spring", bounce: 0.6 }}><Check size={32} /></motion.span>
      </span>
      <span className="text-sm font-medium text-emerald-700">Completed</span>
    </motion.div>
  );
}

function FailScene() {
  return (
    <div className="flex flex-col items-center gap-2 text-red-500">
      <motion.span animate={{ rotate: [0, -8, 8, 0] }} transition={{ duration: 0.6, repeat: Infinity }}><AlertTriangle size={34} /></motion.span>
      <span className="text-xs font-medium">This step failed</span>
    </div>
  );
}

/* 1 — Transcribe: mic + sound wave */
function TranscribeScene() {
  return (
    <div className="flex flex-col items-center gap-4">
      <motion.div className="grid h-14 w-14 place-items-center rounded-full bg-brand-100 text-brand-700"
        animate={{ boxShadow: ["0 0 0 0 rgba(108,76,241,0.45)", "0 0 0 16px rgba(108,76,241,0)"] }}
        transition={{ duration: 1.5, repeat: Infinity }}>
        <Mic size={24} />
      </motion.div>
      <div className="flex h-12 items-center gap-1">
        {Array.from({ length: 16 }).map((_, i) => (
          <motion.span key={i} className="w-1.5 rounded-full bg-brand/70"
            animate={{ height: ["18%", "100%", "32%"] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.05, ease: "easeInOut" }}
            style={{ height: "30%" }} />
        ))}
      </div>
    </div>
  );
}

/* 2 — Translate: Hindi -> English */
const PAIRS: [string, string][] = [
  ["नमस्ते", "Hello"], ["रिलायंस", "Reliance"], ["खरीदें", "Buy"], ["लक्ष्य 1475", "Target 1475"], ["स्टॉपलॉस", "Stop-loss"],
];
function TranslateScene() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % PAIRS.length), 1600); return () => clearInterval(t); }, []);
  const [hi, en] = PAIRS[i];
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-right">
        <AnimatePresence mode="wait">
          <motion.div key={hi} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="text-lg font-semibold text-slate-700">{hi}</motion.div>
        </AnimatePresence>
        <div className="text-[10px] uppercase tracking-wide text-slate-400">Hindi</div>
      </div>
      <motion.div className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-brand-700"
        animate={{ x: [0, 6, 0] }} transition={{ duration: 1, repeat: Infinity }}><Languages size={18} /></motion.div>
      <div className="w-28">
        <AnimatePresence mode="wait">
          <motion.div key={en} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="text-lg font-semibold text-brand-700">{en}</motion.div>
        </AnimatePresence>
        <div className="text-[10px] uppercase tracking-wide text-slate-400">English</div>
      </div>
    </div>
  );
}

/* 3 — Speaker detection: search sweeps across people, highlights the analyst */
function SpeakerScene({ analysts }: { analysts?: AnalystRef[] }) {
  const targets = (analysts ?? []).slice(0, 2);
  const people: { name: string; avatar: string | null; target: boolean }[] = [];
  targets.forEach((a) => people.push({ name: a.name, avatar: a.avatar_path, target: true }));
  ["Host", "Guest A", "Guest B", "Guest C"].forEach((n) => { if (people.length < 5) people.push({ name: n, avatar: null, target: false }); });
  return (
    <div className="relative w-full max-w-md px-6">
      <motion.div className="pointer-events-none absolute -top-3 text-brand"
        animate={{ left: ["6%", "92%", "6%"] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ position: "absolute" }}>
        <Search size={22} />
      </motion.div>
      <div className="flex items-end justify-between">
        {people.map((p, idx) => (
          <div key={idx} className="flex w-16 flex-col items-center gap-1">
            <motion.div className={`grid h-11 w-11 place-items-center overflow-hidden rounded-full text-xs font-semibold ${p.target ? "bg-brand-100 text-brand-700 ring-2 ring-brand" : "bg-slate-100 text-slate-500"}`}
              animate={p.target ? { scale: [1, 1.14, 1] } : {}} transition={{ duration: 1.3, repeat: Infinity }}>
              {p.avatar ? <img src={p.avatar} alt="" className="h-full w-full object-cover" /> : p.name[0]?.toUpperCase()}
            </motion.div>
            <span className={`max-w-full truncate text-[10px] ${p.target ? "font-semibold text-brand-700" : "text-slate-400"}`}>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* 4 — Extract: a tower crane lifting stock "boxes" */
function ExtractScene() {
  const boxes = ["RELIANCE", "TCS", "INFY", "HDFC"];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % boxes.length), 1600); return () => clearInterval(t); }, []);
  return (
    <div className="relative h-40 w-60">
      <div className="absolute left-3 top-3 bottom-2 w-1.5 rounded bg-slate-300" />
      <div className="absolute left-3 right-3 top-3 h-1.5 rounded bg-slate-300" />
      <div className="absolute left-1 top-1 h-3 w-3 rounded-sm bg-slate-400" />
      <motion.div className="absolute top-3" animate={{ left: ["22%", "66%", "66%", "22%"] }}
        transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.32, 0.62, 1], ease: "easeInOut" }}>
        <div className="mx-auto h-2 w-5 rounded bg-slate-400" />
        <motion.div className="mx-auto w-[3px] bg-slate-400"
          animate={{ height: [10, 78, 78, 10] }} transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.32, 0.62, 1], ease: "easeInOut" }} />
        <div className="mx-auto grid h-10 w-14 place-items-center rounded-md bg-brand-100 text-[9px] font-bold text-brand-700 shadow">
          <AnimatePresence mode="wait"><motion.span key={boxes[i]} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>{boxes[i]}</motion.span></AnimatePresence>
        </div>
      </motion.div>
      <div className="absolute bottom-0 left-0 right-0 h-1 rounded bg-slate-200" />
    </div>
  );
}

/* 5 — Convert to CSV: cells fill into a grid */
function CsvScene() {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {Array.from({ length: 16 }).map((_, i) => (
        <motion.div key={i} className="h-6 w-12 rounded bg-brand/15"
          animate={{ backgroundColor: ["rgba(108,76,241,0.10)", "rgba(108,76,241,0.45)", "rgba(108,76,241,0.10)"] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: (i % 4) * 0.12 + Math.floor(i / 4) * 0.18 }} />
      ))}
    </div>
  );
}

/* 6 — Polish: shimmering text lines + sparkles */
function PolishScene() {
  return (
    <div className="relative w-64 space-y-2">
      <motion.div className="absolute -right-1 -top-3 text-brand" animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}><Sparkles size={18} /></motion.div>
      {[0, 1, 2, 3].map((r) => (
        <div key={r} className="h-3 overflow-hidden rounded-full bg-slate-100" style={{ width: `${100 - r * 12}%` }}>
          <motion.div className="h-full w-1/2 bg-gradient-to-r from-transparent via-brand/50 to-transparent"
            animate={{ x: ["-100%", "260%"] }} transition={{ duration: 1.6, repeat: Infinity, delay: r * 0.2, ease: "easeInOut" }} />
        </div>
      ))}
    </div>
  );
}

/* 7 — Map master: input symbols matched to the master list */
function MapScene() {
  return (
    <div className="flex items-center gap-8">
      <div className="space-y-2">{["RIL", "TCS", "INFY"].map((s) => <div key={s} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{s}</div>)}</div>
      <div className="relative h-20 w-16">
        {[0, 1, 2].map((k) => (
          <motion.div key={k} className="absolute left-0 right-0 h-0.5 bg-brand/50" style={{ top: `${12 + k * 28}px` }}
            initial={{ scaleX: 0, originX: 0 }} animate={{ scaleX: [0, 1, 1, 0] }} transition={{ duration: 2.4, repeat: Infinity, delay: k * 0.3 }} />
        ))}
        <motion.div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-brand"
          animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.2, repeat: Infinity }}><Search size={18} /></motion.div>
      </div>
      <div className="space-y-2">{["RELIANCE · 2885", "TCS · 11536", "INFY · 1594"].map((s) => (
        <motion.div key={s} className="rounded-md bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-700"
          animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2.4, repeat: Infinity }}>{s}</motion.div>
      ))}</div>
    </div>
  );
}

/* 8 — Fetch CMP: a live price counting */
function CmpScene() {
  const [v, setV] = useState(1380);
  useEffect(() => { const t = setInterval(() => setV(() => 1380 + Math.round(Math.random() * 160)), 700); return () => clearInterval(t); }, []);
  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600"
        animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 0.9, repeat: Infinity }}><IndianRupee size={22} /></motion.div>
      <AnimatePresence mode="wait">
        <motion.div key={v} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          className="text-2xl font-bold tabular-nums text-slate-800">₹{v.toLocaleString("en-IN")}</motion.div>
      </AnimatePresence>
      <span className="text-[10px] uppercase tracking-wide text-slate-400">fetching live price</span>
    </div>
  );
}

/* 9 — Generate charts: candlesticks drawing in */
function ChartScene() {
  const bars = [40, 65, 50, 80, 60, 92, 70];
  return (
    <div className="flex h-28 items-end gap-2">
      {bars.map((h, i) => {
        const up = i % 2 === 0;
        return (
          <motion.div key={i} className={`w-3 rounded-sm ${up ? "bg-emerald-400" : "bg-red-400"}`}
            initial={{ height: 0 }} animate={{ height: [`${h * 0.3}%`, `${h}%`, `${h * 0.6}%`] }}
            transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }} style={{ height: `${h}%` }} />
        );
      })}
    </div>
  );
}

/* 10 — Generate PDF: pages stacking into a document */
function PdfScene() {
  return (
    <div className="relative h-32 w-28">
      {[0, 1, 2].map((k) => (
        <motion.div key={k} className="absolute left-1/2 top-2 h-28 w-20 -translate-x-1/2 rounded-lg border border-slate-200 bg-white shadow-sm"
          initial={{ y: -30, opacity: 0, rotate: -6 + k * 6 }} animate={{ y: k * 4, opacity: 1, rotate: 0 }}
          transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse", delay: k * 0.25 }}>
          <div className="mx-auto mt-3 h-2 w-12 rounded bg-brand/40" />
          <div className="mx-auto mt-2 space-y-1">{[0, 1, 2, 3].map((r) => <div key={r} className="mx-auto h-1.5 w-12 rounded bg-slate-100" />)}</div>
        </motion.div>
      ))}
      <motion.div className="absolute -right-1 bottom-0 grid h-7 w-7 place-items-center rounded-full bg-brand text-white"
        animate={{ scale: [0.9, 1.1, 0.9] }} transition={{ duration: 1.2, repeat: Infinity }}><FileText size={14} /></motion.div>
    </div>
  );
}
