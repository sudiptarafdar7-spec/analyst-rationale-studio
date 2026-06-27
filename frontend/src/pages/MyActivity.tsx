import { useQuery } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import ActivityFeed, { type ActivityItem } from "../components/ActivityFeed";

export default function MyActivity() {
  const q = useQuery({ queryKey: ["my-activities"], queryFn: () => api.get<ActivityItem[]>("/users/me/activities") });
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><History size={20} /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Activity</h1>
          <p className="text-sm text-slate-500">A history of everything you've done in the studio.</p>
        </div>
      </div>
      {q.isLoading ? <div className="grid h-48 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
        : <ActivityFeed items={q.data ?? []} />}
    </div>
  );
}
