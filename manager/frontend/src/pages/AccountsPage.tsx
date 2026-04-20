import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Cards from "@cloudscape-design/components/cards";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";

import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import TextFilter from "@cloudscape-design/components/text-filter";
import Spinner from "@cloudscape-design/components/spinner";
import {
  type Account,
  type Proxy,
  deleteAccount,
  fetchAccounts,
  fetchProxies,
  importSession,
  refreshAccount,
} from "../api/client";
import OTPModal from "../components/OTPModal";
import { useAuth } from "../context/AuthContext";

function planLabel(plan: string): string {
  if (!plan) return "Unknown";
  const lower = plan.toLowerCase().replace(/[^a-z]/g, "");
  if (lower.includes("free")) return "Free";
  if (lower.includes("plus")) return "Plus";
  if (lower.includes("pro")) return "Pro";
  if (lower.includes("team")) return "Team";
  if (lower.includes("enterprise")) return "Enterprise";
  return plan;
}

function formatResetTime(hours: number): string {
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
  if (min <= 0 || min >= 10080) return "";
  const resetAt = new Date(Date.now() + min * 60_000);
  return resetAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function AccountsPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const canWrite = role !== "user";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Account[]>([]);
  const [filterText, setFilterText] = useState("");
  const [otpAccountId, setOtpAccountId] = useState("");
  const [refreshing, setRefreshing] = useState<string | null>(null);


  const [loginVisible, setLoginVisible] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSessionJson, setLoginSessionJson] = useState("");
  const [loginProxy, setLoginProxy] = useState<{ label: string; value: string } | null>(null);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");



  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await fetchAccounts());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  const handleDelete = async () => {
    for (const a of selected) {
      await deleteAccount(a.id);
    }
    setSelected([]);
    await load();
  };

  const handleRefresh = async (id: string) => {
    setRefreshing(id);
    try {
      await refreshAccount(id);
      await load();
    } finally {
      setRefreshing(null);
    }
  };

  const loadProxies = useCallback(async () => {
    setProxies(await fetchProxies());
  }, []);

  const proxyOptions = [
    { label: "Direct (no proxy)", value: "" },
    ...proxies.map((p) => ({ label: p.label || p.url, value: p.url })),
  ];

  const openLogin = async () => {
    await loadProxies();
    setLoginEmail("");
    setLoginSessionJson("");
    setLoginProxy(null);
    setFormError("");
    setLoginVisible(true);
  };

  const handleLogin = async () => {
    if (!loginSessionJson) return;
    setFormLoading(true);
    setFormError("");
    try {
      await importSession({
        email: loginEmail || undefined,
        session_json: loginSessionJson,
        proxy_url: loginProxy?.value || undefined,
      });
      setLoginVisible(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setFormLoading(false);
    }
  };

  const filtered = accounts.filter(
    (a) =>
      !filterText ||
      a.email.toLowerCase().includes(filterText.toLowerCase()) ||
      a.name.toLowerCase().includes(filterText.toLowerCase()) ||
      a.status.toLowerCase().includes(filterText.toLowerCase())
  );

  const statusType = (s: string) => {
    if (s === "active") return "success" as const;
    if (s.startsWith("error")) return "error" as const;
    if (s === "awaiting_otp") return "in-progress" as const;
    if (s === "registering" || s === "logging_in") return "loading" as const;
    return "pending" as const;
  };

  return (
    <>
      <Cards
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        selectedItems={selected}
        ariaLabels={{
          itemSelectionLabel: (_e, item) => `select ${item.email}`,
          selectionGroupLabel: "Account selection",
        }}
        cardDefinition={{
          header: (item) => (
            <Link href="#" fontSize="heading-m" onFollow={(e) => { e.preventDefault(); navigate(`/accounts/${item.id}`); }}>
              <span style={{ wordBreak: "break-all" }}>{item.email}</span>
            </Link>
          ),
          sections: [
            {
              id: "status",
              content: (item) => (
                <SpaceBetween direction="horizontal" size="xs">
                  <StatusIndicator type={statusType(item.status)}>
                    {item.status}
                  </StatusIndicator>
                  {item.name && <Box color="text-body-secondary">{item.name}</Box>}
                  <Box color="text-body-secondary">·</Box>
                  <Box fontWeight="bold">{planLabel(item.plan)}</Box>
                  {item.codex_token && <StatusIndicator type="success">Codex</StatusIndicator>}
                  {item.status === "awaiting_otp" && (
                    <Button variant="inline-link" onClick={() => setOtpAccountId(item.id)}>
                      Enter OTP
                    </Button>
                  )}
                  <Button
                    variant="inline-icon"
                    iconName="refresh"
                    loading={refreshing === item.id}
                    onClick={() => handleRefresh(item.id)}
                  />
                </SpaceBetween>
              ),
            },
            {
              id: "codex",
              header: "Codex",
              content: (item) => {
                const weeklyRemaining = Math.max(0, 100 - item.codex_weekly_used);
                const fiveHRemaining = Math.max(0, 100 - item.codex_5h_used);
                const weeklyReset = formatResetTime(item.codex_weekly_reset_hours);
                const fiveHReset = formatResetMin(item.codex_5h_reset_min);
                const isFree = !item.plan || item.plan.toLowerCase() === "free" || (item.codex_weekly_used === 0 && item.codex_weekly_reset_hours === 0 && weeklyRemaining === 100);
                const barColor = (pct: number) =>
                  pct > 50 ? "#037f0c" : pct >= 20 ? "#d97706" : "#d91515";

                const renderBar = (label: string, pct: number, resetText: string) => (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ width: 52, flexShrink: 0, color: "#545b64", fontWeight: 500 }}>{label}</span>
                    <div style={{ flex: 1, position: "relative", height: 20, background: "#f2f3f3", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: barColor(pct), borderRadius: 3, transition: "width 0.3s ease" }} />
                      <span style={{ position: "absolute", top: 0, left: 6, lineHeight: "20px", fontSize: 11, fontWeight: 600, color: pct > 15 ? "#fff" : "#16191f" }}>
                        {pct}%
                      </span>
                    </div>
                    {resetText && <span style={{ flexShrink: 0, fontSize: 11, color: "#687078", whiteSpace: "nowrap" }}>{resetText}</span>}
                  </div>
                );

                return (
                  <SpaceBetween size="xxs">
                    {isFree ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <span style={{ width: 52, flexShrink: 0, color: "#545b64", fontWeight: 500 }}>Weekly</span>
                        <div style={{ flex: 1, height: 20, background: "#f2f3f3", borderRadius: 3, display: "flex", alignItems: "center", paddingLeft: 6 }}>
                          <span style={{ fontSize: 11, color: "#687078" }}>No weekly limit on Free plan</span>
                        </div>
                      </div>
                    ) : (
                      renderBar("Weekly", weeklyRemaining, weeklyReset ? `resets ${weeklyReset}` : "")
                    )}
                    {renderBar("5-Hour", fiveHRemaining, fiveHReset ? `resets ${fiveHReset}` : "")}
                  </SpaceBetween>
                );
              },
            },
          ],
        }}
        cardsPerRow={[
          { cards: 1 },
          { minWidth: 700, cards: 2 },
          { minWidth: 1100, cards: 3 },
          { minWidth: 1500, cards: 4 },
        ]}
        items={filtered}
        loading={loading}
        loadingText="Loading accounts..."
        selectionType={canWrite ? "multi" : undefined}
        trackBy="id"
        empty={
          <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <b>No accounts</b>
              <Box variant="p" color="inherit">
                Register or login to add accounts.
              </Box>
            </SpaceBetween>
          </Box>
        }
        filter={
          <TextFilter
            filteringPlaceholder="Find accounts"
            filteringText={filterText}
            onChange={({ detail }) => setFilterText(detail.filteringText)}
          />
        }
        header={
          <Header
            counter={`(${accounts.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={load} iconName="refresh" loading={loading} />
                {canWrite && <Button
                  disabled={selected.length === 0}
                  onClick={handleDelete}
                >
                  Delete
                </Button>}
                {canWrite && <Button onClick={openLogin}>Import Session</Button>}
                {canWrite && <Button onClick={() => navigate("/workflows/login")}>Login</Button>}
                {canWrite && <Button variant="primary" onClick={() => navigate("/workflows/register")}>
                  Register
                </Button>}
              </SpaceBetween>
            }
          >
            Accounts
          </Header>
        }
      />
      <OTPModal
        visible={!!otpAccountId}
        accountId={otpAccountId}
        onDismiss={() => setOtpAccountId("")}
        onSuccess={() => {
          setOtpAccountId("");
          load();
        }}
      />

      <Modal
        visible={loginVisible}
        onDismiss={() => setLoginVisible(false)}
        header={<Header variant="h2">Import Session</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setLoginVisible(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={formLoading}
                onClick={handleLogin}
                disabled={!loginSessionJson}
              >
                Import
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {formError && <Alert type="error">{formError}</Alert>}
          <Alert type="info">
            To login with OTP, use the Login workflow. Here you can import an existing session from{" "}
            <Box variant="code" display="inline">chatgpt.com/api/auth/session</Box>.
          </Alert>
          <FormField label="Email" description="Optional — will be extracted from session JSON if omitted">
            <Input
              value={loginEmail}
              onChange={({ detail }) => setLoginEmail(detail.value)}
              placeholder="user@example.com"
              type="email"
            />
          </FormField>
          <FormField label="Proxy">
            <Select
              selectedOption={loginProxy}
              onChange={({ detail }) => setLoginProxy(detail.selectedOption as { label: string; value: string })}
              options={proxyOptions}
              placeholder="Direct (no proxy)"
            />
          </FormField>
          <FormField label="Session JSON" description="Paste the full JSON response from chatgpt.com/api/auth/session">
            <textarea
              value={loginSessionJson}
              onChange={(e) => setLoginSessionJson(e.target.value)}
              placeholder='{"user":{"id":"...","email":"..."},"accessToken":"...",...}'
              rows={8}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 13, padding: 8, borderRadius: 4, border: "1px solid #aab7b8", resize: "vertical" }}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
    </>
  );
}
