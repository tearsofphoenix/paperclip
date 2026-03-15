import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";

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

import { tapdIntegrationService } from "../services/tapd-integration.js";

function createTapdConfig(overrides?: Record<string, unknown>) {
  return {
    kind: "tapd_openapi",
    apiBaseUrl: "https://api.tapd.cn",
    fallbackMode: "prefer_api",
    schedule: {
      enabled: false,
      intervalMinutes: 60,
    },
    workspaceIds: ["workspace-1"],
    projectBindings: [],
    browserAutomation: {
      enabled: true,
      headless: true,
      loginUrl: "https://www.tapd.cn/login",
      storageState: {
        type: "plain",
        value: "storage-state-json",
      },
      cookieHeader: {
        type: "plain",
        value: "SESSION=demo",
      },
    },
    credentials: {
      authMode: "basic",
      apiUser: {
        type: "plain",
        value: "tapd-user",
      },
      apiPassword: {
        type: "plain",
        value: "tapd-password",
      },
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("tapd integration service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("resolves TAPD credentials and browser automation bindings for runtime", async () => {
    const service = tapdIntegrationService({} as never);

    const runtime = await service.resolveConfigForRuntime(
      "company-1",
      createTapdConfig({
        credentials: {
          authMode: "access_token",
          accessToken: {
            type: "secret_ref",
            secretId: "11111111-1111-4111-8111-111111111111",
          },
        },
      }),
    );

    expect(mockSecretService.normalizeAdapterConfigForPersistence).toHaveBeenCalledTimes(1);
    expect(mockSecretService.resolveEnvBindings).toHaveBeenCalledTimes(1);
    expect(runtime.credentials).toEqual({
      authMode: "access_token",
      accessToken: "resolved-tapd_access_token",
    });
    expect(runtime.browserAutomation?.storageState).toBe("storage-state-json");
    expect(runtime.browserAutomation?.cookieHeader).toBe("SESSION=demo");
  });

  it("lists bound workspaces through get_workspace_info", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          status: 1,
          data: {
            Workspace: {
              id: "workspace-1",
              name: "Workspace One",
              status: "active",
              owner: "alice",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 1,
          data: {
            Workspace: {
              id: "workspace-2",
              name: "Workspace Two",
              status: "archived",
              owner: "bob",
            },
          },
        }),
      );
    const service = tapdIntegrationService({} as never, { fetchImpl });

    const result = await service.listWorkspaces("company-1", createTapdConfig(), {
      workspaceIds: ["workspace-1", "workspace-2"],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0] ?? "")).toContain(
      "/workspaces/get_workspace_info?workspace_id=workspace-1",
    );
    expect(result.items.map((item) => item.id)).toEqual(["workspace-1", "workspace-2"]);
    expect(result.totalCount).toBe(2);
  });

  it("lists iterations with basic auth and forwards query parameters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 1,
        count: 1,
        data: [
          {
            Iteration: {
              id: "iteration-1",
              name: "Sprint 1",
              workspace_id: "workspace-1",
              project_id: "project-1",
              owner: "alice",
              status: "进行中",
              startdate: "2026-03-01",
              enddate: "2026-03-07",
            },
          },
        ],
      }),
    );
    const service = tapdIntegrationService({} as never, { fetchImpl });

    const result = await service.listIterations("company-1", createTapdConfig(), {
      workspaceId: "workspace-1",
      page: 2,
      limit: 20,
      filters: {
        project_id: "project-1",
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0] ?? "")).toBe(
      "https://api.tapd.cn/iterations?workspace_id=workspace-1&page=2&limit=20&project_id=project-1",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("tapd-user:tapd-password").toString("base64")}`,
      Accept: "application/json",
    });
    expect(result.items[0]).toMatchObject({
      id: "iteration-1",
      name: "Sprint 1",
      workspaceId: "workspace-1",
      projectId: "project-1",
    });
    expect(result.totalCount).toBe(1);
  });

  it.each([
    {
      label: "stories",
      invoke: (service: ReturnType<typeof tapdIntegrationService>) =>
        service.listStories("company-1", createTapdConfig(), {
          workspaceId: "workspace-1",
          filters: { iteration_id: "iteration-1" },
        }),
      path: "https://api.tapd.cn/stories?workspace_id=workspace-1&iteration_id=iteration-1",
      data: {
        Story: {
          id: "story-1",
          title: "Validate problem statement",
          workspace_id: "workspace-1",
          project_id: "project-1",
          iteration_id: "iteration-1",
          status: "open",
          owner: "alice",
        },
      },
      expectedType: "story",
    },
    {
      label: "bugs",
      invoke: (service: ReturnType<typeof tapdIntegrationService>) =>
        service.listBugs("company-1", createTapdConfig(), {
          workspaceId: "workspace-1",
          filters: { status: "open" },
        }),
      path: "https://api.tapd.cn/bugs?workspace_id=workspace-1&status=open",
      data: {
        Bug: {
          id: "bug-1",
          title: "Checkout fails on Safari",
          workspace_id: "workspace-1",
          project_id: "project-1",
          iteration_id: "iteration-1",
          status: "open",
          owner: "qa-bot",
          severity: "major",
        },
      },
      expectedType: "bug",
    },
    {
      label: "tasks",
      invoke: (service: ReturnType<typeof tapdIntegrationService>) =>
        service.listTasks("company-1", createTapdConfig(), {
          workspaceId: "workspace-1",
          filters: { owner: "dev-bot" },
        }),
      path: "https://api.tapd.cn/tasks?workspace_id=workspace-1&owner=dev-bot",
      data: {
        Task: {
          id: "task-1",
          name: "Ship landing page",
          workspace_id: "workspace-1",
          project_id: "project-1",
          iteration_id: "iteration-1",
          status: "doing",
          owner: "dev-bot",
        },
      },
      expectedType: "task",
    },
  ])("lists $label with normalized work item payload", async ({ invoke, path, data, expectedType }) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 1,
        count: 1,
        data: [data],
      }),
    );
    const service = tapdIntegrationService({} as never, { fetchImpl });

    const result = await invoke(service);

    expect(String(fetchImpl.mock.calls[0]?.[0] ?? "")).toBe(path);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.type).toBe(expectedType);
  });

  it("updates bugs through PUT writeback", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 1,
        data: {
          Bug: {
            id: "bug-1",
            title: "Fix checkout flow",
            workspace_id: "workspace-1",
            project_id: "project-1",
            status: "resolved",
            owner: "qa-bot",
          },
        },
      }),
    );
    const service = tapdIntegrationService({} as never, { fetchImpl });

    const result = await service.updateBug("company-1", createTapdConfig(), "bug-1", {
      status: "resolved",
      current_owner: "qa-bot",
    });

    expect(String(fetchImpl.mock.calls[0]?.[0] ?? "")).toBe("https://api.tapd.cn/bugs/bug-1");
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    });
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body ?? "");
    expect(body).toContain("status=resolved");
    expect(body).toContain("current_owner=qa-bot");
    expect(result.status).toBe("resolved");
  });

  it("updates tasks through PUT writeback with bearer auth", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 1,
        data: {
          Task: {
            id: "task-1",
            name: "Ship billing change",
            workspace_id: "workspace-1",
            project_id: "project-1",
            status: "done",
            owner: "dev-bot",
          },
        },
      }),
    );
    const service = tapdIntegrationService({} as never, { fetchImpl });

    await service.updateTask(
      "company-1",
      createTapdConfig({
        credentials: {
          authMode: "access_token",
          accessToken: {
            type: "plain",
            value: "tapd-access-token",
          },
        },
      }),
      "task-1",
      {
        status: "done",
      },
    );

    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer tapd-access-token",
    });
  });

  it("converts provider failures into Paperclip HTTP errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          status: 0,
          info: "invalid workspace_id",
        },
        422,
      ),
    );
    const service = tapdIntegrationService({} as never, { fetchImpl });

    await expect(
      service.listTasks(
        "company-1",
        createTapdConfig({
          fallbackMode: "api_only",
          browserAutomation: null,
        }),
        {
          workspaceId: "workspace-404",
        },
      ),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("invalid workspace_id"),
    });
  });

  it("raises a 500 HttpError when TAPD returns a server-side failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          status: 0,
          info: "temporary TAPD outage",
        },
        502,
      ),
    );
    const service = tapdIntegrationService({} as never, { fetchImpl });

    try {
      await service.listStories(
        "company-1",
        createTapdConfig({
          fallbackMode: "api_only",
          browserAutomation: null,
        }),
        {
          workspaceId: "workspace-1",
        },
      );
      throw new Error("expected TAPD provider failure");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({
        status: 500,
      });
      expect((error as Error).message).toContain("temporary TAPD outage");
    }
  });

  it("uses browser fallback directly when configured as browser_only", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    mockBrowserBackedFetch.mockResolvedValue({
      status: 200,
      ok: true,
      text: JSON.stringify({
        status: 1,
        data: [
          {
            Task: {
              id: "task-browser-1",
              name: "Captured in browser session",
              workspace_id: "workspace-1",
              project_id: "project-1",
              status: "doing",
            },
          },
        ],
      }),
    });
    const service = tapdIntegrationService({} as never, { fetchImpl });

    const result = await service.listTasks(
      "company-1",
      createTapdConfig({
        fallbackMode: "browser_only",
      }),
      {
        workspaceId: "workspace-1",
      },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockBrowserBackedFetch).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({
      id: "task-browser-1",
      type: "task",
    });
  });

  it("falls back to browser automation after API failure in prefer_api mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          status: 0,
          info: "token expired",
        },
        401,
      ),
    );
    mockBrowserBackedFetch.mockResolvedValue({
      status: 200,
      ok: true,
      text: JSON.stringify({
        status: 1,
        data: {
          Workspace: {
            id: "workspace-1",
            name: "Recovered Workspace",
            status: "active",
          },
        },
      }),
    });
    const service = tapdIntegrationService({} as never, { fetchImpl });

    const result = await service.listWorkspaces("company-1", createTapdConfig(), {
      workspaceIds: ["workspace-1"],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mockBrowserBackedFetch).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({
      id: "workspace-1",
      name: "Recovered Workspace",
    });
  });
});
