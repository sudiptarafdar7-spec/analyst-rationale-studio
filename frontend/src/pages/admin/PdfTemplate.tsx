import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Save } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";
import RichTextEditor from "../../components/RichTextEditor";

interface PdfTemplate {
  id: string;
  company_name: string;
  registration_details: string | null;
  disclaimer_text: string | null;
  disclosure_text: string | null;
  company_data: string | null;
  created_at: string;
  updated_at: string;
}

interface FormState {
  company_name: string;
  registration_details: string;
  disclaimer_text: string;
  disclosure_text: string;
  company_data: string;
}

const EMPTY: FormState = {
  company_name: "",
  registration_details: "",
  disclaimer_text: "",
  disclosure_text: "",
  company_data: "",
};

const RICH_FIELDS: { key: keyof FormState; label: string; help: string }[] = [
  { key: "registration_details", label: "Registration Details", help: "SEBI registration number, validity, etc. Shown on the letterhead." },
  { key: "disclaimer_text", label: "Disclaimer", help: "Standard disclaimer printed on the report." },
  { key: "disclosure_text", label: "Disclosure", help: "Analyst / firm disclosures." },
  { key: "company_data", label: "Company Data", help: "Contact details (compliance, principal, grievance, general) and any extra footer info." },
];

export default function PdfTemplate() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["pdf-template"],
    queryFn: () => api.get<PdfTemplate | null>("/admin/pdf-template"),
  });

  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (data) {
      setForm({
        company_name: data.company_name ?? "",
        registration_details: data.registration_details ?? "",
        disclaimer_text: data.disclaimer_text ?? "",
        disclosure_text: data.disclosure_text ?? "",
        company_data: data.company_data ?? "",
      });
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () => api.put<PdfTemplate>("/admin/pdf-template", form),
    onSuccess: () => {
      toast.success("PDF template saved");
      qc.invalidateQueries({ queryKey: ["pdf-template"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save template"),
  });

  const set = (key: keyof FormState, value: string) => setForm((s) => ({ ...s, [key]: value }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <FileText size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PDF Template</h1>
            <p className="text-sm text-slate-500">Branding and boilerplate printed on every compliance PDF.</p>
          </div>
        </div>
        <button
          className="btn-primary"
          disabled={!form.company_name.trim() || saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          Save template
        </button>
      </div>

      {isLoading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="animate-spin text-slate-300" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="card p-6">
            <label className="label">Company Name</label>
            <input
              className="input"
              value={form.company_name}
              onChange={(e) => set("company_name", e.target.value)}
              placeholder="e.g. Acme Research Pvt. Ltd."
            />
          </div>

          {RICH_FIELDS.map((f) => (
            <div key={f.key} className="card p-6">
              <label className="label">{f.label}</label>
              <p className="mb-2 text-xs text-slate-400">{f.help}</p>
              <RichTextEditor value={form[f.key]} onChange={(html) => set(f.key, html)} />
            </div>
          ))}

          <div className="flex justify-end">
            <button
              className="btn-primary"
              disabled={!form.company_name.trim() || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              Save template
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
