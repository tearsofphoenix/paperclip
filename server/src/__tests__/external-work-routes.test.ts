import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { externalWorkRoutes } from "../routes/external-work.js";

const mockExternalWorkService = vi.hoisted(() => ({
  listIntegrations: vi.fn(),
  create: vi.fn(),
  getIntegrationById: vi.fn(),
  update: vi.fn(),
  sync: vi.fn(),
  listItems: vi.fn(),
  getItemById: vi.fn(),
  listItemEvents: vi.fn(),
}));

const mockGiteeIntegrationService = vi.hoisted(() => ({
  syncBindings: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  externalWorkService: () => mockExternalWorkService,
  giteeIntegrationService: () => mockGiteeIntegrationService,
  logActivity: mockLogActivity,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", externalWorkRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("external work routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a TAPD external work integration for the target company", async () => {
    mockExternalWorkService.create.mockResolvedValue({
      id: "integration-1",
      companyId: "company-1",
      provider: "tapd",
      name: "TAPD Delivery",
      enabled: true,
    });

    const res = await request(createApp())
      .post("/api/companies/company-1/external-work-integrations")
      .send({
        provider: "tapd",
        name: "TAPD Delivery",
        enabled: true,
        config: {
          kind: "tapd_openapi",
          apiBaseUrl: "https://api.tapd.cn",
          fallbackMode: "prefer_api",
          schedule: {
            enabled: true,
            intervalMinutes: 60,
          },
          workspaceIds: ["workspace-1"],
          projectBindings: [],
          browserAutomation: null,
          credentials: {
            authMode: "basic",
            apiUser: { type: "plain", value: "tapd-user" },
            apiPassword: { type: "plain", value: "tapd-password" },
          },
        },
      });

    expect(res.status).toBe(201);
    expect(mockExternalWorkService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        provider: "tapd",
        createdByUserId: "user-1",
      }),
    );
    expect(mockLogActivity).toHaveBeenCalled();
  });

  it("dispatches TAPD manual sync through externalWorkService.sync", async () => {
    mockExternalWorkService.getIntegrationById.mockResolvedValue({
      id: "integration-1",
      companyId: "company-1",
      provider: "tapd",
      name: "TAPD Delivery",
    });
    mockExternalWorkService.sync.mockResolvedValue({
      integration: { id: "integration-1" },
      fetchedCount: 3,
      syncedCount: 3,
      mappedCount: 2,
      failedCount: 0,
    });

    const res = await request(createApp())
      .post("/api/external-work-integrations/integration-1/sync")
      .send({ fullSync: true, writeback: false });

    expect(res.status).toBe(200);
    expect(mockExternalWorkService.sync).toHaveBeenCalledWith(
      "integration-1",
      expect.objectContaining({
        actorType: "user",
        actorId: "user-1",
        invocation: "manual",
      }),
    );
    expect(mockGiteeIntegrationService.syncBindings).not.toHaveBeenCalled();
  });

  it("dispatches Gitee manual sync through giteeIntegrationService.syncBindings", async () => {
    mockExternalWorkService.getIntegrationById.mockResolvedValue({
      id: "integration-2",
      companyId: "company-1",
      provider: "gitee",
      name: "Gitee Delivery",
    });
    mockGiteeIntegrationService.syncBindings.mockResolvedValue({
      integrationId: "integration-2",
      createdCount: 1,
      updatedCount: 0,
      workspaces: [],
    });

    const res = await request(createApp())
      .post("/api/external-work-integrations/integration-2/sync")
      .send({ fullSync: true, writeback: false });

    expect(res.status).toBe(200);
    expect(mockGiteeIntegrationService.syncBindings).toHaveBeenCalledWith(
      "integration-2",
      expect.objectContaining({
        actorType: "user",
        actorId: "user-1",
        invocation: "manual",
      }),
    );
    expect(mockExternalWorkService.sync).not.toHaveBeenCalled();
  });

  it("loads item events and enforces company access", async () => {
    mockExternalWorkService.getItemById.mockResolvedValue({
      id: "item-1",
      companyId: "company-1",
    });
    mockExternalWorkService.listItemEvents.mockResolvedValue([
      {
        id: "event-1",
        eventType: "external_work_item.synced",
      },
    ]);

    const res = await request(createApp()).get("/api/external-work-items/item-1/events");

    expect(res.status).toBe(200);
    expect(mockExternalWorkService.listItemEvents).toHaveBeenCalledWith("company-1", "item-1");
    expect(res.body).toEqual([
      {
        id: "event-1",
        eventType: "external_work_item.synced",
      },
    ]);
  });

  it("rejects access to another company external work item", async () => {
    mockExternalWorkService.getItemById.mockResolvedValue({
      id: "item-2",
      companyId: "company-2",
    });

    const res = await request(createApp()).get("/api/external-work-items/item-2/events");

    expect(res.status).toBe(403);
    expect(mockExternalWorkService.listItemEvents).not.toHaveBeenCalled();
  });
});
