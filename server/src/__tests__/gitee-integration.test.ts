import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { externalWorkIntegrations, projectWorkspaces } from "@paperclipai/db";

const execFileAsync = promisify(execFile);
let workspaceSequence = 0;
const ORIGINAL_PAPERCLIP_HOME = process.env.PAPERCLIP_HOME;
let activePaperclipHome: string | null = null;

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(
    async (_companyId: string, holder: { env: Record<string, unknown> }) => holder,
  ),
  resolveEnvBindings: vi.fn(async (_companyId: string, env: Record<string, unknown>) => ({
    env: Object.fromEntries(
      Object.entries(env).map(([key, value]) => [
        key,
        typeof value === "string"
          ? value
          : typeof value === "object" &&
              value !== null &&
              "type" in value &&
              (value as { type?: unknown }).type === "plain"
            ? String((value as { value?: unknown }).value ?? "")
            : `resolved-${key.toLowerCase()}`,
      ]),
    ),
    secretKeys: new Set<string>(),
  })),
}));

const mockBrowserBackedFetch = vi.hoisted(() => vi.fn());

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

vi.mock("../services/browser-fallback.js", async () => {
  const actual = await vi.importActual("../services/browser-fallback.js");
  return {
    ...actual,
    browserBackedFetch: mockBrowserBackedFetch,
  };
});

import { giteeIntegrationService } from "../services/gitee-integration.js";

async function runGit(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}

async function createBareRemoteRepo() {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-gitee-remote-"));
  const remoteDir = path.join(baseDir, "remote.git");
  await fs.mkdir(remoteDir, { recursive: true });
  await runGit(baseDir, ["init", "--bare", remoteDir]);

  const sourceDir = path.join(baseDir, "source");
  await fs.mkdir(sourceDir, { recursive: true });
  await runGit(sourceDir, ["init"]);
  await runGit(sourceDir, ["config", "user.email", "paperclip@example.com"]);
  await runGit(sourceDir, ["config", "user.name", "Paperclip Test"]);
  await fs.writeFile(path.join(sourceDir, "README.md"), "hello\n", "utf8");
  await runGit(sourceDir, ["add", "README.md"]);
  await runGit(sourceDir, ["commit", "-m", "Initial commit"]);
  await runGit(sourceDir, ["branch", "-M", "main"]);
  await runGit(sourceDir, ["remote", "add", "origin", `file://${remoteDir}`]);
  await runGit(sourceDir, ["push", "-u", "origin", "main"]);

  return {
    baseDir,
    remoteDir,
    sourceDir,
    remoteUrl: `file://${remoteDir}`,
  };
}

function createIntegrationRow(remoteUrl: string) {
  return {
    id: "integration-1",
    companyId: "company-1",
    provider: "gitee",
    name: "Gitee Repo Sync",
    enabled: true,
    config: {
      kind: "gitee_openapi",
      apiBaseUrl: "https://gitee.com/api/v5",
      fallbackMode: "prefer_api",
      cloneProtocol: "https",
      repoBindings: [
        {
          targetProjectId: "11111111-1111-4111-8111-111111111111",
          targetWorkspaceId: null,
          repoUrl: remoteUrl,
          repoRef: "main",
          cloneProtocol: "https",
          enabled: true,
        },
      ],
      browserAutomation: null,
      credentials: {
        authMode: "access_token",
        accessToken: {
          type: "plain",
          value: "gitee-token",
        },
      },
    },
    lastCursor: null,
    lastSyncedAt: null,
    lastWritebackAt: null,
    lastError: null,
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdAt: new Date("2026-03-15T05:00:00Z"),
    updatedAt: new Date("2026-03-15T05:00:00Z"),
  };
}

function createWorkspaceStore() {
  workspaceSequence += 1;
  const workspaceId = `22222222-2222-4222-8222-${String(workspaceSequence).padStart(12, "0")}`;
  const workspaces: Array<{
    id: string;
    companyId: string;
    projectId: string;
    name: string;
    cwd: string | null;
    repoUrl: string | null;
    repoRef: string | null;
    metadata: Record<string, unknown> | null;
    isPrimary: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  return {
    workspaces,
    service: {
      async listWorkspaces(projectId: string) {
        return workspaces.filter((workspace) => workspace.projectId === projectId);
      },
      async createWorkspace(
        projectId: string,
        data: {
          repoUrl?: string | null;
          repoRef?: string | null;
          metadata?: Record<string, unknown> | null;
          isPrimary?: boolean;
        },
      ) {
        const row = {
          id: workspaceId,
          companyId: "company-1",
          projectId,
          name: "remote",
          cwd: null,
          repoUrl: data.repoUrl ?? null,
          repoRef: data.repoRef ?? null,
          metadata: data.metadata ?? null,
          isPrimary: data.isPrimary ?? true,
          createdAt: new Date("2026-03-15T05:10:00Z"),
          updatedAt: new Date("2026-03-15T05:10:00Z"),
        };
        workspaces.push(row);
        return row;
      },
      async updateWorkspace(
        projectId: string,
        workspaceId: string,
        data: {
          cwd?: string | null;
          repoUrl?: string | null;
          repoRef?: string | null;
          metadata?: Record<string, unknown> | null;
        },
      ) {
        const workspace = workspaces.find(
          (item) => item.projectId === projectId && item.id === workspaceId,
        );
        if (!workspace) return null;
        if (data.cwd !== undefined) workspace.cwd = data.cwd;
        if (data.repoUrl !== undefined) workspace.repoUrl = data.repoUrl;
        if (data.repoRef !== undefined) workspace.repoRef = data.repoRef;
        if (data.metadata !== undefined) workspace.metadata = data.metadata;
        workspace.updatedAt = new Date("2026-03-15T05:20:00Z");
        return workspace;
      },
    },
  };
}

function createFakeDb(integrationRow: ReturnType<typeof createIntegrationRow>, workspaceStore: ReturnType<typeof createWorkspaceStore>) {
  const activityEntries: Array<Record<string, unknown>> = [];
  return {
    select() {
      return {
        from(table: unknown) {
          const rows =
            table === externalWorkIntegrations
              ? [integrationRow]
              : table === projectWorkspaces
                ? workspaceStore.workspaces
                : [];
          const chain = {
            where() {
              return chain;
            },
            then<TResult1 = typeof rows, TResult2 = never>(
              onfulfilled?:
                | ((value: typeof rows) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return Promise.resolve(rows).then(onfulfilled, onrejected);
            },
          };
          return chain;
        },
      };
    },
    insert() {
      return {
        values(values: Record<string, unknown>) {
          activityEntries.push(values);
          return Promise.resolve([{ id: `activity-${activityEntries.length}` }]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where: () => {
              if (table === externalWorkIntegrations) {
                Object.assign(integrationRow, values);
                return {
                  returning: async () => [integrationRow],
                };
              }
              return {
                returning: async () => [],
              };
            },
          };
        },
      };
    },
    __integration: integrationRow,
    __activityEntries: activityEntries,
  } as unknown as Db & {
    __integration: ReturnType<typeof createIntegrationRow>;
    __activityEntries: Array<Record<string, unknown>>;
  };
}

describe("gitee integration service", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    activePaperclipHome = await fs.mkdtemp(
      path.join(os.tmpdir(), "paperclip-gitee-home-"),
    );
    process.env.PAPERCLIP_HOME = activePaperclipHome;
    mockSecretService.normalizeAdapterConfigForPersistence.mockImplementation(
      async (_companyId: string, holder: { env: Record<string, unknown> }) => holder,
    );
    mockSecretService.resolveEnvBindings.mockImplementation(
      async (_companyId: string, env: Record<string, unknown>) => ({
        env: Object.fromEntries(
          Object.entries(env).map(([key, value]) => [
            key,
            typeof value === "string"
              ? value
              : typeof value === "object" &&
                  value !== null &&
                  "type" in value &&
                  (value as { type?: unknown }).type === "plain"
                ? String((value as { value?: unknown }).value ?? "")
                : `resolved-${key.toLowerCase()}`,
          ]),
        ),
        secretKeys: new Set<string>(),
      }),
    );
    mockBrowserBackedFetch.mockReset();
  });

  afterEach(async () => {
    if (activePaperclipHome) {
      await fs.rm(activePaperclipHome, { recursive: true, force: true }).catch(() => undefined);
    }
    activePaperclipHome = null;
    if (ORIGINAL_PAPERCLIP_HOME === undefined) {
      delete process.env.PAPERCLIP_HOME;
    } else {
      process.env.PAPERCLIP_HOME = ORIGINAL_PAPERCLIP_HOME;
    }
  });

  it("resolves access-token runtime config and browser automation bindings", async () => {
    const integrationRow = createIntegrationRow("https://gitee.com/demo/repo.git");
    const workspaceStore = createWorkspaceStore();
    const db = createFakeDb(integrationRow, workspaceStore);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          login: "paperclip-user",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const service = giteeIntegrationService(db, {
      fetchImpl,
      projects: workspaceStore.service as never,
    });

    const runtime = await service.resolveConfigForRuntime("company-1", {
      ...integrationRow.config,
      browserAutomation: {
        enabled: true,
        headless: true,
        loginUrl: "https://gitee.com/login",
        storageState: {
          type: "plain",
          value: "storage",
        },
        cookieHeader: {
          type: "plain",
          value: "cookie",
        },
      },
    });

    expect(runtime.credentials).toEqual({
      authMode: "access_token",
      accessToken: "gitee-token",
    });
    expect(runtime.browserAutomation?.storageState).toBe("storage");
    expect(runtime.browserAutomation?.cookieHeader).toBe("cookie");
    const syncResult = await service.syncBindings("integration-1");
    expect(syncResult.createdCount).toBe(1);
    expect(workspaceStore.workspaces[0]?.repoUrl).toBe("https://gitee.com/demo/repo.git");
    expect(db.__integration.lastSyncedAt).toBeInstanceOf(Date);
    expect(db.__integration.lastError).toBeNull();
  });

  it("falls back to browser-backed username resolution when API auth fails", async () => {
    const integrationRow = createIntegrationRow("https://gitee.com/demo/repo.git");
    const workspaceStore = createWorkspaceStore();
    const db = createFakeDb(integrationRow, workspaceStore);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    mockBrowserBackedFetch.mockResolvedValue({
      status: 200,
      ok: true,
      text: JSON.stringify({
        login: "browser-session-user",
      }),
    });
    const service = giteeIntegrationService(db, {
      fetchImpl,
      projects: workspaceStore.service as never,
    });

    const username = await service.resolveUsername("company-1", {
      ...integrationRow.config,
      browserAutomation: {
        enabled: true,
        headless: true,
        loginUrl: "https://gitee.com/login",
        storageState: {
          type: "plain",
          value: '{"cookies":[]}',
        },
        cookieHeader: {
          type: "plain",
          value: "gitee_session=demo",
        },
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mockBrowserBackedFetch).toHaveBeenCalledTimes(1);
    expect(username).toBe("browser-session-user");
  });

  it("clones, pulls, commits, and pushes through the existing project workspace model", async () => {
    const remote = await createBareRemoteRepo();
    const integrationRow = createIntegrationRow(remote.remoteUrl);
    const workspaceStore = createWorkspaceStore();
    const db = createFakeDb(integrationRow, workspaceStore);
    const service = giteeIntegrationService(db, {
      projects: workspaceStore.service as never,
    });

    const syncResult = await service.syncBindings("integration-1");
    const workspaceId = syncResult.workspaces[0]?.id;
    expect(workspaceId).toBeTruthy();

    const firstPull = await service.ensureWorkspaceRepo("integration-1", {
      workspaceId: workspaceId!,
    });
    expect(firstPull.cloned).toBe(true);
    expect(firstPull.branch).toBe("main");
    await expect(fs.readFile(path.join(firstPull.cwd, "README.md"), "utf8")).resolves.toBe(
      "hello\n",
    );

    await fs.writeFile(path.join(remote.sourceDir, "CHANGELOG.md"), "v1\n", "utf8");
    await runGit(remote.sourceDir, ["add", "CHANGELOG.md"]);
    await runGit(remote.sourceDir, ["commit", "-m", "Add changelog"]);
    await runGit(remote.sourceDir, ["push", "origin", "main"]);

    const secondPull = await service.ensureWorkspaceRepo("integration-1", {
      workspaceId: workspaceId!,
    });
    expect(secondPull.pulled).toBe(true);
    await expect(
      fs.readFile(path.join(secondPull.cwd, "CHANGELOG.md"), "utf8"),
    ).resolves.toBe("v1\n");

    await fs.writeFile(path.join(secondPull.cwd, "README.md"), "hello world\n", "utf8");
    const pushed = await service.commitAndPushWorkspace("integration-1", {
      workspaceId: workspaceId!,
      message: "Update readme",
      authorName: "Paperclip Bot",
      authorEmail: "paperclip@example.com",
    });

    expect(pushed.committed).toBe(true);
    expect(pushed.pushed).toBe(true);
    expect(pushed.commitSha).toBeTruthy();

    const verifyDir = path.join(remote.baseDir, "verify");
    await runGit(remote.baseDir, ["clone", remote.remoteUrl, verifyDir]);
    await runGit(verifyDir, ["checkout", "main"]);
    await expect(fs.readFile(path.join(verifyDir, "README.md"), "utf8")).resolves.toBe(
      "hello world\n",
    );
  });

  it("skips commit/push when there are no staged changes", async () => {
    const remote = await createBareRemoteRepo();
    const integrationRow = createIntegrationRow(remote.remoteUrl);
    const workspaceStore = createWorkspaceStore();
    const db = createFakeDb(integrationRow, workspaceStore);
    const service = giteeIntegrationService(db, {
      projects: workspaceStore.service as never,
    });

    const syncResult = await service.syncBindings("integration-1");
    const workspaceId = syncResult.workspaces[0]?.id!;
    await service.ensureWorkspaceRepo("integration-1", { workspaceId });

    const result = await service.commitAndPushWorkspace("integration-1", {
      workspaceId,
      message: "No-op commit",
    });

    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.commitSha).toBeNull();
  });

  it("can commit and push from a git worktree path instead of the primary repo root", async () => {
    const remote = await createBareRemoteRepo();
    const integrationRow = createIntegrationRow(remote.remoteUrl);
    const workspaceStore = createWorkspaceStore();
    const db = createFakeDb(integrationRow, workspaceStore);
    const service = giteeIntegrationService(db, {
      projects: workspaceStore.service as never,
    });

    const syncResult = await service.syncBindings("integration-1");
    const workspaceId = syncResult.workspaces[0]?.id!;
    const prepared = await service.ensureWorkspaceRepo("integration-1", { workspaceId });
    const worktreePath = path.join(prepared.cwd, ".paperclip", "worktrees", "delivery-pc-1");
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    await runGit(prepared.cwd, ["worktree", "add", "-B", "delivery-pc-1", worktreePath, "main"]);

    await fs.writeFile(path.join(worktreePath, "README.md"), "from worktree\n", "utf8");
    const result = await service.commitAndPushWorkspace("integration-1", {
      workspaceId,
      message: "Worktree delivery commit",
      cwd: worktreePath,
      branch: "delivery-pc-1",
    });

    expect(result.cwd).toBe(worktreePath);
    expect(result.branch).toBe("delivery-pc-1");
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);

    const verifyDir = path.join(remote.baseDir, "verify-worktree");
    await runGit(remote.baseDir, ["clone", remote.remoteUrl, verifyDir]);
    await runGit(verifyDir, ["checkout", "delivery-pc-1"]);
    await expect(fs.readFile(path.join(verifyDir, "README.md"), "utf8")).resolves.toBe(
      "from worktree\n",
    );
  });
});
