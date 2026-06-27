import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import ActivityFeed, { type ActivityItem } from "../../components/ActivityFeed";

interface User { id: string; first_name: string; last_name: string; email: string }

export default function UserActivities() {
  const [params, setParams] = useSearchParams();
  const userId = params.get("user") || "";

  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.get<{ items: User[] }>("/users").then((r) => r.items) });
  const feed = useQuery({
    queryKey: ["all-activities", userId],
    queryFn: () => api.get<ActivityItem[]>(`/users/activities${userId ? `?user_id=${userId}` : ""}`),
  });

  const setUser = (id: string) => {
    const p = new URLSearchParams(params);
    if (id) p.set("user", id); else p.delete("user");
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Activity size={20} /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Activities</h1>
          <p className="text-sm text-slate-500">Everything every user has done — filter to one person if you like.</p>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs font-medium text-slate-400">User:</span>
        <button onClick={() => setUser("")} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${!userId ? "border-brand bg-brand-50 text-brand-700 ring-2 ring-brand/20" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>Everyone</button>
        {(users.data ?? []).map((u) => (
          <button key={u.id} onClick={() => setUser(u.id)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${userId === u.id ? "border-brand bg-brand-50 text-brand-700 ring-2 ring-brand/20" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
            {u.first_name} {u.last_name}
          </button>
        ))}
      </div>

      {feed.isLoading ? <div className="grid h-48 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
        : <ActivityFeed items={feed.data ?? []} showActor={!userId} />}
    </div>
  );
}
