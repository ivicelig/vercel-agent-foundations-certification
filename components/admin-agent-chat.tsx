"use client";

/**
 * The /admin chat panel, connected to the store admin agent.
 *
 * Same wiring as the storefront chat (useChat + WorkflowChatTransport, run id
 * kept in sessionStorage for resume) but it talks to the admin-only routes
 * under /admin/api/chat and renders the admin tools: data tables, sandbox
 * commands with their output, and memory notes.
 */
import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ClipboardList } from "lucide-react";
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
  BashView,
  InventoryView,
  MemorySaved,
  ReturnsView,
  SalesView,
  TicketsView,
  ToolFailureNote,
} from "@/components/chat/admin-tool-views";
import {
  CategoryList,
  ProductResults,
} from "@/components/chat/chat-product-cards";
import { ToolProgress } from "@/components/chat/tool-status";
import type { AdminUIMessage } from "@/lib/admin-chat-types";
import type { ToolFailure } from "@/lib/tool-result";

const RUN_KEY = "ship-it-shop:admin-active-run";
const API = "/admin/api/chat";

const SUGGESTIONS = [
  "Show me low-stock items",
  "What were yesterday's top sellers?",
  "Summarize this week's revenue",
  "Which products have the highest return rate?",
  "Which top sellers are low on stock?",
];

type Part = AdminUIMessage["parts"][number];
type Running = "input-streaming" | "input-available";

function readRunId(): string | null {
  try {
    return window.sessionStorage.getItem(RUN_KEY);
  } catch {
    return null;
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

const isRunning = (state: string): state is Running =>
  state === "input-streaming" || state === "input-available";

const errorNote = (message: string): ToolFailure => ({
  ok: false,
  kind: "unavailable",
  message,
});

function renderPart(part: Part, key: string) {
  switch (part.type) {
    case "text":
      return part.text ? (
        <MessageResponse key={key}>{part.text}</MessageResponse>
      ) : null;

    case "tool-getSupportTickets":
      if (isRunning(part.state))
        return <ToolProgress key={key} label="Reading support tickets…" />;
      if (part.state === "output-error")
        return <ToolFailureNote key={key} failure={errorNote("Tickets could not be read.")} />;
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <TicketsView key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );

    case "tool-getReturnsHistory":
      if (isRunning(part.state))
        return <ToolProgress key={key} label="Reading returns history…" />;
      if (part.state === "output-error")
        return <ToolFailureNote key={key} failure={errorNote("Returns could not be read.")} />;
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <ReturnsView key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );

    case "tool-getInventoryStock":
      if (isRunning(part.state))
        return <ToolProgress key={key} label="Checking inventory…" />;
      if (part.state === "output-error")
        return <ToolFailureNote key={key} failure={errorNote("Inventory could not be read.")} />;
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <InventoryView key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );

    case "tool-getSalesAnalytics":
      if (isRunning(part.state))
        return <ToolProgress key={key} label="Reading sales data…" />;
      if (part.state === "output-error")
        return <ToolFailureNote key={key} failure={errorNote("Sales could not be read.")} />;
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <SalesView key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );

    case "tool-bash":
      if (isRunning(part.state))
        return (
          <BashView
            key={key}
            running
            command={
              part.state === "input-available" ? part.input.command : undefined
            }
          />
        );
      if (part.state === "output-error")
        return <ToolFailureNote key={key} failure={errorNote("The command could not be run.")} />;
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <BashView key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );

    case "tool-saveMemory":
      if (isRunning(part.state))
        return <ToolProgress key={key} label="Saving to memory…" />;
      if (part.state === "output-error")
        return <ToolFailureNote key={key} failure={errorNote("Memory could not be saved.")} />;
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <MemorySaved key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );

    case "tool-searchProducts":
      if (isRunning(part.state))
        return <ToolProgress key={key} label="Searching the catalog…" />;
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <ProductResults key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );

    case "tool-getAllCategories":
      if (isRunning(part.state))
        return <ToolProgress key={key} label="Checking the categories…" />;
      if (part.state !== "output-available") return null;
      return part.output.ok ? (
        <CategoryList key={key} output={part.output} />
      ) : (
        <ToolFailureNote key={key} failure={part.output} />
      );

    default:
      return null;
  }
}

export function AdminAgentChat() {
  const [input, setInput] = useState("");
  const [resumeRunId, setResumeRunId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    const stored = readRunId();
    runIdRef.current = stored;
    setResumeRunId(stored);
    setReady(true);
  }, []);

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<AdminUIMessage>({
        api: API,
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
          return { ...rest, api: `${API}/${encodeURIComponent(id)}/stream` };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error, clearError, stop } =
    useChat<AdminUIMessage>({
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<ClipboardList className="size-6" aria-hidden="true" />}
              title="Store operations"
              description="Ask about support tickets, returns, inventory or sales. I can read the data and calculate results, but I can't change anything."
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
                <p className="font-medium text-foreground">Something went wrong</p>
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
        <PromptInput onSubmit={(m: PromptInputMessage) => submit(m.text)}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask the admin agent…"
              aria-label="Message the admin assistant"
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
