import type {
  RedditSearchSocialSignalSourceConfig,
  RedditSubredditNewSocialSignalSourceConfig,
  SocialSignalSourceKind,
  XSocialSignalSourceConfig,
  ZeroPersonRDStage,
} from "@paperclipai/shared";
import { HttpError, unprocessable } from "../errors.js";

type ResolvedXConfig = Omit<XSocialSignalSourceConfig, "credentials"> & {
  credentials: { bearerToken: string };
};

type ResolvedRedditSubredditConfig = Omit<
  RedditSubredditNewSocialSignalSourceConfig,
  "credentials"
> & {
  credentials: { accessToken: string; userAgent: string };
};

type ResolvedRedditSearchConfig = Omit<
  RedditSearchSocialSignalSourceConfig,
  "credentials"
> & {
  credentials: { accessToken: string; userAgent: string };
};

type ResolvedSocialSignalSourceConfig =
  | ResolvedXConfig
  | ResolvedRedditSubredditConfig
  | ResolvedRedditSearchConfig;

export interface IngestedSocialSignal {
  source: "x" | "reddit";
  externalId: string;
  title: string;
  url: string | null;
  authorHandle: string | null;
  summary: string;
  targetStage: ZeroPersonRDStage | null;
  occurredAt: Date | null;
}

export interface SocialSignalIngestionResult {
  items: IngestedSocialSignal[];
  fetchedCount: number;
  cursor: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toCleanText(value: string | null | undefined, fallback: string) {
  const normalized = (value ?? "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.length > 0 ? normalized : fallback;
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function parseProviderErrorBody(body: unknown) {
  const record = asRecord(body);
  if (!record) return null;
  const detail =
    asString(record.detail) ??
    asString(record.error) ??
    asString(record.message) ??
    asString(record.title);
  return detail;
}

function providerHttpError(provider: string, status: number, body: unknown) {
  const detail = parseProviderErrorBody(body);
  const message = detail
    ? `${provider} API request failed (${status}): ${detail}`
    : `${provider} API request failed with status ${status}`;
  if (status >= 500) {
    return new HttpError(500, message);
  }
  return unprocessable(message);
}

function toDateFromUnixSeconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

function deriveXCursor(items: Array<{ id: string }>) {
  const numericIds = items
    .map((item) => {
      try {
        return BigInt(item.id);
      } catch {
        return null;
      }
    })
    .filter((value): value is bigint => value !== null);
  if (numericIds.length === 0) {
    return items[0]?.id ?? null;
  }
  return numericIds.reduce((max, value) => (value > max ? value : max)).toString();
}

function buildRedditSearchUrl(config: ResolvedRedditSearchConfig) {
  const basePath = config.subreddit
    ? `https://oauth.reddit.com/r/${encodeURIComponent(config.subreddit)}/search`
    : "https://oauth.reddit.com/search";
  const params = new URLSearchParams({
    q: config.query,
    sort: "new",
    limit: String(config.limit),
  });
  if (config.subreddit) {
    params.set("restrict_sr", "true");
  }
  return `${basePath}?${params.toString()}`;
}

export function socialIngestionService(opts?: { fetchImpl?: typeof fetch }) {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;

  async function fetchXSource(
    config: ResolvedXConfig,
    targetStage: ZeroPersonRDStage | null,
  ): Promise<SocialSignalIngestionResult> {
    const query = config.language ? `${config.query} lang:${config.language}` : config.query;
    const params = new URLSearchParams({
      query,
      max_results: String(config.maxResults),
      expansions: "author_id",
      "tweet.fields": "created_at,author_id",
      "user.fields": "username",
    });

    const response = await fetchImpl(
      `https://api.x.com/2/tweets/search/recent?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${config.credentials.bearerToken}`,
          Accept: "application/json",
        },
      },
    );
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw providerHttpError("X", response.status, body);
    }

    const record = asRecord(body);
    const tweets = asArray(record?.data);
    const users = asArray(record?.includes && asRecord(record.includes)?.users);
    const usersById = new Map<string, string>();
    for (const user of users) {
      const userRecord = asRecord(user);
      const id = asString(userRecord?.id);
      const username = asString(userRecord?.username);
      if (id && username) usersById.set(id, username);
    }

    const items: IngestedSocialSignal[] = [];
    for (const tweet of tweets) {
      const tweetRecord = asRecord(tweet);
      if (!tweetRecord) continue;
      const id = asString(tweetRecord.id);
      const text = asString(tweetRecord.text);
      if (!id || !text) continue;
      const authorId = asString(tweetRecord.author_id);
      const authorHandle = authorId ? usersById.get(authorId) ?? null : null;
      const createdAt = asString(tweetRecord.created_at);
      items.push({
        source: "x",
        externalId: id,
        title: truncateText(text, 120),
        url: authorHandle
          ? `https://x.com/${authorHandle}/status/${id}`
          : `https://x.com/i/web/status/${id}`,
        authorHandle,
        summary: toCleanText(text, "Imported from X recent search."),
        targetStage,
        occurredAt: createdAt ? new Date(createdAt) : null,
      });
    }

    return {
      items,
      fetchedCount: tweets.length,
      cursor: deriveXCursor(items.map((item) => ({ id: item.externalId }))),
    };
  }

  async function fetchRedditSource(
    config: ResolvedRedditSubredditConfig | ResolvedRedditSearchConfig,
    targetStage: ZeroPersonRDStage | null,
  ): Promise<SocialSignalIngestionResult> {
    const url =
      config.kind === "reddit_subreddit_new"
        ? `https://oauth.reddit.com/r/${encodeURIComponent(config.subreddit)}/new?limit=${config.limit}`
        : buildRedditSearchUrl(config);

    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${config.credentials.accessToken}`,
        "User-Agent": config.credentials.userAgent,
        Accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw providerHttpError("Reddit", response.status, body);
    }

    const record = asRecord(body);
    const data = asRecord(record?.data);
    const children = asArray(data?.children);

    const items: IngestedSocialSignal[] = [];
    for (const child of children) {
      const childData = asRecord(asRecord(child)?.data);
      if (!childData) continue;
      const id = asString(childData.id);
      const title = asString(childData.title);
      if (!id || !title) continue;
      const selftext = asString(childData.selftext);
      const permalink = asString(childData.permalink);
      const subreddit = asString(childData.subreddit);
      const summary = selftext
        ? `${title}\n\n${selftext}`
        : subreddit
          ? `${title}\n\nImported from r/${subreddit}.`
          : title;
      items.push({
        source: "reddit",
        externalId: id,
        title: truncateText(subreddit ? `r/${subreddit}: ${title}` : title, 120),
        url: permalink ? `https://www.reddit.com${permalink}` : null,
        authorHandle: asString(childData.author),
        summary: toCleanText(summary, title),
        targetStage,
        occurredAt: toDateFromUnixSeconds(childData.created_utc),
      });
    }

    return {
      items,
      fetchedCount: children.length,
      cursor: items[0]?.externalId ?? null,
    };
  }

  return {
    syncSource: async (input: {
      kind: SocialSignalSourceKind;
      config: ResolvedSocialSignalSourceConfig;
      targetStage: ZeroPersonRDStage | null;
    }): Promise<SocialSignalIngestionResult> => {
      if (input.kind === "x_query") {
        return fetchXSource(input.config as ResolvedXConfig, input.targetStage);
      }
      return fetchRedditSource(
        input.config as ResolvedRedditSubredditConfig | ResolvedRedditSearchConfig,
        input.targetStage,
      );
    },
  };
}
