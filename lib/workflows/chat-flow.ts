import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { AGENT_MODEL } from "@/lib/model";
import { SHOP_INSTRUCTIONS } from "@/lib/shop-instructions";
import { shopTools } from "@/lib/shop-tools";
import { writeChatFailure } from "@/lib/workflows/chat-failure";

/** What the shopper sees when the model service fails. No internal details. */
const CHAT_FAILURE_MESSAGE =
  "Sorry, I couldn't get an answer just now. Please try again in a moment.";

/**
 * The shopping chat as a durable workflow.
 *
 * - Model calls and tool executions are checkpointed by the workflow runtime.
 *   If the process dies mid-conversation the run resumes from the last
 *   completed step instead of starting over.
 * - Every tool is a "use step" function, so transient failures are retried
 *   automatically (see lib/shop-tools.ts and lib/step-errors.ts).
 * - The output is written to the run's durable stream, which is what lets the
 *   browser reconnect after a refresh or a dropped connection.
 */
export async function shopChatWorkflow(messages: UIMessage[]) {
  "use workflow";

  const modelMessages = await convertToModelMessages(messages, {
    tools: shopTools,
    ignoreIncompleteToolCalls: true,
  });

  const agent = new WorkflowAgent({
    model: AGENT_MODEL,
    instructions: SHOP_INSTRUCTIONS,
    tools: shopTools,
  });

  try {
    const result = await agent.stream({
      messages: modelMessages,
      writable: getWritable<ModelCallStreamPart>(),
      // Enough for: categories -> search -> details -> reply, with headroom,
      // while still bounding a runaway loop.
      stopWhen: isStepCount(8),
    });
    return { ok: true as const, messages: result.messages };
  } catch (error) {
    await writeChatFailure(
      "shop-chat",
      error instanceof Error ? error.message : String(error),
      CHAT_FAILURE_MESSAGE,
    );
    return { ok: false as const, messages: [] };
  }
}
