import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToastStore } from "../store/toast";

const ICON = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

const TONE = {
  success: "text-success",
  error: "text-danger",
  info: "text-brand",
} as const;

export default function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl bg-white px-4 py-3 shadow-pop ring-1 ring-slate-200"
              role="status"
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${TONE[t.kind]}`} />
              <p className="flex-1 text-sm text-slate-700">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="text-slate-400 transition hover:text-slate-600"
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
