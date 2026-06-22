import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";

export default function Login() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid h-full lg:grid-cols-2">
      {/* Brand / trust panel */}
      <div className="relative hidden overflow-hidden bg-brand-700 lg:block">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900" />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, white 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">
              <Activity size={20} />
            </span>
            <span className="text-lg font-semibold">Analyst Rationale Studio</span>
          </div>
          <div>
            <h1 className="max-w-md text-3xl font-bold leading-tight">
              Turn every media appearance into a SEBI-compliant rationale.
            </h1>
            <p className="mt-4 max-w-md text-brand-100">
              Capture each analyst’s stock calls, attach the right scrip, and archive a branded
              compliance PDF — automatically.
            </p>
            <div className="mt-8 flex items-center gap-6 text-sm text-brand-100">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck size={18} /> SEBI compliance
              </span>
              <span className="inline-flex items-center gap-2">
                <Lock size={18} /> Audit-ready records
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-slate-50 p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="card w-full max-w-md p-8"
        >
          <div className="mb-6 lg:hidden">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand text-white">
              <Activity size={22} />
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Access your compliance workspace.</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@firm.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pr-11"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 transition hover:text-slate-600"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting && <Loader2 size={18} className="animate-spin" />}
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
