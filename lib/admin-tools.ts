import { tool } from "ai";
import { getStepMetadata } from "workflow";
import { z } from "zod";
import {
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
} from "@/lib/api";
import { appendMemory, runBash, writeDataFile } from "@/lib/admin-sandbox";
import { formatPrice } from "@/lib/format";
import { shopTools } from "@/lib/shop-tools";
import { handleStepError } from "@/lib/step-errors";
import { failure, type ToolResult } from "@/lib/tool-result";

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

const PREVIEW_ROWS = 8;
const SANDBOX_DOWN = "The analysis sandbox is unavailable right now.";

const DateInput = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/,
    "Use YYYY-MM-DD or an ISO 8601 datetime",
  );

/** Reject a window that ends before it starts, before calling the API. */
function checkRange(from?: string, to?: string) {
  if (from && to && Date.parse(from) > Date.parse(to)) {
    return failure(
      "invalid_input",
      `The start date (${from}) is after the end date (${to}).`,
    );
  }
  return null;
}

/** "j***@example.com": enough to tell tickets apart, without the full address. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** A short, stable id for this call's data file (same across step retries). */
function fileTag(): string {
  return getStepMetadata().stepId.replace(/[^a-z0-9]/gi, "").slice(-10);
}

/**
 * Save the full result in the sandbox so commands can compute over it. If the
 * sandbox is unavailable the data tool still answers with its preview and says
 * plainly that the full dataset is not available for computation.
 */
async function saveDataset(
  kind: string,
  rows: unknown,
): Promise<{ file: string | null; sandboxNote: string | null }> {
  try {
    const file = await writeDataFile(`${kind}-${fileTag()}.json`, rows);
    return { file, sandboxNote: null };
  } catch {
    return {
      file: null,
      sandboxNote:
        "The full dataset could not be saved to the sandbox, so it cannot be analysed with commands right now.",
    };
  }
}

interface DatasetBase {
  /** Path of the full dataset inside the sandbox, or null if it was not saved. */
  file: string | null;
  sandboxNote: string | null;
}

/* -------------------------------------------------------------------------- */
/* Support tickets                                                            */
/* -------------------------------------------------------------------------- */

export interface TicketsOutput extends DatasetBase {
  count: number;
  from: string;
  to: string;
  /** True when the limit was reached, so more tickets may exist. */
  mayHaveMore: boolean;
  columns: string;
  preview: {
    id: string;
    subject: string;
    status: string;
    priority: string;
    category: string;
    assignee: string | null;
    createdAt: string;
  }[];
}

const TicketsInput = z.object({
  from: DateInput.optional().describe("Start of the window. Default: 30 days before `to`."),
  to: DateInput.optional().describe("End of the window. Default: now."),
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  category: z
    .enum([
      "shipping",
      "returns",
      "product_quality",
      "sizing",
      "billing",
      "payment",
      "account",
      "other",
    ])
    .optional(),
  assignee: z
    .string()
    .trim()
    .regex(/^[a-z0-9._-]{1,40}$/i, "A staff username, e.g. alex")
    .optional()
    .describe("Staff username. Unassigned tickets are excluded when set."),
  limit: z.number().int().min(1).max(500).optional().describe("1-500, default 100."),
});

async function getSupportTicketsStep(
  input: z.infer<typeof TicketsInput>,
): Promise<ToolResult<TicketsOutput>> {
  "use step";
  const bad = checkRange(input.from, input.to);
  if (bad) return bad;
  try {
    const limit = input.limit ?? 100;
    const { data, meta } = await getBackOfficeSupportTickets({ ...input, limit });
    const rows = data.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      category: t.category,
      assignee: t.assignee,
      customerEmail: maskEmail(t.customerEmail),
      relatedOrderId: t.relatedOrderId,
      relatedReturnId: t.relatedReturnId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      lastMessageAt: t.lastMessageAt,
    }));
    const saved = await saveDataset("tickets", rows);
    return {
      ok: true,
      count: meta.count,
      from: meta.from,
      to: meta.to,
      mayHaveMore: data.length >= limit,
      columns:
        "id, subject, status, priority, category, assignee, customerEmail (masked), relatedOrderId, relatedReturnId, createdAt, updatedAt, lastMessageAt",
      preview: rows.slice(0, PREVIEW_ROWS).map((r) => ({
        id: r.id,
        subject: r.subject,
        status: r.status,
        priority: r.priority,
        category: r.category,
        assignee: r.assignee,
        createdAt: r.createdAt,
      })),
      ...saved,
    };
  } catch (error) {
    return handleStepError(error);
  }
}
getSupportTicketsStep.maxRetries = 3;

/* -------------------------------------------------------------------------- */
/* Returns history                                                            */
/* -------------------------------------------------------------------------- */

export interface ReturnsOutput extends DatasetBase {
  count: number;
  from: string;
  to: string;
  mayHaveMore: boolean;
  columns: string;
  preview: {
    id: string;
    orderId: string;
    status: string;
    decision: string | null;
    refundAmount: number | null;
    refundFormatted: string | null;
    items: { productId: string; quantity: number }[];
    createdAt: string;
  }[];
}

const ReturnsInput = z.object({
  from: DateInput.optional().describe("Start of the window. Default: 30 days before `to`."),
  to: DateInput.optional().describe("End of the window. Default: now."),
  status: z.enum(["pending", "processing", "completed"]).optional(),
  decision: z
    .enum(["approved", "rejected", "needs_info"])
    .optional()
    .describe("Implies status=completed."),
  limit: z.number().int().min(1).max(500).optional().describe("1-500, default 200."),
});

async function getReturnsHistoryStep(
  input: z.infer<typeof ReturnsInput>,
): Promise<ToolResult<ReturnsOutput>> {
  "use step";
  const bad = checkRange(input.from, input.to);
  if (bad) return bad;
  try {
    const limit = input.limit ?? 200;
    const { data, meta } = await getBackOfficeReturns({ ...input, limit });
    const rows = data.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      status: r.status,
      decision: r.decision,
      refundAmount: r.refundAmount, // cents
      reason: r.reason,
      notes: r.notes,
      items: r.items,
      order: r.order ?? null,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
    }));
    const saved = await saveDataset("returns", rows);
    return {
      ok: true,
      count: meta.count,
      from: meta.from,
      to: meta.to,
      mayHaveMore: data.length >= limit,
      columns:
        "id, orderId, status, decision, refundAmount (cents), reason, notes, items[{productId, quantity}], order{id,total,status} (cents), createdAt, processedAt",
      preview: rows.slice(0, PREVIEW_ROWS).map((r) => ({
        id: r.id,
        orderId: r.orderId,
        status: r.status,
        decision: r.decision,
        refundAmount: r.refundAmount,
        refundFormatted:
          r.refundAmount == null ? null : formatPrice(r.refundAmount),
        items: r.items,
        createdAt: r.createdAt,
      })),
      ...saved,
    };
  } catch (error) {
    return handleStepError(error);
  }
}
getReturnsHistoryStep.maxRetries = 3;

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

export interface InventoryOutput extends DatasetBase {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  columns: string;
  preview: {
    productId: string;
    name: string;
    category: string;
    stock: number;
    inStock: boolean;
    lowStock: boolean;
  }[];
}

const InventoryInput = z.object({
  productIds: z
    .array(z.string().trim().min(1).max(100))
    .max(100)
    .optional()
    .describe("Restrict to these product ids."),
  lowStock: z
    .boolean()
    .optional()
    .describe("true: only products with 1-5 units; false: exclude them."),
  inStock: z
    .boolean()
    .optional()
    .describe("true: only products with at least one unit; false: only sold-out ones."),
  page: z.number().int().min(1).max(1000).optional().describe("1-based page, default 1."),
  limit: z.number().int().min(1).max(200).optional().describe("1-200, default 100."),
});

async function getInventoryStockStep(
  input: z.infer<typeof InventoryInput>,
): Promise<ToolResult<InventoryOutput>> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeStock({
      ...input,
      limit: input.limit ?? 100,
    });
    const rows = data.map((e) => ({
      productId: e.productId,
      name: e.product.name,
      category: e.product.category,
      stock: e.stock,
      inStock: e.inStock,
      lowStock: e.lowStock,
      updatedAt: e.updatedAt,
    }));
    const saved = await saveDataset("inventory", rows);
    const p = meta.pagination;
    return {
      ok: true,
      page: p.page,
      limit: p.limit,
      total: p.total,
      totalPages: p.totalPages,
      hasNextPage: p.hasNextPage,
      columns: "productId, name, category, stock, inStock, lowStock, updatedAt",
      preview: rows.slice(0, PREVIEW_ROWS).map((r) => ({
        productId: r.productId,
        name: r.name,
        category: r.category,
        stock: r.stock,
        inStock: r.inStock,
        lowStock: r.lowStock,
      })),
      ...saved,
    };
  } catch (error) {
    return handleStepError(error);
  }
}
getInventoryStockStep.maxRetries = 3;

/* -------------------------------------------------------------------------- */
/* Sales analytics                                                            */
/* -------------------------------------------------------------------------- */

export interface SalesOutput extends DatasetBase {
  from: string;
  to: string;
  days: number;
  currency: string;
  totals: {
    unitsSold: number;
    ordersCount: number;
    revenue: number;
    revenueFormatted: string;
  };
  rowCount: number;
  columns: string;
  preview: {
    productId: string;
    name: string;
    unitsSold: number;
    ordersCount: number;
    revenue: number;
    revenueFormatted: string;
  }[];
}

const SalesInput = z.object({
  from: DateInput.optional().describe("Start of the window. Default: 30 days before `to`."),
  to: DateInput.optional().describe("End of the window. Default: now."),
  productId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Restrict to one product id."),
});

async function getSalesAnalyticsStep(
  input: z.infer<typeof SalesInput>,
): Promise<ToolResult<SalesOutput>> {
  "use step";
  const bad = checkRange(input.from, input.to);
  if (bad) return bad;
  try {
    const { data, meta } = await getBackOfficeSales(input);
    const rows = data.map((r) => ({
      productId: r.productId,
      name: r.product.name,
      category: r.product.category,
      unitPrice: r.product.price, // cents
      unitsSold: r.unitsSold,
      ordersCount: r.ordersCount,
      revenue: r.revenue, // cents
    }));
    const saved = await saveDataset("sales", rows);
    return {
      ok: true,
      from: meta.from,
      to: meta.to,
      days: meta.days,
      currency: meta.currency,
      totals: {
        unitsSold: meta.totals.unitsSold,
        ordersCount: meta.totals.ordersCount,
        revenue: meta.totals.revenue,
        revenueFormatted: formatPrice(meta.totals.revenue, meta.currency),
      },
      rowCount: rows.length,
      columns:
        "productId, name, category, unitPrice (cents), unitsSold, ordersCount, revenue (cents)",
      preview: rows.slice(0, PREVIEW_ROWS).map((r) => ({
        productId: r.productId,
        name: r.name,
        unitsSold: r.unitsSold,
        ordersCount: r.ordersCount,
        revenue: r.revenue,
        revenueFormatted: formatPrice(r.revenue, meta.currency),
      })),
      ...saved,
    };
  } catch (error) {
    return handleStepError(error);
  }
}
getSalesAnalyticsStep.maxRetries = 3;

/* -------------------------------------------------------------------------- */
/* Sandbox: bash and memory                                                   */
/* -------------------------------------------------------------------------- */

export interface BashOutput {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const BashInput = z.object({
  command: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      "A bash command. Saved datasets are JSON files under /vercel/sandbox/data. python3 is available. There is no internet access.",
    ),
});

async function bashStep(
  input: z.infer<typeof BashInput>,
): Promise<ToolResult<BashOutput>> {
  "use step";
  try {
    const out = await runBash(input.command);
    return { ok: true, command: input.command, ...out };
  } catch (error) {
    return handleStepError(error, SANDBOX_DOWN);
  }
}
bashStep.maxRetries = 2;

export interface MemoryOutput {
  saved: string;
  memorySize: number;
}

/** Notes that look like credentials are never written to memory. */
const SECRET_LIKE =
  /(pass(word|wd)?|secret|api[-_ ]?key|token|bearer|authorization)\s*(is|=|:)|[A-Za-z0-9+/_-]{32,}/i;

const MemoryInput = z.object({
  note: z
    .string()
    .trim()
    .min(5)
    .max(500)
    .describe(
      "One self-contained fact worth remembering: a preference, a correction or business context. Not store data, not credentials.",
    ),
});

async function saveMemoryStep(
  input: z.infer<typeof MemoryInput>,
): Promise<ToolResult<MemoryOutput>> {
  "use step";
  if (SECRET_LIKE.test(input.note)) {
    return failure(
      "invalid_input",
      "That note looks like it contains a credential or secret, so it was not saved. Memory is for preferences and business context only.",
    );
  }
  try {
    const { size } = await appendMemory(input.note);
    return { ok: true, saved: input.note, memorySize: size };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The memory file is full")) {
      return failure("not_eligible", error.message);
    }
    return handleStepError(error, SANDBOX_DOWN);
  }
}
saveMemoryStep.maxRetries = 2;

/* -------------------------------------------------------------------------- */
/* Tool set                                                                   */
/* -------------------------------------------------------------------------- */

export const adminTools = {
  getSupportTickets: tool({
    description:
      "Read support tickets in a date range with optional status, priority, category and assignee filters. Saves the full list in the sandbox and returns a preview plus counts. Read-only.",
    inputSchema: TicketsInput,
    execute: getSupportTicketsStep,
  }),
  getReturnsHistory: tool({
    description:
      "Read historical returns (items, decision, refund, order summary) in a date range with optional status and decision filters. Saves the full list in the sandbox. Read-only. History covers about the last 180 days.",
    inputSchema: ReturnsInput,
    execute: getReturnsHistoryStep,
  }),
  getInventoryStock: tool({
    description:
      "Read current stock levels, optionally filtered by product, low stock or availability. Paginated. Saves the returned page in the sandbox. Read-only.",
    inputSchema: InventoryInput,
    execute: getInventoryStockStep,
  }),
  getSalesAnalytics: tool({
    description:
      "Read sales by product (units sold, orders, revenue in cents) for a date range, optionally for one product. Saves the rows in the sandbox. Read-only. Covers about the last 180 days.",
    inputSchema: SalesInput,
    execute: getSalesAnalyticsStep,
  }),
  // Catalog context: identify products by name and category before joining
  // them with back-office data. Reuses the shop's read-only catalog tools.
  searchProducts: shopTools.searchProducts,
  getAllCategories: shopTools.getAllCategories,
  bash: tool({
    description:
      "Run a bash command in the isolated admin sandbox to compute results from the saved datasets (sums, joins, rates, rankings). Use it for every calculation. No internet access.",
    inputSchema: BashInput,
    execute: bashStep,
  }),
  saveMemory: tool({
    description:
      "Append one note to the admin memory file so it is available in future conversations. Use it when the employee states a preference, corrects you, or gives business context.",
    inputSchema: MemoryInput,
    execute: saveMemoryStep,
  }),
};

export type AdminTools = typeof adminTools;
