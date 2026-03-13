import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createSocialSignalSourceSchema,
  syncSocialSignalSourceSchema,
  updateSocialSignalSourceSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity, socialSignalSourceService } from "../services/index.js";

export function socialSignalSourceRoutes(db: Db) {
  const router = Router();
  const svc = socialSignalSourceService(db);

  router.get("/companies/:companyId/social-signal-sources", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const sources = await svc.list(companyId);
    res.json(sources);
  });

  router.post(
    "/companies/:companyId/social-signal-sources",
    validate(createSocialSignalSourceSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const source = await svc.create(companyId, {
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
        action: "social_signal_source.created",
        entityType: "social_signal_source",
        entityId: source.id,
        details: {
          provider: source.provider,
          kind: source.kind,
          enabled: source.enabled,
        },
      });
      res.status(201).json(source);
    },
  );

  router.patch(
    "/social-signal-sources/:id",
    validate(updateSocialSignalSourceSchema),
    async (req, res) => {
      assertBoard(req);
      const existing = await svc.getById(req.params.id as string);
      if (!existing) {
        res.status(404).json({ error: "Social signal source not found" });
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
        action: "social_signal_source.updated",
        entityType: "social_signal_source",
        entityId: existing.id,
        details: req.body,
      });
      res.json(updated);
    },
  );

  router.post(
    "/social-signal-sources/:id/sync",
    validate(syncSocialSignalSourceSchema),
    async (req, res) => {
      assertBoard(req);
      const existing = await svc.getById(req.params.id as string);
      if (!existing) {
        res.status(404).json({ error: "Social signal source not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const actor = getActorInfo(req);
      const result = await svc.sync(existing.id, {
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        invocation: "manual",
      });
      res.json(result);
    },
  );

  return router;
}
