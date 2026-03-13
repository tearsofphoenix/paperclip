import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  scoreSocialSignal,
  scoreSocialSignalWithStrategy,
  shouldAutoPromoteScoredSignal,
} from "../services/social-signal-scoring.js";

const automation = {
  reviewThreshold: 60,
  rejectThreshold: 35,
  autoPromote: true,
  promoteThreshold: 65,
  minimumScores: {
    pain: 65,
    urgency: 55,
    monetization: 55,
  },
};

describe("social signal scoring", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("validates and auto-promotes strong commercial pain signals", () => {
    const score = scoreSocialSignal(
      {
        source: "reddit",
        title: "Founders will pay for a tool that removes this manual spreadsheet workflow",
        summary:
          "We waste hours every day copy-pasting launch data into spreadsheets and clients already pay for contractors to do it.",
      },
      automation,
    );

    expect(score.status).toBe("validated");
    expect(score.painScore).toBeGreaterThanOrEqual(65);
    expect(score.monetizationScore).toBeGreaterThanOrEqual(55);
    expect(shouldAutoPromoteScoredSignal({ automation, score })).toBe(true);
  });

  it("rejects weak non-commercial chatter", () => {
    const score = scoreSocialSignal(
      {
        source: "x",
        title: "Just sharing a random thought",
        summary: "Weekend reflection about product design aesthetics and remote routines.",
      },
      automation,
    );

    expect(score.status).toBe("rejected");
    expect(shouldAutoPromoteScoredSignal({ automation, score })).toBe(false);
  });

  it("uses llm scoring when configured and api key exists", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const score = await scoreSocialSignalWithStrategy(
      {
        source: "x",
        title: "Manual analytics workflow",
        summary: "Teams pay contractors to update launch spreadsheets every day.",
      },
      {
        ...automation,
        scoringMode: "llm",
      },
      {
        fetchImpl: vi.fn(async () => ({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    painScore: 88,
                    urgencyScore: 81,
                    monetizationScore: 79,
                    status: "validated",
                    painPoints: "LLM found clear paid pain.",
                  }),
                },
              },
            ],
          }),
        })) as never,
      },
    );

    expect(score.painScore).toBe(88);
    expect(score.status).toBe("validated");
  });
});
