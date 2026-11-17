import { FatalError, RetryableError } from "workflow";
import {
  ApiRequestError,
  createReturn,
  getOrder,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "@/lib/api";
import { isTransient } from "@/lib/tool-result";

/**
 * The return flow.
 *
 * Each side effect is its own step, and the workflow runtime records every
 * completed step. If a later step fails and is retried (or the whole run is
 * replayed after an interruption), the earlier steps are NOT executed again:
 * the customer is not notified twice and the refund is not pre-authorized
 * twice. Only the step that failed runs again.
 *
 * Retry policy per step: transient problems (network, 5xx, 429) are retried
 * with a back-off. A 4xx is a decision by the store API, so retrying cannot
 * help and the step fails permanently with a FatalError.
 */

interface OrderSnapshot {
  id: string;
  items: { productId: string; quantity: number }[];
  total: number;
}

function toStepError(label: string, error: unknown): Error {
  if (error instanceof ApiRequestError) {
    if (isTransient(error)) {
      return new RetryableError(`${label}: ${error.message}`, {
        retryAfter: "10s",
      });
    }
    return new FatalError(`${label}: ${error.message}`);
  }
  return new RetryableError(`${label}: unexpected error`, {
    retryAfter: "10s",
  });
}

async function lookupOrderStep(orderId: string): Promise<OrderSnapshot> {
  "use step";
  try {
    const order = await getOrder(orderId);
    if (order.status !== "fulfilled") {
      throw new FatalError(
        `Order ${orderId} is "${order.status}" and cannot be returned.`,
      );
    }
    return {
      id: order.id,
      items: order.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
      total: order.total,
    };
  } catch (error) {
    if (error instanceof FatalError) throw error;
    throw toStepError("Order lookup failed", error);
  }
}
lookupOrderStep.maxRetries = 4;

async function notifyCustomerStep(orderId: string): Promise<void> {
  "use step";
  try {
    await notifyReturnInProcess(orderId);
  } catch (error) {
    throw toStepError("Customer notification failed", error);
  }
}
notifyCustomerStep.maxRetries = 4;

async function preauthorizeRefundStep(
  orderId: string,
): Promise<{ id: string; amount: number; currency: string }> {
  "use step";
  try {
    const auth = await preauthorizeRefund(orderId);
    return { id: auth.id, amount: auth.amount, currency: auth.currency };
  } catch (error) {
    throw toStepError("Refund pre-authorization failed", error);
  }
}
preauthorizeRefundStep.maxRetries = 4;

async function fileReturnStep(
  order: OrderSnapshot,
  reason: string,
): Promise<{ id: string; status: string }> {
  "use step";
  try {
    const filed = await createReturn({
      orderId: order.id,
      items: order.items,
      reason,
    });
    return { id: filed.id, status: filed.status };
  } catch (error) {
    throw toStepError("Filing the return failed", error);
  }
}
fileReturnStep.maxRetries = 4;

export async function returnWorkflow(orderId: string, reason: string) {
  "use workflow";

  const order = await lookupOrderStep(orderId);
  await notifyCustomerStep(orderId);
  const refund = await preauthorizeRefundStep(orderId);
  const filed = await fileReturnStep(order, reason);

  return {
    orderId,
    returnId: filed.id,
    returnStatus: filed.status,
    refundPreauthorizationId: refund.id,
    refundAmountCents: refund.amount,
  };
}
