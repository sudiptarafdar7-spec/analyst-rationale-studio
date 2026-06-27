import {
  Activity,
  BarChart3,
  FileBox,
  FileText,
  History,
  KeyRound,
  LayoutDashboard,
  LineChart,
  Radio,
  Save,
  Settings2,
  Sparkles,
  TrendingUp,
  UserCircle,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Permission key required to see this item. Omitted = always visible. */
  perm?: string;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

/** Sidebar groups. Visibility is driven by permissions (see AppShell). */
export const NAV_GROUPS: NavGroup[] = [
  { heading: "Dashboard", items: [{ label: "Dashboard", to: "/", icon: LayoutDashboard }] },
  {
    heading: "Media Presence",
    items: [{ label: "Media Presence", to: "/media-presence", icon: Radio }],
  },
  {
    heading: "Rationale Tools",
    items: [{ label: "AI Rationale", to: "/ai-rationale", icon: Sparkles }],
  },
  {
    heading: "Other Tools",
    items: [{ label: "Generate Chart", to: "/generate-chart", icon: LineChart, perm: "chart:generate" }],
  },
  {
    heading: "Stock Analysis",
    items: [{ label: "Watchlist", to: "/admin/watchlist", icon: TrendingUp, perm: "watchlist:view" }],
  },
  {
    heading: "Management",
    items: [
      { label: "Saved Rationale", to: "/saved", icon: Save },
      { label: "My Activity", to: "/activity", icon: History },
      { label: "Manage Profile", to: "/profile", icon: UserCircle },
    ],
  },
  {
    heading: "Users",
    items: [
      { label: "User Management", to: "/admin/users", icon: UserCog, perm: "admin:users" },
      { label: "User Activities", to: "/admin/activities", icon: Activity, perm: "admin:users" },
    ],
  },
  {
    heading: "Admin",
    items: [
      { label: "Manage Platform", to: "/admin/platforms", icon: Settings2, perm: "admin:platforms" },
      { label: "Manage API Keys", to: "/admin/api-keys", icon: KeyRound, perm: "admin:api_keys" },
      { label: "Manage AI Models", to: "/admin/ai-models", icon: BarChart3, perm: "admin:ai_models" },
      { label: "Upload Required Files", to: "/admin/files", icon: FileBox, perm: "admin:files" },
      { label: "PDF Template", to: "/admin/pdf-template", icon: FileText, perm: "admin:pdf_template" },
      { label: "Analysts Profile", to: "/admin/analysts", icon: Users, perm: "admin:analysts" },
    ],
  },
];

export const BRAND_ICON = Activity;
