import { useCallback, useEffect, useState, type MouseEvent } from "react";

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

import {
  createProxySession,
  fetchMailDetail,
  fetchMailboxMails,
  type MailDetail,
  type MailSummary,
} from "../api/client";

interface MailViewerModalProps {
  visible: boolean;
  onDismiss: () => void;
  mailboxId: string;
  mailboxEmail: string;
}

export default function MailViewerModal({
  visible,
  onDismiss,
  mailboxId,
  mailboxEmail,
}: MailViewerModalProps) {
  const [mails, setMails] = useState<MailSummary[]>([]);
  const [mailDetail, setMailDetail] = useState<MailDetail | null>(null);
  const [selectedMailId, setSelectedMailId] = useState("");
  const [mailsLoading, setMailsLoading] = useState(false);
  const [mailsError, setMailsError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [contentAllowed, setContentAllowed] = useState(false);
  const [secureLoad, setSecureLoad] = useState(false);
  const [proxyToken, setProxyToken] = useState("");
  const [linkConfirmUrl, setLinkConfirmUrl] = useState("");
  const [copiedId, setCopiedId] = useState("");

  const timeAgo = (dateStr: string) => {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const copyWithFeedback = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(""), 1500);
  };

  const handleMailContentClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute("href") || "";
      if (href && href.startsWith("http")) {
        setLinkConfirmUrl(href);
      }
    }
  };

  const handleSelectMail = async (mail: MailSummary) => {
    setSelectedMailId(mail.id);
    setDetailLoading(true);
    setMailDetail(null);
    setContentAllowed(false);
    setSecureLoad(false);
    setProxyToken("");
    try {
      setMailDetail(await fetchMailDetail(mailboxId, mail.id));
    } catch {
      setMailDetail({
        id: mail.id,
        from_addr: mail.from_addr,
        subject: mail.subject,
        body: "",
        received_at: mail.received_at,
        is_otp: mail.is_otp,
        otp_code: mail.otp_code,
      });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRefreshMails = useCallback(async () => {
    if (!mailboxId) return;
    setMailsLoading(true);
    setMailsError("");
    try {
      setMails(await fetchMailboxMails(mailboxId));
    } catch (e) {
      setMailsError(e instanceof Error ? e.message : "Failed to fetch mails");
    } finally {
      setMailsLoading(false);
    }
  }, [mailboxId]);

  useEffect(() => {
    if (!visible || !mailboxId) return;
    setMails([]);
    setMailDetail(null);
    setSelectedMailId("");
    setMailsLoading(true);
    setMailsError("");
    setDetailLoading(false);
    setContentAllowed(false);
    setSecureLoad(false);
    setProxyToken("");
    setLinkConfirmUrl("");
    setCopiedId("");

    let cancelled = false;

    const loadMails = async () => {
      try {
        const items = await fetchMailboxMails(mailboxId);
        if (!cancelled) {
          setMails(items);
        }
      } catch (e) {
        if (!cancelled) {
          setMailsError(e instanceof Error ? e.message : "Failed to fetch mails");
        }
      } finally {
        if (!cancelled) {
          setMailsLoading(false);
        }
      }
    };

    void loadMails();

    return () => {
      cancelled = true;
    };
  }, [mailboxId, visible]);

  return (
    <Modal
      visible={visible}
      size="max"
      onDismiss={onDismiss}
      header={
        <SpaceBetween direction="horizontal" size="xs">
          <Box variant="h2">{mailboxEmail}</Box>
        </SpaceBetween>
      }
    >
      {mailsError && <Alert type="error">{mailsError}</Alert>}
      <div style={{ display: "flex", height: "70vh", gap: 0 }}>
        <div style={{ width: 380, minWidth: 380, borderRight: "1px solid #e9ebed", overflowY: "auto" }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #e9ebed", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Box color="text-body-secondary" fontSize="body-s">
              {mailsLoading ? "Loading..." : `${mails.length} messages`}
            </Box>
            <Button variant="inline-icon" iconName="refresh" onClick={handleRefreshMails} />
          </div>
          {mails.map((mail) => (
            <div
              key={mail.id}
              onClick={() => void handleSelectMail(mail)}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                borderBottom: "1px solid #f2f3f3",
                borderLeft: selectedMailId === mail.id ? "3px solid #0972d3" : "3px solid transparent",
                backgroundColor: selectedMailId === mail.id ? "#f2f8fd" : "transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <Box fontSize="body-s" fontWeight="bold">
                  {mail.from_addr}
                </Box>
                <Box fontSize="body-s" color="text-body-secondary">
                  {timeAgo(mail.received_at)}
                </Box>
              </div>
              <Box fontSize="body-s" color="text-body-secondary">
                {mail.subject}
              </Box>
              {mail.is_otp && mail.otp_code && (
                <div style={{ marginTop: 4 }}>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      copyWithFeedback(mail.otp_code || "", `list-${mail.id}`);
                    }}
                    style={{
                      display: "inline-block",
                      padding: "1px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 700,
                      backgroundColor: copiedId === `list-${mail.id}` ? "#d1fadf" : "#f0e6ff",
                      color: copiedId === `list-${mail.id}` ? "#067647" : "#6941c6",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    title="Click to copy"
                  >
                    {copiedId === `list-${mail.id}` ? "✓ Copied!" : `OTP ${mail.otp_code}`}
                  </span>
                </div>
              )}
            </div>
          ))}
          {!mailsLoading && mails.length === 0 && (
            <Box textAlign="center" padding="l" color="text-body-secondary">
              No messages
            </Box>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {detailLoading && <Box color="text-body-secondary">Loading...</Box>}
          {!detailLoading && !mailDetail && (
            <Box textAlign="center" padding="xxl" color="text-body-secondary">
              Select a message to view
            </Box>
          )}
          {!detailLoading && mailDetail && (
            <SpaceBetween size="m">
              <Box variant="h3">{mailDetail.subject}</Box>
              <Box fontSize="body-s" color="text-body-secondary">
                {mailDetail.from_addr} · {timeAgo(mailDetail.received_at)}
              </Box>
              {mailDetail.is_otp && mailDetail.otp_code && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: "1px solid #d5dbdb",
                    backgroundColor: "#fafafa",
                  }}
                >
                  <Box color="text-status-success" fontSize="body-s" fontWeight="bold">
                    OTP
                  </Box>
                  <Box fontSize="heading-m" fontWeight="bold">
                    {mailDetail.otp_code}
                  </Box>
                  <Button
                    variant={copiedId === `detail-${mailDetail.id}` ? "normal" : "inline-icon"}
                    iconName={copiedId === `detail-${mailDetail.id}` ? "status-positive" : "copy"}
                    onClick={() => copyWithFeedback(mailDetail.otp_code || "", `detail-${mailDetail.id}`)}
                  >
                    {copiedId === `detail-${mailDetail.id}` ? "Copied!" : ""}
                  </Button>
                </div>
              )}
              {!contentAllowed && !secureLoad && mailDetail.body && (
                <Alert
                  type="warning"
                  action={
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button
                        onClick={async () => {
                          const tk = await createProxySession();
                          setProxyToken(tk);
                          setSecureLoad(true);
                        }}
                      >
                        Remote Secure Load
                      </Button>
                      <Button onClick={() => setContentAllowed(true)}>Load Content</Button>
                    </SpaceBetween>
                  }
                >
                  This email contains web content. Loading it may allow the sender to track that you opened this email. External images, scripts, and tracking pixels may be loaded.
                </Alert>
              )}
              {contentAllowed && mailDetail.body ? (
                <div
                  onClick={handleMailContentClick}
                  style={{ fontSize: 14, lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{ __html: mailDetail.body }}
                />
              ) : secureLoad && mailDetail.body ? (
                <SpaceBetween size="s">
                  <Alert type="info">
                    All content loaded securely through the server. External tracking is blocked.
                  </Alert>
                  <div
                    onClick={handleMailContentClick}
                    style={{ fontSize: 14, lineHeight: 1.6 }}
                    dangerouslySetInnerHTML={{
                      __html: mailDetail.body
                        .replace(/<script[\s\S]*?<\/script>/gi, "")
                        .replace(
                          /(<img[^>]*\s)src="(https?:\/\/[^\"]+)"/gi,
                          (_m: string, pre: string, url: string) =>
                            `${pre}src="http://localhost:8000/api/proxy-resource?token=${proxyToken}&url=${encodeURIComponent(url)}"`
                        )
                        .replace(
                          /url\((["']?)(https?:\/\/[^)"']+)\1\)/gi,
                          (_m: string, q: string, url: string) =>
                            `url(${q}http://localhost:8000/api/proxy-resource?token=${proxyToken}&url=${encodeURIComponent(url)}${q})`
                        ),
                    }}
                  />
                </SpaceBetween>
              ) : !contentAllowed && !secureLoad && mailDetail.body ? (
                <div
                  onClick={handleMailContentClick}
                  style={{ fontSize: 14, lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{
                    __html: mailDetail.body
                      .replace(/<img[^>]*>/gi, "")
                      .replace(/<script[\s\S]*?<\/script>/gi, "")
                      .replace(/<link[^>]*>/gi, "")
                      .replace(/style="[^"]*"/gi, "")
                      .replace(/background[^;]*;/gi, ""),
                  }}
                />
              ) : (
                <Box color="text-body-secondary">No content</Box>
              )}
            </SpaceBetween>
          )}
        </div>
      </div>
      <Modal
        visible={!!linkConfirmUrl}
        onDismiss={() => setLinkConfirmUrl("")}
        header="Open external link?"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setLinkConfirmUrl("")}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  window.open(linkConfirmUrl, "_blank", "noopener,noreferrer");
                  setLinkConfirmUrl("");
                }}
              >
                Open in new tab
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="s">
          <Box>You are about to leave this page and open an external website.</Box>
          <Box variant="code" fontSize="body-s" display="block">
            <div style={{ wordBreak: "break-all" }}>{linkConfirmUrl}</div>
          </Box>
        </SpaceBetween>
      </Modal>
    </Modal>
  );
}
