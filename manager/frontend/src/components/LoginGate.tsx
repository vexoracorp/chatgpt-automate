import { useState, useEffect } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useAuth } from "../context/AuthContext";
import { getOwnerContact } from "../api/client";

interface LoginGateProps {
  expired?: boolean;
}

export default function LoginGate({ expired }: LoginGateProps) {
  const { login, pending2fa, verify2FA, clearExpired } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showResetHelp, setShowResetHelp] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError("");
    if (expired) clearExpired();
    try {
      await login(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async () => {
    if (!totpCode) return;
    setLoading(true);
    setError("");
    try {
      await verify2FA(totpCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const [ownerEmail, setOwnerEmail] = useState("");
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    getOwnerContact().then((c) => {
      setOwnerEmail(c.email);
      setOrgName(c.org_name || "");
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (orgName) document.title = orgName;
  }, [orgName]);

  if (pending2fa) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f2f3f3" }}>
        <div style={{ width: "100%", maxWidth: 420, padding: "0 16px" }}>
          <Box textAlign="center" margin={{ bottom: "l" }}>
            <Box variant="h1" fontSize="heading-xl" fontWeight="bold">{orgName || "Relay"}</Box>
            <Box color="text-body-secondary" fontSize="body-m">on ChatGPT Manager</Box>
          </Box>
          <Container>
            <Form
              header={<Header variant="h2">Two-Factor Authentication</Header>}
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button variant="primary" loading={loading} onClick={handleVerify2FA} disabled={!totpCode} fullWidth>
                    Verify
                  </Button>
                </SpaceBetween>
              }
            >
              <SpaceBetween size="l">
                {error && <Alert type="error">{error}</Alert>}
                <Box variant="p" color="text-body-secondary">
                  Enter the 6-digit code from your authenticator app.
                </Box>
                <FormField label="2FA Code">
                  <Input
                    value={totpCode}
                    onChange={({ detail }) => setTotpCode(detail.value)}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete={false}
                    onKeyDown={({ detail }) => {
                      if (detail.key === "Enter") handleVerify2FA();
                    }}
                  />
                </FormField>
              </SpaceBetween>
            </Form>
            <Box margin={{ top: "l" }}>
              <ExpandableSection headerText="Having trouble with 2FA?">
                <SpaceBetween size="xs">
                  <Box variant="p" color="text-body-secondary">
                    If you lost access to your authenticator app, contact your administrator to disable 2FA on your account.
                  </Box>
                  {ownerEmail && (
                    <Box variant="p">
                      Contact: <Link href={`mailto:${ownerEmail}`}>{ownerEmail}</Link>
                    </Box>
                  )}
                </SpaceBetween>
              </ExpandableSection>
            </Box>
          </Container>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f2f3f3" }}>
      <div style={{ width: "100%", maxWidth: 420, padding: "0 16px" }}>
        <Box textAlign="center" margin={{ bottom: "l" }}>
          <Box variant="h1" fontSize="heading-xl" fontWeight="bold">{orgName || "Relay"}</Box>
          <Box color="text-body-secondary" fontSize="body-m">on ChatGPT Manager</Box>
        </Box>
        <Container>
          <Form
            header={<Header variant="h2">Sign in</Header>}
            actions={
              <Button variant="primary" loading={loading} onClick={handleLogin} disabled={!email || !password} fullWidth>
                Sign in
              </Button>
            }
          >
            <SpaceBetween size="l">
              {expired && <Alert type="warning">Session expired. Please sign in again.</Alert>}
              {error && <Alert type="error">{error}</Alert>}
              <FormField label="Email">
                <Input
                  value={email}
                  onChange={({ detail }) => setEmail(detail.value)}
                  placeholder="admin@example.com"
                  type="email"
                  autoComplete={false}
                />
              </FormField>
              <FormField label="Password">
                <Input
                  value={password}
                  onChange={({ detail }) => setPassword(detail.value)}
                  type="password"
                  autoComplete={false}
                  onKeyDown={({ detail }) => {
                    if (detail.key === "Enter") handleLogin();
                  }}
                />
              </FormField>
            </SpaceBetween>
          </Form>
          <Box textAlign="center" margin={{ top: "m" }}>
            <Link variant="secondary" onFollow={(e) => { e.preventDefault(); setShowResetHelp((v) => !v); }}>
              Forgot password?
            </Link>
            {showResetHelp && (
              <Box margin={{ top: "xs" }} color="text-body-secondary" fontSize="body-s">
                Contact your administrator{ownerEmail ? ` at ${ownerEmail}` : ""} to reset your password.
              </Box>
            )}
          </Box>
        </Container>
      </div>
    </div>
  );
}
