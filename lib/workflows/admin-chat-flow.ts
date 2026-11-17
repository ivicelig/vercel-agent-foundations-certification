import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getStepMetadata, getWritable } from "workflow";
import { adminTools } from "@/lib/admin-tools";
import { buildAdminInstructions } from "@/lib/admin-instructions";
import { readMemory } from "@/lib/admin-sandbox";
import { AGENT_MODEL } from "@/lib/model";
import { writeChatFailure } from "@/lib/workflows/chat-failure";

const ADMIN_FAILURE_MESSAGE =
  "Sorry, I couldn't get an answer just now. Please try again in a moment.";

/**
 * Read the saved memory file from the admin sandbox, once, at the start of the
 * run. A missing file is normal (a fresh start) and comes back as "". If the
 * sandbox cannot be reached after all retries, memory is `null` so the agent
 * is told it is unavailable instead of being told there is none.
 */
async function loadAdminContextStep(): Promise<{
  today: string;
  memory: string | null;
}> {
  "use step";
  const today = new Date().toISOString().slice(0, 10);
  try {
    return { today, memory: await readMemory() };
  } catch (error) {
    const { attempt, maxAttempts } = getStepMetadata();
    if (attempt < maxAttempts) throw error;
    return { today, memory: null };
  }
}
loadAdminContextStep.maxRetries = 2;

/**
 * The admin chat as a durable workflow. Same durability as the shopping chat
 * (checkpointed model calls, retried tool steps, a resumable stream), with a
 * different tool set, read-only store access, and the saved memory in its
 * instructions.
 */
export async function adminChatWorkflow(messages: UIMessage[]) {
  "use workflow";

  const context = await loadAdminContextStep();

  const modelMessages = await convertToModelMessages(messages, {
    tools: adminTools,
    ignoreIncompleteToolCalls: true,
  });

  const agent = new WorkflowAgent({
    model: AGENT_MODEL,
    instructions: buildAdminInstructions(context),
    tools: adminTools,
  });

  try {
    const result = await agent.stream({
      messages: modelMessages,
      writable: getWritable<ModelCallStreamPart>(),
      // A cross-tool question needs: fetch A, fetch B, a few commands, reply.
      stopWhen: isStepCount(14),
    });
    return { ok: true as const, messages: result.messages };
  } catch (error) {
    await writeChatFailure(
      "admin-chat",
      error instanceof Error ? error.message : String(error),
      ADMIN_FAILURE_MESSAGE,
    );
    return { ok: false as const, messages: [] };
  }
}
