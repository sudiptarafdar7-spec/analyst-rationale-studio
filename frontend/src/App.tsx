import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { RequireAdmin, RequireAuth } from "./app/guards";
import AppShell from "./app/AppShell";
import Toaster from "./components/Toaster";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import MediaPresence from "./pages/MediaPresence";
import AiRationale from "./pages/AiRationale";
import WorkPage from "./pages/WorkPage";
import SavedRationale from "./pages/SavedRationale";
import GenerateChart from "./pages/GenerateChart";
import ManageApiKeys from "./pages/admin/ManageApiKeys";
import ManagePlatform from "./pages/admin/ManagePlatform";
import AnalystsProfile from "./pages/admin/AnalystsProfile";
import UploadRequiredFiles from "./pages/admin/UploadRequiredFiles";
import PdfTemplate from "./pages/admin/PdfTemplate";
import ManageAiModels from "./pages/admin/ManageAiModels";
import Watchlist from "./pages/admin/Watchlist";

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
          <Route path="/media-presence" element={<MediaPresence />} />
          <Route path="/ai-rationale" element={<AiRationale />} />
          <Route path="/ai-rationale/:jobId" element={<WorkPage />} />
          <Route path="/generate-chart" element={<GenerateChart />} />
          <Route path="/saved" element={<SavedRationale />} />
          <Route path="/profile" element={<Profile />} />

          {/* Admin-only */}
          <Route path="/admin/platforms" element={<RequireAdmin><ManagePlatform /></RequireAdmin>} />
          <Route path="/admin/api-keys" element={<RequireAdmin><ManageApiKeys /></RequireAdmin>} />
          <Route path="/admin/ai-models" element={<RequireAdmin><ManageAiModels /></RequireAdmin>} />
          <Route path="/admin/files" element={<RequireAdmin><UploadRequiredFiles /></RequireAdmin>} />
          <Route path="/admin/pdf-template" element={<RequireAdmin><PdfTemplate /></RequireAdmin>} />
          <Route path="/admin/analysts" element={<RequireAdmin><AnalystsProfile /></RequireAdmin>} />
          <Route path="/admin/watchlist" element={<RequireAdmin><Watchlist /></RequireAdmin>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
