import type { InferUITools, UIDataTypes, UIMessage } from "ai";
import type { ShopTools } from "@/lib/shop-tools";

/**
 * Typed UI message for the shopping chat. Imported by client components with
 * `import type` only, so none of the server-side tool code (workflow start,
 * API client, secrets) is pulled into the browser bundle.
 */
export type ShopUIMessage = UIMessage<
  unknown,
  UIDataTypes,
  InferUITools<ShopTools>
>;
