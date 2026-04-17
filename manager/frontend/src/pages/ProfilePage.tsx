import { useState, useEffect } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Tabs from "@cloudscape-design/components/tabs";
import { useAuth } from "../context/AuthContext";
import { updateProfile, changePassword, setupTOTP, verifyTOTP, disableTOTP, getSettings, authMe, type TOTPSetup, type AppSettings } from "../api/client";

interface ProfileModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export default function ProfileModal({ visible, onDismiss }: ProfileModalProps) {
  const { user, role } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const [totpEnabled, setTotpEnabled] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [totpSetup, setTotpSetup] = useState<TOTPSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpSuccess, setTotpSuccess] = useState("");
  const [totpError, setTotpError] = useState("");

  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [retypePw, setRetypePw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  const [tfaModalOpen, setTfaModalOpen] = useState(false);
  const [tfaCode, setTfaCode] = useState("");
  const [tfaError, setTfaError] = useState("");

  useEffect(() => {
    if (visible && user) {
      authMe()
        .then((data) => setTotpEnabled(data.totp_enabled))
        .catch(() => {});
      getSettings()
        .then((s) => setSettings(s))
        .catch(() => {});
    }
  }, [visible, user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await updateProfile({ name: name || undefined });
      setSuccess("Profile updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const openResetPassword = () => {
    setCurrentPw("");
    setNewPw("");
    setRetypePw("");
    setPwError("");
    setPwSuccess("");
    setPwModalOpen(true);
  };

  const handlePasswordSubmit = () => {
    setPwError("");
    if (!newPw || !currentPw) {
      setPwError("All fields are required");
      return;
    }
    if (newPw !== retypePw) {
      setPwError("New passwords do not match");
      return;
    }
    if (newPw.length < 4) {
      setPwError("Password must be at least 4 characters");
      return;
    }
    if (totpEnabled) {
      setTfaCode("");
      setTfaError("");
      setTfaModalOpen(true);
    } else {
      doChangePassword();
    }
  };

  const doChangePassword = async (totp?: string) => {
    setPwLoading(true);
    setPwError("");
    try {
      await changePassword({
        current_password: currentPw,
        new_password: newPw,
        totp_code: totp || undefined,
      });
      setTfaModalOpen(false);
      setPwModalOpen(false);
      setPwSuccess("Password changed successfully");
      setSuccess("Password changed successfully");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      if (tfaModalOpen) {
        setTfaError(msg);
      } else {
        setPwError(msg);
      }
    } finally {
      setPwLoading(false);
    }
  };

  const handleTfaConfirm = () => {
    if (!tfaCode) {
      setTfaError("Enter your 2FA code");
      return;
    }
    doChangePassword(tfaCode);
  };

  const handleSetup2FA = async () => {
    if (!user) return;
    setTotpLoading(true);
    setTotpError("");
    try {
      const setup = await setupTOTP();
      setTotpSetup(setup);
    } catch (e) {
      setTotpError(e instanceof Error ? e.message : "Failed");
    } finally {
      setTotpLoading(false);
    }
  };

  const handleVerify2FA = async () => {
    if (!user || !totpCode) return;
    setTotpLoading(true);
    setTotpError("");
    try {
      await verifyTOTP(totpCode);
      setTotpSetup(null);
      setTotpCode("");
      setTotpEnabled(true);
      setTotpSuccess("2FA enabled successfully");
    } catch (e) {
      setTotpError(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setTotpLoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!user) return;
    setTotpLoading(true);
    setTotpError("");
    try {
      await disableTOTP();
      setTotpEnabled(false);
      setTotpSuccess("2FA disabled");
    } catch (e) {
      setTotpError(e instanceof Error ? e.message : "Failed");
    } finally {
      setTotpLoading(false);
    }
  };

  const require2fa = settings?.require_2fa ?? false;
  const allowPasswordChange = settings?.allow_password_change ?? true;

  return (
    <>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        header={<Header variant="h2">Profile</Header>}
        size="medium"
      >
        <Tabs
          tabs={[
            {
              id: "account",
              label: "Account",
              content: (
                <SpaceBetween size="l">
                  {error && <Alert type="error">{error}</Alert>}
                  {success && <Alert type="success">{success}</Alert>}
                  <FormField label="Email">
                    <Input value={user?.email || ""} disabled />
                  </FormField>
                  <FormField label="Role">
                    <Input value={role.charAt(0).toUpperCase() + role.slice(1)} disabled />
                  </FormField>
                  <FormField label="Name">
                    <Input
                      value={name}
                      onChange={({ detail }) => setName(detail.value)}
                      placeholder="New name"
                    />
                  </FormField>
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button variant="primary" loading={saving} onClick={handleSaveProfile}>
                      Save
                    </Button>
                    <Button onClick={openResetPassword} disabled={!allowPasswordChange}>
                      Reset Password
                    </Button>
                  </SpaceBetween>
                  {!allowPasswordChange && (
                    <Box color="text-body-secondary" fontSize="body-s">
                      Password reset has been disabled by your organization administrator.
                    </Box>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: "2fa",
              label: "Two-Factor Auth",
              content: (
                <SpaceBetween size="l">
                  {totpError && <Alert type="error">{totpError}</Alert>}
                  {totpSuccess && <Alert type="success">{totpSuccess}</Alert>}

                  <StatusIndicator type={totpEnabled ? "success" : "stopped"}>
                    {totpEnabled ? "2FA is enabled" : "2FA is not enabled"}
                  </StatusIndicator>

                  {!totpSetup && !totpEnabled && (
                    <Button onClick={handleSetup2FA} loading={totpLoading}>
                      Setup 2FA
                    </Button>
                  )}

                  {!totpSetup && totpEnabled && !require2fa && (
                    <Button onClick={handleDisable2FA} loading={totpLoading}>
                      Disable 2FA
                    </Button>
                  )}

                  {!totpSetup && totpEnabled && require2fa && (
                    <Box color="text-body-secondary">
                      2FA is required by your organization and cannot be disabled.
                    </Box>
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
                          value={totpCode}
                          onChange={({ detail }) => setTotpCode(detail.value)}
                          placeholder="Enter 6-digit code to confirm"
                        />
                      </FormField>
                      <Button variant="primary" loading={totpLoading} onClick={handleVerify2FA} disabled={!totpCode}>
                        Verify & Enable
                      </Button>
                    </SpaceBetween>
                  )}
                </SpaceBetween>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        visible={pwModalOpen}
        onDismiss={() => setPwModalOpen(false)}
        header="Reset Password"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setPwModalOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={pwLoading} onClick={handlePasswordSubmit}>
                Change Password
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {pwError && <Alert type="error">{pwError}</Alert>}
          {pwSuccess && <Alert type="success">{pwSuccess}</Alert>}
          <FormField label="Current Password">
            <Input
              value={currentPw}
              onChange={({ detail }) => setCurrentPw(detail.value)}
              type="password"
            />
          </FormField>
          <FormField label="New Password">
            <Input
              value={newPw}
              onChange={({ detail }) => setNewPw(detail.value)}
              type="password"
            />
          </FormField>
          <FormField
            label="Retype New Password"
            errorText={retypePw && newPw !== retypePw ? "Passwords do not match" : ""}
          >
            <Input
              value={retypePw}
              onChange={({ detail }) => setRetypePw(detail.value)}
              type="password"
              invalid={!!retypePw && newPw !== retypePw}
              onKeyDown={({ detail }) => {
                if (detail.key === "Enter") handlePasswordSubmit();
              }}
            />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={tfaModalOpen}
        onDismiss={() => setTfaModalOpen(false)}
        header="2FA Verification"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setTfaModalOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={pwLoading} onClick={handleTfaConfirm}>
                Verify
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {tfaError && <Alert type="error">{tfaError}</Alert>}
          <Box>Enter your 2FA code to confirm the password change.</Box>
          <FormField label="2FA Code">
            <Input
              value={tfaCode}
              onChange={({ detail }) => setTfaCode(detail.value)}
              placeholder="123456"
              onKeyDown={({ detail }) => {
                if (detail.key === "Enter") handleTfaConfirm();
              }}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
    </>
  );
}
