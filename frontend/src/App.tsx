import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { RequireAdmin, RequireAuth } from "./app/guards";
import AppShell from "./app/AppShell";
import Toaster from "./components/Toaster";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Placeholder from "./pages/Placeholder";
import ManageApiKeys from "./pages/admin/ManageApiKeys";

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/media-presence" element={<Placeholder title="Media Presence" phase="Phase 6" />} />
          <Route path="/ai-rationale" element={<Placeholder title="AI Rationale" phase="Phase 7-8" />} />
          <Route path="/generate-chart" element={<Placeholder title="Generate Chart" phase="Phase 10" />} />
          <Route path="/saved" element={<Placeholder title="Saved Rationale" phase="Phase 9" />} />
          <Route path="/profile" element={<Profile />} />

          {/* Admin-only */}
          <Route path="/admin/platforms" element={<RequireAdmin><Placeholder title="Manage Platform" phase="Phase 3b" /></RequireAdmin>} />
          <Route path="/admin/api-keys" element={<RequireAdmin><ManageApiKeys /></RequireAdmin>} />
          <Route path="/admin/ai-models" element={<RequireAdmin><Placeholder title="Manage AI Models" phase="Phase 3f" /></RequireAdmin>} />
          <Route path="/admin/files" element={<RequireAdmin><Placeholder title="Upload Required Files" phase="Phase 3d" /></RequireAdmin>} />
          <Route path="/admin/pdf-template" element={<RequireAdmin><Placeholder title="PDF Template" phase="Phase 3e" /></RequireAdmin>} />
          <Route path="/admin/analysts" element={<RequireAdmin><Placeholder title="Analysts Profile" phase="Phase 3c" /></RequireAdmin>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
