import type {
  CompanySocialSignalSource,
  SocialSignalScoringMode,
  SocialSignalStatus,
  SocialSignalSourceKind,
  SocialSignalSourceProvider,
  ZeroPersonRDStage,
} from "../constants.js";
import type { EnvBinding } from "./secrets.js";

export interface SocialSignal {
  id: string;
  companyId: string;
  source: CompanySocialSignalSource;
  status: SocialSignalStatus;
  targetStage: ZeroPersonRDStage | null;
  title: string;
  url: string | null;
  authorHandle: string | null;
  externalId: string | null;
  summary: string;
  painPoints: string | null;
  painScore: number;
  urgencyScore: number;
  monetizationScore: number;
  linkedIssueId: string | null;
  linkedProjectId: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  occurredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialSignalSummary {
  new: number;
  reviewing: number;
  validated: number;
  rejected: number;
  promoted: number;
}

export interface SocialSignalSourceAutomation {
  scoringMode: SocialSignalScoringMode;
  llmModel: string | null;
  reviewThreshold: number;
  rejectThreshold: number;
  autoPromote: boolean;
  promoteThreshold: number;
  minimumScores: {
    pain: number;
    urgency: number;
    monetization: number;
  };
}

export interface SocialSignalSourceSchedule {
  enabled: boolean;
  intervalMinutes: number;
}

export interface XSocialSignalSourceConfig {
  kind: "x_query";
  query: string;
  maxResults: number;
  language: string | null;
  schedule: SocialSignalSourceSchedule;
  automation: SocialSignalSourceAutomation;
  credentials: {
    bearerToken: EnvBinding;
  };
}

export interface RedditSocialSignalSourceConfigBase {
  limit: number;
  schedule: SocialSignalSourceSchedule;
  automation: SocialSignalSourceAutomation;
  credentials: {
    accessToken: EnvBinding;
    userAgent: EnvBinding;
  };
}

export interface RedditSubredditNewSocialSignalSourceConfig
  extends RedditSocialSignalSourceConfigBase {
  kind: "reddit_subreddit_new";
  subreddit: string;
}

export interface RedditSearchSocialSignalSourceConfig
  extends RedditSocialSignalSourceConfigBase {
  kind: "reddit_search";
  query: string;
  subreddit: string | null;
}

export type SocialSignalSourceConfig =
  | XSocialSignalSourceConfig
  | RedditSubredditNewSocialSignalSourceConfig
  | RedditSearchSocialSignalSourceConfig;

export interface SocialSignalSource {
  id: string;
  companyId: string;
  provider: SocialSignalSourceProvider;
  kind: SocialSignalSourceKind;
  name: string;
  enabled: boolean;
  targetStage: ZeroPersonRDStage | null;
  config: SocialSignalSourceConfig;
  lastCursor: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialSignalSourceSyncResult {
  source: SocialSignalSource;
  fetchedCount: number;
  insertedCount: number;
  duplicateCount: number;
  promotedCount: number;
}
