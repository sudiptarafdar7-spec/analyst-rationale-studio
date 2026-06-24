import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Download, LineChart as LineChartIcon, Loader2, Search, Sparkles, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { toast } from "../store/toast";

interface Instrument { value: string; label: string; count: number }
interface MasterHit { symbol: string; short_name: string; listed_name: string; security_id: string; exchange: string; instrument: string }
interface ChartResult { chart_url: string; cmp: number | null }

const CHART_TYPES = ["Daily", "Weekly", "Monthly"] as const;
type ChartType = (typeof CHART_TYPES)[number];

function isoDaysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);

export default function GenerateChart() {
  const instruments = useQuery({ queryKey: ["master-instruments"], queryFn: () => api.get<Instrument[]>("/tools/master-instruments") });

  const [instrument, setInstrument] = useState<string>("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MasterHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<MasterHit | null>(null);
  const [chartType, setChartType] = useState<ChartType>("Daily");
  const [from, setFrom] = useState(isoDaysAgo(365));
  const [to, setTo] = useState(TODAY);
  const tRef = useRef<number | undefined>(undefined);

  // Default the instrument to Equity (or the first) once instruments load.
  useEffect(() => {
    if (!instrument && instruments.data && instruments.data.length) {
      const eq = instruments.data.find((i) => i.value === "EQUITY");
      setInstrument(eq ? eq.value : instruments.data[0].value);
    }
  }, [instruments.data, instrument]);

  const search = (q: string) => {
    setQuery(q); setOpen(true); setPicked(null);
    window.clearTimeout(tRef.current);
    if (q.trim().length < 1 || !instrument) { setResults([]); return; }
    tRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get<MasterHit[]>(`/tools/master-search?q=${encodeURIComponent(q.trim())}&instrument=${encodeURIComponent(instrument)}&limit=15`);
        setResults(r);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 250);
  };

  const gen = useMutation({
    mutationFn: () => {
      if (!picked) throw new ApiError(0, "Pick a stock first");
      return api.post<ChartResult>("/tools/generate-chart", {
        security_id: picked.security_id, exchange: picked.exchange, instrument: picked.instrument,
        chart_type: chartType, from_date: from, to_date: to, short_name: picked.short_name || picked.symbol,
      });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not generate chart"),
    onSuccess: () => toast.success("Chart generated"),
  });
  const result = gen.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><LineChartIcon size={20} /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Generate Chart</h1>
          <p className="text-sm text-slate-500">Pick an instrument, search a scrip, and draw a premium candle chart via Dhan.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Form */}
        <div className="card h-fit space-y-5 p-5">
          {/* Instrument tabs */}
          <div>
            <label className="label">Instrument</label>
            {instruments.isLoading ? (
              <div className="flex h-10 items-center text-sm text-slate-400"><Loader2 size={14} className="mr-2 animate-spin" /> Loading…</div>
            ) : instruments.data && instruments.data.length ? (
              <div className="flex flex-wrap gap-2">
                {instruments.data.map((i) => {
                  const active = instrument === i.value;
                  return (
                    <button key={i.value} type="button"
                      onClick={() => { setInstrument(i.value); setPicked(null); setQuery(""); setResults([]); }}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${active ? "border-brand bg-brand-50 text-brand-700 ring-2 ring-brand/20" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                      {i.label} <span className="text-slate-400">({i.count})</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No scrip master uploaded. Add it under Upload Required Files.</p>
            )}
          </div>

          {/* Search */}
          <div>
            <label className="label">Stock</label>
            {picked ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-brand/30 bg-brand-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{picked.symbol}</div>
                  <div className="truncate text-xs text-slate-500">{picked.listed_name} · {picked.exchange} · {picked.security_id}</div>
                </div>
                <button className="text-slate-400 hover:text-danger" onClick={() => { setPicked(null); setQuery(""); }} aria-label="Clear"><X size={16} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" value={query} placeholder="Type symbol or name…" disabled={!instrument}
                  onChange={(e) => search(e.target.value)} onFocus={() => query && setOpen(true)} />
                {open && (searching || results.length > 0) && (
                  <>
                    <button className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-hidden tabIndex={-1} />
                    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                      {searching && results.length === 0 ? <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
                        : results.map((h, k) => (
                          <button key={k} type="button" onClick={() => { setPicked(h); setOpen(false); setResults([]); }}
                            className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50">
                            <span className="min-w-0 truncate"><span className="font-semibold text-slate-700">{h.symbol}</span> <span className="text-slate-400">{h.listed_name}</span></span>
                            <span className="shrink-0 text-[10px] text-slate-400">{h.exchange} · {h.security_id}</span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Candle type */}
          <div>
            <label className="label">Timeframe</label>
            <div className="grid grid-cols-3 gap-2">
              {CHART_TYPES.map((ct) => (
                <button key={ct} type="button" onClick={() => setChartType(ct)}
                  className={`rounded-xl border px-2 py-2 text-xs font-medium transition ${chartType === ct ? "border-brand bg-brand-50 text-brand-700 ring-2 ring-brand/20" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                  {ct}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">From</label><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="label">To</label><input type="date" className="input" value={to} min={from} max={TODAY} onChange={(e) => setTo(e.target.value)} /></div>
          </div>

          <button className="btn-primary w-full" disabled={!picked || gen.isPending} onClick={() => gen.mutate()}>
            {gen.isPending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Generate chart
          </button>
        </div>

        {/* Result */}
        <div className="card flex min-h-[440px] flex-col p-5">
          {gen.isPending ? (
            <div className="grid flex-1 place-items-center text-center"><div><Loader2 className="mx-auto animate-spin text-slate-300" /><p className="mt-3 text-sm text-slate-500">Fetching candles &amp; rendering…</p></div></div>
          ) : gen.isError ? (
            <div className="grid flex-1 place-items-center text-center"><div><p className="text-sm font-medium text-red-600">Couldn't generate the chart</p><p className="mt-1 text-sm text-slate-500">{gen.error instanceof ApiError ? gen.error.message : "Try again"}</p></div></div>
          ) : result ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-slate-600">
                  {picked?.symbol} · {picked?.exchange} · {chartType}
                  {result.cmp != null && <> · <span className="font-semibold text-slate-800">Last ₹{result.cmp.toFixed(2)}</span></>}
                </div>
                <a className="btn-ghost text-xs" href={result.chart_url} download target="_blank" rel="noreferrer"><Download size={14} /> Download PNG</a>
              </div>
              <img src={result.chart_url} alt="Generated chart" className="w-full rounded-xl ring-1 ring-slate-200" />
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><LineChartIcon size={22} /></span>
                <h2 className="mt-4 text-lg font-semibold">No chart yet</h2>
                <p className="mt-1 text-sm text-slate-500">Pick an instrument &amp; stock, set the timeframe and range, then generate.</p>
                {picked && <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600"><Check size={12} /> {picked.symbol} selected</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
