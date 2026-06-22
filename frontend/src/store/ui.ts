import { create } from "zustand";

/**
 * UI-only state (Zustand). Server state lives in TanStack Query.
 * Placeholder store for Phase 0 — real UI state added in later phases.
 */
interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
