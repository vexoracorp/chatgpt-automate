import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Wizard from "@cloudscape-design/components/wizard";
import { type Account, type CheckoutResponse, fetchAccounts, createCheckout, executeAccountAction } from "../api/client";

const PLAN_OPTIONS = [
  { label: "ChatGPT Plus", value: "chatgptplusplan", price: 20 },
  { label: "ChatGPT Pro", value: "chatgptproplan", price: 200 },
  { label: "ChatGPT Team", value: "chatgptteamplan", price: 25 },
];

interface PromoCampaign {
  id: string;
  planName: string;
  title: string;
  summary: string;
  discountPercent: number | null;
  duration: string;
  promotionTypeLabel: string;
}

export default function PromoCheckoutWorkflow() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);

  const [account, setAccount] = useState<{ label: string; value: string } | null>(null);
  const [plan, setPlan] = useState<{ label: string; value: string }>(PLAN_OPTIONS[0]);
  const [promoId, setPromoId] = useState("");
  const [promoOption, setPromoOption] = useState<{ label: string; value: string; description?: string } | null>(null);
  const [promoCampaigns, setPromoCampaigns] = useState<PromoCampaign[]>([]);
  const [loadingPromos, setLoadingPromos] = useState(false);
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [seatQuantity, setSeatQuantity] = useState("5");
  const [accountPlanWarning, setAccountPlanWarning] = useState("");
  const [billingCountry, setBillingCountry] = useState<{ label: string; value: string }>({ label: "Japan", value: "JP" });
  const [checkoutMode, setCheckoutMode] = useState<{ label: string; value: string }>({ label: "Custom (chatgpt.com)", value: "custom" });

  const CHECKOUT_MODE_OPTIONS = [
    { label: "Proxy Mode (chatgpt.com)", value: "custom", description: "chatgpt.com으로 연결되는 단축 링크를 생성합니다. 사이트 내에서 결제를 완료할 수 있습니다." },
    { label: "Hosted Mode (Stripe)", value: "hosted", description: "pay.openai.com으로 연결되는 링크를 생성합니다. 외부 Stripe 페이지로 리디렉션됩니다." },
  ];

  const BILLING_OPTIONS = [
    { label: "United States", value: "US", currency: "USD" },
    { label: "South Korea", value: "KR", currency: "KRW" },
    { label: "United Kingdom", value: "GB", currency: "GBP" },
    { label: "Japan", value: "JP", currency: "JPY" },
    { label: "Singapore", value: "SG", currency: "SGD" },
  ];

  const isPlusPromo = promoId.includes("plus") && plan.value === "chatgptplusplan";
  const filteredBillingOptions = isPlusPromo
    ? BILLING_OPTIONS.filter((b) => b.value === "JP")
    : BILLING_OPTIONS;

  const selectedBilling = BILLING_OPTIONS.find((b) => b.value === billingCountry.value) || BILLING_OPTIONS[0];

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

  const accountOptions = accounts
    .filter((a) => a.status === "active")
    .map((a) => ({ label: a.email, value: a.id, description: `${a.plan || "free"} plan` }));

  const handleAccountChange = async (opt: { label: string; value: string }) => {
    setAccount(opt);
    setPromoCampaigns([]);
    setPromoOption(null);
    setPromoId("");
    setLoadingPromos(true);
    setAccountPlanWarning("");

    const acc = accounts.find((a) => a.id === opt.value);
    const accPlan = (acc?.plan || "").toLowerCase();
    if (accPlan && !accPlan.includes("free")) {
      setAccountPlanWarning(`This account is on ${acc?.plan}. Promo codes may not work correctly on accounts that already have a paid plan.`);
    }
    try {
      const res = await executeAccountAction(opt.value, "get_account_info");
      const data = res.result as Record<string, unknown>;
      const accounts_arr = data.accounts as Record<string, unknown>[] | undefined;
      const firstAccount = accounts_arr?.[0] as Record<string, unknown> | undefined;
      const eligible = firstAccount?.eligible_promo_campaigns as Record<string, Record<string, unknown>> | undefined;
      if (eligible) {
        const campaigns: PromoCampaign[] = Object.entries(eligible).map(([, val]) => {
          const meta = val.metadata as Record<string, unknown>;
          const discount = meta.discount as Record<string, unknown> | null;
          const duration = meta.duration as Record<string, unknown> | null;
          return {
            id: val.id as string,
            planName: meta.plan_name as string,
            title: meta.title as string,
            summary: meta.summary as string,
            discountPercent: discount?.percentage as number | null,
            duration: duration ? `${duration.num_periods} ${duration.period}` : "",
            promotionTypeLabel: meta.promotion_type_label as string,
          };
        });
        setPromoCampaigns(campaigns);
        if (campaigns.length > 0) {
          setPromoOption({ label: `${campaigns[0].title} (${campaigns[0].id})`, value: campaigns[0].id, description: campaigns[0].promotionTypeLabel });
          setPromoId(campaigns[0].id);
        }
      }
    } catch {
      void 0;
    } finally {
      setLoadingPromos(false);
    }
  };

  const PROMO_TEMPLATES = [
    { id: "plus-1-month-free", label: "Plus 1 Month Free", plan: "chatgptplusplan" },
    { id: "team-1-month-free", label: "Team 1 Month Free", plan: "chatgptteamplan" },
  ];

  const getDiscountForPlan = (planValue: string): number => {
    if (!promoId) return 0;
    const campaign = promoCampaigns.find((c) => c.id === promoId && c.planName === planValue);
    if (campaign?.discountPercent) return campaign.discountPercent;
    const template = PROMO_TEMPLATES.find((t) => t.id === promoId && t.plan === planValue);
    if (template && promoId.includes("free")) return 100;
    return 0;
  };

  const promoOptions = [
    { label: "None (no promo)", value: "", description: "Proceed without promo code" },
    ...promoCampaigns.map((c) => ({
      label: `${c.title} (${c.id})`,
      value: c.id,
      description: `${c.promotionTypeLabel} — from account`,
    })),
    ...PROMO_TEMPLATES
      .filter((t) => !promoCampaigns.some((c) => c.id === t.id))
      .map((t) => ({
        label: `${t.label} (${t.id})`,
        value: t.id,
        description: "Template",
      })),
    { label: "Custom (enter manually)", value: "__custom__", description: "Type a custom promo campaign ID" },
  ];

  const getPromoMatchError = (): string => {
    if (!promoId || promoOption?.value === "" || promoOption?.value === "__custom__") return "";
    const campaign = promoCampaigns.find((c) => c.id === promoId);
    if (campaign && campaign.planName !== plan.value) {
      return `Promo "${promoId}" is for ${campaign.planName}, but selected plan is ${plan.value}`;
    }
    const template = PROMO_TEMPLATES.find((t) => t.id === promoId);
    if (template && template.plan !== plan.value) {
      return `Promo "${promoId}" is for ${template.plan}, but selected plan is ${plan.value}`;
    }
    return "";
  };

  const promoMatchError = getPromoMatchError();
  const isTeamPlan = plan.value === "chatgptteamplan";

  const handleNavigate = ({ detail }: { detail: { requestedStepIndex: number } }) => {
    if (detail.requestedStepIndex > activeStep) {
      setTried(true);
      if (activeStep === 0 && !account) return;
      if (activeStep === 0 && promoMatchError) return;
      if (activeStep === 0 && isTeamPlan && !workspaceName) return;
    } else {
      setTried(false);
    }
    setActiveStep(detail.requestedStepIndex);
  };

  const handleSubmit = async () => {
    if (!account) return;
    if (promoMatchError) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await createCheckout(account.value, {
        plan_name: plan.value,
        promo_campaign_id: promoId || undefined,
        billing_country: selectedBilling.value,
        billing_currency: selectedBilling.currency,
        checkout_ui_mode: checkoutMode.value,
        team_plan_data: isTeamPlan ? {
          workspace_name: workspaceName,
          price_interval: "month",
          seat_quantity: parseInt(seatQuantity) || 5,
        } : undefined,
      });
      setResult(res);
      setActiveStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Wizard
      i18nStrings={{
        stepNumberLabel: (n) => `Step ${n}`,
        collapsedStepsLabel: (n, total) => `Step ${n} of ${total}`,
        submitButton: loading ? "Creating..." : "Create Checkout",
        cancelButton: result ? "Done" : "Cancel",
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
          title: "Account & Plan",
          description: "Select the account and plan for checkout",
          errorText: tried && !account ? "Account is required" : "",
          content: (
            <Container header={<Header variant="h2">Checkout Configuration</Header>}>
              <SpaceBetween size="l">
                <FormField label="Account" constraintText="Only accounts with active sessions are shown">
                  <Select
                    selectedOption={account}
                    onChange={({ detail }) => handleAccountChange(detail.selectedOption as { label: string; value: string })}
                    options={accountOptions}
                    placeholder="Select account"
                    filteringType="auto"
                  />
                </FormField>
                {accountPlanWarning && (
                  <Alert type="warning">{accountPlanWarning}</Alert>
                )}
                <FormField label="Plan">
                  <Select
                    selectedOption={{
                      ...plan,
                      description: (() => {
                        const p = PLAN_OPTIONS.find((o) => o.value === plan.value);
                        if (!p) return "";
                        const discount = getDiscountForPlan(p.value);
                        if (discount > 0) {
                          const discounted = p.price * (1 - discount / 100);
                          return `$${discounted.toFixed(0)}/mo (was $${p.price}/mo — ${discount}% off)`;
                        }
                        return `$${p.price}/mo`;
                      })(),
                    }}
                    onChange={({ detail }) => setPlan(detail.selectedOption as { label: string; value: string })}
                    options={PLAN_OPTIONS.map((p) => {
                      const discount = getDiscountForPlan(p.value);
                      if (discount > 0) {
                        const discounted = p.price * (1 - discount / 100);
                        return { ...p, description: `$${discounted.toFixed(0)}/mo (was $${p.price}/mo — ${discount}% off)` };
                      }
                      return { ...p, description: `$${p.price}/mo` };
                    })}
                  />
                </FormField>
                <FormField
                  label="Promo Campaign"
                  constraintText={loadingPromos ? "Loading eligible promos from account..." : "Select a promo or enter a custom ID"}
                >
                  <SpaceBetween size="xs">
                    <Select
                      selectedOption={promoOption}
                      onChange={({ detail }) => {
                        const opt = detail.selectedOption as { label: string; value: string };
                        setPromoOption(opt);
                        if (opt.value !== "__custom__") {
                          setPromoId(opt.value);
                          if (opt.value.includes("plus") && plan.value === "chatgptplusplan") {
                            setBillingCountry({ label: "Japan", value: "JP" });
                          }
                        } else {
                          setPromoId("");
                        }
                      }}
                      options={promoOptions}
                      placeholder="Select promo campaign"
                      loadingText="Loading promos..."
                      statusType={loadingPromos ? "loading" : "finished"}
                    />
                    {promoOption?.value === "__custom__" && (
                      <Input
                        value={promoId}
                        onChange={({ detail }) => setPromoId(detail.value)}
                        placeholder="Enter custom promo campaign ID"
                      />
                    )}
                  </SpaceBetween>
                </FormField>
                {promoMatchError && (
                  <Alert type="error">{promoMatchError}</Alert>
                )}
                <FormField label="Billing Country">
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <Select
                        selectedOption={billingCountry}
                        onChange={({ detail }) => setBillingCountry(detail.selectedOption as { label: string; value: string })}
                        options={filteredBillingOptions}
                        disabled={isPlusPromo}
                      />
                    </div>
                    <Box color="text-body-secondary" fontSize="body-s">{selectedBilling.currency}</Box>
                  </div>
                  {isPlusPromo && (
                    <Box color="text-body-secondary" fontSize="body-s" margin={{ top: "xxs" }}>Plus promo is only available in Japan</Box>
                  )}
                </FormField>
                <FormField label="Checkout Mode">
                  <Select
                    selectedOption={checkoutMode}
                    onChange={({ detail }) => setCheckoutMode(detail.selectedOption as { label: string; value: string })}
                    options={CHECKOUT_MODE_OPTIONS}
                  />
                </FormField>
                {isTeamPlan && (
                  <>
                    <FormField label="Workspace Name" errorText={tried && !workspaceName ? "Workspace name is required for Team plan" : ""}>
                      <Input
                        value={workspaceName}
                        onChange={({ detail }) => setWorkspaceName(detail.value)}
                        placeholder="My Team Workspace"
                      />
                    </FormField>
                    <FormField label="Seat Quantity">
                      <Input
                        value={seatQuantity}
                        onChange={({ detail }) => setSeatQuantity(detail.value)}
                        type="number"
                        inputMode="numeric"
                      />
                    </FormField>
                  </>
                )}
              </SpaceBetween>
            </Container>
          ),
        },
        {
          title: result ? "Result" : "Review",
          description: result ? "Checkout session details" : "Confirm before creating the checkout session",
          content: result ? (
            <SpaceBetween size="l">
              <Alert type={result.status === "open" ? "success" : "info"}>
                Checkout session created — {result.status} ({result.payment_status})
              </Alert>
              <Container header={<Header variant="h2">Payment Link</Header>}>
                <SpaceBetween size="s">
                  {checkoutMode.value === "hosted" && result.url ? (
                    <>
                      <Box variant="p">Hosted Stripe payment page:</Box>
                      <CopyToClipboard
                        variant="inline"
                        textToCopy={result.url}
                        copyButtonAriaLabel="Copy payment link"
                        copySuccessText="Copied"
                        copyErrorText="Failed to copy"
                      />
                    </>
                  ) : (
                    <>
                      <Box variant="p">Share this link to complete the payment:</Box>
                      <CopyToClipboard
                        variant="inline"
                        textToCopy={`https://chatgpt.com/checkout/${result.processor_entity || "openai_llc"}/${result.checkout_session_id}`}
                        copyButtonAriaLabel="Copy payment link"
                        copySuccessText="Copied"
                        copyErrorText="Failed to copy"
                      />
                    </>
                  )}
                </SpaceBetween>
              </Container>
              <Container header={<Header variant="h2">Session Details</Header>}>
                <SpaceBetween size="m">
                  <ColumnLayout columns={2} variant="text-grid">
                    {result.status && (
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Status</Box>
                        <StatusIndicator type={result.status === "open" ? "success" : "info"}>
                          {result.status}
                        </StatusIndicator>
                      </SpaceBetween>
                    )}
                    {result.payment_status && (
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Payment Status</Box>
                        <StatusIndicator type={result.payment_status === "paid" ? "success" : "warning"}>
                          {result.payment_status}
                        </StatusIndicator>
                      </SpaceBetween>
                    )}
                    {result.plan_name && (
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Plan</Box>
                        <Box>{result.plan_name}</Box>
                      </SpaceBetween>
                    )}
                    {result.checkout_provider && (
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Provider</Box>
                        <Box>{result.checkout_provider}</Box>
                      </SpaceBetween>
                    )}
                    {result.billing_details?.country && (
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Country</Box>
                        <Box>{result.billing_details.country}</Box>
                      </SpaceBetween>
                    )}
                    {result.billing_details?.currency && (
                      <SpaceBetween size="xxs">
                        <Box variant="awsui-key-label">Currency</Box>
                        <Box>{result.billing_details.currency}</Box>
                      </SpaceBetween>
                    )}
                  </ColumnLayout>
                  {result.checkout_session_id && (
                    <FormField label="Checkout Session ID">
                      <CopyToClipboard
                        variant="inline"
                        textToCopy={result.checkout_session_id}
                        copyButtonAriaLabel="Copy session ID"
                        copySuccessText="Copied"
                        copyErrorText="Failed to copy"
                      />
                    </FormField>
                  )}
                  {result.publishable_key && (
                    <FormField label="Publishable Key">
                      <CopyToClipboard
                        variant="inline"
                        textToCopy={result.publishable_key}
                        copyButtonAriaLabel="Copy publishable key"
                        copySuccessText="Copied"
                        copyErrorText="Failed to copy"
                      />
                    </FormField>
                  )}
                  {result.client_secret && (
                    <FormField label="Client Secret">
                      <CopyToClipboard
                        variant="inline"
                        textToCopy={result.client_secret}
                        copyButtonAriaLabel="Copy client secret"
                        copySuccessText="Copied"
                        copyErrorText="Failed to copy"
                      />
                    </FormField>
                  )}
                </SpaceBetween>
              </Container>
            </SpaceBetween>
          ) : (
            <SpaceBetween size="l">
              {error && <Alert type="error">{error}</Alert>}
              <Container header={<Header variant="h2">Summary</Header>}>
                <ColumnLayout columns={3} variant="text-grid">
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Account</Box>
                    <Box>{account?.label || "—"}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Plan</Box>
                    <Box>{plan.label}</Box>
                  </SpaceBetween>
                  <SpaceBetween size="xxs">
                    <Box variant="awsui-key-label">Promo</Box>
                    <Box>{promoId || "None"}</Box>
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
