import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, LineChart as LineChartIcon, Loader2, Sparkles } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { toast } from "../store/toast";

interface ChartResult { chart_url: string; cmp: number | null }
interface FormState {
  security_id: string;
  exchange: "NSE" | "BSE";
  short_name: string;
  date: string;
  time: string;
  chart_type: string;
}
const todayISO = () => new Date().toISOString().slice(0, 10);
const EMPTY: FormState = { security_id: "", exchange: "NSE", short_name: "", date: todayISO(), time: "15:30:00", chart_type: "Daily" };

export default function GenerateChart() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((s) => ({ ...s, [k]: v }));

  const gen = useMutation({
    mutationFn: () => api.post<ChartResult>("/tools/generate-chart", {
      security_id: form.security_id.trim(),
      exchange: form.exchange,
      date: form.date,
      time: form.time || "15:30:00",
      chart_type: form.chart_type,
      short_name: form.short_name.trim() || null,
    }),
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
          <p className="text-sm text-slate-500">Render a premium candlestick chart (MA + RSI + CMP) for any scrip via Dhan.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Form */}
        <form
          className="card h-fit space-y-4 p-5"
          onSubmit={(e) => { e.preventDefault(); if (!form.security_id.trim()) { toast.error("Enter a security id"); return; } gen.mutate(); }}
        >
          <div>
            <label className="label" htmlFor="sid">Security ID <span className="text-slate-400">(Dhan)</span></label>
            <input id="sid" className="input" value={form.security_id} onChange={(e) => set("security_id", e.target.value)} placeholder="e.g. 2885" autoFocus />
            <p className="mt-1 text-xs text-slate-400">Tip: the security id comes from the scrip master (e.g. 2885 = Reliance).</p>
          </div>
          <div>
            <label className="label" htmlFor="sname">Display name <span className="text-slate-400">(optional)</span></label>
            <input id="sname" className="input" value={form.short_name} onChange={(e) => set("short_name", e.target.value)} placeholder="e.g. RELIANCE" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="exch">Exchange</label>
              <select id="exch" className="input" value={form.exchange} onChange={(e) => set("exchange", e.target.value as "NSE" | "BSE")}>
                <option value="NSE">NSE</option><option value="BSE">BSE</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ctype">Chart type</label>
              <select id="ctype" className="input" value={form.chart_type} onChange={(e) => set("chart_type", e.target.value)}>
                <option value="Daily">Daily</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cdate">Date</label>
              <input id="cdate" type="date" className="input" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ctime">Time</label>
              <input id="ctime" type="time" step={1} className="input" value={form.time} onChange={(e) => set("time", e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={gen.isPending || !form.security_id.trim()}>
            {gen.isPending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Generate chart
          </button>
        </form>

        {/* Result */}
        <div className="card flex min-h-[420px] flex-col p-5">
          {gen.isPending ? (
            <div className="grid flex-1 place-items-center text-center">
              <div><Loader2 className="mx-auto animate-spin text-slate-300" /><p className="mt-3 text-sm text-slate-500">Fetching candles &amp; rendering…</p></div>
            </div>
          ) : gen.isError ? (
            <div className="grid flex-1 place-items-center text-center">
              <div>
                <p className="text-sm font-medium text-red-600">Couldn't generate the chart</p>
                <p className="mt-1 text-sm text-slate-500">{gen.error instanceof ApiError ? gen.error.message : "Try again"}</p>
              </div>
            </div>
          ) : result ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-slate-600">
                  {form.short_name || form.security_id} · {form.exchange}
                  {result.cmp != null && <> · <span className="font-semibold text-slate-800">CMP ₹{result.cmp.toFixed(2)}</span></>}
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
                <p className="mt-1 text-sm text-slate-500">Fill the form and generate a chart to preview it here.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
