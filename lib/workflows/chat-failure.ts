import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable } from "workflow";

/**
 * Write a visible error into a chat run's stream and close it.
 *
 * Without this, a failed model call ends the stream with no content at all and
 * the user sees an empty reply. `message` is what the user sees (no internal
 * detail); `detail` goes to the server log only.
 */
export async function writeChatFailure(
  label: string,
  detail: string,
  message: string,
): Promise<void> {
  "use step";
  console.error(`[${label}] model call failed:`, detail);
  const writable = getWritable<ModelCallStreamPart>();
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "error", error: message });
  } finally {
    writer.releaseLock();
  }
  await writable.close();
}
