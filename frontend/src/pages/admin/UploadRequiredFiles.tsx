import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileSpreadsheet,
  FileType2,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";

type FileType = "masterFile" | "companyLogo" | "customFont" | string;

interface UploadedFile {
  id: string;
  file_type: FileType;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_active: boolean;
  uploaded_at: string;
  variant: string | null;
}

interface MasterResult {
  file: UploadedFile;
  columns_ok: boolean;
  missing_columns: string[];
  row_count: number;
  equity_count: number;
}

function prettySize(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function ActiveFileRow({ f, onDelete }: { f: UploadedFile; onDelete: (id: string) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <CheckCircle2 size={15} className="shrink-0 text-success" />
        <span className="truncate font-medium">{f.file_name}</span>
        {f.variant && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium capitalize text-brand-700">
            {f.variant}
          </span>
        )}
        <span className="text-xs text-slate-400">{prettySize(f.size_bytes)}</span>
      </div>
      <button onClick={() => onDelete(f.id)} className="text-slate-400 transition hover:text-danger" title="Deactivate">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export default function UploadRequiredFiles() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["required-files"],
    queryFn: () => api.get<UploadedFile[]>("/admin/files"),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["required-files"] });

  const masterRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const fontRegRef = useRef<HTMLInputElement>(null);
  const fontBoldRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [masterResult, setMasterResult] = useState<MasterResult | null>(null);

  const active = (type: FileType, variant?: string) =>
    (data ?? []).filter((f) => f.file_type === type && (variant ? f.variant === variant : true));

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/admin/files/${id}`),
    onSuccess: () => {
      toast.success("File deactivated");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not deactivate"),
  });

  const uploadMaster = async (file: File) => {
    setBusy("master");
    setMasterResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.postForm<MasterResult>("/admin/files/master", fd);
      setMasterResult(res);
      toast.success(`Master file validated — ${res.equity_count} EQUITY of ${res.row_count} rows`);
      invalidate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(null);
      if (masterRef.current) masterRef.current.value = "";
    }
  };

  const uploadSimple = async (endpoint: string, file: File, key: string, extra?: Record<string, string>) => {
    setBusy(key);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (extra) Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
      await api.postForm(endpoint, fd);
      toast.success("Uploaded");
      invalidate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const masters = active("masterFile");
  const logos = active("companyLogo");
  const fontReg = active("customFont", "regular");
  const fontBold = active("customFont", "bold");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <Upload size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Upload Required Files</h1>
          <p className="text-sm text-slate-500">Scrip master, company logo, and PDF fonts.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="animate-spin text-slate-300" />
        </div>
      ) : (
        <>
          {/* Master file */}
          <Section
            title="Scrip Master File"
            description="CSV from Dhan/your broker. Must include the columns Step 7 maps against."
          >
            <input
              ref={masterRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadMaster(e.target.files[0])}
            />
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <FileSpreadsheet size={20} />
              </span>
              <button className="btn-ghost" disabled={busy === "master"} onClick={() => masterRef.current?.click()}>
                {busy === "master" ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {masters.length ? "Replace master CSV" : "Upload master CSV"}
              </button>
            </div>

            {masterResult && (
              <div className="mt-4 rounded-xl bg-success-soft/50 p-4 text-sm ring-1 ring-success/20">
                <div className="flex items-center gap-2 font-medium text-success">
                  <CheckCircle2 size={16} /> Columns validated
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-slate-600 sm:grid-cols-3">
                  <div>
                    Rows: <span className="font-semibold tabular-nums">{masterResult.row_count.toLocaleString()}</span>
                  </div>
                  <div>
                    EQUITY: <span className="font-semibold tabular-nums">{masterResult.equity_count.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}

            {masters.length > 0 && (
              <div className="mt-4 space-y-2">
                {masters.map((f) => (
                  <ActiveFileRow key={f.id} f={f} onDelete={del.mutate} />
                ))}
              </div>
            )}
          </Section>

          {/* Company logo */}
          <Section title="Company Logo" description="Shown on the compliance PDF letterhead.">
            <input
              ref={logoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadSimple("/admin/files/company-logo", e.target.files[0], "logo")}
            />
            <div className="flex items-center gap-4">
              {logos[0] ? (
                <img src={logos[0].file_path} alt="" className="h-14 w-14 rounded-xl object-contain ring-1 ring-slate-200" />
              ) : (
                <span className="grid h-14 w-14 place-items-center rounded-xl bg-slate-100 text-slate-400">
                  <ImageIcon size={22} />
                </span>
              )}
              <button className="btn-ghost" disabled={busy === "logo"} onClick={() => logoRef.current?.click()}>
                {busy === "logo" ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {logos.length ? "Replace logo" : "Upload logo"}
              </button>
            </div>
            {logos.length > 0 && (
              <div className="mt-4">
                <ActiveFileRow f={logos[0]} onDelete={del.mutate} />
              </div>
            )}
          </Section>

          {/* Fonts */}
          <Section title="Custom Fonts (optional)" description="Regular + bold .ttf/.otf used by the PDF generator.">
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  { variant: "regular", ref: fontRegRef, active: fontReg },
                  { variant: "bold", ref: fontBoldRef, active: fontBold },
                ] as const
              ).map((slot) => (
                <div key={slot.variant} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FileType2 size={18} className="text-slate-500" />
                    <span className="font-medium capitalize">{slot.variant}</span>
                  </div>
                  <input
                    ref={slot.ref}
                    type="file"
                    accept=".ttf,.otf"
                    className="hidden"
                    onChange={(e) =>
                      e.target.files?.[0] &&
                      uploadSimple("/admin/files/font", e.target.files[0], `font-${slot.variant}`, {
                        variant: slot.variant,
                      })
                    }
                  />
                  <button
                    className="btn-ghost w-full"
                    disabled={busy === `font-${slot.variant}`}
                    onClick={() => slot.ref.current?.click()}
                  >
                    {busy === `font-${slot.variant}` ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Upload size={16} />
                    )}
                    {slot.active.length ? "Replace" : "Upload"} {slot.variant}
                  </button>
                  {slot.active[0] && (
                    <div className="mt-3">
                      <ActiveFileRow f={slot.active[0]} onDelete={del.mutate} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
