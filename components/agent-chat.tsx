"use client";

/**
 * The storefront chat panel, connected to the shopping agent.
 *
 * - `useChat` + `WorkflowChatTransport`: the reply streams from a durable
 *   workflow run. If the connection drops or the page is refreshed the
 *   transport reconnects to the same run instead of starting a new one.
 * - The active run id is kept in sessionStorage so a refresh can resume it.
 * - Tool results render as product cards, product details and a return
 *   status card; running and failed tools have their own states.
 */
import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ShoppingBag } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  CategoryList,
  EmptyResults,
  ProductDetails,
  ProductResults,
  ReturnStatus,
  ToolFailureNote,
} from "@/components/chat/chat-product-cards";
import { ToolProgress } from "@/components/chat/tool-status";
import type { ShopUIMessage } from "@/lib/chat-types";

const RUN_KEY = "ship-it-shop:active-run";
const SUGGESTIONS = [
  "What do you sell?",
  "Show me hoodies",
  "Tell me about the water bottle",
  "I'd like to return an order",
];

type Part = ShopUIMessage["parts"][number];

function readRunId(): string | null {
  try {
    return window.sessionStorage.getItem(RUN_KEY);
  } catch {
    return null; // storage can be blocked; the chat still works, just without resume
  }
}
function writeRunId(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(RUN_KEY, id);
    else window.sessionStorage.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

function renderPart(part: Part, key: string) {
  switch (part.type) {
    case "text":
      return part.text ? (
        <MessageResponse key={key}>{part.text}</MessageResponse>
      ) : null;

    case "tool-searchProducts": {
      if (part.state === "input-streaming" || part.state === "input-available")
        return <ToolProgress key={key} label="Searching the catalog…" />;
      if (part.state === "output-error")
        return (
          <ToolFailureNote
            key={key}
            failure={{
              ok: false,
              kind: "unavailable",
              message: "The search could not be completed.",
            }}
          />
        );
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <ProductResults key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );
    }

    case "tool-getProductDetails": {
      if (part.state === "input-streaming" || part.state === "input-available")
        return <ToolProgress key={key} label="Looking up that product…" />;
      if (part.state === "output-error")
        return (
          <ToolFailureNote
            key={key}
            failure={{
              ok: false,
              kind: "unavailable",
              message: "The product lookup could not be completed.",
            }}
          />
        );
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <ProductDetails key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );
    }

    case "tool-getAllCategories": {
      if (part.state === "input-streaming" || part.state === "input-available")
        return <ToolProgress key={key} label="Checking the categories…" />;
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        part.output.categories.length > 0 ? (
          <CategoryList key={key} output={part.output} />
        ) : (
          <EmptyResults key={key} message="No categories are available." />
        )
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );
    }

    case "tool-returnOrder": {
      if (part.state === "input-streaming" || part.state === "input-available")
        return <ToolProgress key={key} label="Submitting your return…" />;
      if (part.state === "output-error")
        return (
          <ToolFailureNote
            key={key}
            failure={{
              ok: false,
              kind: "unavailable",
              message: "The return could not be submitted.",
            }}
          />
        );
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <ReturnStatus key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );
    }

    default:
      return null; // step markers, reasoning and unknown parts stay hidden
  }
}

export function AgentChat() {
  const [input, setInput] = useState("");
  const [resumeRunId, setResumeRunId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const runIdRef = useRef<string | null>(null);

  // Read the stored run id once on mount (never during SSR).
  useEffect(() => {
    const stored = readRunId();
    runIdRef.current = stored;
    setResumeRunId(stored);
    setReady(true);
  }, []);

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<ShopUIMessage>({
        api: "/api/chat",
        maxConsecutiveErrors: 5,
        onChatSendMessage: (response) => {
          const id = response.headers.get("x-workflow-run-id");
          if (id) {
            runIdRef.current = id;
            writeRunId(id);
          }
        },
        onChatEnd: () => {
          runIdRef.current = null;
          writeRunId(null);
        },
        prepareReconnectToStreamRequest: ({ api, ...rest }) => {
          const id = runIdRef.current ?? readRunId();
          if (!id) throw new Error("No active run to resume");
          return { ...rest, api: `/api/chat/${encodeURIComponent(id)}/stream` };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error, clearError, stop } =
    useChat<ShopUIMessage>({
      transport,
      resume: ready && resumeRunId !== null,
    });

  const busy = status === "submitted" || status === "streaming";

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      clearError();
      sendMessage({ text: trimmed });
      setInput("");
    },
    [busy, clearError, sendMessage],
  );

  const handleSubmit = (message: PromptInputMessage) => submit(message.text);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<ShoppingBag className="size-6" aria-hidden="true" />}
              title="How can I help?"
              description="Ask about products, or tell me about an order you'd like to return."
            />
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.parts.map((part, i) =>
                    renderPart(part, `${message.id}-${i}`),
                  )}
                </MessageContent>
              </Message>
            ))
          )}

          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <ToolProgress label="Thinking…" />
              </MessageContent>
            </Message>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <Bot className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium text-foreground">
                  Something went wrong
                </p>
                <p className="text-muted-foreground">
                  I couldn&apos;t get an answer just now. Please try again.
                </p>
              </div>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-3 border-t p-3">
        {messages.length === 0 && (
          <Suggestions>
            {SUGGESTIONS.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={submit} />
            ))}
          </Suggestions>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about products or a return"
              aria-label="Message the shopping assistant"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!busy && !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
