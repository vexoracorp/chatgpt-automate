import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Popover from "@cloudscape-design/components/popover";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { type WorkflowRunDetail, fetchWorkflowRun, startWorkflowRun, stopWorkflowRun, deleteWorkflowRun, submitOTP } from "../api/client";
import { statusType, statusLabel, typeLabel } from "./WorkflowRunsPage";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function duration(start: string, end: string | null): string {
  const endMs = end ? new Date(end).getTime() : Date.now();
  const ms = endMs - new Date(start).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

function ValueWithLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div>{children}</div>
    </div>
  );
}

export default function WorkflowRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSubmitting, setOtpSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!runId) return;
    try {
      const data = await fetchWorkflowRun(runId);
      setRun(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const handleStart = async () => {
    if (!runId) return;
    setStarting(true);
    try {
      await startWorkflowRun(runId);
      await load();
    } catch {
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!runId) return;
    setStarting(true);
    try {
      await stopWorkflowRun(runId);
      await load();
    } catch {
    } finally {
      setStarting(false);
    }
  };

  const handleDelete = async () => {
    if (!runId) return;
    try {
      await deleteWorkflowRun(runId);
      navigate("/workflows");
    } catch {
    }
  };

  const handleSubmitOtp = async () => {
    if (!runId || !otpCode.trim()) return;
    setOtpSubmitting(true);
    try {
      await submitOTP({ account_id: runId, otp: otpCode.trim() });
      setOtpCode("");
    } catch {
    } finally {
      setOtpSubmitting(false);
    }
  };

  if (loading && !run) {
    return (
      <Box padding={{ vertical: "xxxl" }} textAlign="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (error && !run) {
    return (
      <Box padding={{ vertical: "xxxl" }} textAlign="center">
        <SpaceBetween size="m">
          <Box color="text-status-error">{error}</Box>
          <Button onClick={() => navigate("/workflows")}>Back to Workflows</Button>
        </SpaceBetween>
      </Box>
    );
  }

  if (!run) return null;

  const isActive = !run.finished_at;

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <SpaceBetween size="xs" direction="horizontal">
            {(run.status === "pending" || run.status === "error") && (
              <Button variant="primary" loading={starting} onClick={handleStart}>
                {run.status === "error" ? "Retry" : "Start"}
              </Button>
            )}
            {["starting", "running", "awaiting_otp"].includes(run.status) && (
              <Button loading={starting} onClick={handleStop}>Stop</Button>
            )}
            {["stopped", "success", "error", "pending"].includes(run.status) && (
              <Button onClick={handleDelete}>Delete</Button>
            )}
            <Button iconName="refresh" onClick={load}>Refresh</Button>
            <Button onClick={() => navigate("/workflows")}>Back</Button>
          </SpaceBetween>
        }
      >
        {run.name}
      </Header>

      {run.status === "awaiting_otp" && run.manual_otp && (
        <Alert type="warning">
          <SpaceBetween size="xs" direction="horizontal" alignItems="center">
            <span>OTP required for {run.email}</span>
            <Input
              value={otpCode}
              onChange={({ detail }) => setOtpCode(detail.value)}
              placeholder="6-digit code"
              type="text"
            />
            <Button variant="primary" loading={otpSubmitting} onClick={handleSubmitOtp} disabled={!otpCode.trim()}>
              Submit
            </Button>
          </SpaceBetween>
        </Alert>
      )}

      {run.status === "awaiting_otp" && !run.manual_otp && (
        <Alert type="info">
          Waiting for OTP — auto-retrieving from mailbox...
        </Alert>
      )}

      <Container header={<Header variant="h2">General configuration</Header>}>
        <ColumnLayout columns={4} variant="text-grid">
          <ValueWithLabel label="Workflow type">
            {typeLabel(run.type)}
          </ValueWithLabel>
          <ValueWithLabel label="Status">
            <StatusIndicator type={statusType(run.status)}>
              {statusLabel(run.status)}
            </StatusIndicator>
          </ValueWithLabel>
          <ValueWithLabel label="Email">
            {run.email}
          </ValueWithLabel>
          <ValueWithLabel label="Duration">
            {duration(run.started_at, run.finished_at)}
            {isActive && " (running)"}
          </ValueWithLabel>
        </ColumnLayout>
      </Container>

      {run.callback_url && run.type !== "codex_device" && (
        <Alert
          type="success"
          action={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="copy" onClick={() => navigator.clipboard.writeText(run.callback_url!)}>Copy</Button>
              <Button iconName="external" href={run.callback_url} target="_blank">Open</Button>
            </SpaceBetween>
          }
        >
          Callback URL ready — paste this into your Codex CLI terminal
        </Alert>
      )}

      {run.status === "success" && ["register", "login", "codex_oauth", "codex_device"].includes(run.type) && (
        <Alert
          type="success"
          action={
            <Button onClick={() => navigate(`/accounts/${run.id}`)}>View Account</Button>
          }
        >
          {run.type === "codex_device" ? "Device code authorized — your CLI session is now active" : run.type === "codex_oauth" ? "Codex OAuth completed successfully" : run.type === "login" ? "Login completed successfully" : "Registration completed successfully"}
        </Alert>
      )}

      <Tabs
        tabs={[
          {
            id: "details",
            label: "Details",
            content: (
              <Container header={<Header variant="h2">Details</Header>}>
                <ColumnLayout columns={3} variant="text-grid">
                  <ValueWithLabel label="Run ID">
                    {run.id}
                  </ValueWithLabel>
                  <ValueWithLabel label="Run name">
                    {run.name}
                  </ValueWithLabel>
                  <ValueWithLabel label="Workflow type">
                    {typeLabel(run.type)}
                  </ValueWithLabel>
                  <ValueWithLabel label="Email">
                    {run.email}
                  </ValueWithLabel>
                  <ValueWithLabel label="Proxy">
                    {run.proxy_label ? (
                      run.proxy_test ? (
                        <Popover
                          triggerType="text"
                          content={
                            <SpaceBetween size="xxs">
                              <div><strong>IP:</strong> {run.proxy_test.ip || "—"}</div>
                              <div><strong>Country:</strong> {run.proxy_test.country || "—"} ({run.proxy_test.country_code || ""})</div>
                              <div><strong>City:</strong> {run.proxy_test.city || "—"}, {run.proxy_test.region || ""}</div>
                              <div><strong>ASN:</strong> {run.proxy_test.asn || "—"}</div>
                              <div><strong>Org:</strong> {run.proxy_test.org || "—"}</div>
                              <div><strong>Latency:</strong> {run.proxy_test.latency_ms != null ? `${run.proxy_test.latency_ms}ms` : "—"}</div>
                            </SpaceBetween>
                          }
                        >
                          {run.proxy_label}
                        </Popover>
                      ) : (
                        <span>{run.proxy_label}</span>
                      )
                    ) : run.proxy_url ? (
                      run.proxy_url
                    ) : (
                      "Direct (no proxy)"
                    )}
                  </ValueWithLabel>
                  <ValueWithLabel label="Status">
                    <StatusIndicator type={statusType(run.status)}>
                      {statusLabel(run.status)}
                    </StatusIndicator>
                  </ValueWithLabel>
                  <ValueWithLabel label="Started at">
                    {formatTime(run.started_at)}
                  </ValueWithLabel>
                  <ValueWithLabel label="Finished at">
                    {run.finished_at ? formatTime(run.finished_at) : "—"}
                  </ValueWithLabel>
                  <ValueWithLabel label="Duration">
                    {duration(run.started_at, run.finished_at)}
                  </ValueWithLabel>
                  {run.error && (
                    <ValueWithLabel label="Error">
                      <Box color="text-status-error">{run.error}</Box>
                    </ValueWithLabel>
                  )}
                </ColumnLayout>
              </Container>
            ),
          },
          {
            id: "logs",
            label: "Logs",
            content: (
              <Table
                columnDefinitions={[
                  {
                    id: "ts",
                    header: "Timestamp",
                    cell: (log) => formatTime(log.ts),
                    width: 200,
                  },
                  {
                    id: "msg",
                    header: "Message",
                    cell: (log) => (
                      <Box
                        variant="code"
                        fontSize="body-s"
                        color={log.msg.startsWith("Error:") ? "text-status-error" : undefined}
                      >
                        {log.msg}
                      </Box>
                    ),
                  },
                ]}
                items={[...run.logs].reverse()}
                empty={
                  <Box textAlign="center" padding={{ vertical: "l" }}>
                    No logs yet
                  </Box>
                }
                header={
                  <Header
                    counter={`(${run.logs.length})`}
                    description={isActive ? "Auto-refreshing every 3 seconds" : undefined}
                  >
                    Execution logs
                  </Header>
                }
              />
            ),
          },
          ...(run.output ? [{
            id: "output",
            label: "Output",
            content: (
              <Container header={<Header variant="h2">Output</Header>}>
                <SpaceBetween size="xs">
                  {Object.entries(run.output).map(([key, value]) => (
                    <div key={key} style={{ display: "flex", justifyContent: "space-between" }}>
                      <Box color="text-body-secondary">{key}</Box>
                      <Box fontWeight="bold">{typeof value === "object" ? JSON.stringify(value) : String(value)}</Box>
                    </div>
                  ))}
                </SpaceBetween>
              </Container>
            ),
          }] : []),
        ]}
      />
    </SpaceBetween>
  );
}
