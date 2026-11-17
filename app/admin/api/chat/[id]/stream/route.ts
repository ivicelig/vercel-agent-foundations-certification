import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import type { NextRequest } from "next/server";
import { getRun } from "workflow/api";
import { isAdminRequest, notAuthorized } from "@/lib/admin-guard";

/** Name fragment of the admin chat workflow, used to scope this endpoint. */
const ADMIN_WORKFLOW_NAME = "adminChatWorkflow";

/**
 * Reconnect to an existing admin-chat run (dropped connection or refresh).
 * Same replay logic as the customer route: the raw stream is replayed from the
 * start and `uiStartIndex` omits the UI chunks the browser already has. It is
 * admin-only, and it only serves admin chat runs.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest())) return notAuthorized();

  const { id } = await params;
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
  try {
    if (!(await run.exists)) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }
    if (!(await run.workflowName).includes(ADMIN_WORKFLOW_NAME)) {
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
