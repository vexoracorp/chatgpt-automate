import { useEffect, useState, useCallback } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Popover from "@cloudscape-design/components/popover";
import Alert from "@cloudscape-design/components/alert";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Spinner from "@cloudscape-design/components/spinner";
import {
  type Proxy,
  type ProxyTestResult,
  fetchProxies,
  createProxy,
  deleteProxy,
  testProxy,
  testProxyBeforeAdd,
  updateProxyLabel,
  createSubscription,
  previewSubscription,
  fetchSubscriptions,
  refreshSubscription,
  fetchIpRisk,
  type IpRiskInfo,
  type Subscription,
  type SubscriptionPreview,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

const PROTOCOL_OPTIONS = [
  { label: "HTTP", value: "http" },
  { label: "HTTPS", value: "https" },
  { label: "SOCKS4", value: "socks4" },
  { label: "SOCKS5", value: "socks5" },
];

export default function ProxiesPage() {
  const { role } = useAuth();
  const canWrite = role !== "user";
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<{ label: string; value: string }>({ label: "All groups", value: "" });
  const [selected, setSelected] = useState<Proxy[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [needAuth, setNeedAuth] = useState(false);
  const [protocol, setProtocol] = useState(PROTOCOL_OPTIONS[0]);
  const [quickInput, setQuickInput] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [testingNew, setTestingNew] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const [testError, setTestError] = useState("");
  const [subVisible, setSubVisible] = useState(false);
  const [subName, setSubName] = useState("");
  const [subUrl, setSubUrl] = useState("");
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState("");
  const [subPreview, setSubPreview] = useState<SubscriptionPreview | null>(null);
  const [subSelected, setSubSelected] = useState<SubscriptionPreview["nodes"]>([]);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState("");
  const [selectedProxy, setSelectedProxy] = useState<Proxy | null>(null);
  const [ipRisk, setIpRisk] = useState<IpRiskInfo | null>(null);
  const [ipRiskLoading, setIpRiskLoading] = useState(false);
  const [ipRiskError, setIpRiskError] = useState("");

  const handleLabelSave = async (proxyId: string) => {
    setEditingLabel(null);
    const proxy = proxies.find((p) => p.id === proxyId);
    if (!proxy || proxy.label === editLabelValue) return;
    try {
      const updated = await updateProxyLabel(proxyId, editLabelValue);
      setProxies((prev) => prev.map((p) => p.id === proxyId ? { ...p, label: updated.label } : p));
    } catch {
      void 0;
    }
  };

  const handleProxySelect = async (proxy: Proxy) => {
    setSelectedProxy(proxy);
    setIpRisk(null);
    setIpRiskError("");
    const ip = proxy.last_test?.ip;
    if (!ip) return;
    setIpRiskLoading(true);
    try {
      const risk = await fetchIpRisk(ip);
      setIpRisk(risk);
    } catch (e) {
      setIpRiskError(e instanceof Error ? e.message : "Failed to fetch IP risk");
    } finally {
      setIpRiskLoading(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([fetchProxies(), fetchSubscriptions()]);
      setProxies(p);
      setSubscriptions(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setProtocol(PROTOCOL_OPTIONS[0]);
    setQuickInput("");
    setHost("");
    setPort("");
    setNeedAuth(false);
    setUsername("");
    setPassword("");
    setLabel("");
    setError("");
    setTestResult(null);
    setTestError("");
    setConfirmVisible(false);
  };

  const parseQuickInput = (value: string) => {
    setQuickInput(value);
    const parts = value.trim().split(":");
    if (parts.length >= 4) {
      setHost(parts[0]);
      setPort(parts[1]);
      setUsername(parts[2]);
      setPassword(parts.slice(3).join(":"));
      setNeedAuth(true);
    } else if (parts.length === 2) {
      setHost(parts[0]);
      setPort(parts[1]);
    }
  };

  const handleTestAndAdd = async () => {
    if (!host || !port) return;
    setTestingNew(true);
    setError("");
    setTestResult(null);
    setTestError("");
    try {
      const result = await testProxyBeforeAdd({
        protocol: protocol.value,
        host,
        port: parseInt(port, 10),
        username: needAuth ? username : undefined,
        password: needAuth ? password : undefined,
      });
      setTestResult(result);
      setConfirmVisible(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Proxy test failed");
    } finally {
      setTestingNew(false);
    }
  };

  const handleConfirmAdd = async () => {
    setCreating(true);
    setError("");
    try {
      await createProxy({
        protocol: protocol.value,
        host,
        port: parseInt(port, 10),
        username: needAuth ? username : undefined,
        password: needAuth ? password : undefined,
        label: label || undefined,
      });
      resetForm();
      setModalVisible(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add proxy");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    for (const p of selected) {
      await deleteProxy(p.id);
    }
    setSelected([]);
    await load();
  };

  const handleTest = async (proxyId: string) => {
    setTesting(proxyId);
    setTestResult(null);
    setTestError("");
    try {
      const result = await testProxy(proxyId);
      setTestResult(result);
      setProxies((prev) =>
        prev.map((p) => p.id === proxyId ? { ...p, last_test: result } : p)
      );
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(null);
    }
  };

  const groupOptions = [
    { label: "All groups", value: "" },
    { label: "No group", value: "__none__" },
    ...Array.from(new Set(proxies.map((p) => p.group).filter(Boolean))).map((g) => ({ label: g, value: g })),
  ];
  const filteredProxies = groupFilter.value === "__none__"
    ? proxies.filter((p) => !p.group)
    : groupFilter.value
      ? proxies.filter((p) => p.group === groupFilter.value)
      : proxies;

  const activeSub = groupFilter.value
    ? subscriptions.find((s) => filteredProxies.some((p) => p.subscription_id === s.id))
    : null;

  const [refreshing, setRefreshing] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [testAllProgress, setTestAllProgress] = useState(0);
  const handleTestAll = async () => {
    const targets = filteredProxies;
    if (targets.length === 0) return;
    setTestingAll(true);
    setTestAllProgress(0);
    for (let i = 0; i < targets.length; i++) {
      try {
        const result = await testProxy(targets[i].id);
        setProxies((prev) =>
          prev.map((p) => p.id === targets[i].id ? { ...p, last_test: result } : p)
        );
      } catch {
        void 0;
      }
      setTestAllProgress(Math.round(((i + 1) / targets.length) * 100));
    }
    setTestingAll(false);
    setTestAllProgress(0);
  };

  const handleRefreshSub = async () => {
    if (!activeSub) return;
    setRefreshing(true);
    try {
      await refreshSubscription(activeSub.id);
      await load();
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddSubscription = async () => {
    if (!subName || !subUrl) return;
    setSubLoading(true);
    setSubError("");
    try {
      if (!subPreview) {
        const preview = await previewSubscription({ name: subName, url: subUrl });
        setSubPreview(preview);
        setSubSelected(preview.nodes);
      } else {
        await createSubscription({ name: subName, url: subUrl });
        setSubName("");
        setSubUrl("");
        setSubPreview(null);
        setSubVisible(false);
        await load();
      }
    } catch (e) {
      setSubError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubLoading(false);
    }
  };

  return (
    <SpaceBetween size="l">
      <Modal
        visible={subVisible}
        onDismiss={() => { setSubVisible(false); setSubPreview(null); setSubSelected([]); }}
        header={<Header variant="h2">Add Subscription</Header>}
        size={subPreview ? "large" : "medium"}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => { setSubVisible(false); setSubPreview(null); setSubSelected([]); }}>Cancel</Button>
              <Button variant="primary" loading={subLoading} onClick={handleAddSubscription} disabled={!subName || !subUrl || (!!subPreview && subSelected.length === 0)}>
                {subPreview ? `Add ${subSelected.length} of ${subPreview.node_count} nodes` : "Test"}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {subError && <Alert type="error">{subError}</Alert>}
          <Alert type="info">
            If you are running this program from China mainland, Russia, Iran, or other restricted regions, proxies may be blocked and the program may not function properly. Subscribe to a VPN service that supports VMess/VLESS and paste the subscription link below to import nodes.
          </Alert>
          <FormField label="Name">
            <Input value={subName} onChange={({ detail }) => { setSubName(detail.value); setSubPreview(null); setSubSelected([]); }} placeholder="My VPN" />
          </FormField>
          <FormField label="Subscription URL" constraintText="V2Ray, Clash, Surge, or Shadowrocket subscription URL">
            <Input value={subUrl} onChange={({ detail }) => { setSubUrl(detail.value); setSubPreview(null); setSubSelected([]); }} placeholder="https://example.com/sub/..." />
          </FormField>
          {subPreview && (
            <SpaceBetween size="s">
              <Alert type="success">
                Found {subPreview.node_count} node(s). Select the nodes you want to import.
              </Alert>
              {(subPreview.metadata.remaining_traffic || subPreview.metadata.expire_date || subPreview.metadata.reset_in) && (
                <SpaceBetween direction="horizontal" size="l">
                  {subPreview.metadata.remaining_traffic && (
                    <Box><Box variant="awsui-key-label">Traffic</Box> {subPreview.metadata.remaining_traffic}</Box>
                  )}
                  {subPreview.metadata.expire_date && (
                    <Box><Box variant="awsui-key-label">Expires</Box> {subPreview.metadata.expire_date}</Box>
                  )}
                  {subPreview.metadata.reset_in && (
                    <Box><Box variant="awsui-key-label">Resets in</Box> {subPreview.metadata.reset_in}</Box>
                  )}
                </SpaceBetween>
              )}
              <div style={{ maxHeight: 320, overflow: "auto" }}>
                <Table
                  items={subPreview.nodes}
                  selectionType="multi"
                  selectedItems={subSelected}
                  onSelectionChange={({ detail }) => setSubSelected(detail.selectedItems)}
                  trackBy="address"
                  columnDefinitions={[
                    { id: "name", header: "Name", cell: (item) => item.name || "-" },
                    { id: "protocol", header: "Protocol", cell: (item) => item.protocol.toUpperCase(), width: 100 },
                    { id: "address", header: "Address", cell: (item) => `${item.address}:${item.port}` },
                  ]}
                />
              </div>
            </SpaceBetween>
          )}
        </SpaceBetween>
      </Modal>

      <Modal
        visible={modalVisible}
        size="medium"
        onDismiss={() => {
          setModalVisible(false);
          resetForm();
        }}
        header={<Header variant="h2">Add Proxy</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                onClick={() => {
                  setModalVisible(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={testingNew}
                onClick={handleTestAndAdd}
                disabled={!host || !port}
              >
                Test & Add
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {error && <Alert type="error">{error}</Alert>}
          <FormField
            label="Quick Input"
            constraintText="host:port:username:password — auto-fills fields below"
          >
            <Input
              value={quickInput}
              onChange={({ detail }) => parseQuickInput(detail.value)}
              placeholder="us.1024proxy.io:3000:user123:pass456"
            />
          </FormField>
          <FormField label="Protocol">
            <Select
              selectedOption={protocol}
              onChange={({ detail }) =>
                setProtocol(
                  detail.selectedOption as { label: string; value: string }
                )
              }
              options={PROTOCOL_OPTIONS}
            />
          </FormField>
          <FormField label="Host">
            <Input
              value={host}
              onChange={({ detail }) => setHost(detail.value)}
              placeholder="proxy.example.com"
            />
          </FormField>
          <FormField label="Port">
            <Input
              value={port}
              onChange={({ detail }) => setPort(detail.value)}
              placeholder="8080"
              inputMode="numeric"
            />
          </FormField>
          <Checkbox
            checked={needAuth}
            onChange={({ detail }) => setNeedAuth(detail.checked)}
          >
            Requires authentication
          </Checkbox>
          {needAuth && (
            <>
              <FormField label="Username">
                <Input
                  value={username}
                  onChange={({ detail }) => setUsername(detail.value)}
                />
              </FormField>
              <FormField label="Password">
                <Input
                  value={password}
                  onChange={({ detail }) => setPassword(detail.value)}
                  type="password"
                />
              </FormField>
            </>
          )}
          <FormField label="Label">
            <Input
              value={label}
              onChange={({ detail }) => setLabel(detail.value)}
              placeholder="US Residential #1"
            />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={confirmVisible}
        onDismiss={() => setConfirmVisible(false)}
        header={<Header variant="h2">Proxy Test Passed</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmVisible(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={creating}
                onClick={handleConfirmAdd}
              >
                Add Proxy
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {testResult && (
            <ColumnLayout columns={3} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">IP</Box>
                <div>{testResult.ip}</div>
              </div>
              <div>
                <Box variant="awsui-key-label">Location</Box>
                <div>
                  {testResult.city}, {testResult.region},{" "}
                  {testResult.country} ({testResult.country_code})
                </div>
              </div>
              <div>
                <Box variant="awsui-key-label">Latency</Box>
                <div>{testResult.latency_ms}ms</div>
              </div>
              <div>
                <Box variant="awsui-key-label">ASN</Box>
                <div>{testResult.asn}</div>
              </div>
              <div>
                <Box variant="awsui-key-label">Org</Box>
                <div>{testResult.org}</div>
              </div>
              <div>
                <Box variant="awsui-key-label">Timezone</Box>
                <div>{testResult.timezone}</div>
              </div>
            </ColumnLayout>
          )}
          <Box variant="p">Add this proxy?</Box>
        </SpaceBetween>
      </Modal>

      {testResult && !confirmVisible && (
        <Modal
          visible={true}
          onDismiss={() => { setTestResult(null); setTestError(""); }}
          header={<Header variant="h2">Test Result</Header>}
          footer={
            <Box float="right">
              <Button onClick={() => { setTestResult(null); setTestError(""); }}>Close</Button>
            </Box>
          }
        >
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">IP</Box>
              <div>{testResult.ip}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Location</Box>
              <div>
                {testResult.city}, {testResult.region},{" "}
                {testResult.country} ({testResult.country_code})
              </div>
            </div>
            <div>
              <Box variant="awsui-key-label">Latency</Box>
              <div>{testResult.latency_ms}ms</div>
            </div>
            <div>
              <Box variant="awsui-key-label">ASN</Box>
              <div>{testResult.asn}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Org</Box>
              <div>{testResult.org}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Timezone</Box>
              <div>{testResult.timezone}</div>
            </div>
          </ColumnLayout>
        </Modal>
      )}
      {testError && <Alert type="error" dismissible onDismiss={() => setTestError("")}>{testError}</Alert>}

      {activeSub && (
        <Container
          header={
            <Header
              variant="h2"
              actions={
                canWrite ? (
                  <Button loading={refreshing} onClick={handleRefreshSub} iconName="refresh">
                    Reload Nodes
                  </Button>
                ) : undefined
              }
            >
              {activeSub.name}
            </Header>
          }
        >
          <ColumnLayout columns={3} variant="text-grid">
            {activeSub.metadata?.remaining_traffic && (
              <SpaceBetween size="xxs">
                <Box variant="awsui-key-label">Remaining Traffic</Box>
                <Box>{activeSub.metadata.remaining_traffic}</Box>
              </SpaceBetween>
            )}
            {activeSub.metadata?.expire_date && (
              <SpaceBetween size="xxs">
                <Box variant="awsui-key-label">Expires</Box>
                <Box>{activeSub.metadata.expire_date}</Box>
              </SpaceBetween>
            )}
            {activeSub.metadata?.reset_in && (
              <SpaceBetween size="xxs">
                <Box variant="awsui-key-label">Resets in</Box>
                <Box>{activeSub.metadata.reset_in}</Box>
              </SpaceBetween>
            )}
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Nodes</Box>
              <Box>{filteredProxies.length}</Box>
            </SpaceBetween>
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Last Updated</Box>
              <Box>{activeSub.updated_at}</Box>
            </SpaceBetween>
          </ColumnLayout>
        </Container>
      )}

      <Table
        header={
          <Header
            counter={`(${filteredProxies.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={load} iconName="refresh" loading={loading} />
                <Button onClick={handleTestAll} loading={testingAll} disabled={filteredProxies.length === 0}>
                  {testingAll ? `Testing ${testAllProgress}%` : "Test All"}
                </Button>
                {canWrite && <Button
                  disabled={selected.length === 0}
                  onClick={handleDelete}
                >
                  Delete
                </Button>}
                {canWrite && <Button
                  variant="primary"
                  onClick={() => setModalVisible(true)}
                >
                  Add Proxy
                </Button>}
                {canWrite && <Button
                  onClick={() => { setSubError(""); setSubVisible(true); }}
                >
                  Add Subscription
                </Button>}
              </SpaceBetween>
            }
          >
            Proxies
          </Header>
        }
        filter={
          <Select
            selectedOption={groupFilter}
            onChange={({ detail }) => setGroupFilter(detail.selectedOption as { label: string; value: string })}
            options={groupOptions}
          />
        }
        items={filteredProxies}
        loading={loading}
        loadingText="Loading proxies..."
        selectionType={canWrite ? "multi" : undefined}
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <b>No proxies</b>
              <Button onClick={() => setModalVisible(true)}>Add Proxy</Button>
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          {
            id: "label",
            header: "Label",
            width: 180,
            cell: (item) => editingLabel === item.id ? (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Input
                    value={editLabelValue}
                    onChange={({ detail }) => setEditLabelValue(detail.value)}
                    onKeyDown={({ detail }) => {
                      if (detail.key === "Enter") handleLabelSave(item.id);
                      if (detail.key === "Escape") setEditingLabel(null);
                    }}
                    autoFocus
                  />
                </div>
                <Button variant="inline-icon" iconName="check" onClick={() => handleLabelSave(item.id)} />
              </div>
            ) : (
              <span
                style={{ cursor: "pointer", borderBottom: "1px dashed #aab7b8" }}
                onClick={() => { setEditingLabel(item.id); setEditLabelValue(item.label); }}
              >
                {item.label || <Box color="text-status-inactive">—</Box>}
              </span>
            ),
          },
          {
            id: "group",
            header: "Group",
            cell: (item) => item.group || "-",
            width: 90,
          },
          {
            id: "protocol",
            header: "Protocol",
            cell: (item) => item.protocol.toUpperCase(),
            width: 90,
          },
          {
            id: "host",
            header: "Host",
            cell: (item) => `${item.host}:${item.port}`,
            width: 250,
          },
          {
            id: "ip",
            header: "IP",
            width: 140,
            cell: (item) => {
              const t = item.last_test;
              if (!t) return "-";
              const riskyCountries = ["CN", "RU", "HK", "IR"];
              const isRisky = riskyCountries.includes(t.country_code);
              return (
                <Popover
                  triggerType="text"
                  dismissButton={false}
                  content={
                    <SpaceBetween size="xxs">
                      {isRisky && (
                        <StatusIndicator type="warning">
                          Restricted region. US or JP nodes are recommended.
                        </StatusIndicator>
                      )}
                      <div><Box variant="awsui-key-label">ASN</Box> {t.asn || "-"}</div>
                      <div><Box variant="awsui-key-label">Organization</Box> {t.org || "-"}</div>
                      <div><Box variant="awsui-key-label">Region</Box> {t.region || "-"}, {t.city || "-"}</div>
                      <div><Box variant="awsui-key-label">Timezone</Box> {t.timezone || "-"}</div>
                      <div><Box variant="awsui-key-label">Latency</Box> {t.latency_ms}ms</div>
                    </SpaceBetween>
                  }
                >
                  {t.ip}
                </Popover>
              );
            },
          },
          {
            id: "country",
            header: "Country",
            width: 160,
            cell: (item) => {
              if (!item.last_test) return "-";
              const cc = item.last_test.country_code;
              const label = `${item.last_test.country} (${cc})`;
              const risky = ["CN", "RU", "HK", "IR"].includes(cc);
              if (risky) {
                return (
                  <Popover
                    triggerType="text"
                    dismissButton={false}
                    content={
                      <Box>This proxy is in a restricted region. The program may not function properly. US or JP nodes are recommended.</Box>
                    }
                  >
                    <StatusIndicator type="warning">{label}</StatusIndicator>
                  </Popover>
                );
              }
              return label;
            },
          },
          {
            id: "latency",
            header: "Latency",
            cell: (item) =>
              item.last_test ? `${item.last_test.latency_ms}ms` : "-",
            width: 90,
          },
          {
            id: "actions",
            header: "Actions",
            width: 120,
            cell: (item) => (
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  variant="inline-link"
                  onClick={() => handleProxySelect(item)}
                >
                  View
                </Button>
                <Button
                  variant="inline-link"
                  loading={testing === item.id}
                  onClick={() => handleTest(item.id)}
                >
                  Test
                </Button>
              </SpaceBetween>
            ),
          },
        ]}
      />

      {selectedProxy && (
        <Container
          header={
            <Header
              variant="h2"
              actions={
                <Button variant="icon" iconName="close" onClick={() => setSelectedProxy(null)} />
              }
            >
              {selectedProxy.label || "Proxy"} — {selectedProxy.protocol.toUpperCase()} {selectedProxy.host}:{selectedProxy.port}
            </Header>
          }
        >
          {(() => {
            const abuserNum = ipRisk ? parseInt(ipRisk.abuser_score, 10) || 0 : 0;
            return (
              <SpaceBetween size="l">
                {ipRisk && abuserNum > 30 && (
                  <Alert type="warning">
                    High abuse score detected ({ipRisk.abuser_score}). This proxy may be flagged by services.
                  </Alert>
                )}

                {!selectedProxy.last_test?.ip && (
                  <Box color="text-status-inactive">Run a proxy test first to see IP risk details</Box>
                )}

                {ipRiskLoading && (
                  <Box textAlign="center"><Spinner size="large" /></Box>
                )}

                {ipRiskError && (
                  <Alert type="error">{ipRiskError}</Alert>
                )}

                {ipRisk && (
                  <SpaceBetween size="l">
                    <ColumnLayout columns={4} variant="text-grid">
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">IP</Box>
                        <Box>{ipRisk.ip}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">CIDR</Box>
                        <Box>{ipRisk.cidr}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">ASN</Box>
                        <Box>{ipRisk.asn}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Organization</Box>
                        <Box>{ipRisk.asOrganization}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Country</Box>
                        <Box>{ipRisk.country} ({ipRisk.countryCode})</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Region</Box>
                        <Box>{ipRisk.region}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">City</Box>
                        <Box>{ipRisk.city}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Timezone</Box>
                        <Box>{ipRisk.timezone}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Company Name</Box>
                        <Box>{ipRisk.company_name || "-"}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Company Type</Box>
                        <Box>{ipRisk.company_type || "-"}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">ASN Kind</Box>
                        <Box>{ipRisk.asn_kind || "-"}</Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Trust Score</Box>
                        <Box>
                          <StatusIndicator type={ipRisk.trust_score >= 70 ? "success" : ipRisk.trust_score >= 40 ? "warning" : "error"}>
                            {ipRisk.trust_score}
                          </StatusIndicator>
                        </Box>
                      </SpaceBetween>
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Abuser Score</Box>
                        <Box>
                          <StatusIndicator type={abuserNum <= 20 ? "success" : abuserNum <= 50 ? "warning" : "error"}>
                            {ipRisk.abuser_score}
                          </StatusIndicator>
                        </Box>
                      </SpaceBetween>
                    </ColumnLayout>

                    {abuserNum > 50 && (
                      <Alert type="warning">
                        High abuse score detected. This proxy may be flagged.
                      </Alert>
                    )}

                    <SpaceBetween size="xxs">
                      <Box variant="awsui-key-label">Flags</Box>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {[
                          ipRisk.is_datacenter && { label: "Datacenter", color: "#687078" },
                          ipRisk.isResidential && { label: "Residential", color: "#037f0c" },
                          ipRisk.is_vpn && { label: "VPN", color: "#d13212" },
                          ipRisk.is_proxy && { label: "Proxy", color: "#d13212" },
                          ipRisk.is_tor && { label: "Tor", color: "#d13212" },
                          ipRisk.is_crawler && { label: "Crawler", color: "#687078" },
                          ipRisk.is_abuser && { label: "Abuser", color: "#d13212" },
                          ipRisk.is_mobile && { label: "Mobile", color: "#687078" },
                        ].filter(Boolean).map((flag) => {
                          const f = flag as { label: string; color: string };
                          return (
                            <span key={f.label} style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#fff",
                              backgroundColor: f.color,
                            }}>
                              {f.label}
                            </span>
                          );
                        })}
                      </div>
                    </SpaceBetween>
                  </SpaceBetween>
                )}
              </SpaceBetween>
            );
          })()}
        </Container>
      )}
    </SpaceBetween>
  );
}
