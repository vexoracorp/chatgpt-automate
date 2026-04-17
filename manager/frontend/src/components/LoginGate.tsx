import { useState, useEffect } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
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
  const { login, pendingUser, verify2FA, clearExpired } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  useEffect(() => {
    if (pendingUser) {
      getOwnerContact().then((c) => setOwnerEmail(c.email)).catch(() => {});
    }
  }, [pendingUser]);

  if (pendingUser) {
    return (
      <Box padding={{ vertical: "xxxl" }}>
        <div style={{ maxWidth: 400, margin: "0 auto" }}>
          <Container header={<Header variant="h1">Two-Factor Authentication</Header>}>
            <SpaceBetween size="l">
              {error && <Alert type="error">{error}</Alert>}
              <Box>Enter the 6-digit code from your authenticator app.</Box>
              <FormField label="2FA Code">
                <Input
                  value={totpCode}
                  onChange={({ detail }) => setTotpCode(detail.value)}
                  placeholder="123456"
                  onKeyDown={({ detail }) => {
                    if (detail.key === "Enter") handleVerify2FA();
                  }}
                />
              </FormField>
              <Button
                variant="primary"
                loading={loading}
                onClick={handleVerify2FA}
                disabled={!totpCode}
                fullWidth
              >
                Verify
              </Button>
              <ExpandableSection headerText="Having trouble with 2FA?">
                <SpaceBetween size="xs">
                  <Box>
                    If you lost access to your authenticator app, contact your administrator to disable 2FA on your account.
                  </Box>
                  {ownerEmail && (
                    <Box>
                      Contact: <Link href={`mailto:${ownerEmail}`}>{ownerEmail}</Link>
                    </Box>
                  )}
                </SpaceBetween>
              </ExpandableSection>
            </SpaceBetween>
          </Container>
        </div>
      </Box>
    );
  }

  return (
    <Box padding={{ vertical: "xxxl" }}>
      <div style={{ maxWidth: 400, margin: "0 auto" }}>
        <Container header={<Header variant="h1">Sign In</Header>}>
          <SpaceBetween size="l">
            {expired && <Alert type="warning">Session expired. Please sign in again.</Alert>}
            {error && <Alert type="error">{error}</Alert>}
            <FormField label="Email">
              <Input
                value={email}
                onChange={({ detail }) => setEmail(detail.value)}
                placeholder="admin@example.com"
                type="email"
              />
            </FormField>
            <FormField label="Password">
              <Input
                value={password}
                onChange={({ detail }) => setPassword(detail.value)}
                type="password"
                onKeyDown={({ detail }) => {
                  if (detail.key === "Enter") handleLogin();
                }}
              />
            </FormField>
            <Button
              variant="primary"
              loading={loading}
              onClick={handleLogin}
              disabled={!email || !password}
              fullWidth
            >
              Sign In
            </Button>
          </SpaceBetween>
        </Container>
      </div>
    </Box>
  );
}
