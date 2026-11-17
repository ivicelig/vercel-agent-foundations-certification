import { getStepMetadata } from "workflow";
import { failureFromError, isTransient, type ToolFailure } from "@/lib/tool-result";

/**
 * Decide what a failed tool step should do. Call it from a `catch` inside a
 * "use step" function.
 *
 * - Transient problems (network, 5xx, 429) are rethrown so the workflow
 *   runtime retries the step. The step's retry budget is `maxRetries`.
 * - On the final attempt, or for permanent problems (404, 400, 422), it
 *   returns a typed failure instead of throwing. The agent then explains the
 *   problem to the user and never reports a result that did not happen.
 *
 * `unavailableMessage` lets a caller describe *which* service failed (for
 * example the analysis sandbox). Only the API's own message or this text is
 * ever returned: no URL, header or secret.
 */
export function handleStepError(
  error: unknown,
  unavailableMessage?: string,
): ToolFailure {
  if (isTransient(error)) {
    const { attempt, maxAttempts } = getStepMetadata();
    if (attempt < maxAttempts) throw error;
  }
  const failure = failureFromError(error);
  if (failure.kind === "unavailable" && unavailableMessage) {
    return { ...failure, message: unavailableMessage };
  }
  return failure;
}
