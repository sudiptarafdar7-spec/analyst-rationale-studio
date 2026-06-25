import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, Loader2, RefreshCw, Search, Target, Trash2, TrendingUp, X,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";

interface TargetStatus { value: number; achieved: boolean }
interface Row {
  id: string; job_id: string | null;
  platform_name: string | null; platform_type: string | null; channel_logo_path: string | null;
  analyst_names: string | null; call_date: string | null; call_time: string | null;
  stock_symbol: string | null; short_name: string | null; listed_name: string | null;
  exchange: string | null; instrument: string | null; chart_url: string | null;
  call_type: string; call_cmp: number | null; targets: number[];
  stoploss: number | null; downfall_target: number | null;
  holding_period: string | null; holding_period_days: number | null;
  current_cmp: number | null; peak_high: number | null; cmp_fetched_at: string | null;
  targets_status: TargetStatus[]; achieved_count: number; total_targets: number;
  downfall_hit: boolean; status: string; pnl_abs: number | null; pnl_pct: number | null;
  days_since: number | null; holding_elapsed: boolean | null; highlight: string;
}
interface Instr { value: string; label: string; count: number }
interface ListOut { items: Row[]; total: number; instruments: Instr[] }

const CALL_META: Record<string, { label: string; cls: string }> = {
  buy: { label: "Buy", cls: "bg-emerald-100 text-emerald-700" },
  hold: { label: "Hold", cls: "bg-amber-100 text-amber-700" },
  sell: { label: "Sell", cls: "bg-red-100 text-red-700" },
  no_view: { label: "No view", cls: "bg-slate-100 text-slate-500" },
};
const ROW_BG: Record<string, string> = {
  achieved: "bg-emerald-50/70", loss: "bg-red-50/70", neutral: "bg-white",
};
const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function ddmmyy(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}-${m}-${y.slice(2)}` : d;
}
function daysLabel(d: number | null): string {
  if (d == null) return "";
  if (d < 1) return "today";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${(d / 365).toFixed(1)}y ago`;
}

interface Filters { from: string; to: string; instrument: string; call_type: string; status: string; q: string }
const EMPTY: Filters = { from: "", to: "", instrument: "", call_type: "", status: "", q: "" };

export default function Watchlist() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job") || "";
  const [f, setF] = useState<Filters>(EMPTY);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (f.from) p.set("date_from", f.from);
    if (f.to) p.set("date_to", f.to);
    if (f.instrument) p.set("instrument", f.instrument);
    if (f.call_type) p.set("call_type", f.call_type);
    if (f.status) p.set("status", f.status);
    if (f.q.trim()) p.set("q", f.q.trim());
    if (jobId) p.set("job_id", jobId);
    return p.toString();
  }, [f, jobId]);

  const list = useQuery({
    queryKey: ["watchlist", qs],
    queryFn: () => api.get<ListOut>(`/watchlist${qs ? `?${qs}` : ""}`),
  });
  const rows = list.data?.items ?? [];
  const refetch = () => qc.invalidateQueries({ queryKey: ["watchlist"] });

  const refreshSet = useMutation({
    mutationFn: (ids: string[] | null) => api.post<{ updated: number; failed: number; total: number }>("/watchlist/refresh-cmp", { ids }),
    onSuccess: (r) => { toast.success(`CMP updated for ${r.updated}/${r.total} (${r.failed} failed)`); refetch(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "CMP refresh failed"),
  });
  const refreshOne = useMutation({
    mutationFn: (id: string) => api.post<Row>(`/watchlist/${id}/refresh-cmp`),
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "CMP fetch failed"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/watchlist/${id}`),
    onSuccess: () => { toast.success("Removed from watchlist"); refetch(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Remove failed"),
  });

  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const filteredIds = rows.map((r) => r.id);
  const jobLabel = jobId ? `${rows[0]?.platform_name ?? "Rationale job"}${rows[0]?.call_date ? " · " + ddmmyy(rows[0].call_date) : ""}` : "";
  const clearJob = () => { const p = new URLSearchParams(params); p.delete("job"); setParams(p, { replace: true }); };

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active ? "border-brand bg-brand-50 text-brand-700 ring-2 ring-brand/20" : "border-slate-200 text-slate-600 hover:border-slate-300"}`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><TrendingUp size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Watchlist</h1>
            <p className="text-sm text-slate-500">Standardised calls from saved rationales, tracked live against Dhan.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" disabled={refreshSet.isPending || !filteredIds.length}
            onClick={() => refreshSet.mutate(filteredIds)} title="Fetch CMP for the filtered stocks">
            {refreshSet.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Fetch CMP (filtered)
          </button>
          <button className="btn-primary" disabled={refreshSet.isPending}
            onClick={() => refreshSet.mutate(null)} title="Fetch CMP for every call (may take a while)">
            <RefreshCw size={16} /> Fetch all
          </button>
        </div>
      </div>

      {/* Job-scoped banner */}
      {jobId && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-50 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-brand-700"><TrendingUp size={15} /> Showing calls from one rationale job — <span className="font-semibold">{jobLabel}</span></span>
          <button className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-white" onClick={clearJob}><X size={13} /> View all calls</button>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input h-9 w-40" value={f.from} max={f.to || undefined} onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input h-9 w-40" value={f.to} min={f.from || undefined} onChange={(e) => setF((s) => ({ ...s, to: e.target.value }))} />
          </div>
          <div className="relative min-w-[180px] flex-1">
            <label className="label">Search</label>
            <Search size={14} className="pointer-events-none absolute left-3 top-[34px] text-slate-400" />
            <input className="input h-9 pl-8" placeholder="Stock or channel…" value={f.q} onChange={(e) => setF((s) => ({ ...s, q: e.target.value }))} />
          </div>
          {dirty && <button className="btn-ghost h-9" onClick={() => setF(EMPTY)}><X size={14} /> Clear</button>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Instrument:</span>
          <button className={chip(!f.instrument)} onClick={() => setF((s) => ({ ...s, instrument: "" }))}>All</button>
          {(list.data?.instruments ?? []).map((i) => (
            <button key={i.value} className={chip(f.instrument === i.value)} onClick={() => setF((s) => ({ ...s, instrument: s.instrument === i.value ? "" : i.value }))}>
              {i.label} <span className="text-slate-400">({i.count})</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Call:</span>
          {(["buy", "hold", "sell", "no_view"] as const).map((c) => (
            <button key={c} className={chip(f.call_type === c)} onClick={() => setF((s) => ({ ...s, call_type: s.call_type === c ? "" : c }))}>{CALL_META[c].label}</button>
          ))}
          <span className="ml-3 text-xs font-medium text-slate-400">Status:</span>
          {(["achieved", "awaited"] as const).map((s2) => (
            <button key={s2} className={chip(f.status === s2)} onClick={() => setF((s) => ({ ...s, status: s.status === s2 ? "" : s2 }))}>
              {s2 === "achieved" ? "Target achieved" : "Awaited"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {list.isLoading ? (
        <div className="grid h-64 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : rows.length === 0 ? (
        <div className="card grid place-items-center p-12 text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Target size={22} /></span>
          <h2 className="text-lg font-semibold">No calls yet</h2>
          <p className="mt-1 text-sm text-slate-500">Save a rationale and its stocks land here automatically.</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-xs">
              <colgroup>
                <col className="w-[8%]" /><col className="w-[13%]" /><col className="w-[14%]" /><col className="w-[6%]" />
                <col className="w-[13%]" /><col className="w-[15%]" /><col className="w-[9%]" /><col className="w-[8%]" />
                <col className="w-[8%]" /><col className="w-[6%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 text-left uppercase tracking-wide text-slate-400">
                  <th className="px-2.5 py-2.5 font-semibold">Date</th>
                  <th className="px-2.5 py-2.5 font-semibold">Channel</th>
                  <th className="px-2.5 py-2.5 font-semibold">Stock</th>
                  <th className="px-2.5 py-2.5 font-semibold">Call</th>
                  <th className="px-2.5 py-2.5 font-semibold">CMP call → now</th>
                  <th className="px-2.5 py-2.5 font-semibold">Targets</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">SL / DF</th>
                  <th className="px-2.5 py-2.5 font-semibold">Holding</th>
                  <th className="px-2.5 py-2.5 font-semibold">Status</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {rows.map((r, idx) => {
                    const cm = CALL_META[r.call_type] ?? CALL_META.no_view;
                    const showPnl = (r.call_type === "buy" || r.call_type === "hold") && r.pnl_abs != null;
                    return (
                      <motion.tr key={r.id} layout
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, delay: Math.min(idx * 0.015, 0.3) }}
                        className={`border-b border-slate-100 align-top ${ROW_BG[r.highlight] ?? "bg-white"}`}>
                        <td className="px-2.5 py-3 text-slate-600">
                          <div className="font-medium">{ddmmyy(r.call_date)}</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">{daysLabel(r.days_since)}</div>
                        </td>
                        <td className="px-2.5 py-3">
                          <div className="flex items-center gap-2">
                            {r.channel_logo_path
                              ? <img src={r.channel_logo_path} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover ring-1 ring-slate-200" />
                              : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100 text-[10px] font-semibold text-slate-500">{(r.platform_name ?? "?")[0]?.toUpperCase()}</span>}
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-700">{r.platform_name ?? "—"}</div>
                              <div className="truncate text-[11px] capitalize text-slate-400">{r.platform_type ?? ""}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2.5 py-3">
                          <div className="truncate font-semibold text-slate-800">{r.stock_symbol ?? r.short_name ?? "—"}</div>
                          <div className="truncate text-[11px] text-slate-400" title={r.listed_name ?? ""}>{r.listed_name ?? ""}</div>
                        </td>
                        <td className="px-2.5 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${cm.cls}`}>{cm.label}</span></td>
                        <td className="px-2.5 py-3">
                          <div className="flex items-center gap-1 whitespace-nowrap text-slate-700">
                            <span>{inr(r.call_cmp)}</span><span className="text-slate-300">→</span>
                            <span className="font-medium text-slate-800">{r.current_cmp == null ? <span className="text-[11px] text-slate-300">—</span> : inr(r.current_cmp)}</span>
                          </div>
                          {showPnl && (
                            <div className={`mt-0.5 font-semibold ${r.pnl_abs! >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {r.pnl_abs! >= 0 ? "+" : ""}{r.pnl_pct}% <span className="font-normal">({r.pnl_abs! >= 0 ? "+" : ""}{inr(r.pnl_abs)})</span>
                            </div>
                          )}
                        </td>
                        <td className="px-2.5 py-3">
                          {r.targets_status.length === 0 ? <span className="text-slate-300">—</span> : (
                            <div className="flex flex-wrap gap-1">
                              {r.targets_status.map((t, i) => (
                                <span key={i} title={`Target ${i + 1}`}
                                  className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${t.achieved ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                  T{i + 1}{t.achieved && <Check size={10} />} {inr(t.value)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2.5 py-3 text-right text-slate-600">
                          <div>{r.stoploss == null ? "—" : inr(r.stoploss)}</div>
                          <div className={`text-[11px] ${r.downfall_hit ? "font-semibold text-red-600" : "text-slate-400"}`}>{r.downfall_target == null ? "" : inr(r.downfall_target)}</div>
                        </td>
                        <td className="px-2.5 py-3 text-slate-600">
                          <div className="truncate">{r.holding_period ?? "—"}</div>
                          {r.holding_elapsed != null && (
                            <div className={`text-[11px] ${r.holding_elapsed ? "text-amber-600" : "text-slate-400"}`}>{r.holding_elapsed ? "elapsed" : "in window"}</div>
                          )}
                        </td>
                        <td className="px-2.5 py-3">
                          {r.status === "achieved" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><Check size={11} />{r.achieved_count}/{r.total_targets || 1}</span>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Awaited</span>
                          )}
                        </td>
                        <td className="px-2.5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button title="Fetch CMP" disabled={refreshOne.isPending} onClick={() => refreshOne.mutate(r.id)}
                              className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand">
                              {refreshOne.isPending && refreshOne.variables === r.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                            </button>
                            <button title="Remove from watchlist" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}
                              className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-danger"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="px-1 text-xs text-slate-400">{rows.length} call{rows.length === 1 ? "" : "s"} shown · green = target hit, red = in loss, white = awaited.</p>
    </div>
  );
}
