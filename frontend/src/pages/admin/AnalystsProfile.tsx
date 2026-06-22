import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";
import Modal from "../../components/Modal";
import Avatar from "../../components/Avatar";

interface Analyst {
  id: string;
  name: string;
  aliases: string | null;
  avatar_path: string | null;
  is_active: boolean;
  created_at: string;
}

interface FormState {
  id?: string;
  name: string;
  aliases: string[];
  avatarFile: File | null;
  avatarPreview: string | null;
}

const EMPTY: FormState = { name: "", aliases: [], avatarFile: null, avatarPreview: null };

function aliasesToList(s: string | null): string[] {
  if (!s) return [];
  return s.split(",").map((a) => a.trim()).filter(Boolean);
}

export default function AnalystsProfile() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["analysts"],
    queryFn: () => api.get<Analyst[]>("/analysts"),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [aliasInput, setAliasInput] = useState("");
  const [confirmDel, setConfirmDel] = useState<Analyst | null>(null);
  const isEdit = Boolean(form.id);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["analysts"] });

  const openCreate = () => {
    setForm(EMPTY);
    setAliasInput("");
    setOpen(true);
  };
  const openEdit = (a: Analyst) => {
    setForm({
      id: a.id,
      name: a.name,
      aliases: aliasesToList(a.aliases),
      avatarFile: null,
      avatarPreview: a.avatar_path,
    });
    setAliasInput("");
    setOpen(true);
  };

  const addAlias = () => {
    const v = aliasInput.trim().replace(/,+$/, "").trim();
    if (!v) return;
    if (!form.aliases.includes(v)) setForm((s) => ({ ...s, aliases: [...s.aliases, v] }));
    setAliasInput("");
  };
  const removeAlias = (a: string) => setForm((s) => ({ ...s, aliases: s.aliases.filter((x) => x !== a) }));

  const saveMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("name", form.name);
      fd.append("aliases", form.aliases.join(", "));
      if (form.avatarFile) fd.append("avatar", form.avatarFile);
      return form.id ? api.patchForm(`/analysts/${form.id}`, fd) : api.postForm("/analysts", fd);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Analyst updated" : "Analyst added");
      setOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save analyst"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.del(`/analysts/${id}`),
    onSuccess: () => {
      toast.success("Analyst removed");
      setConfirmDel(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not remove analyst"),
  });

  const onPickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Image must be 5 MB or smaller");
      return;
    }
    setForm((s) => ({ ...s, avatarFile: f, avatarPreview: URL.createObjectURL(f) }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <Users size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analysts Profile</h1>
            <p className="text-sm text-slate-500">The analysts whose on-air calls you extract.</p>
          </div>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={18} /> Add analyst
        </button>
      </div>

      {isLoading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="animate-spin text-slate-300" />
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((a) => (
            <div key={a.id} className="card flex items-start gap-4 p-5">
              <Avatar name={a.name} src={a.avatar_path ?? undefined} size={52} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.name}</div>
                {aliasesToList(a.aliases).length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {aliasesToList(a.aliases).map((al) => (
                      <span key={al} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {al}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-slate-400">No aliases</div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => openEdit(a)}>
                  <Pencil size={13} /> Edit
                </button>
                <button className="btn-ghost px-2.5 py-1.5 text-xs text-danger" onClick={() => setConfirmDel(a)}>
                  <Trash2 size={13} /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card grid place-items-center p-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
            <Users size={22} />
          </span>
          <h2 className="mt-4 text-lg font-semibold">No analysts yet</h2>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Add the analysts you broadcast with so the pipeline knows whose calls to extract.
          </p>
          <button className="btn-primary mt-4" onClick={openCreate}>
            <Plus size={18} /> Add analyst
          </button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isEdit ? "Edit analyst" : "Add analyst"}
        description="Name, on-air aliases, and an optional photo."
      >
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar name={form.name || "?"} src={form.avatarPreview ?? undefined} size={56} />
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onPickAvatar}
              />
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                Choose photo
              </button>
            </div>
          </div>

          <div>
            <label className="label">Name (canonical / target)</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              placeholder="e.g. Pradip Halder"
              autoFocus
            />
          </div>

          <div>
            <label className="label">Aliases</label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-300 px-2.5 py-2 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
              {form.aliases.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                  {a}
                  <button type="button" onClick={() => removeAlias(a)} className="hover:text-brand-900">
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addAlias();
                  } else if (e.key === "Backspace" && !aliasInput && form.aliases.length) {
                    removeAlias(form.aliases[form.aliases.length - 1]!);
                  }
                }}
                onBlur={addAlias}
                placeholder={form.aliases.length ? "" : "Type an alias, press Enter"}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              All the names this analyst is called on air (short names, nicknames). These are grouped
              to one speaker during extraction — e.g. “Pradip ji”, “Pradip”, “PH”.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={!form.name.trim() || saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending && <Loader2 size={18} className="animate-spin" />}
              {isEdit ? "Save changes" : "Add analyst"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmDel !== null} onClose={() => setConfirmDel(null)} title="Remove analyst?" maxWidth="max-w-md">
        <p className="text-sm text-slate-600">
          Remove <span className="font-medium">{confirmDel?.name}</span> from the analyst list?
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
            Remove
          </button>
        </div>
      </Modal>
    </div>
  );
}
