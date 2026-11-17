import { ApiRequestError } from "@/lib/api";

/**
 * Tool results are a discriminated union so the model and the UI can tell a
 * real answer from a failure without guessing. A failed lookup never looks
 * like a success: `ok: false` always carries a reason the agent can explain.
 */
export type ToolFailureKind =
  | "not_found" // the record does not exist
  | "invalid_input" // the request was rejected as invalid
  | "not_eligible" // the record exists but the action is not allowed
  | "unavailable"; // the store service failed or could not be reached

export interface ToolFailure {
  ok: false;
  kind: ToolFailureKind;
  message: string;
  /** Extra facts the agent may relay, e.g. the list of valid categories. */
  hint?: string;
}

export type ToolSuccess<T> = { ok: true } & T;
export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export function failure(
  kind: ToolFailureKind,
  message: string,
  hint?: string,
): ToolFailure {
  return { ok: false, kind, message, ...(hint ? { hint } : {}) };
}

/**
 * Map an API error to a failure the agent can explain. Only the API's own
 * message text is passed on; headers, URLs and the bypass secret are never
 * part of an `ApiRequestError` message, and nothing else is copied.
 */
export function failureFromError(error: unknown): ToolFailure {
  if (error instanceof ApiRequestError) {
    if (error.status === 404) {
      return failure("not_found", error.message);
    }
    if (error.status === 400) {
      return failure("not_eligible", error.message);
    }
    if (error.status === 422) {
      return failure("invalid_input", error.message);
    }
    return failure(
      "unavailable",
      "The store service could not complete the request right now.",
    );
  }
  return failure(
    "unavailable",
    "The store service could not complete the request right now.",
  );
}

/** True for errors worth retrying (network problems and 5xx), not for 4xx. */
export function isTransient(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.status === 0 || error.status >= 500 || error.status === 429;
  }
  return true;
}
