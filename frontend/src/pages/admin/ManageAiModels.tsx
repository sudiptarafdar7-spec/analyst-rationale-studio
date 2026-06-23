import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, ChevronDown, Loader2, RotateCcw, Save, Settings2, Zap } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";

type Provider = "openai" | "anthropic" | "gemini";
const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
];

interface ModelMapping {
  task: string;
  provider: Provider;
  model_name: string;
  tool: string;
}
interface Settings {
  global_model: string;
  advanced_model: string | null;
}
interface ModelOption {
  value: string;
  label: string;
}
interface AiModelsResponse {
  models: ModelMapping[];
  settings: Settings;
  catalog: Record<string, ModelOption[]>;
}
interface SchemaField {
  name: string;
  label: string;
  type: "number" | "text" | "textarea";
  default: unknown;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
}
interface ToolConfig {
  tool: string;
  label: string;
  task: string;
  fields: SchemaField[];
  config: Record<string, unknown>;
}

const TASK_LABEL: Record<string, string> = {
  translate: "Translate → English",
  speaker_detect: "Detect Speakers",
  extract: "Extract Analysis",
  polish: "Polish Analysis",
};

/* ---- Advanced config form (rendered from CONFIG_JSON_SCHEMA) ---- */
function AdvancedConfig({ tool }: { tool: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["tool-config", tool],
    queryFn: () => api.get<ToolConfig>(`/admin/tool-configs/${tool}`),
  });
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (data) setValues(data.config);
  }, [data]);

  const save = useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      api.put<ToolConfig>(`/admin/tool-configs/${tool}`, { config }),
    onSuccess: (res) => {
      setValues(res.config);
      qc.invalidateQueries({ queryKey: ["tool-config", tool] });
      toast.success("Advanced config saved");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save config"),
  });

  if (isLoading || !data) {
    return (
      <div className="grid h-24 place-items-center">
        <Loader2 className="animate-spin text-slate-300" />
      </div>
    );
  }

  const set = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));
  const resetDefaults = () => {
    const def: Record<string, unknown> = {};
    data.fields.forEach((f) => (def[f.name] = f.default));
    setValues(def);
    save.mutate({}); // empty overrides => server returns pure defaults
  };

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4">
      {data.fields.some((f) => f.type === "number") && (
      <div className="grid gap-4 sm:grid-cols-3">
        {data.fields
          .filter((f) => f.type === "number")
          .map((f) => (
            <div key={f.name}>
              <label className="label">{f.label}</label>
              <input
                type="number"
                className="input tnum"
                value={values[f.name] as number | undefined ?? ""}
                min={f.min}
                max={f.max}
                step={f.step}
                onChange={(e) => set(f.name, e.target.value === "" ? "" : Number(e.target.value))}
              />
              {f.help && <p className="mt-1 text-xs text-slate-400">{f.help}</p>}
            </div>
          ))}
      </div>
      )}

      {data.fields
        .filter((f) => f.type === "text")
        .map((f) => (
          <div key={f.name}>
            <label className="label">{f.label}</label>
            <input
              className="input"
              value={(values[f.name] as string | undefined) ?? ""}
              onChange={(e) => set(f.name, e.target.value)}
            />
            {f.help && <p className="mt-1 text-xs text-slate-400">{f.help}</p>}
          </div>
        ))}

      {data.fields
        .filter((f) => f.type === "textarea")
        .map((f) => (
          <div key={f.name}>
            <label className="label">{f.label}</label>
            <textarea
              className="input min-h-[180px] font-mono text-xs leading-relaxed"
              rows={f.rows ?? 10}
              value={(values[f.name] as string | undefined) ?? ""}
              onChange={(e) => set(f.name, e.target.value)}
            />
            {f.help && <p className="mt-1 text-xs text-slate-400">{f.help}</p>}
          </div>
        ))}

      <div className="flex items-center justify-end gap-2">
        <button className="btn-ghost" onClick={resetDefaults} disabled={save.isPending}>
          <RotateCcw size={16} /> Reset to default
        </button>
        <button className="btn-primary" onClick={() => save.mutate(values)} disabled={save.isPending}>
          {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save config
        </button>
      </div>
    </div>
  );
}

/* ---- Per-task card ---- */
function TaskCard({ mapping, catalog }: { mapping: ModelMapping; catalog: Record<string, ModelOption[]> }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<Provider>(mapping.provider);
  const [modelName, setModelName] = useState(mapping.model_name);
  const [customOpen, setCustomOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setProvider(mapping.provider);
    setModelName(mapping.model_name);
    setCustomOpen(false);
  }, [mapping.provider, mapping.model_name]);

  const save = useMutation({
    mutationFn: () => api.put(`/admin/ai-models/${mapping.task}`, { provider, model_name: modelName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-models"] });
      toast.success(`${TASK_LABEL[mapping.task] ?? mapping.task} model saved`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save model"),
  });

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/admin/ai-models/${mapping.task}/test`),
    onSuccess: (res) => (res.ok ? toast.success(res.message) : toast.error(res.message)),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Test failed"),
  });

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <div className="text-sm font-semibold">{TASK_LABEL[mapping.task] ?? mapping.task}</div>
          <div className="text-xs text-slate-400">tool: {mapping.tool}</div>
        </div>
        <div>
          <label className="label">Provider</label>
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <label className="label">Model</label>
          {(() => {
            const opts = catalog[provider] ?? [];
            const isCustomVal = modelName !== "__global__" && !opts.some((o) => o.value === modelName);
            const showCustom = customOpen || isCustomVal;
            const selectValue = showCustom ? "__custom__" : modelName;
            return (
              <>
                <select
                  className="input"
                  value={selectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__custom__") {
                      setCustomOpen(true);
                      setModelName("");
                    } else {
                      setCustomOpen(false);
                      setModelName(v);
                    }
                  }}
                >
                  <option value="__global__">Use global fallback</option>
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
                {showCustom && (
                  <input
                    className="input mt-2 font-mono text-sm"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="Custom model id, e.g. gpt-4.1-2025-xx"
                    autoFocus
                  />
                )}
              </>
            );
          })()}
        </div>
        <button className="btn-ghost" onClick={() => test.mutate()} disabled={test.isPending} title="Check this model is reachable with the stored key">
          {test.isPending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
          Test
        </button>
        <button className="btn-primary" onClick={() => save.mutate()} disabled={!modelName.trim() || save.isPending}>
          {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save
        </button>
      </div>

      <button
        onClick={() => setExpanded((e) => !e)}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand"
      >
        <Settings2 size={15} /> Advanced config
        <ChevronDown size={15} className={`transition ${expanded ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4">
              <AdvancedConfig tool={mapping.tool} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---- Cross-provider model picker (global / advanced fallback) ---- */
function ModelPicker({
  catalog,
  value,
  onChange,
  allowEmpty = false,
}: {
  catalog: Record<string, ModelOption[]>;
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const allValues = Object.values(catalog).flat().map((o) => o.value);
  const isCustomVal = value !== "" && !allValues.includes(value);
  const showCustom = customOpen || isCustomVal;
  const selectValue = showCustom ? "__custom__" : value === "" ? "__none__" : value;
  const PROVIDER_LABEL: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini" };

  return (
    <>
      <select
        className="input"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom__") {
            setCustomOpen(true);
            onChange("");
          } else if (v === "__none__") {
            setCustomOpen(false);
            onChange("");
          } else {
            setCustomOpen(false);
            onChange(v);
          }
        }}
      >
        {allowEmpty && <option value="__none__">None</option>}
        {Object.entries(catalog).map(([prov, opts]) => (
          <optgroup key={prov} label={PROVIDER_LABEL[prov] ?? prov}>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      {showCustom && (
        <input
          className="input mt-2 font-mono text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Custom model id"
          autoFocus
        />
      )}
    </>
  );
}

export default function ManageAiModels() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["ai-models"],
    queryFn: () => api.get<AiModelsResponse>("/admin/ai-models"),
  });

  const [global_, setGlobal] = useState("");
  const [advanced, setAdvanced] = useState("");
  useEffect(() => {
    if (data) {
      setGlobal(data.settings.global_model);
      setAdvanced(data.settings.advanced_model ?? "");
    }
  }, [data]);

  const saveSettings = useMutation({
    mutationFn: () =>
      api.put("/admin/model-settings", { global_model: global_, advanced_model: advanced || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-models"] });
      toast.success("Fallback models saved");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save settings"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <BarChart3 size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Manage AI Models</h1>
          <p className="text-sm text-slate-500">Pick the engine and tune the prompt for each pipeline task.</p>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="animate-spin text-slate-300" />
        </div>
      ) : (
        <>
          {/* Global fallback */}
          <div className="card p-5">
            <h2 className="text-base font-semibold">Global fallback model</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Used when a task model is set to <code className="rounded bg-slate-100 px-1">__global__</code>.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <label className="label">Global model</label>
                <ModelPicker catalog={data.catalog} value={global_} onChange={setGlobal} />
              </div>
              <div className="min-w-[14rem] flex-1">
                <label className="label">Advanced model (optional)</label>
                <ModelPicker catalog={data.catalog} value={advanced} onChange={setAdvanced} allowEmpty />
              </div>
              <button className="btn-primary" onClick={() => saveSettings.mutate()} disabled={!global_.trim() || saveSettings.isPending}>
                {saveSettings.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save
              </button>
            </div>
          </div>

          {/* Per-task model + advanced config */}
          <div className="space-y-4">
            {data.models.map((m) => (
              <TaskCard key={m.task} mapping={m} catalog={data.catalog} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
