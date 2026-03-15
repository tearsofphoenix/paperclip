import type { Db } from "@paperclipai/db";
import type { EnvBinding, TapdExternalWorkIntegrationConfig } from "@paperclipai/shared";
import { tapdExternalWorkIntegrationConfigSchema } from "@paperclipai/shared";
import { HttpError, unprocessable } from "../errors.js";
import { browserBackedFetch } from "./browser-fallback.js";
import { secretService } from "./secrets.js";

const DEFAULT_TAPD_API_BASE_URL = "https://api.tapd.cn";

type TapdQueryValue = string | number | boolean | null | undefined;
type TapdMutationValue = string | number | boolean | null | undefined;

type ResolvedTapdBasicRuntimeCredentials = {
  authMode: "basic";
  apiUser: string;
  apiPassword: string;
};

type ResolvedTapdAccessTokenRuntimeCredentials = {
  authMode: "access_token";
  accessToken: string;
};

export type ResolvedTapdRuntimeCredentials =
  | ResolvedTapdBasicRuntimeCredentials
  | ResolvedTapdAccessTokenRuntimeCredentials;

export type ResolvedTapdRuntimeConfig = Omit<
  TapdExternalWorkIntegrationConfig,
  "credentials" | "browserAutomation"
> & {
  credentials: ResolvedTapdRuntimeCredentials;
  browserAutomation:
    | (NonNullable<TapdExternalWorkIntegrationConfig["browserAutomation"]> & {
        storageState: string | null;
        cookieHeader: string | null;
      })
    | null;
};

export interface TapdWorkspaceRecord {
  id: string;
  name: string;
  creator: string | null;
  owner: string | null;
  status: string | null;
  url: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown>;
}

export interface TapdIterationRecord {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  name: string;
  status: string | null;
  owner: string | null;
  startAt: string | null;
  endAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown>;
}

export interface TapdWorkItemRecord {
  type: "story" | "task" | "bug";
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  iterationId: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  status: string | null;
  owner: string | null;
  creator: string | null;
  priority: string | null;
  severity: string | null;
  url: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown>;
}

export interface TapdListResult<TRecord> {
  items: TRecord[];
  totalCount: number | null;
  page: number | null;
  limit: number | null;
  raw: unknown;
}

export interface TapdCollectionQuery {
  workspaceId: string;
  page?: number;
  limit?: number;
  fields?: string[] | null;
  filters?: Record<string, TapdQueryValue>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function getNestedRecord(
  value: unknown,
  preferredKeys: readonly string[],
): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of preferredKeys) {
    const nested = asRecord(record[key]);
    if (nested) return nested;
  }
  if (Object.keys(record).length === 1) {
    const nested = asRecord(record[Object.keys(record)[0] ?? ""]);
    if (nested) return nested;
  }
  return record;
}

function parseProviderErrorBody(body: unknown) {
  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const record = asRecord(body);
  if (!record) return null;
  const detail =
    asString(record.info) ??
    asString(record.error_description) ??
    asString(record.error) ??
    asString(record.message) ??
    asString(record.detail);
  if (detail) return detail;
  const dataRecord = asRecord(record.data);
  if (!dataRecord) return null;
  return (
    asString(dataRecord.message) ??
    asString(dataRecord.error) ??
    asString(dataRecord.detail) ??
    null
  );
}

function providerHttpError(provider: string, status: number, body: unknown) {
  const detail = parseProviderErrorBody(body);
  const message = detail
    ? `${provider} API request failed (${status}): ${detail}`
    : `${provider} API request failed with status ${status}`;
  if (status >= 500) {
    return new HttpError(500, message);
  }
  return unprocessable(message);
}

function parseResponsePayload(rawText: string) {
  if (rawText.trim().length === 0) return null;
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
}

function isTapdFailureStatus(status: unknown) {
  return status === 0 || status === "0" || status === false;
}

function extractTapdData(body: unknown) {
  const record = asRecord(body);
  if (record && Object.prototype.hasOwnProperty.call(record, "status")) {
    if (isTapdFailureStatus(record.status)) {
      const message = parseProviderErrorBody(body) ?? "TAPD API returned an unsuccessful status";
      throw unprocessable(message);
    }
  }
  return record && Object.prototype.hasOwnProperty.call(record, "data") ? record.data : body;
}

function toTapdCredentialEnv(config: TapdExternalWorkIntegrationConfig) {
  const env: Record<string, EnvBinding> = {};
  if (config.credentials.authMode === "basic") {
    env.TAPD_API_USER = config.credentials.apiUser;
    env.TAPD_API_PASSWORD = config.credentials.apiPassword;
  } else {
    env.TAPD_ACCESS_TOKEN = config.credentials.accessToken;
  }
  if (config.browserAutomation?.storageState) {
    env.TAPD_BROWSER_STORAGE_STATE = config.browserAutomation.storageState;
  }
  if (config.browserAutomation?.cookieHeader) {
    env.TAPD_BROWSER_COOKIE_HEADER = config.browserAutomation.cookieHeader;
  }
  return env;
}

function extractTapdCredentialEnv(
  config: TapdExternalWorkIntegrationConfig,
  env: Record<string, EnvBinding>,
): TapdExternalWorkIntegrationConfig {
  return {
    ...config,
    credentials:
      config.credentials.authMode === "basic"
        ? {
            authMode: "basic",
            apiUser: env.TAPD_API_USER,
            apiPassword: env.TAPD_API_PASSWORD,
          }
        : {
            authMode: "access_token",
            accessToken: env.TAPD_ACCESS_TOKEN,
          },
    browserAutomation: config.browserAutomation
      ? {
          ...config.browserAutomation,
          storageState: env.TAPD_BROWSER_STORAGE_STATE ?? null,
          cookieHeader: env.TAPD_BROWSER_COOKIE_HEADER ?? null,
        }
      : null,
  };
}

function extractResolvedTapdCredentialEnv(
  config: TapdExternalWorkIntegrationConfig,
  env: Record<string, string>,
): ResolvedTapdRuntimeConfig {
  return {
    ...config,
    credentials:
      config.credentials.authMode === "basic"
        ? {
            authMode: "basic",
            apiUser: env.TAPD_API_USER ?? "",
            apiPassword: env.TAPD_API_PASSWORD ?? "",
          }
        : {
            authMode: "access_token",
            accessToken: env.TAPD_ACCESS_TOKEN ?? "",
          },
    browserAutomation: config.browserAutomation
      ? {
          ...config.browserAutomation,
          storageState: env.TAPD_BROWSER_STORAGE_STATE ?? null,
          cookieHeader: env.TAPD_BROWSER_COOKIE_HEADER ?? null,
        }
      : null,
  };
}

function buildTapdAuthHeaders(credentials: ResolvedTapdRuntimeCredentials) {
  if (credentials.authMode === "basic") {
    const token = Buffer.from(`${credentials.apiUser}:${credentials.apiPassword}`).toString(
      "base64",
    );
    return { Authorization: `Basic ${token}` };
  }
  return { Authorization: `Bearer ${credentials.accessToken}` };
}

function buildTapdUrl(
  apiBaseUrl: string | null | undefined,
  path: string,
  query?: URLSearchParams,
) {
  const baseUrl = apiBaseUrl ?? DEFAULT_TAPD_API_BASE_URL;
  const url = new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (query) {
    for (const [key, value] of query.entries()) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function appendQueryParams(params: URLSearchParams, entries?: Record<string, TapdQueryValue>) {
  if (!entries) return params;
  for (const [key, rawValue] of Object.entries(entries)) {
    if (rawValue === undefined || rawValue === null) continue;
    if (typeof rawValue === "string" && rawValue.trim().length === 0) continue;
    params.set(key, String(rawValue));
  }
  return params;
}

function buildCollectionQuery(input: TapdCollectionQuery) {
  const params = new URLSearchParams({ workspace_id: input.workspaceId });
  if (isPositiveInteger(input.page)) params.set("page", String(input.page));
  if (isPositiveInteger(input.limit)) params.set("limit", String(input.limit));
  if (input.fields && input.fields.length > 0) {
    params.set("fields", input.fields.join(","));
  }
  return appendQueryParams(params, input.filters);
}

function sanitizeMutationPatch(patch: Record<string, TapdMutationValue>) {
  const values: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(patch)) {
    if (rawValue === undefined) continue;
    if (rawValue === null) {
      values[key] = "";
      continue;
    }
    values[key] = String(rawValue);
  }
  if (Object.keys(values).length === 0) {
    throw unprocessable("TAPD writeback patch must include at least one field");
  }
  return values;
}

function extractItemsFromTapdData(data: unknown) {
  const dataRecord = asRecord(data);
  if (Array.isArray(data)) return data;
  if (Array.isArray(dataRecord?.items)) return dataRecord.items;
  if (data === null || data === undefined) return [];
  return [data];
}

function normalizeWorkspaceRecord(rawValue: unknown): TapdWorkspaceRecord | null {
  const record = getNestedRecord(rawValue, ["Workspace", "workspace"]);
  const id = asString(record?.id);
  const name = asString(record?.name) ?? asString(record?.title);
  if (!record || !id || !name) return null;
  return {
    id,
    name,
    creator: asString(record.creator),
    owner: asString(record.owner),
    status: asString(record.status),
    url: asString(record.url),
    createdAt: asString(record.created) ?? asString(record.created_at),
    updatedAt: asString(record.modified) ?? asString(record.updated_at),
    raw: record,
  };
}

function normalizeIterationRecord(rawValue: unknown): TapdIterationRecord | null {
  const record = getNestedRecord(rawValue, ["Iteration", "iteration"]);
  const id = asString(record?.id);
  const name = asString(record?.name) ?? asString(record?.title);
  if (!record || !id || !name) return null;
  return {
    id,
    workspaceId: asString(record.workspace_id),
    projectId: asString(record.project_id),
    name,
    status: asString(record.status),
    owner: asString(record.owner),
    startAt:
      asString(record.startdate) ??
      asString(record.start_at) ??
      asString(record.start_time),
    endAt:
      asString(record.enddate) ?? asString(record.end_at) ?? asString(record.end_time),
    createdAt: asString(record.created) ?? asString(record.created_at),
    updatedAt: asString(record.modified) ?? asString(record.updated_at),
    raw: record,
  };
}

function normalizeWorkItemRecord(
  rawValue: unknown,
  type: "story" | "task" | "bug",
): TapdWorkItemRecord | null {
  const modelKeys =
    type === "story"
      ? ["Story", "story"]
      : type === "task"
        ? ["Task", "task"]
        : ["Bug", "bug"];
  const record = getNestedRecord(rawValue, modelKeys);
  const id = asString(record?.id);
  const title = asString(record?.title) ?? asString(record?.name);
  if (!record || !id || !title) return null;
  return {
    type,
    id,
    workspaceId: asString(record.workspace_id),
    projectId: asString(record.project_id),
    iterationId: asString(record.iteration_id),
    parentId: asString(record.parent_id),
    title,
    description: asString(record.description),
    status: asString(record.status),
    owner: asString(record.owner),
    creator: asString(record.creator),
    priority: asString(record.priority),
    severity: asString(record.severity),
    url: asString(record.url),
    createdAt: asString(record.created) ?? asString(record.created_at),
    updatedAt: asString(record.modified) ?? asString(record.updated_at),
    raw: record,
  };
}

function buildListResult<TRecord>(
  items: TRecord[],
  body: unknown,
  input: { page?: number; limit?: number },
): TapdListResult<TRecord> {
  const bodyRecord = asRecord(body);
  const dataRecord = asRecord(bodyRecord?.data);
  return {
    items,
    totalCount:
      asNumber(bodyRecord?.count) ??
      asNumber(bodyRecord?.total) ??
      asNumber(dataRecord?.count) ??
      items.length,
    page: input.page ?? null,
    limit: input.limit ?? null,
    raw: body,
  };
}

function resolveWorkspaceIds(
  config: TapdExternalWorkIntegrationConfig,
  workspaceIds?: string[],
) {
  const resolved =
    workspaceIds?.filter((item) => typeof item === "string" && item.trim().length > 0) ??
    config.workspaceIds.filter((item) => item.trim().length > 0);
  if (resolved.length === 0) {
    throw unprocessable("TAPD workspaceIds must contain at least one workspace");
  }
  return resolved;
}

export function tapdIntegrationService(
  db: Db,
  opts?: { fetchImpl?: typeof fetch },
) {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const secretsSvc = secretService(db);

  async function normalizeConfigForPersistence(
    companyId: string,
    rawConfig: unknown,
  ): Promise<TapdExternalWorkIntegrationConfig> {
    const parsed = tapdExternalWorkIntegrationConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw unprocessable("Invalid TAPD integration config", parsed.error.flatten());
    }
    const normalizedHolder = await secretsSvc.normalizeAdapterConfigForPersistence(companyId, {
      env: toTapdCredentialEnv(parsed.data),
    });
    const env = (normalizedHolder.env ?? {}) as Record<string, EnvBinding>;
    return extractTapdCredentialEnv(parsed.data, env);
  }

  async function resolveConfigForRuntime(
    companyId: string,
    rawConfig: unknown,
  ): Promise<ResolvedTapdRuntimeConfig> {
    const config = await normalizeConfigForPersistence(companyId, rawConfig);
    const { env } = await secretsSvc.resolveEnvBindings(companyId, toTapdCredentialEnv(config));
    return extractResolvedTapdCredentialEnv(config, env);
  }

  async function requestTapd(
    runtimeConfig: ResolvedTapdRuntimeConfig,
    input: {
      path: string;
      method?: "GET" | "PUT";
      query?: URLSearchParams;
      formBody?: Record<string, string>;
    },
  ) {
    const url = buildTapdUrl(runtimeConfig.apiBaseUrl, input.path, input.query);
    const method = input.method ?? "GET";
    const formBody = input.formBody ? new URLSearchParams(input.formBody).toString() : null;
    const canUseBrowserFallback =
      runtimeConfig.fallbackMode !== "api_only" && runtimeConfig.browserAutomation?.enabled === true;

    const requestViaBrowser = async () => {
      if (!canUseBrowserFallback) {
        throw unprocessable("TAPD browser fallback requested but browserAutomation is not enabled");
      }
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (formBody) {
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
      }
      const response = await browserBackedFetch({
        url,
        method,
        headers,
        body: formBody,
        browserAutomation: runtimeConfig.browserAutomation,
      });
      const payload = parseResponsePayload(response.text);
      if (!response.ok) {
        throw providerHttpError("TAPD", response.status, payload);
      }
      return {
        body: payload,
        data: extractTapdData(payload),
      };
    };

    const requestViaApi = async () => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...buildTapdAuthHeaders(runtimeConfig.credentials),
      };
      const response = await fetchImpl(url, {
        method,
        headers: formBody
          ? {
              ...headers,
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            }
          : headers,
        body: formBody ?? undefined,
      });
      const payload = parseResponsePayload(await response.text().catch(() => ""));
      if (!response.ok) {
        throw providerHttpError("TAPD", response.status, payload);
      }
      return {
        body: payload,
        data: extractTapdData(payload),
      };
    };

    if (runtimeConfig.fallbackMode === "browser_only") {
      return requestViaBrowser();
    }

    try {
      return await requestViaApi();
    } catch (error) {
      if (!canUseBrowserFallback) {
        throw error;
      }
      return requestViaBrowser();
    }
  }

  async function requestCollection<TRecord>(
    companyId: string,
    rawConfig: unknown,
    input: {
      path: string;
      query: TapdCollectionQuery;
      normalizeItem: (rawValue: unknown) => TRecord | null;
    },
  ): Promise<TapdListResult<TRecord>> {
    const runtimeConfig = await resolveConfigForRuntime(companyId, rawConfig);
    const response = await requestTapd(runtimeConfig, {
      path: input.path,
      query: buildCollectionQuery(input.query),
    });
    const items = extractItemsFromTapdData(response.data)
      .map(input.normalizeItem)
      .filter((item): item is TRecord => item !== null);
    return buildListResult(items, response.body, input.query);
  }

  async function updateWorkItem(
    companyId: string,
    rawConfig: unknown,
    input: {
      path: string;
      id: string;
      patch: Record<string, TapdMutationValue>;
      type: "task" | "bug";
    },
  ) {
    const runtimeConfig = await resolveConfigForRuntime(companyId, rawConfig);
    const response = await requestTapd(runtimeConfig, {
      path: `${input.path}/${encodeURIComponent(input.id)}`,
      method: "PUT",
      formBody: sanitizeMutationPatch(input.patch),
    });
    const record = normalizeWorkItemRecord(response.data, input.type);
    if (!record) {
      throw unprocessable(`TAPD ${input.type} writeback succeeded but response payload was empty`);
    }
    return record;
  }

  return {
    normalizeConfigForPersistence,

    resolveConfigForRuntime,

    listWorkspaces: async (
      companyId: string,
      rawConfig: unknown,
      input?: { workspaceIds?: string[] },
    ): Promise<TapdListResult<TapdWorkspaceRecord>> => {
      const runtimeConfig = await resolveConfigForRuntime(companyId, rawConfig);
      const persistedConfig = await normalizeConfigForPersistence(companyId, rawConfig);
      const workspaceIds = resolveWorkspaceIds(persistedConfig, input?.workspaceIds);
      const items: TapdWorkspaceRecord[] = [];
      for (const workspaceId of workspaceIds) {
        const response = await requestTapd(runtimeConfig, {
          path: "workspaces/get_workspace_info",
          query: new URLSearchParams({ workspace_id: workspaceId }),
        });
        const record = normalizeWorkspaceRecord(response.data);
        if (record) items.push(record);
      }
      return {
        items,
        totalCount: items.length,
        page: null,
        limit: null,
        raw: items.map((item) => item.raw),
      };
    },

    listIterations: async (
      companyId: string,
      rawConfig: unknown,
      query: TapdCollectionQuery,
    ) =>
      requestCollection(companyId, rawConfig, {
        path: "iterations",
        query,
        normalizeItem: normalizeIterationRecord,
      }),

    listStories: async (
      companyId: string,
      rawConfig: unknown,
      query: TapdCollectionQuery,
    ) =>
      requestCollection(companyId, rawConfig, {
        path: "stories",
        query,
        normalizeItem: (rawValue) => normalizeWorkItemRecord(rawValue, "story"),
      }),

    listBugs: async (
      companyId: string,
      rawConfig: unknown,
      query: TapdCollectionQuery,
    ) =>
      requestCollection(companyId, rawConfig, {
        path: "bugs",
        query,
        normalizeItem: (rawValue) => normalizeWorkItemRecord(rawValue, "bug"),
      }),

    listTasks: async (
      companyId: string,
      rawConfig: unknown,
      query: TapdCollectionQuery,
    ) =>
      requestCollection(companyId, rawConfig, {
        path: "tasks",
        query,
        normalizeItem: (rawValue) => normalizeWorkItemRecord(rawValue, "task"),
      }),

    updateBug: async (
      companyId: string,
      rawConfig: unknown,
      bugId: string,
      patch: Record<string, TapdMutationValue>,
    ) =>
      updateWorkItem(companyId, rawConfig, {
        path: "bugs",
        id: bugId,
        patch,
        type: "bug",
      }),

    updateTask: async (
      companyId: string,
      rawConfig: unknown,
      taskId: string,
      patch: Record<string, TapdMutationValue>,
    ) =>
      updateWorkItem(companyId, rawConfig, {
        path: "tasks",
        id: taskId,
        patch,
        type: "task",
      }),
  };
}
