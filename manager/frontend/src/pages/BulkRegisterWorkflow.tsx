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
import Multiselect from "@cloudscape-design/components/multiselect";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
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
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$";
  let pw = "";
  for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

function randomBirthdate(): string {
  const year = 1985 + Math.floor(Math.random() * 15);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface AccountEntry {
  email: string;
  password: string;
  name: string;
  birthdate: string;
  status: "pending" | "running" | "success" | "error";
  message: string;
}

export default function BulkRegisterWorkflow() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const [selectedMailboxOptions, setSelectedMailboxOptions] = useState<ReadonlyArray<{ label: string; value: string }>>([]);
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);
  const [proxy, setProxy] = useState<{ label: string; value: string } | null>(null);
  const [progress, setProgress] = useState(0);

  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");

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

  const mailboxOptions = mailboxes.map((m) => ({ label: m.email, value: m.email }));

  const handleMailboxChange = (selected: ReadonlyArray<{ label: string; value: string }>) => {
    setSelectedMailboxOptions(selected);
    const existingMap = new Map(accounts.map((a) => [a.email, a]));
    const newAccounts: AccountEntry[] = selected.map((opt) => {
      const existing = existingMap.get(opt.value);
      if (existing) {
        return {
          ...existing,
          password: existing.password || randomPassword(),
          name: existing.name || randomName(),
          birthdate: existing.birthdate || randomBirthdate(),
        };
      }
      return {
        email: opt.value,
        password: randomPassword(),
        name: randomName(),
        birthdate: randomBirthdate(),
        status: "pending" as const,
        message: "",
      };
    });
    setAccounts(newAccounts);
  };

  const randomizeAll = () => {
    setAccounts(accounts.map((a) => ({
      ...a,
      password: randomPassword(),
      name: randomName(),
      birthdate: randomBirthdate(),
    })));
  };

  const startEdit = (row: number, col: string, value: string) => {
    setEditingCell({ row, col });
    setEditValue(value);
    setEditError("");
  };

  const saveEdit = () => {
    if (!editingCell) return;
    const { row, col } = editingCell;
    if (col === "birthdate" && editValue && !/^\d{4}-\d{2}-\d{2}$/.test(editValue)) {
      setEditError("Format: YYYY-MM-DD");
      return;
    }
    setAccounts((prev) => prev.map((a, i) => i === row ? { ...a, [col]: editValue } : a));
    setEditingCell(null);
    setEditValue("");
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
    setEditError("");
  };

  const renderEditableCell = (item: AccountEntry, index: number, col: string, value: string) => {
    if (editingCell?.row === index && editingCell?.col === col) {
      return (
        <SpaceBetween size="xxxs">
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <Input
                value={editValue}
                onChange={({ detail }) => { setEditValue(detail.value); setEditError(""); }}
                onKeyDown={({ detail }) => {
                  if (detail.key === "Enter") saveEdit();
                  if (detail.key === "Escape") cancelEdit();
                }}
                autoFocus
                invalid={!!editError}
                placeholder={col === "birthdate" ? "YYYY-MM-DD" : undefined}
              />
            </div>
            <Button iconName="check" variant="inline-icon" onClick={saveEdit} />
            <Button iconName="close" variant="inline-icon" onClick={cancelEdit} />
          </div>
          {editError && <Box color="text-status-error" fontSize="body-s">{editError}</Box>}
        </SpaceBetween>
      );
    }
    return (
      <span
        onClick={() => startEdit(index, col, value)}
        style={{ cursor: "pointer", borderBottom: "1px dashed #aab7b8", paddingBottom: 1 }}
      >
        {value || <Box color="text-status-inactive">—</Box>}
      </span>
    );
  };

  const handleSubmit = async () => {
    const entries: AccountEntry[] = accounts.map((a) => ({ ...a, status: "pending", message: "" }));
    setAccounts(entries);
    setRunning(true);
    setError("");
    setProgress(0);

    for (let i = 0; i < entries.length; i++) {
      entries[i] = { ...entries[i], status: "running" };
      setAccounts([...entries]);
      try {
        await registerAccount({
          email: entries[i].email,
          password: entries[i].password || undefined,
          name: entries[i].name || "Neo",
          birthdate: entries[i].birthdate || undefined,
          proxy_url: proxy?.value || undefined,
        });
        entries[i] = { ...entries[i], status: "success", message: "Started" };
      } catch (e) {
        entries[i] = { ...entries[i], status: "error", message: e instanceof Error ? e.message : "Failed" };
      }
      setAccounts([...entries]);
      setProgress(Math.round(((i + 1) / entries.length) * 100));
    }

    setRunning(false);
  };

  const successCount = accounts.filter((a) => a.status === "success").length;
  const errorCount = accounts.filter((a) => a.status === "error").length;
  const isDone = accounts.length > 0 && !running && accounts.every((a) => a.status === "success" || a.status === "error");

  return (
    <Wizard
      i18nStrings={{
        stepNumberLabel: (n) => `Step ${n}`,
        collapsedStepsLabel: (n, total) => `Step ${n} of ${total}`,
        submitButton: running ? "Running..." : "Start Bulk Registration",
        cancelButton: isDone ? "Done" : "Cancel",
        previousButton: "Previous",
        nextButton: "Next",
      }}
      onCancel={() => navigate("/workflows")}
      onSubmit={handleSubmit}
      isLoadingNextStep={running}
      activeStepIndex={activeStep}
      onNavigate={({ detail }) => {
        if (!running) setActiveStep(detail.requestedStepIndex);
      }}
      steps={[
        {
          title: "Select Accounts",
          content: (
            <Container
              header={
                <Header
                  variant="h2"
                  actions={
                    accounts.length > 0 ? (
                      <Button onClick={randomizeAll} iconName="refresh">Randomize All</Button>
                    ) : undefined
                  }
                >
                  Accounts from Mailbox
                </Header>
              }
            >
              <SpaceBetween size="l">
                <FormField
                  label="Select mailboxes"
                  description="Choose email accounts from your mailbox list. Only mailbox emails are supported for registration."
                >
                  <Multiselect
                    selectedOptions={selectedMailboxOptions}
                    onChange={({ detail }) => handleMailboxChange(detail.selectedOptions as ReadonlyArray<{ label: string; value: string }>)}
                    options={mailboxOptions}
                    placeholder="Select mailboxes to register"
                    filteringType="auto"
                    tokenLimit={3}
                  />
                </FormField>
                {accounts.length > 0 && (
                  <Table
                    items={accounts.map((a, i) => ({ ...a, _index: i }))}
                    columnDefinitions={[
                      {
                        id: "email",
                        header: "Email",
                        cell: (item) => <Box fontWeight="bold">{item.email}</Box>,
                        width: 260,
                      },
                      {
                        id: "password",
                        header: "Password",
                        cell: (item) => renderEditableCell(item, item._index, "password", item.password),
                        width: 220,
                      },
                      {
                        id: "name",
                        header: "Display Name",
                        cell: (item) => renderEditableCell(item, item._index, "name", item.name),
                        width: 200,
                      },
                      {
                        id: "birthdate",
                        header: "Birthdate",
                        cell: (item) => renderEditableCell(item, item._index, "birthdate", item.birthdate),
                        width: 160,
                      },
                    ]}
                    variant="embedded"
                    empty={<Box textAlign="center" color="text-body-secondary">No accounts selected</Box>}
                  />
                )}
                {accounts.length > 0 && (
                  <Box color="text-body-secondary" fontSize="body-s">
                    {accounts.length} account(s) selected — click any cell to edit
                  </Box>
                )}
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Settings",
          content: (
            <Container header={<Header variant="h2">Common Settings</Header>}>
              <SpaceBetween size="l">
                <FormField label="Proxy" constraintText="Applied to all registration requests">
                  <Select
                    selectedOption={proxy}
                    onChange={({ detail }) => setProxy(detail.selectedOption as { label: string; value: string })}
                    options={proxyOptions}
                    placeholder="Direct (no proxy)"
                  />
                </FormField>
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: "Review & Run",
          content: (
            <SpaceBetween size="l">
              {error && <Alert type="error">{error}</Alert>}
              {isDone && (
                <Alert type={errorCount === 0 ? "success" : "warning"}>
                  Completed: {successCount} succeeded, {errorCount} failed out of {accounts.length}
                </Alert>
              )}
              <Container header={<Header variant="h2">Summary</Header>}>
                <ColumnLayout columns={2} variant="text-grid">
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Accounts</Box>
                    <Box>{accounts.length}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Proxy</Box>
                    <Box>{proxy?.label || "Direct (no proxy)"}</Box>
                  </SpaceBetween>
                </ColumnLayout>
              </Container>
              <Table
                items={accounts}
                columnDefinitions={[
                  { id: "email", header: "Email", cell: (item) => item.email, width: 260 },
                  { id: "password", header: "Password", cell: (item) => "••••••••", width: 120 },
                  { id: "name", header: "Display Name", cell: (item) => item.name, width: 180 },
                  { id: "birthdate", header: "Birthdate", cell: (item) => item.birthdate, width: 140 },
                  {
                    id: "status",
                    header: "Status",
                    cell: (item) => {
                      if (item.status === "pending") return <StatusIndicator type="pending">Pending</StatusIndicator>;
                      if (item.status === "running") return <StatusIndicator type="in-progress">Running</StatusIndicator>;
                      if (item.status === "success") return <StatusIndicator type="success">Success</StatusIndicator>;
                      return <StatusIndicator type="error">{item.message}</StatusIndicator>;
                    },
                  },
                ]}
                empty={<Box textAlign="center" color="text-body-secondary">No accounts</Box>}
              />
              {(running || isDone) && <ProgressBar value={progress} label="Registration progress" />}
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}
