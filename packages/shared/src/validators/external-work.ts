import { z } from "zod";
import {
  EXTERNAL_WORK_INTEGRATION_FALLBACK_MODES,
  EXTERNAL_WORK_INTEGRATION_PROVIDERS,
  EXTERNAL_WORK_ITEM_SYNC_STATUSES,
  EXTERNAL_WORK_ITEM_TYPES,
  GITEE_INTEGRATION_CLONE_PROTOCOLS,
} from "../constants.js";
import { envBindingSchema } from "./secret.js";

export const externalWorkIntegrationScheduleSchema = z.object({
  enabled: z.boolean().optional().default(false),
  intervalMinutes: z.number().int().min(5).max(7 * 24 * 60).optional().default(60),
});

export const externalWorkBrowserAutomationConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  headless: z.boolean().optional().default(true),
  loginUrl: z.string().url().optional().nullable().default(null),
  storageState: envBindingSchema.optional().nullable().default(null),
  cookieHeader: envBindingSchema.optional().nullable().default(null),
});

export const tapdProjectBindingSchema = z.object({
  workspaceId: z.string().trim().min(1),
  projectId: z.string().trim().min(1).optional().nullable().default(null),
  iterationId: z.string().trim().min(1).optional().nullable().default(null),
  targetProjectId: z.string().uuid().optional().nullable().default(null),
  targetWorkspaceId: z.string().uuid().optional().nullable().default(null),
  itemTypes: z
    .array(z.enum(EXTERNAL_WORK_ITEM_TYPES))
    .min(1)
    .optional()
    .default(["iteration", "story", "task", "bug"]),
  enabled: z.boolean().optional().default(true),
});

export const giteeRepoBindingSchema = z.object({
  targetProjectId: z.string().uuid().optional().nullable().default(null),
  targetWorkspaceId: z.string().uuid().optional().nullable().default(null),
  repoUrl: z.string().url(),
  repoRef: z.string().trim().min(1).optional().nullable().default(null),
  cloneProtocol: z
    .enum(GITEE_INTEGRATION_CLONE_PROTOCOLS)
    .optional()
    .default("https"),
  enabled: z.boolean().optional().default(true),
});

export const tapdIntegrationBasicCredentialsSchema = z.object({
  authMode: z.literal("basic"),
  apiUser: envBindingSchema,
  apiPassword: envBindingSchema,
});

export const tapdIntegrationAccessTokenCredentialsSchema = z.object({
  authMode: z.literal("access_token"),
  accessToken: envBindingSchema,
});

export const tapdIntegrationCredentialsSchema = z.discriminatedUnion("authMode", [
  tapdIntegrationBasicCredentialsSchema,
  tapdIntegrationAccessTokenCredentialsSchema,
]);

export const tapdExternalWorkIntegrationConfigSchema = z.object({
  kind: z.literal("tapd_openapi"),
  apiBaseUrl: z.string().url().optional().nullable().default("https://api.tapd.cn"),
  fallbackMode: z
    .enum(EXTERNAL_WORK_INTEGRATION_FALLBACK_MODES)
    .optional()
    .default("prefer_api"),
  schedule: externalWorkIntegrationScheduleSchema.optional().default({
    enabled: false,
    intervalMinutes: 60,
  }),
  workspaceIds: z.array(z.string().trim().min(1)).optional().default([]),
  projectBindings: z.array(tapdProjectBindingSchema).optional().default([]),
  browserAutomation: externalWorkBrowserAutomationConfigSchema.optional().nullable().default(null),
  credentials: tapdIntegrationCredentialsSchema,
});

export const giteeIntegrationAccessTokenCredentialsSchema = z.object({
  authMode: z.literal("access_token"),
  accessToken: envBindingSchema,
});

export const giteeIntegrationSshCredentialsSchema = z.object({
  authMode: z.literal("ssh"),
  privateKey: envBindingSchema,
  passphrase: envBindingSchema.optional().nullable().default(null),
});

export const giteeIntegrationCredentialsSchema = z.discriminatedUnion("authMode", [
  giteeIntegrationAccessTokenCredentialsSchema,
  giteeIntegrationSshCredentialsSchema,
]);

export const giteeExternalWorkIntegrationConfigSchema = z.object({
  kind: z.literal("gitee_openapi"),
  apiBaseUrl: z
    .string()
    .url()
    .optional()
    .nullable()
    .default("https://gitee.com/api/v5"),
  fallbackMode: z
    .enum(EXTERNAL_WORK_INTEGRATION_FALLBACK_MODES)
    .optional()
    .default("prefer_api"),
  cloneProtocol: z
    .enum(GITEE_INTEGRATION_CLONE_PROTOCOLS)
    .optional()
    .default("https"),
  repoBindings: z.array(giteeRepoBindingSchema).optional().default([]),
  browserAutomation: externalWorkBrowserAutomationConfigSchema.optional().nullable().default(null),
  credentials: giteeIntegrationCredentialsSchema,
});

export const externalWorkIntegrationConfigSchema = z.discriminatedUnion("kind", [
  tapdExternalWorkIntegrationConfigSchema,
  giteeExternalWorkIntegrationConfigSchema,
]);

const externalWorkIntegrationBaseSchema = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean().optional().default(true),
});

export const createExternalWorkIntegrationSchema = z.discriminatedUnion("provider", [
  externalWorkIntegrationBaseSchema.extend({
    provider: z.literal(EXTERNAL_WORK_INTEGRATION_PROVIDERS[0]),
    config: tapdExternalWorkIntegrationConfigSchema,
  }),
  externalWorkIntegrationBaseSchema.extend({
    provider: z.literal(EXTERNAL_WORK_INTEGRATION_PROVIDERS[1]),
    config: giteeExternalWorkIntegrationConfigSchema,
  }),
]);

export type CreateExternalWorkIntegration = z.input<typeof createExternalWorkIntegrationSchema>;

export const updateExternalWorkIntegrationSchema = z.object({
  name: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  config: externalWorkIntegrationConfigSchema.optional(),
});

export type UpdateExternalWorkIntegration = z.input<typeof updateExternalWorkIntegrationSchema>;

export const syncExternalWorkIntegrationSchema = z.object({
  fullSync: z.boolean().optional().default(false),
  writeback: z.boolean().optional().default(false),
});

export type SyncExternalWorkIntegration = z.input<typeof syncExternalWorkIntegrationSchema>;

export const externalWorkItemSchema = z.object({
  provider: z.enum(EXTERNAL_WORK_INTEGRATION_PROVIDERS),
  externalType: z.enum(EXTERNAL_WORK_ITEM_TYPES),
  externalId: z.string().trim().min(1),
  externalKey: z.string().trim().min(1).optional().nullable(),
  externalParentId: z.string().trim().min(1).optional().nullable(),
  externalSpaceId: z.string().trim().min(1).optional().nullable(),
  externalProjectId: z.string().trim().min(1).optional().nullable(),
  externalIterationId: z.string().trim().min(1).optional().nullable(),
  title: z.string().min(1),
  url: z.string().url().optional().nullable(),
  remoteStatus: z.string().trim().min(1).optional().nullable(),
  syncStatus: z
    .enum(EXTERNAL_WORK_ITEM_SYNC_STATUSES)
    .optional()
    .default("synced"),
  assigneeName: z.string().trim().min(1).optional().nullable(),
  linkedProjectId: z.string().uuid().optional().nullable(),
  linkedIssueId: z.string().uuid().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable().default({}),
});

export type ExternalWorkItemPayload = z.input<typeof externalWorkItemSchema>;
