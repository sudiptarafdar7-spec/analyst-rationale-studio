import { Radio, Save, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/auth";

const QUICK = [
  { to: "/media-presence", label: "Log media presence", icon: Radio },
  { to: "/ai-rationale", label: "Open AI Rationale", icon: Sparkles },
  { to: "/saved", label: "Saved rationales", icon: Save },
];

export default function Dashboard() {
  const user = useAuthStore((s) => s.user)!;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome, {user.first_name}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Your compliance workspace. Detailed dashboard metrics arrive in a later phase.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {QUICK.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className="card flex items-center gap-3 p-5 transition hover:shadow-pop"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <q.icon size={20} />
            </span>
            <span className="text-sm font-medium">{q.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
