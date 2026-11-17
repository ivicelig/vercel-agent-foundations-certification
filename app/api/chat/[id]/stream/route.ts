import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import type { NextRequest } from "next/server";
import { getRun } from "workflow/api";

/** Name fragment of the customer chat workflow, used to scope this endpoint. */
const SHOP_WORKFLOW_NAME = "shopChatWorkflow";

/**
 * Reconnect to an existing customer-chat run.
 *
 * `WorkflowChatTransport` calls `GET /api/chat/{runId}/stream?startIndex=N`
 * when the first response stream is cut (dropped connection, function
 * timeout) and after a page refresh. N is the number of UI chunks the client
 * already has. Raw model parts and UI chunks do not map one to one, so we
 * replay the run's durable stream from the start and use `uiStartIndex` to
 * omit the UI chunks the client already received. The client therefore
 * continues exactly where it stopped: nothing is shown twice and no new run
 * (no second model call, no second return) is started.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Run ids are opaque, server-generated ids; refuse anything else early.
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return Response.json({ error: "Invalid run id." }, { status: 400 });
  }

  const raw = new URL(request.url).searchParams.get("startIndex") ?? "0";
  const startIndex = Number(raw);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json(
      { error: "startIndex must be a non-negative integer." },
      { status: 400 },
    );
  }

  const run = getRun<unknown>(id);

  // Only the shopping chat's runs may be read here. The admin agent's output
  // (and any other workflow's) stays unreachable from this public endpoint,
  // even if someone guesses a run id.
  try {
    if (!(await run.exists)) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }
    if (!(await run.workflowName).includes(SHOP_WORKFLOW_NAME)) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }
  } catch {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }

  const stream = run
    .getReadable({ startIndex: 0 })
    .pipeThrough(
      createModelCallToUIChunkTransform({ uiStartIndex: startIndex }),
    );

  return createUIMessageStreamResponse({
    stream,
    headers: { "x-workflow-run-id": id },
  });
}
