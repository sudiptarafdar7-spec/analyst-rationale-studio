import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Check, Loader2, Mail, Pencil, Plus, Shield, ShieldCheck, Trash2, UserCog,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { toast } from "../../store/toast";
import { useAuthStore } from "../../store/auth";
import Modal from "../../components/Modal";

type Role = "admin" | "employee";
interface User {
  id: string; email: string; first_name: string; last_name: string; mobile: string | null;
  role: Role; permissions: string[]; is_active: boolean; last_login_at: string | null; created_at: string;
}
interface PermDef { key: string; label: string; group: "employee" | "admin" | "apikeys" | "review" }

interface FormState {
  id?: string; first_name: string; last_name: string; email: string; mobile: string;
  role: Role; password: string; is_active: boolean; perms: string[];
}
const EMPTY: FormState = {
  first_name: "", last_name: "", email: "", mobile: "", role: "employee",
  password: "", is_active: true, perms: [],
};

export default function UserManagement() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.get<{ items: User[] }>("/users").then((r) => r.items) });
  const catalog = useQuery({ queryKey: ["perm-catalog"], queryFn: () => api.get<PermDef[]>("/users/permissions") });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirmDel, setConfirmDel] = useState<User | null>(null);
  const isEdit = Boolean(form.id);
  const all = form.perms.includes("*");

  const empPerms = (catalog.data ?? []).filter((p) => p.group === "employee");
  const adminPerms = (catalog.data ?? []).filter((p) => p.group === "admin");
  const apikeyPerms = (catalog.data ?? []).filter((p) => p.group === "apikeys");
  const reviewPerms = (catalog.data ?? []).filter((p) => p.group === "review");

  const openCreate = () => { setForm(EMPTY); setOpen(true); };
  const openEdit = (u: User) => {
    setForm({ id: u.id, first_name: u.first_name, last_name: u.last_name, email: u.email,
      mobile: u.mobile ?? "", role: u.role, password: "", is_active: u.is_active, perms: [...u.permissions] });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const perms = all ? ["*"] : form.perms.filter((p) => p !== "*");
      if (form.id) {
        const body: Record<string, unknown> = {
          email: form.email, first_name: form.first_name, last_name: form.last_name,
          mobile: form.mobile || null, role: form.role, is_active: form.is_active, permissions: perms,
        };
        if (form.password) body.password = form.password;
        return api.patch(`/users/${form.id}`, body);
      }
      return api.post("/users", {
        email: form.email, first_name: form.first_name, last_name: form.last_name,
        mobile: form.mobile || null, role: form.role, password: form.password, permissions: perms,
      });
    },
    onSuccess: () => { toast.success(isEdit ? "User updated" : "User created"); setOpen(false); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save user"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: () => { toast.success("User deleted"); setConfirmDel(null); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not delete"),
  });

  const togglePerm = (key: string) =>
    setForm((s) => ({ ...s, perms: s.perms.includes(key) ? s.perms.filter((p) => p !== key) : [...s.perms, key] }));
  const toggleAll = () => setForm((s) => ({ ...s, perms: s.perms.includes("*") ? [] : ["*"] }));

  const canSave = form.first_name.trim() && form.last_name.trim() && form.email.trim() && (isEdit || form.password.length >= 8);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><UserCog size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
            <p className="text-sm text-slate-500">Create users, assign roles, and grant granular permissions.</p>
          </div>
        </div>
        <button className="btn-primary" onClick={openCreate}><Plus size={18} /> New user</button>
      </div>

      <div className="card overflow-hidden p-0">
        {users.isLoading ? (
          <div className="grid h-48 place-items-center"><Loader2 className="animate-spin text-slate-300" /></div>
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 font-semibold">User</th>
                <th className="px-4 py-2.5 font-semibold">Role</th>
                <th className="px-4 py-2.5 font-semibold">Permissions</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {(users.data ?? []).map((u) => (
                <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{u.first_name} {u.last_name}{u.id === me?.id && <span className="ml-1 text-xs text-slate-400">(you)</span>}</div>
                    <div className="flex items-center gap-1 text-xs text-slate-400"><Mail size={11} /> {u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${u.role === "admin" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                      {u.role === "admin" ? <ShieldCheck size={12} /> : <Shield size={12} />}{u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {u.permissions.includes("*") ? <span className="font-medium text-emerald-600">All permissions</span> : `${u.permissions.length} granted`}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{u.is_active ? "Active" : "Disabled"}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button title="Activities" onClick={() => navigate(`/admin/activities?user=${u.id}`)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-brand"><Activity size={15} /></button>
                      <button title="Edit" onClick={() => openEdit(u)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-brand"><Pencil size={15} /></button>
                      {u.id !== me?.id && (
                        <button title="Delete" onClick={() => setConfirmDel(u)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-danger"><Trash2 size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={isEdit ? "Edit user" : "New user"}
        description="Set the role and tick exactly which permissions this user should have." maxWidth="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">First name</label><input className="input" value={form.first_name} onChange={(e) => setForm((s) => ({ ...s, first_name: e.target.value }))} /></div>
            <div><label className="label">Last name</label><input className="input" value={form.last_name} onChange={(e) => setForm((s) => ({ ...s, last_name: e.target.value }))} /></div>
            <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} /></div>
            <div><label className="label">Mobile</label><input className="input" value={form.mobile} onChange={(e) => setForm((s) => ({ ...s, mobile: e.target.value }))} /></div>
            <div>
              <label className="label">Role</label>
              <div className="flex gap-2">
                {(["employee", "admin"] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setForm((s) => ({ ...s, role: r }))}
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium capitalize transition ${form.role === r ? "border-brand bg-brand-50 text-brand-700 ring-2 ring-brand/20" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>{r}</button>
                ))}
              </div>
            </div>
            <div><label className="label">{isEdit ? "New password (optional)" : "Password"}</label><input className="input" type="password" value={form.password} placeholder={isEdit ? "leave blank to keep" : "min 8 chars"} onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))} /></div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
            <span className="text-sm"><span className="font-medium text-slate-700">Account active</span></span>
            <button type="button" onClick={() => setForm((s) => ({ ...s, is_active: !s.is_active }))}
              className={`relative h-5 w-9 rounded-full transition ${form.is_active ? "bg-brand" : "bg-slate-300"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${form.is_active ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </div>

          {/* Permissions */}
          <div className="rounded-xl border border-slate-200">
            <button type="button" onClick={toggleAll} className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2.5">
              <span className="text-left"><span className="font-medium text-slate-700">All permissions</span><span className="block text-xs text-slate-400">Grant everything (wildcard). Turn off to pick individually.</span></span>
              <span className={`relative h-5 w-9 rounded-full transition ${all ? "bg-brand" : "bg-slate-300"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${all ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
            {!all && (
              <div className="max-h-64 space-y-3 overflow-auto p-3">
                <PermGroup title="Actions" perms={empPerms} selected={form.perms} onToggle={togglePerm} />
                {reviewPerms.length > 0 && <PermGroup title="Review" perms={reviewPerms} selected={form.perms} onToggle={togglePerm} />}
                {apikeyPerms.length > 0 && <PermGroup title="API key access (replace only — no view)" perms={apikeyPerms} selected={form.perms} onToggle={togglePerm} />}
                {form.role === "admin" && <PermGroup title="Admin areas" perms={adminPerms} selected={form.perms} onToggle={togglePerm} />}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 size={18} className="animate-spin" />}{isEdit ? "Save changes" : "Create user"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmDel !== null} onClose={() => setConfirmDel(null)} title="Delete user?" maxWidth="max-w-md">
        <p className="text-sm text-slate-600">Remove <span className="font-medium">{confirmDel?.first_name} {confirmDel?.last_name}</span> ({confirmDel?.email})? This can't be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn bg-danger text-white hover:bg-danger/90" disabled={del.isPending} onClick={() => confirmDel && del.mutate(confirmDel.id)}>
            {del.isPending && <Loader2 size={18} className="animate-spin" />} Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}

function PermGroup({ title, perms, selected, onToggle }: { title: string; perms: PermDef[]; selected: string[]; onToggle: (k: string) => void }) {
  if (perms.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {perms.map((p) => {
          const on = selected.includes(p.key);
          return (
            <button key={p.key} type="button" onClick={() => onToggle(p.key)}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${on ? "border-brand/40 bg-brand-50" : "border-slate-200 hover:border-slate-300"}`}>
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded ${on ? "bg-brand text-white" : "border border-slate-300 bg-white"}`}>{on && <Check size={11} />}</span>
              <span className="text-slate-700">{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
