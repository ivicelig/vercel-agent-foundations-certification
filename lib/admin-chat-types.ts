import type { InferUITools, UIDataTypes, UIMessage } from "ai";
import type { AdminTools } from "@/lib/admin-tools";

/**
 * Typed UI message for the admin chat. Imported by client components with
 * `import type` only, so no server-side tool code or sandbox client reaches
 * the browser bundle.
 */
export type AdminUIMessage = UIMessage<
  unknown,
  UIDataTypes,
  InferUITools<AdminTools>
>;
