import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  CalendarClock, ClipboardCheck, Facebook, Globe, Instagram, Loader2, MessageCircle, Send, Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../lib/api";

type PT = "youtube" | "facebook" | "instagram" | "telegram" | "whatsapp" | "other";
interface AnalystRef { id: string; name: string; avatar_path: string | null }
interface Job {
  id: string; title: string | null; platform_name: string | null; platform_type: PT | null;
  platform_logo: string | null; analysts: AnalystRef[]; video_date: string | null; video_time: string | null;
}
const PICON: Record<string, LucideIcon> = {
  youtube: Youtube, facebook: Facebook, instagram: Instagram, telegram: Send, whatsapp: MessageCircle, other: Globe,
};
function fmt(d: string | null, t: string | null) {
  if (!d) return "—";
  const dt = new Date(`${d}T${t ?? "00:00:00"}`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", ...(t ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export default function PendingReview() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["pending-review"], queryFn: () => api.get<Job[]>("/review/pending") });
  const jobs = q.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><ClipboardCheck size={20} /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pending Review</h1>
          <p className="text-sm text-slate-500">Rationales sent to the reviewer, awaiting a signed PDF.</p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid h-48 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : jobs.length === 0 ? (
        <div className="card grid place-items-center p-12 text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><ClipboardCheck size={22} /></span>
          <h2 className="text-lg font-semibold">Nothing waiting for review</h2>
          <p className="mt-1 text-sm text-slate-500">When a rationale is sent to the reviewer it appears here.</p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100 p-0">
          {jobs.map((j) => {
            const Icon = PICON[j.platform_type ?? "other"] ?? Globe;
            return (
              <button key={j.id} onClick={() => navigate(`/review/${j.id}`)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-brand-50/40">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><Icon size={16} /></span>
                {j.platform_logo
                  ? <img src={j.platform_logo} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
                  : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">{(j.platform_name ?? "?")[0]?.toUpperCase()}</span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{j.platform_name ?? "—"}</div>
                  <div className="truncate text-xs text-slate-400">{j.title || "Untitled appearance"}</div>
                </div>
                <div className="hidden items-center gap-1 text-xs text-slate-500 sm:flex"><CalendarClock size={12} /> {fmt(j.video_date, j.video_time)}</div>
                <span className="ml-2 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">Review →</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
