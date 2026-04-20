import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import Multiselect, { type MultiselectProps } from "@cloudscape-design/components/multiselect";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import CloudscapeLink from "@cloudscape-design/components/link";
import Alert from "@cloudscape-design/components/alert";
import Input from "@cloudscape-design/components/input";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import Checkbox from "@cloudscape-design/components/checkbox";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import { fetchExtensionUI, extensionApiFetch } from "../api/client";

interface DataSourceDef {
  type: string;
  method: string;
  url: string;
  itemsPath: string;
  load: string;
  filter?: { field: string; operator: string };
}

interface ActionRequest {
  method: string;
  url: string;
  body?: unknown;
  bodyFromForm?: string[];
}

interface FlashDef {
  type: string;
  content: string;
}

interface ActionDef {
  type: string;
  mode?: string;
  items?: string;
  request: ActionRequest;
  responseAction?: string;
  onSuccess?: {
    flash?: FlashDef;
    refresh?: string[];
    clear?: string[];
  };
  onError?: {
    flash?: FlashDef;
    refresh?: string[];
  };
}

interface ConfirmDef {
  header: string;
  content: string;
}

interface RowActionDef {
  id: string;
  label: string;
  variant?: string;
  confirm?: ConfirmDef;
  action: ActionDef;
}

interface ColumnDef {
  id: string;
  header: string;
  cell: string;
  variant?: string;
  width?: number;
}

interface DisabledCondition {
  source: string;
  operator: string;
}

interface ComponentDef {
  type: string;
  id: string;
  label?: string;
  description?: string;
  placeholder?: string;
  dataSource?: string;
  optionValueKey?: string;
  optionLabelKey?: string;
  empty?: string;
  variant?: string;
  disabledWhen?: DisabledCondition[];
  action?: ActionDef;
  columns?: ColumnDef[];
  rowActions?: RowActionDef[];
  rowClick?: {
    type: string;
    url: string;
    itemsPath?: string;
    externalLink?: { label: string; url: string };
    actions?: Array<{ id: string; label: string; variant?: string; method: string; url: string }>;
  };
  loadingText?: string;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: string;
  inputType?: string;
}

interface SectionDef {
  type: string;
  id: string;
  header: string;
  components: ComponentDef[];
}

interface PageDef {
  title: string;
  description: string;
}

interface UISchema {
  schemaVersion: string;
  page: PageDef;
  dataSources: Record<string, DataSourceDef>;
  layout: SectionDef[];
}

function resolveTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const parts = path.split(".");
    let current: unknown = vars;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return "";
      current = (current as Record<string, unknown>)[part];
    }
    return current == null ? "" : String(current);
  });
}

function extractByItemsPath(data: unknown, itemsPath: string): unknown[] {
  if (itemsPath === "$") return Array.isArray(data) ? data : [];
  if (itemsPath.startsWith("$.")) {
    const keys = itemsPath.slice(2).split(".");
    let current: unknown = data;
    for (const key of keys) {
      if (current && typeof current === "object") {
        current = (current as Record<string, unknown>)[key];
      } else {
        return [];
      }
    }
    return Array.isArray(current) ? current : [];
  }
  return Array.isArray(data) ? data : [];
}

function resolveFormPath(formState: Record<string, unknown>, path: string): unknown {
  if (path.startsWith("form.")) {
    return formState[path.slice(5)];
  }
  return formState[path];
}

export default function ExtensionAppPage() {
  const { extId } = useParams<{ extId: string }>();
  const [schema, setSchema] = useState<UISchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [schemaError, setSchemaError] = useState("");
  const [dataSources, setDataSources] = useState<Record<string, unknown[]>>({});
  const [dataSourceLoading, setDataSourceLoading] = useState<Record<string, boolean>>({});
  const [formState, setFormState] = useState<Record<string, unknown>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    header: string;
    content: string;
    onConfirm: () => void;
  }>({ visible: false, header: "", content: "", onConfirm: () => {} });

  const [authPopups, setAuthPopups] = useState<Array<{
    provider_id: string;
    auth_url: string;
    email: string;
    callbackUrl: string;
    status: "pending" | "submitting" | "done" | "error";
    error?: string;
  }>>([]);
  const [authPopupVisible, setAuthPopupVisible] = useState(false);

  const [detailModal, setDetailModal] = useState<{
    visible: boolean;
    loading: boolean;
    data: Record<string, unknown> | null;
    url: string;
    itemsPath: string;
    externalLink?: { label: string; url: string };
    actions?: Array<{ id: string; label: string; variant?: string; method: string; url: string }>;
  }>({ visible: false, loading: false, data: null, url: "", itemsPath: "$.data" });
  const [detailActionLoading, setDetailActionLoading] = useState<Record<string, boolean>>({});

  const schemaRef = useRef<UISchema | null>(null);

  const addFlash = useCallback((type: FlashbarProps.Type, content: string) => {
    const id = Date.now().toString();
    setFlashItems((prev) => [
      ...prev,
      { type, content, dismissible: true, id, onDismiss: () => setFlashItems((items) => items.filter((i) => i.id !== id)) },
    ]);
  }, []);

  const fetchDetailModal = useCallback(async (url: string, itemsPath: string, externalLink?: { label: string; url: string }, actions?: Array<{ id: string; label: string; variant?: string; method: string; url: string }>) => {
    setDetailModal((prev) => ({ ...prev, visible: true, loading: true, data: null, url, itemsPath, externalLink, actions }));
    try {
      const raw = await extensionApiFetch("GET", url);
      const keys = itemsPath.startsWith("$.") ? itemsPath.slice(2).split(".") : [];
      let result: unknown = raw;
      for (const key of keys) {
        if (result && typeof result === "object") {
          result = (result as Record<string, unknown>)[key];
        }
      }
      setDetailModal((prev) => ({ ...prev, loading: false, data: result as Record<string, unknown> }));
    } catch (e) {
      addFlash("error", `Failed to load detail: ${e instanceof Error ? e.message : String(e)}`);
      setDetailModal((prev) => ({ ...prev, visible: false, loading: false }));
    }
  }, [addFlash]);

  const handleDetailAction = useCallback(async (actionUrl: string, actionKey: string) => {
    setDetailActionLoading((prev) => ({ ...prev, [actionKey]: true }));
    try {
      await extensionApiFetch("POST", actionUrl);
      addFlash("success", `${actionKey} completed`);
      if (detailModal.url) {
        const raw = await extensionApiFetch("GET", detailModal.url);
        const keys = detailModal.itemsPath.startsWith("$.") ? detailModal.itemsPath.slice(2).split(".") : [];
        let result: unknown = raw;
        for (const key of keys) {
          if (result && typeof result === "object") {
            result = (result as Record<string, unknown>)[key];
          }
        }
        setDetailModal((prev) => ({ ...prev, data: result as Record<string, unknown> }));
      }
    } catch (e) {
      addFlash("error", `${actionKey} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDetailActionLoading((prev) => ({ ...prev, [actionKey]: false }));
    }
  }, [addFlash, detailModal.url, detailModal.itemsPath]);

  const loadDataSource = useCallback(async (name: string, def: DataSourceDef) => {
    setDataSourceLoading((prev) => ({ ...prev, [name]: true }));
    try {
      const raw = await extensionApiFetch(def.method, def.url);
      let items = extractByItemsPath(raw, def.itemsPath);
      if (def.filter) {
        const { field, operator } = def.filter;
        if (operator === "truthy") {
          items = items.filter((row) => {
            if (row && typeof row === "object") {
              return Boolean((row as Record<string, unknown>)[field]);
            }
            return false;
          });
        }
      }
      setDataSources((prev) => ({ ...prev, [name]: items }));
    } catch (e) {
      addFlash("error", `Failed to load ${name}: ${e instanceof Error ? e.message : String(e)}`);
      setDataSources((prev) => ({ ...prev, [name]: [] }));
    } finally {
      setDataSourceLoading((prev) => ({ ...prev, [name]: false }));
    }
  }, [addFlash]);

  const loadAllDataSources = useCallback((uiSchema: UISchema) => {
    for (const [name, def] of Object.entries(uiSchema.dataSources)) {
      if (def.load === "onPageLoad") {
        loadDataSource(name, def);
      }
    }
  }, [loadDataSource]);

  useEffect(() => {
    if (!extId) return;
    let cancelled = false;
    (async () => {
      setSchemaLoading(true);
      setSchemaError("");
      try {
        const data = await fetchExtensionUI(extId) as unknown as UISchema;
        if (cancelled) return;
        setSchema(data);
        schemaRef.current = data;
        const defaults: Record<string, unknown> = {};
        for (const section of data.layout) {
          for (const comp of section.components) {
            if (comp.defaultValue !== undefined) {
              defaults[comp.id] = comp.defaultValue;
            }
          }
        }
        if (Object.keys(defaults).length > 0) {
          setFormState((prev) => ({ ...defaults, ...prev }));
        }
        loadAllDataSources(data);
      } catch (e) {
        if (cancelled) return;
        setSchemaError(e instanceof Error ? e.message : "Failed to load UI");
      } finally {
        if (!cancelled) setSchemaLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [extId, loadAllDataSources]);

  const refreshDataSources = useCallback((names: string[]) => {
    const s = schemaRef.current;
    if (!s) return;
    for (const name of names) {
      const def = s.dataSources[name];
      if (def) loadDataSource(name, def);
    }
  }, [loadDataSource]);

  const clearFormFields = useCallback((paths: string[]) => {
    setFormState((prev) => {
      const next = { ...prev };
      for (const path of paths) {
        const key = path.startsWith("form.") ? path.slice(5) : path;
        delete next[key];
      }
      return next;
    });
  }, []);

  const executeAction = useCallback(async (action: ActionDef, componentId: string, extraVars?: Record<string, unknown>) => {
    setActionLoading((prev) => ({ ...prev, [componentId]: true }));
    let successCount = 0;
    let errorCount = 0;
    const authResults: Array<{ provider_id: string; auth_url: string; email: string }> = [];

    try {
      let formBody: Record<string, unknown> | undefined;
      if (action.request.bodyFromForm) {
        formBody = {};
        for (const entry of action.request.bodyFromForm) {
          const [fieldId, bodyKey] = entry.includes(":") ? entry.split(":", 2) : [entry, entry];
          const val = formState[fieldId];
          if (val !== undefined && val !== "") {
            formBody[bodyKey] = val;
          }
        }
      }

      if (action.mode === "forEach" && action.items) {
        const itemsValue = resolveFormPath(formState, action.items);
        const itemsList = Array.isArray(itemsValue) ? itemsValue : [];

        for (const item of itemsList) {
          const vars = { ...extraVars, item };
          const url = resolveTemplate(action.request.url, vars);
          let body = action.request.body ? JSON.parse(resolveTemplate(JSON.stringify(action.request.body), vars)) : undefined;
          if (formBody) {
            body = { ...(body as Record<string, unknown> | undefined), ...formBody };
          }
          try {
            const result = await extensionApiFetch(action.request.method, url, body);
            successCount++;
            if (action.responseAction === "authPopup" && result && typeof result === "object") {
              const r = result as Record<string, unknown>;
              if (r.auth_url) {
                authResults.push({
                  provider_id: String(r.provider_id ?? ""),
                  auth_url: String(r.auth_url),
                  email: String(r.email ?? ""),
                });
              }
            }
          } catch {
            errorCount++;
          }
        }
      } else {
        const vars = { ...extraVars };
        const url = resolveTemplate(action.request.url, vars);
        let body = action.request.body ? JSON.parse(resolveTemplate(JSON.stringify(action.request.body), vars)) : undefined;
        if (formBody) {
          body = { ...(body as Record<string, unknown> | undefined), ...formBody };
        }
        const result = await extensionApiFetch(action.request.method, url, body);
        successCount = 1;
        if (action.responseAction === "authPopup" && result && typeof result === "object") {
          const r = result as Record<string, unknown>;
          if (r.auth_url) {
            authResults.push({
              provider_id: String(r.provider_id ?? ""),
              auth_url: String(r.auth_url),
              email: String(r.email ?? ""),
            });
          }
        }
      }

      if (action.responseAction === "authPopup" && authResults.length > 0) {
        setAuthPopups(authResults.map((r) => ({
          ...r,
          callbackUrl: "",
          status: "pending" as const,
        })));
        setAuthPopupVisible(true);
        if (action.onSuccess?.clear) clearFormFields(action.onSuccess.clear as string[]);
      } else {
        const handler = errorCount > 0 && action.onError ? action.onError : action.onSuccess;
        if (handler) {
          if (handler.flash) {
            const content = resolveTemplate(handler.flash.content, {
              successCount: String(successCount),
              errorCount: String(errorCount),
            });
            addFlash(handler.flash.type as FlashbarProps.Type, content);
          }
          if (handler.refresh) refreshDataSources(handler.refresh);
          if ("clear" in handler && handler.clear) clearFormFields(handler.clear as string[]);
        }
      }
    } catch (e) {
      errorCount++;
      if (action.onError?.flash) {
        const content = resolveTemplate(action.onError.flash.content, {
          successCount: String(successCount),
          errorCount: String(errorCount),
        });
        addFlash(action.onError.flash.type as FlashbarProps.Type, content);
      } else {
        addFlash("error", e instanceof Error ? e.message : "Action failed");
      }
      if (action.onError?.refresh) refreshDataSources(action.onError.refresh);
    } finally {
      setActionLoading((prev) => ({ ...prev, [componentId]: false }));
    }
  }, [formState, addFlash, refreshDataSources, clearFormFields]);

  const isDisabled = useCallback((conditions: DisabledCondition[] | undefined): boolean => {
    if (!conditions) return false;
    return conditions.some((cond) => {
      const val = resolveFormPath(formState, cond.source);
      if (cond.operator === "empty") {
        return !val || (Array.isArray(val) && val.length === 0);
      }
      return false;
    });
  }, [formState]);

  const renderDetailModal = () => {
    const d = detailModal.data;
    if (!d) return null;

    const quota = d.quota as Record<string, unknown> | null;
    const secondary = quota?.secondary as Record<string, unknown> | null;
    const modelAliases = (d.modelAliases as Array<Record<string, unknown>>) ?? [];
    const recentLogs = ((d.recentRequestLogs as Array<Record<string, unknown>>) ?? []).slice(0, 10);
    const proxy = d.proxy as Record<string, unknown> | null;

    const formatDate = (val: unknown) => {
      if (!val) return "—";
      const date = new Date(String(val));
      return isNaN(date.getTime()) ? String(val) : date.toLocaleString();
    };

    return (
      <SpaceBetween size="l">
        <ColumnLayout columns={2} variant="text-grid">
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">Status</Box>
            <StatusIndicator type={d.isActive ? "success" : "error"}>
              {d.isActive ? "Active" : "Inactive"}
            </StatusIndicator>
          </SpaceBetween>
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">Has Tokens</Box>
            <StatusIndicator type={d.hasTokens ? "success" : "warning"}>
              {d.hasTokens ? "Yes" : "No"}
            </StatusIndicator>
          </SpaceBetween>
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">Family</Box>
            <Box>{String(d.family ?? "—")}</Box>
          </SpaceBetween>
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">Type</Box>
            <Box>{String(d.type ?? "—")}</Box>
          </SpaceBetween>
          {proxy && (
            <SpaceBetween size="xs">
              <Box variant="awsui-key-label">Proxy</Box>
              <Box>{String(proxy.label ?? proxy.url ?? "—")}</Box>
            </SpaceBetween>
          )}
          {d.deactivationReason != null && (
            <SpaceBetween size="xs">
              <Box variant="awsui-key-label">Deactivation Reason</Box>
              <Box color="text-status-error">{String(d.deactivationReason)}</Box>
            </SpaceBetween>
          )}
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">Last Refresh</Box>
            <Box>{formatDate(d.lastRefresh)}</Box>
          </SpaceBetween>
        </ColumnLayout>

        {quota && (
          <Container header={<Header variant="h3">Quota</Header>}>
            <SpaceBetween size="m">
              <div>
                <Box variant="awsui-key-label">Primary</Box>
                <ProgressBar
                  value={Number(quota.limit ?? 0) > 0 ? ((Number(quota.limit ?? 0) - Number(quota.remaining ?? 0)) / Number(quota.limit ?? 1)) * 100 : 0}
                  description={`${quota.remaining ?? 0} / ${quota.limit ?? 0} remaining`}
                  additionalInfo={quota.reset ? `Resets: ${formatDate(quota.reset)}` : undefined}
                />
              </div>
              {secondary && (
                <div>
                  <Box variant="awsui-key-label">Secondary</Box>
                  <ProgressBar
                    value={Number(secondary.limit ?? 0) > 0 ? ((Number(secondary.limit ?? 0) - Number(secondary.remaining ?? 0)) / Number(secondary.limit ?? 1)) * 100 : 0}
                    description={`${secondary.remaining ?? 0} / ${secondary.limit ?? 0} remaining`}
                    additionalInfo={secondary.reset ? `Resets: ${formatDate(secondary.reset)}` : undefined}
                  />
                </div>
              )}
            </SpaceBetween>
          </Container>
        )}

        {modelAliases.length > 0 && (
          <Container header={<Header variant="h3">Model Aliases</Header>}>
            <Table
              items={modelAliases}
              columnDefinitions={[
                { id: "modelId", header: "Model ID", cell: (row) => String(row.modelId ?? "") },
                {
                  id: "modelName",
                  header: "Model Name",
                  cell: (row) => {
                    const model = row.model as Record<string, unknown> | null;
                    return String(model?.name ?? "—");
                  },
                },
              ]}
              variant="embedded"
            />
          </Container>
        )}

        {recentLogs.length > 0 && (
          <Container header={<Header variant="h3">Recent Request Logs</Header>}>
            <Table
              items={recentLogs}
              columnDefinitions={[
                { id: "model", header: "Model", cell: (row) => String(row.model ?? "") },
                {
                  id: "status",
                  header: "Status",
                  cell: (row) => {
                    const status = Number(row.status ?? 0);
                    return (
                      <StatusIndicator type={status >= 200 && status < 300 ? "success" : "error"}>
                        {status}
                      </StatusIndicator>
                    );
                  },
                },
                { id: "promptTokens", header: "Prompt Tokens", cell: (row) => Number(row.promptTokens ?? 0).toLocaleString() },
                { id: "completionTokens", header: "Completion Tokens", cell: (row) => Number(row.completionTokens ?? 0).toLocaleString() },
                { id: "durationMs", header: "Duration", cell: (row) => `${Number(row.durationMs ?? 0).toLocaleString()}ms` },
                { id: "createdAt", header: "Created At", cell: (row) => formatDate(row.createdAt) },
              ]}
              variant="embedded"
            />
          </Container>
        )}
      </SpaceBetween>
    );
  };

  const renderComponent = (comp: ComponentDef) => {
    switch (comp.type) {
      case "multiselect": {
        const items = dataSources[comp.dataSource ?? ""] ?? [];
        const options: MultiselectProps.Option[] = items.map((row) => {
          const r = row as Record<string, unknown>;
          return {
            value: String(r[comp.optionValueKey ?? "id"] ?? ""),
            label: String(r[comp.optionLabelKey ?? "name"] ?? ""),
          };
        });
        const selectedValues = (formState[comp.id] as string[] | undefined) ?? [];
        const selectedOptions = options.filter((o) => selectedValues.includes(o.value ?? ""));

        return (
          <FormField key={comp.id} label={comp.label} description={comp.description}>
            <Multiselect
              selectedOptions={selectedOptions}
              onChange={({ detail }) => {
                setFormState((prev) => ({
                  ...prev,
                  [comp.id]: detail.selectedOptions.map((o) => o.value ?? ""),
                }));
              }}
              options={options}
              placeholder={comp.placeholder}
              empty={comp.empty}
              filteringType="auto"
            />
          </FormField>
        );
      }

      case "button": {
        return (
          <Button
            key={comp.id}
            variant={comp.variant === "primary" ? "primary" : comp.variant === "danger" ? "normal" : "normal"}
            loading={actionLoading[comp.id] ?? false}
            disabled={isDisabled(comp.disabledWhen)}
            onClick={() => {
              if (comp.action) executeAction(comp.action, comp.id);
            }}
          >
            {comp.label}
          </Button>
        );
      }

      case "table": {
        const items = dataSources[comp.dataSource ?? ""] ?? [];
        const isLoading = dataSourceLoading[comp.dataSource ?? ""] ?? false;

        const columnDefs = (comp.columns ?? []).map((col) => ({
          id: col.id,
          header: col.header,
          width: col.width,
          cell: (row: Record<string, unknown>) => {
            const text = resolveTemplate(col.cell, { row });
            if (col.variant === "code") return <Box variant="code">{text}</Box>;
            return text;
          },
        }));

        if (comp.rowActions && comp.rowActions.length > 0) {
          columnDefs.push({
            id: "__actions",
            header: "",
            width: comp.rowActions.length * 80,
            cell: (row: Record<string, unknown>) => (
              <SpaceBetween direction="horizontal" size="xs">
                {comp.rowActions!.map((ra) => (
                  <Button
                    key={ra.id}
                    variant={ra.variant === "danger" ? "normal" : "normal"}
                    loading={actionLoading[`${comp.id}_${ra.id}_${String(row.id ?? "")}`] ?? false}
                    onClick={() => {
                      const doAction = () => executeAction(ra.action, `${comp.id}_${ra.id}_${String(row.id ?? "")}`, { row });
                      if (ra.confirm) {
                        const header = resolveTemplate(ra.confirm.header, { row });
                        const content = resolveTemplate(ra.confirm.content, { row });
                        setConfirmModal({ visible: true, header, content, onConfirm: () => { setConfirmModal((p) => ({ ...p, visible: false })); doAction(); } });
                      } else {
                        doAction();
                      }
                    }}
                  >
                    {ra.label}
                  </Button>
                ))}
              </SpaceBetween>
            ),
          });
        }

        return (
          <Table
            key={comp.id}
            items={items as Record<string, unknown>[]}
            loading={isLoading}
            loadingText={comp.loadingText}
            columnDefinitions={columnDefs}
            onRowClick={comp.rowClick ? ({ detail }) => {
              const row = detail.item as Record<string, unknown>;
              const url = resolveTemplate(comp.rowClick!.url, { row });
              fetchDetailModal(url, comp.rowClick!.itemsPath ?? "$.data", comp.rowClick!.externalLink, comp.rowClick!.actions);
            } : undefined}
            empty={
              <Box textAlign="center" color="inherit">
                {comp.empty ?? "No data"}
              </Box>
            }
            variant="embedded"
          />
        );
      }

      case "select": {
        let options: SelectProps.Option[] = [];
        if (comp.dataSource) {
          const items = dataSources[comp.dataSource] ?? [];
          options = items.map((row) => {
            const r = row as Record<string, unknown>;
            return {
              value: String(r[comp.optionValueKey ?? "id"] ?? ""),
              label: String(r[comp.optionLabelKey ?? "name"] ?? ""),
            };
          });
        } else if (comp.options) {
          options = comp.options.map((o) => ({ value: o.value, label: o.label }));
        }
        const selectedValue = formState[comp.id] as string | undefined;
        const selectedOption = options.find((o) => o.value === selectedValue) ?? null;

        return (
          <FormField key={comp.id} label={comp.label} description={comp.description}>
            <Select
              selectedOption={selectedOption}
              onChange={({ detail }) => {
                setFormState((prev) => ({
                  ...prev,
                  [comp.id]: detail.selectedOption.value ?? "",
                }));
              }}
              options={options}
              placeholder={comp.placeholder}
              statusType={comp.dataSource && (dataSourceLoading[comp.dataSource] ?? false) ? "loading" : "finished"}
              loadingText="Loading options..."
            />
          </FormField>
        );
      }

      case "input": {
        const value = (formState[comp.id] as string | undefined) ?? "";
        return (
          <FormField key={comp.id} label={comp.label} description={comp.description}>
            <Input
              value={value}
              type={comp.inputType === "number" ? "number" : "text"}
              onChange={({ detail }) => {
                setFormState((prev) => ({ ...prev, [comp.id]: detail.value }));
              }}
              placeholder={comp.placeholder}
            />
          </FormField>
        );
      }

      case "checkbox": {
        const checked = (formState[comp.id] as boolean | undefined) ?? false;
        return (
          <FormField key={comp.id} description={comp.description}>
            <Checkbox
              checked={checked}
              onChange={({ detail }) => {
                setFormState((prev) => ({ ...prev, [comp.id]: detail.checked }));
              }}
            >
              {comp.label}
            </Checkbox>
          </FormField>
        );
      }

      default:
        return null;
    }
  };

  const sectionHasTable = (section: SectionDef): string | null => {
    for (const comp of section.components) {
      if (comp.type === "table" && comp.dataSource) return comp.dataSource;
    }
    return null;
  };

  const renderSection = (section: SectionDef) => {
    const tableDs = sectionHasTable(section);
    return (
      <Container
        key={section.id}
        header={
          <Header
            actions={
              tableDs ? (
                <Button
                  iconName="refresh"
                  loading={dataSourceLoading[tableDs] ?? false}
                  onClick={() => refreshDataSources([tableDs])}
                />
              ) : undefined
            }
          >
            {section.header}
          </Header>
        }
      >
        <SpaceBetween size="l">
          {section.components.map((comp) => renderComponent(comp))}
        </SpaceBetween>
      </Container>
    );
  };

  if (schemaLoading) {
    return (
      <Box textAlign="center" padding={{ top: "xxxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  if (schemaError) {
    return (
      <SpaceBetween size="l">
        <Link to="/extensions">← Extensions</Link>
        <Alert type="error">{schemaError}</Alert>
      </SpaceBetween>
    );
  }

  if (!schema) return null;

  return (
    <SpaceBetween size="l">
      <Flashbar items={flashItems} />

      <Header
        description={schema.page.description}
        actions={
          <CloudscapeLink
            href="/extensions"
            onFollow={(e) => { e.preventDefault(); }}
          >
            <Link to="/extensions" style={{ textDecoration: "none", color: "inherit" }}>
              ← Extensions
            </Link>
          </CloudscapeLink>
        }
      >
        {schema.page.title}
      </Header>

      {schema.layout.map((section) => renderSection(section))}

      <Modal
        visible={confirmModal.visible}
        onDismiss={() => setConfirmModal((p) => ({ ...p, visible: false }))}
        header={confirmModal.header}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setConfirmModal((p) => ({ ...p, visible: false }))}>Cancel</Button>
              <Button variant="primary" onClick={confirmModal.onConfirm}>Confirm</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {confirmModal.content}
      </Modal>

      <Modal
        visible={authPopupVisible}
        onDismiss={() => setAuthPopupVisible(false)}
        size="large"
        header={<Header variant="h2">Codex 인증</Header>}
        footer={
          <Box float="right">
            <Button onClick={() => {
              setAuthPopupVisible(false);
              setAuthPopups([]);
              refreshDataSources(["providers"]);
            }}>
              닫기
            </Button>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <Alert type="info">
            아래 링크를 열어 인증을 완료한 후, 리다이렉트된 URL을 붙여넣으세요.
          </Alert>
          {authPopups.map((popup, idx) => (
            <Container key={popup.provider_id} header={<Header variant="h3">{popup.email}</Header>}>
              <SpaceBetween size="m">
                <FormField label="Auth URL">
                  <SpaceBetween direction="horizontal" size="xs">
                    <Box variant="code" fontSize="body-s">
                      <a href={popup.auth_url} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all" }}>
                        {popup.auth_url.slice(0, 80)}...
                      </a>
                    </Box>
                    <Button iconName="external" variant="icon" onClick={() => window.open(popup.auth_url, "_blank")} />
                  </SpaceBetween>
                </FormField>
                <FormField label="Callback URL" description="인증 후 리다이렉트된 URL을 붙여넣으세요">
                  <Input
                    value={popup.callbackUrl}
                    onChange={({ detail }) => {
                      setAuthPopups((prev) => prev.map((p, i) => i === idx ? { ...p, callbackUrl: detail.value } : p));
                    }}
                    placeholder="http://localhost:1455/auth/callback?code=..."
                    disabled={popup.status === "done" || popup.status === "submitting"}
                  />
                </FormField>
                {popup.status === "done" ? (
                  <Alert type="success">인증 완료</Alert>
                ) : popup.status === "error" ? (
                  <Alert type="error">{popup.error}</Alert>
                ) : (
                  <Button
                    variant="primary"
                    loading={popup.status === "submitting"}
                    disabled={!popup.callbackUrl.trim()}
                    onClick={async () => {
                      setAuthPopups((prev) => prev.map((p, i) => i === idx ? { ...p, status: "submitting" as const } : p));
                      try {
                        await extensionApiFetch("POST", `/api/ext/relay-codex/complete-auth/${popup.provider_id}`, {
                          callbackUrl: popup.callbackUrl.trim(),
                        });
                        setAuthPopups((prev) => prev.map((p, i) => i === idx ? { ...p, status: "done" as const } : p));
                        addFlash("success", `${popup.email} 인증 완료`);
                      } catch (e) {
                        setAuthPopups((prev) => prev.map((p, i) => i === idx ? {
                          ...p,
                          status: "error" as const,
                          error: e instanceof Error ? e.message : "인증 실패",
                        } : p));
                      }
                    }}
                  >
                    인증 완료
                  </Button>
                )}
              </SpaceBetween>
            </Container>
          ))}
        </SpaceBetween>
      </Modal>

      <Modal
        visible={detailModal.visible}
        onDismiss={() => setDetailModal((prev) => ({ ...prev, visible: false }))}
        size="large"
        header={
          <Header variant="h2">
            {detailModal.data ? String(detailModal.data.label ?? "Provider Detail") : "Provider Detail"}
          </Header>
        }
        footer={
          detailModal.data ? (
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                {detailModal.externalLink && (
                  <Button
                    iconName="external"
                    iconAlign="right"
                    variant="link"
                    onClick={() => {
                      const id = String(detailModal.data?.id ?? "");
                      window.open(resolveTemplate(detailModal.externalLink!.url, { id }), "_blank");
                    }}
                  >
                    {detailModal.externalLink.label}
                  </Button>
                )}
                {(detailModal.actions ?? []).map((act) => (
                  <Button
                    key={act.id}
                    variant={act.variant === "primary" ? "primary" : "normal"}
                    loading={detailActionLoading[act.id] ?? false}
                    onClick={() => {
                      const id = String(detailModal.data?.id ?? "");
                      const url = resolveTemplate(act.url, { id });
                      handleDetailAction(url, act.id);
                    }}
                  >
                    {act.label}
                  </Button>
                ))}
              </SpaceBetween>
            </Box>
          ) : undefined
        }
      >
        {detailModal.loading ? (
          <Box textAlign="center" padding={{ top: "l", bottom: "l" }}>
            <Spinner size="large" />
          </Box>
        ) : (
          renderDetailModal()
        )}
      </Modal>
    </SpaceBetween>
  );
}
