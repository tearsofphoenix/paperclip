import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createSocialSignalSchema,
  promoteSocialSignalSchema,
  type SocialSignal,
  updateSocialSignalSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { getActorInfo, assertCompanyAccess } from "./authz.js";
import { logActivity, socialSignalAutomationService, socialSignalService } from "../services/index.js";

export function socialSignalRoutes(db: Db) {
  const router = Router();
  const svc = socialSignalService(db);
  const automation = socialSignalAutomationService(db);

  router.get("/companies/:companyId/social-signals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const signals = await svc.list(companyId);
    res.json(signals);
  });

  router.post(
    "/companies/:companyId/social-signals",
    validate(createSocialSignalSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const signal = await svc.create(companyId, {
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
        action: "social_signal.created",
        entityType: "social_signal",
        entityId: signal.id,
        details: {
          source: signal.source,
          status: signal.status,
          linkedIssueId: signal.linkedIssueId,
          linkedProjectId: signal.linkedProjectId,
        },
      });
      res.status(201).json(signal);
    },
  );

  router.patch("/social-signals/:id", validate(updateSocialSignalSchema), async (req, res) => {
    const existing = await svc.getById(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: "Social signal not found" });
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
      action: "social_signal.updated",
      entityType: "social_signal",
      entityId: existing.id,
      details: req.body,
    });
    res.json(updated);
  });

  router.post(
    "/social-signals/:id/promote",
    validate(promoteSocialSignalSchema),
    async (req, res) => {
      const existing = await svc.getById(req.params.id as string);
      if (!existing) {
        res.status(404).json({ error: "Social signal not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const actor = getActorInfo(req);
      const promoted = await svc.promote(existing.id, req.body);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "social_signal.promoted",
        entityType: "social_signal",
        entityId: existing.id,
        details: {
          targetStage: promoted.targetStage,
          linkedIssueId: promoted.linkedIssueId,
          linkedProjectId: promoted.linkedProjectId,
        },
      });
      await automation.kickoffPromotedSignalExecution(promoted as SocialSignal, {
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
      });
      res.json(promoted);
    },
  );

  return router;
}
