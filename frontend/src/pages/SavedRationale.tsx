import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Facebook, FileDown, Globe, Instagram, Loader2, MessageCircle, Save, Search, Send, Trash2, Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { toast } from "../store/toast";

type PlatformType = "youtube" | "facebook" | "instagram" | "telegram" | "whatsapp" | "other";
interface AnalystRef { id: string; name: string }
interface SavedJob {
  id: string;
  title: string | null;
  platform_name: string | null;
  platform_type: PlatformType | null;
  platform_logo: string | null;
  analysts: AnalystRef[];
  video_date: string | null;
  video_time: string | null;
  status: string;
  pdf_url: string | null;
}

const PICON: Record<PlatformType, LucideIcon> = {
  youtube: Youtube, facebook: Facebook, instagram: Instagram, telegram: Send, whatsapp: MessageCircle, other: Globe,
};

function fmtDate(d: string | null, t: string | null) {
  if (!d) return "—";
  const dt = new Date(`${d}T${t ?? "00:00:00"}`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", ...(t ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

async function downloadPdf(job: SavedJob) {
  try {
    const blob = await api.getBlob(`/jobs/${job.id}/pdf`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(job.title || job.platform_name || "rationale").replace(/[^\w.-]+/g, "_")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : "Could not download PDF");
  }
}

export default function SavedRationale() {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["saved"], queryFn: () => api.get<SavedJob[]>("/saved") });

  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [analyst, setAnalyst] = useState("");
  const [platform, setPlatform] = useState("");
  const [confirmDel, setConfirmDel] = useState<SavedJob | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/saved/${id}`),
    onSuccess: () => { toast.success("Removed from archive"); setConfirmDel(null); qc.invalidateQueries({ queryKey: ["saved"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not delete"),
  });

  const rows = saved.data ?? [];
  const analystOpts = useMemo(() => Array.from(new Set(rows.flatMap((r) => r.analysts.map((a) => a.name)))).sort(), [rows]);
  const platformOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.platform_name).filter(Boolean) as string[])).sort(), [rows]);

  const filtered = rows.filter((r) => {
    const text = `${r.title ?? ""} ${r.platform_name ?? ""} ${r.analysts.map((a) => a.name).join(" ")}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    if (date && r.video_date !== date) return false;
    if (analyst && !r.analysts.some((a) => a.name === analyst)) return false;
    if (platform && r.platform_name !== platform) return false;
    return true;
  });

  const clearable = q || date || analyst || platform;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Save size={20} /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Saved Rationale</h1>
          <p className="text-sm text-slate-500">Your archived compliance PDFs.</p>
        </div>
      </div>

      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search title / channel / analyst" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <select className="input" value={analyst} onChange={(e) => setAnalyst(e.target.value)}>
            <option value="">All analysts</option>
            {analystOpts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">All channels</option>
            {platformOpts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {clearable && (
          <button className="mt-2 text-xs text-slate-400 hover:text-brand" onClick={() => { setQ(""); setDate(""); setAnalyst(""); setPlatform(""); }}>
            Clear filters
          </button>
        )}
      </div>

      {saved.isLoading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : filtered.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Channel</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Analyst</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => {
                const Icon = PICON[r.platform_type ?? "other"];
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.platform_logo ? (
                          <img src={r.platform_logo} alt="" className="h-7 w-7 rounded-lg object-cover ring-1 ring-slate-200" />
                        ) : (
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500"><Icon size={14} /></span>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-700">{r.platform_name ?? "—"}</div>
                          {r.title && <div className="truncate text-xs text-slate-400">{r.title}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(r.video_date, r.video_time)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.analysts.length ? r.analysts.map((a) => a.name).join(", ") : "All analysts"}</td>
                    <td className="px-4 py-3"><span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">Saved</span></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => downloadPdf(r)}><FileDown size={14} /> PDF</button>
                        <button className="btn-ghost px-3 py-1.5 text-xs text-danger" onClick={() => setConfirmDel(r)}><Trash2 size={14} /> Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card grid place-items-center p-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Save size={22} /></span>
          <h2 className="mt-4 text-lg font-semibold">{rows.length ? "No matches" : "No saved rationales yet"}</h2>
          <p className="mt-1 text-sm text-slate-500">{rows.length ? "Try clearing the filters." : "Completed rationales you save will appear here."}</p>
        </div>
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setConfirmDel(null)} />
          <div className="card relative z-10 w-full max-w-md p-6">
            <h3 className="text-lg font-semibold">Delete saved rationale?</h3>
            <p className="mt-2 text-sm text-slate-600">
              Remove <span className="font-medium">{confirmDel.title || confirmDel.platform_name || "this entry"}</span> and its files? This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn bg-danger text-white hover:bg-danger/90" disabled={del.isPending} onClick={() => del.mutate(confirmDel.id)}>
                {del.isPending && <Loader2 size={16} className="animate-spin" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
