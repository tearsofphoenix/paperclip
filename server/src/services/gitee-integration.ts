import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { externalWorkIntegrations, projectWorkspaces } from "@paperclipai/db";
import type {
  EnvBinding,
  GiteeExternalWorkIntegrationConfig,
  GiteeRepoBinding,
  ProjectWorkspace,
} from "@paperclipai/shared";
import { giteeExternalWorkIntegrationConfigSchema } from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { logActivity } from "./activity-log.js";
import { browserBackedFetch } from "./browser-fallback.js";
import { projectService } from "./projects.js";
import { secretService } from "./secrets.js";

const DEFAULT_GITEE_API_BASE_URL = "https://gitee.com/api/v5";
const execFileAsync = promisify(execFile);

type GiteeMutationActor = {
  actorType?: "user" | "agent" | "system";
  actorId?: string | null;
  agentId?: string | null;
  userId?: string | null;
  runId?: string | null;
  invocation?: "manual" | "scheduler";
};

type ResolvedGiteeAccessTokenRuntimeCredentials = {
  authMode: "access_token";
  accessToken: string;
};

type ResolvedGiteeSshRuntimeCredentials = {
  authMode: "ssh";
  privateKey: string;
  passphrase: string | null;
};

type ResolvedGiteeRuntimeCredentials =
  | ResolvedGiteeAccessTokenRuntimeCredentials
  | ResolvedGiteeSshRuntimeCredentials;

export type ResolvedGiteeRuntimeConfig = Omit<
  GiteeExternalWorkIntegrationConfig,
  "credentials" | "browserAutomation"
> & {
  credentials: ResolvedGiteeRuntimeCredentials;
  browserAutomation:
    | (NonNullable<GiteeExternalWorkIntegrationConfig["browserAutomation"]> & {
        storageState: string | null;
        cookieHeader: string | null;
      })
    | null;
};

export interface GiteeBindingSyncResult {
  integrationId: string;
  createdCount: number;
  updatedCount: number;
  workspaces: ProjectWorkspace[];
}

export interface GiteeWorkspacePullResult {
  workspace: ProjectWorkspace;
  cwd: string;
  branch: string | null;
  head: string;
  cloned: boolean;
  pulled: boolean;
}

export interface GiteeWorkspaceCommitPushResult extends GiteeWorkspacePullResult {
  committed: boolean;
  pushed: boolean;
  commitSha: string | null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseResponsePayload(rawText: string) {
  if (rawText.trim().length === 0) return null;
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
}

function toGiteeCredentialEnv(config: GiteeExternalWorkIntegrationConfig) {
  const env: Record<string, EnvBinding> = {};
  if (config.credentials.authMode === "access_token") {
    env.GITEE_ACCESS_TOKEN = config.credentials.accessToken;
  } else {
    env.GITEE_PRIVATE_KEY = config.credentials.privateKey;
    if (config.credentials.passphrase) {
      env.GITEE_PRIVATE_KEY_PASSPHRASE = config.credentials.passphrase;
    }
  }
  if (config.browserAutomation?.storageState) {
    env.GITEE_BROWSER_STORAGE_STATE = config.browserAutomation.storageState;
  }
  if (config.browserAutomation?.cookieHeader) {
    env.GITEE_BROWSER_COOKIE_HEADER = config.browserAutomation.cookieHeader;
  }
  return env;
}

function extractGiteeCredentialEnv(
  config: GiteeExternalWorkIntegrationConfig,
  env: Record<string, EnvBinding>,
): GiteeExternalWorkIntegrationConfig {
  return {
    ...config,
    credentials:
      config.credentials.authMode === "access_token"
        ? {
            authMode: "access_token",
            accessToken: env.GITEE_ACCESS_TOKEN,
          }
        : {
            authMode: "ssh",
            privateKey: env.GITEE_PRIVATE_KEY,
            passphrase: env.GITEE_PRIVATE_KEY_PASSPHRASE ?? null,
          },
    browserAutomation: config.browserAutomation
      ? {
          ...config.browserAutomation,
          storageState: env.GITEE_BROWSER_STORAGE_STATE ?? null,
          cookieHeader: env.GITEE_BROWSER_COOKIE_HEADER ?? null,
        }
      : null,
  };
}

function extractResolvedGiteeCredentialEnv(
  config: GiteeExternalWorkIntegrationConfig,
  env: Record<string, string>,
): ResolvedGiteeRuntimeConfig {
  return {
    ...config,
    credentials:
      config.credentials.authMode === "access_token"
        ? {
            authMode: "access_token",
            accessToken: env.GITEE_ACCESS_TOKEN ?? "",
          }
        : {
            authMode: "ssh",
            privateKey: env.GITEE_PRIVATE_KEY ?? "",
            passphrase: env.GITEE_PRIVATE_KEY_PASSPHRASE ?? null,
          },
    browserAutomation: config.browserAutomation
      ? {
          ...config.browserAutomation,
          storageState: env.GITEE_BROWSER_STORAGE_STATE ?? null,
          cookieHeader: env.GITEE_BROWSER_COOKIE_HEADER ?? null,
        }
      : null,
  };
}

function buildGiteeApiUrl(apiBaseUrl: string | null | undefined, pathname: string) {
  const base = apiBaseUrl ?? DEFAULT_GITEE_API_BASE_URL;
  const url = new URL(pathname.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
  return url.toString();
}

function normalizeRepoUrlForClone(repoUrl: string, cloneProtocol: "https" | "ssh") {
  if (repoUrl.startsWith("file://")) return repoUrl;
  if (cloneProtocol === "ssh") {
    const sshMatch = /^git@[^:]+:[^/]+\/.+\.git$/i.test(repoUrl);
    if (sshMatch) return repoUrl;
    try {
      const url = new URL(repoUrl);
      if (url.hostname !== "gitee.com") return repoUrl;
      const repoPath = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
      if (!repoPath.endsWith(".git")) {
        return `git@gitee.com:${repoPath}.git`;
      }
      return `git@gitee.com:${repoPath}`;
    } catch {
      return repoUrl;
    }
  }

  if (/^git@[^:]+:/i.test(repoUrl)) {
    const match = /^git@[^:]+:(.+)$/.exec(repoUrl);
    const repoPath = match?.[1] ?? repoUrl;
    return `https://gitee.com/${repoPath}`;
  }
  return repoUrl;
}

function deriveWorkspaceCloneDir(workspaceId: string) {
  return path.resolve(
    resolvePaperclipInstanceRoot(),
    "repos",
    "project-workspaces",
    workspaceId,
  );
}

async function directoryExists(value: string) {
  return fs.stat(value).then((stats) => stats.isDirectory()).catch(() => false);
}

async function isGitRepository(value: string) {
  const gitPath = path.join(value, ".git");
  return fs.stat(gitPath).then(() => true).catch(() => false);
}

async function isDirectoryEmpty(value: string) {
  const entries = await fs.readdir(value).catch(() => []);
  return entries.length === 0;
}

async function runGit(
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      env: env ?? process.env,
    });
    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      code: 0,
    };
  } catch (error) {
    const failed = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };
    return {
      stdout: String(failed.stdout ?? "").trim(),
      stderr: String(failed.stderr ?? failed.message ?? "").trim(),
      code: Number(failed.code ?? 1),
    };
  }
}

async function runGitOrThrow(args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  const result = await runGit(args, cwd, env);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

async function writeExecutableFile(filePath: string, contents: string) {
  await fs.writeFile(filePath, contents, { encoding: "utf8", mode: 0o700 });
}

async function withGitExecutionContext<T>(input: {
  runtimeConfig: ResolvedGiteeRuntimeConfig;
  repoUrl: string;
  fetchImpl: typeof fetch;
  work: (env: NodeJS.ProcessEnv) => Promise<T>;
}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-gitee-auth-"));
  try {
    if (
      input.runtimeConfig.credentials.authMode === "access_token" &&
      !input.repoUrl.startsWith("file://")
    ) {
      const username = await resolveGiteeUsername(
        input.runtimeConfig,
        input.fetchImpl,
      );
      const askPassPath = path.join(tempDir, "askpass.sh");
      await writeExecutableFile(
        askPassPath,
        [
          "#!/usr/bin/env bash",
          'case "$1" in',
          '  *Username*) printf "%s" "$PAPERCLIP_GIT_USERNAME" ;;',
          '  *Password*) printf "%s" "$PAPERCLIP_GIT_PASSWORD" ;;',
          '  *) printf "" ;;',
          "esac",
        ].join("\n"),
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: askPassPath,
        SSH_ASKPASS: askPassPath,
        PAPERCLIP_GIT_USERNAME: username,
        PAPERCLIP_GIT_PASSWORD: input.runtimeConfig.credentials.accessToken,
      };
      return input.work(env);
    }

    if (
      input.runtimeConfig.credentials.authMode === "ssh" &&
      !input.repoUrl.startsWith("file://")
    ) {
      const keyPath = path.join(tempDir, "id_gitee");
      await fs.writeFile(keyPath, input.runtimeConfig.credentials.privateKey, {
        encoding: "utf8",
        mode: 0o600,
      });

      let env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: `ssh -i "${keyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
      };

      if (input.runtimeConfig.credentials.passphrase) {
        const askPassPath = path.join(tempDir, "ssh-askpass.sh");
        await writeExecutableFile(
          askPassPath,
          [
            "#!/usr/bin/env bash",
            'printf "%s" "$PAPERCLIP_GIT_PASSWORD"',
          ].join("\n"),
        );
        env = {
          ...env,
          DISPLAY: "paperclip:0",
          SSH_ASKPASS: askPassPath,
          SSH_ASKPASS_REQUIRE: "force",
          PAPERCLIP_GIT_PASSWORD: input.runtimeConfig.credentials.passphrase,
        };
      }

      return input.work(env);
    }

    return input.work(process.env);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function resolveGiteeUsername(
  runtimeConfig: ResolvedGiteeRuntimeConfig,
  fetchImpl: typeof fetch,
) {
  const canUseBrowserFallback =
    runtimeConfig.fallbackMode !== "api_only" && runtimeConfig.browserAutomation?.enabled === true;

  const parseUsername = (body: unknown) => {
    const record = asRecord(body);
    const username =
      asString(record?.login) ??
      asString(record?.name) ??
      asString(record?.username);
    if (!username) {
      throw new Error("Failed to resolve Gitee username from provider response");
    }
    return username;
  };

  const requestViaBrowser = async () => {
    if (!canUseBrowserFallback) {
      throw new Error("Gitee browser fallback requested but browserAutomation is not enabled");
    }
    const response = await browserBackedFetch({
      url: buildGiteeApiUrl(runtimeConfig.apiBaseUrl, "user"),
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      browserAutomation: runtimeConfig.browserAutomation,
    });
    const body = parseResponsePayload(response.text);
    if (!response.ok) {
      throw new Error(
        `Failed to resolve Gitee username via browser session (${response.status}): ${JSON.stringify(body)}`,
      );
    }
    return parseUsername(body);
  };

  const requestViaApi = async () => {
    if (runtimeConfig.credentials.authMode !== "access_token") {
      throw new Error("Gitee username resolution requires access token mode");
    }
    const url = new URL(buildGiteeApiUrl(runtimeConfig.apiBaseUrl, "user"));
    url.searchParams.set("access_token", runtimeConfig.credentials.accessToken);
    const response = await fetchImpl(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });
    const body = parseResponsePayload(await response.text().catch(() => ""));
    if (!response.ok) {
      throw new Error(
        `Failed to resolve Gitee username (${response.status}): ${JSON.stringify(body)}`,
      );
    }
    return parseUsername(body);
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

async function ensureBranchReady(
  cwd: string,
  repoRef: string | null,
  env?: NodeJS.ProcessEnv,
) {
  const targetRef = asString(repoRef);
  if (!targetRef || targetRef === "HEAD") {
    const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd, env);
    return branch.stdout || null;
  }

  await runGitOrThrow(["fetch", "origin", targetRef], cwd, env);
  const checkoutExisting = await runGit(["checkout", targetRef], cwd, env);
  if (checkoutExisting.code !== 0) {
    await runGitOrThrow(
      ["checkout", "-B", targetRef, `origin/${targetRef}`],
      cwd,
      env,
    );
  }
  const mergeResult = await runGit(
    ["merge", "--ff-only", `origin/${targetRef}`],
    cwd,
    env,
  );
  if (
    mergeResult.code !== 0 &&
    !/already up to date/i.test(`${mergeResult.stdout}\n${mergeResult.stderr}`)
  ) {
    throw new Error(mergeResult.stderr || mergeResult.stdout || `Failed to fast-forward ${targetRef}`);
  }
  return targetRef;
}

function buildBindingMetadata(
  existing: Record<string, unknown> | null | undefined,
  input: {
    integrationId: string;
    binding: GiteeRepoBinding;
    repoUrl: string;
  },
) {
  const next = {
    ...(existing ?? {}),
    externalRepoBinding: {
      provider: "gitee",
      integrationId: input.integrationId,
      repoUrl: input.repoUrl,
      repoRef: input.binding.repoRef ?? null,
      cloneProtocol: input.binding.cloneProtocol,
    },
  };
  return next;
}

function selectBindingForWorkspace(
  config: GiteeExternalWorkIntegrationConfig,
  workspace: typeof projectWorkspaces.$inferSelect,
) {
  return (
    config.repoBindings.find(
      (binding) =>
        binding.enabled !== false &&
        binding.targetWorkspaceId === workspace.id,
    ) ??
    config.repoBindings.find(
      (binding) =>
        binding.enabled !== false &&
        binding.targetProjectId === workspace.projectId &&
        (!workspace.repoUrl || binding.repoUrl === workspace.repoUrl),
    ) ??
    null
  );
}

export function giteeIntegrationService(
  db: Db,
  deps?: {
    fetchImpl?: typeof fetch;
    projects?: Pick<
      ReturnType<typeof projectService>,
      "createWorkspace" | "updateWorkspace" | "listWorkspaces"
    >;
    logActivityFn?: typeof logActivity;
  },
) {
  const fetchImpl = deps?.fetchImpl ?? globalThis.fetch;
  const secretsSvc = secretService(db);
  const projectsSvc = deps?.projects ?? projectService(db);
  const logActivityFn = deps?.logActivityFn ?? logActivity;

  async function getIntegrationById(id: string) {
    return db
      .select()
      .from(externalWorkIntegrations)
      .where(eq(externalWorkIntegrations.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function getWorkspaceById(companyId: string, workspaceId: string) {
    return db
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.companyId, companyId),
          eq(projectWorkspaces.id, workspaceId),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function normalizeConfigForPersistence(
    companyId: string,
    rawConfig: unknown,
  ): Promise<GiteeExternalWorkIntegrationConfig> {
    const parsed = giteeExternalWorkIntegrationConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw unprocessable("Invalid Gitee integration config", parsed.error.flatten());
    }
    const normalizedHolder = await secretsSvc.normalizeAdapterConfigForPersistence(companyId, {
      env: toGiteeCredentialEnv(parsed.data),
    });
    const env = (normalizedHolder.env ?? {}) as Record<string, EnvBinding>;
    return extractGiteeCredentialEnv(parsed.data, env);
  }

  async function resolveConfigForRuntime(
    companyId: string,
    rawConfig: unknown,
  ): Promise<ResolvedGiteeRuntimeConfig> {
    const config = await normalizeConfigForPersistence(companyId, rawConfig);
    const { env } = await secretsSvc.resolveEnvBindings(companyId, toGiteeCredentialEnv(config));
    return extractResolvedGiteeCredentialEnv(config, env);
  }

  async function syncBindings(
    integrationId: string,
    actor?: GiteeMutationActor,
  ): Promise<GiteeBindingSyncResult> {
    const integration = await getIntegrationById(integrationId);
    if (!integration) throw notFound("External work integration not found");
    if (integration.provider !== "gitee") {
      throw unprocessable(`Unsupported external work provider: ${integration.provider}`);
    }
    const config = await normalizeConfigForPersistence(integration.companyId, integration.config);
    const workspaces: ProjectWorkspace[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    try {
      for (const binding of config.repoBindings.filter((item) => item.enabled !== false)) {
        const repoUrl = normalizeRepoUrlForClone(binding.repoUrl, binding.cloneProtocol);

        if (binding.targetWorkspaceId) {
          const existing = await getWorkspaceById(integration.companyId, binding.targetWorkspaceId);
          if (!existing) {
            throw notFound(`Project workspace not found: ${binding.targetWorkspaceId}`);
          }
          const updated = await projectsSvc.updateWorkspace(existing.projectId, existing.id, {
            repoUrl,
            repoRef: binding.repoRef,
            metadata: buildBindingMetadata(existing.metadata, {
              integrationId: integration.id,
              binding,
              repoUrl,
            }),
          });
          if (updated) {
            workspaces.push(updated);
            updatedCount += 1;
          }
          continue;
        }

        if (!binding.targetProjectId) {
          throw unprocessable("Gitee repo binding requires targetProjectId or targetWorkspaceId");
        }

        const existingWorkspaces = await projectsSvc.listWorkspaces(binding.targetProjectId);
        const candidate =
          existingWorkspaces.find((workspace) => workspace.repoUrl === repoUrl) ??
          existingWorkspaces.find((workspace) => workspace.isPrimary && !workspace.repoUrl) ??
          null;

        if (candidate) {
          const updated = await projectsSvc.updateWorkspace(
            binding.targetProjectId,
            candidate.id,
            {
              repoUrl,
              repoRef: binding.repoRef,
              metadata: buildBindingMetadata(candidate.metadata, {
                integrationId: integration.id,
                binding,
                repoUrl,
              }),
            },
          );
          if (updated) {
            workspaces.push(updated);
            updatedCount += 1;
          }
          continue;
        }

        const created = await projectsSvc.createWorkspace(binding.targetProjectId, {
          repoUrl,
          repoRef: binding.repoRef,
          metadata: buildBindingMetadata(null, {
            integrationId: integration.id,
            binding,
            repoUrl,
          }),
          isPrimary: existingWorkspaces.length === 0,
        });
        if (created) {
          workspaces.push(created);
          createdCount += 1;
        }
      }

      await db
        .update(externalWorkIntegrations)
        .set({
          lastSyncedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(externalWorkIntegrations.id, integration.id));

      await logActivityFn(db, {
        companyId: integration.companyId,
        actorType: actor?.actorType ?? "system",
        actorId: actor?.actorId ?? "gitee_binding_sync",
        agentId: actor?.agentId ?? null,
        runId: actor?.runId ?? null,
        action: "external_work_integration.gitee_bindings_synced",
        entityType: "external_work_integration",
        entityId: integration.id,
        details: {
          createdCount,
          updatedCount,
          workspaceCount: workspaces.length,
          invocation: actor?.invocation ?? "manual",
        },
      });
    } catch (error) {
      await db
        .update(externalWorkIntegrations)
        .set({
          lastError: error instanceof Error ? error.message : "Gitee binding sync failed",
          updatedAt: new Date(),
        })
        .where(eq(externalWorkIntegrations.id, integration.id));
      throw error;
    }

    return {
      integrationId: integration.id,
      createdCount,
      updatedCount,
      workspaces,
    };
  }

  async function ensureWorkspaceRepo(
    integrationId: string,
    input: { workspaceId: string },
    actor?: GiteeMutationActor,
  ): Promise<GiteeWorkspacePullResult> {
    const integration = await getIntegrationById(integrationId);
    if (!integration) throw notFound("External work integration not found");
    if (integration.provider !== "gitee") {
      throw unprocessable(`Unsupported external work provider: ${integration.provider}`);
    }

    const config = await normalizeConfigForPersistence(integration.companyId, integration.config);
    const runtimeConfig = await resolveConfigForRuntime(
      integration.companyId,
      integration.config,
    );
    const workspaceRow = await getWorkspaceById(integration.companyId, input.workspaceId);
    if (!workspaceRow) throw notFound("Project workspace not found");

    const binding = selectBindingForWorkspace(config, workspaceRow);
    if (!binding) {
      throw unprocessable("No Gitee repo binding matched the target workspace");
    }
    const repoUrl = normalizeRepoUrlForClone(binding.repoUrl, binding.cloneProtocol);
    const targetDir = asString(workspaceRow.cwd) ?? deriveWorkspaceCloneDir(workspaceRow.id);
    const targetParentDir = path.dirname(targetDir);
    await fs.mkdir(targetParentDir, { recursive: true });

    const existed = await directoryExists(targetDir);
    let cloned = false;
    let pulled = false;

    await withGitExecutionContext({
      runtimeConfig,
      repoUrl,
      fetchImpl,
      work: async (env) => {
        if (!existed) {
          await runGitOrThrow(["clone", repoUrl, targetDir], targetParentDir, env);
          cloned = true;
        } else if (!(await isGitRepository(targetDir))) {
          if (!(await isDirectoryEmpty(targetDir))) {
            throw new Error(
              `Workspace directory "${targetDir}" already exists and is not a git repository`,
            );
          }
          await runGitOrThrow(["clone", repoUrl, targetDir], targetParentDir, env);
          cloned = true;
        }

        await runGitOrThrow(["remote", "set-url", "origin", repoUrl], targetDir, env);
        const branch = await ensureBranchReady(targetDir, binding.repoRef, env);
        if (!cloned) {
          if (branch) {
            await runGitOrThrow(["pull", "--ff-only", "origin", branch], targetDir, env);
          } else {
            await runGitOrThrow(["pull", "--ff-only"], targetDir, env);
          }
          pulled = true;
        }
      },
    });

    const branch = (
      await runGitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"], targetDir)
    ).trim();
    const head = await runGitOrThrow(["rev-parse", "HEAD"], targetDir);

    const updatedWorkspace =
      workspaceRow.cwd !== targetDir
        ? await projectsSvc.updateWorkspace(workspaceRow.projectId, workspaceRow.id, {
            cwd: targetDir,
            repoUrl,
            repoRef: binding.repoRef,
          })
        : await projectsSvc.updateWorkspace(workspaceRow.projectId, workspaceRow.id, {
            repoUrl,
            repoRef: binding.repoRef,
          });

    const workspace =
      updatedWorkspace ??
      ({
        id: workspaceRow.id,
        companyId: workspaceRow.companyId,
        projectId: workspaceRow.projectId,
        name: workspaceRow.name,
        cwd: targetDir,
        repoUrl,
        repoRef: binding.repoRef,
        metadata: workspaceRow.metadata ?? null,
        isPrimary: workspaceRow.isPrimary,
        createdAt: workspaceRow.createdAt,
        updatedAt: new Date(),
      } satisfies ProjectWorkspace);

    await logActivityFn(db, {
      companyId: integration.companyId,
      actorType: actor?.actorType ?? "system",
      actorId: actor?.actorId ?? "gitee_workspace_pull",
      agentId: actor?.agentId ?? null,
      runId: actor?.runId ?? null,
      action: "project_workspace.gitee_repo_prepared",
      entityType: "project_workspace",
      entityId: workspace.id,
      details: {
        repoUrl,
        repoRef: binding.repoRef,
        cwd: targetDir,
        cloned,
        pulled,
        head,
      },
    });

    return {
      workspace,
      cwd: targetDir,
      branch: branch && branch !== "HEAD" ? branch : null,
      head,
      cloned,
      pulled,
    };
  }

  async function commitAndPushWorkspace(
    integrationId: string,
    input: {
      workspaceId: string;
      message: string;
      authorName?: string | null;
      authorEmail?: string | null;
      paths?: string[];
      push?: boolean;
      cwd?: string | null;
      branch?: string | null;
    },
    actor?: GiteeMutationActor,
  ): Promise<GiteeWorkspaceCommitPushResult> {
    const prepared = await ensureWorkspaceRepo(
      integrationId,
      { workspaceId: input.workspaceId },
      actor,
    );
    const integration = await getIntegrationById(integrationId);
    if (!integration) throw notFound("External work integration not found");
    const runtimeConfig = await resolveConfigForRuntime(
      integration.companyId,
      integration.config,
    );

    let committed = false;
    let pushed = false;
    let commitSha: string | null = null;
    const targetCwd = asString(input.cwd) ?? prepared.cwd;

    await withGitExecutionContext({
      runtimeConfig,
      repoUrl: prepared.workspace.repoUrl ?? "",
      fetchImpl,
      work: async (env) => {
        if (input.paths && input.paths.length > 0) {
          await runGitOrThrow(["add", "--", ...input.paths], targetCwd, env);
        } else {
          await runGitOrThrow(["add", "--all"], targetCwd, env);
        }

        const staged = await runGit(
          ["diff", "--cached", "--quiet"],
          targetCwd,
          env,
        );
        if (staged.code === 0) {
          return;
        }

        const authorName = asString(input.authorName) ?? "Paperclip Bot";
        const authorEmail =
          asString(input.authorEmail) ?? "paperclip-bot@local.invalid";
        await runGitOrThrow(
          [
            "-c",
            `user.name=${authorName}`,
            "-c",
            `user.email=${authorEmail}`,
            "commit",
            "-m",
            input.message,
          ],
          targetCwd,
          env,
        );
        committed = true;
        commitSha = await runGitOrThrow(["rev-parse", "HEAD"], targetCwd, env);

        if (input.push !== false) {
          const branch =
            asString(input.branch) ??
            prepared.branch ??
            (await runGitOrThrow(
              ["rev-parse", "--abbrev-ref", "HEAD"],
              targetCwd,
              env,
            ));
          await runGitOrThrow(
            ["push", "origin", `HEAD:${branch}`],
            targetCwd,
            env,
          );
          pushed = true;
        }
      },
    });

    await logActivityFn(db, {
      companyId: integration.companyId,
      actorType: actor?.actorType ?? "system",
      actorId: actor?.actorId ?? "gitee_workspace_push",
      agentId: actor?.agentId ?? null,
      runId: actor?.runId ?? null,
      action: "project_workspace.gitee_repo_pushed",
      entityType: "project_workspace",
      entityId: prepared.workspace.id,
      details: {
        cwd: targetCwd,
        branch: asString(input.branch) ?? prepared.branch,
        committed,
        pushed,
        commitSha,
      },
    });

    return {
      ...prepared,
      cwd: targetCwd,
      branch: asString(input.branch) ?? prepared.branch,
      committed,
      pushed,
      commitSha,
    };
  }

  return {
    normalizeConfigForPersistence,
    resolveConfigForRuntime,
    resolveUsername: async (companyId: string, rawConfig: unknown) => {
      const runtimeConfig = await resolveConfigForRuntime(companyId, rawConfig);
      return resolveGiteeUsername(runtimeConfig, fetchImpl);
    },
    syncBindings,
    ensureWorkspaceRepo,
    commitAndPushWorkspace,
  };
}
