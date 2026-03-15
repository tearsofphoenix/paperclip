import fs from "node:fs/promises";

export interface BrowserAutomationRuntimeConfig {
  enabled: boolean;
  headless: boolean;
  loginUrl: string | null;
  storageState: string | null;
  cookieHeader: string | null;
}

export interface BrowserBackedFetchInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  browserAutomation: BrowserAutomationRuntimeConfig | null | undefined;
}

export interface BrowserBackedFetchResponse {
  status: number;
  ok: boolean;
  text: string;
}

type BrowserPage = {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  evaluate: <TInput, TResult>(
    pageFunction: (input: TInput) => Promise<TResult>,
    input: TInput,
  ) => Promise<TResult>;
  close: () => Promise<void>;
};

type BrowserContext = {
  addCookies: (
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      secure?: boolean;
      httpOnly?: boolean;
    }>,
  ) => Promise<void>;
  newPage: () => Promise<BrowserPage>;
  close: () => Promise<void>;
};

type BrowserInstance = {
  newContext: (options?: { storageState?: string | Record<string, unknown> }) => Promise<BrowserContext>;
  close: () => Promise<void>;
};

type BrowserLauncher = {
  launch: (options?: { headless?: boolean }) => Promise<BrowserInstance>;
};

export interface BrowserBackedFetchDeps {
  launcher?: BrowserLauncher;
  fileExists?: (value: string) => Promise<boolean>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function defaultLauncher() {
  const playwright = (await import("@playwright/test")) as {
    chromium?: BrowserLauncher;
  };
  if (!playwright.chromium) {
    throw new Error("Playwright chromium launcher is unavailable");
  }
  return playwright.chromium;
}

async function defaultFileExists(value: string) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

export async function parseStorageStateInput(
  value: string | null | undefined,
  deps?: Pick<BrowserBackedFetchDeps, "fileExists">,
) {
  const trimmed = asString(value);
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Invalid browser storageState JSON: ${error instanceof Error ? error.message : "parse failed"}`,
      );
    }
  }
  const fileExists = deps?.fileExists ?? defaultFileExists;
  if (await fileExists(trimmed)) {
    return trimmed;
  }
  throw new Error("Browser storageState must be valid JSON or an existing file path");
}

export function parseCookieHeader(
  value: string | null | undefined,
  input: { requestUrl: string; loginUrl?: string | null },
) {
  const header = asString(value);
  if (!header) return [];
  const targets = Array.from(
    new Set(
      [input.requestUrl, input.loginUrl]
        .map((entry) => {
          if (!entry) return null;
          try {
            return new URL(entry);
          } catch {
            return null;
          }
        })
        .filter((entry): entry is URL => entry !== null)
        .map((entry) => entry.hostname),
    ),
  );
  const cookiePairs = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex < 0) return null;
      return {
        name: part.slice(0, separatorIndex).trim(),
        value: part.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((entry): entry is { name: string; value: string } => Boolean(entry?.name));

  return targets.flatMap((domain) =>
    cookiePairs.map((cookie) => ({
      ...cookie,
      domain,
      path: "/",
      secure: true,
      httpOnly: false,
    })),
  );
}

async function createPreparedPage(
  input: BrowserBackedFetchInput,
  deps?: BrowserBackedFetchDeps,
) {
  const browserAutomation = input.browserAutomation;
  if (!browserAutomation?.enabled) {
    throw new Error("Browser automation is not enabled for this integration");
  }

  const launcher = deps?.launcher ?? (await defaultLauncher());
  const browser = await launcher.launch({
    headless: browserAutomation.headless !== false,
  });

  const storageState = await parseStorageStateInput(browserAutomation.storageState, deps);
  const context = await browser.newContext(storageState ? { storageState } : {});
  const cookies = parseCookieHeader(browserAutomation.cookieHeader, {
    requestUrl: input.url,
    loginUrl: browserAutomation.loginUrl,
  });
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }
  const page = await context.newPage();
  return { browser, context, page };
}

export async function browserBackedFetch(
  input: BrowserBackedFetchInput,
  deps?: BrowserBackedFetchDeps,
): Promise<BrowserBackedFetchResponse> {
  const prepared = await createPreparedPage(input, deps);
  const browserAutomation = input.browserAutomation;
  const requestOrigin = new URL(input.url).origin;
  try {
    if (browserAutomation?.loginUrl) {
      await prepared.page.goto(browserAutomation.loginUrl, {
        waitUntil: "domcontentloaded",
      });
    }
    await prepared.page.goto(requestOrigin, {
      waitUntil: "domcontentloaded",
    });
    return await prepared.page.evaluate<
      {
        url: string;
        method: string;
        headers: Record<string, string>;
        body: string | null;
      },
      BrowserBackedFetchResponse
    >(
      async (request) => {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          credentials: "include",
        });
        const text = await response.text();
        return {
          status: response.status,
          ok: response.ok,
          text,
        };
      },
      {
        url: input.url,
        method: input.method ?? "GET",
        headers: input.headers ?? {},
        body: input.body ?? null,
      },
    );
  } finally {
    await prepared.page.close().catch(() => undefined);
    await prepared.context.close().catch(() => undefined);
    await prepared.browser.close().catch(() => undefined);
  }
}
