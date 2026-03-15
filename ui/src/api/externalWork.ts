import type {
  CreateExternalWorkIntegration,
  ExternalWorkItem,
  ExternalWorkItemEvent,
  ExternalWorkIntegration,
  ProjectWorkspace,
  SyncExternalWorkIntegration,
  UpdateExternalWorkIntegration,
} from "@paperclipai/shared";
import { api } from "./client";

export type TapdExternalWorkSyncResult = {
  integration: ExternalWorkIntegration;
  fetchedCount: number;
  syncedCount: number;
  mappedCount: number;
  failedCount: number;
};

export type GiteeExternalWorkSyncResult = {
  integrationId: string;
  createdCount: number;
  updatedCount: number;
  workspaces: ProjectWorkspace[];
};

export type ExternalWorkSyncResult = TapdExternalWorkSyncResult | GiteeExternalWorkSyncResult;

export const externalWorkApi = {
  listIntegrations: (companyId: string) =>
    api.get<ExternalWorkIntegration[]>(`/companies/${companyId}/external-work-integrations`),
  createIntegration: (companyId: string, data: CreateExternalWorkIntegration) =>
    api.post<ExternalWorkIntegration>(`/companies/${companyId}/external-work-integrations`, data),
  updateIntegration: (id: string, data: UpdateExternalWorkIntegration) =>
    api.patch<ExternalWorkIntegration>(`/external-work-integrations/${id}`, data),
  syncIntegration: (id: string, data: SyncExternalWorkIntegration = {}) =>
    api.post<ExternalWorkSyncResult>(`/external-work-integrations/${id}/sync`, data),
  listItems: (companyId: string, integrationId?: string) =>
    api.get<ExternalWorkItem[]>(
      integrationId
        ? `/companies/${companyId}/external-work-items?integrationId=${encodeURIComponent(integrationId)}`
        : `/companies/${companyId}/external-work-items`,
    ),
  listItemEvents: (itemId: string) =>
    api.get<ExternalWorkItemEvent[]>(`/external-work-items/${itemId}/events`),
};
