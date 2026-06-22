import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Facebook,
  Globe,
  Instagram,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Radio,
  Send,
  Trash2,
  Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";
import Modal from "../../components/Modal";

type PlatformType = "youtube" | "facebook" | "instagram" | "telegram" | "whatsapp" | "other";

interface Platform {
  id: string;
  platform_type: PlatformType;
  channel_name: string;
  url: string | null;
  channel_logo_path: string | null;
  is_active: boolean;
  created_at: string;
}

const TYPES: { value: PlatformType; label: string; icon: LucideIcon; color: string }[] = [
  { value: "youtube", label: "YouTube", icon: Youtube, color: "text-red-600 bg-red-50" },
  { value: "facebook", label: "Facebook", icon: Facebook, color: "text-blue-600 bg-blue-50" },
  { value: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-600 bg-pink-50" },
  { value: "telegram", label: "Telegram", icon: Send, color: "text-sky-600 bg-sky-50" },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "text-emerald-600 bg-emerald-50" },
  { value: "other", label: "Other", icon: Globe, color: "text-slate-600 bg-slate-100" },
];
const META = Object.fromEntries(TYPES.map((t) => [t.value, t]));

interface FormState {
  id?: string;
  platform_type: PlatformType;
  channel_name: string;
  url: string;
  logoFile: File | null;
  logoPreview: string | null;
  fetchedLogoPath: string | null;
}

const EMPTY: FormState = {
  platform_type: "youtube",
  channel_name: "",
  url: "",
  logoFile: null,
  logoPreview: null,
  fetchedLogoPath: null,
};

export default function ManagePlatform() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["platforms"],
    queryFn: () => api.get<Platform[]>("/platforms"),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirmDel, setConfirmDel] = useState<Platform | null>(null);
  const isEdit = Boolean(form.id);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["platforms"] });

  const openCreate = () => {
    setForm(EMPTY);
    setOpen(true);
  };
  const openEdit = (p: Platform) => {
    setForm({
      id: p.id,
      platform_type: p.platform_type,
      channel_name: p.channel_name,
      url: p.url ?? "",
      logoFile: null,
      logoPreview: p.channel_logo_path,
      fetchedLogoPath: p.channel_logo_path,
    });
    setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("platform_type", form.platform_type);
      fd.append("channel_name", form.channel_name);
      if (form.url) fd.append("url", form.url);
      if (form.logoFile) fd.append("logo", form.logoFile);
      else if (form.fetchedLogoPath) fd.append("channel_logo_path", form.fetchedLogoPath);
      return form.id
        ? api.patchForm(`/platforms/${form.id}`, fd)
        : api.postForm("/platforms", fd);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Platform updated" : "Platform added");
      setOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save platform"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.del(`/platforms/${id}`),
    onSuccess: () => {
      toast.success("Platform deleted");
      setConfirmDel(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not delete platform"),
  });

  const onPickLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Logo must be 5 MB or smaller");
      return;
    }
    setForm((s) => ({ ...s, logoFile: f, logoPreview: URL.createObjectURL(f), fetchedLogoPath: null }));
  };

  const [fetching, setFetching] = useState(false);
  const fetchFromYoutube = async () => {
    if (!form.url.trim()) {
      toast.error("Enter the YouTube URL first");
      return;
    }
    setFetching(true);
    try {
      const res = await api.get<{ channel_name: string; channel_logo_path: string | null; channel_url: string | null }>(
        `/platforms/youtube/resolve?url=${encodeURIComponent(form.url.trim())}`,
      );
      setForm((s) => ({
        ...s,
        channel_name: res.channel_name || s.channel_name,
        url: res.channel_url || s.url,
        logoFile: null,
        logoPreview: res.channel_logo_path ?? s.logoPreview,
        fetchedLogoPath: res.channel_logo_path ?? s.fetchedLogoPath,
      }));
      toast.success("Fetched channel details from YouTube");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not fetch from YouTube");
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <Radio size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Manage Platform</h1>
            <p className="text-sm text-slate-500">Media channels your analysts appear on.</p>
          </div>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={18} /> Add platform
        </button>
      </div>

      {isLoading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="animate-spin text-slate-300" />
        </div>
      ) : data && data.length > 0 ? (
        <div className="card divide-y divide-slate-100">
          {data.map((p) => {
            const meta = META[p.platform_type] ?? META.other;
            const Icon = meta.icon;
            return (
              <div key={p.id} className="flex items-center gap-4 p-4">
                {p.channel_logo_path ? (
                  <img
                    src={p.channel_logo_path}
                    alt=""
                    className="h-11 w-11 rounded-xl object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <span className={`grid h-11 w-11 place-items-center rounded-xl ${meta.color}`}>
                    <Icon size={20} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.channel_name}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
                      <Icon size={12} /> {meta.label}
                    </span>
                  </div>
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm text-slate-400 hover:text-brand"
                    >
                      {p.url}
                    </a>
                  )}
                </div>
                <button className="btn-ghost px-3 py-2 text-xs" onClick={() => openEdit(p)}>
                  <Pencil size={14} /> Edit
                </button>
                <button
                  className="btn-ghost px-3 py-2 text-xs text-danger"
                  onClick={() => setConfirmDel(p)}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card grid place-items-center p-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
            <Radio size={22} />
          </span>
          <h2 className="mt-4 text-lg font-semibold">No platforms yet</h2>
          <p className="mt-1 text-sm text-slate-500">Add the channels your analysts broadcast on.</p>
          <button className="btn-primary mt-4" onClick={openCreate}>
            <Plus size={18} /> Add platform
          </button>
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isEdit ? "Edit platform" : "Add platform"}
        description="Choose a type, name the channel, and optionally add a URL and logo."
      >
        <div className="space-y-5">
          {/* Type icon picker */}
          <div>
            <label className="label">Platform type</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((t) => {
                const Icon = t.icon;
                const active = form.platform_type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm((s) => ({ ...s, platform_type: t.value }))}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition ${
                      active
                        ? "border-brand bg-brand-50 text-brand-700 ring-2 ring-brand/20"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <Icon size={20} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label">Channel name / username</label>
            <input
              className="input"
              value={form.channel_name}
              onChange={(e) => setForm((s) => ({ ...s, channel_name: e.target.value }))}
              placeholder="e.g. Money TV"
              autoFocus
            />
          </div>

          <div>
            <label className="label">
              URL {form.platform_type === "youtube" ? "(paste a channel or video link to auto-fill)" : "(optional)"}
            </label>
            <div className="flex gap-2">
              <input
                className="input"
                value={form.url}
                onChange={(e) => setForm((s) => ({ ...s, url: e.target.value }))}
                placeholder="https://…"
              />
              {form.platform_type === "youtube" && (
                <button
                  type="button"
                  className="btn-ghost whitespace-nowrap"
                  disabled={fetching || !form.url.trim()}
                  onClick={fetchFromYoutube}
                >
                  {fetching ? <Loader2 size={16} className="animate-spin" /> : <Youtube size={16} />}
                  Fetch
                </button>
              )}
            </div>
            {form.platform_type === "youtube" && (
              <p className="mt-1 text-xs text-slate-400">
                Uses your YouTube API key. You can still edit the name and logo afterwards.
              </p>
            )}
          </div>

          <div>
            <label className="label">Channel logo (optional)</label>
            <div className="flex items-center gap-3">
              {form.logoPreview ? (
                <img src={form.logoPreview} alt="" className="h-12 w-12 rounded-xl object-cover ring-1 ring-slate-200" />
              ) : (
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-100 text-slate-400">
                  <Globe size={18} />
                </span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="hidden"
                onChange={onPickLogo}
              />
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                Choose image
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={!form.channel_name.trim() || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending && <Loader2 size={18} className="animate-spin" />}
              {isEdit ? "Save changes" : "Add platform"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={confirmDel !== null}
        onClose={() => setConfirmDel(null)}
        title="Delete platform?"
        maxWidth="max-w-md"
      >
        <p className="text-sm text-slate-600">
          Remove <span className="font-medium">{confirmDel?.channel_name}</span>? Platforms used by
          existing jobs can’t be deleted.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>
            Cancel
          </button>
          <button
            className="btn bg-danger text-white hover:bg-danger/90 focus:ring-danger/25"
            disabled={delMut.isPending}
            onClick={() => confirmDel && delMut.mutate(confirmDel.id)}
          >
            {delMut.isPending && <Loader2 size={18} className="animate-spin" />}
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
