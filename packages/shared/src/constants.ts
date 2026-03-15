export const COMPANY_STATUSES = ["active", "paused", "archived"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const COMPANY_OPERATING_MODELS = [
  "general",
  "zero_person_rd",
] as const;
export type CompanyOperatingModel = (typeof COMPANY_OPERATING_MODELS)[number];

export const COMPANY_SOCIAL_SIGNAL_SOURCES = [
  "x",
  "reddit",
  "github",
  "hacker_news",
  "product_hunt",
] as const;
export type CompanySocialSignalSource =
  (typeof COMPANY_SOCIAL_SIGNAL_SOURCES)[number];

export const SOCIAL_SIGNAL_SOURCE_PROVIDERS = ["x", "reddit"] as const;
export type SocialSignalSourceProvider =
  (typeof SOCIAL_SIGNAL_SOURCE_PROVIDERS)[number];

export const SOCIAL_SIGNAL_SOURCE_KINDS = [
  "x_query",
  "reddit_subreddit_new",
  "reddit_search",
] as const;
export type SocialSignalSourceKind = (typeof SOCIAL_SIGNAL_SOURCE_KINDS)[number];

export const SOCIAL_SIGNAL_SCORING_MODES = ["rules", "llm"] as const;
export type SocialSignalScoringMode = (typeof SOCIAL_SIGNAL_SCORING_MODES)[number];

export const EXTERNAL_WORK_INTEGRATION_PROVIDERS = ["tapd", "gitee"] as const;
export type ExternalWorkIntegrationProvider =
  (typeof EXTERNAL_WORK_INTEGRATION_PROVIDERS)[number];

export const EXTERNAL_WORK_INTEGRATION_FALLBACK_MODES = [
  "api_only",
  "prefer_api",
  "browser_only",
] as const;
export type ExternalWorkIntegrationFallbackMode =
  (typeof EXTERNAL_WORK_INTEGRATION_FALLBACK_MODES)[number];

export const EXTERNAL_WORK_ITEM_TYPES = [
  "workspace",
  "project",
  "iteration",
  "story",
  "task",
  "bug",
  "repo",
  "branch",
  "commit",
] as const;
export type ExternalWorkItemType = (typeof EXTERNAL_WORK_ITEM_TYPES)[number];

export const EXTERNAL_WORK_ITEM_SYNC_STATUSES = [
  "pending",
  "synced",
  "mapped",
  "failed",
  "archived",
] as const;
export type ExternalWorkItemSyncStatus =
  (typeof EXTERNAL_WORK_ITEM_SYNC_STATUSES)[number];

export const TAPD_INTEGRATION_AUTH_MODES = ["basic", "access_token"] as const;
export type TapdIntegrationAuthMode =
  (typeof TAPD_INTEGRATION_AUTH_MODES)[number];

export const GITEE_INTEGRATION_AUTH_MODES = ["access_token", "ssh"] as const;
export type GiteeIntegrationAuthMode =
  (typeof GITEE_INTEGRATION_AUTH_MODES)[number];

export const GITEE_INTEGRATION_CLONE_PROTOCOLS = ["https", "ssh"] as const;
export type GiteeIntegrationCloneProtocol =
  (typeof GITEE_INTEGRATION_CLONE_PROTOCOLS)[number];

export const ZERO_PERSON_RD_STAGES = [
  "discover",
  "validate",
  "build",
  "launch",
  "growth",
] as const;
export type ZeroPersonRDStage = (typeof ZERO_PERSON_RD_STAGES)[number];

export const DEPLOYMENT_MODES = ["local_trusted", "authenticated"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const DEPLOYMENT_EXPOSURES = ["private", "public"] as const;
export type DeploymentExposure = (typeof DEPLOYMENT_EXPOSURES)[number];

export const AUTH_BASE_URL_MODES = ["auto", "explicit"] as const;
export type AuthBaseUrlMode = (typeof AUTH_BASE_URL_MODES)[number];

export const AGENT_STATUSES = [
  "active",
  "paused",
  "idle",
  "running",
  "error",
  "pending_approval",
  "terminated",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_ADAPTER_TYPES = [
  "process",
  "http",
  "claude_local",
  "codex_local",
  "gemini_local",
  "opencode_local",
  "pi_local",
  "cursor",
  "openclaw_gateway",
] as const;
export type AgentAdapterType = (typeof AGENT_ADAPTER_TYPES)[number];

export const AGENT_ROLES = [
  "ceo",
  "cto",
  "cmo",
  "cfo",
  "engineer",
  "designer",
  "pm",
  "qa",
  "marketer",
  "devops",
  "researcher",
  "general",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  ceo: "CEO",
  cto: "CTO",
  cmo: "CMO",
  cfo: "CFO",
  engineer: "Engineer",
  designer: "Designer",
  pm: "PM",
  qa: "QA",
  marketer: "Marketing",
  devops: "DevOps",
  researcher: "Researcher",
  general: "General",
};

export const AGENT_ICON_NAMES = [
  "bot",
  "cpu",
  "brain",
  "zap",
  "rocket",
  "code",
  "terminal",
  "shield",
  "eye",
  "search",
  "wrench",
  "hammer",
  "lightbulb",
  "sparkles",
  "star",
  "heart",
  "flame",
  "bug",
  "cog",
  "database",
  "globe",
  "lock",
  "mail",
  "message-square",
  "file-code",
  "git-branch",
  "package",
  "puzzle",
  "target",
  "wand",
  "atom",
  "circuit-board",
  "radar",
  "swords",
  "telescope",
  "microscope",
  "crown",
  "gem",
  "hexagon",
  "pentagon",
  "fingerprint",
] as const;
export type AgentIconName = (typeof AGENT_ICON_NAMES)[number];

export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const SOCIAL_SIGNAL_STATUSES = [
  "new",
  "reviewing",
  "validated",
  "rejected",
  "promoted",
] as const;
export type SocialSignalStatus = (typeof SOCIAL_SIGNAL_STATUSES)[number];

export const GOAL_LEVELS = ["company", "team", "agent", "task"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

export const GOAL_STATUSES = ["planned", "active", "achieved", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const PROJECT_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
] as const;

export const APPROVAL_TYPES = ["hire_agent", "approve_ceo_strategy"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "revision_requested",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const SECRET_PROVIDERS = [
  "local_encrypted",
  "aws_secrets_manager",
  "gcp_secret_manager",
  "vault",
] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export const STORAGE_PROVIDERS = ["local_disk", "s3"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const HEARTBEAT_INVOCATION_SOURCES = [
  "timer",
  "assignment",
  "on_demand",
  "automation",
] as const;
export type HeartbeatInvocationSource = (typeof HEARTBEAT_INVOCATION_SOURCES)[number];

export const WAKEUP_TRIGGER_DETAILS = ["manual", "ping", "callback", "system"] as const;
export type WakeupTriggerDetail = (typeof WAKEUP_TRIGGER_DETAILS)[number];

export const WAKEUP_REQUEST_STATUSES = [
  "queued",
  "deferred_issue_execution",
  "claimed",
  "coalesced",
  "skipped",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WakeupRequestStatus = (typeof WAKEUP_REQUEST_STATUSES)[number];

export const HEARTBEAT_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type HeartbeatRunStatus = (typeof HEARTBEAT_RUN_STATUSES)[number];

export const LIVE_EVENT_TYPES = [
  "heartbeat.run.queued",
  "heartbeat.run.status",
  "heartbeat.run.event",
  "heartbeat.run.log",
  "agent.status",
  "activity.logged",
] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export const PRINCIPAL_TYPES = ["user", "agent"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const MEMBERSHIP_STATUSES = ["pending", "active", "suspended"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const INSTANCE_USER_ROLES = ["instance_admin"] as const;
export type InstanceUserRole = (typeof INSTANCE_USER_ROLES)[number];

export const INVITE_TYPES = ["company_join", "bootstrap_ceo"] as const;
export type InviteType = (typeof INVITE_TYPES)[number];

export const INVITE_JOIN_TYPES = ["human", "agent", "both"] as const;
export type InviteJoinType = (typeof INVITE_JOIN_TYPES)[number];

export const JOIN_REQUEST_TYPES = ["human", "agent"] as const;
export type JoinRequestType = (typeof JOIN_REQUEST_TYPES)[number];

export const JOIN_REQUEST_STATUSES = ["pending_approval", "approved", "rejected"] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];

export const PERMISSION_KEYS = [
  "agents:create",
  "users:invite",
  "users:manage_permissions",
  "tasks:assign",
  "tasks:assign_scope",
  "joins:approve",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
