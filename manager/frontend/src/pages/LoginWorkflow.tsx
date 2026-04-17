import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Wizard from "@cloudscape-design/components/wizard";
import { type Proxy, type Mailbox, fetchProxies, fetchMailboxes, loginAccount } from "../api/client";

export default function LoginWorkflow() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [emailSource, setEmailSource] = useState<"manual" | "mailbox">("manual");
  const [selectedMailbox, setSelectedMailbox] = useState<{ label: string; value: string } | null>(null);
  const [proxy, setProxy] = useState<{ label: string; value: string } | null>(null);
  const [runName, setRunName] = useState("");
  const [autoStart, setAutoStart] = useState(true);
  const [verbose, setVerbose] = useState(false);
  const [stepError, setStepError] = useState("");

  const handleNavigate = ({ detail }: { detail: { requestedStepIndex: number } }) => {
    if (detail.requestedStepIndex > activeStep) {
      if (activeStep === 0 && !email) {
        setStepError("Email is required");
        return;
      }
      setStepError("");
    }
    setActiveStep(detail.requestedStepIndex);
  };

  const loadData = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([fetchProxies(), fetchMailboxes()]);
      setProxies(p);
      setMailboxes(m);
    } catch {
      void 0;
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const mailboxOptions = mailboxes
    .filter((m) => m.status === "available")
    .map((m) => ({ label: m.email, value: m.email }));

  const proxyOptions = [
    { label: "Direct (no proxy)", value: "" },
    ...proxies.map((p) => ({ label: p.label || p.url, value: p.url })),
  ];

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      await loginAccount({
        email,
        proxy_url: proxy?.value || undefined,
        run_name: runName || undefined,
        auto_start: autoStart,
        verbose,
      });
      navigate("/workflows?success=Login+started+—+OTP+will+be+handled+automatically");
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
        submitButton: "Start Login",
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
          description: "Enter the email of the ChatGPT account to login",
          errorText: stepError && activeStep === 0 ? stepError : "",
          content: (
            <Container header={<Header variant="h2">Account</Header>}>
              <SpaceBetween size="l">
                <FormField label="Run name" constraintText="Optional label to identify this run in the Runs tab">
                  <Input value={runName} onChange={({ detail }) => setRunName(detail.value)} placeholder="e.g. login-batch-1" />
                </FormField>
                <FormField label="Email" constraintText="Enter manually or select from mailboxes">
                  <SpaceBetween size="xs">
                    <Select
                      selectedOption={
                        emailSource === "manual"
                          ? { label: "Manual input", value: "manual" }
                          : { label: "From mailbox", value: "mailbox" }
                      }
                      onChange={({ detail }) => {
                        const src = detail.selectedOption.value as "manual" | "mailbox";
                        setEmailSource(src);
                        if (src === "manual") {
                          setSelectedMailbox(null);
                        } else {
                          setEmail("");
                        }
                      }}
                      options={[
                        { label: "Manual input", value: "manual" },
                        { label: "From mailbox", value: "mailbox" },
                      ]}
                    />
                    {emailSource === "manual" ? (
                      <Input value={email} onChange={({ detail }) => setEmail(detail.value)} placeholder="user@example.com" type="email" />
                    ) : (
                      <Select
                        selectedOption={selectedMailbox}
                        onChange={({ detail }) => {
                          const opt = detail.selectedOption as { label: string; value: string };
                          setSelectedMailbox(opt);
                          setEmail(opt.value);
                        }}
                        options={mailboxOptions}
                        placeholder="Select a mailbox"
                        filteringType="auto"
                      />
                    )}
                  </SpaceBetween>
                </FormField>
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Network",
          content: (
            <Container header={<Header variant="h2">Proxy Configuration</Header>}>
              <FormField label="Proxy" constraintText="Select a proxy for the login request">
                <Select
                  selectedOption={proxy}
                  onChange={({ detail }) => setProxy(detail.selectedOption as { label: string; value: string })}
                  options={proxyOptions}
                  placeholder="Direct (no proxy)"
                />
              </FormField>
            </Container>
          ),
        },
        {
          title: "Review",
          content: (
            <SpaceBetween size="l">
              {error && <Alert type="error">{error}</Alert>}
              <Container header={<Header variant="h2">Review</Header>}>
                <ColumnLayout columns={2} variant="text-grid">
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Email</Box>
                    <Box>{email || "-"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Proxy</Box>
                    <Box>{proxy?.label || "Direct (no proxy)"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Run name</Box>
                    <Box>{runName || "(auto-generated)"}</Box>
                  </SpaceBetween>
                </ColumnLayout>
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
