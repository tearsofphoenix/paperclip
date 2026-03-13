import { describe, expect, it } from "vitest";
import { createSocialSignalSchema, createSocialSignalSourceSchema } from "../index.js";

describe("social signal validator", () => {
  it("fills defaults for the intake payload", () => {
    const parsed = createSocialSignalSchema.parse({
      source: "reddit",
      title: "People keep paying for manual QA help",
      summary: "Multiple founders describe the same painful launch workflow.",
    });

    expect(parsed.status).toBe("new");
    expect(parsed.autoPromote).toBe(false);
    expect(parsed.painScore).toBe(50);
  });

  it("parses X ingestion source config with secret refs", () => {
    const parsed = createSocialSignalSourceSchema.parse({
      provider: "x",
      name: "X pain radar",
      config: {
        kind: "x_query",
        query: "founder pain",
        credentials: {
          bearerToken: {
            type: "secret_ref",
            secretId: "11111111-1111-1111-1111-111111111111",
            version: "latest",
          },
        },
      },
    });

    expect(parsed.enabled).toBe(true);
    expect(parsed.config.kind).toBe("x_query");
    expect(parsed.config.automation.reviewThreshold).toBe(70);
    expect(parsed.config.automation.autoPromote).toBe(false);
    expect(parsed.config.automation.scoringMode).toBe("rules");
    expect(parsed.config.schedule.enabled).toBe(false);
  });

  it("parses Reddit search ingestion source config", () => {
    const parsed = createSocialSignalSourceSchema.parse({
      provider: "reddit",
      name: "Reddit founder search",
      config: {
        kind: "reddit_search",
        query: "annoying workflow",
        credentials: {
          accessToken: {
            type: "plain",
            value: "reddit-access-token",
          },
          userAgent: {
            type: "plain",
            value: "paperclip-test",
          },
        },
      },
    });

    expect(parsed.config.kind).toBe("reddit_search");
    if (parsed.config.kind !== "reddit_search") {
      throw new Error("Expected reddit_search config");
    }
    expect(parsed.config.limit).toBe(10);
    expect(parsed.config.automation.minimumScores.pain).toBe(65);
    expect(parsed.config.automation.llmModel).toBe("gpt-5");
  });
});
