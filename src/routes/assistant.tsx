import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  Info,
  Loader2,
  MapPin,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { askAssistant, getAssistantConfig } from "@/lib/assistant/server-fns";
import type {
  AnswerSource,
  AssistantConfig,
  AssistantLocation,
  AssistantOrigin,
  AssistantReply,
} from "@/lib/assistant/types";
import { LOCATION_PRESETS } from "@/lib/locations";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "Farm Assistant — SkyCover" },
      {
        name: "description",
        content:
          "Ask SkyCover's farmer assistant about rainfall cover, premiums, payouts, payments and live mandi prices. Answers are grounded in SkyCover facts and attributed sources.",
      },
      { property: "og:title", content: "Farm Assistant — SkyCover" },
      {
        property: "og:description",
        content:
          "A grounded question-and-answer assistant for SkyCover's rainfall cover, with cited sources.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssistantPage,
});

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  reply?: AssistantReply;
}

const ORIGIN_LABEL: Record<AssistantOrigin, string> = {
  knowledge: "SkyCover help",
  live: "Live data",
  web: "Web sources",
  none: "Not grounded",
};

const ORIGIN_STYLE: Record<AssistantOrigin, string> = {
  knowledge: "border-sage/40 bg-sage/12 text-sage-strong",
  live: "border-rain/40 bg-rain/12 text-rain-strong",
  web: "border-lavender/40 bg-lavender/12 text-lavender-strong",
  none: "border-border bg-muted text-muted-foreground",
};

/** Internal help links stay in-app; everything else opens in a new tab. */
function SourceLink({ source }: { source: AnswerSource }) {
  const className = "inline-flex items-center gap-1 underline-offset-2 hover:underline";
  if (source.kind === "skycover") {
    return (
      <Link to={source.url} className={className}>
        {source.name}
      </Link>
    );
  }
  return (
    <a href={source.url} target="_blank" rel="noreferrer noopener" className={className}>
      {source.name} <ExternalLink className="size-3" />
    </a>
  );
}

function AssistantBubble({ message }: { message: ChatMessage }) {
  const reply = message.reply;
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-terracotta/12 text-terracotta-strong">
        <Bot className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {message.text}
        </div>

        {reply && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={ORIGIN_STYLE[reply.origin]}>
              {ORIGIN_LABEL[reply.origin]}
            </Badge>
            {reply.generated ? (
              <Badge variant="outline" className="border-border text-muted-foreground">
                Composed by assistant
              </Badge>
            ) : (
              <Badge variant="outline" className="border-border text-muted-foreground">
                Grounded answer
              </Badge>
            )}
            {reply.insufficient && (
              <Badge variant="outline" className="border-amber/50 bg-amber/12 text-amber-strong">
                No verified source
              </Badge>
            )}
          </div>
        )}

        {reply && reply.sources.length > 0 && (
          <div className="space-y-1 rounded-xl bg-secondary/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <div className="font-medium uppercase tracking-[0.12em]">Sources</div>
            <ul className="space-y-0.5">
              {reply.sources.slice(0, 6).map((source) => (
                <li key={`${source.kind}-${source.url}`} className="truncate">
                  <SourceLink source={source} />
                  {source.observedAt ? (
                    <span className="ml-1 text-muted-foreground/80">
                      · {new Date(source.observedAt).toLocaleString()}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {reply && reply.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {reply.suggestions.map((suggestion) => (
              <span
                key={suggestion}
                className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground"
              >
                {suggestion}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-primary-foreground">
        {message.text}
      </div>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
        <User className="size-4" />
      </span>
    </div>
  );
}

function AssistantPage() {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [locationName, setLocationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAssistantConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch(() => {
        // The configuration view is a convenience; a question can still be asked.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, loading]);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (message.length === 0 || loading) return;

      setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text: message }]);
      setInput("");
      setLoading(true);
      setError(null);

      try {
        const data: { message: string; location?: AssistantLocation } = { message };
        const preset = LOCATION_PRESETS.find((entry) => entry.name === locationName);
        if (preset) {
          data.location = {
            name: preset.name,
            latitude: preset.latitude,
            longitude: preset.longitude,
          };
        }
        const reply = await askAssistant({ data });
        setMessages((prev) => [
          ...prev,
          { id: nextId.current++, role: "assistant", text: reply.answer, reply },
        ]);
      } catch (err) {
        const text = err instanceof Error ? err.message : "The assistant could not be reached.";
        setError(text);
        toast.error(text);
      } finally {
        setLoading(false);
      }
    },
    [loading, locationName],
  );

  const topics = config?.topics ?? [];
  const missing = config?.missing ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-4xl text-center">
        <Badge variant="outline" className="border-sage/40 bg-sage/12 text-sage-strong">
          Farm Assistant
        </Badge>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Ask about your cover
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted-foreground">
          Questions about rainfall cover, premiums, locations, payments or live mandi prices.
          Answers are grounded in SkyCover's own behaviour and the sources it reads — never guessed.
        </p>
      </div>

      <div className="mt-14 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Card className="flex h-[42rem] flex-col border-border bg-card shadow-soft">
            <CardHeader className="border-b border-border pb-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Sparkles className="size-5 text-terracotta-strong" /> Farmer Assistant
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      config?.llmConfigured
                        ? "border-sage/40 bg-sage/12 text-sage-strong"
                        : "border-border text-muted-foreground"
                    }
                  >
                    {config?.llmConfigured ? "Conversational" : "Grounded mode"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      config?.tinyfishConfigured
                        ? "border-rain/40 bg-rain/12 text-rain-strong"
                        : "border-border text-muted-foreground"
                    }
                  >
                    {config?.tinyfishConfigured ? "Web search on" : "Web search off"}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col pt-6">
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
                {messages.length === 0 && !loading && (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                    <Bot className="mb-4 size-14 text-sage/50" />
                    <p className="text-base font-medium">Namaste — how can I help?</p>
                    <p className="mt-1 max-w-sm text-sm">
                      Try one of the suggestions below, or ask about rainfall or a mandi price.
                    </p>
                  </div>
                )}
                {messages.map((message) =>
                  message.role === "user" ? (
                    <UserBubble key={message.id} message={message} />
                  ) : (
                    <AssistantBubble key={message.id} message={message} />
                  ),
                )}
                {loading && (
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex size-8 items-center justify-center rounded-xl bg-terracotta/12 text-terracotta-strong">
                      <Bot className="size-4" />
                    </span>
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> Checking SkyCover and live
                      sources…
                    </span>
                  </div>
                )}
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/25">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form
                className="mt-4 flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(input);
                }}
              >
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder="e.g. How is the premium calculated?"
                  rows={2}
                  maxLength={800}
                  className="min-h-[3.25rem] resize-none border-input bg-card"
                />
                <Button
                  type="submit"
                  disabled={loading || input.trim().length === 0}
                  className="h-[3.25rem] px-4 font-semibold"
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="mt-5 flex items-center gap-3 rounded-xl bg-lavender/10 p-4 text-[12px] leading-relaxed text-foreground ring-1 ring-lavender/25">
            <Info className="size-5 shrink-0 text-lavender-strong" />
            The assistant is informational only. It cannot approve, reject or change a payout, and
            nothing it says creates cover — payouts settle solely on verified observed rainfall.
          </div>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <MapPin className="size-4 text-rain-strong" /> Your location
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Set a location so the assistant can answer rainfall questions with verified data.
              </p>
              <select
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="">No location</option>
                {LOCATION_PRESETS.map((preset) => (
                  <option key={preset.name} value={preset.name} className="bg-card">
                    {preset.name}
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold">Things you can ask</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topics.length === 0 ? (
                <p className="text-xs text-muted-foreground">Loading suggestions…</p>
              ) : (
                topics.slice(0, 7).map((topic) => (
                  <button
                    key={topic.question}
                    type="button"
                    onClick={() => void send(topic.question)}
                    disabled={loading}
                    className="block w-full rounded-xl border border-border px-3 py-2 text-left text-[13px] transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    {topic.question}
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {missing.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-secondary/60 p-4 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Richer answers unlock when these server variables are set:{" "}
                <span className="font-mono text-foreground">{missing.join(", ")}</span>.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
