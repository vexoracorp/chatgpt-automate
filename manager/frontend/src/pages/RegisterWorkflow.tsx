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
import Tabs from "@cloudscape-design/components/tabs";
import Wizard from "@cloudscape-design/components/wizard";
import { type Proxy, type Mailbox, fetchProxies, fetchMailboxes, registerAccount } from "../api/client";

const FIRST_NAMES = ["James", "Emma", "Liam", "Olivia", "Noah", "Ava", "Lucas", "Sophia", "Mason", "Mia", "Ethan", "Isabella", "Logan", "Charlotte", "Aiden"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin"];

function randomName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

function randomPassword(): string {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const special = "!@#$%^&*_+-=";
  const all = lower + upper + digits + special;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const required = [pick(lower), pick(upper), pick(digits), pick(special)];
  for (let i = required.length; i < 16; i++) required.push(pick(all));
  for (let i = required.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [required[i], required[j]] = [required[j], required[i]];
  }
  return required.join("");
}

function randomBirthdate(): string {
  const year = 1985 + Math.floor(Math.random() * 15);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function RegisterWorkflow() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [emailMode, setEmailMode] = useState("custom");
  const [email, setEmail] = useState("");
  const [selectedMailbox, setSelectedMailbox] = useState<{ label: string; value: string } | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("Neo");
  const [birthdate, setBirthdate] = useState("");
  const [proxy, setProxy] = useState<{ label: string; value: string } | null>(null);
  const [runName, setRunName] = useState("");
  const [autoStart, setAutoStart] = useState(true);
  const [verbose, setVerbose] = useState(false);

  const [tried, setTried] = useState(false);

  const resolvedEmail = emailMode === "mailbox" ? (selectedMailbox?.value || "") : email;

  const ALLOWED_DOMAINS = [
    "gmail.com", "googlemail.com",
    "icloud.com", "me.com", "mac.com",
    "outlook.com", "hotmail.com", "live.com", "msn.com", "hotmail.co.kr", "outlook.kr",
  ];
  const emailDomain = email.includes("@") ? email.split("@")[1]?.toLowerCase() : "";
  const isCustomDomain = emailMode === "custom" && emailDomain !== "" && !ALLOWED_DOMAINS.includes(emailDomain);

  const passwordErrors: string[] = [];
  if (password) {
    if (password.length < 12) passwordErrors.push("At least 12 characters");
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) passwordErrors.push("At least 1 special character");
    if (/(.)\1{2,}/.test(password)) passwordErrors.push("No 3+ repeating characters");
    if (!/[A-Z]/.test(password)) passwordErrors.push("At least 1 uppercase letter");
    if (!/[a-z]/.test(password)) passwordErrors.push("At least 1 lowercase letter");
    if (!/[0-9]/.test(password)) passwordErrors.push("At least 1 number");
  }
  const passwordValid = password === "" || passwordErrors.length === 0;

  const validateStep = (step: number): boolean => {
    if (step === 0) {
      if (!resolvedEmail) return false;
      if (!birthdateValid) return false;
      if (!passwordValid) return false;
    }
    return true;
  };

  const handleNavigate = ({ detail }: { detail: { requestedStepIndex: number } }) => {
    if (detail.requestedStepIndex > activeStep) {
      setTried(true);
      if (!validateStep(activeStep)) return;
    }
    setTried(false);
    setActiveStep(detail.requestedStepIndex);
  };

  const birthdateValid = !birthdate || /^\d{4}-\d{2}-\d{2}$/.test(birthdate);

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

  const proxyOptions = [
    { label: "Direct (no proxy)", value: "" },
    ...proxies.map((p) => ({ label: p.label || p.url, value: p.url })),
  ];

  const handleRandomize = () => {
    setPassword(randomPassword());
    setName(randomName());
    setBirthdate(randomBirthdate());
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      await registerAccount({
        email: resolvedEmail,
        password: password || undefined,
        name: name || "Neo",
        birthdate: birthdate || undefined,
        proxy_url: proxy?.value || undefined,
        run_name: runName || undefined,
        auto_start: autoStart,
        verbose,
      });
      navigate("/workflows?success=Registration+started+—+OTP+will+be+handled+automatically");
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
        submitButton: "Start Registration",
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
          title: "Account Details",
          description: "Configure the ChatGPT account to register",
          errorText: "",
          content: (
            <Container header={
              <Header variant="h2" actions={<Button onClick={handleRandomize}>Randomize All</Button>}>
                Account Details
              </Header>
            }>
              <SpaceBetween size="l">
                <FormField label="Run name" constraintText="Optional label to identify this run in the Runs tab">
                  <Input value={runName} onChange={({ detail }) => setRunName(detail.value)} placeholder="e.g. batch-1-register" />
                </FormField>
                <FormField label="Email" errorText={tried && !resolvedEmail ? "Email is required" : ""}>
                  <Tabs
                    activeTabId={emailMode}
                    onChange={({ detail }) => setEmailMode(detail.activeTabId)}
                    disableContentPaddings
                    tabs={[
                      {
                        id: "custom",
                        label: "Custom",
                        content: (
                          <SpaceBetween size="xs">
                            <Input value={email} onChange={({ detail }) => setEmail(detail.value)} placeholder="user@example.com" type="email" />
                            {isCustomDomain && (
                              <Alert type="warning">
                                ChatGPT has blocked sign-ups from custom email domains to prevent fraudulent activity. Using <b>{emailDomain}</b> may cause this workflow to fail. Use Gmail, iCloud, or Outlook for reliable registration.
                              </Alert>
                            )}
                          </SpaceBetween>
                        ),
                      },
                      {
                        id: "mailbox",
                        label: "From Mailbox",
                        content: (
                          <Select
                            selectedOption={selectedMailbox}
                            onChange={({ detail }) => setSelectedMailbox(detail.selectedOption as { label: string; value: string })}
                            options={mailboxes.map((m) => ({ label: m.email, value: m.email }))}
                            placeholder="Select a mailbox"
                            filteringType="auto"
                          />
                        ),
                      },
                    ]}
                  />
                </FormField>
                <FormField
                  label="Password"
                  constraintText="Leave empty to auto-generate. Must be 12+ chars with uppercase, lowercase, number, and special character."
                  errorText={tried && !passwordValid ? passwordErrors.join(". ") : ""}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <Input value={password} onChange={({ detail }) => setPassword(detail.value)} type={showPassword ? "text" : "password"} />
                    </div>
                    <Button
                      iconName={showPassword ? "view-full" : "view-off"}
                      variant="icon"
                      onClick={() => setShowPassword(!showPassword)}
                      ariaLabel={showPassword ? "Hide password" : "Show password"}
                    />
                  </div>
                </FormField>
                <FormField label="Display Name">
                  <Input value={name} onChange={({ detail }) => setName(detail.value)} />
                </FormField>
                <FormField
                  label="Birthdate"
                  constraintText="Format: YYYY-MM-DD. Leave empty to auto-generate"
                  errorText={!birthdateValid ? "Invalid format. Use YYYY-MM-DD" : ""}
                >
                  <Input value={birthdate} onChange={({ detail }) => setBirthdate(detail.value)} placeholder="1995-03-15" invalid={!birthdateValid} />
                </FormField>
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Network",
          content: (
            <Container header={<Header variant="h2">Proxy Configuration</Header>}>
              <FormField label="Proxy" constraintText="Select a proxy for the registration request">
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
                    <Box>{resolvedEmail || "-"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Password</Box>
                    <Box>{password ? "••••••••" : "Auto-generate"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Display Name</Box>
                    <Box>{name || "Neo"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Birthdate</Box>
                    <Box>{birthdate || "Auto-generate"}</Box>
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
