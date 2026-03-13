import type {
  CreateSocialSignal,
  CreateSocialSignalSource,
  PromoteSocialSignal,
  SocialSignal,
  SocialSignalSource,
  SocialSignalSourceSyncResult,
  UpdateSocialSignal,
  UpdateSocialSignalSource,
} from "@paperclipai/shared";
import { api } from "./client";

export const socialSignalsApi = {
  list: (companyId: string) =>
    api.get<SocialSignal[]>(`/companies/${companyId}/social-signals`),
  create: (companyId: string, data: CreateSocialSignal) =>
    api.post<SocialSignal>(`/companies/${companyId}/social-signals`, data),
  update: (id: string, data: UpdateSocialSignal) =>
    api.patch<SocialSignal>(`/social-signals/${id}`, data),
  promote: (id: string, data: PromoteSocialSignal = {}) =>
    api.post<SocialSignal>(`/social-signals/${id}/promote`, data),
  listSources: (companyId: string) =>
    api.get<SocialSignalSource[]>(`/companies/${companyId}/social-signal-sources`),
  createSource: (companyId: string, data: CreateSocialSignalSource) =>
    api.post<SocialSignalSource>(`/companies/${companyId}/social-signal-sources`, data),
  updateSource: (id: string, data: UpdateSocialSignalSource) =>
    api.patch<SocialSignalSource>(`/social-signal-sources/${id}`, data),
  syncSource: (id: string) =>
    api.post<SocialSignalSourceSyncResult>(`/social-signal-sources/${id}/sync`, {}),
};
