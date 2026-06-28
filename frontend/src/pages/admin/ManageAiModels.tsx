import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Loader2, Save, Zap } from "lucide-react";
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

const TASK_LABEL: Record<string, string> = {
  translate: "Translate to English",
  speaker_detect: "Detect Speakers",
  extract: "Extract Analysis",
  polish: "Polish Analysis",
  watchlist: "Watchlist Extract",
};

function TaskCard({ mapping, catalog }: { mapping: ModelMapping; catalog: Record<string, ModelOption[]> }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<Provider>(mapping.provider);
  const [modelName, setModelName] = useState(mapping.model_name);
  const [customOpen, setCustomOpen] = useState(false);

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
    mutationFn: () => api.post<{ ok: boolean; message: string }>("/admin/test-model", { provider, model_name: modelName }),
    onSuccess: (res) => (res.ok ? toast.success(res.message) : toast.error(res.message)),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Test failed"),
  });

  const opts = catalog[provider] ?? [];
  const isCustomVal = modelName !== "__global__" && !opts.some((o) => o.value === modelName);
  const showCustom = customOpen || isCustomVal;
  const selectValue = showCustom ? "__custom__" : modelName;

  return (
    <div className="card flex flex-wrap items-end gap-3 p-5">
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
          <option value="__custom__">Custom...</option>
        </select>
        {showCustom && (
          <input
            className="input mt-2 font-mono text-sm"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="Custom model id"
            autoFocus
          />
        )}
      </div>

      <button
        className="btn-ghost"
        onClick={() => test.mutate()}
        disabled={test.isPending}
        title="Check this model is reachable with the stored key"
      >
        {test.isPending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
        Test
      </button>
      <button className="btn-primary" onClick={() => save.mutate()} disabled={!modelName.trim() || save.isPending}>
        {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        Save
      </button>
    </div>
  );
}

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
        <option value="__custom__">Custom...</option>
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
          <p className="text-sm text-slate-500">
            Pick the provider and model for each pipeline task. Prompts and tuning are handled in code.
          </p>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="animate-spin text-slate-300" />
        </div>
      ) : (
        <>
          <div className="card p-5">
            <h2 className="text-base font-semibold">Global fallback model</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Used when a task model is set to &ldquo;Use global fallback&rdquo;.
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
