import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Select from "@cloudscape-design/components/select";
import {
  fetchSharedAccount,
  fetchSharedCodexUsage,
  refreshSharedAccount,
  fetchSharedMailboxMessages,
  fetchSharedMailboxMessage,
} from "../api/client";

function truncate(value: string, maxLen = 32): string {
  if (!value) return "";
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + "…";
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const d = new Date(value as string);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function getDateRange(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function ValuePair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div>{children}</div>
    </div>
  );
}

interface MailMessage {
  id: string;
  from_addr?: string;
  from?: string;
  subject?: string;
  received_at?: string;
  is_otp?: boolean;
  otp_code?: string;
}

export default function SharedAccountPage() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const [codexUsage, setCodexUsage] = useState<Record<string, unknown> | null>(null);
  const [codexLoading, setCodexLoading] = useState(false);
  const [codexError, setCodexError] = useState("");
  const [codexLoaded, setCodexLoaded] = useState(false);

  const [usageData, setUsageData] = useState<{ date: string; product_surface_usage_values: Record<string, number> }[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageRange, setUsageRange] = useState<"7d" | "1m">("7d");
  const [usageGroupBy, setUsageGroupBy] = useState<"day" | "week">("day");

  const [mailMessages, setMailMessages] = useState<MailMessage[]>([]);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailError, setMailError] = useState("");
  const [mailLoaded, setMailLoaded] = useState(false);

  const [mailDetailLoading, setMailDetailLoading] = useState(false);
  const [mailDetail, setMailDetail] = useState<Record<string, unknown> | null>(null);
  const [selectedMailId, setSelectedMailId] = useState("");
  const [copiedOtp, setCopiedOtp] = useState("");

  const handleMailClick = async (mail: MailMessage) => {
    if (!tokenId) return;
    setSelectedMailId(mail.id);
    setMailDetailLoading(true);
    setMailDetail(null);
    try {
      const detail = await fetchSharedMailboxMessage(tokenId, mail.id);
      setMailDetail(detail);
    } catch {
      setMailDetail({ id: mail.id, from_addr: mail.from_addr ?? mail.from, subject: mail.subject, received_at: mail.received_at });
    } finally {
      setMailDetailLoading(false);
    }
  };

  const timeAgo = (dateStr: string) => {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const copyOtp = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedOtp(id);
    setTimeout(() => setCopiedOtp(""), 1500);
  };

  const loadAccount = useCallback(async () => {
    if (!tokenId) return;
    try {
      const result = await fetchSharedAccount(tokenId);
      setData(result);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid or expired share link");
    }
  }, [tokenId]);

  useEffect(() => {
    loadAccount().finally(() => setLoading(false));
  }, [loadAccount]);

  const handleRefresh = async () => {
    if (!tokenId) return;
    setRefreshing(true);
    try {
      await refreshSharedAccount(tokenId);
      await loadAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const loadCodexUsage = useCallback(async () => {
    if (!tokenId || codexLoaded) return;
    setCodexLoading(true);
    setCodexError("");
    try {
      const { start, end } = getDateRange(7);
      const result = await fetchSharedCodexUsage(tokenId, start, end);
      setCodexUsage(result);
      setCodexLoaded(true);
    } catch (e) {
      setCodexError(e instanceof Error ? e.message : "Failed to load codex usage");
    } finally {
      setCodexLoading(false);
    }
  }, [tokenId, codexLoaded]);

  const loadUsage = useCallback(async (range: "7d" | "1m", groupBy: "day" | "week") => {
    if (!tokenId) return;
    setUsageLoading(true);
    try {
      const now = new Date();
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const endDate = fmt(now);
      const startDate = fmt(new Date(now.getTime() - (range === "7d" ? 6 : 29) * 86400_000));
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate, group_by: groupBy });
      const res = await fetch(`http://localhost:8000/api/shared/${tokenId}/codex-usage?${params}`);
      if (!res.ok) throw new Error("Failed to fetch usage breakdown");
      const json = await res.json();
      setUsageData(json.data || []);
    } catch {
      setUsageData([]);
    } finally {
      setUsageLoading(false);
    }
  }, [tokenId]);

  const loadMailMessages = useCallback(async () => {
    if (!tokenId || mailLoaded) return;
    setMailLoading(true);
    setMailError("");
    try {
      const result = await fetchSharedMailboxMessages(tokenId);
      setMailMessages(result as unknown as MailMessage[]);
      setMailLoaded(true);
    } catch (e) {
      setMailError(e instanceof Error ? e.message : "Failed to load mailbox messages");
    } finally {
      setMailLoading(false);
    }
  }, [tokenId, mailLoaded]);

  if (loading) {
    return (
      <Box padding={{ vertical: "xxxl" }} textAlign="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (error && !data) {
    const isNotFound = error.includes("404") || error.toLowerCase().includes("not found");
    const isExpired = error.includes("410") || error.toLowerCase().includes("expired");
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
        <Alert type="error" header={isExpired ? "Link Expired" : isNotFound ? "Not Found" : "Error"}>
          {isExpired
            ? "This share link has expired."
            : isNotFound
              ? "Share link not found or has been revoked."
              : error}
        </Alert>
      </div>
    );
  }

  if (!data) return null;

  const email = String(data.email ?? "");
  const status = String(data.status ?? "unknown");
  const name = String(data.name ?? "—");
  const plan = String(data.plan ?? "—");
  const planExpiry = data.plan_expiry;
  const proxyUrl = String(data.proxy_url ?? "—");
  const createdAt = data.created_at;
  const lastLogin = data.last_login;
  const expiresAt = data.expires_at;

  const includeSession = Boolean(data.include_session);
  const includeMailbox = Boolean(data.include_mailbox);

  const accessToken = data.access_token ? String(data.access_token) : "";
  const sessionToken = data.session_token ? String(data.session_token) : "";
  const codexToken = data.codex_token ? String(data.codex_token) : "";
  const cookies = data.cookies ? String(data.cookies) : "";
  const password = data.password ? String(data.password) : "";

  const mailbox = data.mailbox as Record<string, unknown> | undefined;

  const statusType =
    status === "active" ? "success" : status === "suspended" ? "error" : "info";

  let sessionTokenDisplay = sessionToken;
  if (sessionToken) {
    try {
      const parsed = JSON.parse(sessionToken);
      sessionTokenDisplay = JSON.stringify(parsed);
    } catch {
      sessionTokenDisplay = sessionToken;
    }
  }

  const hasSession = !!accessToken;

  const accountInfoTab = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Account Info</Header>}>
        <ColumnLayout columns={2} variant="text-grid">
          <ValuePair label="Email">{email || "—"}</ValuePair>
          <ValuePair label="Status">
            <StatusIndicator type={statusType}>{status}</StatusIndicator>
          </ValuePair>
          <ValuePair label="Name">{name}</ValuePair>
          <ValuePair label="Plan">{plan}</ValuePair>
          <ValuePair label="Plan Expiry">{formatDate(planExpiry)}</ValuePair>
          <ValuePair label="Proxy URL">{proxyUrl}</ValuePair>
          <ValuePair label="Created At">{formatDate(createdAt)}</ValuePair>
          <ValuePair label="Last Login">{formatDate(lastLogin)}</ValuePair>
        </ColumnLayout>
      </Container>

      {includeSession && (accessToken || sessionToken || codexToken || cookies || password) && (
        <Container header={<Header variant="h2">Session Data</Header>}>
          <SpaceBetween size="m">
            <Alert type="warning">
              Sensitive session data — do not share this information further.
            </Alert>
            <ColumnLayout columns={1}>
              {accessToken && (
                <ValuePair label="Access Token">
                  <SpaceBetween size="xs" direction="horizontal">
                    <Box variant="code">{truncate(accessToken)}</Box>
                    <CopyToClipboard
                      variant="icon"
                      copyButtonAriaLabel="Copy access token"
                      copySuccessText="Copied"
                      copyErrorText="Failed to copy"
                      textToCopy={accessToken}
                    />
                  </SpaceBetween>
                </ValuePair>
              )}
              {sessionToken && (
                <ValuePair label="Session Token">
                  <SpaceBetween size="xs" direction="horizontal">
                    <Box variant="code">{truncate(sessionTokenDisplay)}</Box>
                    <CopyToClipboard
                      variant="icon"
                      copyButtonAriaLabel="Copy session token"
                      copySuccessText="Copied"
                      copyErrorText="Failed to copy"
                      textToCopy={sessionTokenDisplay}
                    />
                  </SpaceBetween>
                </ValuePair>
              )}
              {codexToken && (
                <ValuePair label="Codex Token">
                  <SpaceBetween size="xs" direction="horizontal">
                    <Box variant="code">{truncate(codexToken)}</Box>
                    <CopyToClipboard
                      variant="icon"
                      copyButtonAriaLabel="Copy codex token"
                      copySuccessText="Copied"
                      copyErrorText="Failed to copy"
                      textToCopy={codexToken}
                    />
                  </SpaceBetween>
                </ValuePair>
              )}
              {cookies && (
                <ValuePair label="Cookies">
                  <SpaceBetween size="xs" direction="horizontal">
                    <Box variant="code">{truncate(cookies)}</Box>
                    <CopyToClipboard
                      variant="icon"
                      copyButtonAriaLabel="Copy cookies"
                      copySuccessText="Copied"
                      copyErrorText="Failed to copy"
                      textToCopy={cookies}
                    />
                  </SpaceBetween>
                </ValuePair>
              )}
              {password && (
                <ValuePair label="Password">
                  <SpaceBetween size="xs" direction="horizontal">
                    <Box variant="code">{truncate(password, 20)}</Box>
                    <CopyToClipboard
                      variant="icon"
                      copyButtonAriaLabel="Copy password"
                      copySuccessText="Copied"
                      copyErrorText="Failed to copy"
                      textToCopy={password}
                    />
                  </SpaceBetween>
                </ValuePair>
              )}
            </ColumnLayout>
          </SpaceBetween>
        </Container>
      )}

      {includeMailbox && mailbox && (
        <Container header={<Header variant="h2">Mailbox</Header>}>
          <ColumnLayout columns={2} variant="text-grid">
            <ValuePair label="Mailbox Email">{String(mailbox.email ?? "—")}</ValuePair>
            <ValuePair label="Status">
              <StatusIndicator type={mailbox.status === "active" ? "success" : "info"}>
                {String(mailbox.status ?? "unknown")}
              </StatusIndicator>
            </ValuePair>
          </ColumnLayout>
        </Container>
      )}
    </SpaceBetween>
  );

  const codexUsageTab = (
    <SpaceBetween size="l">
      {!hasSession && (
        <Alert type="info">
          This account has no active session. Codex usage data may not be available.
        </Alert>
      )}
      {codexLoading && (
        <Box padding={{ vertical: "l" }} textAlign="center">
          <Spinner size="large" />
        </Box>
      )}
      {codexError && <Alert type="warning">{codexError}</Alert>}
      {codexUsage && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <Container>
              <SpaceBetween size="m">
                <Box color="text-body-secondary" fontSize="body-s">5 hour usage limit</Box>
                <Box fontSize="heading-xl" fontWeight="bold">
                  {Math.max(0, 100 - Number(codexUsage.five_hour_used ?? 0))}%{" "}
                  <Box display="inline" fontSize="body-m" fontWeight="normal" color="text-body-secondary">remaining</Box>
                </Box>
                <div style={{ width: "100%", height: 14, background: "#e9ebed", borderRadius: 7, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.max(0, 100 - Number(codexUsage.five_hour_used ?? 0))}%`,
                    height: "100%",
                    background: "#10a37f",
                    borderRadius: 7,
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </SpaceBetween>
            </Container>
            <Container>
              <SpaceBetween size="m">
                <Box color="text-body-secondary" fontSize="body-s">Weekly usage limit</Box>
                <Box fontSize="heading-xl" fontWeight="bold">
                  {Math.max(0, 100 - Number(codexUsage.weekly_used ?? 0))}%{" "}
                  <Box display="inline" fontSize="body-m" fontWeight="normal" color="text-body-secondary">remaining</Box>
                </Box>
                <div style={{ width: "100%", height: 14, background: "#e9ebed", borderRadius: 7, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.max(0, 100 - Number(codexUsage.weekly_used ?? 0))}%`,
                    height: "100%",
                    background: "#10a37f",
                    borderRadius: 7,
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </SpaceBetween>
            </Container>
          </div>

          <Container
            header={
              <Header
                variant="h2"
                actions={
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", borderRadius: 8, overflow: "hidden", border: "2px solid #d5dbdb", background: "#fafafa" }}>
                      {(["7d", "1m"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => {
                            setUsageRange(r);
                            loadUsage(r, usageGroupBy);
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
                          {r === "7d" ? "7D" : "1M"}
                        </button>
                      ))}
                    </div>
                    <Select
                      selectedOption={{ label: `Group by: ${usageGroupBy === "day" ? "Day" : "Week"}`, value: usageGroupBy }}
                      onChange={({ detail }) => {
                        const val = detail.selectedOption.value as "day" | "week";
                        setUsageGroupBy(val);
                        loadUsage(usageRange, val);
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
                <Box padding={{ vertical: "l" }} textAlign="center" color="text-status-inactive">No usage data available.</Box>
              ) : (
                <>
                  <Box fontWeight="bold" margin={{ bottom: "s" }}>Personal usage</Box>
                  {(() => {
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

                    const chartData = usageData.map((d) => {
                      const vals = d.product_surface_usage_values;
                      const total = Object.values(vals).reduce((s, v) => s + v, 0);
                      const dateObj = new Date(d.date + "T00:00:00");
                      const label = dateObj.toLocaleDateString([], { month: "short", day: "numeric" });
                      return { date: d.date, label, total, surfaces: vals };
                    });
                    const labelInterval = Math.max(1, Math.ceil(chartData.length / 7));

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

          {Array.isArray(codexUsage.buckets) && (codexUsage.buckets as Array<Record<string, unknown>>).length > 0 && (
            <Table
              header={<Header variant="h3">Daily Breakdown</Header>}
              columnDefinitions={[
                { id: "date", header: "Date", cell: (item: Record<string, unknown>) => String(item.date ?? "—") },
                { id: "usage", header: "Usage", cell: (item: Record<string, unknown>) => String(item.usage ?? item.value ?? "0") },
              ]}
              items={codexUsage.buckets as Array<Record<string, unknown>>}
              variant="embedded"
            />
          )}

          {Array.isArray(codexUsage.daily_usage) && (codexUsage.daily_usage as Array<Record<string, unknown>>).length > 0 && (
            <Table
              header={<Header variant="h3">Daily Breakdown</Header>}
              columnDefinitions={[
                { id: "date", header: "Date", cell: (item: Record<string, unknown>) => String(item.date ?? "—") },
                { id: "usage", header: "Usage", cell: (item: Record<string, unknown>) => String(item.usage ?? item.value ?? "0") },
              ]}
              items={codexUsage.daily_usage as Array<Record<string, unknown>>}
              variant="embedded"
            />
          )}
        </>
      )}
      {!codexLoading && !codexError && !codexUsage && (
        <Box padding={{ vertical: "l" }} textAlign="center" color="text-body-secondary">
          No codex usage data available.
        </Box>
      )}
    </SpaceBetween>
  );

  const mailboxTab = (
    <SpaceBetween size="l">
      {!includeMailbox ? (
        <Alert type="info">
          Mailbox access is not included in this share link.
        </Alert>
      ) : (
        <>
          {mailLoading && (
            <Box padding={{ vertical: "l" }} textAlign="center">
              <Spinner size="large" />
            </Box>
          )}
          {mailError && <Alert type="warning">{mailError}</Alert>}
          {mailLoaded && (
            <div style={{ display: "flex", height: "60vh", border: "1px solid #e9ebed", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ width: 380, minWidth: 380, borderRight: "1px solid #e9ebed", overflowY: "auto" }}>
                <div style={{ padding: "8px 12px", borderBottom: "1px solid #e9ebed", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Box color="text-body-secondary" fontSize="body-s">
                    {mailMessages.length} messages
                  </Box>
                  <Button variant="inline-icon" iconName="refresh" onClick={() => { setMailLoaded(false); loadMailMessages(); }} />
                </div>
                {mailMessages.map((mail) => (
                  <div
                    key={mail.id}
                    onClick={() => void handleMailClick(mail)}
                    style={{
                      padding: "10px 12px",
                      cursor: "pointer",
                      borderBottom: "1px solid #f2f3f3",
                      borderLeft: selectedMailId === mail.id ? "3px solid #0972d3" : "3px solid transparent",
                      backgroundColor: selectedMailId === mail.id ? "#f2f8fd" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <Box fontSize="body-s" fontWeight="bold">{mail.from_addr ?? mail.from ?? "—"}</Box>
                      <Box fontSize="body-s" color="text-body-secondary">{timeAgo(mail.received_at ?? "")}</Box>
                    </div>
                    <Box fontSize="body-s" color="text-body-secondary">{mail.subject ?? "—"}</Box>
                    {mail.is_otp && mail.otp_code && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          onClick={(e) => { e.stopPropagation(); copyOtp(mail.otp_code || "", `list-${mail.id}`); }}
                          style={{
                            display: "inline-block",
                            padding: "1px 8px",
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 700,
                            backgroundColor: copiedOtp === `list-${mail.id}` ? "#d1fadf" : "#f0e6ff",
                            color: copiedOtp === `list-${mail.id}` ? "#067647" : "#6941c6",
                            cursor: "pointer",
                          }}
                        >
                          {copiedOtp === `list-${mail.id}` ? "✓ Copied!" : `OTP ${mail.otp_code}`}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                {mailMessages.length === 0 && (
                  <Box textAlign="center" padding="l" color="text-body-secondary">No messages</Box>
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                {mailDetailLoading && <Box color="text-body-secondary">Loading...</Box>}
                {!mailDetailLoading && !mailDetail && (
                  <Box textAlign="center" padding="xxl" color="text-body-secondary">Select a message to view</Box>
                )}
                {!mailDetailLoading && mailDetail && (
                  <SpaceBetween size="m">
                    <Box variant="h3">{String((mailDetail as Record<string, unknown>).subject ?? "—")}</Box>
                    <Box fontSize="body-s" color="text-body-secondary">
                      {String((mailDetail as Record<string, unknown>).from_addr ?? "—")} · {timeAgo(String((mailDetail as Record<string, unknown>).received_at ?? ""))}
                    </Box>
                    {Boolean((mailDetail as Record<string, unknown>).is_otp) && String((mailDetail as Record<string, unknown>).otp_code ?? "") !== "" && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 8, border: "1px solid #d5dbdb", backgroundColor: "#fafafa" }}>
                        <Box color="text-status-success" fontSize="body-s" fontWeight="bold">OTP</Box>
                        <Box fontSize="heading-m" fontWeight="bold">{String((mailDetail as Record<string, unknown>).otp_code)}</Box>
                        <Button
                          variant={copiedOtp === `detail-${String((mailDetail as Record<string, unknown>).id)}` ? "normal" : "inline-icon"}
                          iconName={copiedOtp === `detail-${String((mailDetail as Record<string, unknown>).id)}` ? "status-positive" : "copy"}
                          onClick={() => copyOtp(String((mailDetail as Record<string, unknown>).otp_code), `detail-${String((mailDetail as Record<string, unknown>).id)}`)}
                        >
                          {copiedOtp === `detail-${String((mailDetail as Record<string, unknown>).id)}` ? "Copied!" : ""}
                        </Button>
                      </div>
                    )}
                    {(mailDetail as Record<string, unknown>).body ? (
                      <div
                        style={{ fontSize: 14, lineHeight: 1.6 }}
                        dangerouslySetInnerHTML={{
                          __html: String((mailDetail as Record<string, unknown>).body)
                            .replace(/<img[^>]*>/gi, "")
                            .replace(/<script[\s\S]*?<\/script>/gi, "")
                            .replace(/<link[^>]*>/gi, "")
                            .replace(/style="[^"]*"/gi, "")
                            .replace(/background[^;]*;/gi, ""),
                        }}
                      />
                    ) : (mailDetail as Record<string, unknown>).body_html ? (
                      <div
                        style={{ fontSize: 14, lineHeight: 1.6 }}
                        dangerouslySetInnerHTML={{
                          __html: String((mailDetail as Record<string, unknown>).body_html)
                            .replace(/<img[^>]*>/gi, "")
                            .replace(/<script[\s\S]*?<\/script>/gi, ""),
                        }}
                      />
                    ) : (mailDetail as Record<string, unknown>).body_text ? (
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{String((mailDetail as Record<string, unknown>).body_text)}</pre>
                    ) : (
                      <Box color="text-body-secondary">No content</Box>
                    )}
                  </SpaceBetween>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </SpaceBetween>
  );

  const tabs = [
    { label: "Account Info", id: "account-info", content: accountInfoTab },
    { label: "Codex Usage", id: "codex-usage", content: codexUsageTab },
    { label: "Mailbox", id: "mailbox", content: mailboxTab },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description={
            <SpaceBetween size="xs" direction="horizontal">
              <Box>{email}</Box>
              <StatusIndicator type={statusType}>{status}</StatusIndicator>
              {plan !== "—" && (
                <Box color="text-body-secondary">· {plan}</Box>
              )}
            </SpaceBetween>
          }
          actions={
            <SpaceBetween size="xs" direction="horizontal" alignItems="center">
              {lastRefreshed && (
                <Box color="text-body-secondary" fontSize="body-s">
                  Last refreshed: {lastRefreshed.toLocaleTimeString()}
                </Box>
              )}
              <Button
                iconName="refresh"
                loading={refreshing}
                onClick={handleRefresh}
              >
                Refresh
              </Button>
            </SpaceBetween>
          }
        >
          Shared Account
        </Header>

        {expiresAt != null && (
          <Alert type="info">
            This share link expires at {formatDate(expiresAt)}
          </Alert>
        )}

        {error && data && (
          <Alert type="error">{error}</Alert>
        )}

        <Tabs
          onChange={({ detail }) => {
            if (detail.activeTabId === "codex-usage" && !codexLoaded && !codexLoading) {
              loadCodexUsage();
              loadUsage(usageRange, usageGroupBy);
            }
            if (detail.activeTabId === "mailbox" && !mailLoaded && !mailLoading && includeMailbox) {
              loadMailMessages();
            }
          }}
          tabs={tabs}
        />
      </SpaceBetween>
    </div>
  );
}
