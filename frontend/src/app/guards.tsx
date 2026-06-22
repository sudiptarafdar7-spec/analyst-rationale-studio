import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "../store/auth";

function FullScreenSpinner() {
  return (
    <div className="grid h-full place-items-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand" />
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === "loading") return <FullScreenSpinner />;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  if (status === "loading") return <FullScreenSpinner />;
  if (status === "anonymous") return <Navigate to="/login" replace />;
  if (user?.role !== "admin") {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="card max-w-md p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-danger-soft text-danger">
            <ShieldAlert size={24} />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Admin access required</h2>
          <p className="mt-1 text-sm text-slate-500">
            You don’t have permission to view this page. Contact your administrator if you
            believe this is an error.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
