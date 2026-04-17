import { useState, useEffect, useCallback } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { setGlobalErrorListener, getCurrentUser, SessionExpiredError } from "../api/client";

interface ErrorEntry {
  timestamp: string;
  url: string;
  method: string;
  status: number;
  statusText?: string;
  message: string;
  stack?: string;
  requestBody?: string | null;
  possibleCauses?: string[];
  response: unknown;
  userAgent?: string;
  pageUrl?: string;
  user?: { id: string; email: string } | null;
}

export default function GlobalErrorBoundary() {
  const [error, setError] = useState<ErrorEntry | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const captureError = useCallback((entry: Omit<ErrorEntry, "userAgent" | "pageUrl" | "user">) => {
    setError({
      ...entry,
      userAgent: navigator.userAgent,
      pageUrl: window.location.href,
      user: getCurrentUser(),
    });
  }, []);

  useEffect(() => {
    setGlobalErrorListener(captureError);
    return () => setGlobalErrorListener(null);
  }, [captureError]);

  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof SessionExpiredError) return;
      const err = e.reason;
      captureError({
        timestamp: new Date().toISOString(),
        url: "",
        method: "",
        status: 0,
        message: err?.message || String(err),
        response: null,
      });
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, [captureError]);

  const handleDownload = () => {
    if (!error) return;
    const blob = new Blob([JSON.stringify(error, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bug-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!error) return null;

  return (
    <>
      <div style={{ position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)", zIndex: 9999, width: 420 }}>
        <Alert
          type="error"
          dismissible
          onDismiss={() => setError(null)}
          action={
            <Button variant="inline-link" onClick={() => setShowDetail(true)}>
              Details
            </Button>
          }
        >
          Something went wrong
        </Alert>
      </div>
      <Modal
        visible={showDetail}
        onDismiss={() => setShowDetail(false)}
        header="Bug Report"
        size="medium"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setShowDetail(false)}>Close</Button>
              <Button variant="primary" iconName="download" onClick={handleDownload}>
                Download Report
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <ColumnLayout columns={2}>
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Timestamp</Box>
              <Box>{error.timestamp}</Box>
            </SpaceBetween>
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Status</Box>
              <Box>{error.status ? `${error.status} ${error.statusText || ""}`.trim() : "Network error"}</Box>
            </SpaceBetween>
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Method</Box>
              <Box>{error.method || "-"}</Box>
            </SpaceBetween>
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">URL</Box>
              <Box>{error.url || "-"}</Box>
            </SpaceBetween>
            {error.user && (
              <SpaceBetween size="xxs">
                <Box variant="awsui-key-label">User</Box>
                <Box>{error.user.email}</Box>
              </SpaceBetween>
            )}
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Page</Box>
              <Box>{error.pageUrl || "-"}</Box>
            </SpaceBetween>
          </ColumnLayout>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Error Message</Box>
            <Box>{error.message}</Box>
          </SpaceBetween>
          {error.possibleCauses && error.possibleCauses.length > 0 && (
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Possible Causes</Box>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {error.possibleCauses.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </SpaceBetween>
          )}
          {error.requestBody && (
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Request Body</Box>
              <Textarea value={error.requestBody} readOnly rows={3} />
            </SpaceBetween>
          )}
          {error.response != null && (
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Response Body</Box>
              <Textarea value={JSON.stringify(error.response, null, 2)} readOnly rows={6} />
            </SpaceBetween>
          )}
          {error.stack && (
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Stack Trace</Box>
              <Textarea value={error.stack} readOnly rows={4} />
            </SpaceBetween>
          )}
          <Box color="text-body-secondary" fontSize="body-s">
            Download this report and send it to your administrator for troubleshooting.
          </Box>
        </SpaceBetween>
      </Modal>
    </>
  );
}
