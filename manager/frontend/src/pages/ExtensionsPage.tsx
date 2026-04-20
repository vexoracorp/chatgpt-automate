import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Cards from "@cloudscape-design/components/cards";
import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Toggle from "@cloudscape-design/components/toggle";
import Spinner from "@cloudscape-design/components/spinner";
import {
  type ExtensionInfo,
  fetchExtensions,
  enableExtension,
  disableExtension,
  getExtensionSettings,
  saveExtensionSettings,
} from "../api/client";

interface SchemaProperty {
  type: string;
  title?: string;
  description?: string;
  default?: unknown;
}

export default function ExtensionsPage() {
  const navigate = useNavigate();
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [configExtension, setConfigExtension] = useState<ExtensionInfo | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setExtensions(await fetchExtensions());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load extensions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addFlash = (type: FlashbarProps.Type, content: string) => {
    const id = Date.now().toString();
    setFlashItems((prev) => [
      ...prev,
      { type, content, dismissible: true, id, onDismiss: () => setFlashItems((items) => items.filter((i) => i.id !== id)) },
    ]);
  };

  const handleToggle = async (ext: ExtensionInfo) => {
    setToggling(ext.id);
    try {
      if (ext.enabled) {
        await disableExtension(ext.id);
        addFlash("success", `${ext.name} disabled`);
      } else {
        await enableExtension(ext.id);
        addFlash("success", `${ext.name} enabled`);
      }
      await load();
    } catch (e) {
      addFlash("error", e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setToggling(null);
    }
  };

  const handleConfigure = async (ext: ExtensionInfo) => {
    setConfigExtension(ext);
    setConfigModalVisible(true);
    setConfigLoading(true);
    try {
      const settings = await getExtensionSettings(ext.id);
      setConfigValues(settings);
    } catch {
      setConfigValues(ext.settings || {});
    } finally {
      setConfigLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!configExtension) return;
    setConfigSaving(true);
    try {
      await saveExtensionSettings(configExtension.id, configValues);
      addFlash("success", `${configExtension.name} settings saved`);
      setConfigModalVisible(false);
      await load();
    } catch (e) {
      addFlash("error", e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setConfigSaving(false);
    }
  };

  const getSchemaProperties = (ext: ExtensionInfo): Record<string, SchemaProperty> => {
    const schema = ext.settings_schema;
    if (!schema || typeof schema !== "object") return {};
    const props = (schema as Record<string, unknown>).properties;
    if (!props || typeof props !== "object") return {};
    return props as Record<string, SchemaProperty>;
  };

  const hasSettingsSchema = (ext: ExtensionInfo): boolean => {
    return Object.keys(getSchemaProperties(ext)).length > 0;
  };

  const renderSettingsForm = () => {
    if (!configExtension) return null;
    const properties = getSchemaProperties(configExtension);
    const keys = Object.keys(properties);
    if (keys.length === 0) {
      return <Box color="text-body-secondary">No configurable settings</Box>;
    }
    return (
      <SpaceBetween size="l">
        {keys.map((key) => {
          const prop = properties[key];
          const value = configValues[key] ?? prop.default ?? "";
          if (prop.type === "boolean") {
            return (
              <FormField key={key} description={prop.description}>
                <Toggle
                  checked={Boolean(value)}
                  onChange={({ detail }) => setConfigValues((prev) => ({ ...prev, [key]: detail.checked }))}
                >
                  {prop.title || key}
                </Toggle>
              </FormField>
            );
          }
          if (prop.type === "number") {
            return (
              <FormField key={key} label={prop.title || key} description={prop.description}>
                <Input
                  type="number"
                  value={String(value)}
                  onChange={({ detail }) => setConfigValues((prev) => ({ ...prev, [key]: Number(detail.value) }))}
                />
              </FormField>
            );
          }
          return (
            <FormField key={key} label={prop.title || key} description={prop.description}>
              <Input
                value={String(value)}
                onChange={({ detail }) => setConfigValues((prev) => ({ ...prev, [key]: detail.value }))}
              />
            </FormField>
          );
        })}
      </SpaceBetween>
    );
  };

  return (
    <SpaceBetween size="l">
      <Flashbar items={flashItems} />

      <Modal
        visible={configModalVisible}
        onDismiss={() => setConfigModalVisible(false)}
        header={<Header variant="h2">Configure {configExtension?.name}</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setConfigModalVisible(false)}>Cancel</Button>
              <Button variant="primary" loading={configSaving} onClick={handleSaveSettings}>Save</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {configLoading ? (
          <Box textAlign="center"><Spinner size="large" /></Box>
        ) : (
          renderSettingsForm()
        )}
      </Modal>

      <Cards
        header={
          <Header
            counter={`(${extensions.length})`}
            actions={<Button iconName="refresh" loading={loading} onClick={load} />}
          >
            Extensions
          </Header>
        }
        loading={loading}
        loadingText="Loading extensions..."
        items={extensions}
        cardDefinition={{
          header: (item) => item.name,
          sections: [
            {
              id: "description",
              content: (item) => (
                <Box color="text-body-secondary">{item.description || "No description"}</Box>
              ),
            },
            {
              id: "meta",
              content: (item) => (
                <SpaceBetween size="xs">
                  <Box><Box variant="awsui-key-label">Version</Box> {item.version}</Box>
                  <Box><Box variant="awsui-key-label">Author</Box> {item.author || "Unknown"}</Box>
                </SpaceBetween>
              ),
            },
            {
              id: "status",
              content: (item) => (
                <SpaceBetween size="s">
                  <SpaceBetween direction="horizontal" size="xs">
                    <StatusIndicator type={item.loaded ? "success" : "stopped"}>
                      {item.loaded ? "Loaded" : "Not loaded"}
                    </StatusIndicator>
                  </SpaceBetween>
                  <Toggle
                    checked={item.enabled}
                    onChange={() => handleToggle(item)}
                    disabled={toggling === item.id}
                  >
                    {item.enabled ? "Enabled" : "Disabled"}
                  </Toggle>
                </SpaceBetween>
              ),
            },
            {
              id: "actions",
              content: (item) => (
                <SpaceBetween direction="horizontal" size="xs">
                  {item.enabled && hasSettingsSchema(item) && (
                    <Button onClick={() => handleConfigure(item)}>Configure</Button>
                  )}
                  {item.enabled && item.loaded && item.has_ui && (
                    <Button variant="primary" onClick={() => navigate(`/extensions/${item.id}`)}>
                      Open
                    </Button>
                  )}
                </SpaceBetween>
              ),
            },
          ],
        }}
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <b>No extensions found</b>
              <Box color="text-body-secondary">
                Place extension folders in backend/extensions/ directory
              </Box>
            </SpaceBetween>
          </Box>
        }
        entireCardClickable={false}
      />

      {error && !loading && (
        <Box textAlign="center">
          <StatusIndicator type="error">{error}</StatusIndicator>
        </Box>
      )}
    </SpaceBetween>
  );
}
