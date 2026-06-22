import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LogOut, UserCircle } from "lucide-react";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";
import Avatar from "../components/Avatar";
import { BRAND_ICON, NAV_GROUPS } from "./nav";

function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const groups = NAV_GROUPS.filter((g) => !g.adminOnly || isAdmin);
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
          <BRAND_ICON size={18} />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Rationale Studio</div>
          <div className="text-[11px] text-slate-400">SEBI compliance</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.heading} className="mb-5">
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {group.heading}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                      isActive
                        ? "bg-brand-50 text-brand-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`
                  }
                >
                  <item.icon size={18} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function UserMenu() {
  const user = useAuthStore((s) => s.user)!;
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const fullName = `${user.first_name} ${user.last_name}`;
  const avatarSrc = user.avatar_path ?? undefined;

  const onLogout = async () => {
    await logout();
    toast.info("Signed out");
    navigate("/login", { replace: true });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="flex items-center gap-2.5 rounded-xl py-1.5 pl-1.5 pr-2.5 transition hover:bg-slate-100"
      >
        <Avatar name={fullName} src={avatarSrc} size={32} />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight">{fullName}</span>
          <span className="block text-[11px] capitalize text-slate-400">{user.role}</span>
        </span>
        <ChevronDown size={16} className="text-slate-400" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl bg-white py-1 shadow-pop ring-1 ring-slate-200"
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="truncate text-sm font-medium">{fullName}</div>
              <div className="truncate text-xs text-slate-400">{user.email}</div>
            </div>
            <button
              onMouseDown={() => navigate("/profile")}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50"
            >
              <UserCircle size={16} /> Manage Profile
            </button>
            <button
              onMouseDown={onLogout}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-danger transition hover:bg-danger-soft/40"
            >
              <LogOut size={16} /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AppShell() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  return (
    <div className="flex h-full">
      <Sidebar isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-5 backdrop-blur">
          <div className="text-sm font-medium text-slate-400">Analyst Rationale Studio</div>
          <UserMenu />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-5 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
