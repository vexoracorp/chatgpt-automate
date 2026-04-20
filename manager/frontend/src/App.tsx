import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import Spinner from "@cloudscape-design/components/spinner";
import Box from "@cloudscape-design/components/box";
import Layout from "./components/Layout";
import LoginGate from "./components/LoginGate";
import Setup2FAGate from "./components/Setup2FAGate";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AccountsPage from "./pages/AccountsPage";
import AccountDetailPage from "./pages/AccountDetailPage";
import WorkflowsPage from "./pages/WorkflowsPage";
import RegisterWorkflow from "./pages/RegisterWorkflow";
import BulkRegisterWorkflow from "./pages/BulkRegisterWorkflow";
import LoginWorkflow from "./pages/LoginWorkflow";
import CodexWorkflow from "./pages/CodexWorkflow";
import CodexDeviceWorkflow from "./pages/CodexDeviceWorkflow";
import CdkActivateWorkflow from "./pages/CdkActivateWorkflow";
import PromoCheckoutWorkflow from "./pages/PromoCheckoutWorkflow";
import WorkflowRunDetailPage from "./pages/WorkflowRunDetailPage";
import ProxiesPage from "./pages/ProxiesPage";
import MailboxesPage from "./pages/MailboxesPage";
import UsersPage from "./pages/UsersPage";
import SettingsPage from "./pages/SettingsPage";
import ExtensionsPage from "./pages/ExtensionsPage";
import ExtensionAppPage from "./pages/ExtensionAppPage";
import SharedAccountPage from "./pages/SharedAccountPage";

import GlobalErrorBoundary from "./components/ErrorReport";

function AuthenticatedRoutes() {
  const { user, role, pendingUser, needs2FASetup, loading, sessionExpired } = useAuth();

  if (loading) {
    return (
      <Box padding={{ vertical: "xxxl" }} textAlign="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (!user && !pendingUser) return <LoginGate expired={sessionExpired} />;
  if (!user && pendingUser) return <LoginGate expired={false} />;
  if (needs2FASetup) return <Setup2FAGate />;

  const isAdmin = role === "admin" || role === "owner";

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<AccountsPage />} />
        <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/register" element={<RegisterWorkflow />} />
        <Route path="/workflows/bulk-register" element={<BulkRegisterWorkflow />} />
        <Route path="/workflows/login" element={<LoginWorkflow />} />
        <Route path="/workflows/codex" element={<CodexWorkflow />} />
        <Route path="/workflows/codex-device" element={<CodexDeviceWorkflow />} />
        <Route path="/workflows/cdk-activate" element={<CdkActivateWorkflow />} />
        <Route path="/workflows/promo-checkout" element={<PromoCheckoutWorkflow />} />
        <Route path="/workflows/runs/:runId" element={<WorkflowRunDetailPage />} />
        <Route path="/proxies" element={<ProxiesPage />} />
        <Route path="/mailboxes" element={<MailboxesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/settings" element={isAdmin ? <SettingsPage /> : <Navigate to="/" replace />} />
        <Route path="/extensions" element={isAdmin ? <ExtensionsPage /> : <Navigate to="/" replace />} />
        <Route path="/extensions/:extId" element={isAdmin ? <ExtensionAppPage /> : <Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <GlobalErrorBoundary />
      <BrowserRouter>
        <Routes>
          <Route path="/shared/:tokenId" element={<SharedAccountPage />} />
          <Route path="*" element={<AuthenticatedRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
