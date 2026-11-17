import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, validateUIMessages } from "ai";
import { start } from "workflow/api";
import { isAdminRequest, notAuthorized } from "@/lib/admin-guard";
import { adminTools } from "@/lib/admin-tools";
import { adminChatWorkflow } from "@/lib/workflows/admin-chat-flow";

/**
 * Admin chat. Lives under /admin on purpose: the admin login cookie is scoped
 * to /admin, so the browser only sends it here, and proxy.ts already guards
 * this path. The route checks the session again before starting any run.
 */
const MAX_BODY_BYTES = 512 * 1024;
const MAX_MESSAGES = 80;

export async function POST(request: Request) {
  if (!(await isAdminRequest())) return notAuthorized();

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
    validated = await validateUIMessages({ messages, tools: adminTools });
  } catch {
    return Response.json({ error: "Invalid message format." }, { status: 400 });
  }

  const run = await start(adminChatWorkflow, [validated]);

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}
