/**
 * Auth store (Zustand). The access token is kept in memory only; session
 * persistence across reloads comes from the httpOnly refresh cookie + bootstrap.
 *
 * Uses raw fetch (not the api client) to avoid an import cycle — the api client
 * imports this store.
 */
import { create } from "zustand";
import type { LoginResponse, User } from "../lib/types";

const BASE = "/api";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  status: Status;
  setAccessToken: (t: string | null) => void;
  setUser: (u: User | null) => void;
  reset: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  status: "loading",

  setAccessToken: (t) => set({ accessToken: t }),
  setUser: (u) => set({ user: u }),
  reset: () => set({ user: null, accessToken: null, status: "anonymous" }),

  login: async (email, password) => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      let detail = "Invalid email or password";
      try {
        const body = await res.json();
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    const data: LoginResponse = await res.json();
    set({ accessToken: data.access_token, user: data.user, status: "authenticated" });
  },

  logout: async () => {
    const token = get().accessToken;
    try {
      await fetch(`${BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch {
      /* best effort */
    }
    set({ user: null, accessToken: null, status: "anonymous" });
  },

  bootstrap: async () => {
    // Try to mint an access token from the refresh cookie, then load the user.
    try {
      const r = await fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!r.ok) {
        set({ status: "anonymous" });
        return;
      }
      const { access_token } = await r.json();
      const meRes = await fetch(`${BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
        credentials: "include",
      });
      if (!meRes.ok) {
        set({ status: "anonymous" });
        return;
      }
      const user: User = await meRes.json();
      set({ accessToken: access_token, user, status: "authenticated" });
    } catch {
      set({ status: "anonymous" });
    }
  },
}));
