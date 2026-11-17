import { tool } from "ai";
import { z } from "zod";
import { start } from "workflow/api";
import { HookConflictError } from "workflow/errors";
import {
  getCategories,
  getOrder,
  getProductById,
  getProductStock,
  getProductsPage,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { handleStepError } from "@/lib/step-errors";
import { failure, type ToolResult } from "@/lib/tool-result";
import type { Product, StockInfo } from "@/lib/types";
import { returnWorkflow } from "@/lib/workflows/return-flow";

/* -------------------------------------------------------------------------- */
/* Shapes returned to the model and to the chat UI                            */
/* -------------------------------------------------------------------------- */

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  category: string;
  /** Price in cents as the API returns it. */
  price: number;
  /** Already formatted, e.g. "$35.00". Use this, never format cents yourself. */
  priceFormatted: string;
  image: string | null;
  /** First 200 characters, enough to choose between products. */
  blurb: string;
  /** Relative storefront link. */
  href: string;
}

export interface SearchProductsOutput {
  products: ProductSummary[];
  total: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  query: string | null;
  category: string | null;
}

export interface ProductDetailsOutput {
  product: {
    id: string;
    name: string;
    slug: string;
    category: string;
    description: string;
    price: number;
    priceFormatted: string;
    currency: string;
    images: string[];
    tags: string[];
    featured: boolean;
    href: string;
  };
  /** `null` when the stock service could not be reached. */
  stock: Pick<StockInfo, "stock" | "inStock" | "lowStock"> | null;
  stockNote: string | null;
}

export interface CategoryOutput {
  categories: { slug: string; name: string; productCount: number }[];
}

export interface ReturnOrderOutput {
  orderId: string;
  /** Absent when a duplicate was refused and the owning run id was not reported. */
  runId?: string;
  status: "started" | "already_started";
  message: string;
}

function summarize(product: Product): ProductSummary {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    category: product.category,
    price: product.price,
    priceFormatted: formatPrice(product.price, product.currency),
    image: product.images[0] ?? null,
    blurb: product.description.slice(0, 200),
    href: `/products/${product.id}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Steps: each tool call is one durable, retried unit of work                 */
/* -------------------------------------------------------------------------- */

const SearchInput = z.object({
  query: z
    .string()
    .trim()
    .max(100)
    .optional()
    .describe("Free-text search, e.g. 'hoodie'. Omit to browse."),
  category: z
    .string()
    .trim()
    .max(50)
    .optional()
    .describe(
      "A category slug taken from getAllCategories. Omit for all categories.",
    ),
  page: z.number().int().min(1).max(50).optional().describe("1-based page."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe("Products per page, default 8."),
});

async function searchProductsStep(
  input: z.infer<typeof SearchInput>,
): Promise<ToolResult<SearchProductsOutput>> {
  "use step";
  try {
    const { data, meta } = await getProductsPage({
      search: input.query || undefined,
      category: input.category || undefined,
      page: input.page,
      limit: input.limit ?? 8,
    });
    const pagination = meta.pagination;
    return {
      ok: true,
      products: data.map(summarize),
      total: pagination?.total ?? data.length,
      page: pagination?.page ?? input.page ?? 1,
      totalPages: pagination?.totalPages ?? 1,
      hasNextPage: pagination?.hasNextPage ?? false,
      query: input.query || null,
      category: input.category || null,
    };
  } catch (error) {
    return handleStepError(error);
  }
}
searchProductsStep.maxRetries = 3;

async function getAllCategoriesStep(): Promise<ToolResult<CategoryOutput>> {
  "use step";
  try {
    const categories = await getCategories();
    return {
      ok: true,
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        productCount: c.productCount,
      })),
    };
  } catch (error) {
    return handleStepError(error);
  }
}
getAllCategoriesStep.maxRetries = 3;

const DetailsInput = z.object({
  productId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("The product id or slug, e.g. 'hoodie_001'."),
});

async function getProductDetailsStep(
  input: z.infer<typeof DetailsInput>,
): Promise<ToolResult<ProductDetailsOutput>> {
  "use step";
  try {
    const product = await getProductById(input.productId);

    // Stock is a separate service. If only it fails, still return the product
    // and say plainly that stock is unknown, instead of failing the whole call
    // or pretending the item is in stock.
    let stock: ProductDetailsOutput["stock"] = null;
    let stockNote: string | null = null;
    try {
      const info = await getProductStock(product.id);
      stock = {
        stock: info.stock,
        inStock: info.inStock,
        lowStock: info.lowStock,
      };
    } catch {
      stockNote = "Stock information is unavailable right now.";
    }

    return {
      ok: true,
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug,
        category: product.category,
        description: product.description,
        price: product.price,
        priceFormatted: formatPrice(product.price, product.currency),
        currency: product.currency,
        images: product.images,
        tags: product.tags,
        featured: product.featured,
        href: `/products/${product.id}`,
      },
      stock,
      stockNote,
    };
  } catch (error) {
    return handleStepError(error);
  }
}
getProductDetailsStep.maxRetries = 3;

const ReturnInput = z.object({
  orderId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Order ids contain only letters, digits, - and _")
    .describe("The order number the shopper gave you."),
  reason: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .describe("Why the shopper is returning the order, in their own words."),
});

async function returnOrderStep(
  input: z.infer<typeof ReturnInput>,
): Promise<ToolResult<ReturnOrderOutput>> {
  "use step";
  try {
    // Cheap guard so the shopper is never told a return was started for an
    // order that does not exist or cannot be returned. The workflow repeats
    // the lookup as its own first step.
    const order = await getOrder(input.orderId);
    if (order.status !== "fulfilled") {
      return failure(
        "not_eligible",
        `Order ${input.orderId} has status "${order.status}". Only fulfilled orders can be returned.`,
      );
    }

    try {
      // One run per order: the hook token is the idempotency key, so a repeated
      // request (the shopper asking twice, a model retry) cannot start a second
      // return and a second refund. Duplicates are refused for a day.
      const run = await start(returnWorkflow, [input.orderId, input.reason], {
        experimental_hook: {
          token: `return:${input.orderId}`,
          experimental_minRetention: "1 day",
          metadata: { orderId: input.orderId },
        },
      });
      return {
        ok: true,
        orderId: input.orderId,
        runId: run.runId,
        status: "started",
        message:
          "The return request was submitted. The customer notification, refund pre-authorization and filing now run in the background.",
      };
    } catch (error) {
      if (HookConflictError.is(error)) {
        return {
          ok: true,
          orderId: input.orderId,
          runId: error.conflictingRunId,
          status: "already_started",
          message: `A return for order ${input.orderId} was already submitted, so no second one was started.`,
        };
      }
      throw error;
    }
  } catch (error) {
    return handleStepError(error);
  }
}
returnOrderStep.maxRetries = 2;

/* -------------------------------------------------------------------------- */
/* Tool definitions                                                           */
/* -------------------------------------------------------------------------- */

export const shopTools = {
  searchProducts: tool({
    description:
      "Search the Ship It Shop catalog by text and/or category, or browse everything when both are omitted. Returns product cards the shopper can see. Always call this instead of guessing what the store sells.",
    inputSchema: SearchInput,
    execute: searchProductsStep,
  }),
  getAllCategories: tool({
    description:
      "List the store's current categories with product counts. Call this before filtering by category so you only use real category slugs.",
    inputSchema: z.object({}),
    execute: getAllCategoriesStep,
  }),
  getProductDetails: tool({
    description:
      "Get the full details of one product: description, price, images, tags and live stock. Use it when the shopper asks about a specific item.",
    inputSchema: DetailsInput,
    execute: getProductDetailsStep,
  }),
  returnOrder: tool({
    description:
      "Start a return for a fulfilled order: looks the order up, notifies the customer, pre-authorizes the refund and files the return. Only call it after the shopper has given an order number and a reason and confirmed they want to proceed.",
    inputSchema: ReturnInput,
    execute: returnOrderStep,
  }),
};

export type ShopTools = typeof shopTools;
