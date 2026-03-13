import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { socialSignalSources } from "@paperclipai/db";
import type {
  CreateSocialSignalSource,
  EnvBinding,
  RedditSearchSocialSignalSourceConfig,
  RedditSubredditNewSocialSignalSourceConfig,
  SocialSignal,
  SocialSignalSource,
  SocialSignalSourceConfig,
  SocialSignalSourceKind,
  SocialSignalSourceProvider,
  SocialSignalSourceSyncResult,
  UpdateSocialSignalSource,
  XSocialSignalSourceConfig,
  ZeroPersonRDStage,
} from "@paperclipai/shared";
import {
  redditSearchSocialSignalSourceConfigSchema,
  redditSubredditNewSocialSignalSourceConfigSchema,
  xSocialSignalSourceConfigSchema,
} from "@paperclipai/shared";
import { HttpError, conflict, notFound, unprocessable } from "../errors.js";
import { secretService } from "./secrets.js";
import { socialIngestionService } from "./social-ingestion.js";
import {
  scoreSocialSignalWithStrategy,
  shouldAutoPromoteScoredSignal,
} from "./social-signal-scoring.js";
import { socialSignalService } from "./social-signals.js";
import { socialSignalAutomationService } from "./social-signal-automation.js";
import { logActivity } from "./activity-log.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getConfigSchema(provider: SocialSignalSourceProvider, kind?: string) {
  if (provider === "x") {
    return xSocialSignalSourceConfigSchema;
  }
  if (kind === "reddit_subreddit_new") {
    return redditSubredditNewSocialSignalSourceConfigSchema;
  }
  if (kind === "reddit_search") {
    return redditSearchSocialSignalSourceConfigSchema;
  }
  return null;
}

function getConfigKind(provider: SocialSignalSourceProvider, config: SocialSignalSourceConfig) {
  if (provider === "x") return "x_query";
  return config.kind;
}

function getConfigSchedule(config: SocialSignalSourceConfig) {
  return config.schedule;
}

function toXCredentialEnv(config: XSocialSignalSourceConfig) {
  return {
    BEARER_TOKEN: config.credentials.bearerToken,
  };
}

function toRedditCredentialEnv(
  config: RedditSubredditNewSocialSignalSourceConfig | RedditSearchSocialSignalSourceConfig,
) {
  return {
    ACCESS_TOKEN: config.credentials.accessToken,
    USER_AGENT: config.credentials.userAgent,
  };
}

function extractXCredentialEnv(env: Record<string, EnvBinding>) {
  return {
    bearerToken: env.BEARER_TOKEN,
  };
}

function extractRedditCredentialEnv(env: Record<string, EnvBinding>) {
  return {
    accessToken: env.ACCESS_TOKEN,
    userAgent: env.USER_AGENT,
  };
}

type ResolvedXRuntimeConfig = Omit<XSocialSignalSourceConfig, "credentials"> & {
  credentials: { bearerToken: string };
};

type ResolvedRedditSubredditRuntimeConfig = Omit<
  RedditSubredditNewSocialSignalSourceConfig,
  "credentials"
> & {
  credentials: { accessToken: string; userAgent: string };
};

type ResolvedRedditSearchRuntimeConfig = Omit<
  RedditSearchSocialSignalSourceConfig,
  "credentials"
> & {
  credentials: { accessToken: string; userAgent: string };
};

export function socialSignalSourceService(
  db: Db,
  deps?: {
    ingestion?: ReturnType<typeof socialIngestionService>;
    signalService?: Pick<ReturnType<typeof socialSignalService>, "create" | "promote">;
    fetchImpl?: typeof fetch;
  },
) {
  const secretsSvc = secretService(db);
  const ingestion = deps?.ingestion ?? socialIngestionService();
  const automationSvc = socialSignalAutomationService(db);

  async function getById(id: string) {
    return db
      .select()
      .from(socialSignalSources)
      .where(eq(socialSignalSources.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function getByName(companyId: string, provider: SocialSignalSourceProvider, name: string) {
    return db
      .select()
      .from(socialSignalSources)
      .where(
        and(
          eq(socialSignalSources.companyId, companyId),
          eq(socialSignalSources.provider, provider),
          eq(socialSignalSources.name, name),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function normalizeConfigForPersistence(
    companyId: string,
    provider: SocialSignalSourceProvider,
    rawConfig: unknown,
  ): Promise<SocialSignalSourceConfig> {
    const inferredKind = asRecord(rawConfig)?.kind;
    const schema = getConfigSchema(
      provider,
      typeof inferredKind === "string" ? inferredKind : undefined,
    );
    if (!schema) {
      throw unprocessable("Unsupported social signal source config");
    }
    const parsed = schema.safeParse(rawConfig);
    if (!parsed.success) {
      throw unprocessable("Invalid social signal source config", parsed.error.flatten());
    }

    if (provider === "x") {
      const normalizedHolder = await secretsSvc.normalizeAdapterConfigForPersistence(
        companyId,
        { env: toXCredentialEnv(parsed.data as XSocialSignalSourceConfig) },
      );
      const env = (normalizedHolder.env ?? {}) as Record<string, EnvBinding>;
      return {
        ...(parsed.data as XSocialSignalSourceConfig),
        credentials: extractXCredentialEnv(env),
      };
    }

    const normalizedHolder = await secretsSvc.normalizeAdapterConfigForPersistence(
      companyId,
      {
        env: toRedditCredentialEnv(
          parsed.data as
            | RedditSubredditNewSocialSignalSourceConfig
            | RedditSearchSocialSignalSourceConfig,
        ),
      },
    );
    const env = (normalizedHolder.env ?? {}) as Record<string, EnvBinding>;
    return {
      ...(parsed.data as
        | RedditSubredditNewSocialSignalSourceConfig
        | RedditSearchSocialSignalSourceConfig),
      credentials: extractRedditCredentialEnv(env),
    };
  }

  async function resolveConfigForRuntime(
    companyId: string,
    provider: SocialSignalSourceProvider,
    rawConfig: unknown,
  ): Promise<
    ResolvedXRuntimeConfig | ResolvedRedditSubredditRuntimeConfig | ResolvedRedditSearchRuntimeConfig
  > {
    const config = await normalizeConfigForPersistence(companyId, provider, rawConfig);

    if (provider === "x") {
      const { env } = await secretsSvc.resolveEnvBindings(
        companyId,
        toXCredentialEnv(config as XSocialSignalSourceConfig),
      );
      return {
        ...(config as XSocialSignalSourceConfig),
        credentials: {
          bearerToken: env.BEARER_TOKEN ?? "",
        },
      };
    }

    const { env } = await secretsSvc.resolveEnvBindings(
      companyId,
      toRedditCredentialEnv(
        config as
          | RedditSubredditNewSocialSignalSourceConfig
          | RedditSearchSocialSignalSourceConfig,
      ),
    );
    return {
      ...(config as
        | RedditSubredditNewSocialSignalSourceConfig
        | RedditSearchSocialSignalSourceConfig),
      credentials: {
        accessToken: env.ACCESS_TOKEN ?? "",
        userAgent: env.USER_AGENT ?? "",
      },
    };
  }

  const api = {
    list: (companyId: string) =>
      db
        .select()
        .from(socialSignalSources)
        .where(eq(socialSignalSources.companyId, companyId))
        .orderBy(desc(socialSignalSources.createdAt)),

    getById,

    create: async (
      companyId: string,
      input: CreateSocialSignalSource & {
        createdByAgentId?: string | null;
        createdByUserId?: string | null;
      },
    ) => {
      const duplicate = await getByName(companyId, input.provider, input.name);
      if (duplicate) {
        throw conflict(`Social signal source already exists: ${input.name}`);
      }

      const normalizedConfig = await normalizeConfigForPersistence(
        companyId,
        input.provider,
        input.config,
      );

      const [created] = await db
        .insert(socialSignalSources)
        .values({
          companyId,
          provider: input.provider,
          kind: getConfigKind(input.provider, normalizedConfig),
          name: input.name,
          enabled: input.enabled ?? true,
          targetStage: input.targetStage ?? null,
          config: normalizedConfig as unknown as Record<string, unknown>,
          createdByAgentId: input.createdByAgentId ?? null,
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
      return created;
    },

    update: async (id: string, input: UpdateSocialSignalSource) => {
      const existing = await getById(id);
      if (!existing) return null;

      if (input.name && input.name !== existing.name) {
        const duplicate = await getByName(
          existing.companyId,
          existing.provider as SocialSignalSourceProvider,
          input.name,
        );
        if (duplicate && duplicate.id !== existing.id) {
          throw conflict(`Social signal source already exists: ${input.name}`);
        }
      }

      const normalizedConfig =
        input.config !== undefined
          ? await normalizeConfigForPersistence(
              existing.companyId,
              existing.provider as SocialSignalSourceProvider,
              input.config,
            )
          : (existing.config as unknown as SocialSignalSourceConfig);

      const [updated] = await db
        .update(socialSignalSources)
        .set({
          name: input.name ?? existing.name,
          enabled: input.enabled ?? existing.enabled,
          targetStage:
            input.targetStage === undefined ? existing.targetStage : input.targetStage,
          kind: getConfigKind(
            existing.provider as SocialSignalSourceProvider,
            normalizedConfig,
          ),
          config: normalizedConfig as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(socialSignalSources.id, id))
        .returning();
      return updated ?? null;
    },

    sync: async (
      id: string,
      actor?: {
        actorType?: "user" | "agent" | "system";
        actorId?: string | null;
        agentId?: string | null;
        runId?: string | null;
        invocation?: "manual" | "scheduler";
      },
    ): Promise<SocialSignalSourceSyncResult> => {
      const existing = await getById(id);
      if (!existing) throw notFound("Social signal source not found");
      const signalSvc = deps?.signalService ?? socialSignalService(db as Db);

      const runtimeConfig = await resolveConfigForRuntime(
        existing.companyId,
        existing.provider as SocialSignalSourceProvider,
        existing.config,
      );
      const persistedConfig = await normalizeConfigForPersistence(
        existing.companyId,
        existing.provider as SocialSignalSourceProvider,
        existing.config,
      );

      try {
        const ingestionResult = await ingestion.syncSource({
          kind: existing.kind as SocialSignalSourceKind,
          config: runtimeConfig,
          targetStage: (existing.targetStage as ZeroPersonRDStage | null) ?? null,
        });

        let insertedCount = 0;
        let duplicateCount = 0;
        let promotedCount = 0;

        for (const item of ingestionResult.items) {
          const score = await scoreSocialSignalWithStrategy(
            {
              source: item.source,
              title: item.title,
              summary: item.summary,
              url: item.url,
            },
            persistedConfig.automation,
            { fetchImpl: deps?.fetchImpl },
          );

          try {
            const created = await signalSvc.create(existing.companyId, {
              source: item.source,
              status: score.status,
              targetStage: existing.targetStage as ZeroPersonRDStage | null,
              title: item.title,
              url: item.url,
              authorHandle: item.authorHandle,
              externalId: item.externalId,
              summary: item.summary,
              painPoints: score.painPoints,
              painScore: score.painScore,
              urgencyScore: score.urgencyScore,
              monetizationScore: score.monetizationScore,
              occurredAt: item.occurredAt?.toISOString() ?? null,
            });
            insertedCount += 1;

            if (
              shouldAutoPromoteScoredSignal({
                automation: persistedConfig.automation,
                score,
              })
            ) {
              await signalSvc.promote(created.id, {
                targetStage: (existing.targetStage as ZeroPersonRDStage | null) ?? undefined,
              });
              const promoted = await socialSignalService(db as Db).getById(created.id);
              if (promoted) {
                await logActivity(db, {
                  companyId: existing.companyId,
                  actorType: actor?.actorType ?? "system",
                  actorId: actor?.actorId ?? "social_signal_automation",
                  agentId: actor?.agentId ?? null,
                  runId: actor?.runId ?? null,
                  action: "social_signal.auto_promoted",
                  entityType: "social_signal",
                  entityId: promoted.id,
                  details: {
                    targetStage: promoted.targetStage,
                    linkedIssueId: promoted.linkedIssueId,
                    sourceId: existing.id,
                  },
                });
                await automationSvc.kickoffPromotedSignalExecution(
                  promoted as SocialSignal,
                  actor,
                );
              }
              promotedCount += 1;
            }
          } catch (error) {
            if (error instanceof HttpError && error.status === 409) {
              duplicateCount += 1;
              continue;
            }
            throw error;
          }
        }

        const [updatedSource] = await db
          .update(socialSignalSources)
          .set({
            lastCursor: ingestionResult.cursor,
            lastSyncedAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(socialSignalSources.id, existing.id))
          .returning();

        const result = {
          source: updatedSource as unknown as SocialSignalSource,
          fetchedCount: ingestionResult.fetchedCount,
          insertedCount,
          duplicateCount,
          promotedCount,
        };

        await logActivity(db, {
          companyId: existing.companyId,
          actorType: actor?.actorType ?? "system",
          actorId: actor?.actorId ?? "social_signal_scheduler",
          agentId: actor?.agentId ?? null,
          runId: actor?.runId ?? null,
          action: "social_signal_source.synced",
          entityType: "social_signal_source",
          entityId: existing.id,
          details: {
            fetchedCount: result.fetchedCount,
            insertedCount: result.insertedCount,
            duplicateCount: result.duplicateCount,
            promotedCount: result.promotedCount,
            invocation: actor?.invocation ?? "manual",
            provider: result.source.provider,
          },
        });

        return result;
      } catch (error) {
        await db
          .update(socialSignalSources)
          .set({
            lastError: error instanceof Error ? error.message : "Sync failed",
            updatedAt: new Date(),
          })
          .where(eq(socialSignalSources.id, existing.id));
        throw error;
      }
    },

    tickScheduler: async (now = new Date()) => {
      const sources = await db
        .select()
        .from(socialSignalSources)
        .where(eq(socialSignalSources.enabled, true))
        .orderBy(desc(socialSignalSources.createdAt));

      let checked = 0;
      let synced = 0;
      let inserted = 0;
      let promoted = 0;

      for (const source of sources) {
        const config = await normalizeConfigForPersistence(
          source.companyId,
          source.provider as SocialSignalSourceProvider,
          source.config,
        );
        const schedule = getConfigSchedule(config);
        if (!schedule.enabled || schedule.intervalMinutes <= 0) continue;
        checked += 1;
        const baseline = new Date(source.lastSyncedAt ?? source.createdAt).getTime();
        const elapsedMinutes = (now.getTime() - baseline) / 60_000;
        if (elapsedMinutes < schedule.intervalMinutes) continue;

        const result = await api.sync(source.id, {
          actorType: "system",
          actorId: "social_signal_scheduler",
          invocation: "scheduler",
        });
        synced += 1;
        inserted += result.insertedCount;
        promoted += result.promotedCount;
      }

      return { checked, synced, inserted, promoted };
    },
  };

  return api;
}
