import type { User } from "./types";

/** A user holds a permission if they have the wildcard "*" or the exact key. */
export function hasPerm(user: User | null | undefined, key?: string): boolean {
  if (!key) return true;
  const perms = user?.permissions ?? [];
  // "prefix:*" means "holds an EXPLICIT permission under that prefix" (e.g.
  // apikey:*). The global "*" (admins) does NOT satisfy it, so redundant menus
  // like API Access stay hidden for admins who already have the full admin page.
  if (key.endsWith(":*")) { const pre = key.slice(0, -1); return perms.some((p) => p.startsWith(pre)); }
  if (perms.includes("*")) return true;
  return perms.includes(key);
}

export interface PermissionDef { key: string; label: string; group: "employee" | "admin" | "apikeys" | "review" }
