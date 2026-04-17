import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import FormField from "@cloudscape-design/components/form-field";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import Popover from "@cloudscape-design/components/popover";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Toggle from "@cloudscape-design/components/toggle";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import Input from "@cloudscape-design/components/input";
import DatePicker from "@cloudscape-design/components/date-picker";
import MailViewerModal from "../components/MailViewerModal";
import {
  type Account,
  type Mailbox,
  type Proxy,
  fetchAccount,
  refreshAccount,
  deleteAccount,
  executeAccountAction,
  getAccountMailbox,
  bindAccountMailbox,
  fetchMailboxes,
  fetchProxies,
  updateAccountProxy,
  postRegisterFlow,
  fetchAccountSettings,
  updateAccountSetting,
  fetchClientApplications,
  disconnectClientApplication,
  fetchAmphora,
  deleteBrowserContext,
  deleteAllConversations,
  archiveAllChats,
  fetchNotificationSettings,
  updateNotificationSettings,
  fetchArchivedChats,
  unarchiveConversation,
  fetchCodexSettings,
  updateCodexSettings,
  fetchCodexUsage,
  type ClientApplication,
  type AmphoraResponse,
  type NotificationCategory,
  type ArchivedChat,
  type CodexSettings,
  type CodexUsageDay,
  fetchAccountProfile,
  updateAccountProfileName,
  updateAccountProfileUsername,
  type ChatGPTProfile,
  fetchAgeVerification,
  startAgeVerification,
  type AgeVerificationStatus,
  type AgeVerificationInquiry,
  fetchCustomerPortal,
} from "../api/client";

function statusType(s: string) {
  if (s === "active") return "success" as const;
  if (s.startsWith("error")) return "error" as const;
  if (s === "awaiting_otp") return "in-progress" as const;
  if (s === "registering" || s === "logging_in") return "loading" as const;
  return "pending" as const;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatResetHours(hours: number): string {
  if (hours <= 0) return "";
  const resetAt = new Date(Date.now() + hours * 3600_000);
  const now = new Date();
  const isToday = resetAt.getDate() === now.getDate() && resetAt.getMonth() === now.getMonth();
  const time = resetAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return time;
  const date = resetAt.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${date} ${time}`;
}

function formatResetMin(min: number): string {
  if (min <= 0) return "";
  const resetAt = new Date(Date.now() + min * 60_000);
  return resetAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const ACTIONS = [
  { id: "get_me", text: "Get Me" },
  { id: "get_account_info", text: "Account Info" },
  { id: "get_identity", text: "Identity" },
  { id: "get_subscriptions", text: "Subscription" },
  { id: "get_codex_quota", text: "Codex Quota" },
  { id: "get_user_settings", text: "User Settings" },
  { id: "get_account_settings", text: "Account Settings" },
  { id: "get_notification_settings", text: "Notification Settings" },
  { id: "get_user_segments", text: "User Segments" },
];

export default function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [actionLoading, setActionLoading] = useState("");
  const [actionHistory, setActionHistory] = useState<{ action: string; result: unknown; error?: string; workflowId?: string; ts: string }[]>([]);
  const [postRegLoading, setPostRegLoading] = useState(false);

  const [bindWarningVisible, setBindWarningVisible] = useState(false);
  const [pendingBindId, setPendingBindId] = useState<string | null>(null);

  const [boundMailbox, setBoundMailbox] = useState<Mailbox | null>(null);
  const [allMailboxes, setAllMailboxes] = useState<Mailbox[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState<{ label: string; value: string } | null>(null);
  const [bindingMailbox, setBindingMailbox] = useState(false);
  const [subscriptionData, setSubscriptionData] = useState<Record<string, unknown> | null>(null);
  const [accountCheckData, setAccountCheckData] = useState<Record<string, unknown> | null>(null);

  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [selectedProxy, setSelectedProxy] = useState<{ label: string; value: string } | null>(null);
  const [updatingProxy, setUpdatingProxy] = useState(false);

  const [chatgptSettings, setChatgptSettings] = useState<Record<string, unknown> | null>(null);
  const [, setAccountChatgptSettings] = useState<Record<string, unknown> | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [togglingFeature, setTogglingFeature] = useState("");
  const [activeSettingsTab, setActiveSettingsTab] = useState("profile");
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());
  const [loadingTabs, setLoadingTabs] = useState<Set<string>>(new Set());
  const [clientApps, setClientApps] = useState<ClientApplication[]>([]);

  const [clientAppsError, setClientAppsError] = useState("");
  const [disconnectingApp, setDisconnectingApp] = useState("");
  const [disconnectConfirmApp, setDisconnectConfirmApp] = useState<{ id: string; name: string } | null>(null);
  const [amphora, setAmphora] = useState<AmphoraResponse | null>(null);
  const [modelImprovementVisible, setModelImprovementVisible] = useState(false);
  const [remoteBrowserDataVisible, setRemoteBrowserDataVisible] = useState(false);
  const [deletingBrowserContext, setDeletingBrowserContext] = useState(false);
  const [deletingAllChats, setDeletingAllChats] = useState(false);
  const [archivingAllChats, setArchivingAllChats] = useState(false);
  const [confirmArchiveAll, setConfirmArchiveAll] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationCategory[]>([]);
  const [togglingNotif, setTogglingNotif] = useState("");
  const [codexSettings, setCodexSettings] = useState<CodexSettings | null>(null);
  const [codexSettingsOriginal, setCodexSettingsOriginal] = useState<CodexSettings | null>(null);
  const [codexSettingsError, setCodexSettingsError] = useState("");
  const [updatingCodex, setUpdatingCodex] = useState("");
  const [usageData, setUsageData] = useState<CodexUsageDay[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageRange, setUsageRange] = useState<"7d" | "1m" | "custom">("1m");
  const [usageGroupBy, setUsageGroupBy] = useState<"day" | "week">("day");
  const [usageCustomStart, setUsageCustomStart] = useState("");
  const [usageCustomEnd, setUsageCustomEnd] = useState("");
  const [creditsModalVisible, setCreditsModalVisible] = useState(false);
  const [creditsAmount] = useState("1000");
  const AMOUNT_PER_CREDIT = 0.04;
  const [archivedChats, setArchivedChats] = useState<ArchivedChat[]>([]);
  const [archivedChatsVisible, setArchivedChatsVisible] = useState(false);
  const [archivedChatsLoading, setArchivedChatsLoading] = useState(false);
  const [unarchivingChat, setUnarchivingChat] = useState("");
  const [mailViewerVisible, setMailViewerVisible] = useState(false);
  const [profile, setProfile] = useState<ChatGPTProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [savingProfileName, setSavingProfileName] = useState(false);
  const [savingProfileUsername, setSavingProfileUsername] = useState(false);
  const [ageVerification, setAgeVerification] = useState<AgeVerificationStatus | null>(null);
  const [ageVerifyLoading, setAgeVerifyLoading] = useState(false);
  const [ageVerifyInquiry, setAgeVerifyInquiry] = useState<AgeVerificationInquiry | null>(null);
  const [ageVerifyModalVisible, setAgeVerifyModalVisible] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalConfirmVisible, setPortalConfirmVisible] = useState(false);

  const loadUsage = useCallback(async (range: "7d" | "1m" | "custom", groupBy: "day" | "week", customStart?: string, customEnd?: string) => {
    if (!accountId) return;
    setUsageLoading(true);
    try {
      const now = new Date();
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      let startDate: string;
      let endDate: string;
      if (range === "7d") {
        endDate = fmt(now);
        startDate = fmt(new Date(now.getTime() - 6 * 86400_000));
      } else if (range === "1m") {
        endDate = fmt(now);
        startDate = fmt(new Date(now.getTime() - 29 * 86400_000));
      } else {
        startDate = customStart || fmt(new Date(now.getTime() - 29 * 86400_000));
        endDate = customEnd || fmt(now);
      }
      const res = await fetchCodexUsage(accountId, startDate, endDate, groupBy);
      setUsageData(res.data || []);
    } catch {
      setUsageData([]);
    } finally {
      setUsageLoading(false);
    }
  }, [accountId]);

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const [acc, mbRes] = await Promise.all([
        fetchAccount(accountId),
        getAccountMailbox(accountId),
      ]);
      setAccount(acc);
      setBoundMailbox(mbRes.mailbox);
      setError("");

      if (acc.access_token) {
        executeAccountAction(accountId, "get_subscriptions")
          .then((res) => { setSubscriptionData(res.result); })
          .catch(() => {});
        executeAccountAction(accountId, "get_account_info")
          .then((res) => { setAccountCheckData(res.result); })
          .catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (account?.access_token && loadedTabs.size === 0) {
      handleSettingsTabChange(activeSettingsTab);
    }
  }, [account]);

  const handleRefresh = async () => {
    if (!accountId) return;
    setRefreshing(true);
    try {
      setAccount(await refreshAccount(accountId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async () => {
    if (!accountId) return;
    setDeleting(true);
    try {
      await deleteAccount(accountId);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
      setDeleteVisible(false);
    }
  };

  const handleAction = async (action: string) => {
    if (!accountId) return;
    setActionLoading(action);
    try {
      const res = await executeAccountAction(accountId, action);
      setActionHistory((prev) => [{ action: res.action, result: res.result, ts: new Date().toLocaleTimeString() }, ...prev]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed";
      setActionHistory((prev) => [{ action, result: null, error: msg, ts: new Date().toLocaleTimeString() }, ...prev]);
    } finally {
      setActionLoading("");
    }
  };

  const loadMailboxes = async () => {
    const mbs = await fetchMailboxes();
    setAllMailboxes(mbs);
  };

  const handlePostRegister = async () => {
    if (!accountId) return;
    setPostRegLoading(true);
    try {
      const result = await postRegisterFlow(accountId);
      setActionHistory((prev) => [{ action: "Post-Registration Flow", result: null, workflowId: result.task_id, ts: new Date().toLocaleTimeString() }, ...prev]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setActionHistory((prev) => [{ action: "Post-Registration Flow", result: null, error: msg, ts: new Date().toLocaleTimeString() }, ...prev]);
    } finally {
      setPostRegLoading(false);
    }
  };

  const loadProxies = async () => {
    const ps = await fetchProxies();
    setProxies(ps);
  };

  const handleUpdateProxy = async () => {
    if (!accountId) return;
    setUpdatingProxy(true);
    try {
      const proxyUrl = selectedProxy?.value || null;
      const updated = await updateAccountProxy(accountId, proxyUrl);
      setAccount(updated);
      setSelectedProxy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update proxy");
    } finally {
      setUpdatingProxy(false);
    }
  };

  const loadSettings = async () => {
    if (!accountId) return;
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const settingsRes = await fetchAccountSettings(accountId);
      setChatgptSettings(settingsRes.settings);
      setAccountChatgptSettings(settingsRes.account_settings);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setSettingsLoading(false);
    }
  };

  const loadTabData = async (tabId: string) => {
    if (!accountId || loadedTabs.has(tabId) || loadingTabs.has(tabId)) return;
    setLoadingTabs((prev) => new Set(prev).add(tabId));
    try {
      const needsBaseSettings = (tabId === "security" || tabId === "data-controls" || tabId === "codex") && !chatgptSettings;
      if (needsBaseSettings) {
        await loadSettings();
      }
      if (tabId === "security") {
        const appsRes = await fetchClientApplications(accountId).catch((e) => {
          setClientAppsError(e instanceof Error ? e.message : "Failed to load connected apps");
          return { items: [], third_party_items: [], usage_info: {} };
        });
        setClientApps([...appsRes.items, ...appsRes.third_party_items]);
        const ageRes = await fetchAgeVerification(accountId).catch(() => null);
        if (ageRes) setAgeVerification(ageRes);
      } else if (tabId === "parents-control") {
        const amphoraRes = await fetchAmphora(accountId).catch(() => ({ id: null, role: null }));
        setAmphora(amphoraRes);
      } else if (tabId === "notifications") {
        const notifRes = await fetchNotificationSettings(accountId).catch(() => ({ settings: [] }));
        setNotificationSettings(notifRes.settings || []);
      } else if (tabId === "codex") {
        const codexRes = await fetchCodexSettings(accountId).catch((e) => {
          setCodexSettingsError(e instanceof Error ? e.message : "Failed to load codex settings");
          return null;
        });
        setCodexSettings(codexRes);
        setCodexSettingsOriginal(codexRes);
      } else if (tabId === "profile") {
        const profileRes = await fetchAccountProfile(accountId).catch((e) => {
          setProfileError(e instanceof Error ? e.message : "Failed to load profile");
          return null;
        });
        if (profileRes) {
          setProfile(profileRes);
          setProfileDisplayName(profileRes.display_name || "");
          setProfileUsername(profileRes.username || "");
        }
      }
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : "Failed to load tab data");
    } finally {
      setLoadedTabs((prev) => new Set(prev).add(tabId));
      setLoadingTabs((prev) => { const next = new Set(prev); next.delete(tabId); return next; });
    }
  };

  const handleSettingsTabChange = async (tabId: string) => {
    setActiveSettingsTab(tabId);
    await loadTabData(tabId);
  };

  const handleDisconnectApp = async (appId: string) => {
    if (!accountId) return;
    setDisconnectingApp(appId);
    try {
      await disconnectClientApplication(accountId, appId);
      setClientApps((prev) => prev.filter((a) => a.id !== appId));
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : "Failed to disconnect application");
    } finally {
      setDisconnectingApp("");
    }
  };

  const handleToggleSetting = async (feature: string, currentValue: boolean) => {
    if (!accountId) return;
    setTogglingFeature(feature);
    try {
      await updateAccountSetting(accountId, feature, !currentValue);
      const settingsRes = await fetchAccountSettings(accountId);
      setChatgptSettings(settingsRes.settings);
      setAccountChatgptSettings(settingsRes.account_settings);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : "Failed to toggle setting");
    } finally {
      setTogglingFeature("");
    }
  };

  const handleBindMailbox = async () => {
    if (!accountId) return;
    const mbId = selectedMailbox?.value || null;

    if (mbId) {
      const selectedMb = allMailboxes.find((m) => m.id === mbId);
      if (selectedMb && selectedMb.email.toLowerCase() !== account?.email.toLowerCase()) {
        setPendingBindId(mbId);
        setBindWarningVisible(true);
        return;
      }
    }

    await doBind(mbId);
  };

  const doBind = async (mbId: string | null) => {
    if (!accountId) return;
    setBindingMailbox(true);
    try {
      const res = await bindAccountMailbox(accountId, mbId);
      setBoundMailbox(res.mailbox);
      setSelectedMailbox(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bind failed");
    } finally {
      setBindingMailbox(false);
    }
  };

  if (loading) {
    return <Box padding={{ vertical: "xxxl" }} textAlign="center"><Spinner size="large" /></Box>;
  }
  if (error && !account) {
    return <Alert type="error">{error}</Alert>;
  }
  if (!account) return null;

  const hasSession = !!account.access_token;
  const weeklyRemaining = Math.max(0, 100 - account.codex_weekly_used);
  const fiveHRemaining = Math.max(0, 100 - account.codex_5h_used);

  const mailboxOptions = [
    { label: "None (unbind)", value: "" },
    ...allMailboxes
      .filter((m) => m.status === "available" || m.assigned_account_id === accountId)
      .map((m) => ({
        label: m.email.toLowerCase() === account.email.toLowerCase()
          ? `${m.email} (recommended)`
          : m.email,
        value: m.id,
      })),
  ];

  const overviewTab = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Overview</Header>}>
        <ColumnLayout columns={4} variant="text-grid">
          <div key="status">
            <Box variant="awsui-key-label">Status</Box>
            <StatusIndicator type={statusType(account.status)}>{account.status}</StatusIndicator>
          </div>
          <div key="name">
            <Box variant="awsui-key-label">Name</Box>
            <div>{account.name || "—"}</div>
          </div>
          <div key="proxy">
            <Box variant="awsui-key-label">Proxy</Box>
            {account.proxy_url ? (
              account.proxy_test ? (
                <Popover
                  triggerType="text"
                  content={
                    <SpaceBetween size="xxs">
                      <div><strong>IP:</strong> {account.proxy_test.ip || "—"}</div>
                      <div><strong>Country:</strong> {account.proxy_test.country || "—"} ({account.proxy_test.country_code || ""})</div>
                      <div><strong>City:</strong> {account.proxy_test.city || "—"}, {account.proxy_test.region || ""}</div>
                      <div><strong>ASN:</strong> {account.proxy_test.asn || "—"}</div>
                      <div><strong>Org:</strong> {account.proxy_test.org || "—"}</div>
                      <div><strong>Latency:</strong> {account.proxy_test.latency_ms != null ? `${account.proxy_test.latency_ms}ms` : "—"}</div>
                    </SpaceBetween>
                  }
                >
                  {account.proxy_label || "Proxy"}
                </Popover>
              ) : (
                <Popover
                  triggerType="text"
                  content={<Box variant="code" fontSize="body-s">{account.proxy_url}</Box>}
                >
                  {account.proxy_label || "Proxy"}
                </Popover>
              )
            ) : (
              <div>Direct</div>
            )}
          </div>
          <div key="id">
            <Box variant="awsui-key-label">ID</Box>
            <div>{account.id}</div>
          </div>
          <div key="created">
            <Box variant="awsui-key-label">Created</Box>
            <div>{formatTime(account.created_at)}</div>
          </div>
          <div key="last-login">
            <Box variant="awsui-key-label">Last Login</Box>
            <div>{formatTime(account.last_login)}</div>
          </div>
          <div key="codex">
            <Box variant="awsui-key-label">Codex</Box>
            {account.codex_token
              ? <StatusIndicator type="success">Active</StatusIndicator>
              : <StatusIndicator type="stopped">None</StatusIndicator>}
          </div>
        </ColumnLayout>
      </Container>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, alignItems: "stretch" }}>
        <Container header={<Header variant="h2">Plan</Header>}>
          {(() => {
            const sub = subscriptionData as Record<string, unknown> | null;
            const rawPlan = sub?.subscription_plan as string || account.plan || "Unknown";
            const plan = (() => {
              const lower = rawPlan.toLowerCase().replace(/[^a-z]/g, "");
              if (lower.includes("free")) return "Free";
              if (lower.includes("plus")) return "Plus";
              if (lower.includes("pro")) return "Pro";
              if (lower.includes("team")) return "Team";
              if (lower.includes("enterprise")) return "Enterprise";
              return rawPlan;
            })();
            const status = (() => {
              if (sub?.has_active_subscription === true) return "Active";
              if (sub?.has_active_subscription === false) return "Inactive";
              if (plan !== "Unknown" && plan !== "Free") return "Active";
              if (plan === "Free") return "Free";
              return "Unknown";
            })();
            const startDate = sub?.purchase_origin_platform_subscription_start_date as string;
            const expires = sub?.will_renew === false
              ? (sub?.subscription_expires_at_timestamp as number)
              : (sub?.subscription_expires_at_timestamp as number);
            const billingPeriod = sub?.billing_period as string;
            const autoRenew = sub?.will_renew;
            const currency = sub?.subscription_pricing_currency as string;
            const maxSeats = sub?.max_seat_count as number;
            const usedSeats = sub?.seat_count as number;

            const formatDate = (ts: unknown) => {
              if (!ts) return "—";
              if (typeof ts === "number") return new Date(ts * 1000).toLocaleDateString();
              if (typeof ts === "string") return new Date(ts).toLocaleDateString();
              return "—";
            };

            return (
              <SpaceBetween size="s">
                <Box textAlign="center">
                  <Box fontSize="heading-l" fontWeight="bold" color="text-status-success">{plan}</Box>
                </Box>
                <div style={{ borderTop: "1px solid #e9ebed", paddingTop: 8 }}>
                  <SpaceBetween size="xxs">
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <Box color="text-body-secondary">Status</Box>
                      <Box fontWeight="bold" color={status === "Active" ? "text-status-success" : status === "Inactive" ? "text-status-error" : "text-body-secondary"}>{status}</Box>
                    </div>
                    {startDate && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <Box color="text-body-secondary">Start Date</Box>
                        <div>{formatDate(startDate)}</div>
                      </div>
                    )}
                    {expires && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <Box color="text-body-secondary">Expires</Box>
                        <div>{formatDate(expires)}</div>
                      </div>
                    )}
                    {billingPeriod && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <Box color="text-body-secondary">Billing Period</Box>
                        <div>{billingPeriod}</div>
                      </div>
                    )}
                    {autoRenew !== undefined && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <Box color="text-body-secondary">Auto Renew</Box>
                        <div>{autoRenew ? "Yes" : "No"}</div>
                      </div>
                    )}
                    {currency && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <Box color="text-body-secondary">Currency</Box>
                        <div>{currency.toUpperCase()}</div>
                      </div>
                    )}
                    {maxSeats != null && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <Box color="text-body-secondary">Seats</Box>
                        <div>{usedSeats ?? "—"} / {maxSeats}</div>
                      </div>
                    )}
                  </SpaceBetween>
                </div>
              </SpaceBetween>
            );
          })()}
        </Container>

        <Container header={<Header variant="h2">Credentials</Header>}>
          <SpaceBetween size="m">
            <div>
              <Box variant="awsui-key-label">Email</Box>
              <CopyToClipboard variant="inline" textToCopy={account.email} copyButtonAriaLabel="Copy email" copySuccessText="Copied" copyErrorText="Failed" />
            </div>
            <div>
              <Box variant="awsui-key-label">Password</Box>
              {account.password
                ? <CopyToClipboard variant="inline" textToCopy={account.password} copyButtonAriaLabel="Copy password" copySuccessText="Copied" copyErrorText="Failed" />
                : <Box color="text-status-inactive">Not stored</Box>}
            </div>
          </SpaceBetween>
        </Container>

        <Container header={<Header variant="h2">Codex</Header>}>
          <SpaceBetween size="xxs">
            <div>
              <Box variant="awsui-key-label">Status</Box>
              {account.codex_token
                ? <StatusIndicator type="success">Active</StatusIndicator>
                : <StatusIndicator type="stopped">Not connected</StatusIndicator>}
            </div>
          </SpaceBetween>
        </Container>
      </div>

      <Container header={<Header variant="h2">Mailbox</Header>}>
        {boundMailbox ? (
          <SpaceBetween direction="horizontal" size="xs">
            <StatusIndicator type="success">{boundMailbox.email}</StatusIndicator>
            <Button variant="inline-link" onClick={async () => {
              await bindAccountMailbox(accountId!, null);
              setBoundMailbox(null);
            }}>Unbind</Button>
          </SpaceBetween>
        ) : (
          <Box color="text-status-inactive">No mailbox bound. Bind one in the Settings tab.</Box>
        )}
      </Container>
    </SpaceBetween>
  );

  const actionsTab = (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                loading={postRegLoading}
                disabled={!hasSession}
                onClick={handlePostRegister}
              >
                Post-Registration Flow
              </Button>
              <ButtonDropdown
                items={ACTIONS}
                loading={!!actionLoading}
                disabled={!hasSession}
                onItemClick={({ detail }) => handleAction(detail.id)}
              >
                Run Action
              </ButtonDropdown>
            </SpaceBetween>
          }
          description={!hasSession ? "Account must have an active session to run actions" : `${actionHistory.length} action(s) executed`}
        >
          Actions
        </Header>
      }
    >
      {actionLoading && (
        <Box padding="s"><Spinner /> Running {actionLoading}...</Box>
      )}
      {actionHistory.length === 0 && !actionLoading && (
        <Box color="text-status-inactive" padding="s">Select an action from the dropdown to execute</Box>
      )}
      <SpaceBetween size="m">
        {actionHistory.map((entry, i) => (
          <ExpandableSection
            key={`${entry.ts}-${i}`}
            variant="container"
            defaultExpanded={i === 0}
            headerText={`${entry.action}${entry.error ? " — Failed" : ""}`}
            headerDescription={entry.ts}
          >
            {entry.error ? (
              <Alert type="error">{entry.error}</Alert>
            ) : entry.workflowId ? (
              <SpaceBetween size="s">
                <StatusIndicator type="success">Workflow started</StatusIndicator>
                <Button variant="link" onClick={() => navigate(`/workflows/${entry.workflowId}`)}>
                  View workflow run →
                </Button>
              </SpaceBetween>
            ) : (
              <div style={{ overflow: "hidden" }}>
                <Box variant="code">
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 500, overflow: "auto", margin: 0, fontSize: 13 }}>
                    {JSON.stringify(entry.result, null, 2)}
                  </pre>
                </Box>
              </div>
            )}
          </ExpandableSection>
        ))}
      </SpaceBetween>
    </Container>
  );

  const proxyOptions = [
    { label: "Direct (no proxy)", value: "" },
    ...proxies.map((p) => ({ label: p.label || p.url, value: p.url })),
  ];

  const settingsTab = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Proxy</Header>}>
        <SpaceBetween size="m">
          <div>
            <Box variant="awsui-key-label">Current Proxy</Box>
            {account.proxy_url ? (
              account.proxy_test ? (
                <Popover
                  triggerType="text"
                  content={
                    <SpaceBetween size="xxs">
                      <div><strong>IP:</strong> {account.proxy_test.ip || "—"}</div>
                      <div><strong>Country:</strong> {account.proxy_test.country || "—"} ({account.proxy_test.country_code || ""})</div>
                      <div><strong>City:</strong> {account.proxy_test.city || "—"}, {account.proxy_test.region || ""}</div>
                      <div><strong>ASN:</strong> {account.proxy_test.asn || "—"}</div>
                      <div><strong>Org:</strong> {account.proxy_test.org || "—"}</div>
                      <div><strong>Latency:</strong> {account.proxy_test.latency_ms != null ? `${account.proxy_test.latency_ms}ms` : "—"}</div>
                    </SpaceBetween>
                  }
                >
                  {account.proxy_label || "Proxy"}
                </Popover>
              ) : (
                <Popover
                  triggerType="text"
                  content={<Box variant="code" fontSize="body-s">{account.proxy_url}</Box>}
                >
                  {account.proxy_label || "Unknown proxy"}
                </Popover>
              )
            ) : (
              <Box color="text-status-inactive">Direct (no proxy)</Box>
            )}
          </div>
          <SpaceBetween direction="horizontal" size="xs">
            <div style={{ minWidth: 300 }}>
              <Select
                selectedOption={selectedProxy}
                onChange={({ detail }) => setSelectedProxy(detail.selectedOption as { label: string; value: string })}
                options={proxyOptions}
                placeholder="Select a proxy"
                onFocus={loadProxies}
              />
            </div>
            <Button onClick={handleUpdateProxy} loading={updatingProxy}>
              {selectedProxy?.value ? "Change" : selectedProxy ? "Remove" : "Change"}
            </Button>
          </SpaceBetween>
        </SpaceBetween>
      </Container>

      <Grid gridDefinition={[{ colspan: 8 }, { colspan: 4 }]}>
        <Container header={
          <Header
            variant="h2"
            actions={<Button iconName="refresh" loading={settingsLoading} onClick={async () => { setLoadedTabs(new Set()); setLoadingTabs(new Set()); await loadSettings(); await loadTabData(activeSettingsTab); }} disabled={!hasSession}>Reload</Button>}
          >
            ChatGPT Settings
          </Header>
        }>
          {settingsError && <Alert type="error" dismissible onDismiss={() => setSettingsError("")}>{settingsError}</Alert>}
          {settingsLoading && <Box><Spinner /> Loading settings...</Box>}
          <Tabs
            activeTabId={activeSettingsTab}
            onChange={({ detail }) => handleSettingsTabChange(detail.activeTabId)}
            tabs={[
            {
              id: "profile",
              label: "Profile",
              content: !loadedTabs.has("profile") ? (
                <Box padding={{ vertical: "l" }} textAlign="center"><Spinner /> Loading...</Box>
              ) : (
                <SpaceBetween size="l">
                  {profileError && <Alert type="error" dismissible onDismiss={() => setProfileError("")}>{profileError}</Alert>}
                  {profile && (
                    <SpaceBetween size="m">
                      <FormField label="Display name" description="Your public name on ChatGPT and Sora.">
                        <SpaceBetween direction="horizontal" size="xs">
                          <div style={{ flex: 1 }}>
                            <Input
                              value={profileDisplayName}
                              onChange={({ detail }) => setProfileDisplayName(detail.value)}
                              placeholder="Display name"
                              disabled={savingProfileName}
                            />
                          </div>
                          <Button
                            loading={savingProfileName}
                            disabled={!profileDisplayName.trim() || profileDisplayName === profile.display_name}
                            onClick={async () => {
                              setSavingProfileName(true);
                              setProfileError("");
                              try {
                                await updateAccountProfileName(accountId!, profileDisplayName.trim());
                                setProfile({ ...profile, display_name: profileDisplayName.trim() });
                              } catch (e) {
                                setProfileError(e instanceof Error ? e.message : "Failed to update display name");
                              } finally {
                                setSavingProfileName(false);
                              }
                            }}
                          >
                            Save
                          </Button>
                        </SpaceBetween>
                      </FormField>

                      <FormField label="Username" description="Your unique handle. Also used in the Sora app.">
                        <SpaceBetween direction="horizontal" size="xs">
                          <div style={{ flex: 1 }}>
                            <Input
                              value={profileUsername}
                              onChange={({ detail }) => setProfileUsername(detail.value)}
                              placeholder="username"
                              disabled={savingProfileUsername}
                            />
                          </div>
                          <Button
                            loading={savingProfileUsername}
                            disabled={!profileUsername.trim() || profileUsername === profile.username}
                            onClick={async () => {
                              setSavingProfileUsername(true);
                              setProfileError("");
                              try {
                                const updated = await updateAccountProfileUsername(accountId!, profileUsername.trim());
                                setProfile(updated);
                                setProfileUsername(updated.username || "");
                              } catch (e) {
                                setProfileError(e instanceof Error ? e.message : "Failed to update username");
                              } finally {
                                setSavingProfileUsername(false);
                              }
                            }}
                          >
                            Save
                          </Button>
                        </SpaceBetween>
                      </FormField>

                      {(profile.bio_freeform || profile.location || profile.work) && (
                        <ExpandableSection headerText="Additional info" variant="default">
                          <SpaceBetween size="s">
                            {profile.bio_freeform && <Box><Box variant="awsui-key-label">Bio</Box> {profile.bio_freeform}</Box>}
                            {profile.location && <Box><Box variant="awsui-key-label">Location</Box> {profile.location}</Box>}
                            {profile.work && <Box><Box variant="awsui-key-label">Work</Box> {profile.work}</Box>}
                          </SpaceBetween>
                        </ExpandableSection>
                      )}
                    </SpaceBetween>
                  )}
                  {!profile && !profileError && (
                    <Box color="text-status-inactive">No profile data available</Box>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: "security",
              label: "Security",
              content: !loadedTabs.has("security") ? (
                <Box padding={{ vertical: "l" }} textAlign="center"><Spinner /> Loading...</Box>
              ) : (
                <SpaceBetween size="l">
                  <SpaceBetween size="xs">
                    <Box variant="h3">Device Code Auth</Box>
                    {(() => {
                      const inner = (chatgptSettings as Record<string, unknown>).settings as Record<string, unknown> | undefined;
                      const val = !!inner?.enable_device_code_auth;
                      return (
                        <Toggle
                          checked={val}
                          onChange={() => handleToggleSetting("enable_device_code_auth", val)}
                          disabled={togglingFeature === "enable_device_code_auth" || !hasSession}
                        >
                          Codex CLI (Device Code Auth) {togglingFeature === "enable_device_code_auth" && <Spinner />}
                        </Toggle>
                      );
                    })()}
                  </SpaceBetween>

                  <SpaceBetween size="xs">
                    <Box variant="h3">Secure sign in with ChatGPT</Box>
                    <Box color="text-body-secondary">Sign in to websites and apps across the internet with the trusted security of ChatGPT.</Box>
                    <hr style={{ border: "none", borderTop: "1px solid var(--color-border-divider-default)", margin: "4px 0" }} />
                    {clientAppsError ? (
                      <Alert type="warning">{clientAppsError}</Alert>
                    ) : clientApps.length === 0 ? (
                      <Box color="text-status-inactive">No connected applications</Box>
                    ) : (
                      clientApps.map((app) => (
                        <div key={app.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0" }}>
                          <SpaceBetween size="xxs" direction="vertical">
                            <Box fontWeight="bold">{app.name}</Box>
                            <Box color="text-body-secondary" fontSize="body-s">Allow {app.name} to use models from the API.</Box>
                          </SpaceBetween>
                          <Button
                            variant="normal"
                            loading={disconnectingApp === app.id}
                            onClick={() => setDisconnectConfirmApp({ id: app.id, name: app.name })}
                          >
                            <span style={{ color: "var(--color-text-status-error)" }}>Disconnect</span>
                          </Button>
                        </div>
                      ))
                    )}
                  </SpaceBetween>

                  {ageVerification?.show_age_verification_setting && (
                    <>
                      <hr style={{ border: "none", borderTop: "1px solid var(--color-border-divider-default)", margin: "4px 0" }} />
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                        <SpaceBetween size="xxs">
                          <Box variant="h3">Age verification</Box>
                          <Box color="text-body-secondary">
                            To help keep ChatGPT appropriate for everyone, some settings require age verification.{" "}
                            <a href="https://help.openai.com/en/articles/age-verification" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>Learn more.</a>
                          </Box>
                        </SpaceBetween>
                        <Button
                          variant="primary"
                          loading={ageVerifyLoading}
                          disabled={!hasSession}
                          onClick={async () => {
                            setAgeVerifyLoading(true);
                            try {
                              const inquiry = await startAgeVerification(accountId!);
                              setAgeVerifyInquiry(inquiry);
                              setAgeVerifyModalVisible(true);
                            } catch (e) {
                              setSettingsError(e instanceof Error ? e.message : "Failed to start age verification");
                            } finally {
                              setAgeVerifyLoading(false);
                            }
                          }}
                        >
                          Verify age
                        </Button>
                      </div>
                    </>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: "parents-control",
              label: "Parents Control",
              content: !loadedTabs.has("parents-control") ? (
                <Box padding={{ vertical: "l" }} textAlign="center"><Spinner /> Loading...</Box>
              ) : (
                <SpaceBetween size="xs">
                  <Box color="text-body-secondary">Parents and teens can link accounts, giving parents tools to adjust certain features, set limits, and add safeguards.</Box>
                  {amphora && amphora.id ? (
                    <SpaceBetween size="xs">
                      <div><Box variant="awsui-key-label">Role</Box> <Box>{amphora.role || "Unknown"}</Box></div>
                    </SpaceBetween>
                  ) : (
                    <Box color="text-status-inactive">No parental controls configured</Box>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: "data-controls",
              label: "Data Controls",
              content: !loadedTabs.has("data-controls") ? (
                <Box padding={{ vertical: "l" }} textAlign="center"><Spinner /> Loading...</Box>
              ) : (() => {
                const inner = (chatgptSettings as Record<string, unknown>).settings as Record<string, unknown> | undefined;
                return (
                  <SpaceBetween size="xs">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--color-border-divider-default)" }}>
                      <SpaceBetween size="xxs" direction="vertical">
                        <Box variant="awsui-key-label">Improve the model for everyone</Box>
                        <Box color="text-body-secondary" fontSize="body-s">Allow your content to be used to train models.</Box>
                      </SpaceBetween>
                      <SpaceBetween direction="horizontal" size="xs">
                        <StatusIndicator type={inner?.training_allowed ? "success" : "stopped"}>{inner?.training_allowed ? "On" : "Off"}</StatusIndicator>
                        <Button variant="inline-link" onClick={() => setModelImprovementVisible(true)}>Edit</Button>
                      </SpaceBetween>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--color-border-divider-default)" }}>
                      <SpaceBetween size="xxs" direction="vertical">
                        <Box variant="awsui-key-label">Location</Box>
                        <Box color="text-body-secondary" fontSize="body-s">Allow ChatGPT to use your device's precise location when providing information.</Box>
                      </SpaceBetween>
                      <StatusIndicator type={inner?.precise_location_allowed ? "success" : "stopped"}>{inner?.precise_location_allowed ? "On" : "Off"}</StatusIndicator>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
                      <SpaceBetween size="xxs" direction="vertical">
                        <Box variant="awsui-key-label">Remote browser data</Box>
                        <Box color="text-body-secondary" fontSize="body-s">Remember site data between sessions for agent mode.</Box>
                      </SpaceBetween>
                      <SpaceBetween direction="horizontal" size="xs">
                        <StatusIndicator type={inner?.enable_remote_browser_data ? "success" : "stopped"}>{inner?.enable_remote_browser_data ? "On" : "Off"}</StatusIndicator>
                        <Button variant="inline-link" onClick={() => setRemoteBrowserDataVisible(true)}>Edit</Button>
                      </SpaceBetween>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--color-border-divider-default)" }}>
                      <Box variant="awsui-key-label">Archived chats</Box>
                      <Button
                        variant="normal"
                        disabled={!hasSession}
                        onClick={async () => {
                          if (!accountId) return;
                          setArchivedChatsLoading(true);
                          setArchivedChatsVisible(true);
                          try {
                            const res = await fetchArchivedChats(accountId);
                            setArchivedChats(res.items || []);
                          } catch (e) {
                            setSettingsError(e instanceof Error ? e.message : "Failed to fetch archived chats");
                          } finally {
                            setArchivedChatsLoading(false);
                          }
                        }}
                      >
                        Manage
                      </Button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--color-border-divider-default)" }}>
                      <Box variant="awsui-key-label">Archive all chats</Box>
                      <Button
                        variant="normal"
                        loading={archivingAllChats}
                        disabled={!hasSession}
                        onClick={() => setConfirmArchiveAll(true)}
                      >
                        Archive all
                      </Button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
                      <Box variant="awsui-key-label">Delete all chats</Box>
                      <Button
                        variant="normal"
                        loading={deletingAllChats}
                        disabled={!hasSession}
                        onClick={() => setConfirmDeleteAll(true)}
                      >
                        <span style={{ color: "var(--color-text-status-error)" }}>Delete all</span>
                      </Button>
                    </div>
                  </SpaceBetween>
                );
              })(),
            },
            {
              id: "notifications",
              label: "Notifications",
              content: !loadedTabs.has("notifications") ? (
                <Box padding={{ vertical: "l" }} textAlign="center"><Spinner /> Loading...</Box>
              ) : (
                <SpaceBetween size="xs">
                  {notificationSettings.length === 0 ? (
                    <Box color="text-status-inactive">No notification settings available</Box>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0", alignItems: "center" }}>
                        <Box color="text-body-secondary" fontSize="body-s" padding={{ bottom: "xs" }}>Category</Box>
                        <Box color="text-body-secondary" fontSize="body-s" padding={{ bottom: "xs" }} textAlign="center">Push</Box>
                        <Box color="text-body-secondary" fontSize="body-s" padding={{ bottom: "xs" }} textAlign="center">Email</Box>
                        {notificationSettings.map((cat) => {
                          const pushOpt = cat.options.find((o) => o.channel === "push");
                          const emailOpt = cat.options.find((o) => o.channel === "email");
                          return (
                            <div key={cat.category} style={{ display: "contents" }}>
                              <div style={{ borderTop: "1px solid var(--color-border-divider-default)", padding: "10px 0" }}>
                                <Box variant="awsui-key-label">{cat.name}</Box>
                                <Box color="text-body-secondary" fontSize="body-s">{cat.description}</Box>
                              </div>
                              <div style={{ borderTop: "1px solid var(--color-border-divider-default)", padding: "10px 16px", textAlign: "center" }}>
                                {pushOpt ? (
                                  togglingNotif === `${cat.category}:push` ? <Spinner /> : (
                                  <Toggle
                                    checked={pushOpt.enabled}
                                    onChange={async () => {
                                      const key = `${cat.category}:push`;
                                      setTogglingNotif(key);
                                      try {
                                        await updateNotificationSettings(accountId!, { [cat.category]: { push: !pushOpt.enabled } });
                                        setNotificationSettings((prev) =>
                                          prev.map((c) =>
                                            c.category === cat.category
                                              ? { ...c, options: c.options.map((o) => o.channel === "push" ? { ...o, enabled: !o.enabled } : o) }
                                              : c
                                          )
                                        );
                                      } catch (e) {
                                        setSettingsError(e instanceof Error ? e.message : "Failed to update notification");
                                      } finally {
                                        setTogglingNotif("");
                                      }
                                    }}
                                    disabled={!hasSession || !!togglingNotif}
                                  />
                                  )
                                ) : <Box color="text-status-inactive">—</Box>}
                              </div>
                              <div style={{ borderTop: "1px solid var(--color-border-divider-default)", padding: "10px 16px", textAlign: "center" }}>
                                {emailOpt ? (
                                  togglingNotif === `${cat.category}:email` ? <Spinner /> : (
                                  <Toggle
                                    checked={emailOpt.enabled}
                                    onChange={async () => {
                                      const key = `${cat.category}:email`;
                                      setTogglingNotif(key);
                                      try {
                                        await updateNotificationSettings(accountId!, { [cat.category]: { email: !emailOpt.enabled } });
                                        setNotificationSettings((prev) =>
                                          prev.map((c) =>
                                            c.category === cat.category
                                              ? { ...c, options: c.options.map((o) => o.channel === "email" ? { ...o, enabled: !o.enabled } : o) }
                                              : c
                                          )
                                        );
                                      } catch (e) {
                                        setSettingsError(e instanceof Error ? e.message : "Failed to update notification");
                                      } finally {
                                        setTogglingNotif("");
                                      }
                                    }}
                                    disabled={!hasSession || !!togglingNotif}
                                  />
                                  )
                                ) : <Box color="text-status-inactive">—</Box>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: "codex",
              label: "Codex",
              content: !loadedTabs.has("codex") ? (
                <Box padding={{ vertical: "l" }} textAlign="center"><Spinner /> Loading...</Box>
              ) : (
                <Box padding={{ top: "m" }}>
                <SpaceBetween size="l">
                  {codexSettingsError && <Alert type="warning">{codexSettingsError}</Alert>}
                  {!codexSettings && !codexSettingsError && (
                    <Box color="text-status-inactive">No Codex settings available</Box>
                  )}
                  {codexSettings && (codexSettings.custom_instructions || "") !== (codexSettingsOriginal?.custom_instructions || "") && (
                    <Alert
                      type="info"
                      action={
                        <SpaceBetween direction="horizontal" size="xs">
                          <Button
                            variant="normal"
                            onClick={() => setCodexSettings({ ...codexSettings, custom_instructions: codexSettingsOriginal?.custom_instructions || null })}
                          >
                            Discard
                          </Button>
                          <Button
                            variant="primary"
                            loading={updatingCodex === "custom_instructions"}
                            onClick={async () => {
                              setUpdatingCodex("custom_instructions");
                              try {
                                const res = await updateCodexSettings(accountId!, { custom_instructions: codexSettings.custom_instructions || "" });
                                setCodexSettings(res);
                                setCodexSettingsOriginal(res);
                              } catch (e) {
                                setSettingsError(e instanceof Error ? e.message : "Failed to update custom instructions");
                              } finally {
                                setUpdatingCodex("");
                              }
                            }}
                          >
                            Save
                          </Button>
                        </SpaceBetween>
                      }
                    >
                      You have unsaved changes to custom instructions.
                    </Alert>
                  )}
                  {codexSettings && (
                    <FormField
                      label="Custom instructions"
                      description="Custom instructions are used to customize the behavior of the Codex model."
                    >
                      <Textarea
                        value={codexSettings.custom_instructions || ""}
                        onChange={({ detail }) => setCodexSettings({ ...codexSettings, custom_instructions: detail.value || null })}
                        placeholder="Example: Run tests and linters for every code change but not when changing code comments or documentation"
                        rows={4}
                        disabled={!hasSession || updatingCodex === "custom_instructions"}
                      />
                    </FormField>
                  )}
                  {codexSettings && (
                    <FormField label="Diff display format">
                      <Select
                        selectedOption={{ label: codexSettings.git_diff_mode === "split" ? "Split" : "Unified", value: codexSettings.git_diff_mode }}
                        onChange={async ({ detail }) => {
                          const val = detail.selectedOption.value!;
                          setUpdatingCodex("git_diff_mode");
                          try {
                            const res = await updateCodexSettings(accountId!, { git_diff_mode: val });
                            setCodexSettings(res);
                          } catch (e) {
                            setSettingsError(e instanceof Error ? e.message : "Failed to update diff format");
                          } finally {
                            setUpdatingCodex("");
                          }
                        }}
                        options={[
                          { label: "Split", value: "split" },
                          { label: "Unified", value: "unified" },
                        ]}
                        disabled={!hasSession || updatingCodex === "git_diff_mode"}
                      />
                    </FormField>
                  )}
                  {codexSettings && codexSettings.branch_format !== (codexSettingsOriginal?.branch_format || "") && (
                    <Alert
                      type="info"
                      action={
                        <SpaceBetween direction="horizontal" size="xs">
                          <Button
                            variant="normal"
                            onClick={() => setCodexSettings({ ...codexSettings, branch_format: codexSettingsOriginal?.branch_format || "" })}
                          >
                            Discard
                          </Button>
                          <Button
                            variant="primary"
                            loading={updatingCodex === "branch_format"}
                            onClick={async () => {
                              setUpdatingCodex("branch_format");
                              try {
                                const res = await updateCodexSettings(accountId!, { branch_format: codexSettings.branch_format });
                                setCodexSettings(res);
                                setCodexSettingsOriginal(res);
                              } catch (e) {
                                setSettingsError(e instanceof Error ? e.message : "Failed to update branch format");
                              } finally {
                                setUpdatingCodex("");
                              }
                            }}
                          >
                            Save
                          </Button>
                        </SpaceBetween>
                      }
                    >
                      You have unsaved changes to branch format.
                    </Alert>
                  )}
                  {codexSettings && (
                    <FormField
                      label="Branch format"
                      description={`Example: codex/unit-tests-for-feature — Tags: {feature}, {date}, {time}`}
                    >
                      <Input
                        value={codexSettings.branch_format}
                        onChange={({ detail }) => setCodexSettings({ ...codexSettings, branch_format: detail.value })}
                        disabled={!hasSession || updatingCodex === "branch_format"}
                      />
                    </FormField>
                  )}
                  {codexSettings && (
                    <FormField
                      label="Include environments"
                      description="Allow additional context from your Codex environments to help improve our models."
                    >
                      {(() => {
                        const inner = (chatgptSettings as Record<string, unknown> | null)?.settings as Record<string, unknown> | undefined;
                        const val = !!inner?.codex_training_allowed_v2;
                        return (
                          <Toggle
                            checked={val}
                            onChange={() => handleToggleSetting("codex_training_allowed_v2", val)}
                            disabled={togglingFeature === "codex_training_allowed_v2" || !hasSession}
                          >
                            {togglingFeature === "codex_training_allowed_v2" ? <Spinner /> : val ? "Enabled" : "Disabled"}
                          </Toggle>
                        );
                      })()}
                    </FormField>
                  )}
                </SpaceBetween>
                </Box>
              ),
            },
          ]} />
        </Container>

        <SpaceBetween size="m">
          <Container header={<Header variant="h2">Billing</Header>}>
            {hasSession && !subscriptionData ? (
              <Box padding={{ vertical: "m" }} textAlign="center"><Spinner /> Loading billing...</Box>
            ) : (() => {
              const sub = subscriptionData as Record<string, unknown> | null;
              const rawPlan = sub?.subscription_plan as string || account.plan || "Unknown";
              const plan = (() => {
                const lower = rawPlan.toLowerCase().replace(/[^a-z]/g, "");
                if (lower.includes("free")) return "Free";
                if (lower.includes("plus")) return "Plus";
                if (lower.includes("pro")) return "Pro";
                if (lower.includes("team")) return "Team";
                if (lower.includes("enterprise")) return "Enterprise";
                return rawPlan;
              })();
              const status = (() => {
                if (sub?.has_active_subscription === true) return "Active";
                if (sub?.has_active_subscription === false) return "Inactive";
                if (plan !== "Unknown" && plan !== "Free") return "Active";
                if (plan === "Free") return "Free";
                return "Unknown";
              })();
              const platformRaw = (() => {
                if (accountCheckData) {
                  const accounts = accountCheckData.accounts as Record<string, Record<string, unknown>> | undefined;
                  const ordering = accountCheckData.account_ordering as string[] | undefined;
                  if (accounts && ordering?.[0]) {
                    const acct = accounts[ordering[0]];
                    const lastSub = acct?.last_active_subscription as Record<string, unknown> | undefined;
                    return lastSub?.purchase_origin_platform as string | undefined;
                  }
                }
                return sub?.purchase_origin_platform as string | undefined;
              })();
              const platform = (() => {
                if (!platformRaw) return undefined;
                const map: Record<string, string> = {
                  chatgpt_mobile_android: "Android",
                  chatgpt_mobile_ios: "iOS",
                  chatgpt_mobile_apple: "iOS",
                  apple: "iOS (Apple)",
                  stripe: "Web (Stripe)",
                  google_play: "Android (Google Play)",
                };
                return map[platformRaw] || platformRaw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
              })();
              const billingPeriod = sub?.billing_period as string;
              const currency = sub?.subscription_pricing_currency as string;
              const autoRenew = sub?.will_renew;
              const expires = sub?.subscription_expires_at_timestamp as number;
              const formatDate = (ts: unknown) => {
                if (!ts) return "—";
                if (typeof ts === "number") return new Date(ts * 1000).toLocaleDateString();
                if (typeof ts === "string") return new Date(ts).toLocaleDateString();
                return "—";
              };

              return (
                <SpaceBetween size="xxs">
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Box color="text-body-secondary">Plan</Box>
                    <Box fontWeight="bold">{plan}</Box>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Box color="text-body-secondary">Status</Box>
                    <StatusIndicator type={status === "Active" ? "success" : status === "Inactive" ? "error" : "info"}>{status}</StatusIndicator>
                  </div>
                  {platform && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <Box color="text-body-secondary">Platform</Box>
                      <Box>{platform}</Box>
                    </div>
                  )}
                  {billingPeriod && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <Box color="text-body-secondary">Billing Period</Box>
                      <Box>{billingPeriod}</Box>
                    </div>
                  )}
                  {currency && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <Box color="text-body-secondary">Currency</Box>
                      <Box>{currency.toUpperCase()}</Box>
                    </div>
                  )}
                  {autoRenew !== undefined && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <Box color="text-body-secondary">Auto Renew</Box>
                      <Box>{autoRenew ? "Yes" : "No"}</Box>
                    </div>
                  )}
                  {expires && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <Box color="text-body-secondary">Expires</Box>
                      <Box>{formatDate(expires)}</Box>
                    </div>
                  )}
                  {!sub && <Box color="text-status-inactive">No subscription data</Box>}
                  {sub && (
                    <Box padding={{ top: "s" }}>
                      <Button
                        variant="primary"
                        iconName="external"
                        iconAlign="right"
                        disabled={!hasSession || !platformRaw || ["chatgpt_mobile_android", "chatgpt_mobile_ios", "chatgpt_mobile_apple", "apple", "google_play"].includes(platformRaw)}
                        onClick={() => setPortalConfirmVisible(true)}
                      >
                        Manage billing on Stripe
                      </Button>
                      {platformRaw && ["chatgpt_mobile_android", "chatgpt_mobile_ios", "chatgpt_mobile_apple", "apple", "google_play"].includes(platformRaw) && (
                        <Box color="text-body-secondary" fontSize="body-s" padding={{ top: "xs" }}>
                          Billing is managed through {platform}. Stripe portal is not available.
                        </Box>
                      )}
                    </Box>
                  )}
                </SpaceBetween>
              );
            })()}
          </Container>

          <Container header={<Header variant="h2">Mailbox</Header>}>
            <SpaceBetween size="s">
              <div>
                {boundMailbox
                  ? <SpaceBetween direction="horizontal" size="xs">
                      <StatusIndicator type="success">{boundMailbox.email}</StatusIndicator>
                      <Button variant="inline-link" iconName="external" onClick={() => setMailViewerVisible(true)}>Open</Button>
                    </SpaceBetween>
                  : <Box color="text-status-inactive">None</Box>}
              </div>
              <SpaceBetween direction="horizontal" size="xs">
                <div style={{ minWidth: 200 }}>
                  <Select
                    selectedOption={selectedMailbox}
                    onChange={({ detail }) => setSelectedMailbox(detail.selectedOption as { label: string; value: string })}
                    options={mailboxOptions}
                    placeholder="Select a mailbox"
                    onFocus={loadMailboxes}
                  />
                </div>
                <Button onClick={handleBindMailbox} loading={bindingMailbox}>
                  {selectedMailbox?.value ? "Bind" : "Unbind"}
                </Button>
              </SpaceBetween>
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </Grid>

      <Container header={<Header variant="h2">Session Data</Header>}>
        {account.session_token ? (
          <div style={{ overflow: "hidden" }}>
            <Box variant="code">
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 400, overflow: "auto", margin: 0, fontSize: 13 }}>
                {(() => { try { return JSON.stringify(JSON.parse(account.session_token), null, 2); } catch { return account.session_token; } })()}
              </pre>
            </Box>
          </div>
        ) : (
          <Box color="text-status-inactive">No session data</Box>
        )}
      </Container>

      <Container header={<Header variant="h2">Danger Zone</Header>}>
        <Button variant="normal" onClick={() => setDeleteVisible(true)}>
          Delete Account
        </Button>
      </Container>
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description="ChatGPT Account"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => navigate("/")} variant="link">← Accounts</Button>
            <Button iconName="refresh" loading={refreshing} onClick={handleRefresh} />
          </SpaceBetween>
        }
      >
        {account.email}
      </Header>

      {error && <Alert type="error" dismissible onDismiss={() => setError("")}>{error}</Alert>}

      {!hasSession && (
        <Alert
          type="warning"
          action={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => navigate("/workflows/login")}>Re-login</Button>
              <Button onClick={() => setDeleteVisible(true)}>Delete Account</Button>
            </SpaceBetween>
          }
        >
          Unauthorized — this account has no active session. Re-login or delete it.
        </Alert>
      )}

      <Tabs
        onChange={({ detail }) => {
          if (detail.activeTabId === "codex" && usageData.length === 0 && !usageLoading) {
            loadUsage(usageRange, usageGroupBy);
          }
        }}
        tabs={[
        { label: "Overview", id: "overview", content: overviewTab },
        { label: "Actions", id: "actions", content: actionsTab },
        { label: "Codex", id: "codex", content: (
          <SpaceBetween size="l">
            <Header variant="h2">Codex Analytics</Header>

            <Box variant="h3">Balance</Box>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <Container>
                <SpaceBetween size="m">
                  <Box color="text-body-secondary" fontSize="body-s">5 hour usage limit</Box>
                  <Box fontSize="heading-xl" fontWeight="bold">
                    {Math.max(0, 100 - account.codex_5h_used)}% <Box display="inline" fontSize="body-m" fontWeight="normal" color="text-body-secondary">remaining</Box>
                  </Box>
                  <div style={{ width: "100%", height: 14, background: "#e9ebed", borderRadius: 7, overflow: "hidden" }}>
                    <div style={{
                      width: `${Math.max(0, 100 - account.codex_5h_used)}%`,
                      height: "100%",
                      background: "#10a37f",
                      borderRadius: 7,
                      transition: "width 0.3s ease",
                    }} />
                  </div>
                  <Box color="text-body-secondary" fontSize="body-s">
                    {account.codex_5h_reset_min > 0 && account.codex_5h_reset_min < 10080
                      ? `Resets ${formatResetMin(account.codex_5h_reset_min)}`
                      : "\u00A0"}
                  </Box>
                </SpaceBetween>
              </Container>
              <Container>
                <SpaceBetween size="m">
                  <Box color="text-body-secondary" fontSize="body-s">Weekly usage limit</Box>
                  {(() => {
                    const isFree = !account.plan || account.plan.toLowerCase() === "free" || (account.codex_weekly_used === 0 && account.codex_weekly_reset_hours === 0 && weeklyRemaining === 100);
                    return isFree ? (
                      <>
                        <Box fontSize="heading-xl" fontWeight="bold">
                          — <Box display="inline" fontSize="body-m" fontWeight="normal" color="text-body-secondary">no limit</Box>
                        </Box>
                        <div style={{ width: "100%", height: 14, background: "#e9ebed", borderRadius: 7 }} />
                        <Box color="text-body-secondary" fontSize="body-s">Free plan has no weekly limit</Box>
                      </>
                    ) : (
                      <>
                        <Box fontSize="heading-xl" fontWeight="bold">
                          {weeklyRemaining}% <Box display="inline" fontSize="body-m" fontWeight="normal" color="text-body-secondary">remaining</Box>
                        </Box>
                        <div style={{ width: "100%", height: 14, background: "#e9ebed", borderRadius: 7, overflow: "hidden" }}>
                          <div style={{
                            width: `${weeklyRemaining}%`,
                            height: "100%",
                            background: "#10a37f",
                            borderRadius: 7,
                            transition: "width 0.3s ease",
                          }} />
                        </div>
                        <Box color="text-body-secondary" fontSize="body-s">
                          {account.codex_weekly_reset_hours > 0
                            ? `Resets ${formatResetHours(account.codex_weekly_reset_hours)}`
                            : "\u00A0"}
                        </Box>
                      </>
                    );
                  })()}
                </SpaceBetween>
              </Container>
            </div>

            <Container>
              <SpaceBetween size="m">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Box color="text-body-secondary" fontSize="body-s">Credits remaining</Box>
                  <Button variant="inline-icon" iconName="add-plus" onClick={() => setCreditsModalVisible(true)} />
                </div>
                <Box fontSize="heading-xl" fontWeight="bold">0</Box>
                <Box color="text-body-secondary" fontSize="body-s">Use credits to send messages beyond your plan limit</Box>
              </SpaceBetween>
            </Container>

            <Container
              header={
                <Header
                  variant="h2"
                  actions={
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "inline-flex", borderRadius: 8, overflow: "hidden", border: "2px solid #d5dbdb", background: "#fafafa" }}>
                        {(["7d", "1m", "custom"] as const).map((r) => (
                          <button
                            key={r}
                            onClick={() => {
                              setUsageRange(r);
                              if (r !== "custom") loadUsage(r, usageGroupBy);
                            }}
                            style={{
                              padding: "5px 16px",
                              fontSize: 13,
                              border: "none",
                              cursor: "pointer",
                              fontWeight: usageRange === r ? 700 : 400,
                              background: usageRange === r ? "#0972d3" : "transparent",
                              color: usageRange === r ? "#ffffff" : "#545b64",
                              borderRadius: usageRange === r ? 6 : 0,
                              transition: "all 0.15s ease",
                              lineHeight: "20px",
                              letterSpacing: "0.01em",
                            }}
                            onMouseEnter={(e) => { if (usageRange !== r) e.currentTarget.style.background = "#e9ebed"; }}
                            onMouseLeave={(e) => { if (usageRange !== r) e.currentTarget.style.background = "transparent"; }}
                          >
                            {r === "7d" ? "7D" : r === "1m" ? "1M" : "Custom"}
                          </button>
                        ))}
                      </div>
                      {usageRange === "custom" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 150 }}>
                            <DatePicker
                              value={usageCustomStart}
                              onChange={({ detail }) => setUsageCustomStart(detail.value)}
                              placeholder="YYYY/MM/DD"
                              previousMonthAriaLabel="Previous month"
                              nextMonthAriaLabel="Next month"
                              todayAriaLabel="Today"
                            />
                          </div>
                          <Box color="text-body-secondary" fontSize="body-s">—</Box>
                          <div style={{ width: 150 }}>
                            <DatePicker
                              value={usageCustomEnd}
                              onChange={({ detail }) => setUsageCustomEnd(detail.value)}
                              placeholder="YYYY/MM/DD"
                              previousMonthAriaLabel="Previous month"
                              nextMonthAriaLabel="Next month"
                              todayAriaLabel="Today"
                            />
                          </div>
                          <Button
                            variant="primary"
                            onClick={() => loadUsage("custom", usageGroupBy, usageCustomStart, usageCustomEnd)}
                            disabled={!usageCustomStart || !usageCustomEnd}
                          >
                            Apply
                          </Button>
                        </div>
                      )}
                      <Select
                        selectedOption={{ label: `Group by: ${usageGroupBy === "day" ? "Day" : "Week"}`, value: usageGroupBy }}
                        onChange={({ detail }) => {
                          const val = detail.selectedOption.value as "day" | "week";
                          setUsageGroupBy(val);
                          loadUsage(usageRange, val, usageCustomStart, usageCustomEnd);
                        }}
                        options={[
                          { label: "Group by: Day", value: "day" },
                          { label: "Group by: Week", value: "week" },
                        ]}
                      />
                    </div>
                  }
                >
                  Usage breakdown
                </Header>
              }
            >
              <SpaceBetween size="m">
                {usageLoading ? (
                  <Box padding={{ vertical: "l" }} textAlign="center"><Spinner /> Loading usage data...</Box>
                ) : usageData.length === 0 ? (
                  <Box padding={{ vertical: "l" }} textAlign="center" color="text-status-inactive">No usage data available. Click a range to load.</Box>
                ) : (
                  <>
                    <Box fontWeight="bold" margin={{ bottom: "s" }}>Personal usage</Box>
                    {(() => {
                      const chartData = usageData.map((d) => {
                        const vals = d.product_surface_usage_values;
                        const total = Object.values(vals).reduce((s, v) => s + v, 0);
                        const dateObj = new Date(d.date + "T00:00:00");
                        const label = dateObj.toLocaleDateString([], { month: "short", day: "numeric" });
                        return { date: d.date, label, total, surfaces: vals };
                      });
                      const labelInterval = Math.max(1, Math.ceil(chartData.length / 7));

                      const surfaceColors: Record<string, string> = {
                        cli: "#10a37f",
                        vscode: "#007acc",
                        web: "#f59e0b",
                        jetbrains: "#fc801d",
                        github: "#24292e",
                        github_code_review: "#6e5494",
                        desktop_app: "#0ea5e9",
                        slack: "#4a154b",
                        linear: "#5e6ad2",
                        sdk: "#059669",
                        exec: "#dc2626",
                        unknown: "#6e6e80",
                      };

                      const formatSurfaceName = (s: string) =>
                        s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

                      const activeSurfaces = new Set<string>();
                      for (const d of chartData) {
                        for (const [k, v] of Object.entries(d.surfaces)) {
                          if (v > 0) activeSurfaces.add(k);
                        }
                      }

                      const yTicks = [0, 25, 50, 75, 100];
                      const chartHeight = 220;

                      const getBarSegments = (surfaces: Record<string, number>) => {
                        const entries = Object.entries(surfaces).filter(([, v]) => v > 0);
                        entries.sort((a, b) => b[1] - a[1]);
                        return entries;
                      };

                      return (
                        <div>
                          <div style={{ display: "flex" }}>
                            <div style={{ width: 40, flexShrink: 0, position: "relative", height: chartHeight, marginRight: 4 }}>
                              {yTicks.map((tick) => (
                                <div
                                  key={tick}
                                  style={{
                                    position: "absolute",
                                    bottom: `${(tick / 100) * chartHeight - 7}px`,
                                    right: 4,
                                    fontSize: 11,
                                    color: "#687078",
                                    lineHeight: "14px",
                                  }}
                                >
                                  {tick}%
                                </div>
                              ))}
                            </div>

                            <div style={{ flex: 1, position: "relative", height: chartHeight }}>
                              {yTicks.map((tick) => (
                                <div
                                  key={tick}
                                  style={{
                                    position: "absolute",
                                    bottom: `${(tick / 100) * 100}%`,
                                    left: 0,
                                    right: 0,
                                    borderBottom: tick === 0 ? "1px solid #d5dbdb" : "1px dashed #e9ebed",
                                    zIndex: 0,
                                  }}
                                />
                              ))}

                              <div style={{
                                display: "flex",
                                alignItems: "flex-end",
                                height: "100%",
                                gap: 2,
                                position: "relative",
                                zIndex: 1,
                                justifyContent: chartData.length <= 10 ? "flex-start" : "stretch",
                                paddingLeft: chartData.length <= 10 ? 4 : 0,
                              }}>
                                {chartData.map((d) => {
                                  const segments = getBarSegments(d.surfaces);
                                  const tooltipLines = segments.map(([k, v]) => `${formatSurfaceName(k)}: ${v.toFixed(1)}%`);
                                  const tooltipText = `${d.label}\n${tooltipLines.join("\n")}\nTotal: ${d.total.toFixed(1)}%`;

                                  return (
                                    <div
                                      key={d.date}
                                      title={tooltipText}
                                      style={{
                                        flex: chartData.length <= 10 ? "0 0 auto" : 1,
                                        width: chartData.length <= 10 ? 40 : undefined,
                                        maxWidth: 40,
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "flex-end",
                                        alignItems: "center",
                                        height: "100%",
                                        cursor: d.total > 0 ? "pointer" : "default",
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: "100%",
                                          maxWidth: 36,
                                          minWidth: 6,
                                          height: d.total > 0 ? `${Math.max((d.total / 100) * 100, 2)}%` : 0,
                                          borderRadius: "4px 4px 0 0",
                                          transition: "height 0.3s ease, opacity 0.15s ease",
                                          overflow: "hidden",
                                          display: "flex",
                                          flexDirection: "column-reverse",
                                        }}
                                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7"; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                                      >
                                        {segments.map(([surface, value]) => (
                                          <div
                                            key={surface}
                                            style={{
                                              width: "100%",
                                              flexGrow: value,
                                              flexShrink: 0,
                                              flexBasis: 0,
                                              minHeight: value > 0 ? 2 : 0,
                                              background: surfaceColors[surface] || "#6e6e80",
                                            }}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", marginLeft: 44, gap: 2 }}>
                            {chartData.map((d, i) => (
                              <div
                                key={d.date}
                                style={{
                                  flex: chartData.length <= 10 ? "0 0 auto" : 1,
                                  width: chartData.length <= 10 ? 40 : undefined,
                                  maxWidth: 40,
                                  textAlign: "center",
                                  paddingTop: 6,
                                }}
                              >
                                {i % labelInterval === 0 || i === chartData.length - 1 ? (
                                  <span style={{ fontSize: 11, color: "#687078", whiteSpace: "nowrap" }}>{d.label}</span>
                                ) : null}
                              </div>
                            ))}
                          </div>

                          {activeSurfaces.size > 0 && (
                            <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid #e9ebed", display: "flex", flexWrap: "wrap", gap: 16 }}>
                              {[...activeSurfaces].map((s) => (
                                <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <div style={{ width: 12, height: 3, background: surfaceColors[s] || "#6e6e80", borderRadius: 1.5 }} />
                                  <span style={{ fontSize: 12, color: "#545b64" }}>{formatSurfaceName(s)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                )}
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        ) },
        { label: "Settings", id: "settings", content: settingsTab },
      ]} />

      <Modal
        visible={!!disconnectConfirmApp}
        onDismiss={() => setDisconnectConfirmApp(null)}
        header={<Header variant="h2">Disconnect Application</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDisconnectConfirmApp(null)}>Cancel</Button>
              <Button
                variant="primary"
                loading={disconnectingApp === disconnectConfirmApp?.id}
                onClick={async () => {
                  if (!disconnectConfirmApp) return;
                  await handleDisconnectApp(disconnectConfirmApp.id);
                  setDisconnectConfirmApp(null);
                }}
              >
                Disconnect
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box>{disconnectConfirmApp?.name}을(를) 연결 해제하시겠습니까?</Box>
          <Alert type="warning">이 앱은 더 이상 ChatGPT 계정에 접근할 수 없게 됩니다.</Alert>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={ageVerifyModalVisible}
        onDismiss={() => { setAgeVerifyModalVisible(false); setAgeVerifyInquiry(null); }}
        header={<Header variant="h2">Age Verification</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => { setAgeVerifyModalVisible(false); setAgeVerifyInquiry(null); }}>Close</Button>
              {ageVerifyInquiry?.url && (
                <Button variant="primary" iconName="external" iconAlign="right" onClick={() => window.open(ageVerifyInquiry!.url, "_blank")}>
                  Open Verification
                </Button>
              )}
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {ageVerifyInquiry ? (
            <SpaceBetween size="s">
              <Alert type="info">새 탭에서 인증 페이지를 열어 본인 인증을 완료하세요.</Alert>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Box color="text-body-secondary">Status</Box>
                <Box>{ageVerifyInquiry.status}</Box>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Box color="text-body-secondary">URL</Box>
                <Box fontSize="body-s"><a href={ageVerifyInquiry.url} target="_blank" rel="noopener noreferrer">{ageVerifyInquiry.url}</a></Box>
              </div>
            </SpaceBetween>
          ) : (
            <Alert type="info">인증 요청을 처리 중입니다...</Alert>
          )}
        </SpaceBetween>
      </Modal>

      <Modal
        visible={portalConfirmVisible}
        onDismiss={() => setPortalConfirmVisible(false)}
        header={<Header variant="h2">Open Stripe Billing Portal</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setPortalConfirmVisible(false)}>Cancel</Button>
              <Button
                variant="primary"
                iconName="external"
                iconAlign="right"
                loading={portalLoading}
                onClick={async () => {
                  setPortalLoading(true);
                  try {
                    const portal = await fetchCustomerPortal(accountId!);
                    if (portal.url) window.open(portal.url, "_blank");
                    setPortalConfirmVisible(false);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to open billing portal");
                  } finally {
                    setPortalLoading(false);
                  }
                }}
              >
                Open Stripe
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box>Stripe 결제 포털을 외부 브라우저에서 열겠습니까?</Box>
          <Alert type="warning">결제 정보 변경, 구독 취소 등 민감한 작업이 가능합니다. 신중하게 진행하세요.</Alert>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={creditsModalVisible}
        onDismiss={() => setCreditsModalVisible(false)}
        header="Buy more messages"
        footer={
          <Box float="right">
            <Button variant="link" onClick={() => setCreditsModalVisible(false)}>Close</Button>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Alert type="warning">This feature is not yet supported. Credit purchases will be available in a future update.</Alert>
          <FormField label="Credits">
            <Input
              value={creditsAmount}
              inputMode="numeric"
              placeholder="1000"
              disabled
            />
          </FormField>
          {creditsAmount && parseInt(creditsAmount) > 0 && (
            <Container>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                <Box>{parseInt(creditsAmount).toLocaleString()} credits</Box>
                <Box fontWeight="bold">${(parseInt(creditsAmount) * AMOUNT_PER_CREDIT).toFixed(2)}</Box>
              </div>
            </Container>
          )}
          <Box color="text-body-secondary" fontSize="body-s">Rate: ${AMOUNT_PER_CREDIT} per credit</Box>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={deleteVisible}
        onDismiss={() => setDeleteVisible(false)}
        header="Delete Account"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDeleteVisible(false)}>Cancel</Button>
              <Button variant="primary" loading={deleting} onClick={handleDelete}>Delete</Button>
            </SpaceBetween>
          </Box>
        }
      >
        Are you sure you want to delete <b>{account.email}</b>? This action cannot be undone.
      </Modal>

      <Modal
        visible={bindWarningVisible}
        onDismiss={() => setBindWarningVisible(false)}
        header="Mailbox Mismatch"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setBindWarningVisible(false)}>Cancel</Button>
              <Button variant="primary" onClick={async () => {
                setBindWarningVisible(false);
                await doBind(pendingBindId);
                setPendingBindId(null);
              }}>Bind Anyway</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Alert type="warning">
          The selected mailbox email does not match this account's email (<b>{account.email}</b>).
          Auto OTP verification during login or Codex OAuth may not work correctly with a mismatched mailbox.
        </Alert>
      </Modal>

      <Modal
        visible={modelImprovementVisible}
        onDismiss={() => setModelImprovementVisible(false)}
        header="Model improvement"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={() => setModelImprovementVisible(false)}>Done</Button>
          </Box>
        }
      >
        {(() => {
          const inner = (chatgptSettings as Record<string, unknown> | null)?.settings as Record<string, unknown> | undefined;
          return (
            <SpaceBetween size="l">
              <FormField
                label="Improve the model for everyone"
                description="Allow your content to be used to train our models, which makes ChatGPT better for you and everyone who uses it. We take steps to protect your privacy."
              >
                <Toggle
                  checked={!!inner?.training_allowed}
                  onChange={() => handleToggleSetting("training_allowed", !!inner?.training_allowed)}
                  disabled={togglingFeature === "training_allowed" || !hasSession}
                >
                  {inner?.training_allowed ? "Enabled" : "Disabled"} {togglingFeature === "training_allowed" && <Spinner />}
                </Toggle>
              </FormField>
              <Header variant="h3">Voice</Header>
              <FormField label="Include your audio recordings">
                <Toggle
                  checked={!!inner?.voice_training_allowed}
                  onChange={() => handleToggleSetting("voice_training_allowed", !!inner?.voice_training_allowed)}
                  disabled={togglingFeature === "voice_training_allowed" || !hasSession}
                >
                  {inner?.voice_training_allowed ? "Enabled" : "Disabled"} {togglingFeature === "voice_training_allowed" && <Spinner />}
                </Toggle>
              </FormField>
              <FormField
                label="Include your video recordings"
                description="Include your audio and video recordings from Voice Mode to train our models. Transcripts and other files are covered by &quot;Improve the model for everyone.&quot;"
              >
                <Toggle
                  checked={!!inner?.video_training_allowed}
                  onChange={() => handleToggleSetting("video_training_allowed", !!inner?.video_training_allowed)}
                  disabled={togglingFeature === "video_training_allowed" || !hasSession}
                >
                  {inner?.video_training_allowed ? "Enabled" : "Disabled"} {togglingFeature === "video_training_allowed" && <Spinner />}
                </Toggle>
              </FormField>
            </SpaceBetween>
          );
        })()}
      </Modal>

      <Modal
        visible={remoteBrowserDataVisible}
        onDismiss={() => setRemoteBrowserDataVisible(false)}
        header="Remote browser data"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={() => setRemoteBrowserDataVisible(false)}>Done</Button>
          </Box>
        }
      >
        {(() => {
          const inner = (chatgptSettings as Record<string, unknown> | null)?.settings as Record<string, unknown> | undefined;
          return (
            <SpaceBetween size="l">
              <FormField
                label="Remember site data between sessions"
                description="Let agent mode's remote browser reuse cookies between sessions."
              >
                <Toggle
                  checked={!!inner?.enable_remote_browser_data}
                  onChange={() => handleToggleSetting("enable_remote_browser_data", !!inner?.enable_remote_browser_data)}
                  disabled={togglingFeature === "enable_remote_browser_data" || !hasSession}
                >
                  {inner?.enable_remote_browser_data ? "Enabled" : "Disabled"} {togglingFeature === "enable_remote_browser_data" && <Spinner />}
                </Toggle>
              </FormField>
              <FormField label="Remote browser data">
                <Button
                  variant="normal"
                  loading={deletingBrowserContext}
                  onClick={async () => {
                    if (!accountId) return;
                    setDeletingBrowserContext(true);
                    try {
                      await deleteBrowserContext(accountId);
                    } catch (e) {
                      setSettingsError(e instanceof Error ? e.message : "Failed to delete browser context");
                    } finally {
                      setDeletingBrowserContext(false);
                    }
                  }}
                >
                  <span style={{ color: "var(--color-text-status-error)" }}>Delete all</span>
                </Button>
              </FormField>
            </SpaceBetween>
          );
        })()}
      </Modal>

      <Modal
        visible={confirmArchiveAll}
        onDismiss={() => setConfirmArchiveAll(false)}
        header="Archive all chats"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmArchiveAll(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={archivingAllChats}
                onClick={async () => {
                  if (!accountId) return;
                  setArchivingAllChats(true);
                  try {
                    await archiveAllChats(accountId);
                    setConfirmArchiveAll(false);
                  } catch (e) {
                    setSettingsError(e instanceof Error ? e.message : "Failed to archive conversations");
                  } finally {
                    setArchivingAllChats(false);
                  }
                }}
              >
                Archive all
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        Are you sure you want to archive all chats? This will move all conversations to the archive.
      </Modal>

      <Modal
        visible={confirmDeleteAll}
        onDismiss={() => setConfirmDeleteAll(false)}
        header="Delete all chats"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmDeleteAll(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={deletingAllChats}
                onClick={async () => {
                  if (!accountId) return;
                  setDeletingAllChats(true);
                  try {
                    await deleteAllConversations(accountId);
                    setConfirmDeleteAll(false);
                  } catch (e) {
                    setSettingsError(e instanceof Error ? e.message : "Failed to delete conversations");
                  } finally {
                    setDeletingAllChats(false);
                  }
                }}
              >
                Delete all
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Alert type="warning">
          Are you sure you want to delete all chats? This action cannot be undone.
        </Alert>
      </Modal>

      <Modal
        visible={archivedChatsVisible}
        onDismiss={() => setArchivedChatsVisible(false)}
        header={`Archived chats (${archivedChats.length})`}
        size="large"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={() => setArchivedChatsVisible(false)}>Done</Button>
          </Box>
        }
      >
        {archivedChatsLoading && <Box><Spinner /> Loading archived chats...</Box>}
        {!archivedChatsLoading && archivedChats.length === 0 && (
          <Box color="text-status-inactive">No archived chats</Box>
        )}
        {!archivedChatsLoading && archivedChats.length > 0 && (
          <SpaceBetween size="xs">
            {archivedChats.map((chat) => (
              <div key={chat.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--color-border-divider-default)" }}>
                <SpaceBetween size="xxs" direction="vertical">
                  <Box fontWeight="bold">{chat.title || "Untitled"}</Box>
                  <Box color="text-body-secondary" fontSize="body-s">{new Date(chat.update_time).toLocaleString()}</Box>
                </SpaceBetween>
                <Button
                  variant="normal"
                  loading={unarchivingChat === chat.id}
                  onClick={async () => {
                    if (!accountId) return;
                    setUnarchivingChat(chat.id);
                    try {
                      await unarchiveConversation(accountId, chat.id);
                      setArchivedChats((prev) => prev.filter((c) => c.id !== chat.id));
                    } catch (e) {
                      setSettingsError(e instanceof Error ? e.message : "Failed to unarchive");
                    } finally {
                      setUnarchivingChat("");
                    }
                  }}
                >
                  Unarchive
                </Button>
              </div>
            ))}
          </SpaceBetween>
        )}
      </Modal>

      {boundMailbox && (
        <MailViewerModal
          visible={mailViewerVisible}
          onDismiss={() => setMailViewerVisible(false)}
          mailboxId={boundMailbox.id}
          mailboxEmail={boundMailbox.email}
        />
      )}
    </SpaceBetween>
  );
}
