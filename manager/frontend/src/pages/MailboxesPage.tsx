import { useEffect, useState, useCallback } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FileUpload from "@cloudscape-design/components/file-upload";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import MailViewerModal from "../components/MailViewerModal";
import {
  type Mailbox,
  fetchMailboxes,
  createMailbox,
  importMailboxesText,
  importMailboxesFile,
  deleteMailbox,
  fetchMailboxOTP,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function MailboxesPage() {
  const { role } = useAuth();
  const canWrite = role !== "user";
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Mailbox[]>([]);
  const [addVisible, setAddVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [mailsVisible, setMailsVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [importJson, setImportJson] = useState("");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importTab, setImportTab] = useState("text");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedMailbox, setSelectedMailbox] = useState("");
  const [selectedMailboxEmail, setSelectedMailboxEmail] = useState("");
  const [otpLoading, setOtpLoading] = useState<string | null>(null);
  const [otpResult, setOtpResult] = useState<{ id: string; code: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMailboxes(await fetchMailboxes());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetAdd = () => {
    setEmail("");
    setPassword("");
    setRefreshToken("");
    setClientId("");
    setError("");
  };

  const handleAdd = async () => {
    if (!email) return;
    setCreating(true);
    setError("");
    try {
      await createMailbox({
        email,
        password: password || undefined,
        refresh_token: refreshToken || undefined,
        client_id: clientId || undefined,
      });
      resetAdd();
      setAddVisible(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add mailbox");
    } finally {
      setCreating(false);
    }
  };

  const handleImport = async () => {
    setCreating(true);
    setError("");
    setSuccess("");
    try {
      let result: { imported: number; skipped: number };
      if (importTab === "file" && importFiles.length > 0) {
        result = await importMailboxesFile(importFiles[0]);
      } else if (importJson.trim()) {
        result = await importMailboxesText(importJson);
      } else {
        setError("No data provided");
        return;
      }
      setSuccess(`Imported ${result.imported}, skipped ${result.skipped}`);
      setImportJson("");
      setImportFiles([]);
      setImportVisible(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    for (const mb of selected) {
      await deleteMailbox(mb.id);
    }
    setSelected([]);
    await load();
  };

  const handleViewMails = (mbId: string) => {
    const mb = mailboxes.find((m) => m.id === mbId);
    setSelectedMailbox(mbId);
    setSelectedMailboxEmail(mb?.email || mbId);
    setMailsVisible(true);
  };

  const handleGetOTP = async (mbId: string) => {
    setOtpLoading(mbId);
    setOtpResult(null);
    try {
      const result = await fetchMailboxOTP(mbId);
      setOtpResult({ id: mbId, code: result.otp_code });
      navigator.clipboard.writeText(result.otp_code);
    } catch {
      setOtpResult({ id: mbId, code: "—" });
      setTimeout(() => setOtpResult((prev) => prev?.id === mbId ? null : prev), 1500);
    } finally {
      setOtpLoading(null);
    }
  };

  return (
    <SpaceBetween size="l">
      {success && (
        <Alert type="success" dismissible onDismiss={() => setSuccess("")}>
          {success}
        </Alert>
      )}

      <Modal
        visible={addVisible}
        onDismiss={() => { setAddVisible(false); resetAdd(); }}
        header={<Header variant="h2">Add Mailbox</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => { setAddVisible(false); resetAdd(); }}>Cancel</Button>
              <Button variant="primary" loading={creating} onClick={handleAdd} disabled={!email}>Add</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {error && <Alert type="error">{error}</Alert>}
          <FormField label="Email">
            <Input value={email} onChange={({ detail }) => setEmail(detail.value)} placeholder="user@outlook.com" type="email" />
          </FormField>
          <FormField label="Password">
            <Input value={password} onChange={({ detail }) => setPassword(detail.value)} type="password" />
          </FormField>
          <FormField label="Refresh Token" constraintText="Outlook OAuth refresh token">
            <Input value={refreshToken} onChange={({ detail }) => setRefreshToken(detail.value)} />
          </FormField>
          <FormField label="Client ID" constraintText="Azure app client ID">
            <Input value={clientId} onChange={({ detail }) => setClientId(detail.value)} />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={importVisible}
        size="large"
        onDismiss={() => { setImportVisible(false); setError(""); }}
        header={<Header variant="h2">Import Mailboxes</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setImportVisible(false)}>Cancel</Button>
              <Button variant="primary" loading={creating} onClick={handleImport}>Import</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {error && <Alert type="error">{error}</Alert>}
          <Tabs
            activeTabId={importTab}
            onChange={({ detail }) => setImportTab(detail.activeTabId)}
            tabs={[
              {
                id: "text",
                label: "Text",
                content: (
                  <FormField
                    label="Paste lines"
                    constraintText="email----password----refresh_token----client_id (one per line)"
                  >
                    <Textarea
                      value={importJson}
                      onChange={({ detail }) => setImportJson(detail.value)}
                      rows={10}
                      placeholder={"user1@outlook.com----pass1----refresh_tok1----client_id1\nuser2@outlook.com----pass2----refresh_tok2----client_id2"}
                    />
                  </FormField>
                ),
              },
              {
                id: "json",
                label: "JSON",
                content: (
                  <FormField
                    label="JSON Array"
                    constraintText='[{"email":"...","refresh_token":"...","client_id":"..."}]'
                  >
                    <Textarea
                      value={importJson}
                      onChange={({ detail }) => setImportJson(detail.value)}
                      rows={10}
                    />
                  </FormField>
                ),
              },
              {
                id: "file",
                label: "File",
                content: (
                  <FormField
                    label="Upload file"
                    constraintText=".json or .txt file"
                  >
                    <FileUpload
                      value={importFiles}
                      onChange={({ detail }) => setImportFiles(detail.value)}
                      accept=".json,.txt"
                      i18nStrings={{
                        uploadButtonText: (multiple) => multiple ? "Choose files" : "Choose file",
                        dropzoneText: (multiple) => multiple ? "Drop files here" : "Drop file here",
                        removeFileAriaLabel: (idx) => `Remove file ${idx + 1}`,
                        limitShowFewer: "Show fewer",
                        limitShowMore: "Show more",
                        errorIconAriaLabel: "Error",
                        warningIconAriaLabel: "Warning",
                      }}
                    />
                  </FormField>
                ),
              },
            ]}
          />
        </SpaceBetween>
      </Modal>

      <MailViewerModal
        visible={mailsVisible}
        onDismiss={() => setMailsVisible(false)}
        mailboxId={selectedMailbox}
        mailboxEmail={selectedMailboxEmail}
      />

      <Table
        header={
          <Header
            counter={`(${mailboxes.length})`}
            description="Get OTP fetches the most recent OTP received within the last 2 minutes."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={load} iconName="refresh" loading={loading} />
                {canWrite && <Button disabled={selected.length === 0} onClick={handleDelete}>Delete</Button>}
                {canWrite && <Button onClick={() => { setError(""); setImportVisible(true); }}>Import</Button>}
                <Button onClick={() => {
                  const rows = mailboxes.map((m) => [m.email, m.status, m.assigned_account_id ?? "", m.created_at ?? ""].join(","));
                  const csv = ["email,status,assigned_account_id,created_at", ...rows].join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `mailboxes-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}>Export</Button>
                {canWrite && <Button variant="primary" onClick={() => { resetAdd(); setAddVisible(true); }}>Add Mailbox</Button>}
              </SpaceBetween>
            }
          >
            Mailboxes
          </Header>
        }
        items={mailboxes}
        loading={loading}
        loadingText="Loading mailboxes..."
        selectionType={canWrite ? "multi" : undefined}
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <b>No mailboxes</b>
              <Button onClick={() => setAddVisible(true)}>Add Mailbox</Button>
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          { id: "email", header: "Email", cell: (item) => item.email },
          {
            id: "status",
            header: "Status",
            cell: (item) => (
              <StatusIndicator type={item.status === "available" ? "success" : "info"}>
                {item.status}
              </StatusIndicator>
            ),
          },
          {
            id: "assigned",
            header: "Assigned To",
            cell: (item) => item.assigned_account_id || "-",
          },
          {
            id: "mails",
            header: "Mails",
            cell: (item) => (
              <Button variant="inline-link" onClick={() => handleViewMails(item.id)}>
                View
              </Button>
            ),
            width: 80,
          },
          {
            id: "otp",
            header: "OTP",
            cell: (item) => {
              const result = otpResult?.id === item.id ? otpResult.code : null;
              if (otpLoading === item.id) return <Button variant="inline-link" loading><span style={{ whiteSpace: "nowrap" }}>Get OTP</span></Button>;
              if (result && result !== "—") return (
                <span style={{ fontWeight: 700, color: "#037f0c", whiteSpace: "nowrap" }}>{result}</span>
              );
              if (result === "—") return (
                <span style={{ color: "#d91515", whiteSpace: "nowrap" }}>No OTP</span>
              );
              return (
                <Button variant="inline-link" onClick={() => handleGetOTP(item.id)}>
                  <span style={{ whiteSpace: "nowrap" }}>Get OTP</span>
                </Button>
              );
            },
            width: 140,
          },
          { id: "created", header: "Created", cell: (item) => item.created_at },
        ]}
      />
    </SpaceBetween>
  );
}
