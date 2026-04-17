import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Wizard from "@cloudscape-design/components/wizard";
import { type Account, fetchAccounts, startCodexDevice, fetchWorkspaceId, getAccountMailbox, executeAccountAction, fetchMailboxes, bindAccountMailbox, fetchProxies, fetchAccountSettings, type Proxy } from "../api/client";

export default function CodexDeviceWorkflow() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [account, setAccount] = useState<{ label: string; value: string } | null>(null);
  const [deviceCode, setDeviceCode] = useState("");
  const [deviceCodeError, setDeviceCodeError] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [runName, setRunName] = useState("");
  const [autoStart, setAutoStart] = useState(true);
  const [verbose, setVerbose] = useState(false);
  const [stepError, setStepError] = useState("");

  const [fetchingWorkspace, setFetchingWorkspace] = useState(false);
  const [accountWarning, setAccountWarning] = useState("");
  const [accountBlocked, setAccountBlocked] = useState(false);
  const [validatingAccount, setValidatingAccount] = useState(false);
  const [recommendedMailbox, setRecommendedMailbox] = useState<{ id: string; email: string } | null>(null);
  const [bindingMailbox, setBindingMailbox] = useState(false);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [proxyOption, setProxyOption] = useState<{ label: string; value: string } | null>(null);

  const handleNavigate = ({ detail }: { detail: { requestedStepIndex: number } }) => {
    if (detail.requestedStepIndex > activeStep) {
      if (activeStep === 0 && !account) {
        setStepError("Account is required");
        return;
      }
      if (activeStep === 0 && accountBlocked) {
        return;
      }
      if (activeStep === 0 && validatingAccount) {
        return;
      }
      if (activeStep === 1 && (!deviceCode || !workspaceId)) {
        setStepError(!deviceCode ? "Device code is required" : "Workspace ID is required");
        return;
      }
      if (activeStep === 1 && deviceCodeError) {
        setStepError(deviceCodeError);
        return;
      }
      setStepError("");
    }
    setActiveStep(detail.requestedStepIndex);
  };

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await fetchAccounts());
    } catch {
      void 0;
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const validateAccount = useCallback(async (accountId: string) => {
    setValidatingAccount(true);
    setAccountWarning("");
    setAccountBlocked(false);
    setRecommendedMailbox(null);
    try {
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc) return;

      const mbRes = await getAccountMailbox(accountId);
      if (!mbRes.mailbox) {
        const mailboxes = await fetchMailboxes();
        const match = mailboxes.find(
          (m) => m.status === "available" && m.email.toLowerCase() === acc.email.toLowerCase()
        );
        if (match) {
          setRecommendedMailbox({ id: match.id, email: match.email });
          setAccountWarning(`No mailbox bound. Found matching mailbox: ${match.email}`);
        } else {
          setAccountWarning("No mailbox bound. Mailbox binding is required for Codex OAuth (OTP verification). Bind one in the account settings first.");
        }
        setAccountBlocked(true);
        return;
      }

      const plan = (acc.plan || "").toLowerCase();
      if (plan.includes("free") || !plan) {
        try {
          const meRes = await executeAccountAction(accountId, "get_me");
          const phoneNumber = (meRes.result as Record<string, unknown>)?.phone_number;
          if (!phoneNumber) {
            setAccountWarning("Free plan accounts without a registered phone number cannot use Codex. Please upgrade to a paid plan or register a phone number first.");
            setAccountBlocked(true);
            return;
          }
        } catch {
          setAccountWarning("Could not verify phone number. Free plan accounts may require a phone number for Codex.");
        }
      }

      try {
        const settingsRes = await fetchAccountSettings(accountId);
        const outer = settingsRes.settings as Record<string, unknown> | undefined;
        const inner = outer?.settings as Record<string, unknown> | undefined;
        const enabled = inner?.enable_device_code_auth ?? outer?.enable_device_code_auth;
        if (!enabled) {
          setAccountWarning("Device Code Auth is disabled for this account. Enable it in the account's Security settings first.");
          setAccountBlocked(true);
          return;
        }
      } catch {
        void 0;
      }
    } catch (e) {
      setAccountWarning(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setValidatingAccount(false);
    }
  }, [accounts]);

  const handleAccountChange = (opt: { label: string; value: string }) => {
    setAccount(opt);
    setAccountWarning("");
    setAccountBlocked(false);
    setRecommendedMailbox(null);
    validateAccount(opt.value);

    const acc = accounts.find((a) => a.id === opt.value);
    if (acc?.proxy_url && acc.proxy_label) {
      setProxyOption({ label: `${acc.proxy_label} (current)`, value: "__account__" });
    } else if (acc?.proxy_url) {
      setProxyOption({ label: "Account proxy (current)", value: "__account__" });
    } else {
      setProxyOption({ label: "Direct (no proxy)", value: "" });
    }

    fetchProxies().then(setProxies).catch(() => {});
  };

  const handleQuickBind = async () => {
    if (!account || !recommendedMailbox) return;
    setBindingMailbox(true);
    try {
      await bindAccountMailbox(account.value, recommendedMailbox.id);
      setRecommendedMailbox(null);
      setAccountWarning("");
      setAccountBlocked(false);
      validateAccount(account.value);
    } catch (e) {
      setAccountWarning(e instanceof Error ? e.message : "Bind failed");
    } finally {
      setBindingMailbox(false);
    }
  };

  const handleFetchWorkspace = async () => {
    if (!account) return;
    setFetchingWorkspace(true);
    try {
      const wsId = await fetchWorkspaceId(account.value);
      setWorkspaceId(wsId);
    } catch (e) {
      setStepError(e instanceof Error ? e.message : "Failed to fetch workspace ID");
    } finally {
      setFetchingWorkspace(false);
    }
  };

  const accountOptions = accounts
    .filter((a) => a.status === "active")
    .map((a) => ({ label: a.email, value: a.id, description: `${a.plan || "free"} plan` }));

  const proxyOptions = [
    { label: "Account proxy (current)", value: "__account__" },
    { label: "Direct (no proxy)", value: "" },
    ...proxies.map((p) => ({ label: p.label || p.url, value: p.url })),
  ];

  const handleSubmit = async () => {
    if (!account || !deviceCode || !workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const proxyUrl = proxyOption?.value === "__account__" ? undefined : (proxyOption?.value || undefined);
      const code = deviceCode.replace("-", "").toUpperCase();
      await startCodexDevice({
        account_id: account.value,
        user_code: deviceCode.toUpperCase(),
        device_code: code,
        workspace_id: workspaceId,
        proxy_url: proxyUrl,
        run_name: runName || undefined,
        auto_start: autoStart,
        verbose,
      });
      navigate("/workflows?success=Codex+device+login+started+—+check+your+CLI");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setLoading(false);
    }
  };

  return (
    <Wizard
      i18nStrings={{
        stepNumberLabel: (n) => `Step ${n}`,
        collapsedStepsLabel: (n, total) => `Step ${n} of ${total}`,
        submitButton: "Start Device Login",
        cancelButton: "Cancel",
        previousButton: "Previous",
        nextButton: "Next",
      }}
      onCancel={() => navigate("/workflows")}
      onSubmit={handleSubmit}
      isLoadingNextStep={loading}
      activeStepIndex={activeStep}
      onNavigate={handleNavigate}
      steps={[
        {
          title: "Account",
          description: "Select the ChatGPT account to authorize for Codex CLI access",
          errorText: stepError && activeStep === 0 ? stepError : "",
          content: (
            <Container header={<Header variant="h2">Select Account</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="Account"
                  constraintText={!accountWarning ? "Only accounts with active sessions are shown" : undefined}
                  errorText={!recommendedMailbox ? accountWarning || undefined : undefined}
                >
                  <Select
                    selectedOption={account}
                    onChange={({ detail }) => handleAccountChange(detail.selectedOption as { label: string; value: string })}
                    options={accountOptions}
                    placeholder="Select account"
                    filteringType="auto"
                    invalid={accountBlocked && !recommendedMailbox}
                  />
                </FormField>
                {validatingAccount && <Box><Spinner /> Validating account...</Box>}
                {recommendedMailbox && (
                  <Alert
                    type="warning"
                    action={<Button loading={bindingMailbox} onClick={handleQuickBind}>Bind {recommendedMailbox.email}</Button>}
                  >
                    No mailbox bound. A matching mailbox was found.
                  </Alert>
                )}
                <FormField label="Run name" constraintText="Optional label to identify this run in the Runs tab">
                  <Input value={runName} onChange={({ detail }) => setRunName(detail.value)} placeholder="e.g. codex-device-1" />
                </FormField>
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Device Code",
          description: "Run 'codex login' in your terminal. It will show a user code and device code. Enter them below.",
          errorText: stepError && activeStep === 1 ? stepError : "",
          content: (
            <Container header={<Header variant="h2">Device Code Details</Header>}>
              <SpaceBetween size="l">
                <Alert type="info">
                  Run <Box variant="code" display="inline">codex login</Box> in your terminal. It will display a device code (e.g. WBCP-T1J51). Enter it below along with your workspace ID.
                </Alert>
                <FormField
                  label="Device Code"
                  constraintText="Format: XXXX-XXXXX (uppercase letters and numbers, e.g. WBCP-T1J51)"
                  errorText={deviceCodeError || undefined}
                >
                  <Input
                    value={deviceCode}
                    onChange={({ detail }) => {
                      const val = detail.value.toUpperCase();
                      setDeviceCode(val);
                      if (val && !/^[A-Z0-9]{4}-[A-Z0-9]{5}$/.test(val)) {
                        setDeviceCodeError("Format must be XXXX-XXXXX (e.g. WBCP-T1J51)");
                      } else {
                        setDeviceCodeError("");
                      }
                    }}
                    placeholder="WBCP-T1J51"
                  />
                </FormField>
                <FormField label="Workspace ID" constraintText="Your OpenAI organization/workspace ID (e.g. org-abc123)">
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Input value={workspaceId} onChange={({ detail }) => setWorkspaceId(detail.value)} placeholder="org-..." />
                    </div>
                    <Button onClick={handleFetchWorkspace} loading={fetchingWorkspace} disabled={!account}>
                      Fetch
                    </Button>
                  </div>
                </FormField>
                <FormField label="Proxy" constraintText="Override the proxy used for this device login flow">
                  <Select
                    selectedOption={proxyOption}
                    onChange={({ detail }) => setProxyOption(detail.selectedOption as { label: string; value: string })}
                    options={proxyOptions}
                    placeholder="Account proxy (current)"
                  />
                </FormField>
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Review",
          description: "Confirm the details before starting the device login flow",
          content: (
            <SpaceBetween size="l">
              {error && <Alert type="error">{error}</Alert>}
              <Container header={<Header variant="h2">Review</Header>}>
                <ColumnLayout columns={2} variant="text-grid">
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Account</Box>
                    <Box>{account?.label || "-"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Workspace ID</Box>
                    <Box>{workspaceId || "-"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Run name</Box>
                    <Box>{runName || "(auto-generated)"}</Box>
                  </SpaceBetween>
                </ColumnLayout>
                <SpaceBetween size="xxs">
                  <Box variant="awsui-key-label">Device Code</Box>
                  <Box variant="code">{deviceCode || "-"}</Box>
                </SpaceBetween>
              </Container>
              <Checkbox checked={autoStart} onChange={({ detail }) => setAutoStart(detail.checked)}>
                Start immediately
              </Checkbox>
              <Checkbox checked={verbose} onChange={({ detail }) => setVerbose(detail.checked)}>
                Verbose logging (include HTTP request details)
              </Checkbox>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}
