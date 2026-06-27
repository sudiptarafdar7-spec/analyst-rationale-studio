import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { RequirePerm, RequireAuth } from "./app/guards";
import AppShell from "./app/AppShell";
import Toaster from "./components/Toaster";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import MediaPresence from "./pages/MediaPresence";
import AiRationale from "./pages/AiRationale";
import WorkPage from "./pages/WorkPage";
import PendingReview from "./pages/PendingReview";
import ReviewDetail from "./pages/ReviewDetail";
import SignedRationale from "./pages/SignedRationale";
import GenerateChart from "./pages/GenerateChart";
import ManageApiKeys from "./pages/admin/ManageApiKeys";
import ManagePlatform from "./pages/admin/ManagePlatform";
import AnalystsProfile from "./pages/admin/AnalystsProfile";
import UploadRequiredFiles from "./pages/admin/UploadRequiredFiles";
import PdfTemplate from "./pages/admin/PdfTemplate";
import ManageAiModels from "./pages/admin/ManageAiModels";
import Watchlist from "./pages/admin/Watchlist";
import UserManagement from "./pages/admin/UserManagement";
import UserActivities from "./pages/admin/UserActivities";
import MyActivity from "./pages/MyActivity";

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
          <Route path="/review" element={<PendingReview />} />
          <Route path="/review/:jobId" element={<ReviewDetail />} />
          <Route path="/signed" element={<SignedRationale />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/activity" element={<MyActivity />} />

          {/* Admin-only */}
          <Route path="/admin/platforms" element={<RequirePerm perm="admin:platforms"><ManagePlatform /></RequirePerm>} />
          <Route path="/admin/api-keys" element={<RequirePerm perm="admin:api_keys"><ManageApiKeys /></RequirePerm>} />
          <Route path="/admin/ai-models" element={<RequirePerm perm="admin:ai_models"><ManageAiModels /></RequirePerm>} />
          <Route path="/admin/files" element={<RequirePerm perm="admin:files"><UploadRequiredFiles /></RequirePerm>} />
          <Route path="/admin/pdf-template" element={<RequirePerm perm="admin:pdf_template"><PdfTemplate /></RequirePerm>} />
          <Route path="/admin/analysts" element={<RequirePerm perm="admin:analysts"><AnalystsProfile /></RequirePerm>} />
          <Route path="/admin/watchlist" element={<RequirePerm perm="watchlist:view"><Watchlist /></RequirePerm>} />
          <Route path="/admin/users" element={<RequirePerm perm="admin:users"><UserManagement /></RequirePerm>} />
          <Route path="/admin/activities" element={<RequirePerm perm="admin:users"><UserActivities /></RequirePerm>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
