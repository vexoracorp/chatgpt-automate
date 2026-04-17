import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import Popover from "@cloudscape-design/components/popover";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { type WorkflowRun, fetchWorkflowRuns, startWorkflowRun, stopWorkflowRun, deleteWorkflowRun } from "../api/client";

export function statusType(status: string): "success" | "error" | "in-progress" | "pending" | "warning" | "stopped" {
  switch (status) {
    case "success": return "success";
    case "error": return "error";
    case "running": return "in-progress";
    case "awaiting_otp": return "warning";
    case "starting": return "in-progress";
    case "pending": return "stopped";
    default: return "pending";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "success": return "Success";
    case "error": return "Error";
    case "running": return "Running";
    case "awaiting_otp": return "Awaiting OTP";
    case "starting": return "Starting";
    case "pending": return "Pending";
    case "stopped": return "Stopped";
    default: return status;
  }
}

export function typeLabel(type: string): string {
  switch (type) {
    case "register": return "Register";
    case "login": return "Login";
    case "codex_oauth": return "Codex OAuth";
    default: return type;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function duration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

export default function WorkflowRunsPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [_startingId, setStartingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchWorkflowRuns();
      setRuns(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const handleStart = async (id: string) => {
    setStartingId(id);
    try {
      await startWorkflowRun(id);
      await load();
    } catch {
    } finally {
      setStartingId(null);
    }
  };

  const handleStop = async (id: string) => {
    setStartingId(id);
    try {
      await stopWorkflowRun(id);
      await load();
    } catch {
    } finally {
      setStartingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflowRun(id);
      await load();
    } catch {
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const hasActive = runs.some((r) => !r.finished_at);

  return (
    <Table
      columnDefinitions={[
        {
          id: "name",
          header: "Name",
          cell: (r) => (
            <Link onFollow={() => navigate(`/workflows/runs/${r.id}`)}>
              {r.name}
            </Link>
          ),
          width: 200,
        },
        {
          id: "type",
          header: "Workflow",
          cell: (r) => typeLabel(r.type),
          width: 120,
        },
        {
          id: "email",
          header: "Email",
          cell: (r) => r.email,
          width: 230,
        },
        {
          id: "status",
          header: "Status",
          cell: (r) => (
            <StatusIndicator type={statusType(r.status)}>
              {statusLabel(r.status)}
            </StatusIndicator>
          ),
          width: 150,
        },
        {
          id: "proxy",
          header: "Proxy",
          cell: (r) =>
            r.proxy_label ? (
              r.proxy_test ? (
                <Popover
                  triggerType="text"
                  content={
                    <SpaceBetween size="xxs">
                      <div><strong>IP:</strong> {r.proxy_test.ip || "—"}</div>
                      <div><strong>Country:</strong> {r.proxy_test.country || "—"} ({r.proxy_test.country_code || ""})</div>
                      <div><strong>City:</strong> {r.proxy_test.city || "—"}, {r.proxy_test.region || ""}</div>
                      <div><strong>ASN:</strong> {r.proxy_test.asn || "—"}</div>
                      <div><strong>Org:</strong> {r.proxy_test.org || "—"}</div>
                      <div><strong>Latency:</strong> {r.proxy_test.latency_ms != null ? `${r.proxy_test.latency_ms}ms` : "—"}</div>
                    </SpaceBetween>
                  }
                >
                  {r.proxy_label}
                </Popover>
              ) : (
                <span>{r.proxy_label}</span>
              )
            ) : r.proxy_url ? (
              r.proxy_url
            ) : (
              "Direct"
            ),
          width: 220,
        },
        {
          id: "started",
          header: "Started",
          cell: (r) => timeAgo(r.started_at),
          width: 100,
        },
        {
          id: "duration",
          header: "Duration",
          cell: (r) => duration(r.started_at, r.finished_at),
          width: 90,
        },
        {
          id: "actions",
          header: "Actions",
          cell: (r) => {
            const active = ["starting", "running", "awaiting_otp"].includes(r.status);
            const items = [
              { id: "view", text: "View details" },
            ];
            if (r.status === "pending" || r.status === "error") {
              items.push({ id: "start", text: r.status === "error" ? "Retry" : "Start" });
            }
            if (r.status === "awaiting_otp" && r.manual_otp) {
              items.push({ id: "otp", text: "Enter OTP" });
            }
            if (active) {
              items.push({ id: "stop", text: "Stop" });
            }
            if (!active) {
              items.push({ id: "delete", text: "Delete" });
            }
            return (
              <ButtonDropdown
                variant="icon"
                items={items}
                onItemClick={({ detail }) => {
                  switch (detail.id) {
                    case "view": navigate(`/workflows/runs/${r.id}`); break;
                    case "start": handleStart(r.id); break;
                    case "stop": handleStop(r.id); break;
                    case "delete": handleDelete(r.id); break;
                    case "otp": navigate(`/workflows/runs/${r.id}`); break;
                  }
                }}
              />
            );
          },
          width: 80,
        },
      ]}
      items={runs}
      loading={loading}
      loadingText="Loading workflow runs"
      empty={
        <Box textAlign="center" padding={{ vertical: "xl" }}>
          <SpaceBetween size="m">
            <b>No workflow runs</b>
            <Box color="text-body-secondary">
              Start a workflow from the Workflows tab to see it here.
            </Box>
          </SpaceBetween>
        </Box>
      }
      header={
        <Header
          counter={`(${runs.length})`}
          actions={
            <Button iconName="refresh" onClick={load} loading={loading}>
              Refresh
            </Button>
          }
          description={hasActive ? "Auto-refreshing every 3 seconds" : undefined}
        >
          Workflow Runs
        </Header>
      }
    />
  );
}
