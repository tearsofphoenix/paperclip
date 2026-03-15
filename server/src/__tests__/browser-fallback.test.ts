import { describe, expect, it, vi } from "vitest";
import {
  browserBackedFetch,
  parseCookieHeader,
  parseStorageStateInput,
} from "../services/browser-fallback.js";

describe("browser fallback helper", () => {
  it("parses JSON storage state and cookie header cookies", async () => {
    await expect(
      parseStorageStateInput('{"cookies":[{"name":"sid","value":"1"}]}'),
    ).resolves.toEqual({
      cookies: [{ name: "sid", value: "1" }],
    });

    expect(
      parseCookieHeader("SID=abc; TOKEN=demo", {
        requestUrl: "https://api.tapd.cn/tasks",
        loginUrl: "https://www.tapd.cn/login",
      }),
    ).toEqual([
      {
        name: "SID",
        value: "abc",
        domain: "api.tapd.cn",
        path: "/",
        secure: true,
        httpOnly: false,
      },
      {
        name: "TOKEN",
        value: "demo",
        domain: "api.tapd.cn",
        path: "/",
        secure: true,
        httpOnly: false,
      },
      {
        name: "SID",
        value: "abc",
        domain: "www.tapd.cn",
        path: "/",
        secure: true,
        httpOnly: false,
      },
      {
        name: "TOKEN",
        value: "demo",
        domain: "www.tapd.cn",
        path: "/",
        secure: true,
        httpOnly: false,
      },
    ]);
  });

  it("uses launcher/context/page hooks to execute a browser-backed fetch", async () => {
    const goto = vi.fn(async () => undefined);
    const evaluate = vi.fn(async (_fn, input) => ({
      status: 200,
      ok: true,
      text: JSON.stringify({
        echoedUrl: input.url,
        method: input.method,
      }),
    }));
    const closePage = vi.fn(async () => undefined);
    const addCookies = vi.fn(async () => undefined);
    const closeContext = vi.fn(async () => undefined);
    const closeBrowser = vi.fn(async () => undefined);

    const launcher = {
      launch: vi.fn(async () => ({
        newContext: vi.fn(async (options?: { storageState?: string | Record<string, unknown> }) => ({
          addCookies,
          newPage: async () => ({
            goto,
            evaluate,
            close: closePage,
          }),
          close: closeContext,
          __options: options,
        })),
        close: closeBrowser,
      })),
    };

    const result = await browserBackedFetch(
      {
        url: "https://api.tapd.cn/tasks?workspace_id=workspace-1",
        method: "GET",
        headers: { Accept: "application/json" },
        browserAutomation: {
          enabled: true,
          headless: true,
          loginUrl: "https://www.tapd.cn/login",
          storageState: '{"cookies":[{"name":"sid","value":"1"}]}',
          cookieHeader: "SID=abc",
        },
      },
      { launcher },
    );

    expect(result).toEqual({
      status: 200,
      ok: true,
      text: '{"echoedUrl":"https://api.tapd.cn/tasks?workspace_id=workspace-1","method":"GET"}',
    });
    expect(launcher.launch).toHaveBeenCalledWith({ headless: true });
    expect(addCookies).toHaveBeenCalled();
    expect(goto).toHaveBeenNthCalledWith(1, "https://www.tapd.cn/login", {
      waitUntil: "domcontentloaded",
    });
    expect(goto).toHaveBeenNthCalledWith(2, "https://api.tapd.cn", {
      waitUntil: "domcontentloaded",
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });
});
