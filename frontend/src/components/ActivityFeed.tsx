import {
  Activity as ActIcon, CheckCircle2, LineChart, Pencil, Play, Radio, Trash2, TrendingUp, UserCog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface ActivityItem {
  id: string; user_id: string | null; actor_name: string | null;
  action: string; summary: string; entity_type: string | null; entity_id: string | null; created_at: string;
}

const ICON: { test: (a: string) => boolean; icon: LucideIcon; cls: string }[] = [
  { test: (a) => a === "media:delete" || a === "user:delete" || a === "watchlist:delete", icon: Trash2, cls: "bg-red-50 text-red-600" },
  { test: (a) => a === "media:edit" || a === "user:update", icon: Pencil, cls: "bg-amber-50 text-amber-600" },
  { test: (a) => a.startsWith("media"), icon: Radio, cls: "bg-blue-50 text-blue-600" },
  { test: (a) => a === "rationale:run", icon: Play, cls: "bg-violet-50 text-violet-600" },
  { test: (a) => a === "rationale:review", icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-600" },
  { test: (a) => a === "chart:generate", icon: LineChart, cls: "bg-sky-50 text-sky-600" },
  { test: (a) => a.startsWith("watchlist"), icon: TrendingUp, cls: "bg-teal-50 text-teal-600" },
  { test: (a) => a.startsWith("user"), icon: UserCog, cls: "bg-indigo-50 text-indigo-600" },
];

function meta(action: string) {
  return ICON.find((m) => m.test(action)) ?? { icon: ActIcon, cls: "bg-slate-100 text-slate-500" };
}
function ago(iso: string): string {
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function ActivityFeed({ items, showActor = false }: { items: ActivityItem[]; showActor?: boolean }) {
  if (items.length === 0) {
    return (
      <div className="card grid place-items-center p-12 text-center">
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><ActIcon size={22} /></span>
        <h2 className="text-lg font-semibold">No activity yet</h2>
        <p className="mt-1 text-sm text-slate-500">Actions like adding entries, running the pipeline, reviewing steps and generating charts show up here.</p>
      </div>
    );
  }
  return (
    <div className="card divide-y divide-slate-100 p-0">
      {items.map((a) => {
        const m = meta(a.action); const Icon = m.icon;
        return (
          <div key={a.id} className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${m.cls}`}><Icon size={15} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-700">
                {showActor && a.actor_name && <span className="font-semibold text-slate-800">{a.actor_name} </span>}
                {a.summary}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{ago(a.created_at)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
