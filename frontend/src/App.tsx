import { Routes, Route } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";

interface Health {
  status: string;
  database: string;
}

function useHealth() {
  return useQuery<Health>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("health check failed");
      return res.json();
    },
    retry: false,
  });
}

function Shell() {
  const { data, isLoading, isError } = useHealth();

  const backend = isLoading
    ? "checking…"
    : isError
      ? "unreachable"
      : `${data?.status} (db: ${data?.database})`;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white">
            <Activity size={20} />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              Analyst Rationale Studio
            </h1>
            <p className="text-sm text-slate-500">App shell — Phase 0</p>
          </div>
        </div>

        <div className="mt-6 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <span className="text-slate-500">Backend: </span>
          <span className="font-medium tabular-nums">{backend}</span>
        </div>
      </motion.div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Shell />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
