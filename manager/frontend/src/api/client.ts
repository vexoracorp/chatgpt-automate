const API_BASE = "http://localhost:8000/api";

const TOKEN_KEY = "manager_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

let _currentUser: { id: string; email: string } | null = null;

export function setCurrentUser(user: { id: string; email: string } | null): void {
  _currentUser = user;
}

export function getCurrentUser(): { id: string; email: string } | null {
  return _currentUser;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) return { "Content-Type": "application/json" };
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function authHeadersNoBody(): Record<string, string> {
  const token = getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "SessionExpiredError";
  }
}

export { SessionExpiredError };

type ErrorListener = (entry: { timestamp: string; url: string; method: string; status: number; message: string; response: unknown }) => void;
let _errorListener: ErrorListener | null = null;

export function setGlobalErrorListener(listener: ErrorListener | null): void {
  _errorListener = listener;
}

async function checkedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (e) {
    const entry = {
      timestamp: new Date().toISOString(),
      url: typeof input === "string" ? input : input.toString(),
      method: init?.method || "GET",
      status: 0,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
      requestBody: init?.body ? String(init.body).slice(0, 500) : null,
      possibleCauses: [
        "Server may be down or unreachable",
        "CORS policy may be blocking the request",
        "Network connection issue or timeout",
        "Request URL may be incorrect",
      ],
      response: null,
    };
    _errorListener?.(entry);
    throw e;
  }
  if (res.status === 401) {
    clearToken();
    throw new SessionExpiredError();
  }
  if (!res.ok) {
    const body = await res.clone().json().catch(() => null);
    const entry = {
      timestamp: new Date().toISOString(),
      url: typeof input === "string" ? input : input.toString(),
      method: init?.method || "GET",
      status: res.status,
      statusText: res.statusText,
      message: (body as Record<string, string>)?.detail || `Request failed: ${res.status}`,
      requestBody: init?.body ? String(init.body).slice(0, 500) : null,
      response: body,
    };
    _errorListener?.(entry);
  }
  return res;
}

export async function authMe(): Promise<{ user: { id: string; email: string }; role: string; totp_enabled: boolean; require_2fa: boolean }> {
  const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeadersNoBody() });
  if (res.status === 401) {
    clearToken();
    throw new SessionExpiredError();
  }
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export async function authLogout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: authHeadersNoBody() }).catch(() => {});
  clearToken();
}

export interface Account {
  id: string;
  email: string;
  status: string;
  name: string;
  plan: string;
  plan_expiry: string;
  codex_weekly_used: number;
  codex_weekly_reset_hours: number;
  codex_5h_used: number;
  codex_5h_reset_min: number;
  proxy_url: string | null;
  proxy_label: string;
  proxy_test: ProxyTestResult | null;
  session_token: string | null;
  access_token: string | null;
  codex_token: string | null;
  password: string;
  created_at: string;
  last_login: string | null;
}

export interface TaskResult {
  task_id: string;
  account_id: string;
  type: string;
  status: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  last_login: string;
}

export interface Proxy {
  id: string;
  protocol: string;
  host: string;
  port: number;
  username: string;
  password: string;
  label: string;
  group: string;
  subscription_id: string;
  url: string;
  created_at: string;
  last_test: ProxyTestResult | null;
}

export interface ProxyTestResult {
  ip: string;
  country: string;
  country_code: string;
  region: string;
  city: string;
  asn: string;
  org: string;
  timezone: string;
  latency_ms: number;
}

export async function fetchAccounts(): Promise<Account[]> {
  const res = await checkedFetch(`${API_BASE}/accounts`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);
  return res.json();
}

export async function fetchAccount(id: string): Promise<Account> {
  const res = await checkedFetch(`${API_BASE}/accounts/${id}`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch account: ${res.status}`);
  return res.json();
}

export async function executeAccountAction(id: string, action: string): Promise<{ action: string; result: Record<string, unknown> }> {
  const res = await checkedFetch(`${API_BASE}/accounts/${id}/action`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Action failed: ${res.status}`);
  }
  return res.json();
}

export async function getAccountMailbox(id: string): Promise<{ mailbox: Mailbox | null }> {
  const res = await checkedFetch(`${API_BASE}/accounts/${id}/mailbox`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to get mailbox: ${res.status}`);
  return res.json();
}

export async function bindAccountMailbox(id: string, mailboxId: string | null): Promise<{ mailbox: Mailbox | null }> {
  const res = await checkedFetch(`${API_BASE}/accounts/${id}/mailbox`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ mailbox_id: mailboxId || "" }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Bind failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteAccount(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/accounts/${id}`, { method: "DELETE", headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to delete account: ${res.status}`);
}

export async function importSession(data: {
  email?: string;
  session_json: string;
  proxy_url?: string;
}): Promise<Account> {
  const res = await checkedFetch(`${API_BASE}/accounts/import-session`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Import failed: ${res.status}`);
  }
  return res.json();
}

export async function refreshAccount(id: string): Promise<Account> {
  const res = await checkedFetch(`${API_BASE}/accounts/${id}/refresh`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Refresh failed: ${res.status}`);
  }
  return res.json();
}

export async function updateAccountProxy(id: string, proxyUrl: string | null): Promise<Account> {
  const res = await checkedFetch(`${API_BASE}/accounts/${id}/proxy`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ proxy_url: proxyUrl }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to update proxy: ${res.status}`);
  }
  return res.json();
}

export async function postRegisterFlow(id: string): Promise<TaskResult> {
  const res = await checkedFetch(`${API_BASE}/accounts/${id}/post-register`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Post-register failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchWorkspaceId(accountId: string): Promise<string> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/workspace-id`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch workspace ID: ${res.status}`);
  }
  const data = await res.json();
  return data.workspace_id;
}

export async function fetchAccountSettings(accountId: string): Promise<{ settings: Record<string, unknown>; account_settings: Record<string, unknown> }> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/settings`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch settings: ${res.status}`);
  }
  return res.json();
}

export async function updateAccountSetting(accountId: string, feature: string, value: boolean): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/settings`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ feature, value }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to update setting: ${res.status}`);
  }
  return res.json();
}

export interface ChatGPTProfile {
  user_id: string;
  username: string;
  display_name: string;
  profile_picture_url: string | null;
  likeness_picture_url: string | null;
  bio_freeform: string | null;
  bio_snippets: string[] | null;
  location: string | null;
  work: string | null;
  schools: string[] | null;
  connection_state: string | null;
}

export async function fetchAccountProfile(accountId: string): Promise<ChatGPTProfile> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/profile`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch profile: ${res.status}`);
  }
  return res.json();
}

export async function updateAccountProfileName(accountId: string, name: string): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/profile/name`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to update display name: ${res.status}`);
  }
  return res.json();
}

export async function updateAccountProfileUsername(accountId: string, username: string): Promise<ChatGPTProfile> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/profile/username`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to update username: ${res.status}`);
  }
  return res.json();
}

export interface AgeVerificationStatus {
  is_adult: boolean;
  has_verified_age_or_dob: boolean;
  age_is_known: boolean;
  is_u18_model_policy_enabled: boolean;
  show_age_verification_setting: boolean;
  age_status: string;
  citron_eligibility_status: string;
}

export interface AgeVerificationInquiry {
  id: string;
  status: string;
  url: string;
}

export async function fetchAgeVerification(accountId: string): Promise<AgeVerificationStatus> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/age-verification`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch age verification: ${res.status}`);
  }
  return res.json();
}

export async function startAgeVerification(accountId: string): Promise<AgeVerificationInquiry> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/age-verification/verify`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to start age verification: ${res.status}`);
  }
  return res.json();
}

export interface ClientApplication {
  id: string;
  name: string;
  type: string;
}

export interface ClientApplicationsResponse {
  items: ClientApplication[];
  third_party_items: ClientApplication[];
  usage_info: Record<string, unknown>;
}

export interface CodexSettings {
  user_id: string;
  git_diff_mode: string;
  branch_format: string;
  custom_instructions: string | null;
  preferred_github_connector_id: string | null;
  code_review_preference: string;
  code_review_trigger_policy: string;
  alpha_opt_in: boolean;
  allow_credits_for_code_reviews: boolean;
}

export interface CodexUsageDay {
  date: string;
  product_surface_usage_values: Record<string, number>;
}

export interface CodexUsageResponse {
  data: CodexUsageDay[];
  units: string;
  group_by: string;
}

export async function fetchCodexUsage(accountId: string, startDate: string, endDate: string, groupBy: string = "day"): Promise<CodexUsageResponse> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, group_by: groupBy });
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/codex-usage?${params}`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch codex usage: ${res.status}`);
  }
  return res.json();
}

export async function fetchCodexSettings(accountId: string): Promise<CodexSettings> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/codex-settings`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch codex settings: ${res.status}`);
  }
  return res.json();
}

export async function updateCodexSettings(accountId: string, updates: Partial<CodexSettings>): Promise<CodexSettings> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/codex-settings`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to update codex settings: ${res.status}`);
  }
  return res.json();
}

export async function fetchClientApplications(accountId: string): Promise<ClientApplicationsResponse> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/client-applications`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch client applications: ${res.status}`);
  }
  return res.json();
}

export async function disconnectClientApplication(accountId: string, appId: string): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/client-applications/${appId}`, {
    method: "DELETE",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to disconnect application: ${res.status}`);
  }
  return res.json();
}

export interface AmphoraResponse {
  id: string | null;
  role: string | null;
}

export async function fetchAmphora(accountId: string): Promise<AmphoraResponse> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/amphora`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch amphora: ${res.status}`);
  }
  return res.json();
}

export async function deleteBrowserContext(accountId: string): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/browser-context`, {
    method: "DELETE",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to delete browser context: ${res.status}`);
  }
  return res.json();
}

export async function deleteAllConversations(accountId: string): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/conversations`, {
    method: "DELETE",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to delete conversations: ${res.status}`);
  }
  return res.json();
}

export async function archiveAllChats(accountId: string): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/archive-all-chats`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to archive conversations: ${res.status}`);
  }
  return res.json();
}

export interface ArchivedChat {
  id: string;
  title: string;
  create_time: string;
  update_time: string;
  is_archived: boolean;
}

export async function fetchArchivedChats(accountId: string): Promise<{ items: ArchivedChat[]; total: number }> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/archived-chats`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch archived chats: ${res.status}`);
  }
  return res.json();
}

export async function unarchiveConversation(accountId: string, conversationId: string): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/conversations/${conversationId}/unarchive`, {
    method: "PATCH",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to unarchive conversation: ${res.status}`);
  }
  return res.json();
}

export interface NotificationOption {
  name: string;
  channel: string;
  enabled: boolean;
}

export interface NotificationCategory {
  category: string;
  name: string;
  description: string;
  options: NotificationOption[];
}

export async function fetchNotificationSettings(accountId: string): Promise<{ settings: NotificationCategory[] }> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/notification-settings`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch notification settings: ${res.status}`);
  }
  return res.json();
}

export async function updateNotificationSettings(
  accountId: string,
  updates: Record<string, Record<string, boolean>>
): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/notification-settings`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to update notification settings: ${res.status}`);
  }
  return res.json();
}

export async function registerAccount(data: {
  email: string;
  password?: string;
  proxy_url?: string;
  name?: string;
  birthdate?: string;
  run_name?: string;
  auto_start?: boolean;
  verbose?: boolean;
}): Promise<TaskResult> {
  const res = await checkedFetch(`${API_BASE}/accounts/register`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status}`);
  return res.json();
}

export async function loginAccount(data: {
  email: string;
  proxy_url?: string;
  run_name?: string;
  auto_start?: boolean;
  verbose?: boolean;
}): Promise<TaskResult> {
  const res = await checkedFetch(`${API_BASE}/accounts/login`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return res.json();
}

export interface CustomerPortalResponse {
  url: string;
}

export async function fetchCustomerPortal(accountId: string): Promise<CustomerPortalResponse> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/customer-portal`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to get customer portal: ${res.status}`);
  }
  return res.json();
}

export interface CheckoutResponse {
  tag: string;
  checkout_session_id: string;
  publishable_key: string;
  processor_entity: string;
  checkout_ui_mode: string;
  automatic_tax_enabled: boolean;
  plan_name: string;
  requires_manual_approval: boolean;
  billing_details: { country: string; currency: string };
  url: string | null;
  client_secret: string;
  status: string;
  payment_status: string;
  checkout_provider: string;
}

export async function createCheckout(
  accountId: string,
  data: {
    plan_name: string;
    promo_campaign_id?: string;
    entry_point?: string;
    team_plan_data?: { workspace_name: string; price_interval: string; seat_quantity: number };
    billing_country?: string;
    billing_currency?: string;
    checkout_ui_mode?: string;
  },
): Promise<CheckoutResponse> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/checkout`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Checkout failed: ${res.status}`);
  return res.json();
}

export async function submitOTP(data: {
  account_id: string;
  otp: string;
}): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/accounts/otp`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`OTP submit failed: ${res.status}`);
}

export interface ShareTokenInfo {
  id: string;
  account_id: string;
  include_mailbox: boolean;
  include_session: boolean;
  expires_at: string;
  created_at: string;
}

export interface ShareTokenCreateResult {
  token: string;
  expires_at: string;
  include_mailbox: boolean;
  include_session: boolean;
}

export async function createShareToken(accountId: string, data: {
  hours: number;
  include_mailbox: boolean;
  include_session: boolean;
}): Promise<ShareTokenCreateResult> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/share`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to create share link: ${res.status}`);
  }
  return res.json();
}

export async function fetchShareTokens(accountId: string): Promise<ShareTokenInfo[]> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/shares`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch share tokens: ${res.status}`);
  return res.json();
}

export async function revokeShareToken(tokenId: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/shares/${tokenId}`, { method: "DELETE", headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to revoke share token: ${res.status}`);
}

export async function fetchSharedAccount(tokenId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/shared/${tokenId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Share link invalid: ${res.status}`);
  }
  return res.json();
}

export async function startCodexOAuth(data: {
  account_id: string;
  authorize_url: string;
  workspace_id: string;
  proxy_url?: string;
  run_name?: string;
  auto_start?: boolean;
  verbose?: boolean;
}): Promise<TaskResult> {
  const res = await checkedFetch(`${API_BASE}/accounts/codex`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Codex OAuth failed: ${res.status}`);
  return res.json();
}

export async function startCodexDevice(data: {
  account_id: string;
  user_code: string;
  device_code: string;
  workspace_id: string;
  proxy_url?: string;
  run_name?: string;
  auto_start?: boolean;
  verbose?: boolean;
}): Promise<TaskResult> {
  const res = await checkedFetch(`${API_BASE}/accounts/codex-device`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Codex device login failed: ${res.status}`);
  }
  return res.json();
}

export interface CdkKeyInfo {
  code: string;
  status: string;
  service: string;
  plan: string;
  term: string;
}

export interface CdkProviderInfo {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  auth_type: string;
  is_enabled: boolean;
  settings: Record<string, unknown> | null;
  created_at: string;
}

export async function fetchCdkProviders(): Promise<CdkProviderInfo[]> {
  const res = await checkedFetch(`${API_BASE}/cdk-providers`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch CDK providers: ${res.status}`);
  return res.json();
}

export async function createCdkProvider(data: {
  name: string;
  provider_type: string;
  base_url: string;
  auth_type?: string;
  auth_value?: string;
}): Promise<{ id: string; name: string }> {
  const res = await checkedFetch(`${API_BASE}/cdk-providers`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to create CDK provider: ${res.status}`);
  }
  return res.json();
}

export async function updateCdkProvider(id: string, data: Record<string, unknown>): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/cdk-providers/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to update CDK provider: ${res.status}`);
  }
}

export async function deleteCdkProvider(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/cdk-providers/${id}`, {
    method: "DELETE",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to delete CDK provider: ${res.status}`);
  }
}

export async function validateCdk(providerId: string, code: string): Promise<CdkKeyInfo> {
  const res = await checkedFetch(`${API_BASE}/cdk-providers/${providerId}/validate/${encodeURIComponent(code)}`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `CDK validation failed: ${res.status}`);
  }
  return res.json();
}

export async function activateCdk(accountId: string, code: string, providerId: string): Promise<TaskResult> {
  const res = await checkedFetch(`${API_BASE}/accounts/${accountId}/cdk-activate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ code, provider_id: providerId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `CDK activation failed: ${res.status}`);
  }
  return res.json();
}

export async function bulkCdkStatus(providerId: string, codes: string[]): Promise<{ found: CdkKeyInfo[]; not_found: string[] }> {
  const res = await checkedFetch(`${API_BASE}/cdk-providers/${providerId}/bulk-status`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ codes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Bulk CDK status failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchUsers(): Promise<User[]> {
  const res = await checkedFetch(`${API_BASE}/users`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
  return res.json();
}

export async function createUser(data: {
  email: string;
  password: string;
  name?: string;
  role?: string;
}): Promise<User> {
  const res = await checkedFetch(`${API_BASE}/users`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create user: ${res.status}`);
  return res.json();
}

export async function deleteUser(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/users/${id}`, { method: "DELETE", headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to delete user: ${res.status}`);
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/users/${id}/reset-password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ new_password: newPassword }),
  });
  if (!res.ok) throw new Error(`Failed to reset password: ${res.status}`);
}

export async function updateUser(id: string, data: { name?: string; email?: string; role?: string }): Promise<User> {
  const res = await checkedFetch(`${API_BASE}/users/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to update user: ${res.status}`);
  }
  return res.json();
}

export async function getOwnerContact(): Promise<{ email: string }> {
  const res = await fetch(`${API_BASE}/owner-contact`);
  if (!res.ok) return { email: "" };
  return res.json();
}

export async function updateProfile(data: { name?: string; email?: string }): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/me/profile`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update profile: ${res.status}`);
}

export async function changePassword(data: { current_password: string; new_password: string; totp_code?: string }): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/me/change-password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to change password: ${res.status}`);
  }
}

export interface TOTPSetup {
  secret: string;
  qr_uri: string;
  qr_base64: string;
}

export async function setupTOTP(): Promise<TOTPSetup> {
  const res = await checkedFetch(`${API_BASE}/me/totp-setup`, { method: "POST", headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to setup 2FA: ${res.status}`);
  return res.json();
}

export async function verifyTOTP(code: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/me/totp-verify`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`Invalid 2FA code`);
}

export async function disableTOTP(): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/me/totp-disable`, { method: "POST", headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to disable 2FA: ${res.status}`);
}

export async function verify2FALogin(userId: string, code: string): Promise<{ token: string }> {
  const res = await fetch(`${API_BASE}/auth/verify-2fa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, code }),
  });
  if (!res.ok) throw new Error(`Invalid 2FA code`);
  return res.json();
}

export interface SharePolicy {
  enabled: boolean;
  max_hours: number;
  allow_session: boolean;
  allow_mailbox: boolean;
  allowed_roles: string[];
}

export interface AccessPolicy {
  session_view_roles: string[];
}

export interface AppSettings {
  org_name: string;
  allowed_ips: string[];
  require_2fa: boolean;
  allow_email_change: boolean;
  allow_password_change: boolean;
  password_expiry_days: number;
  session_timeout_min: number;
  share_policy?: SharePolicy;
  access_policy?: AccessPolicy;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  user_id: string;
  created_at: string;
  last_used: string | null;
}

export interface CreatedApiKey extends ApiKeyInfo {
  key: string;
}

export async function getSettings(): Promise<AppSettings> {
  const res = await checkedFetch(`${API_BASE}/settings`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to get settings: ${res.status}`);
  return res.json();
}

export async function saveSettings(data: AppSettings): Promise<AppSettings> {
  const res = await checkedFetch(`${API_BASE}/settings`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to save settings: ${res.status}`);
  return res.json();
}

export async function fetchApiKeys(): Promise<ApiKeyInfo[]> {
  const res = await checkedFetch(`${API_BASE}/api-keys`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch API keys: ${res.status}`);
  return res.json();
}

export async function createApiKey(name: string): Promise<CreatedApiKey> {
  const res = await checkedFetch(`${API_BASE}/api-keys`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to create API key: ${res.status}`);
  }
  return res.json();
}

export async function deleteApiKey(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/api-keys/${id}`, { method: "DELETE", headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to delete API key: ${res.status}`);
  }
}

export async function fetchProxies(): Promise<Proxy[]> {
  const res = await checkedFetch(`${API_BASE}/proxies`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch proxies: ${res.status}`);
  return res.json();
}

export async function createProxy(data: {
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  label?: string;
}): Promise<Proxy> {
  const res = await checkedFetch(`${API_BASE}/proxies`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create proxy: ${res.status}`);
  return res.json();
}

export async function testProxyBeforeAdd(data: {
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}): Promise<ProxyTestResult> {
  const res = await checkedFetch(`${API_BASE}/proxies/test`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Proxy test failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteProxy(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/proxies/${id}`, { method: "DELETE", headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to delete proxy: ${res.status}`);
}

export async function updateProxyLabel(id: string, label: string): Promise<Proxy> {
  const res = await checkedFetch(`${API_BASE}/proxies/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to update proxy: ${res.status}`);
  }
  return res.json();
}

export async function testProxy(id: string): Promise<ProxyTestResult> {
  const res = await checkedFetch(`${API_BASE}/proxies/${id}/test`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Proxy test failed: ${res.status}`);
  }
  return res.json();
}

export interface OutlookConfig {
  configured: boolean;
  tenant_id: string;
  client_id: string;
}

export async function getOutlookConfig(): Promise<OutlookConfig> {
  const res = await checkedFetch(`${API_BASE}/outlook`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to get outlook config: ${res.status}`);
  return res.json();
}

export async function createProxySession(): Promise<string> {
  const res = await checkedFetch(`${API_BASE}/proxy-session`, { method: "POST", headers: authHeadersNoBody() });
  if (!res.ok) throw new Error("Failed to create proxy session");
  const data = await res.json();
  return data.token;
}

export async function setOutlookConfig(data: {
  tenant_id: string;
  client_id: string;
  client_secret: string;
}): Promise<OutlookConfig> {
  const res = await checkedFetch(`${API_BASE}/outlook`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to save outlook config: ${res.status}`);
  return res.json();
}

export interface Mailbox {
  id: string;
  email: string;
  password: string;
  refresh_token: string;
  client_id: string;
  status: string;
  assigned_account_id: string | null;
  created_at: string;
}

export interface MailSummary {
  id: string;
  from_addr: string;
  subject: string;
  received_at: string;
  is_otp: boolean;
  otp_code: string | null;
}

export async function fetchMailboxes(): Promise<Mailbox[]> {
  const res = await checkedFetch(`${API_BASE}/mailboxes`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch mailboxes: ${res.status}`);
  return res.json();
}

export async function createMailbox(data: {
  email: string;
  password?: string;
  refresh_token?: string;
  client_id?: string;
}): Promise<Mailbox> {
  const res = await checkedFetch(`${API_BASE}/mailboxes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create mailbox: ${res.status}`);
  return res.json();
}

export async function importMailboxes(
  items: { email: string; password?: string; refresh_token?: string; client_id?: string }[]
): Promise<{ imported: number; skipped: number }> {
  const res = await checkedFetch(`${API_BASE}/mailboxes/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(items),
  });
  if (!res.ok) throw new Error(`Import failed: ${res.status}`);
  return res.json();
}

export async function importMailboxesText(
  text: string
): Promise<{ imported: number; skipped: number }> {
  const res = await checkedFetch(`${API_BASE}/mailboxes/import-text`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Import failed: ${res.status}`);
  return res.json();
}

export async function importMailboxesFile(
  file: File
): Promise<{ imported: number; skipped: number }> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await checkedFetch(`${API_BASE}/mailboxes/import-file`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`Import failed: ${res.status}`);
  return res.json();
}

export async function deleteMailbox(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/mailboxes/${id}`, { method: "DELETE", headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to delete mailbox: ${res.status}`);
}

export async function fetchMailboxMails(id: string): Promise<MailSummary[]> {
  const res = await checkedFetch(`${API_BASE}/mailboxes/${id}/mails`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch mails: ${res.status}`);
  }
  return res.json();
}

export interface MailDetail {
  id: string;
  from_addr: string;
  subject: string;
  body: string;
  received_at: string;
  is_otp: boolean;
  otp_code: string | null;
}

export async function fetchMailDetail(mbId: string, mailId: string): Promise<MailDetail> {
  const res = await checkedFetch(`${API_BASE}/mailboxes/${mbId}/mails/${encodeURIComponent(mailId)}`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to fetch mail: ${res.status}`);
  }
  return res.json();
}

export async function fetchMailboxOTP(mbId: string): Promise<{ otp_code: string; subject: string; received_at: string }> {
  const res = await checkedFetch(`${API_BASE}/mailboxes/${mbId}/otp`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `No OTP found`);
  }
  return res.json();
}

export interface SubscriptionNode {
  protocol: string;
  name: string;
  address: string;
  port: number;
  [key: string]: unknown;
}

export interface Subscription {
  id: string;
  name: string;
  url: string;
  nodes: SubscriptionNode[];
  metadata: { remaining_traffic?: string; expire_date?: string; reset_in?: string };
  updated_at: string;
}

export async function fetchSubscriptions(): Promise<Subscription[]> {
  const res = await checkedFetch(`${API_BASE}/subscriptions`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch subscriptions: ${res.status}`);
  return res.json();
}

export async function createSubscription(data: { name: string; url: string }): Promise<Subscription> {
  const res = await checkedFetch(`${API_BASE}/subscriptions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to create subscription: ${res.status}`);
  }
  return res.json();
}

export interface SubscriptionPreview {
  name: string;
  url: string;
  resolved_url: string;
  node_count: number;
  metadata: { remaining_traffic?: string; expire_date?: string; reset_in?: string };
  nodes: { protocol: string; name: string; address: string; port: number }[];
}

export async function previewSubscription(data: { name: string; url: string }): Promise<SubscriptionPreview> {
  const res = await checkedFetch(`${API_BASE}/subscriptions/preview`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to preview: ${res.status}`);
  }
  return res.json();
}

export async function refreshSubscription(id: string): Promise<Subscription> {
  const res = await checkedFetch(`${API_BASE}/subscriptions/${id}/refresh`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) throw new Error(`Failed to refresh: ${res.status}`);
  return res.json();
}

export async function deleteSubscription(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/subscriptions/${id}`, { method: "DELETE", headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to delete: ${res.status}`);
}

export async function startNode(subId: string, nodeIndex: number): Promise<{ node_id: string; local_port: number; proxy_url: string }> {
  const res = await checkedFetch(`${API_BASE}/subscriptions/${subId}/nodes/${nodeIndex}/start`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to start node: ${res.status}`);
  }
  return res.json();
}

export async function stopNode(subId: string, nodeIndex: number): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/subscriptions/${subId}/nodes/${nodeIndex}/stop`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) throw new Error(`Failed to stop node: ${res.status}`);
}

export async function fetchRunningNodes(): Promise<Record<string, { port: number; node: SubscriptionNode }>> {
  const res = await checkedFetch(`${API_BASE}/subscriptions/running`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch running nodes: ${res.status}`);
  return res.json();
}

export async function stopXrayNode(nodeId: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/xray/stop/${encodeURIComponent(nodeId)}`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) throw new Error(`Failed to stop xray node: ${res.status}`);
}

export interface IpRiskInfo {
  ip: string;
  cidr: string;
  is_datacenter: boolean;
  isResidential: boolean;
  is_vpn: boolean;
  is_proxy: boolean;
  is_tor: boolean;
  is_crawler: boolean;
  is_abuser: boolean;
  is_mobile: boolean;
  company_type: string;
  company_name: string;
  abuser_score: string;
  datacenter_name: string;
  asn: number;
  asOrganization: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  timezone: string;
  asn_kind: string;
  trust_score: number;
}

export async function fetchIpRisk(ip: string): Promise<IpRiskInfo> {
  const res = await checkedFetch(`${API_BASE}/proxy-risk/${encodeURIComponent(ip)}`, { headers: authHeadersNoBody() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `IP risk check failed: ${res.status}`);
  }
  return res.json();
}

export interface ProxyTestInfo {
  ip?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  asn?: string;
  org?: string;
  latency_ms?: number;
}

export interface WorkflowRun {
  id: string;
  name: string;
  type: string;
  email: string;
  proxy_url: string | null;
  proxy_label: string | null;
  proxy_test: ProxyTestInfo | null;
  status: string;
  error: string | null;
  output: Record<string, unknown> | null;
  manual_otp?: boolean;
  callback_url?: string;
  started_at: string;
  finished_at: string | null;
}

export interface WorkflowRunLog {
  ts: string;
  msg: string;
}

export interface WorkflowRunDetail extends WorkflowRun {
  logs: WorkflowRunLog[];
}

export async function fetchWorkflowRuns(): Promise<WorkflowRun[]> {
  const res = await checkedFetch(`${API_BASE}/workflow-runs`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch workflow runs: ${res.status}`);
  return res.json();
}

export async function fetchWorkflowRun(id: string): Promise<WorkflowRunDetail> {
  const res = await checkedFetch(`${API_BASE}/workflow-runs/${id}`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch workflow run: ${res.status}`);
  return res.json();
}

export async function startWorkflowRun(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/workflow-runs/${id}/start`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to start run: ${res.status}`);
  }
}

export async function stopWorkflowRun(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/workflow-runs/${id}/stop`, {
    method: "POST",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to stop run: ${res.status}`);
  }
}

export async function deleteWorkflowRun(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/workflow-runs/${id}`, {
    method: "DELETE",
    headers: authHeadersNoBody(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to delete run: ${res.status}`);
  }
}

export interface ExtensionInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  settings_schema: Record<string, unknown>;
  enabled: boolean;
  settings: Record<string, unknown>;
  loaded: boolean;
  has_ui: boolean;
}

export async function fetchExtensions(): Promise<ExtensionInfo[]> {
  const res = await checkedFetch(`${API_BASE}/extensions`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed to fetch extensions: ${res.status}`);
  return res.json();
}

export async function enableExtension(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/extensions/${id}/enable`, { method: "POST", headers: authHeadersNoBody() });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Failed: ${res.status}`); }
}

export async function disableExtension(id: string): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/extensions/${id}/disable`, { method: "POST", headers: authHeadersNoBody() });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Failed: ${res.status}`); }
}

export async function getExtensionSettings(id: string): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/extensions/${id}/settings`, { headers: authHeadersNoBody() });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

export async function saveExtensionSettings(id: string, settings: Record<string, unknown>): Promise<void> {
  const res = await checkedFetch(`${API_BASE}/extensions/${id}/settings`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify(settings),
  });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Failed: ${res.status}`); }
}

export async function fetchExtensionUI(extId: string): Promise<Record<string, unknown>> {
  const res = await checkedFetch(`${API_BASE}/extensions/${extId}/ui`, { headers: authHeadersNoBody() });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Failed: ${res.status}`); }
  return res.json();
}

export async function extensionApiFetch(method: string, url: string, body?: unknown): Promise<unknown> {
  const fullUrl = url.startsWith("http") ? url : `${API_BASE.replace("/api", "")}${url}`;
  const opts: RequestInit = { method, headers: authHeaders() };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await checkedFetch(fullUrl, opts);
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Failed: ${res.status}`); }
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}
