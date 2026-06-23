import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, CheckCircle2, ChevronRight, Clock, LineChart as LineChartIcon, Loader2, Radio, Save, Sparkles,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../lib/api";
import { useAuthStore } from "../store/auth";

type JobStatus = "pending" | "running" | "paused_review" | "completed" | "failed" | "saved";
interface JobRow {
  id: string; title: string | null; platform_name: string | null;
  status: JobStatus; video_date: string | null; created_at: string;
}
const BRAND = "#6C4CF1";
const STATUS_ORDER: JobStatus[] = ["pending", "running", "paused_review", "completed", "failed", "saved"];
const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Pending", running: "Running", paused_review: "Review", completed: "Completed", failed: "Failed", saved: "Saved",
};
const QUICK = [
  { to: "/media-presence", label: "New media entry", icon: Radio },
  { to: "/ai-rationale", label: "Open AI Rationale", icon: Sparkles },
  { to: "/generate-chart", label: "Generate a chart", icon: LineChartIcon },
  { to: "/saved", label: "Saved rationales", icon: Save },
];

export default function Dashboard() {
  const user = useAuthStore((s) => s.user)!;
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<JobRow[]>("/jobs") });
  const rows = jobs.data ?? [];

  const { today, statusData, activity, recent, byStatus } = useMemo(() => {
    const t = new Date().toISOString().slice(0, 10);
    const bs = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<JobStatus, number>;
    rows.forEach((r) => { bs[r.status] = (bs[r.status] ?? 0) + 1; });
    const statusData = STATUS_ORDER.filter((s) => bs[s] > 0).map((s) => ({ name: STATUS_LABEL[s], value: bs[s] }));
    // last 7 days by created date
    const days: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      days.push({ day: d.toLocaleDateString(undefined, { weekday: "short" }), count: rows.filter((r) => (r.created_at || "").slice(0, 10) === iso).length });
    }
    return {
      today: rows.filter((r) => r.video_date === t || (r.created_at || "").slice(0, 10) === t).length,
      statusData, activity: days, byStatus: bs,
      recent: rows.slice(0, 6),
    };
  }, [rows]);

  const stats = [
    { label: "Today's entries", value: today, icon: Radio, cls: "bg-brand-50 text-brand-700" },
    { label: "Running", value: byStatus.running, icon: Activity, cls: "bg-blue-50 text-blue-700" },
    { label: "Needs review", value: byStatus.paused_review, icon: Clock, cls: "bg-amber-50 text-amber-700" },
    { label: "Completed", value: byStatus.completed + byStatus.saved, icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome, {user.first_name}</h1>
        <p className="mt-1 text-sm text-slate-500">Your compliance workspace at a glance.</p>
      </div>

      {jobs.isLoading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="card flex items-center gap-3 p-5">
                <span className={`grid h-11 w-11 place-items-center rounded-xl ${s.cls}`}><s.icon size={20} /></span>
                <div>
                  <div className="text-2xl font-bold tabular-nums">{s.value}</div>
                  <div className="text-xs text-slate-500">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="text-sm font-semibold">Jobs by status</h3>
              {statusData.length === 0 ? (
                <EmptyChart label="No jobs yet" />
              ) : (
                <div className="mt-3 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                      <Bar dataKey="value" fill={BRAND} radius={[6, 6, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold">Activity (last 7 days)</h3>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activity} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="act" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                    <Area type="monotone" dataKey="count" stroke={BRAND} strokeWidth={2} fill="url(#act)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Recent + quick actions */}
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-3"><h3 className="text-sm font-semibold">Recent rationales</h3></div>
              {recent.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">No media appearances logged yet.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recent.map((r) => (
                    <li key={r.id}>
                      <Link to={`/ai-rationale/${r.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{r.title || "Untitled appearance"}</span>
                          <span className="block truncate text-xs text-slate-400">{r.platform_name ?? "—"}</span>
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">{STATUS_LABEL[r.status]}</span>
                        <ChevronRight size={16} className="shrink-0 text-slate-300" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card p-3">
              <h3 className="px-2 py-1 text-sm font-semibold">Quick actions</h3>
              <div className="mt-1 space-y-1">
                {QUICK.map((q) => (
                  <Link key={q.to} to={q.to} className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition hover:bg-slate-50">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-700"><q.icon size={18} /></span>
                    <span className="flex-1 font-medium text-slate-700">{q.label}</span>
                    <ChevronRight size={16} className="text-slate-300" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <div className="mt-3 grid h-56 place-items-center text-sm text-slate-400">{label}</div>;
}
