import { z } from "zod";
import {
  COMPANY_SOCIAL_SIGNAL_SOURCES,
  SOCIAL_SIGNAL_STATUSES,
  SOCIAL_SIGNAL_SCORING_MODES,
  SOCIAL_SIGNAL_SOURCE_PROVIDERS,
  ZERO_PERSON_RD_STAGES,
} from "../constants.js";
import { envBindingSchema } from "./secret.js";

export const createSocialSignalSchema = z.object({
  source: z.enum(COMPANY_SOCIAL_SIGNAL_SOURCES),
  title: z.string().min(1),
  url: z.string().url().optional().nullable(),
  authorHandle: z.string().trim().min(1).optional().nullable(),
  externalId: z.string().trim().min(1).optional().nullable(),
  summary: z.string().min(1),
  painPoints: z.string().optional().nullable(),
  painScore: z.number().int().min(0).max(100).optional().default(50),
  urgencyScore: z.number().int().min(0).max(100).optional().default(50),
  monetizationScore: z.number().int().min(0).max(100).optional().default(50),
  status: z.enum(SOCIAL_SIGNAL_STATUSES).optional().default("new"),
  targetStage: z.enum(ZERO_PERSON_RD_STAGES).optional().nullable(),
  occurredAt: z.string().datetime().optional().nullable(),
  autoPromote: z.boolean().optional().default(false),
});

export type CreateSocialSignal = z.input<typeof createSocialSignalSchema>;

export const updateSocialSignalSchema = createSocialSignalSchema
  .omit({ autoPromote: true })
  .partial();

export type UpdateSocialSignal = z.input<typeof updateSocialSignalSchema>;

export const promoteSocialSignalSchema = z.object({
  targetStage: z.enum(ZERO_PERSON_RD_STAGES).optional(),
});

export type PromoteSocialSignal = z.input<typeof promoteSocialSignalSchema>;

export const socialSignalSourceScheduleSchema = z.object({
  enabled: z.boolean().optional().default(false),
  intervalMinutes: z.number().int().min(5).max(7 * 24 * 60).optional().default(60),
});

export const socialSignalSourceAutomationSchema = z.object({
  scoringMode: z.enum(SOCIAL_SIGNAL_SCORING_MODES).optional().default("rules"),
  llmModel: z.string().trim().min(1).optional().nullable().default("gpt-5"),
  reviewThreshold: z.number().int().min(0).max(100).optional().default(70),
  rejectThreshold: z.number().int().min(0).max(100).optional().default(35),
  autoPromote: z.boolean().optional().default(false),
  promoteThreshold: z.number().int().min(0).max(100).optional().default(82),
  minimumScores: z
    .object({
      pain: z.number().int().min(0).max(100).optional().default(65),
      urgency: z.number().int().min(0).max(100).optional().default(55),
      monetization: z.number().int().min(0).max(100).optional().default(55),
    })
    .optional()
    .default({
      pain: 65,
      urgency: 55,
      monetization: 55,
    }),
});

export const xSocialSignalSourceConfigSchema = z.object({
  kind: z.literal("x_query"),
  query: z.string().trim().min(1),
  maxResults: z.number().int().min(10).max(100).optional().default(10),
  language: z.string().trim().min(1).optional().nullable().default(null),
  schedule: socialSignalSourceScheduleSchema.optional().default({
    enabled: false,
    intervalMinutes: 60,
  }),
  automation: socialSignalSourceAutomationSchema.optional().default({
    scoringMode: "rules",
    llmModel: "gpt-5",
    reviewThreshold: 70,
    rejectThreshold: 35,
    autoPromote: false,
    promoteThreshold: 82,
    minimumScores: {
      pain: 65,
      urgency: 55,
      monetization: 55,
    },
  }),
  credentials: z.object({
    bearerToken: envBindingSchema,
  }),
});

const redditCredentialsSchema = z.object({
  accessToken: envBindingSchema,
  userAgent: envBindingSchema,
});

export const redditSubredditNewSocialSignalSourceConfigSchema = z.object({
  kind: z.literal("reddit_subreddit_new"),
  subreddit: z.string().trim().min(1),
  limit: z.number().int().min(1).max(100).optional().default(10),
  schedule: socialSignalSourceScheduleSchema.optional().default({
    enabled: false,
    intervalMinutes: 60,
  }),
  automation: socialSignalSourceAutomationSchema.optional().default({
    scoringMode: "rules",
    llmModel: "gpt-5",
    reviewThreshold: 70,
    rejectThreshold: 35,
    autoPromote: false,
    promoteThreshold: 82,
    minimumScores: {
      pain: 65,
      urgency: 55,
      monetization: 55,
    },
  }),
  credentials: redditCredentialsSchema,
});

export const redditSearchSocialSignalSourceConfigSchema = z.object({
  kind: z.literal("reddit_search"),
  query: z.string().trim().min(1),
  subreddit: z.string().trim().min(1).optional().nullable().default(null),
  limit: z.number().int().min(1).max(100).optional().default(10),
  schedule: socialSignalSourceScheduleSchema.optional().default({
    enabled: false,
    intervalMinutes: 60,
  }),
  automation: socialSignalSourceAutomationSchema.optional().default({
    scoringMode: "rules",
    llmModel: "gpt-5",
    reviewThreshold: 70,
    rejectThreshold: 35,
    autoPromote: false,
    promoteThreshold: 82,
    minimumScores: {
      pain: 65,
      urgency: 55,
      monetization: 55,
    },
  }),
  credentials: redditCredentialsSchema,
});

export const socialSignalSourceConfigSchema = z.discriminatedUnion("kind", [
  xSocialSignalSourceConfigSchema,
  redditSubredditNewSocialSignalSourceConfigSchema,
  redditSearchSocialSignalSourceConfigSchema,
]);

const socialSignalSourceBaseSchema = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean().optional().default(true),
  targetStage: z.enum(ZERO_PERSON_RD_STAGES).optional().nullable().default(null),
});

export const createSocialSignalSourceSchema = z.discriminatedUnion("provider", [
  socialSignalSourceBaseSchema.extend({
    provider: z.literal(SOCIAL_SIGNAL_SOURCE_PROVIDERS[0]),
    config: xSocialSignalSourceConfigSchema,
  }),
  socialSignalSourceBaseSchema.extend({
    provider: z.literal(SOCIAL_SIGNAL_SOURCE_PROVIDERS[1]),
    config: z.discriminatedUnion("kind", [
      redditSubredditNewSocialSignalSourceConfigSchema,
      redditSearchSocialSignalSourceConfigSchema,
    ]),
  }),
]);

export type CreateSocialSignalSource = z.input<typeof createSocialSignalSourceSchema>;

export const updateSocialSignalSourceSchema = z.object({
  name: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  targetStage: z.enum(ZERO_PERSON_RD_STAGES).optional().nullable(),
  config: socialSignalSourceConfigSchema.optional(),
});

export type UpdateSocialSignalSource = z.input<typeof updateSocialSignalSourceSchema>;

export const syncSocialSignalSourceSchema = z.object({});

export type SyncSocialSignalSource = z.input<typeof syncSocialSignalSourceSchema>;
