import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompanySecret,
  CreateExternalWorkIntegration,
  ExternalWorkIntegration,
  ExternalWorkIntegrationFallbackMode,
  ExternalWorkIntegrationProvider,
  ExternalWorkItem,
  ExternalWorkItemEvent,
  ExternalWorkItemType,
  GiteeExternalWorkIntegrationConfig,
  GiteeIntegrationCloneProtocol,
  Project,
  TapdExternalWorkIntegrationConfig,
} from "@paperclipai/shared";
import {
  EXTERNAL_WORK_INTEGRATION_FALLBACK_MODES,
  EXTERNAL_WORK_INTEGRATION_PROVIDERS,
  EXTERNAL_WORK_ITEM_TYPES,
  GITEE_INTEGRATION_CLONE_PROTOCOLS,
} from "@paperclipai/shared";
import { ArrowUpRight, Bug, FolderGit2, GitBranch, Pencil, Plus, RefreshCw, Save } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { externalWorkApi } from "../api/externalWork";
import { projectsApi } from "../api/projects";
import { secretsApi } from "../api/secrets";
import {
  createEmptyBindingDraft,
  envBindingToDraft,
  prettyExternalWorkValue,
  summarizeExternalWorkSyncResult,
  toEnvBinding,
  type BindingDraft,
} from "../lib/external-work";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const NONE_VALUE = "__none__";

type BrowserAutomationDraft = {
  enabled: boolean;
  headless: boolean;
  loginUrl: string;
  storageState: BindingDraft;
  cookieHeader: BindingDraft;
};

type TapdBindingDraft = {
  workspaceId: string;
  projectId: string;
  iterationId: string;
  targetProjectId: string;
  targetWorkspaceId: string;
  itemTypes: ExternalWorkItemType[];
  enabled: boolean;
};

type GiteeRepoBindingDraft = {
  targetProjectId: string;
  targetWorkspaceId: string;
  repoUrl: string;
  repoRef: string;
  cloneProtocol: GiteeIntegrationCloneProtocol;
  enabled: boolean;
};

type TapdFormState = {
  name: string;
  enabled: boolean;
  apiBaseUrl: string;
  fallbackMode: ExternalWorkIntegrationFallbackMode;
  authMode: "basic" | "access_token";
  apiUser: BindingDraft;
  apiPassword: BindingDraft;
  accessToken: BindingDraft;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: string;
  browserAutomation: BrowserAutomationDraft;
  bindings: TapdBindingDraft[];
};

type GiteeFormState = {
  name: string;
  enabled: boolean;
  apiBaseUrl: string;
  fallbackMode: ExternalWorkIntegrationFallbackMode;
  authMode: "access_token" | "ssh";
  accessToken: BindingDraft;
  privateKey: BindingDraft;
  passphrase: BindingDraft;
  cloneProtocol: GiteeIntegrationCloneProtocol;
  browserAutomation: BrowserAutomationDraft;
  bindings: GiteeRepoBindingDraft[];
};

function createBrowserAutomationDraft(): BrowserAutomationDraft {
  return {
    enabled: false,
    headless: true,
    loginUrl: "",
    storageState: createEmptyBindingDraft(),
    cookieHeader: createEmptyBindingDraft(),
  };
}

function createTapdBindingDraft(): TapdBindingDraft {
  return {
    workspaceId: "",
    projectId: "",
    iterationId: "",
    targetProjectId: "",
    targetWorkspaceId: "",
    itemTypes: ["iteration", "story", "task", "bug"],
    enabled: true,
  };
}

function createGiteeRepoBindingDraft(): GiteeRepoBindingDraft {
  return {
    targetProjectId: "",
    targetWorkspaceId: "",
    repoUrl: "",
    repoRef: "",
    cloneProtocol: "https",
    enabled: true,
  };
}

function createDefaultTapdForm(): TapdFormState {
  return {
    name: "",
    enabled: true,
    apiBaseUrl: "https://api.tapd.cn",
    fallbackMode: "prefer_api",
    authMode: "access_token",
    apiUser: createEmptyBindingDraft(),
    apiPassword: createEmptyBindingDraft(),
    accessToken: createEmptyBindingDraft(),
    scheduleEnabled: false,
    scheduleIntervalMinutes: "60",
    browserAutomation: createBrowserAutomationDraft(),
    bindings: [createTapdBindingDraft()],
  };
}

function createDefaultGiteeForm(): GiteeFormState {
  return {
    name: "",
    enabled: true,
    apiBaseUrl: "https://gitee.com/api/v5",
    fallbackMode: "prefer_api",
    authMode: "access_token",
    accessToken: createEmptyBindingDraft(),
    privateKey: createEmptyBindingDraft(),
    passphrase: createEmptyBindingDraft(),
    cloneProtocol: "https",
    browserAutomation: createBrowserAutomationDraft(),
    bindings: [createGiteeRepoBindingDraft()],
  };
}

function formatTimestamp(value: Date | string | null | undefined) {
  if (!value) return "Never";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function describeIntegration(integration: ExternalWorkIntegration) {
  if (integration.provider === "tapd") {
    const config = integration.config as TapdExternalWorkIntegrationConfig;
    return `${config.projectBindings.length} TAPD bindings · schedule ${
      config.schedule.enabled ? `every ${config.schedule.intervalMinutes} min` : "disabled"
    }`;
  }
  const config = integration.config as GiteeExternalWorkIntegrationConfig;
  return `${config.repoBindings.length} repo bindings · clone ${prettyExternalWorkValue(
    config.cloneProtocol,
  )}`;
}

function browserAutomationToDraft(
  value: ExternalWorkIntegration["config"]["browserAutomation"] | null | undefined,
): BrowserAutomationDraft {
  if (!value) return createBrowserAutomationDraft();
  return {
    enabled: value.enabled,
    headless: value.headless,
    loginUrl: value.loginUrl ?? "",
    storageState: envBindingToDraft(value.storageState),
    cookieHeader: envBindingToDraft(value.cookieHeader),
  };
}

function integrationToTapdForm(integration: ExternalWorkIntegration): TapdFormState {
  if (integration.provider !== "tapd") return createDefaultTapdForm();
  const config = integration.config as TapdExternalWorkIntegrationConfig;
  return {
    name: integration.name,
    enabled: integration.enabled,
    apiBaseUrl: config.apiBaseUrl ?? "https://api.tapd.cn",
    fallbackMode: config.fallbackMode,
    authMode: config.credentials.authMode,
    apiUser:
      config.credentials.authMode === "basic"
        ? envBindingToDraft(config.credentials.apiUser)
        : createEmptyBindingDraft(),
    apiPassword:
      config.credentials.authMode === "basic"
        ? envBindingToDraft(config.credentials.apiPassword)
        : createEmptyBindingDraft(),
    accessToken:
      config.credentials.authMode === "access_token"
        ? envBindingToDraft(config.credentials.accessToken)
        : createEmptyBindingDraft(),
    scheduleEnabled: config.schedule.enabled,
    scheduleIntervalMinutes: String(config.schedule.intervalMinutes),
    browserAutomation: browserAutomationToDraft(config.browserAutomation),
    bindings:
      config.projectBindings.length > 0
        ? config.projectBindings.map((binding) => ({
            workspaceId: binding.workspaceId,
            projectId: binding.projectId ?? "",
            iterationId: binding.iterationId ?? "",
            targetProjectId: binding.targetProjectId ?? "",
            targetWorkspaceId: binding.targetWorkspaceId ?? "",
            itemTypes: [...binding.itemTypes],
            enabled: binding.enabled,
          }))
        : [createTapdBindingDraft()],
  };
}

function integrationToGiteeForm(integration: ExternalWorkIntegration): GiteeFormState {
  if (integration.provider !== "gitee") return createDefaultGiteeForm();
  const config = integration.config as GiteeExternalWorkIntegrationConfig;
  return {
    name: integration.name,
    enabled: integration.enabled,
    apiBaseUrl: config.apiBaseUrl ?? "https://gitee.com/api/v5",
    fallbackMode: config.fallbackMode,
    authMode: config.credentials.authMode,
    accessToken:
      config.credentials.authMode === "access_token"
        ? envBindingToDraft(config.credentials.accessToken)
        : createEmptyBindingDraft(),
    privateKey:
      config.credentials.authMode === "ssh"
        ? envBindingToDraft(config.credentials.privateKey)
        : createEmptyBindingDraft(),
    passphrase:
      config.credentials.authMode === "ssh"
        ? envBindingToDraft(config.credentials.passphrase)
        : createEmptyBindingDraft(),
    cloneProtocol: config.cloneProtocol,
    browserAutomation: browserAutomationToDraft(config.browserAutomation),
    bindings:
      config.repoBindings.length > 0
        ? config.repoBindings.map((binding) => ({
            targetProjectId: binding.targetProjectId ?? "",
            targetWorkspaceId: binding.targetWorkspaceId ?? "",
            repoUrl: binding.repoUrl,
            repoRef: binding.repoRef ?? "",
            cloneProtocol: binding.cloneProtocol,
            enabled: binding.enabled,
          }))
        : [createGiteeRepoBindingDraft()],
  };
}

function buildBrowserAutomationConfig(draft: BrowserAutomationDraft) {
  const storageState = toEnvBinding(draft.storageState);
  const cookieHeader = toEnvBinding(draft.cookieHeader);
  if (!draft.enabled && !draft.loginUrl.trim() && !storageState && !cookieHeader) {
    return null;
  }
  return {
    enabled: draft.enabled,
    headless: draft.headless,
    loginUrl: draft.loginUrl.trim() || null,
    storageState,
    cookieHeader,
  };
}

function requireBinding(draft: BindingDraft, label: string) {
  const binding = toEnvBinding(draft);
  if (!binding) {
    throw new Error(`${label} is required`);
  }
  return binding;
}

function buildTapdCreatePayload(form: TapdFormState): CreateExternalWorkIntegration {
  const bindings = form.bindings
    .map((binding) => ({
      workspaceId: binding.workspaceId.trim(),
      projectId: binding.projectId.trim() || null,
      iterationId: binding.iterationId.trim() || null,
      targetProjectId: binding.targetProjectId.trim() || null,
      targetWorkspaceId: binding.targetWorkspaceId.trim() || null,
      itemTypes: binding.itemTypes,
      enabled: binding.enabled,
    }))
    .filter((binding) => binding.workspaceId.length > 0);

  if (bindings.length === 0) {
    throw new Error("At least one TAPD binding is required");
  }

  return {
    provider: "tapd",
    name: form.name.trim(),
    enabled: form.enabled,
    config: {
      kind: "tapd_openapi",
      apiBaseUrl: form.apiBaseUrl.trim() || null,
      fallbackMode: form.fallbackMode,
      schedule: {
        enabled: form.scheduleEnabled,
        intervalMinutes: Number(form.scheduleIntervalMinutes) || 60,
      },
      workspaceIds: Array.from(new Set(bindings.map((binding) => binding.workspaceId))),
      projectBindings: bindings,
      browserAutomation: buildBrowserAutomationConfig(form.browserAutomation),
      credentials:
        form.authMode === "basic"
          ? {
              authMode: "basic",
              apiUser: requireBinding(form.apiUser, "TAPD API user"),
              apiPassword: requireBinding(form.apiPassword, "TAPD API password"),
            }
          : {
              authMode: "access_token",
              accessToken: requireBinding(form.accessToken, "TAPD access token"),
            },
    },
  };
}

function buildGiteeCreatePayload(form: GiteeFormState): CreateExternalWorkIntegration {
  const repoBindings = form.bindings
    .map((binding) => ({
      targetProjectId: binding.targetProjectId.trim() || null,
      targetWorkspaceId: binding.targetWorkspaceId.trim() || null,
      repoUrl: binding.repoUrl.trim(),
      repoRef: binding.repoRef.trim() || null,
      cloneProtocol: binding.cloneProtocol,
      enabled: binding.enabled,
    }))
    .filter((binding) => binding.repoUrl.length > 0);

  if (repoBindings.length === 0) {
    throw new Error("At least one Gitee repo binding is required");
  }
  if (!repoBindings.every((binding) => binding.targetProjectId || binding.targetWorkspaceId)) {
    throw new Error("Each Gitee repo binding needs a target project or target workspace ID");
  }

  return {
    provider: "gitee",
    name: form.name.trim(),
    enabled: form.enabled,
    config: {
      kind: "gitee_openapi",
      apiBaseUrl: form.apiBaseUrl.trim() || null,
      fallbackMode: form.fallbackMode,
      cloneProtocol: form.cloneProtocol,
      repoBindings,
      browserAutomation: buildBrowserAutomationConfig(form.browserAutomation),
      credentials:
        form.authMode === "access_token"
          ? {
              authMode: "access_token",
              accessToken: requireBinding(form.accessToken, "Gitee access token"),
            }
          : {
              authMode: "ssh",
              privateKey: requireBinding(form.privateKey, "Gitee SSH private key"),
              passphrase: toEnvBinding(form.passphrase),
            },
    },
  };
}

function CredentialField({
  label,
  draft,
  secrets,
  onChange,
  plainPlaceholder,
}: {
  label: string;
  draft: BindingDraft;
  secrets: CompanySecret[];
  onChange: (next: BindingDraft) => void;
  plainPlaceholder: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted-foreground">{label}</label>
      <div className="grid gap-2 md:grid-cols-[140px,1fr]">
        <Select
          value={draft.mode}
          onValueChange={(value) =>
            onChange({
              ...draft,
              mode: value === "secret" ? "secret" : "plain",
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plain">Plain</SelectItem>
            <SelectItem value="secret">Secret</SelectItem>
          </SelectContent>
        </Select>

        {draft.mode === "secret" ? (
          <Select value={draft.secretId || NONE_VALUE} onValueChange={(value) => onChange({ ...draft, secretId: value === NONE_VALUE ? "" : value })}>
            <SelectTrigger>
              <SelectValue placeholder="Select secret" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>No secret selected</SelectItem>
              {secrets.map((secret) => (
                <SelectItem key={secret.id} value={secret.id}>
                  {secret.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={draft.plainValue}
            onChange={(event) => onChange({ ...draft, plainValue: event.target.value })}
            placeholder={plainPlaceholder}
          />
        )}
      </div>
    </div>
  );
}

function ProjectSelectField({
  value,
  projects,
  onChange,
  placeholder,
}: {
  value: string;
  projects: Project[];
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <Select value={value || NONE_VALUE} onValueChange={(next) => onChange(next === NONE_VALUE ? "" : next)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>Not linked</SelectItem>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BrowserAutomationFields({
  value,
  secrets,
  onChange,
}: {
  value: BrowserAutomationDraft;
  secrets: CompanySecret[];
  onChange: (next: BrowserAutomationDraft) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Browser fallback</p>
          <p className="text-xs text-muted-foreground">
            Keep browser automation ready for TAPD / Gitee pages when API-only integration is insufficient.
          </p>
        </div>
        <Checkbox checked={value.enabled} onCheckedChange={(checked) => onChange({ ...value, enabled: checked === true })} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">Login URL</label>
          <Input
            value={value.loginUrl}
            onChange={(event) => onChange({ ...value, loginUrl: event.target.value })}
            placeholder="https://www.tapd.cn/cloud_logins/login"
          />
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <Checkbox checked={value.headless} onCheckedChange={(checked) => onChange({ ...value, headless: checked === true })} />
          <div>
            <p className="text-sm font-medium">Headless</p>
            <p className="text-xs text-muted-foreground">Disable if the provider needs a visible browser session.</p>
          </div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <CredentialField
          label="Storage state"
          draft={value.storageState}
          secrets={secrets}
          onChange={(next) => onChange({ ...value, storageState: next })}
          plainPlaceholder="JSON storage state or path"
        />
        <CredentialField
          label="Cookie header"
          draft={value.cookieHeader}
          secrets={secrets}
          onChange={(next) => onChange({ ...value, cookieHeader: next })}
          plainPlaceholder="session=...; token=..."
        />
      </div>
    </div>
  );
}

export function ExternalWork() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [provider, setProvider] = useState<ExternalWorkIntegrationProvider>("tapd");
  const [editingIntegrationId, setEditingIntegrationId] = useState<string | null>(null);
  const [tapdForm, setTapdForm] = useState<TapdFormState>(createDefaultTapdForm);
  const [giteeForm, setGiteeForm] = useState<GiteeFormState>(createDefaultGiteeForm);
  const [selectedIntegrationFilter, setSelectedIntegrationFilter] = useState<string>("");
  const [selectedItemId, setSelectedItemId] = useState<string>("");

  useEffect(() => {
    setBreadcrumbs([{ label: "External Work" }]);
  }, [setBreadcrumbs]);

  const integrationsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.externalWork.integrations(selectedCompanyId) : ["external-work-integrations", "none"],
    queryFn: () => externalWorkApi.listIntegrations(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projectsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const secretsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.secrets.list(selectedCompanyId) : ["secrets", "none"],
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const itemsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.externalWork.items(selectedCompanyId, selectedIntegrationFilter || undefined)
      : ["external-work-items", "none"],
    queryFn: () => externalWorkApi.listItems(selectedCompanyId!, selectedIntegrationFilter || undefined),
    enabled: !!selectedCompanyId,
  });

  const itemEventsQuery = useQuery({
    queryKey: selectedItemId ? queryKeys.externalWork.events(selectedItemId) : ["external-work-item-events", "none"],
    queryFn: () => externalWorkApi.listItemEvents(selectedItemId),
    enabled: !!selectedItemId,
  });

  const integrations = integrationsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const secrets = secretsQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;

  const resetForms = () => {
    setEditingIntegrationId(null);
    setProvider("tapd");
    setTapdForm(createDefaultTapdForm());
    setGiteeForm(createDefaultGiteeForm());
  };

  const refreshExternalWorkQueries = () => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.externalWork.integrations(selectedCompanyId) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.externalWork.items(selectedCompanyId, selectedIntegrationFilter || undefined),
    });
  };

  const createMutation = useMutation({
    mutationFn: async () =>
      provider === "tapd"
        ? externalWorkApi.createIntegration(selectedCompanyId!, buildTapdCreatePayload(tapdForm))
        : externalWorkApi.createIntegration(selectedCompanyId!, buildGiteeCreatePayload(giteeForm)),
    onSuccess: (integration) => {
      refreshExternalWorkQueries();
      resetForms();
      setSelectedIntegrationFilter(integration.id);
      pushToast({
        title: "External work integration created",
        body: `${integration.name} is ready for manual sync and heartbeat automation.`,
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to create integration",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingIntegrationId) {
        throw new Error("No integration selected for update");
      }
      const payload = provider === "tapd" ? buildTapdCreatePayload(tapdForm) : buildGiteeCreatePayload(giteeForm);
      return externalWorkApi.updateIntegration(editingIntegrationId, {
        name: payload.name,
        enabled: payload.enabled,
        config: payload.config,
      });
    },
    onSuccess: (integration) => {
      refreshExternalWorkQueries();
      setEditingIntegrationId(integration.id);
      pushToast({
        title: "Integration updated",
        body: `${integration.name} has been updated.`,
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to update integration",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (integrationId: string) => externalWorkApi.syncIntegration(integrationId, {}),
    onSuccess: (result) => {
      refreshExternalWorkQueries();
      pushToast({
        title: "Manual sync finished",
        body: summarizeExternalWorkSyncResult(result),
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Manual sync failed",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const activeFormPending = createMutation.isPending || updateMutation.isPending;

  const canSubmitTapd = useMemo(() => {
    const hasBinding = tapdForm.bindings.some((binding) => binding.workspaceId.trim());
    const hasCreds =
      tapdForm.authMode === "basic"
        ? !!toEnvBinding(tapdForm.apiUser) && !!toEnvBinding(tapdForm.apiPassword)
        : !!toEnvBinding(tapdForm.accessToken);
    return !!tapdForm.name.trim() && hasBinding && hasCreds && !activeFormPending;
  }, [activeFormPending, tapdForm]);

  const canSubmitGitee = useMemo(() => {
    const hasBinding = giteeForm.bindings.some(
      (binding) =>
        binding.repoUrl.trim() && (binding.targetProjectId.trim() || binding.targetWorkspaceId.trim()),
    );
    const hasCreds =
      giteeForm.authMode === "access_token"
        ? !!toEnvBinding(giteeForm.accessToken)
        : !!toEnvBinding(giteeForm.privateKey);
    return !!giteeForm.name.trim() && hasBinding && hasCreds && !activeFormPending;
  }, [activeFormPending, giteeForm]);

  if (!selectedCompanyId) {
    return <EmptyState icon={GitBranch} message="Select a company to manage TAPD / Gitee external work." />;
  }

  if (integrationsQuery.isLoading || projectsQuery.isLoading || secretsQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-6">
      {(integrationsQuery.error || itemsQuery.error || itemEventsQuery.error) && (
        <p className="text-sm text-destructive">
          {integrationsQuery.error?.message ?? itemsQuery.error?.message ?? itemEventsQuery.error?.message}
        </p>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">External work operator console</h1>
            <p className="text-sm text-muted-foreground">
              Bind TAPD projects and Gitee repositories into the existing Paperclip project / issue / heartbeat flow.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => refreshExternalWorkQueries()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" onClick={resetForms}>
              <Plus className="mr-2 h-4 w-4" />
              New integration
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="integrations" className="space-y-4">
        <TabsList variant="line">
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="items">Synced Items</TabsTrigger>
        </TabsList>

        <TabsContent value="integrations" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.2fr,1fr]">
            <div className="space-y-3">
              {integrations.length === 0 ? (
                <EmptyState
                  icon={FolderGit2}
                  message="No external work integrations yet. Create your first TAPD or Gitee binding on the right."
                />
              ) : (
                integrations.map((integration) => (
                  <div key={integration.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {prettyExternalWorkValue(integration.provider)}
                          </span>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                            {integration.enabled ? "Enabled" : "Paused"}
                          </span>
                        </div>
                        <div>
                          <h2 className="text-base font-semibold">{integration.name}</h2>
                          <p className="text-sm text-muted-foreground">{describeIntegration(integration)}</p>
                        </div>
                        <div className="grid gap-1 text-xs text-muted-foreground">
                          <p>Last sync: {formatTimestamp(integration.lastSyncedAt)}</p>
                          <p>Last writeback: {formatTimestamp(integration.lastWritebackAt)}</p>
                          {integration.lastError && <p className="text-destructive">Last error: {integration.lastError}</p>}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingIntegrationId(integration.id);
                            setProvider(integration.provider);
                            setSelectedIntegrationFilter(integration.id);
                            if (integration.provider === "tapd") {
                              setTapdForm(integrationToTapdForm(integration));
                            } else {
                              setGiteeForm(integrationToGiteeForm(integration));
                            }
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedIntegrationFilter(integration.id)}
                        >
                          <Bug className="mr-2 h-4 w-4" />
                          View items
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => syncMutation.mutate(integration.id)}
                          disabled={syncMutation.isPending}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Sync now
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  {editingIntegrationId ? "Edit external work integration" : "Create external work integration"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Configure TAPD project ingestion or Gitee repo binding without creating a second task / repo system.
                </p>
              </div>

              <Tabs
                value={provider}
                onValueChange={(value) => setProvider(value as ExternalWorkIntegrationProvider)}
                className="space-y-4"
              >
                <TabsList variant="line">
                  {EXTERNAL_WORK_INTEGRATION_PROVIDERS.map((item) => (
                    <TabsTrigger key={item} value={item}>
                      {prettyExternalWorkValue(item)}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="tapd" className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="block text-xs text-muted-foreground">Integration name</label>
                      <Input
                        value={tapdForm.name}
                        onChange={(event) => setTapdForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="TAPD - Core Delivery"
                      />
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                      <Checkbox
                        checked={tapdForm.enabled}
                        onCheckedChange={(checked) => setTapdForm((current) => ({ ...current, enabled: checked === true }))}
                      />
                      <div>
                        <p className="text-sm font-medium">Enabled</p>
                        <p className="text-xs text-muted-foreground">Allow scheduler sync and heartbeat writeback.</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-muted-foreground">API base URL</label>
                      <Input
                        value={tapdForm.apiBaseUrl}
                        onChange={(event) => setTapdForm((current) => ({ ...current, apiBaseUrl: event.target.value }))}
                        placeholder="https://api.tapd.cn"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-muted-foreground">Fallback mode</label>
                      <Select
                        value={tapdForm.fallbackMode}
                        onValueChange={(value) =>
                          setTapdForm((current) => ({
                            ...current,
                            fallbackMode: value as ExternalWorkIntegrationFallbackMode,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXTERNAL_WORK_INTEGRATION_FALLBACK_MODES.map((item) => (
                            <SelectItem key={item} value={item}>
                              {prettyExternalWorkValue(item)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1fr,180px]">
                    <div className="space-y-1">
                      <label className="block text-xs text-muted-foreground">Auth mode</label>
                      <Select
                        value={tapdForm.authMode}
                        onValueChange={(value) =>
                          setTapdForm((current) => ({
                            ...current,
                            authMode: value as TapdFormState["authMode"],
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="access_token">Access token</SelectItem>
                          <SelectItem value="basic">Basic auth</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                      <Checkbox
                        checked={tapdForm.scheduleEnabled}
                        onCheckedChange={(checked) =>
                          setTapdForm((current) => ({ ...current, scheduleEnabled: checked === true }))
                        }
                      />
                      <div>
                        <p className="text-sm font-medium">Scheduler</p>
                        <p className="text-xs text-muted-foreground">Enable automatic TAPD polling.</p>
                      </div>
                    </div>
                  </div>

                  {tapdForm.authMode === "basic" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <CredentialField
                        label="API user"
                        draft={tapdForm.apiUser}
                        secrets={secrets}
                        onChange={(next) => setTapdForm((current) => ({ ...current, apiUser: next }))}
                        plainPlaceholder="tapd-user"
                      />
                      <CredentialField
                        label="API password"
                        draft={tapdForm.apiPassword}
                        secrets={secrets}
                        onChange={(next) => setTapdForm((current) => ({ ...current, apiPassword: next }))}
                        plainPlaceholder="tapd-password"
                      />
                    </div>
                  ) : (
                    <CredentialField
                      label="Access token"
                      draft={tapdForm.accessToken}
                      secrets={secrets}
                      onChange={(next) => setTapdForm((current) => ({ ...current, accessToken: next }))}
                      plainPlaceholder="tapd-access-token"
                    />
                  )}

                  <div className="space-y-1">
                    <label className="block text-xs text-muted-foreground">Schedule interval (minutes)</label>
                    <Input
                      value={tapdForm.scheduleIntervalMinutes}
                      onChange={(event) =>
                        setTapdForm((current) => ({ ...current, scheduleIntervalMinutes: event.target.value }))
                      }
                      placeholder="60"
                    />
                  </div>

                  <BrowserAutomationFields
                    value={tapdForm.browserAutomation}
                    secrets={secrets}
                    onChange={(next) => setTapdForm((current) => ({ ...current, browserAutomation: next }))}
                  />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">TAPD bindings</p>
                        <p className="text-xs text-muted-foreground">
                          Map TAPD workspace / project / iteration scopes into existing Paperclip projects.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setTapdForm((current) => ({
                            ...current,
                            bindings: [...current.bindings, createTapdBindingDraft()],
                          }))
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add binding
                      </Button>
                    </div>

                    {tapdForm.bindings.map((binding, index) => (
                      <div key={`tapd-binding-${index}`} className="rounded-md border border-border p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Binding #{index + 1}</p>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={binding.enabled}
                              onCheckedChange={(checked) =>
                                setTapdForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, enabled: checked === true } : item,
                                  ),
                                }))
                              }
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setTapdForm((current) => ({
                                  ...current,
                                  bindings:
                                    current.bindings.length === 1
                                      ? [createTapdBindingDraft()]
                                      : current.bindings.filter((_, itemIndex) => itemIndex !== index),
                                }))
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1">
                            <label className="block text-xs text-muted-foreground">Workspace ID</label>
                            <Input
                              value={binding.workspaceId}
                              onChange={(event) =>
                                setTapdForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, workspaceId: event.target.value } : item,
                                  ),
                                }))
                              }
                              placeholder="TAPD workspace ID"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs text-muted-foreground">TAPD project ID</label>
                            <Input
                              value={binding.projectId}
                              onChange={(event) =>
                                setTapdForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, projectId: event.target.value } : item,
                                  ),
                                }))
                              }
                              placeholder="Optional TAPD project ID"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs text-muted-foreground">Iteration ID</label>
                            <Input
                              value={binding.iterationId}
                              onChange={(event) =>
                                setTapdForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, iterationId: event.target.value } : item,
                                  ),
                                }))
                              }
                              placeholder="Optional iteration ID"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs text-muted-foreground">Target project</label>
                            <ProjectSelectField
                              value={binding.targetProjectId}
                              projects={projects}
                              onChange={(next) =>
                                setTapdForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, targetProjectId: next } : item,
                                  ),
                                }))
                              }
                              placeholder="Select a Paperclip project"
                            />
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <label className="block text-xs text-muted-foreground">Target workspace ID (optional)</label>
                            <Input
                              value={binding.targetWorkspaceId}
                              onChange={(event) =>
                                setTapdForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, targetWorkspaceId: event.target.value } : item,
                                  ),
                                }))
                              }
                              placeholder="Existing Paperclip workspace UUID for advanced routing"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="block text-xs text-muted-foreground">Sync item types</label>
                          <div className="grid gap-2 md:grid-cols-3">
                            {EXTERNAL_WORK_ITEM_TYPES.filter((item) =>
                              ["iteration", "story", "task", "bug", "workspace"].includes(item),
                            ).map((itemType) => (
                              <label
                                key={itemType}
                                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                              >
                                <Checkbox
                                  checked={binding.itemTypes.includes(itemType)}
                                  onCheckedChange={() =>
                                    setTapdForm((current) => ({
                                      ...current,
                                      bindings: current.bindings.map((item, itemIndex) => {
                                        if (itemIndex !== index) return item;
                                        const nextTypes = item.itemTypes.includes(itemType)
                                          ? item.itemTypes.filter((value) => value !== itemType)
                                          : [...item.itemTypes, itemType];
                                        return {
                                          ...item,
                                          itemTypes: nextTypes.length > 0 ? nextTypes : ["task"],
                                        };
                                      }),
                                    }))
                                  }
                                />
                                {prettyExternalWorkValue(itemType)}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end gap-2">
                    {editingIntegrationId && provider === "tapd" && (
                      <Button variant="outline" onClick={resetForms}>
                        Cancel edit
                      </Button>
                    )}
                    <Button
                      onClick={() => (editingIntegrationId && provider === "tapd" ? updateMutation.mutate() : createMutation.mutate())}
                      disabled={!canSubmitTapd}
                    >
                      {editingIntegrationId && provider === "tapd" ? (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save changes
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Create TAPD integration
                        </>
                      )}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="gitee" className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="block text-xs text-muted-foreground">Integration name</label>
                      <Input
                        value={giteeForm.name}
                        onChange={(event) => setGiteeForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Gitee - Product Repo"
                      />
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                      <Checkbox
                        checked={giteeForm.enabled}
                        onCheckedChange={(checked) => setGiteeForm((current) => ({ ...current, enabled: checked === true }))}
                      />
                      <div>
                        <p className="text-sm font-medium">Enabled</p>
                        <p className="text-xs text-muted-foreground">Allow repo prepare, commit, push, and writeback.</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-muted-foreground">API base URL</label>
                      <Input
                        value={giteeForm.apiBaseUrl}
                        onChange={(event) => setGiteeForm((current) => ({ ...current, apiBaseUrl: event.target.value }))}
                        placeholder="https://gitee.com/api/v5"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-muted-foreground">Fallback mode</label>
                      <Select
                        value={giteeForm.fallbackMode}
                        onValueChange={(value) =>
                          setGiteeForm((current) => ({
                            ...current,
                            fallbackMode: value as ExternalWorkIntegrationFallbackMode,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXTERNAL_WORK_INTEGRATION_FALLBACK_MODES.map((item) => (
                            <SelectItem key={item} value={item}>
                              {prettyExternalWorkValue(item)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-muted-foreground">Auth mode</label>
                      <Select
                        value={giteeForm.authMode}
                        onValueChange={(value) =>
                          setGiteeForm((current) => ({
                            ...current,
                            authMode: value as GiteeFormState["authMode"],
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="access_token">Access token</SelectItem>
                          <SelectItem value="ssh">SSH key</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-muted-foreground">Default clone protocol</label>
                      <Select
                        value={giteeForm.cloneProtocol}
                        onValueChange={(value) =>
                          setGiteeForm((current) => ({
                            ...current,
                            cloneProtocol: value as GiteeIntegrationCloneProtocol,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GITEE_INTEGRATION_CLONE_PROTOCOLS.map((item) => (
                            <SelectItem key={item} value={item}>
                              {prettyExternalWorkValue(item)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {giteeForm.authMode === "access_token" ? (
                    <CredentialField
                      label="Access token"
                      draft={giteeForm.accessToken}
                      secrets={secrets}
                      onChange={(next) => setGiteeForm((current) => ({ ...current, accessToken: next }))}
                      plainPlaceholder="gitee-access-token"
                    />
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      <CredentialField
                        label="SSH private key"
                        draft={giteeForm.privateKey}
                        secrets={secrets}
                        onChange={(next) => setGiteeForm((current) => ({ ...current, privateKey: next }))}
                        plainPlaceholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      />
                      <CredentialField
                        label="Passphrase"
                        draft={giteeForm.passphrase}
                        secrets={secrets}
                        onChange={(next) => setGiteeForm((current) => ({ ...current, passphrase: next }))}
                        plainPlaceholder="Optional SSH passphrase"
                      />
                    </div>
                  )}

                  <BrowserAutomationFields
                    value={giteeForm.browserAutomation}
                    secrets={secrets}
                    onChange={(next) => setGiteeForm((current) => ({ ...current, browserAutomation: next }))}
                  />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Repo bindings</p>
                        <p className="text-xs text-muted-foreground">
                          Sync Gitee repos into existing project workspaces so heartbeat runs can pull, commit, and push.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setGiteeForm((current) => ({
                            ...current,
                            bindings: [...current.bindings, createGiteeRepoBindingDraft()],
                          }))
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add repo
                      </Button>
                    </div>

                    {giteeForm.bindings.map((binding, index) => (
                      <div key={`gitee-binding-${index}`} className="rounded-md border border-border p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Repo #{index + 1}</p>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={binding.enabled}
                              onCheckedChange={(checked) =>
                                setGiteeForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, enabled: checked === true } : item,
                                  ),
                                }))
                              }
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setGiteeForm((current) => ({
                                  ...current,
                                  bindings:
                                    current.bindings.length === 1
                                      ? [createGiteeRepoBindingDraft()]
                                      : current.bindings.filter((_, itemIndex) => itemIndex !== index),
                                }))
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1 md:col-span-2">
                            <label className="block text-xs text-muted-foreground">Repo URL</label>
                            <Input
                              value={binding.repoUrl}
                              onChange={(event) =>
                                setGiteeForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, repoUrl: event.target.value } : item,
                                  ),
                                }))
                              }
                              placeholder="https://gitee.com/org/repo.git"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs text-muted-foreground">Target project</label>
                            <ProjectSelectField
                              value={binding.targetProjectId}
                              projects={projects}
                              onChange={(next) =>
                                setGiteeForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, targetProjectId: next } : item,
                                  ),
                                }))
                              }
                              placeholder="Select a Paperclip project"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs text-muted-foreground">Target workspace ID</label>
                            <Input
                              value={binding.targetWorkspaceId}
                              onChange={(event) =>
                                setGiteeForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, targetWorkspaceId: event.target.value } : item,
                                  ),
                                }))
                              }
                              placeholder="Optional workspace UUID"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs text-muted-foreground">Branch / ref</label>
                            <Input
                              value={binding.repoRef}
                              onChange={(event) =>
                                setGiteeForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, repoRef: event.target.value } : item,
                                  ),
                                }))
                              }
                              placeholder="main"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs text-muted-foreground">Clone protocol</label>
                            <Select
                              value={binding.cloneProtocol}
                              onValueChange={(value) =>
                                setGiteeForm((current) => ({
                                  ...current,
                                  bindings: current.bindings.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, cloneProtocol: value as GiteeIntegrationCloneProtocol }
                                      : item,
                                  ),
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {GITEE_INTEGRATION_CLONE_PROTOCOLS.map((item) => (
                                  <SelectItem key={item} value={item}>
                                    {prettyExternalWorkValue(item)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end gap-2">
                    {editingIntegrationId && provider === "gitee" && (
                      <Button variant="outline" onClick={resetForms}>
                        Cancel edit
                      </Button>
                    )}
                    <Button
                      onClick={() => (editingIntegrationId && provider === "gitee" ? updateMutation.mutate() : createMutation.mutate())}
                      disabled={!canSubmitGitee}
                    >
                      {editingIntegrationId && provider === "gitee" ? (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save changes
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Create Gitee integration
                        </>
                      )}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="items" className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold">External work items</h2>
                <p className="text-sm text-muted-foreground">
                  Inspect synced TAPD stories / tasks / bugs and the events recorded during mapping or writeback.
                </p>
              </div>
              <div className="w-full md:w-80">
                <Select
                  value={selectedIntegrationFilter || NONE_VALUE}
                  onValueChange={(value) => setSelectedIntegrationFilter(value === NONE_VALUE ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by integration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>All integrations</SelectItem>
                    {integrations.map((integration) => (
                      <SelectItem key={integration.id} value={integration.id}>
                        {integration.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {itemsQuery.isLoading ? (
              <PageSkeleton variant="list" />
            ) : items.length === 0 ? (
              <EmptyState
                icon={Bug}
                message="No external work items yet. Run a TAPD sync to hydrate the issue-mapping pipeline."
              />
            ) : (
              <div className="grid gap-4 xl:grid-cols-[1.3fr,0.9fr]">
                <div className="space-y-3">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedItemId(item.id)}
                      className={`w-full rounded-lg border p-4 text-left transition-colors ${
                        selectedItemId === item.id
                          ? "border-primary bg-accent/30"
                          : "border-border bg-card hover:bg-accent/20"
                      }`}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {prettyExternalWorkValue(item.externalType)}
                            </span>
                            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                              {prettyExternalWorkValue(item.syncStatus)}
                            </span>
                          </div>
                          <h3 className="text-sm font-semibold">{item.title}</h3>
                          <p className="text-xs text-muted-foreground">
                            External ID: {item.externalId}
                            {item.externalKey ? ` · Key ${item.externalKey}` : ""}
                            {item.remoteStatus ? ` · Remote status ${item.remoteStatus}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Linked project: {item.linkedProjectId ?? "None"} · Linked issue: {item.linkedIssueId ?? "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Last sync {formatTimestamp(item.lastSyncedAt)} · Last writeback {formatTimestamp(item.lastWritebackAt)}
                          </p>
                          {item.lastError && <p className="text-xs text-destructive">Last error: {item.lastError}</p>}
                        </div>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            Open remote
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="rounded-lg border border-border bg-card p-4 space-y-4">
                  {selectedItem ? (
                    <>
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold">{selectedItem.title}</h3>
                        <p className="text-xs text-muted-foreground">
                          {prettyExternalWorkValue(selectedItem.externalType)} · {prettyExternalWorkValue(selectedItem.syncStatus)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Assignee: {selectedItem.assigneeName ?? "Unassigned"} · Provider {prettyExternalWorkValue(selectedItem.provider)}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-medium">Item events</p>
                        {itemEventsQuery.isLoading ? (
                          <PageSkeleton variant="list" />
                        ) : (itemEventsQuery.data ?? []).length === 0 ? (
                          <p className="text-sm text-muted-foreground">No events recorded yet.</p>
                        ) : (
                          <div className="space-y-3">
                            {(itemEventsQuery.data ?? []).map((event: ExternalWorkItemEvent) => (
                              <div key={event.id} className="rounded-md border border-border bg-muted/20 p-3">
                                <p className="text-sm font-medium">{event.eventType}</p>
                                {event.summary && <p className="mt-1 text-sm text-muted-foreground">{event.summary}</p>}
                                <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(event.createdAt)}</p>
                                {event.payload && Object.keys(event.payload).length > 0 && (
                                  <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-[11px] text-muted-foreground">
                                    {JSON.stringify(event.payload, null, 2)}
                                  </pre>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <EmptyState icon={Bug} message="Select an external work item to inspect its sync and writeback events." />
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
