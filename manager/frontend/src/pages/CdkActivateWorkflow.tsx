import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Wizard from "@cloudscape-design/components/wizard";
import { type Account, type CdkKeyInfo, type CdkProviderInfo, fetchAccounts, fetchCdkProviders, validateCdk, activateCdk } from "../api/client";

export default function CdkActivateWorkflow() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stepError, setStepError] = useState("");

  // Providers
  const [providers, setProviders] = useState<CdkProviderInfo[]>([]);
  const [provider, setProvider] = useState<{ label: string; value: string } | null>(null);

  // Step 1: CDK
  const [cdkCode, setCdkCode] = useState("");
  const [cdkValidating, setCdkValidating] = useState(false);
  const [cdkInfo, setCdkInfo] = useState<CdkKeyInfo | null>(null);
  const [cdkError, setCdkError] = useState("");

  // Step 2: Account
  const [account, setAccount] = useState<{ label: string; value: string } | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const [accts, provs] = await Promise.all([fetchAccounts(), fetchCdkProviders()]);
      setAccounts(accts);
      setProviders(provs);
    } catch {
      void 0;
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleValidateCdk = async () => {
    if (!cdkCode.trim()) {
      setCdkError("CDK code is required");
      return;
    }
    setCdkValidating(true);
    setCdkError("");
    setCdkInfo(null);
    try {
      const info = await validateCdk(provider!.value, cdkCode.trim());
      setCdkInfo(info);
    } catch (e) {
      setCdkError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setCdkValidating(false);
    }
  };

  const handleNavigate = ({ detail }: { detail: { requestedStepIndex: number } }) => {
    if (detail.requestedStepIndex > activeStep) {
      if (activeStep === 0 && (!cdkInfo || cdkInfo.status !== "available" || !provider)) {
        setStepError("A valid, available CDK code and provider are required to proceed");
        return;
      }
      if (activeStep === 1 && !account) {
        setStepError("Please select an account");
        return;
      }
      setStepError("");
    }
    setActiveStep(detail.requestedStepIndex);
  };

  const handleSubmit = async () => {
    if (!account || !cdkInfo || !provider) return;
    setLoading(true);
    setError("");
    try {
      await activateCdk(account.value, cdkCode, provider.value);
      navigate("/workflows?success=CDK+activation+started+—+check+the+Runs+tab+for+status");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setLoading(false);
    }
  };

  const accountOptions = accounts
    .filter((a) => a.status === "active")
    .map((a) => ({ label: a.email, value: a.id, description: `${a.plan || "free"} plan` }));

  const selectedAccount = account ? accounts.find((a) => a.id === account.value) : null;

  return (
    <Wizard
      i18nStrings={{
        stepNumberLabel: (n) => `Step ${n}`,
        collapsedStepsLabel: (n, total) => `Step ${n} of ${total}`,
        submitButton: "Activate CDK",
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
          title: "CDK Code",
          description: "Enter the CDK activation code to validate",
          errorText: stepError && activeStep === 0 ? stepError : "",
          content: (
            <Container header={<Header variant="h2">CDK Code</Header>}>
              <SpaceBetween size="l">
                {providers.filter(p => p.is_enabled).length === 0 ? (
                  <Alert type="warning">No CDK providers configured. Add one in Settings first.</Alert>
                ) : (
                  <>
                    <FormField label="CDK Provider" constraintText="Select the CDK activation provider">
                      <Select
                        selectedOption={provider}
                        onChange={({ detail }) => setProvider(detail.selectedOption as { label: string; value: string })}
                        options={providers.filter(p => p.is_enabled).map(p => ({
                          label: p.name,
                          value: p.id,
                          description: p.provider_type,
                        }))}
                        placeholder="Select provider"
                        filteringType="auto"
                      />
                    </FormField>
                    <FormField label="CDK Code" constraintText="Enter the activation code and click Validate">
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Input
                            value={cdkCode}
                            onChange={({ detail }) => setCdkCode(detail.value)}
                            placeholder="Enter CDK code"
                          />
                        </div>
                        <Button onClick={handleValidateCdk} loading={cdkValidating} disabled={!cdkCode.trim() || !provider}>
                          Validate
                        </Button>
                      </div>
                    </FormField>
                    {cdkError && <Alert type="error">{cdkError}</Alert>}
                    {cdkInfo && (
                      <Container header={<Header variant="h3">Key Details</Header>}>
                        <ColumnLayout columns={3} variant="text-grid">
                          <SpaceBetween size="xxs">
                            <Box variant="awsui-key-label">Code</Box>
                            <Box variant="code">{cdkInfo.code}</Box>
                          </SpaceBetween>
                          <SpaceBetween size="xxs">
                            <Box variant="awsui-key-label">Status</Box>
                            <StatusIndicator type={cdkInfo.status === "available" ? "success" : "error"}>
                              {cdkInfo.status}
                            </StatusIndicator>
                          </SpaceBetween>
                          <SpaceBetween size="xxs">
                            <Box variant="awsui-key-label">Plan</Box>
                            <Box>{cdkInfo.plan.charAt(0).toUpperCase() + cdkInfo.plan.slice(1)}</Box>
                          </SpaceBetween>
                          <SpaceBetween size="xxs">
                            <Box variant="awsui-key-label">Term</Box>
                            <Box>{cdkInfo.term}</Box>
                          </SpaceBetween>
                          <SpaceBetween size="xxs">
                            <Box variant="awsui-key-label">Service</Box>
                            <Box>{cdkInfo.service}</Box>
                          </SpaceBetween>
                        </ColumnLayout>
                      </Container>
                    )}
                  </>
                )}
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Select Account",
          description: "Choose the ChatGPT account to apply the CDK to",
          errorText: stepError && activeStep === 1 ? stepError : "",
          content: (
            <Container header={<Header variant="h2">Select Account</Header>}>
              <SpaceBetween size="l">
                <FormField label="Account" constraintText="Only accounts with active sessions are shown">
                  <Select
                    selectedOption={account}
                    onChange={({ detail }) => setAccount(detail.selectedOption as { label: string; value: string })}
                    options={accountOptions}
                    placeholder="Select account"
                    filteringType="auto"
                  />
                </FormField>
                {selectedAccount?.plan && !["free", ""].includes(selectedAccount.plan.toLowerCase()) && (
                  <Alert type="warning">
                    This account already has an active plan ({selectedAccount.plan}). Applying a CDK may override it.
                  </Alert>
                )}
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Review",
          description: "Confirm the details before activating",
          content: (
            <SpaceBetween size="l">
              {error && <Alert type="error">{error}</Alert>}
              <Container header={<Header variant="h2">Review</Header>}>
                <ColumnLayout columns={2} variant="text-grid">
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Provider</Box>
                    <Box>{provider?.label || "-"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">CDK Code</Box>
                    <Box variant="code">{cdkInfo?.code || "-"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Plan</Box>
                    <Box>{cdkInfo ? cdkInfo.plan.charAt(0).toUpperCase() + cdkInfo.plan.slice(1) : "-"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Term</Box>
                    <Box>{cdkInfo?.term || "-"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Account</Box>
                    <Box>{account?.label || "-"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Current Plan</Box>
                    <Box>{selectedAccount?.plan || "free"}</Box>
                  </SpaceBetween>
                </ColumnLayout>
              </Container>
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}
