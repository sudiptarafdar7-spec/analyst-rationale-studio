import { useRef, useState } from "react";
import { Camera, Loader2, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";
import type { User } from "../lib/types";
import Avatar from "../components/Avatar";

function scorePassword(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const clamped = Math.min(score, 4);
  const label = ["Very weak", "Weak", "Fair", "Good", "Strong"][clamped]!;
  return { score: clamped, label };
}

const STRENGTH_COLORS = ["bg-danger", "bg-danger", "bg-warning", "bg-brand-400", "bg-success"];

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}

export default function Profile() {
  const user = useAuthStore((s) => s.user)!;
  const setUser = useAuthStore((s) => s.setUser);
  const fileRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [mobile, setMobile] = useState(user.mobile ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const strength = scorePassword(next);
  const fullName = `${user.first_name} ${user.last_name}`;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const updated = await api.patch<User>("/users/me", {
        first_name: firstName,
        last_name: lastName,
        mobile: mobile || null,
      });
      setUser(updated);
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be 5 MB or smaller");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const updated = await api.postForm<User>("/users/me/avatar", fd);
      setUser(updated);
      toast.success("Avatar updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Avatar upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      toast.error("New passwords do not match");
      return;
    }
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    setSavingPw(true);
    try {
      await api.post("/users/me/password", {
        current_password: current,
        new_password: next,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password changed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not change password");
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Manage Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Update your details, photo and password.</p>
      </div>

      {/* Identity + avatar */}
      <SectionCard title="Profile photo" description="PNG, JPEG, WEBP or GIF up to 5 MB.">
        <div className="flex items-center gap-5">
          <Avatar name={fullName} src={user.avatar_path ?? undefined} size={72} />
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={onPickAvatar}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-ghost"
            >
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
              {uploading ? "Uploading…" : "Change photo"}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Details */}
      <SectionCard title="Account details">
        <form onSubmit={saveProfile} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">First name</label>
              <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <label className="label">Last name</label>
              <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Mobile</label>
              <input className="input" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91 …" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input bg-slate-50 text-slate-500" value={user.email} disabled />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold capitalize text-brand-700 ring-1 ring-brand-200">
              <ShieldCheck size={14} /> {user.role}
            </span>
            <button type="submit" disabled={savingProfile} className="btn-primary">
              {savingProfile && <Loader2 size={18} className="animate-spin" />}
              {savingProfile ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </SectionCard>

      {/* Password */}
      <SectionCard title="Change password" description="Use at least 8 characters.">
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label className="label">Current password</label>
            <input
              type="password"
              className="input"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">New password</label>
              <input
                type="password"
                className="input"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          {next && (
            <div>
              <div className="flex h-1.5 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-full flex-1 rounded-full transition ${
                      i < strength.score ? STRENGTH_COLORS[strength.score] : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
              <div className="mt-1.5 text-xs text-slate-500">
                Strength: <span className="font-medium text-slate-700">{strength.label}</span>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={savingPw} className="btn-primary">
              {savingPw && <Loader2 size={18} className="animate-spin" />}
              {savingPw ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
