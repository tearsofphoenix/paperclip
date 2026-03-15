import type {
  ExternalWorkIntegrationFallbackMode,
  ExternalWorkIntegrationProvider,
  ExternalWorkItemSyncStatus,
  ExternalWorkItemType,
  GiteeIntegrationCloneProtocol,
} from "../constants.js";
import type { EnvBinding } from "./secrets.js";

export interface ExternalWorkIntegrationSchedule {
  enabled: boolean;
  intervalMinutes: number;
}

export interface ExternalWorkBrowserAutomationConfig {
  enabled: boolean;
  headless: boolean;
  loginUrl: string | null;
  storageState: EnvBinding | null;
  cookieHeader: EnvBinding | null;
}

export interface TapdProjectBinding {
  workspaceId: string;
  projectId: string | null;
  iterationId: string | null;
  targetProjectId: string | null;
  targetWorkspaceId: string | null;
  itemTypes: ExternalWorkItemType[];
  enabled: boolean;
}

export interface GiteeRepoBinding {
  targetProjectId: string | null;
  targetWorkspaceId: string | null;
  repoUrl: string;
  repoRef: string | null;
  cloneProtocol: GiteeIntegrationCloneProtocol;
  enabled: boolean;
}

export interface TapdBasicAuthCredentials {
  authMode: "basic";
  apiUser: EnvBinding;
  apiPassword: EnvBinding;
}

export interface TapdAccessTokenCredentials {
  authMode: "access_token";
  accessToken: EnvBinding;
}

export type TapdIntegrationCredentials =
  | TapdBasicAuthCredentials
  | TapdAccessTokenCredentials;

export interface TapdExternalWorkIntegrationConfig {
  kind: "tapd_openapi";
  apiBaseUrl: string | null;
  fallbackMode: ExternalWorkIntegrationFallbackMode;
  schedule: ExternalWorkIntegrationSchedule;
  workspaceIds: string[];
  projectBindings: TapdProjectBinding[];
  browserAutomation: ExternalWorkBrowserAutomationConfig | null;
  credentials: TapdIntegrationCredentials;
}

export interface GiteeAccessTokenCredentials {
  authMode: "access_token";
  accessToken: EnvBinding;
}

export interface GiteeSshCredentials {
  authMode: "ssh";
  privateKey: EnvBinding;
  passphrase: EnvBinding | null;
}

export type GiteeIntegrationCredentials =
  | GiteeAccessTokenCredentials
  | GiteeSshCredentials;

export interface GiteeExternalWorkIntegrationConfig {
  kind: "gitee_openapi";
  apiBaseUrl: string | null;
  fallbackMode: ExternalWorkIntegrationFallbackMode;
  cloneProtocol: GiteeIntegrationCloneProtocol;
  repoBindings: GiteeRepoBinding[];
  browserAutomation: ExternalWorkBrowserAutomationConfig | null;
  credentials: GiteeIntegrationCredentials;
}

export type ExternalWorkIntegrationConfig =
  | TapdExternalWorkIntegrationConfig
  | GiteeExternalWorkIntegrationConfig;

export interface ExternalWorkIntegration {
  id: string;
  companyId: string;
  provider: ExternalWorkIntegrationProvider;
  name: string;
  enabled: boolean;
  config: ExternalWorkIntegrationConfig;
  lastCursor: string | null;
  lastSyncedAt: Date | null;
  lastWritebackAt: Date | null;
  lastError: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalWorkItem {
  id: string;
  companyId: string;
  integrationId: string;
  provider: ExternalWorkIntegrationProvider;
  externalType: ExternalWorkItemType;
  externalSpaceId: string | null;
  externalProjectId: string | null;
  externalIterationId: string | null;
  externalParentId: string | null;
  externalId: string;
  externalKey: string | null;
  title: string;
  url: string | null;
  remoteStatus: string | null;
  syncStatus: ExternalWorkItemSyncStatus;
  assigneeName: string | null;
  linkedProjectId: string | null;
  linkedIssueId: string | null;
  metadata: Record<string, unknown> | null;
  lastSyncedAt: Date | null;
  lastWritebackAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalWorkItemEvent {
  id: string;
  companyId: string;
  externalWorkItemId: string;
  eventType: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}
