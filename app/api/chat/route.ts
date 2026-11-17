import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, validateUIMessages } from "ai";
import { start } from "workflow/api";
import { shopTools } from "@/lib/shop-tools";
import { shopChatWorkflow } from "@/lib/workflows/chat-flow";

/** Upper bound on one request body, so a client cannot push a huge history. */
const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 60;

/**
 * Customer chat. Starts a durable workflow run and streams its output back.
 * The run id is returned in `x-workflow-run-id`, which the client transport
 * uses to reconnect (see app/api/chat/[id]/stream/route.ts).
 *
 * This route only knows the shopping tools; the admin agent has its own route
 * and its own tools, so nothing admin-only is reachable from here.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "Request too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return Response.json(
      { error: "This conversation is too long. Please start a new one." },
      { status: 413 },
    );
  }

  let validated;
  try {
    validated = await validateUIMessages({ messages, tools: shopTools });
  } catch {
    return Response.json({ error: "Invalid message format." }, { status: 400 });
  }

  const run = await start(shopChatWorkflow, [validated]);

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}
