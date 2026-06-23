import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { api } from "../lib/api";

type JobStatus = "pending" | "running" | "paused_review" | "completed" | "failed" | "saved";
interface JobRow {
  id: string;
  title: string | null;
  platform_name: string | null;
  status: JobStatus;
  current_step: number;
  created_at: string;
}
const STATUS: Record<JobStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-slate-100 text-slate-600" },
  running: { label: "Running", cls: "bg-blue-100 text-blue-700" },
  paused_review: { label: "Needs review", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700" },
  saved: { label: "Saved", cls: "bg-violet-100 text-violet-700" },
};

export default function AiRationale() {
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<JobRow[]>("/jobs") });
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Sparkles size={20} /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Rationale</h1>
          <p className="text-sm text-slate-500">Open a media appearance to run its rationale pipeline and review the gates.</p>
        </div>
      </div>

      {jobs.isLoading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
      ) : jobs.data && jobs.data.length > 0 ? (
        <div className="card divide-y divide-slate-100">
          {jobs.data.map((j) => (
            <Link key={j.id} to={`/ai-rationale/${j.id}`} className="flex items-center gap-4 p-4 transition hover:bg-slate-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{j.title || "Untitled appearance"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[j.status].cls}`}>{STATUS[j.status].label}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-500">{j.platform_name ?? "—"}{j.status === "running" || j.status === "paused_review" ? ` · step ${j.current_step}/10` : ""}</p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-slate-300" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="card grid place-items-center p-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Sparkles size={22} /></span>
          <h2 className="mt-4 text-lg font-semibold">Nothing to process yet</h2>
          <p className="mt-1 text-sm text-slate-500">Add a media appearance first, then start its rationale.</p>
          <Link className="btn-primary mt-4" to="/media-presence">Go to Media Presence</Link>
        </div>
      )}
    </div>
  );
}
