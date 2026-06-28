import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, Eye, FileDown, Loader2, Search, ShieldCheck, Trash2, X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { toast } from "../store/toast";
import { useAuthStore } from "../store/auth";

interface AnalystRef { id: string; name: string }
interface Job {
  id: string; title: string | null; platform_name: string | null; platform_logo: string | null;
  analysts: AnalystRef[]; video_date: string | null; signed_at: string | null;
}
interface Facets { platforms: { value: string; label: string }[]; channels: { id: string; name: string; platform_type: string }[]; analysts: { id: string; name: string }[]; years: number[]; dates: string[] }
interface ListOut { items: Job[]; total: number; facets: Facets }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(d: string | null) { return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—"; }

export default function SignedRationale() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isReviewer = useAuthStore((s) => s.user?.role === "reviewer");
  const [f, setF] = useState({ platform_type: "", channel_id: "", analyst_id: "", year: "", month: "", day: "", q: "" });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }, [f]);

  const list = useQuery({ queryKey: ["signed", qs], queryFn: () => api.get<ListOut>(`/review/signed${qs ? `?${qs}` : ""}`) });
  const jobs = list.data?.items ?? [];
  const facets = list.data?.facets ?? { platforms: [], channels: [], analysts: [], years: [], dates: [] };
  const dirty = Object.values(f).some(Boolean);
  const visibleChannels = facets.channels.filter((c) => !f.platform_type || c.platform_type === f.platform_type);
  const parsedDates = facets.dates.map((d) => d.split("-").map(Number)).filter((p) => p.length === 3);
  const availYears = Array.from(new Set(parsedDates.map((p) => p[0]))).sort((a, b) => b - a);
  const availMonths = Array.from(new Set(parsedDates.filter((p) => !f.year || p[0] === +f.year).map((p) => p[1]))).sort((a, b) => a - b);
  const availDays = Array.from(new Set(parsedDates.filter((p) => (!f.year || p[0] === +f.year) && (!f.month || p[1] === +f.month)).map((p) => p[2]))).sort((a, b) => a - b);

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/jobs/${id}`),
    onSuccess: () => { toast.success("Signed rationale deleted"); qc.invalidateQueries({ queryKey: ["signed"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not delete"),
  });

  const download = async (j: Job) => {
    try {
      const blob = await api.getBlob(`/review/${j.id}/signed-pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `${(j.title || "rationale").replace(/[^\w.-]+/g, "_")}-signed.pdf`; a.click(); URL.revokeObjectURL(url);
    } catch { toast.error("Could not download"); }
  };

  const sel = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck size={20} /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Signed Rationale</h1>
          <p className="text-sm text-slate-500">Securely archived signed PDFs — filter by platform, analyst, or date.</p>
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="relative min-w-[180px] flex-1">
          <label className="label">Search</label>
          <Search size={14} className="pointer-events-none absolute left-3 top-[34px] text-slate-400" />
          <input className="input h-9 pl-8" placeholder="Title or channel…" value={f.q} onChange={(e) => setF((s) => ({ ...s, q: e.target.value }))} />
        </div>
        <div><label className="label">Platform</label>
          <select className="input h-9 w-36" value={f.platform_type} onChange={(e) => setF((s) => ({ ...s, platform_type: e.target.value, channel_id: "" }))}>
            <option value="">All</option>{facets.platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select></div>
        <div><label className="label">Channel</label>
          <select className="input h-9 w-40" value={f.channel_id} onChange={sel("channel_id")}>
            <option value="">All</option>{visibleChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div><label className="label">Analyst</label>
          <select className="input h-9 w-40" value={f.analyst_id} onChange={sel("analyst_id")}>
            <option value="">All</option>{facets.analysts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
        <div><label className="label">Year</label>
          <select className="input h-9 w-24" value={f.year} onChange={(e) => setF((s) => ({ ...s, year: e.target.value, month: "", day: "" }))}>
            <option value="">All</option>{availYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select></div>
        <div><label className="label">Month</label>
          <select className="input h-9 w-28" value={f.month} onChange={(e) => setF((s) => ({ ...s, month: e.target.value, day: "" }))} disabled={availMonths.length === 0}>
            <option value="">All</option>{availMonths.map((m) => <option key={m} value={m}>{MONTHS[m - 1]}</option>)}
          </select></div>
        <div><label className="label">Day</label>
          <select className="input h-9 w-20" value={f.day} onChange={sel("day")} disabled={availDays.length === 0}>
            <option value="">All</option>{availDays.map((d) => <option key={d} value={d}>{d}</option>)}
          </select></div>
        {dirty && <button className="btn-ghost h-9" onClick={() => setF({ platform_type: "", channel_id: "", analyst_id: "", year: "", month: "", day: "", q: "" })}><X size={14} /> Clear</button>}
      </div>

      {list.isLoading ? (
        <div className="grid h-48 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : jobs.length === 0 ? (
        <div className="card grid place-items-center p-12 text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><ShieldCheck size={22} /></span>
          <h2 className="text-lg font-semibold">No signed rationales</h2>
          <p className="mt-1 text-sm text-slate-500">Signed PDFs will appear here once a reviewer signs them.</p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100 p-0">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-3 px-4 py-3 hover:bg-emerald-50/30">
              {j.platform_logo
                ? <img src={j.platform_logo} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
                : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">{(j.platform_name ?? "?")[0]?.toUpperCase()}</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-800">{j.platform_name ?? "—"}</div>
                <div className="truncate text-xs text-slate-400">{j.title || "Untitled"}{j.analysts.length ? " · " + j.analysts.map((a) => a.name).join(", ") : ""}</div>
              </div>
              <div className="hidden items-center gap-1 text-xs text-slate-500 sm:flex"><CalendarClock size={12} /> signed {fmt(j.signed_at)}</div>
              <div className="flex shrink-0 items-center gap-1">
                <button title="Open" onClick={() => navigate(`/review/${j.id}`)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-brand"><Eye size={15} /></button>
                <button title="Download signed PDF" onClick={() => download(j)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-brand"><FileDown size={15} /></button>
                {isReviewer && (
                  <button title="Delete (reviewer only)" disabled={del.isPending} onClick={() => { if (confirm("Delete this signed rationale?")) del.mutate(j.id); }} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-danger"><Trash2 size={15} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
