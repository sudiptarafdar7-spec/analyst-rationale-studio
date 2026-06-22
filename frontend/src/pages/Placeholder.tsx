import { Construction } from "lucide-react";

export default function Placeholder({ title, phase }: { title: string; phase?: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">This screen arrives in a later build phase.</p>
      </div>
      <div className="card grid place-items-center p-12 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
          <Construction size={24} />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Coming soon</h2>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          {title} isn’t built yet{phase ? ` (planned for ${phase})` : ""}. The navigation and
          access control are wired up and ready.
        </p>
      </div>
    </div>
  );
}
