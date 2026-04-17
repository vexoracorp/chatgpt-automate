import { useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useAuth } from "../context/AuthContext";
import { setupTOTP, verifyTOTP, type TOTPSetup } from "../api/client";

export default function Setup2FAGate() {
  const { user, complete2FASetup, logout } = useAuth();
  const [totpSetup, setTotpSetup] = useState<TOTPSetup | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSetup = async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const setup = await setupTOTP();
      setTotpSetup(setup);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to setup 2FA");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!user || !code) return;
    setLoading(true);
    setError("");
    try {
      await verifyTOTP(code);
      complete2FASetup();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box padding={{ vertical: "xxxl" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <Container
          header={
            <Header
              variant="h1"
              description="Your administrator requires two-factor authentication. Set it up to continue."
            >
              2FA Setup Required
            </Header>
          }
        >
          <SpaceBetween size="l">
            {error && <Alert type="error">{error}</Alert>}

            {!totpSetup && (
              <SpaceBetween size="m">
                <Box>
                  You need to configure an authenticator app (Google Authenticator, Authy, etc.)
                  before you can access the application.
                </Box>
                <Button variant="primary" loading={loading} onClick={handleSetup} fullWidth>
                  Begin Setup
                </Button>
              </SpaceBetween>
            )}

            {totpSetup && (
              <SpaceBetween size="m">
                <Box>Scan this QR code with your authenticator app:</Box>
                <Box textAlign="center">
                  <img
                    src={`data:image/png;base64,${totpSetup.qr_base64}`}
                    alt="2FA QR Code"
                    style={{ width: 200, height: 200 }}
                  />
                </Box>
                <FormField label="Secret key (manual entry)">
                  <Input value={totpSetup.secret} readOnly />
                </FormField>
                <FormField label="Verification code">
                  <Input
                    value={code}
                    onChange={({ detail }) => setCode(detail.value)}
                    placeholder="Enter 6-digit code to confirm"
                    onKeyDown={({ detail }) => {
                      if (detail.key === "Enter") handleVerify();
                    }}
                  />
                </FormField>
                <Button variant="primary" loading={loading} onClick={handleVerify} disabled={!code} fullWidth>
                  Verify & Enable
                </Button>
              </SpaceBetween>
            )}

            <Box textAlign="center">
              <Button variant="link" onClick={logout}>Sign out</Button>
            </Box>
          </SpaceBetween>
        </Container>
      </div>
    </Box>
  );
}
