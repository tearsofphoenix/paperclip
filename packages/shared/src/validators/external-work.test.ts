import { describe, expect, it } from "vitest";
import {
  createExternalWorkIntegrationSchema,
  externalWorkItemSchema,
} from "../index.js";

describe("external work validator", () => {
  it("parses TAPD integration config with defaults", () => {
    const parsed = createExternalWorkIntegrationSchema.parse({
      provider: "tapd",
      name: "TAPD delivery workspace",
      config: {
        kind: "tapd_openapi",
        credentials: {
          authMode: "basic",
          apiUser: {
            type: "plain",
            value: "tapd-user",
          },
          apiPassword: {
            type: "secret_ref",
            secretId: "11111111-1111-1111-1111-111111111111",
            version: "latest",
          },
        },
      },
    });

    if (parsed.provider !== "tapd") {
      throw new Error("Expected tapd integration");
    }

    expect(parsed.enabled).toBe(true);
    expect(parsed.config.apiBaseUrl).toBe("https://api.tapd.cn");
    expect(parsed.config.fallbackMode).toBe("prefer_api");
    expect(parsed.config.schedule.enabled).toBe(false);
    expect(parsed.config.projectBindings).toEqual([]);
  });

  it("parses Gitee integration config with repo binding", () => {
    const parsed = createExternalWorkIntegrationSchema.parse({
      provider: "gitee",
      name: "Gitee engineering repos",
      config: {
        kind: "gitee_openapi",
        credentials: {
          authMode: "access_token",
          accessToken: {
            type: "plain",
            value: "gitee-token",
          },
        },
        repoBindings: [
          {
            targetProjectId: "22222222-2222-2222-2222-222222222222",
            repoUrl: "https://gitee.com/paperclip/demo.git",
          },
        ],
      },
    });

    if (parsed.provider !== "gitee") {
      throw new Error("Expected gitee integration");
    }

    expect(parsed.config.cloneProtocol).toBe("https");
    expect(parsed.config.repoBindings).toHaveLength(1);
    expect(parsed.config.repoBindings[0]?.enabled).toBe(true);
  });

  it("fills external work item defaults", () => {
    const parsed = externalWorkItemSchema.parse({
      provider: "tapd",
      externalType: "bug",
      externalId: "BUG-1001",
      title: "支付回调状态错误",
    });

    expect(parsed.syncStatus).toBe("synced");
    expect(parsed.metadata).toEqual({});
  });
});
