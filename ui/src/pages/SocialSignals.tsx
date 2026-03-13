import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompanySecret,
  CompanySocialSignalSource,
  CreateSocialSignalSource,
  EnvBinding,
  SocialSignalSourceProvider,
  ZeroPersonRDStage,
} from "@paperclipai/shared";
import {
  COMPANY_SOCIAL_SIGNAL_SOURCES,
  SOCIAL_SIGNAL_SOURCE_PROVIDERS,
} from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { socialSignalsApi } from "../api/socialSignals";
import { secretsApi } from "../api/secrets";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUpRight, Link2, RefreshCw, Search, Sparkles } from "lucide-react";

const stageOptions: ZeroPersonRDStage[] = [
  "discover",
  "validate",
  "build",
  "launch",
  "growth",
];

type BindingDraft = {
  mode: "plain" | "secret";
  plainValue: string;
  secretId: string;
};

function pretty(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function createEmptyBindingDraft(): BindingDraft {
  return {
    mode: "plain",
    plainValue: "",
    secretId: "",
  };
}

function toBinding(draft: BindingDraft): EnvBinding | null {
  if (draft.mode === "secret") {
    if (!draft.secretId) return null;
    return {
      type: "secret_ref",
      secretId: draft.secretId,
      version: "latest",
    };
  }
  if (!draft.plainValue.trim()) return null;
  return {
    type: "plain",
    value: draft.plainValue,
  };
}

function CredentialField({
  label,
  draft,
  secrets,
  onChange,
  plainPlaceholder,
}: {
  label: string;
  draft: BindingDraft;
  secrets: CompanySecret[];
  onChange: (next: BindingDraft) => void;
  plainPlaceholder: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted-foreground">{label}</label>
      <div className="grid gap-2 md:grid-cols-[140px,1fr]">
        <Select
          value={draft.mode}
          onValueChange={(value) =>
            onChange({
              ...draft,
              mode: value === "secret" ? "secret" : "plain",
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plain">Plain</SelectItem>
            <SelectItem value="secret">Secret</SelectItem>
          </SelectContent>
        </Select>

        {draft.mode === "secret" ? (
          <Select
            value={draft.secretId}
            onValueChange={(value) => onChange({ ...draft, secretId: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select secret" />
            </SelectTrigger>
            <SelectContent>
              {secrets.map((secret) => (
                <SelectItem key={secret.id} value={secret.id}>
                  {secret.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={draft.plainValue}
            onChange={(event) => onChange({ ...draft, plainValue: event.target.value })}
            placeholder={plainPlaceholder}
          />
        )}
      </div>
    </div>
  );
}

export function SocialSignals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [source, setSource] = useState<CompanySocialSignalSource>("x");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [targetStage, setTargetStage] = useState<ZeroPersonRDStage>("discover");

  const [sourceProvider, setSourceProvider] = useState<SocialSignalSourceProvider>("x");
  const [sourceName, setSourceName] = useState("");
  const [sourceStage, setSourceStage] = useState<ZeroPersonRDStage>("discover");
  const [xQuery, setXQuery] = useState("");
  const [xLanguage, setXLanguage] = useState("");
  const [xMaxResults, setXMaxResults] = useState("10");
  const [xBearerToken, setXBearerToken] = useState<BindingDraft>(createEmptyBindingDraft);
  const [reviewThreshold, setReviewThreshold] = useState("70");
  const [rejectThreshold, setRejectThreshold] = useState("35");
  const [autoPromote, setAutoPromote] = useState(false);
  const [promoteThreshold, setPromoteThreshold] = useState("82");
  const [minimumPainScore, setMinimumPainScore] = useState("65");
  const [minimumUrgencyScore, setMinimumUrgencyScore] = useState("55");
  const [minimumMonetizationScore, setMinimumMonetizationScore] = useState("55");
  const [scoringMode, setScoringMode] = useState<"rules" | "llm">("rules");
  const [llmModel, setLlmModel] = useState("gpt-5");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState("60");
  const [redditKind, setRedditKind] = useState<"reddit_subreddit_new" | "reddit_search">(
    "reddit_subreddit_new",
  );
  const [redditSubreddit, setRedditSubreddit] = useState("");
  const [redditQuery, setRedditQuery] = useState("");
  const [redditLimit, setRedditLimit] = useState("10");
  const [redditAccessToken, setRedditAccessToken] = useState<BindingDraft>(
    createEmptyBindingDraft,
  );
  const [redditUserAgent, setRedditUserAgent] = useState<BindingDraft>(createEmptyBindingDraft);

  useEffect(() => {
    setBreadcrumbs([{ label: "Signals" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.socialSignals.list(selectedCompanyId)
      : ["social-signals", "none"],
    queryFn: () => socialSignalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const sourcesQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.socialSignals.sources(selectedCompanyId)
      : ["social-signal-sources", "none"],
    queryFn: () => socialSignalsApi.listSources(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const secretsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.secrets.list(selectedCompanyId) : ["secrets", "none"],
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      socialSignalsApi.create(selectedCompanyId!, {
        source,
        title: title.trim(),
        url: url.trim() || null,
        summary: summary.trim(),
        targetStage,
        autoPromote: true,
      }),
    onSuccess: () => {
      setTitle("");
      setUrl("");
      setSummary("");
      queryClient.invalidateQueries({ queryKey: queryKeys.socialSignals.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId!) });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: ZeroPersonRDStage }) =>
      socialSignalsApi.promote(id, { targetStage: stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.socialSignals.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId!) });
    },
  });

  const createSourceMutation = useMutation({
    mutationFn: (payload: CreateSocialSignalSource) =>
      socialSignalsApi.createSource(selectedCompanyId!, payload),
    onSuccess: () => {
      setSourceName("");
      setXQuery("");
      setXLanguage("");
      setXMaxResults("10");
      setXBearerToken(createEmptyBindingDraft());
      setReviewThreshold("70");
      setRejectThreshold("35");
      setAutoPromote(false);
      setPromoteThreshold("82");
      setMinimumPainScore("65");
      setMinimumUrgencyScore("55");
      setMinimumMonetizationScore("55");
      setScoringMode("rules");
      setLlmModel("gpt-5");
      setScheduleEnabled(false);
      setScheduleIntervalMinutes("60");
      setRedditKind("reddit_subreddit_new");
      setRedditSubreddit("");
      setRedditQuery("");
      setRedditLimit("10");
      setRedditAccessToken(createEmptyBindingDraft());
      setRedditUserAgent(createEmptyBindingDraft());
      queryClient.invalidateQueries({ queryKey: queryKeys.socialSignals.sources(selectedCompanyId!) });
    },
  });

  const syncSourceMutation = useMutation({
    mutationFn: (id: string) => socialSignalsApi.syncSource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.socialSignals.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.socialSignals.sources(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId!) });
    },
  });

  const groupedCounts = useMemo(() => {
    const counts = { new: 0, reviewing: 0, validated: 0, rejected: 0, promoted: 0 };
    for (const signal of data ?? []) {
      if (signal.status in counts) {
        counts[signal.status as keyof typeof counts] += 1;
      }
    }
    return counts;
  }, [data]);

  const canCreateXSource =
    !!sourceName.trim() &&
    !!xQuery.trim() &&
    !!toBinding(xBearerToken) &&
    !createSourceMutation.isPending;
  const canCreateRedditSource =
    !!sourceName.trim() &&
    !!toBinding(redditAccessToken) &&
    !!toBinding(redditUserAgent) &&
    (redditKind === "reddit_subreddit_new" ? !!redditSubreddit.trim() : !!redditQuery.trim()) &&
    !createSourceMutation.isPending;

  function buildAutomationConfig() {
    return {
      reviewThreshold: Number(reviewThreshold) || 70,
      rejectThreshold: Number(rejectThreshold) || 35,
      scoringMode,
      llmModel: llmModel.trim() || "gpt-5",
      autoPromote,
      promoteThreshold: Number(promoteThreshold) || 82,
      minimumScores: {
        pain: Number(minimumPainScore) || 65,
        urgency: Number(minimumUrgencyScore) || 55,
        monetization: Number(minimumMonetizationScore) || 55,
      },
    };
  }

  async function handleCreateSource() {
    if (!selectedCompanyId) return;

    if (sourceProvider === "x") {
      const bearerToken = toBinding(xBearerToken);
      if (!bearerToken) return;
      await createSourceMutation.mutateAsync({
        provider: "x",
        name: sourceName.trim(),
        targetStage: sourceStage,
        config: {
          kind: "x_query",
          query: xQuery.trim(),
          maxResults: Number(xMaxResults) || 10,
          language: xLanguage.trim() || null,
          schedule: {
            enabled: scheduleEnabled,
            intervalMinutes: Number(scheduleIntervalMinutes) || 60,
          },
          automation: buildAutomationConfig(),
          credentials: {
            bearerToken,
          },
        },
      });
      return;
    }

    const accessToken = toBinding(redditAccessToken);
    const userAgent = toBinding(redditUserAgent);
    if (!accessToken || !userAgent) return;

    if (redditKind === "reddit_subreddit_new") {
      await createSourceMutation.mutateAsync({
        provider: "reddit",
        name: sourceName.trim(),
        targetStage: sourceStage,
        config: {
          kind: "reddit_subreddit_new",
          subreddit: redditSubreddit.trim(),
          limit: Number(redditLimit) || 10,
          schedule: {
            enabled: scheduleEnabled,
            intervalMinutes: Number(scheduleIntervalMinutes) || 60,
          },
          automation: buildAutomationConfig(),
          credentials: {
            accessToken,
            userAgent,
          },
        },
      });
      return;
    }

    await createSourceMutation.mutateAsync({
      provider: "reddit",
      name: sourceName.trim(),
      targetStage: sourceStage,
      config: {
        kind: "reddit_search",
        query: redditQuery.trim(),
        subreddit: redditSubreddit.trim() || null,
        limit: Number(redditLimit) || 10,
        schedule: {
          enabled: scheduleEnabled,
          intervalMinutes: Number(scheduleIntervalMinutes) || 60,
        },
        automation: buildAutomationConfig(),
        credentials: {
          accessToken,
          userAgent,
        },
      },
    });
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={Search} message="Select a company to manage social signals." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <Tabs defaultValue="manual" className="space-y-4">
        <TabsList variant="line">
          <TabsTrigger value="manual">Manual Capture</TabsTrigger>
          <TabsTrigger value="sources">Ingestion Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="manual" className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div>
              <h2 className="text-base font-semibold">Capture a new social signal</h2>
              <p className="text-sm text-muted-foreground">
                Add a high-signal post or thread and auto-route it into your zero-person execution funnel.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-1">
                <label className="mb-1 block text-xs text-muted-foreground">Source</label>
                <Select value={source} onValueChange={(value) => setSource(value as CompanySocialSignalSource)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_SOCIAL_SIGNAL_SOURCES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {pretty(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3">
                <label className="mb-1 block text-xs text-muted-foreground">Signal title</label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Painful workflow users keep complaining about"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-muted-foreground">Post URL (optional)</label>
                <Input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://x.com/... or https://reddit.com/..."
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-muted-foreground">Auto-route stage</label>
                <Select value={targetStage} onValueChange={(value) => setTargetStage(value as ZeroPersonRDStage)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stageOptions.map((item) => (
                      <SelectItem key={item} value={item}>
                        {pretty(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">What makes this commercially interesting?</label>
              <Textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="Summarize the pain, urgency, current workaround, and why someone may pay for a fix."
                className="min-h-[120px]"
              />
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!title.trim() || !summary.trim() || createMutation.isPending}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {createMutation.isPending ? "Capturing..." : "Capture & Route"}
              </Button>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-5">
            {Object.entries(groupedCounts).map(([key, value]) => (
              <div key={key} className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{pretty(key)}</p>
                <p className="mt-1 text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {(data ?? []).length === 0 ? (
              <EmptyState icon={Search} message="No social signals yet. Capture your first one above." />
            ) : (
              (data ?? []).map((signal) => (
                <div key={signal.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {pretty(signal.source)}
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                          {pretty(signal.status)}
                        </span>
                        {signal.targetStage && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                            {pretty(signal.targetStage)}
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-semibold">{signal.title}</h3>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{signal.summary}</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                          Pain {signal.painScore}
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                          Urgency {signal.urgencyScore}
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                          Monetization {signal.monetizationScore}
                        </span>
                      </div>
                      {signal.painPoints && (
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{signal.painPoints}</p>
                      )}
                      {signal.url && (
                        <a
                          href={signal.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                        >
                          Open source post
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {!signal.linkedIssueId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => promoteMutation.mutate({ id: signal.id, stage: signal.targetStage ?? "discover" })}
                        disabled={promoteMutation.isPending}
                      >
                        Promote to Issue
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="sources" className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div>
              <h2 className="text-base font-semibold">Configure a real ingestion source</h2>
              <p className="text-sm text-muted-foreground">
                Connect X recent search or Reddit OAuth listings, then import fresh market demand into the signal queue.
              </p>
            </div>

            {createSourceMutation.error && (
              <p className="text-sm text-destructive">{createSourceMutation.error.message}</p>
            )}

            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-1">
                <label className="mb-1 block text-xs text-muted-foreground">Provider</label>
                <Select
                  value={sourceProvider}
                  onValueChange={(value) => setSourceProvider(value as SocialSignalSourceProvider)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOCIAL_SIGNAL_SOURCE_PROVIDERS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {pretty(provider)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-muted-foreground">Source name</label>
                <Input
                  value={sourceName}
                  onChange={(event) => setSourceName(event.target.value)}
                  placeholder="Reddit founder pain radar"
                />
              </div>

              <div className="md:col-span-1">
                <label className="mb-1 block text-xs text-muted-foreground">Default stage</label>
                <Select value={sourceStage} onValueChange={(value) => setSourceStage(value as ZeroPersonRDStage)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stageOptions.map((item) => (
                      <SelectItem key={item} value={item}>
                        {pretty(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {sourceProvider === "x" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-muted-foreground">X query</label>
                  <Input
                    value={xQuery}
                    onChange={(event) => setXQuery(event.target.value)}
                    placeholder="(founder OR startup) (pain OR annoying OR expensive) -is:retweet lang:en"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Language filter (optional)</label>
                  <Input
                    value={xLanguage}
                    onChange={(event) => setXLanguage(event.target.value)}
                    placeholder="en"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Max results</label>
                  <Input
                    value={xMaxResults}
                    onChange={(event) => setXMaxResults(event.target.value)}
                    placeholder="10"
                  />
                </div>
                <div className="md:col-span-2">
                  <CredentialField
                    label="X bearer token"
                    draft={xBearerToken}
                    secrets={secretsQuery.data ?? []}
                    onChange={setXBearerToken}
                    plainPlaceholder="Paste X bearer token or choose a secret"
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Reddit mode</label>
                  <Select
                    value={redditKind}
                    onValueChange={(value) =>
                      setRedditKind(value as "reddit_subreddit_new" | "reddit_search")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reddit_subreddit_new">Subreddit new</SelectItem>
                      <SelectItem value="reddit_search">Search</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Limit</label>
                  <Input
                    value={redditLimit}
                    onChange={(event) => setRedditLimit(event.target.value)}
                    placeholder="10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {redditKind === "reddit_subreddit_new"
                      ? "Subreddit"
                      : "Subreddit (optional, restrict search)"}
                  </label>
                  <Input
                    value={redditSubreddit}
                    onChange={(event) => setRedditSubreddit(event.target.value)}
                    placeholder="SaaS"
                  />
                </div>

                {redditKind === "reddit_search" && (
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Search query</label>
                    <Input
                      value={redditQuery}
                      onChange={(event) => setRedditQuery(event.target.value)}
                      placeholder="annoying workflow founders pay for"
                    />
                  </div>
                )}

                <div className="md:col-span-2">
                  <CredentialField
                    label="Reddit OAuth access token"
                    draft={redditAccessToken}
                    secrets={secretsQuery.data ?? []}
                    onChange={setRedditAccessToken}
                    plainPlaceholder="Paste Reddit bearer access token or choose a secret"
                  />
                </div>
                <div className="md:col-span-2">
                  <CredentialField
                    label="User-Agent"
                    draft={redditUserAgent}
                    secrets={secretsQuery.data ?? []}
                    onChange={setRedditUserAgent}
                    plainPlaceholder="paperclip/0.1 by your-company"
                  />
                </div>
              </div>
            )}

            <div className="rounded-md border border-border/70 bg-muted/30 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Automation</p>
                  <p className="text-xs text-muted-foreground">
                    Auto-score each imported signal and optionally auto-promote validated demand.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={autoPromote} onCheckedChange={(checked) => setAutoPromote(checked === true)} />
                  Auto-promote
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Scoring mode</label>
                  <Select value={scoringMode} onValueChange={(value) => setScoringMode(value as "rules" | "llm")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rules">Rules</SelectItem>
                      <SelectItem value="llm">LLM</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">LLM model</label>
                  <Input value={llmModel} onChange={(event) => setLlmModel(event.target.value)} placeholder="gpt-5" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={scheduleEnabled} onCheckedChange={(checked) => setScheduleEnabled(checked === true)} />
                    Scheduled sync
                  </label>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Review threshold</label>
                  <Input value={reviewThreshold} onChange={(event) => setReviewThreshold(event.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Reject threshold</label>
                  <Input value={rejectThreshold} onChange={(event) => setRejectThreshold(event.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Auto-promote threshold</label>
                  <Input value={promoteThreshold} onChange={(event) => setPromoteThreshold(event.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Min pain score</label>
                  <Input value={minimumPainScore} onChange={(event) => setMinimumPainScore(event.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Min urgency score</label>
                  <Input value={minimumUrgencyScore} onChange={(event) => setMinimumUrgencyScore(event.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Min monetization score</label>
                  <Input value={minimumMonetizationScore} onChange={(event) => setMinimumMonetizationScore(event.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Sync interval minutes</label>
                  <Input value={scheduleIntervalMinutes} onChange={(event) => setScheduleIntervalMinutes(event.target.value)} />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => void handleCreateSource()}
                disabled={sourceProvider === "x" ? !canCreateXSource : !canCreateRedditSource}
              >
                <Link2 className="mr-2 h-4 w-4" />
                {createSourceMutation.isPending ? "Saving..." : "Save Source"}
              </Button>
            </div>
          </div>

          {sourcesQuery.error && (
            <p className="text-sm text-destructive">{sourcesQuery.error.message}</p>
          )}

          <div className="space-y-3">
            {(sourcesQuery.data ?? []).length === 0 ? (
              <EmptyState icon={Link2} message="No ingestion sources yet. Configure your first X or Reddit source above." />
            ) : (
              (sourcesQuery.data ?? []).map((item) => (
                <div key={item.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {pretty(item.provider)}
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                          {pretty(item.kind)}
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                          {item.enabled ? "Enabled" : "Disabled"}
                        </span>
                        {item.targetStage && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                            {pretty(item.targetStage)}
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-semibold">{item.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        Last sync: {item.lastSyncedAt ? new Date(item.lastSyncedAt).toLocaleString() : "Never"}
                      </p>
                      {"automation" in item.config && item.config.automation ? (
                        <p className="text-xs text-muted-foreground">
                          {item.config.schedule.enabled
                            ? `Every ${item.config.schedule.intervalMinutes}m`
                            : "Manual sync only"}{" · "}
                          {item.config.automation.scoringMode === "llm"
                            ? `LLM scoring (${item.config.automation.llmModel ?? "default"})`
                            : "Rules scoring"}
                          {" · "}
                          Auto-score ≥ {item.config.automation.reviewThreshold}, reject ≤ {item.config.automation.rejectThreshold}
                          {item.config.automation.autoPromote
                            ? `, auto-promote ≥ ${item.config.automation.promoteThreshold}`
                            : ", manual promotion only"}
                        </p>
                      ) : null}
                      {item.lastError && (
                        <p className="text-xs text-destructive whitespace-pre-wrap">{item.lastError}</p>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncSourceMutation.mutate(item.id)}
                      disabled={syncSourceMutation.isPending}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync now
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
