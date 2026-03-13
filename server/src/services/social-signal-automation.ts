import type { Db } from "@paperclipai/db";
import type { SocialSignal, ZeroPersonRDStage } from "@paperclipai/shared";
import { heartbeatService } from "./heartbeat.js";
import { issueService } from "./issues.js";
import { logActivity } from "./activity-log.js";

const EXECUTION_STAGES = new Set<ZeroPersonRDStage>(["launch", "growth"]);

export function socialSignalAutomationService(db: Db) {
  const issues = issueService(db);
  const heartbeat = heartbeatService(db);

  return {
    kickoffPromotedSignalExecution: async (
      signal: SocialSignal,
      actor?: {
        actorType?: "user" | "agent" | "system";
        actorId?: string | null;
        agentId?: string | null;
        runId?: string | null;
      },
    ) => {
      if (!signal.linkedIssueId || !signal.targetStage || !EXECUTION_STAGES.has(signal.targetStage)) {
        return null;
      }

      let issue = await issues.getById(signal.linkedIssueId);
      if (!issue) return null;

      if (issue.status === "backlog") {
        issue = (await issues.update(issue.id, { status: "todo" })) ?? issue;
      }

      if (issue.assigneeAgentId) {
        await heartbeat.wakeup(issue.assigneeAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "social_signal_execution_kickoff",
          payload: {
            signalId: signal.id,
            issueId: issue.id,
            stage: signal.targetStage,
          },
          requestedByActorType: actor?.actorType ?? "system",
          requestedByActorId: actor?.actorId ?? "social_signal_automation",
          contextSnapshot: {
            signalId: signal.id,
            issueId: issue.id,
            taskId: issue.id,
            stage: signal.targetStage,
            source: "social_signal.promote",
            wakeReason: "social_signal_execution_kickoff",
          },
        });
      }

      await logActivity(db, {
        companyId: signal.companyId,
        actorType: actor?.actorType ?? "system",
        actorId: actor?.actorId ?? "social_signal_automation",
        agentId: actor?.agentId ?? null,
        runId: actor?.runId ?? null,
        action: "social_signal.execution_kicked_off",
        entityType: "social_signal",
        entityId: signal.id,
        details: {
          targetStage: signal.targetStage,
          issueId: signal.linkedIssueId,
          assigneeAgentId: issue.assigneeAgentId,
          issueStatus: issue.status,
        },
      });

      return issue;
    },
  };
}
