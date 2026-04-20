import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { fetchSharedAccount } from "../api/client";

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

function ValuePair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div>{children}</div>
    </div>
  );
}

export default function SharedAccountPage() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tokenId) return;
    fetchSharedAccount(tokenId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Invalid or expired share link"))
      .finally(() => setLoading(false));
  }, [tokenId]);

  if (loading) {
    return (
      <Box padding={{ vertical: "xxxl" }} textAlign="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (error) {
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

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <SpaceBetween size="l">
        <Header variant="h1" description={email}>
          Shared Account
        </Header>

        {expiresAt != null && (
          <Alert type="info">
            This share link expires at {formatDate(expiresAt)}
          </Alert>
        )}

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
    </div>
  );
}
