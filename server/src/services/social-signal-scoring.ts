import type {
  CompanySocialSignalSource,
  SocialSignalStatus,
  SocialSignalSourceAutomation,
} from "@paperclipai/shared";
import { readConfigFile } from "../config-file.js";

export interface SocialSignalScoreInput {
  source: CompanySocialSignalSource;
  title: string;
  summary: string;
  url?: string | null;
}

export interface SocialSignalScoreResult {
  painScore: number;
  urgencyScore: number;
  monetizationScore: number;
  totalScore: number;
  status: SocialSignalStatus;
  painPoints: string | null;
}

const OPENAI_CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";

type OpenAiScorePayload = {
  painScore: number;
  urgencyScore: number;
  monetizationScore: number;
  status: SocialSignalStatus;
  painPoints: string | null;
};

const PAIN_KEYWORDS = [
  "pain",
  "painful",
  "annoying",
  "frustrating",
  "frustrated",
  "manual",
  "tedious",
  "workaround",
  "spreadsheet",
  "copy paste",
  "copy-paste",
  "repetitive",
  "broken",
  "slow",
  "waste time",
  "wasting hours",
  "error prone",
  "error-prone",
  "messy",
  "can't",
  "cannot",
  "stuck",
  "bottleneck",
];

const URGENCY_KEYWORDS = [
  "urgent",
  "asap",
  "right now",
  "immediately",
  "blocking",
  "deadline",
  "launch",
  "ship",
  "today",
  "this week",
  "every day",
  "daily",
  "constantly",
  "keep losing",
  "churn",
  "drop off",
  "drop-off",
  "hours a week",
  "hours per week",
];

const MONETIZATION_KEYWORDS = [
  "pay",
  "paid",
  "willing to pay",
  "budget",
  "expensive",
  "cost",
  "save money",
  "money",
  "revenue",
  "mrr",
  "pricing",
  "subscription",
  "b2b",
  "customer",
  "customers",
  "client",
  "clients",
  "invoice",
  "roi",
  "sell",
  "sales",
];

function normalizeText(...parts: Array<string | null | undefined>) {
  return parts
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase();
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function keywordHits(text: string, keywords: string[]) {
  const hits = new Set<string>();
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      hits.add(keyword);
    }
  }
  return hits;
}

function computePainPoints(text: string, painHits: Set<string>, urgencyHits: Set<string>) {
  const notes: string[] = [];
  if (painHits.size > 0) {
    notes.push(`发现痛点词：${Array.from(painHits).slice(0, 4).join("、")}`);
  }
  if (urgencyHits.size > 0) {
    notes.push(`发现紧迫词：${Array.from(urgencyHits).slice(0, 4).join("、")}`);
  }
  if (/\$\d+|\d+\s?(mrr|arr|customers|clients|hours)/i.test(text)) {
    notes.push("文本中出现明确的商业或工作量量化信号");
  }
  return notes.length > 0 ? notes.join("\n") : null;
}

function scoreDimension(
  base: number,
  hits: Set<string>,
  text: string,
  bonuses?: Array<{ pattern: RegExp; value: number }>,
) {
  let score = base + hits.size * 9;
  for (const bonus of bonuses ?? []) {
    if (bonus.pattern.test(text)) {
      score += bonus.value;
    }
  }
  return clampScore(score);
}

export function scoreSocialSignal(
  input: SocialSignalScoreInput,
  automation: SocialSignalSourceAutomation,
): SocialSignalScoreResult {
  const text = normalizeText(input.title, input.summary, input.url ?? null);
  const painHits = keywordHits(text, PAIN_KEYWORDS);
  const urgencyHits = keywordHits(text, URGENCY_KEYWORDS);
  const monetizationHits = keywordHits(text, MONETIZATION_KEYWORDS);

  const painScore = scoreDimension(38, painHits, text, [
    { pattern: /\bmanual\b/g, value: 8 },
    { pattern: /\bspreadsheet\b/g, value: 8 },
    { pattern: /\bcopy[ -]?paste\b/g, value: 8 },
  ]);

  const urgencyScore = scoreDimension(34, urgencyHits, text, [
    { pattern: /\bevery day\b/g, value: 10 },
    { pattern: /\bdaily\b/g, value: 8 },
    { pattern: /\bthis week\b/g, value: 8 },
    { pattern: /\blaunch\b/g, value: 6 },
  ]);

  const monetizationScore = scoreDimension(32, monetizationHits, text, [
    { pattern: /\$\d+/g, value: 10 },
    { pattern: /\bmrr\b/g, value: 12 },
    { pattern: /\bsubscription\b/g, value: 8 },
    { pattern: /\bpay(?:ing)?\b/g, value: 8 },
  ]);

  const totalScore = clampScore(
    painScore * 0.4 + urgencyScore * 0.35 + monetizationScore * 0.25,
  );

  let status: SocialSignalStatus = "reviewing";
  if (totalScore <= automation.rejectThreshold) {
    status = "rejected";
  } else if (totalScore >= automation.reviewThreshold) {
    status = "validated";
  }

  return {
    painScore,
    urgencyScore,
    monetizationScore,
    totalScore,
    status,
    painPoints: computePainPoints(text, painHits, urgencyHits),
  };
}

export function shouldAutoPromoteScoredSignal(input: {
  automation: SocialSignalSourceAutomation;
  score: SocialSignalScoreResult;
}) {
  const { automation, score } = input;
  return (
    automation.autoPromote &&
    score.status === "validated" &&
    score.totalScore >= automation.promoteThreshold &&
    score.painScore >= automation.minimumScores.pain &&
    score.urgencyScore >= automation.minimumScores.urgency &&
    score.monetizationScore >= automation.minimumScores.monetization
  );
}

function resolveOpenAiApiKey() {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;
  const config = readConfigFile();
  if (config?.llm?.provider !== "openai") return null;
  return config.llm.apiKey?.trim() || null;
}

function normalizeLlmScorePayload(payload: OpenAiScorePayload): SocialSignalScoreResult {
  return {
    painScore: clampScore(payload.painScore),
    urgencyScore: clampScore(payload.urgencyScore),
    monetizationScore: clampScore(payload.monetizationScore),
    totalScore: clampScore(
      payload.painScore * 0.4 + payload.urgencyScore * 0.35 + payload.monetizationScore * 0.25,
    ),
    status: payload.status,
    painPoints: payload.painPoints?.trim() || null,
  };
}

function extractMessageContent(payload: unknown): string | null {
  const record = payload as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };
  const content = record.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (item?.type === "text" && typeof item.text === "string" ? item.text : ""))
      .join("")
      .trim();
  }
  return null;
}

export async function scoreSocialSignalWithStrategy(
  input: SocialSignalScoreInput,
  automation: SocialSignalSourceAutomation,
  opts?: { fetchImpl?: typeof fetch },
): Promise<SocialSignalScoreResult> {
  const rulesScore = scoreSocialSignal(input, automation);
  if (automation.scoringMode !== "llm") {
    return rulesScore;
  }

  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) {
    return rulesScore;
  }

  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(OPENAI_CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: automation.llmModel ?? "gpt-5",
        messages: [
          {
            role: "system",
            content:
              "You score startup pain signals. Return strict JSON only. Be conservative. " +
              "Status must be one of reviewing, validated, rejected.",
          },
          {
            role: "user",
            content: JSON.stringify({
              source: input.source,
              title: input.title,
              summary: input.summary,
              url: input.url ?? null,
              thresholds: automation,
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "social_signal_score",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                painScore: { type: "number" },
                urgencyScore: { type: "number" },
                monetizationScore: { type: "number" },
                status: {
                  type: "string",
                  enum: ["reviewing", "validated", "rejected"],
                },
                painPoints: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                },
              },
              required: [
                "painScore",
                "urgencyScore",
                "monetizationScore",
                "status",
                "painPoints",
              ],
            },
          },
        },
      }),
    });
    if (!response.ok) {
      return rulesScore;
    }

    const payload = (await response.json()) as unknown;
    const content = extractMessageContent(payload);
    if (!content) {
      return rulesScore;
    }
    const parsed = JSON.parse(content) as OpenAiScorePayload;
    return normalizeLlmScorePayload(parsed);
  } catch {
    return rulesScore;
  }
}
