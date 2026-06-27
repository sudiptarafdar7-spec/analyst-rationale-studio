import type { User } from "./types";

/** A user holds a permission if they have the wildcard "*" or the exact key. */
export function hasPerm(user: User | null | undefined, key?: string): boolean {
  if (!key) return true;
  const perms = user?.permissions ?? [];
  return perms.includes("*") || perms.includes(key);
}

export interface PermissionDef { key: string; label: string; group: "employee" | "admin" }
