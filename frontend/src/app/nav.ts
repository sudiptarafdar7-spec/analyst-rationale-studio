import {
  Activity,
  BarChart3,
  FileBox,
  FileText,
  KeyRound,
  LayoutDashboard,
  LineChart,
  Radio,
  Save,
  Settings2,
  Sparkles,
  UserCircle,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export interface NavGroup {
  heading: string;
  adminOnly?: boolean;
  items: NavItem[];
}

/** Sidebar groups, exactly per docs/07 §2 (order matters). */
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
    items: [{ label: "Generate Chart", to: "/generate-chart", icon: LineChart }],
  },
  {
    heading: "Management",
    items: [
      { label: "Saved Rationale", to: "/saved", icon: Save },
      { label: "Manage Profile", to: "/profile", icon: UserCircle },
    ],
  },
  {
    heading: "Admin",
    adminOnly: true,
    items: [
      { label: "Manage Platform", to: "/admin/platforms", icon: Settings2 },
      { label: "Manage API Keys", to: "/admin/api-keys", icon: KeyRound },
      { label: "Manage AI Models", to: "/admin/ai-models", icon: BarChart3 },
      { label: "Upload Required Files", to: "/admin/files", icon: FileBox },
      { label: "PDF Template", to: "/admin/pdf-template", icon: FileText },
      { label: "Analysts Profile", to: "/admin/analysts", icon: Users },
    ],
  },
];

export const BRAND_ICON = Activity;
