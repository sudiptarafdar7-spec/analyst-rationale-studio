import type { User } from "./types";

/** A user holds a permission if they have the wildcard "*" or the exact key. */
export function hasPerm(user: User | null | undefined, key?: string): boolean {
  if (!key) return true;
  const perms = user?.permissions ?? [];
  if (perms.includes("*")) return true;
  // "prefix:*" means "holds any permission under that prefix" (e.g. apikey:*).
  if (key.endsWith(":*")) { const pre = key.slice(0, -1); return perms.some((p) => p.startsWith(pre)); }
  return perms.includes(key);
}

export interface PermissionDef { key: string; label: string; group: "employee" | "admin" | "apikeys" | "review" }
