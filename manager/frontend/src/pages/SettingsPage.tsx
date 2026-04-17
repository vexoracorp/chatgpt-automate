import { useEffect, useState, useCallback, useMemo } from "react";
import type { CSSProperties, JSX } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Toggle from "@cloudscape-design/components/toggle";
import TokenGroup from "@cloudscape-design/components/token-group";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Popover from "@cloudscape-design/components/popover";
import {
  type ApiKeyInfo,
  type CdkProviderInfo,
  type User,
  createApiKey,
  createCdkProvider,
  deleteApiKey,
  deleteCdkProvider,
  fetchApiKeys,
  fetchCdkProviders,
  fetchUsers,
  getSettings,
  saveSettings,
  updateCdkProvider,
} from "../api/client";

const PASSWORD_EXPIRY_OPTIONS: SelectProps.Option[] = [
  { value: "0", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
];

const SESSION_TIMEOUT_OPTIONS: SelectProps.Option[] = [
  { value: "0", label: "No timeout" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "480", label: "8 hours" },
  { value: "1440", label: "24 hours" },
];

interface ApiParameter {
  name: string;
  type: string;
  description: string;
}

interface ApiQueryOrBodyParameter extends ApiParameter {
  required: boolean;
}

interface ApiEndpoint {
  method: string;
  path: string;
  category: string;
  description: string;
  pathParams?: ApiParameter[];
  queryParams?: ApiQueryOrBodyParameter[];
  body?: ApiQueryOrBodyParameter[];
  bodyExample?: string;
  response: string;
}

const API_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/api/accounts",
    category: "Accounts",
    description: "List all managed accounts",
    response: `[
  {
    "id": "a1b2c3d4",
    "email": "john.doe@gmail.com",
    "status": "active",
    "name": "John Doe",
    "plan": "chatgptplusplan",
    "plan_expiry": "2025-08-15T00:00:00Z",
    "codex_weekly_used": 42.5,
    "codex_weekly_reset_hours": 96,
    "codex_5h_used": 15.3,
    "codex_5h_reset_min": 180,
    "proxy_url": "socks5://proxy1.example.com:1080",
    "proxy_label": "US West",
    "proxy_test": {
      "ip": "203.0.113.42",
      "country": "United States",
      "country_code": "US",
      "region": "California",
      "city": "Los Angeles",
      "asn": "AS13335",
      "org": "Cloudflare Inc",
      "timezone": "America/Los_Angeles",
      "latency_ms": 45
    },
    "session_token": null,
    "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6Ikp...",
    "codex_token": "cxtkn_abc123def456...",
    "password": "X#k9mP$vL2nQ",
    "created_at": "2025-01-15T08:30:00Z",
    "last_login": "2025-04-17T02:15:00Z"
  }
]`,
  },
  {
    method: "GET",
    path: "/api/accounts/{account_id}",
    category: "Accounts",
    description: "Get a single account by ID",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    response: `{
  "id": "a1b2c3d4",
  "email": "john.doe@gmail.com",
  "status": "active",
  "name": "John Doe",
  "plan": "chatgptplusplan",
  "plan_expiry": "2025-08-15T00:00:00Z",
  "codex_weekly_used": 42.5,
  "codex_weekly_reset_hours": 96,
  "codex_5h_used": 15.3,
  "codex_5h_reset_min": 180,
  "proxy_url": "socks5://proxy1.example.com:1080",
  "proxy_label": "US West",
  "proxy_test": {
    "ip": "203.0.113.42",
    "country": "United States",
    "country_code": "US",
    "region": "California",
    "city": "Los Angeles",
    "asn": "AS13335",
    "org": "Cloudflare Inc",
    "timezone": "America/Los_Angeles",
    "latency_ms": 45
  },
  "session_token": null,
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6Ikp...",
  "codex_token": "cxtkn_abc123def456...",
  "password": "X#k9mP$vL2nQ",
  "created_at": "2025-01-15T08:30:00Z",
  "last_login": "2025-04-17T02:15:00Z"
}`,
  },
  {
    method: "GET",
    path: "/api/accounts/{account_id}/session",
    category: "Accounts",
    description: "Get stored session credentials for an account (admin only)",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    response: `{
  "id": "a1b2c3d4",
  "email": "john.doe@gmail.com",
  "session_token": "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0...",
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6Ikp...",
  "codex_token": "cxtkn_abc123def456ghi789...",
  "cookies": "{\"__Secure-next-auth.session-token\": \"eyJ...\", \"_cfuvid\": \"abc123\"}",
  "password": "X#k9mP$vL2nQ",
  "proxy_url": "socks5://proxy1.example.com:1080",
  "status": "active"
}`,
  },
  {
    method: "POST",
    path: "/api/accounts/{account_id}/action",
    category: "Accounts",
    description: "Run a supported account action such as get_me or get_account_info",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    body: [
      {
        name: "action",
        type: "string",
        required: true,
        description: "Action name: get_me, get_account_info",
      },
    ],
    bodyExample: `{
  "action": "get_me"
}`,
    response: `{
  "action": "get_me",
  "result": {
    "object": "user",
    "id": "user-abc123def456",
    "email": "john.doe@gmail.com",
    "name": "John Doe",
    "picture": "https://lh3.googleusercontent.com/a/default-user=s96-c",
    "created": 1704067200,
    "phone_number": null,
    "mfa_flag_enabled": false,
    "has_payg_project_spend_limit": false
  }
}`,
  },
  {
    method: "POST",
    path: "/api/accounts/register",
    category: "Workflows",
    description: "Start the register workflow",
    body: [
      { name: "email", type: "string", required: true, description: "Email address" },
      {
        name: "password",
        type: "string",
        required: false,
        description: "Password (auto-generated if empty)",
      },
      { name: "name", type: "string", required: false, description: "Display name" },
      { name: "birthdate", type: "string", required: false, description: "YYYY-MM-DD" },
      { name: "proxy_url", type: "string", required: false, description: "Proxy URL" },
    ],
    bodyExample: `{
  "email": "new@example.com",
  "password": "secret123"
}`,
    response: `{
  "task_id": "r_a1b2c3d4",
  "account_id": "a1b2c3d4",
  "type": "register",
  "status": "starting",
  "email": "new.user@gmail.com",
  "proxy_url": "socks5://proxy1.example.com:1080"
}`,
  },
  {
    method: "POST",
    path: "/api/accounts/login",
    category: "Workflows",
    description: "Start the login workflow",
    body: [
      { name: "email", type: "string", required: true, description: "Account email" },
      { name: "proxy_url", type: "string", required: false, description: "Proxy URL" },
    ],
    bodyExample: `{
  "email": "user@example.com"
}`,
    response: `{
  "task_id": "r_e5f6g7h8",
  "account_id": "a1b2c3d4",
  "type": "login",
  "status": "starting",
  "email": "john.doe@gmail.com"
}`,
  },
  {
    method: "POST",
    path: "/api/accounts/codex",
    category: "Workflows",
    description: "Start the Codex OAuth workflow",
    body: [
      { name: "account_id", type: "string", required: true, description: "Account ID" },
      {
        name: "authorize_url",
        type: "string",
        required: true,
        description: "Codex OAuth authorize URL",
      },
      { name: "workspace_id", type: "string", required: true, description: "Workspace ID" },
      {
        name: "proxy_url",
        type: "string",
        required: false,
        description: "Proxy URL override",
      },
    ],
    bodyExample: `{
  "account_id": "acc12345",
  "authorize_url": "https://auth.openai.com/...",
  "workspace_id": "org-abc"
}`,
    response: `{
  "task_id": "r_i9j0k1l2",
  "account_id": "a1b2c3d4",
  "type": "codex_oauth",
  "status": "starting",
  "workspace_id": "org-abc123"
}`,
  },
  {
    method: "GET",
    path: "/api/proxies",
    category: "Proxies",
    description: "List configured proxies",
    response: `[
  {
    "id": "p1a2b3c4",
    "protocol": "socks5",
    "host": "proxy1.example.com",
    "port": 1080,
    "username": "proxyuser",
    "password": "proxypass",
    "label": "US West",
    "group": "premium",
    "subscription_id": "s1a2b3c4",
    "url": "socks5://proxyuser:proxypass@proxy1.example.com:1080",
    "created_at": "2025-01-10T12:00:00Z",
    "last_test": {
      "ip": "203.0.113.42",
      "country": "United States",
      "country_code": "US",
      "region": "California",
      "city": "Los Angeles",
      "asn": "AS13335",
      "org": "Cloudflare Inc",
      "timezone": "America/Los_Angeles",
      "latency_ms": 45
    }
  }
]`,
  },
  {
    method: "GET",
    path: "/api/mailboxes",
    category: "Mailboxes",
    description: "List mailboxes used for OTP and workflow automation",
    response: `[
  {
    "id": "m1a2b3c4",
    "email": "inbox-001@outlook.com",
    "password": "mbxPass123",
    "refresh_token": "0.AYIA...",
    "client_id": "d3590ed6-52b3-4102-aeff-aad2292ab01c",
    "status": "available",
    "assigned_account_id": null,
    "created_at": "2025-02-01T09:00:00Z"
  }
]`,
  },
  {
    method: "POST",
    path: "/api/accounts/{account_id}/checkout",
    category: "Checkout",
    description: "Create a checkout session for an account",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    body: [
      {
        name: "plan_name",
        type: "string",
        required: true,
        description: "chatgptplusplan, chatgptproplan, or chatgptteamplan",
      },
      {
        name: "promo_campaign_id",
        type: "string",
        required: false,
        description: "Promo campaign ID (e.g. plus-1-month-free)",
      },
      {
        name: "billing_country",
        type: "string",
        required: false,
        description: "Country code (US, KR, JP, etc.)",
      },
      {
        name: "billing_currency",
        type: "string",
        required: false,
        description: "Currency (USD, KRW, JPY, etc.)",
      },
      {
        name: "checkout_ui_mode",
        type: "string",
        required: false,
        description: "custom or hosted (default: custom)",
      },
      {
        name: "team_plan_data",
        type: "object",
        required: false,
        description: "Required for team plan: { workspace_name, price_interval, seat_quantity }",
      },
    ],
    bodyExample: `{
  "plan_name": "chatgptplusplan",
  "promo_campaign_id": "plus-1-month-free",
  "billing_country": "JP",
  "billing_currency": "JPY",
  "checkout_ui_mode": "custom"
}`,
    response: `{
  "checkout_session_id": "cs_live_a1b2c3d4e5f6g7h8",
  "processor_entity": "openai",
  "status": "open",
  "payment_status": "unpaid",
  "url": "https://chatgpt.com/checkout/openai/cs_live_a1b2c3d4e5f6g7h8",
  "plan_name": "chatgptplusplan",
  "amount": 2000,
  "currency": "jpy",
  "billing_country": "JP",
  "promo_campaign_id": "plus-1-month-free"
}`,
  },
  {
    method: "GET",
    path: "/api/mailboxes/{mb_id}/mails",
    category: "Mailboxes",
    description: "List emails in a mailbox",
    pathParams: [{ name: "mb_id", type: "string", description: "Mailbox ID" }],
    response: `[
  {
    "id": "ml_a1b2c3d4",
    "from_addr": "noreply@tm.openai.com",
    "to_addr": "inbox-001@outlook.com",
    "subject": "OpenAI - Verify your email",
    "body_preview": "Your verification code is 847293...",
    "received_at": "2025-04-17T02:30:00Z",
    "is_read": false,
    "has_attachments": false
  }
]`,
  },
  {
    method: "GET",
    path: "/api/mailboxes/{mb_id}/otp",
    category: "Mailboxes",
    description: "Get the latest OTP code from a mailbox (waits up to 60s for new OTP)",
    pathParams: [{ name: "mb_id", type: "string", description: "Mailbox ID" }],
    response: `{
  "otp_code": "847293",
  "from_addr": "noreply@tm.openai.com",
  "subject": "OpenAI - Verify your email",
  "received_at": "2025-04-17T02:30:00Z",
  "expires_in_seconds": 540
}`,
  },
  {
    method: "GET",
    path: "/api/mailboxes/{mb_id}/mails/{mail_id}",
    category: "Mailboxes",
    description: "Get full email content by ID",
    pathParams: [
      { name: "mb_id", type: "string", description: "Mailbox ID" },
      { name: "mail_id", type: "string", description: "Mail ID" },
    ],
    response: `{
  "id": "ml_a1b2c3d4",
  "from_addr": "noreply@tm.openai.com",
  "to_addr": "inbox-001@outlook.com",
  "subject": "OpenAI - Verify your email",
  "body_text": "Your verification code is: 847293\n\nThis code will expire in 10 minutes.\n\nIf you did not request this code, you can safely ignore this email.",
  "body_html": "<html>...</html>",
  "received_at": "2025-04-17T02:30:00Z",
  "is_read": true,
  "has_attachments": false
}`,
  },
  {
    method: "GET",
    path: "/api/accounts/{account_id}/settings",
    category: "Accounts",
    description: "Get ChatGPT account settings (custom instructions, features, etc.)",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    response: `{
  "custom_instructions": {
    "about_user_message": "I'm a full-stack developer working with TypeScript and Python.",
    "about_model_message": "Be concise. Use code examples. Prefer modern patterns.",
    "enabled": true
  },
  "features": {
    "memory_enabled": true,
    "browsing_enabled": true,
    "code_interpreter_enabled": true,
    "image_generation_enabled": true,
    "voice_mode_enabled": false
  },
  "data_controls": {
    "training_allowed": false,
    "shared_links_enabled": true
  }
}`,
  },
  {
    method: "PATCH",
    path: "/api/accounts/{account_id}/settings",
    category: "Accounts",
    description: "Update ChatGPT account settings",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    body: [
      {
        name: "feature",
        type: "string",
        required: true,
        description: "Feature name (memory, browsing, etc.)",
      },
      {
        name: "value",
        type: "boolean",
        required: true,
        description: "Enable or disable",
      },
    ],
    bodyExample: `{
  "feature": "memory",
  "value": true
}`,
    response: `{ "ok": true, "feature": "memory_enabled", "value": true }`,
  },
  {
    method: "GET",
    path: "/api/accounts/{account_id}/codex-settings",
    category: "Accounts",
    description: "Get Codex usage limits and settings",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    response: `{
  "weekly_usage_limit_percent": 80,
  "five_hour_usage_limit_percent": 50,
  "max_tasks": 10,
  "environment_variables": {},
  "auto_approve_tools": false
}`,
  },
  {
    method: "PATCH",
    path: "/api/accounts/{account_id}/codex-settings",
    category: "Accounts",
    description: "Update Codex usage limits",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    body: [
      {
        name: "weekly_usage_limit_percent",
        type: "number",
        required: false,
        description: "Weekly usage limit (0-100)",
      },
    ],
    bodyExample: `{
  "weekly_usage_limit_percent": 90
}`,
    response: `{ "ok": true, "weekly_usage_limit_percent": 90 }`,
  },
  {
    method: "GET",
    path: "/api/accounts/{account_id}/codex-usage",
    category: "Accounts",
    description: "Get Codex daily token usage breakdown",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    queryParams: [
      {
        name: "start_date",
        type: "string",
        required: true,
        description: "Start date (YYYY-MM-DD)",
      },
      {
        name: "end_date",
        type: "string",
        required: true,
        description: "End date (YYYY-MM-DD)",
      },
      {
        name: "group_by",
        type: "string",
        required: false,
        description: "day or week (default: day)",
      },
    ],
    response: `{
  "data": [
    {
      "date": "2025-04-15",
      "product_surface_usage_values": {
        "cli": 12.5,
        "vscode": 28.3,
        "windsurf": 5.1,
        "cursor": 0.0
      }
    },
    {
      "date": "2025-04-16",
      "product_surface_usage_values": {
        "cli": 8.2,
        "vscode": 35.7,
        "windsurf": 2.4,
        "cursor": 1.0
      }
    },
    {
      "date": "2025-04-17",
      "product_surface_usage_values": {
        "cli": 3.1,
        "vscode": 10.2,
        "windsurf": 0.0,
        "cursor": 0.0
      }
    }
  ],
  "units": "percent",
  "group_by": "day",
  "start_date": "2025-04-15",
  "end_date": "2025-04-17"
}`,
  },
  {
    method: "POST",
    path: "/api/accounts/{account_id}/refresh",
    category: "Accounts",
    description: "Refresh account session (re-login using stored credentials)",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    response: `{
  "id": "a1b2c3d4",
  "email": "john.doe@gmail.com",
  "status": "active",
  "name": "John Doe",
  "plan": "chatgptplusplan",
  "plan_expiry": "2025-08-15T00:00:00Z",
  "codex_weekly_used": 42.5,
  "codex_weekly_reset_hours": 96,
  "codex_5h_used": 15.3,
  "codex_5h_reset_min": 180,
  "proxy_url": "socks5://proxy1.example.com:1080",
  "proxy_label": "US West",
  "proxy_test": {
    "ip": "203.0.113.42",
    "country": "United States",
    "country_code": "US",
    "region": "California",
    "city": "Los Angeles",
    "asn": "AS13335",
    "org": "Cloudflare Inc",
    "timezone": "America/Los_Angeles",
    "latency_ms": 45
  },
  "session_token": null,
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6Ikp...",
  "codex_token": "cxtkn_abc123def456...",
  "password": "X#k9mP$vL2nQ",
  "created_at": "2025-01-15T08:30:00Z",
  "last_login": "2025-04-17T02:15:00Z"
}`,
  },
  {
    method: "DELETE",
    path: "/api/accounts/{account_id}",
    category: "Accounts",
    description: "Delete an account from the manager",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    response: `{ "ok": true }`,
  },
  {
    method: "PATCH",
    path: "/api/accounts/{account_id}/proxy",
    category: "Accounts",
    description: "Update the proxy assigned to an account",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    body: [
      {
        name: "proxy_url",
        type: "string",
        required: false,
        description: "Proxy URL or empty to remove",
      },
    ],
    bodyExample: `{
  "proxy_url": "socks5://127.0.0.1:1080"
}`,
    response: `{
  "id": "a1b2c3d4",
  "email": "john.doe@gmail.com",
  "status": "active",
  "name": "John Doe",
  "plan": "chatgptplusplan",
  "plan_expiry": "2025-08-15T00:00:00Z",
  "codex_weekly_used": 42.5,
  "codex_weekly_reset_hours": 96,
  "codex_5h_used": 15.3,
  "codex_5h_reset_min": 180,
  "proxy_url": "socks5://proxy1.example.com:1080",
  "proxy_label": "US West",
  "proxy_test": {
    "ip": "203.0.113.42",
    "country": "United States",
    "country_code": "US",
    "region": "California",
    "city": "Los Angeles",
    "asn": "AS13335",
    "org": "Cloudflare Inc",
    "timezone": "America/Los_Angeles",
    "latency_ms": 45
  },
  "session_token": null,
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6Ikp...",
  "codex_token": "cxtkn_abc123def456...",
  "password": "X#k9mP$vL2nQ",
  "created_at": "2025-01-15T08:30:00Z",
  "last_login": "2025-04-17T02:15:00Z"
}`,
  },
  {
    method: "GET",
    path: "/api/accounts/{account_id}/mailbox",
    category: "Accounts",
    description: "Get the mailbox bound to an account",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    response: `{
  "mailbox": {
    "id": "m1a2b3c4",
    "email": "inbox-001@outlook.com",
    "status": "in_use",
    "assigned_account_id": "a1b2c3d4"
  }
}`,
  },
  {
    method: "POST",
    path: "/api/accounts/{account_id}/mailbox",
    category: "Accounts",
    description: "Bind or unbind a mailbox to an account",
    pathParams: [{ name: "account_id", type: "string", description: "Account ID" }],
    body: [
      {
        name: "mailbox_id",
        type: "string | null",
        required: true,
        description: "Mailbox ID to bind, or null to unbind",
      },
    ],
    bodyExample: `{
  "mailbox_id": "mbx12345"
}`,
    response: `{
  "mailbox": {
    "id": "m1a2b3c4",
    "email": "inbox-001@outlook.com",
    "status": "in_use",
    "assigned_account_id": "a1b2c3d4"
  }
}`,
  },
  {
    method: "POST",
    path: "/api/accounts/import-session",
    category: "Accounts",
    description: "Import an account using an existing session/access token",
    body: [
      {
        name: "access_token",
        type: "string",
        required: true,
        description: "ChatGPT access token",
      },
      { name: "proxy_url", type: "string", required: false, description: "Proxy URL" },
    ],
    bodyExample: `{
  "access_token": "eyJhbGci..."
}`,
    response: `{
  "id": "a1b2c3d4",
  "email": "john.doe@gmail.com",
  "status": "active",
  "name": "John Doe",
  "plan": "chatgptplusplan",
  "plan_expiry": "2025-08-15T00:00:00Z",
  "codex_weekly_used": 42.5,
  "codex_weekly_reset_hours": 96,
  "codex_5h_used": 15.3,
  "codex_5h_reset_min": 180,
  "proxy_url": "socks5://proxy1.example.com:1080",
  "proxy_label": "US West",
  "proxy_test": {
    "ip": "203.0.113.42",
    "country": "United States",
    "country_code": "US",
    "region": "California",
    "city": "Los Angeles",
    "asn": "AS13335",
    "org": "Cloudflare Inc",
    "timezone": "America/Los_Angeles",
    "latency_ms": 45
  },
  "session_token": null,
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6Ikp...",
  "codex_token": "cxtkn_abc123def456...",
  "password": "X#k9mP$vL2nQ",
  "created_at": "2025-01-15T08:30:00Z",
  "last_login": "2025-04-17T02:15:00Z"
}`,
  },
  {
    method: "GET",
    path: "/api/workflow-runs",
    category: "Workflows",
    description: "List all workflow runs",
    response: `[
  {
    "id": "r_a1b2c3d4",
    "name": "Register john.doe@gmail.com",
    "type": "register",
    "email": "john.doe@gmail.com",
    "proxy_url": "socks5://proxy1.example.com:1080",
    "proxy_label": "US West",
    "proxy_test": {
      "ip": "203.0.113.42",
      "country": "United States",
      "country_code": "US"
    },
    "status": "completed",
    "error": null,
    "started_at": "2025-04-17T01:00:00Z",
    "finished_at": "2025-04-17T01:02:30Z"
  }
]`,
  },
  {
    method: "GET",
    path: "/api/workflow-runs/{run_id}",
    category: "Workflows",
    description: "Get details of a specific workflow run",
    pathParams: [{ name: "run_id", type: "string", description: "Run ID" }],
    response: `{
  "id": "r_a1b2c3d4",
  "name": "Register john.doe@gmail.com",
  "type": "register",
  "email": "john.doe@gmail.com",
  "proxy_url": "socks5://proxy1.example.com:1080",
  "proxy_label": "US West",
  "proxy_test": null,
  "status": "completed",
  "error": null,
  "started_at": "2025-04-17T01:00:00Z",
  "finished_at": "2025-04-17T01:02:30Z",
  "logs": [
    { "ts": "2025-04-17T01:00:00Z", "msg": "Starting registration for john.doe@gmail.com" },
    { "ts": "2025-04-17T01:00:05Z", "msg": "Navigating to signup page" },
    { "ts": "2025-04-17T01:00:30Z", "msg": "Submitted email, waiting for OTP" },
    { "ts": "2025-04-17T01:01:15Z", "msg": "OTP received: 847293" },
    { "ts": "2025-04-17T01:01:20Z", "msg": "OTP submitted successfully" },
    { "ts": "2025-04-17T01:02:00Z", "msg": "Setting password and profile" },
    { "ts": "2025-04-17T01:02:30Z", "msg": "Registration completed successfully" }
  ]
}`,
  },
];

function formatTimestamp(value: string | null): string {
  return value || "Never";
}

const METHOD_COLORS: Record<string, string> = {
  GET: "#037f0c",
  POST: "#0972d3",
  PATCH: "#d97706",
  DELETE: "#d91515",
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "monospace",
        textTransform: "uppercase",
        color: "#fff",
        backgroundColor: METHOD_COLORS[method] ?? "#555",
      }}
    >
      {method}
    </span>
  );
}

function CodeBlock({ title, value }: { title: string; value: string }) {
  return (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{title}</Box>
      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 1,
          }}
        >
          <CopyToClipboard
            variant="icon"
            textToCopy={value}
            copyButtonAriaLabel={`Copy ${title}`}
            copySuccessText="Copied"
            copyErrorText="Failed to copy"
          />
        </div>
        <pre
          style={{
            margin: 0,
            padding: 16,
            backgroundColor: "#1a1a2e",
            color: "#e0e0e0",
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 13,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {value}
        </pre>
      </div>
    </SpaceBetween>
  );
}

function RequiredBadge({ required }: { required: boolean }) {
  return (
    <span style={{ color: required ? "#037f0c" : "#687078", fontWeight: 700 }}>{required ? "Yes" : "No"}</span>
  );
}

function ParameterTable({
  title,
  parameters,
  showRequired = false,
}: {
  title: string;
  parameters: ApiParameter[] | ApiQueryOrBodyParameter[];
  showRequired?: boolean;
}) {
  return (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{title}</Box>
      <div
        style={{
          border: "1px solid #e9ebed",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f2f3f3" }}>
              <th style={tableHeaderCellStyle}>Name</th>
              <th style={tableHeaderCellStyle}>Type</th>
              {showRequired && <th style={tableHeaderCellStyle}>Required</th>}
              <th style={tableHeaderCellStyle}>Description</th>
            </tr>
          </thead>
          <tbody>
            {parameters.map((parameter) => (
              <tr key={parameter.name}>
                <td style={tableBodyCellStyle}>{parameter.name}</td>
                <td style={{ ...tableBodyCellStyle, fontFamily: "monospace", color: "#0972d3" }}>{parameter.type}</td>
                {showRequired && "required" in parameter && (
                  <td style={tableBodyCellStyle}>
                    <RequiredBadge required={parameter.required} />
                  </td>
                )}
                <td style={tableBodyCellStyle}>{parameter.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SpaceBetween>
  );
}

const tableHeaderCellStyle: CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: 13,
  fontWeight: 700,
  color: "#16191f",
};

const tableBodyCellStyle: CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: 13,
  borderTop: "1px solid #e9ebed",
  verticalAlign: "top",
};

const CATEGORY_ORDER = ["Accounts", "Mailboxes", "Proxies", "Workflows", "Checkout"];

function groupEndpointsByCategory() {
  const groups: Record<string, typeof API_ENDPOINTS> = {};
  for (const ep of API_ENDPOINTS) {
    (groups[ep.category] ??= []).push(ep);
  }
  return CATEGORY_ORDER.filter((c) => groups[c]).map((c) => ({ category: c, endpoints: groups[c] }));
}

interface TabDefinition {
  id: string;
  label: string;
  content: JSX.Element;
}

export default function SettingsPage() {
  const [activeTabId, setActiveTabId] = useState("general");
  const [orgName, setOrgName] = useState("");
  const [ips, setIps] = useState<string[]>([]);
  const [newIp, setNewIp] = useState("");
  const [require2fa, setRequire2fa] = useState(false);
  const [allowEmailChange, setAllowEmailChange] = useState(false);
  const [allowPasswordChange, setAllowPasswordChange] = useState(true);
  const [passwordExpiryDays, setPasswordExpiryDays] = useState<SelectProps.Option>(PASSWORD_EXPIRY_OPTIONS[0]);
  const [sessionTimeoutMin, setSessionTimeoutMin] = useState<SelectProps.Option>(SESSION_TIMEOUT_OPTIONS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeysError, setApiKeysError] = useState("");
  const [selectedApiKeys, setSelectedApiKeys] = useState<ApiKeyInfo[]>([]);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [apiKeyName, setApiKeyName] = useState("");
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const [deletingApiKey, setDeletingApiKey] = useState(false);
  const [createdKeyValue, setCreatedKeyValue] = useState("");
  const [createdKeyInfo, setCreatedKeyInfo] = useState<ApiKeyInfo | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  const [cdkProviders, setCdkProviders] = useState<CdkProviderInfo[]>([]);
  const [cdkLoading, setCdkLoading] = useState(false);
  const [cdkError, setCdkError] = useState("");
  const [cdkCreateVisible, setCdkCreateVisible] = useState(false);
  const [cdkCreateName, setCdkCreateName] = useState("");
  const [cdkCreateType, setCdkCreateType] = useState("activatecdk");
  const [cdkCreateUrl, setCdkCreateUrl] = useState("");
  const [cdkCreateAuthType, setCdkCreateAuthType] = useState("none");
  const [cdkCreateAuthValue, setCdkCreateAuthValue] = useState("");
  const [cdkCreating, setCdkCreating] = useState(false);
  const [cdkDeleting, setCdkDeleting] = useState("");
  const [cdkDeleteConfirmId, setCdkDeleteConfirmId] = useState("");

  const userMap = useMemo(() => {
    const map: Record<string, User> = {};
    for (const u of users) map[u.id] = u;
    return map;
  }, [users]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await getSettings();
      setOrgName(s.org_name);
      setIps(s.allowed_ips);
      setRequire2fa(s.require_2fa);
      setAllowEmailChange(s.allow_email_change);
      setAllowPasswordChange(s.allow_password_change);
      setPasswordExpiryDays(
        PASSWORD_EXPIRY_OPTIONS.find((o) => o.value === String(s.password_expiry_days)) || PASSWORD_EXPIRY_OPTIONS[0],
      );
      setSessionTimeoutMin(
        SESSION_TIMEOUT_OPTIONS.find((o) => o.value === String(s.session_timeout_min)) || SESSION_TIMEOUT_OPTIONS[0],
      );
    } catch {
      void 0;
    }
  }, []);

  const loadApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    setApiKeysError("");
    try {
      setApiKeys(await fetchApiKeys());
    } catch (e) {
      setApiKeysError(e instanceof Error ? e.message : "Failed to load API keys");
    } finally {
      setApiKeysLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await fetchUsers());
    } catch {
      void 0;
    }
  }, []);

  const loadCdkProviders = useCallback(async () => {
    setCdkLoading(true);
    setCdkError("");
    try {
      setCdkProviders(await fetchCdkProviders());
    } catch (e) {
      setCdkError(e instanceof Error ? e.message : "Failed to load CDK providers");
    } finally {
      setCdkLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadApiKeys();
    loadUsers();
    loadCdkProviders();
  }, [loadSettings, loadApiKeys, loadUsers, loadCdkProviders]);

  const addIp = () => {
    const ip = newIp.trim();
    if (ip && !ips.includes(ip)) {
      setIps([...ips, ip]);
      setNewIp("");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await saveSettings({
        org_name: orgName,
        allowed_ips: ips,
        require_2fa: require2fa,
        allow_email_change: allowEmailChange,
        allow_password_change: allowPasswordChange,
        password_expiry_days: parseInt(passwordExpiryDays.value || "0") || 0,
        session_timeout_min: parseInt(sessionTimeoutMin.value || "0") || 0,
      });
      setSuccess("Settings saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const openCreateModal = () => {
    setApiKeyName("");
    setCreatedKeyValue("");
    setCreatedKeyInfo(null);
    setCreateModalVisible(true);
  };

  const handleCreateApiKey = async () => {
    if (!apiKeyName.trim()) return;
    setCreatingApiKey(true);
    setApiKeysError("");
    try {
      const created = await createApiKey(apiKeyName.trim());
      setCreatedKeyValue(created.key);
      setCreatedKeyInfo({
        id: created.id,
        name: created.name,
        key_prefix: created.key_prefix,
        user_id: created.user_id,
        created_at: created.created_at,
        last_used: created.last_used,
      });
      await loadApiKeys();
    } catch (e) {
      setApiKeysError(e instanceof Error ? e.message : "Failed to create API key");
    } finally {
      setCreatingApiKey(false);
    }
  };

  const handleDeleteApiKeys = async () => {
    setDeletingApiKey(true);
    setApiKeysError("");
    try {
      for (const apiKey of selectedApiKeys) {
        await deleteApiKey(apiKey.id);
      }
      setSelectedApiKeys([]);
      setDeleteModalVisible(false);
      await loadApiKeys();
    } catch (e) {
      setApiKeysError(e instanceof Error ? e.message : "Failed to delete API key");
    } finally {
      setDeletingApiKey(false);
    }
  };

  const handleCreateCdkProvider = async () => {
    if (!cdkCreateName.trim() || !cdkCreateUrl.trim()) return;
    setCdkCreating(true);
    setCdkError("");
    try {
      await createCdkProvider({
        name: cdkCreateName.trim(),
        provider_type: cdkCreateType,
        base_url: cdkCreateUrl.trim(),
        auth_type: cdkCreateAuthType,
        auth_value: cdkCreateAuthType !== "none" ? cdkCreateAuthValue : undefined,
      });
      setCdkCreateVisible(false);
      setCdkCreateName("");
      setCdkCreateType("activatecdk");
      setCdkCreateUrl("");
      setCdkCreateAuthType("none");
      setCdkCreateAuthValue("");
      await loadCdkProviders();
    } catch (e) {
      setCdkError(e instanceof Error ? e.message : "Failed to create CDK provider");
    } finally {
      setCdkCreating(false);
    }
  };

  const handleToggleCdkProvider = async (provider: CdkProviderInfo) => {
    setCdkError("");
    try {
      await updateCdkProvider(provider.id, { is_enabled: !provider.is_enabled });
      await loadCdkProviders();
    } catch (e) {
      setCdkError(e instanceof Error ? e.message : "Failed to update CDK provider");
    }
  };

  const handleDeleteCdkProvider = async (id: string) => {
    setCdkDeleting(id);
    setCdkError("");
    try {
      await deleteCdkProvider(id);
      setCdkDeleteConfirmId("");
      await loadCdkProviders();
    } catch (e) {
      setCdkError(e instanceof Error ? e.message : "Failed to delete CDK provider");
    } finally {
      setCdkDeleting("");
    }
  };

  const tabs: TabDefinition[] = [
    {
      id: "general",
      label: "General",
      content: (
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Organization</Header>}>
            <SpaceBetween size="l">
              {error && <Alert type="error">{error}</Alert>}
              {success && <Alert type="success">{success}</Alert>}
              <FormField label="Organization Name" constraintText="Displayed in the top navigation bar">
                <Input
                  value={orgName}
                  onChange={({ detail }) => setOrgName(detail.value)}
                  placeholder="ChatGPT Account Manager"
                />
              </FormField>
            </SpaceBetween>
          </Container>

          <Container
            header={
              <Header
                variant="h2"
                description="Leave empty to allow all IPs. Add specific IPs to restrict access."
              >
                IP Allowlist
              </Header>
            }
          >
            <SpaceBetween size="m">
              <SpaceBetween direction="horizontal" size="xs">
                <Input
                  value={newIp}
                  onChange={({ detail }) => setNewIp(detail.value)}
                  placeholder="192.168.1.1"
                  onKeyDown={({ detail }) => { if (detail.key === "Enter") addIp(); }}
                />
                <Button onClick={addIp} disabled={!newIp.trim()}>Add</Button>
              </SpaceBetween>
              {ips.length > 0 ? (
                <TokenGroup
                  items={ips.map((ip) => ({ label: ip, dismissLabel: `Remove ${ip}` }))}
                  onDismiss={({ detail }) => {
                    setIps(ips.filter((_, i) => i !== detail.itemIndex));
                  }}
                />
              ) : (
                <Box color="text-body-secondary">No IP restrictions — all IPs allowed</Box>
              )}
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h2">Security</Header>}>
            <SpaceBetween size="l">
              <Toggle checked={require2fa} onChange={({ detail }) => setRequire2fa(detail.checked)}>
                Require 2FA for all users
              </Toggle>
              <Toggle checked={allowEmailChange} onChange={({ detail }) => setAllowEmailChange(detail.checked)}>
                Allow users to change their email
              </Toggle>
              <Toggle checked={allowPasswordChange} onChange={({ detail }) => setAllowPasswordChange(detail.checked)}>
                Allow users to change their password
              </Toggle>
              <FormField label="Password expiry">
                <Select
                  selectedOption={passwordExpiryDays}
                  onChange={({ detail }) => setPasswordExpiryDays(detail.selectedOption)}
                  options={PASSWORD_EXPIRY_OPTIONS}
                />
              </FormField>
              <FormField label="Session timeout">
                <Select
                  selectedOption={sessionTimeoutMin}
                  onChange={({ detail }) => setSessionTimeoutMin(detail.selectedOption)}
                  options={SESSION_TIMEOUT_OPTIONS}
                />
              </FormField>
            </SpaceBetween>
          </Container>

          <Box>
            <Button variant="primary" loading={saving} onClick={handleSave}>
              Save Settings
            </Button>
          </Box>
        </SpaceBetween>
      ),
    },
    {
      id: "api-keys",
      label: "API Keys",
      content: (
        <Container
          header={
            <Header
              variant="h2"
              counter={`(${apiKeys.length})`}
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button iconName="refresh" loading={apiKeysLoading} onClick={loadApiKeys} />
                  <Button disabled={selectedApiKeys.length === 0} onClick={() => setDeleteModalVisible(true)}>
                    Delete
                  </Button>
                  <Button variant="primary" onClick={openCreateModal}>Create API Key</Button>
                </SpaceBetween>
              }
            >
              API Keys
            </Header>
          }
        >
          <SpaceBetween size="m">
            {apiKeysError && <Alert type="error">{apiKeysError}</Alert>}
            <Alert type="info">API keys use Bearer authentication and can access the manager API without a browser session.</Alert>
            <Table
              items={apiKeys}
              loading={apiKeysLoading}
              loadingText="Loading API keys..."
              selectionType="multi"
              selectedItems={selectedApiKeys}
              onSelectionChange={({ detail }) => setSelectedApiKeys(detail.selectedItems)}
              trackBy="id"
              empty={
                <Box textAlign="center" color="inherit">
                  <SpaceBetween size="m">
                    <b>No API keys</b>
                    <Button onClick={openCreateModal}>Create API Key</Button>
                  </SpaceBetween>
                </Box>
              }
              columnDefinitions={[
                { id: "name", header: "Name", cell: (item) => item.name },
                { id: "key_prefix", header: "Prefix", cell: (item) => item.key_prefix },
                { id: "created_at", header: "Created", cell: (item) => formatTimestamp(item.created_at) },
                { id: "last_used", header: "Last Used", cell: (item) => formatTimestamp(item.last_used) },
                { id: "user_id", header: "User", cell: (item) => {
                  const user = userMap[item.user_id];
                  if (!user) return item.user_id;
                  return (
                    <Popover
                      dismissButton={false}
                      position="top"
                      size="medium"
                      triggerType="text"
                      content={
                        <SpaceBetween size="xs">
                          <Box><Box variant="awsui-key-label">Email</Box> {user.email}</Box>
                          <Box><Box variant="awsui-key-label">Role</Box> {user.role}</Box>
                          <Box><Box variant="awsui-key-label">Created</Box> {formatTimestamp(user.created_at)}</Box>
                          <Box><Box variant="awsui-key-label">Last login</Box> {formatTimestamp(user.last_login)}</Box>
                        </SpaceBetween>
                      }
                    >
                      {user.name}
                    </Popover>
                  );
                }},
              ]}
            />
          </SpaceBetween>
        </Container>
      ),
    },
    {
      id: "cdk-providers",
      label: "CDK Providers",
      content: (
        <Container
          header={
            <Header
              variant="h2"
              counter={`(${cdkProviders.length})`}
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button iconName="refresh" loading={cdkLoading} onClick={loadCdkProviders} />
                  <Button variant="primary" onClick={() => setCdkCreateVisible(true)}>Add Provider</Button>
                </SpaceBetween>
              }
            >
              CDK Providers
            </Header>
          }
        >
          <SpaceBetween size="m">
            {cdkError && <Alert type="error">{cdkError}</Alert>}
            <Table
              items={cdkProviders}
              loading={cdkLoading}
              loadingText="Loading CDK providers..."
              trackBy="id"
              empty={
                <Box textAlign="center" color="inherit">
                  <SpaceBetween size="m">
                    <b>No CDK providers configured</b>
                    <Button onClick={() => setCdkCreateVisible(true)}>Add Provider</Button>
                  </SpaceBetween>
                </Box>
              }
              columnDefinitions={[
                { id: "name", header: "Name", cell: (item) => item.name },
                { id: "provider_type", header: "Type", cell: (item) => item.provider_type },
                {
                  id: "base_url",
                  header: "Base URL",
                  cell: (item) => (
                    <span title={item.base_url}>
                      {item.base_url.length > 50 ? `${item.base_url.slice(0, 50)}…` : item.base_url}
                    </span>
                  ),
                },
                { id: "auth_type", header: "Auth", cell: (item) => item.auth_type },
                {
                  id: "is_enabled",
                  header: "Enabled",
                  cell: (item) => (
                    <Toggle
                      checked={item.is_enabled}
                      onChange={() => handleToggleCdkProvider(item)}
                    />
                  ),
                },
                {
                  id: "actions",
                  header: "Actions",
                  cell: (item) =>
                    cdkDeleteConfirmId === item.id ? (
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button
                          variant="link"
                          loading={cdkDeleting === item.id}
                          onClick={() => handleDeleteCdkProvider(item.id)}
                        >
                          Confirm
                        </Button>
                        <Button variant="link" onClick={() => setCdkDeleteConfirmId("")}>
                          Cancel
                        </Button>
                      </SpaceBetween>
                    ) : (
                      <Button variant="link" onClick={() => setCdkDeleteConfirmId(item.id)}>
                        Delete
                      </Button>
                    ),
                },
              ]}
            />
          </SpaceBetween>
        </Container>
      ),
    },
    {
      id: "api-docs",
      label: "API Documentation",
      content: (
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Authentication</Header>}>
            <SpaceBetween size="m">
              <Box>Use API keys with the Authorization header below:</Box>
              <CodeBlock title="Header" value="Authorization: Bearer cam_xxxxx" />
              <Alert type="info">Create keys in the API Keys tab. The raw key is shown only once and cannot be recovered later.</Alert>
            </SpaceBetween>
          </Container>

          {groupEndpointsByCategory().map(({ category, endpoints }) => (
            <Container key={category} header={<Header variant="h2">{category}</Header>}>
              <SpaceBetween size="s">
                {endpoints.map((endpoint) => (
                  <ExpandableSection
                    key={`${endpoint.method}-${endpoint.path}`}
                    variant="default"
                    headerText={
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <MethodBadge method={endpoint.method} />
                        <span style={{ fontFamily: "monospace", fontSize: 14 }}>{endpoint.path}</span>
                        <span style={{ color: "#888", fontSize: 13, fontWeight: 400 }}>{endpoint.description}</span>
                      </span>
                    }
                  >
                    <SpaceBetween size="m">
                      <SpaceBetween size="xs">
                        <Box variant="awsui-key-label">Description</Box>
                        <div
                          style={{
                            border: "1px solid #e9ebed",
                            borderRadius: 8,
                            padding: 12,
                            backgroundColor: "#ffffff",
                            fontSize: 13,
                            lineHeight: 1.5,
                          }}
                        >
                          {endpoint.description}
                        </div>
                      </SpaceBetween>

                      {endpoint.pathParams && endpoint.pathParams.length > 0 && (
                        <ParameterTable title="Path Parameters" parameters={endpoint.pathParams} />
                      )}

                      {endpoint.queryParams && endpoint.queryParams.length > 0 && (
                        <ParameterTable title="Query Parameters" parameters={endpoint.queryParams} showRequired />
                      )}

                      {endpoint.body && endpoint.body.length > 0 && (
                        <SpaceBetween size="m">
                          <ParameterTable title="Request Body" parameters={endpoint.body} showRequired />
                          {endpoint.bodyExample && <CodeBlock title="Body Example" value={endpoint.bodyExample} />}
                        </SpaceBetween>
                      )}

                      <CodeBlock title="Response" value={endpoint.response} />
                    </SpaceBetween>
                  </ExpandableSection>
                ))}
              </SpaceBetween>
            </Container>
          ))}
        </SpaceBetween>
      ),
    },
  ];

  return (
    <SpaceBetween size="l">
      <Modal
        visible={createModalVisible}
        onDismiss={() => {
          setCreateModalVisible(false);
          setApiKeyName("");
          setCreatedKeyValue("");
          setCreatedKeyInfo(null);
        }}
        header={<Header variant="h2">Create API Key</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                onClick={() => {
                  setCreateModalVisible(false);
                  setApiKeyName("");
                  setCreatedKeyValue("");
                  setCreatedKeyInfo(null);
                }}
              >
                Close
              </Button>
              {!createdKeyValue && (
                <Button variant="primary" loading={creatingApiKey} onClick={handleCreateApiKey} disabled={!apiKeyName.trim()}>
                  Create
                </Button>
              )}
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {!createdKeyValue ? (
            <FormField label="Name" constraintText="Use a descriptive name so you can recognize this key later.">
              <Input value={apiKeyName} onChange={({ detail }) => setApiKeyName(detail.value)} placeholder="Production integration" />
            </FormField>
          ) : (
            <SpaceBetween size="m">
              <Alert type="warning">This key won&apos;t be shown again. Copy it now and store it securely.</Alert>
              {createdKeyInfo && (
                <Container header={<Header variant="h3">New API Key</Header>}>
                  <SpaceBetween size="s">
                    <Box><Box variant="awsui-key-label">Name</Box> {createdKeyInfo.name}</Box>
                    <Box><Box variant="awsui-key-label">Prefix</Box> {createdKeyInfo.key_prefix}</Box>
                    <SpaceBetween size="xxs">
                      <Box variant="awsui-key-label">Key</Box>
                      <div style={{ position: "relative" }}>
                        <div style={{ position: "absolute", top: 6, right: 6, zIndex: 1 }}>
                          <CopyToClipboard
                            variant="icon"
                            textToCopy={createdKeyValue}
                            copyButtonAriaLabel="Copy API key"
                            copySuccessText="Copied"
                            copyErrorText="Failed to copy"
                          />
                        </div>
                        <div
                          style={{
                            padding: "8px 40px 8px 12px",
                            backgroundColor: "#1a1a2e",
                            color: "#e0e0e0",
                            borderRadius: 8,
                            fontFamily: "monospace",
                            fontSize: 13,
                            wordBreak: "break-all",
                          }}
                        >
                          {createdKeyValue}
                        </div>
                      </div>
                    </SpaceBetween>
                  </SpaceBetween>
                </Container>
              )}
            </SpaceBetween>
          )}
        </SpaceBetween>
      </Modal>

      <Modal
        visible={deleteModalVisible}
        onDismiss={() => setDeleteModalVisible(false)}
        header={<Header variant="h2">Delete API Keys</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setDeleteModalVisible(false)}>Cancel</Button>
              <Button variant="primary" loading={deletingApiKey} onClick={handleDeleteApiKeys}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Alert type="warning">This action cannot be undone. Any integrations using these keys will stop working immediately.</Alert>
          <Box>
            {selectedApiKeys.length === 1
              ? `Delete API key "${selectedApiKeys[0].name}"?`
              : `Delete ${selectedApiKeys.length} API keys?`}
          </Box>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={cdkCreateVisible}
        onDismiss={() => setCdkCreateVisible(false)}
        header={<Header variant="h2">Add CDK Provider</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCdkCreateVisible(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={cdkCreating}
                onClick={handleCreateCdkProvider}
                disabled={!cdkCreateName.trim() || !cdkCreateUrl.trim()}
              >
                Create
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Name">
            <Input
              value={cdkCreateName}
              onChange={({ detail }) => setCdkCreateName(detail.value)}
              placeholder="My CDK Provider"
            />
          </FormField>
          <FormField label="Provider Type">
            <Select
              selectedOption={{ value: cdkCreateType, label: cdkCreateType }}
              onChange={({ detail }) => setCdkCreateType(detail.selectedOption.value || "activatecdk")}
              options={[{ value: "activatecdk", label: "activatecdk" }]}
            />
          </FormField>
          <FormField label="Base URL">
            <Input
              value={cdkCreateUrl}
              onChange={({ detail }) => setCdkCreateUrl(detail.value)}
              placeholder="https://activatecdk.me/shop/api/activate/chatgpt"
            />
          </FormField>
          <FormField label="Auth Type">
            <Select
              selectedOption={{ value: cdkCreateAuthType, label: cdkCreateAuthType }}
              onChange={({ detail }) => {
                const v = detail.selectedOption.value || "none";
                setCdkCreateAuthType(v);
                if (v === "none") setCdkCreateAuthValue("");
              }}
              options={[
                { value: "none", label: "none" },
                { value: "api_key", label: "api_key" },
                { value: "bearer", label: "bearer" },
              ]}
            />
          </FormField>
          {cdkCreateAuthType !== "none" && (
            <FormField label="Auth Value">
              <Input
                value={cdkCreateAuthValue}
                onChange={({ detail }) => setCdkCreateAuthValue(detail.value)}
                placeholder="Enter API key or bearer token"
                type="password"
              />
            </FormField>
          )}
        </SpaceBetween>
      </Modal>

      <Header variant="h1">Settings</Header>

      <Tabs
        activeTabId={activeTabId}
        onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
        tabs={tabs}
      />
    </SpaceBetween>
  );
}
