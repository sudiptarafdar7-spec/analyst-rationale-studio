import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, ClipboardCheck } from "lucide-react";
import { api } from "../lib/api";

interface Note { id: string; job_id: string | null; kind: string; title: string; body: string | null; read: boolean; created_at: string }

const META: Record<string, { icon: typeof Bell; cls: string }> = {
  review: { icon: ClipboardCheck, cls: "bg-amber-50 text-amber-600" },
  completed: { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-600" },
  failed: { icon: AlertTriangle, cls: "bg-red-50 text-red-600" },
};
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function playPing() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = "sine"; o.frequency.value = freq;
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* audio not available */ }
}

export default function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const prevUnread = useRef<number | null>(null);

  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<Note[]>("/notifications?limit=30"),
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  });
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.read).length;

  // Ping when the unread count rises (skip the first load).
  useEffect(() => {
    if (!q.data) return;
    if (prevUnread.current !== null && unread > prevUnread.current) playPing();
    prevUnread.current = unread;
  }, [unread, q.data]);

  const readAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) readAll.mutate();
  };
  const go = (n: Note) => { setOpen(false); if (n.job_id) navigate(`/ai-rationale/${n.job_id}`); };

  return (
    <div className="relative">
      <button onClick={toggle} aria-label="Notifications"
        className="relative grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <span className="text-sm font-semibold">Notifications</span>
              {items.length > 0 && <button className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-brand" onClick={() => readAll.mutate()}><CheckCheck size={13} /> Mark all read</button>}
            </div>
            <div className="max-h-96 overflow-auto">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">You're all caught up.</div>
              ) : items.map((n) => {
                const m = META[n.kind] ?? { icon: Bell, cls: "bg-slate-100 text-slate-500" };
                const Icon = m.icon;
                return (
                  <button key={n.id} onClick={() => go(n)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${n.read ? "" : "bg-brand-50/40"}`}>
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${m.cls}`}><Icon size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{n.title}</div>
                      {n.body && <div className="truncate text-xs text-slate-500">{n.body}</div>}
                      <div className="mt-0.5 text-[11px] text-slate-400">{ago(n.created_at)}</div>
                    </div>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
