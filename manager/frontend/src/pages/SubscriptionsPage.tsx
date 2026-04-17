import { useEffect, useState, useCallback } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import {
  type Subscription,
  type SubscriptionNode,
  fetchSubscriptions,
  createSubscription,
  refreshSubscription,
  deleteSubscription,
  startNode,
  stopNode,
  fetchRunningNodes,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function SubscriptionsPage() {
  const { role } = useAuth();
  const canWrite = role !== "user";
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [running, setRunning] = useState<Record<string, { port: number; node: SubscriptionNode }>>({});
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [subName, setSubName] = useState("");
  const [subUrl, setSubUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [activeSub, setActiveSub] = useState<Subscription | null>(null);
  const [nodeLoading, setNodeLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([fetchSubscriptions(), fetchRunningNodes()]);
      setSubs(s);
      setRunning(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!subName || !subUrl) return;
    setCreating(true);
    setError("");
    try {
      await createSubscription({ name: subName, url: subUrl });
      setSubName("");
      setSubUrl("");
      setAddVisible(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  const handleRefresh = async (id: string) => {
    try {
      await refreshSubscription(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSubscription(id);
      if (activeSub?.id === id) setActiveSub(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleStartNode = async (subId: string, index: number) => {
    const nodeId = `${subId}:${index}`;
    setNodeLoading(nodeId);
    try {
      await startNode(subId, index);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start node");
    } finally {
      setNodeLoading(null);
    }
  };

  const handleStopNode = async (subId: string, index: number) => {
    const nodeId = `${subId}:${index}`;
    setNodeLoading(nodeId);
    try {
      await stopNode(subId, index);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop node");
    } finally {
      setNodeLoading(null);
    }
  };

  return (
    <SpaceBetween size="l">
      <Modal
        visible={addVisible}
        onDismiss={() => setAddVisible(false)}
        header={<Header variant="h2">Add Subscription</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setAddVisible(false)}>Cancel</Button>
              <Button variant="primary" loading={creating} onClick={handleAdd} disabled={!subName || !subUrl}>Add</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {error && <Alert type="error">{error}</Alert>}
          <FormField label="Name">
            <Input value={subName} onChange={({ detail }) => setSubName(detail.value)} placeholder="My VPN" />
          </FormField>
          <FormField label="Subscription URL">
            <Input value={subUrl} onChange={({ detail }) => setSubUrl(detail.value)} placeholder="https://example.com/sub/..." />
          </FormField>
        </SpaceBetween>
      </Modal>

      {error && !addVisible && <Alert type="error" dismissible onDismiss={() => setError("")}>{error}</Alert>}

      <Table
        header={
          <Header
            counter={`(${subs.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={load} iconName="refresh" loading={loading} />
                {canWrite && <Button variant="primary" onClick={() => { setError(""); setAddVisible(true); }}>Add Subscription</Button>}
              </SpaceBetween>
            }
          >
            Subscriptions
          </Header>
        }
        items={subs}
        loading={loading}
        loadingText="Loading subscriptions..."
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <b>No subscriptions</b>
              {canWrite && <Button onClick={() => setAddVisible(true)}>Add Subscription</Button>}
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          { id: "name", header: "Name", cell: (item) => item.name },
          { id: "nodes", header: "Nodes", cell: (item) => item.nodes.length },
          { id: "updated", header: "Updated", cell: (item) => item.updated_at },
          {
            id: "actions",
            header: "Actions",
            cell: (item) => (
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="inline-link" onClick={() => setActiveSub(item)}>Nodes</Button>
                {canWrite && <Button variant="inline-link" onClick={() => handleRefresh(item.id)}>Refresh</Button>}
                {canWrite && <Button variant="inline-link" onClick={() => handleDelete(item.id)}>Delete</Button>}
              </SpaceBetween>
            ),
          },
        ]}
      />

      {activeSub && (
        <Container
          header={
            <Header
              variant="h2"
              actions={<Button onClick={() => setActiveSub(null)}>Close</Button>}
            >
              {activeSub.name} — Nodes ({activeSub.nodes.length})
            </Header>
          }
        >
          <Table
            items={activeSub.nodes.map((n, i) => ({ ...n, _index: i }))}
            columnDefinitions={[
              { id: "name", header: "Name", cell: (item) => item.name || "-" },
              { id: "protocol", header: "Protocol", cell: (item) => item.protocol.toUpperCase() },
              { id: "address", header: "Address", cell: (item) => `${item.address}:${item.port}` },
              {
                id: "status",
                header: "Status",
                cell: (item) => {
                  const nodeId = `${activeSub.id}:${item._index}`;
                  const r = running[nodeId];
                  if (r) return <StatusIndicator type="success">Running (:{r.port})</StatusIndicator>;
                  return <StatusIndicator type="stopped">Stopped</StatusIndicator>;
                },
              },
              {
                id: "proxy",
                header: "Proxy URL",
                cell: (item) => {
                  const nodeId = `${activeSub.id}:${item._index}`;
                  const r = running[nodeId];
                  if (r) return <Box variant="code">socks5://127.0.0.1:{r.port}</Box>;
                  return "-";
                },
              },
              {
                id: "actions",
                header: "Actions",
                cell: (item) => {
                  if (!canWrite) return null;
                  const nodeId = `${activeSub.id}:${item._index}`;
                  const isRunning = !!running[nodeId];
                  const isLoading = nodeLoading === nodeId;
                  if (isRunning) {
                    return <Button loading={isLoading} onClick={() => handleStopNode(activeSub.id, item._index)}>Stop</Button>;
                  }
                  return <Button loading={isLoading} onClick={() => handleStartNode(activeSub.id, item._index)}>Start</Button>;
                },
              },
            ]}
          />
        </Container>
      )}
    </SpaceBetween>
  );
}
