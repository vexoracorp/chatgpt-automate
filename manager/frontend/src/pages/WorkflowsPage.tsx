import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Cards from "@cloudscape-design/components/cards";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tabs from "@cloudscape-design/components/tabs";
import WorkflowRunsPanel from "./WorkflowRunsPage";

interface WorkflowDef {
  id: string;
  name: string;
  description: string;
}

const WORKFLOWS: WorkflowDef[] = [
  {
    id: "register",
    name: "Register",
    description: "Create a new ChatGPT account with email verification",
  },
  {
    id: "bulk-register",
    name: "Bulk Register",
    description: "Register multiple ChatGPT accounts at once",
  },
  {
    id: "login",
    name: "Login",
    description: "Login to an existing ChatGPT account via OTP",
  },
  {
    id: "codex",
    name: "Codex OAuth",
    description: "Authorize Codex CLI with an existing account",
  },
  {
    id: "codex-device",
    name: "Codex Device Login",
    description: "Authorize Codex CLI using device code flow",
  },
  {
    id: "cdk-activate",
    name: "CDK Activation",
    description: "Apply a CDK activation code to upgrade a ChatGPT account plan",
  },
  {
    id: "promo-checkout",
    name: "Promo Checkout",
    description: "Create a Stripe checkout session with a promo code applied",
  },
];

export default function WorkflowsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState("workflows");

  useEffect(() => {
    const msg = searchParams.get("success");
    if (msg) {
      setSuccess(msg);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <SpaceBetween size="l">
      {success && (
        <Alert type="success" dismissible onDismiss={() => setSuccess("")}>
          {success}
        </Alert>
      )}

      <Header variant="h1">Workflows</Header>

      <Tabs
        activeTabId={activeTab}
        onChange={({ detail }) => setActiveTab(detail.activeTabId)}
        tabs={[
          {
            id: "workflows",
            label: "Workflows",
            content: (
              <Cards
                ariaLabels={{
                  itemSelectionLabel: (_e, item) => `select ${item.name}`,
                  selectionGroupLabel: "Workflow selection",
                }}
                cardDefinition={{
                  header: (item) => item.name,
                  sections: [
                    {
                      id: "description",
                      content: (item) => item.description,
                    },
                    {
                      id: "action",
                      content: (item) => (
                        <Button
                          variant="primary"
                          onClick={() => navigate(`/workflows/${item.id}`)}
                        >
                          Start
                        </Button>
                      ),
                    },
                  ],
                }}
                cardsPerRow={[{ cards: 1 }, { minWidth: 600, cards: 3 }]}
                items={WORKFLOWS}
              />
            ),
          },
          {
            id: "runs",
            label: "Runs",
            content: <WorkflowRunsPanel />,
          },
        ]}
      />
    </SpaceBetween>
  );
}
