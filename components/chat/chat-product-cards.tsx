"use client";

import Image from "next/image";
import Link from "next/link";
import { PackageSearch } from "lucide-react";
import type {
  CategoryOutput,
  ProductDetailsOutput,
  ProductSummary,
  ReturnOrderOutput,
  SearchProductsOutput,
} from "@/lib/shop-tools";
import type { ToolFailure } from "@/lib/tool-result";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Presentation of the shopping tools' results inside the chat. These are the
 * "generative UI" pieces: the model asks a tool, the tool returns data, and
 * the chat shows a real component instead of raw JSON or a text dump.
 * Every link points at an existing storefront page (/products/:id).
 */

function ProductThumb({ product }: { product: ProductSummary }) {
  return (
    <div className="relative aspect-square w-full overflow-hidden bg-secondary">
      {product.image ? (
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes="(min-width: 640px) 160px, 45vw"
          className="object-cover"
        />
      ) : (
        <div
          className="flex size-full items-center justify-center text-muted-foreground"
          aria-hidden="true"
        >
          <PackageSearch className="size-6" />
        </div>
      )}
    </div>
  );
}

export function ProductResults({ output }: { output: SearchProductsOutput }) {
  if (output.products.length === 0) {
    return (
      <EmptyResults
        message={
          output.query
            ? `No products matched “${output.query}”${output.category ? ` in ${output.category}` : ""}.`
            : output.category
              ? `There are no products in “${output.category}” right now.`
              : "The catalog is empty right now."
        }
      />
    );
  }

  return (
    <section aria-label="Product results" className="w-full">
      <p className="mb-2 text-xs text-muted-foreground">
        {output.total === 1 ? "1 product" : `${output.total} products`}
        {output.totalPages > 1
          ? ` · page ${output.page} of ${output.totalPages}`
          : ""}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {output.products.map((product) => (
          <li key={product.id} className="min-w-0">
            <Link
              href={product.href}
              className="group block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ProductThumb product={product} />
              <div className="p-3">
                <h4 className="line-clamp-2 text-sm font-medium text-foreground">
                  {product.name}
                </h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  {product.priceFormatted}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProductDetails({ output }: { output: ProductDetailsOutput }) {
  const { product, stock, stockNote } = output;
  const hero = product.images[0];
  const more = product.images.slice(1, 4);

  let stockLabel = stockNote ?? "Stock unavailable";
  let stockTone: "default" | "secondary" | "destructive" = "secondary";
  if (stock) {
    if (!stock.inStock) {
      stockLabel = "Out of stock";
      stockTone = "destructive";
    } else if (stock.lowStock) {
      stockLabel = `Only ${stock.stock} left`;
      stockTone = "default";
    } else {
      stockLabel = "In stock";
    }
  }

  return (
    <article
      aria-label={product.name}
      className="w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      {hero && (
        <div className="relative aspect-[4/3] w-full bg-secondary">
          <Image
            src={hero}
            alt={product.name}
            fill
            sizes="(min-width: 640px) 380px, 90vw"
            className="object-cover"
          />
        </div>
      )}
      {more.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto p-2" aria-label="More images">
          {more.map((src, i) => (
            <li
              key={src}
              className="relative size-14 shrink-0 overflow-hidden rounded-md border border-border bg-secondary"
            >
              <Image
                src={src}
                alt={`${product.name}, view ${i + 2}`}
                fill
                sizes="56px"
                className="object-cover"
              />
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-base font-semibold text-foreground">
            {product.name}
          </h4>
          <p className="shrink-0 text-base font-medium">
            {product.priceFormatted}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={stockTone} className="rounded-full">
            {stockLabel}
          </Badge>
          <Badge variant="outline" className="rounded-full">
            {product.category}
          </Badge>
          {product.featured && (
            <Badge variant="outline" className="rounded-full">
              Featured
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{product.description}</p>
        {product.tags.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Tags: {product.tags.join(", ")}
          </p>
        )}
        <Link
          href={`/products/${product.id}`}
          className="inline-block text-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          View product page
        </Link>
      </div>
    </article>
  );
}

export function CategoryList({ output }: { output: CategoryOutput }) {
  return (
    <ul
      aria-label="Product categories"
      className="flex flex-wrap gap-2"
    >
      {output.categories.map((c) => (
        <li key={c.slug}>
          <Badge variant="outline" className="rounded-full">
            {c.name}
            <span className="ml-1 text-muted-foreground">{c.productCount}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function ReturnStatus({ output }: { output: ReturnOrderOutput }) {
  const already = output.status === "already_started";
  return (
    <div
      role="status"
      className={cn(
        "rounded-lg border p-3 text-sm",
        already
          ? "border-border bg-secondary"
          : "border-green-600/30 bg-green-600/5",
      )}
    >
      <p className="font-medium text-foreground">
        {already ? "Return already submitted" : "Return request filed"}
      </p>
      <p className="mt-1 text-muted-foreground">
        Order {output.orderId}. {output.message}
      </p>
    </div>
  );
}

export function EmptyResults({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
    >
      {message}
    </div>
  );
}

export function ToolFailureNote({ failure }: { failure: ToolFailure }) {
  const heading =
    failure.kind === "not_found"
      ? "Couldn’t find that"
      : failure.kind === "not_eligible"
        ? "That isn’t possible"
        : failure.kind === "invalid_input"
          ? "That request wasn’t valid"
          : "Store service unavailable";
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p className="font-medium text-foreground">{heading}</p>
      <p className="mt-1 text-muted-foreground">{failure.message}</p>
      {failure.hint && (
        <p className="mt-1 text-xs text-muted-foreground">{failure.hint}</p>
      )}
    </div>
  );
}
