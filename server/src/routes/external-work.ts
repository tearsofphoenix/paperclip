import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createExternalWorkIntegrationSchema,
  syncExternalWorkIntegrationSchema,
  updateExternalWorkIntegrationSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  externalWorkService,
  giteeIntegrationService,
  logActivity,
} from "../services/index.js";

export function externalWorkRoutes(db: Db) {
  const router = Router();
  const svc = externalWorkService(db);
  const gitee = giteeIntegrationService(db);

  router.get("/companies/:companyId/external-work-integrations", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const integrations = await svc.listIntegrations(companyId);
    res.json(integrations);
  });

  router.post(
    "/companies/:companyId/external-work-integrations",
    validate(createExternalWorkIntegrationSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const created = await svc.create(companyId, {
        ...req.body,
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      });
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "external_work_integration.created",
        entityType: "external_work_integration",
        entityId: created.id,
        details: {
          provider: created.provider,
          enabled: created.enabled,
          name: created.name,
        },
      });
      res.status(201).json(created);
    },
  );

  router.patch(
    "/external-work-integrations/:id",
    validate(updateExternalWorkIntegrationSchema),
    async (req, res) => {
      assertBoard(req);
      const existing = await svc.getIntegrationById(req.params.id as string);
      if (!existing) {
        res.status(404).json({ error: "External work integration not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const actor = getActorInfo(req);
      const updated = await svc.update(existing.id, req.body);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "external_work_integration.updated",
        entityType: "external_work_integration",
        entityId: existing.id,
        details: req.body,
      });
      res.json(updated);
    },
  );

  router.post(
    "/external-work-integrations/:id/sync",
    validate(syncExternalWorkIntegrationSchema),
    async (req, res) => {
      assertBoard(req);
      const existing = await svc.getIntegrationById(req.params.id as string);
      if (!existing) {
        res.status(404).json({ error: "External work integration not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const actor = getActorInfo(req);
      const syncActor = {
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        invocation: "manual" as const,
      };

      if (existing.provider === "gitee") {
        const result = await gitee.syncBindings(existing.id, syncActor);
        res.json(result);
        return;
      }

      const result = await svc.sync(existing.id, syncActor);
      res.json(result);
    },
  );

  router.get("/companies/:companyId/external-work-items", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const integrationId =
      typeof req.query.integrationId === "string" ? req.query.integrationId : undefined;
    const items = await svc.listItems(companyId, integrationId);
    res.json(items);
  });

  router.get("/external-work-items/:id/events", async (req, res) => {
    assertBoard(req);
    const item = await svc.getItemById(req.params.id as string);
    if (!item) {
      res.status(404).json({ error: "External work item not found" });
      return;
    }
    assertCompanyAccess(req, item.companyId);
    const events = await svc.listItemEvents(item.companyId, item.id);
    res.json(events);
  });

  return router;
}
