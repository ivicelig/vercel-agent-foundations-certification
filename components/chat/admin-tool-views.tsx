"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToolFailureNote } from "@/components/chat/chat-product-cards";
import { CodeBlock } from "@/components/ai-elements/code-block";
import type {
  BashOutput,
  InventoryOutput,
  MemoryOutput,
  ReturnsOutput,
  SalesOutput,
  TicketsOutput,
} from "@/lib/admin-tools";
import { formatPrice } from "@/lib/format";

/**
 * Presentation of the admin tools' results in the admin chat. Raw JSON is
 * never shown: data tools show a short table (the full dataset stays in the
 * sandbox for computation), the bash tool shows the command and its output,
 * and every state (running, failed, empty) has its own wording.
 */

function DatasetNote({
  file,
  sandboxNote,
}: {
  file: string | null;
  sandboxNote: string | null;
}) {
  if (sandboxNote)
    return <p className="mt-2 text-xs text-destructive">{sandboxNote}</p>;
  if (!file) return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Full data saved in the sandbox for analysis.
    </p>
  );
}

function Frame({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border px-3 py-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </header>
      <div className="overflow-x-auto p-1">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="p-3 text-sm text-muted-foreground">{text}</p>;
}

const day = (iso: string) => iso.slice(0, 10);

export function TicketsView({ output }: { output: TicketsOutput }) {
  return (
    <Frame
      title="Support tickets"
      summary={`${output.count} found · ${day(output.from)} to ${day(output.to)}${output.mayHaveMore ? " · limit reached" : ""}`}
    >
      {output.preview.length === 0 ? (
        <Empty text="No tickets match those filters." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Assignee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {output.preview.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="max-w-[16rem] whitespace-normal">
                  {t.subject}
                </TableCell>
                <TableCell>{t.status}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      t.priority === "urgent" || t.priority === "high"
                        ? "destructive"
                        : "secondary"
                    }
                    className="rounded-full"
                  >
                    {t.priority}
                  </Badge>
                </TableCell>
                <TableCell>{t.category}</TableCell>
                <TableCell>{t.assignee ?? "Unassigned"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {output.count > output.preview.length && (
        <p className="px-3 pb-1 text-xs text-muted-foreground">
          Showing the first {output.preview.length} of {output.count}.
        </p>
      )}
      <DatasetNote file={output.file} sandboxNote={output.sandboxNote} />
    </Frame>
  );
}

export function ReturnsView({ output }: { output: ReturnsOutput }) {
  return (
    <Frame
      title="Returns"
      summary={`${output.count} found · ${day(output.from)} to ${day(output.to)}${output.mayHaveMore ? " · limit reached" : ""}`}
    >
      {output.preview.length === 0 ? (
        <Empty text="No returns match those filters." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead className="text-right">Refund</TableHead>
              <TableHead>Items</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {output.preview.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.orderId}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{r.decision ?? "Pending"}</TableCell>
                <TableCell className="text-right">
                  {r.refundFormatted ?? "-"}
                </TableCell>
                <TableCell className="max-w-[14rem] whitespace-normal">
                  {r.items.map((i) => `${i.productId} ×${i.quantity}`).join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {output.count > output.preview.length && (
        <p className="px-3 pb-1 text-xs text-muted-foreground">
          Showing the first {output.preview.length} of {output.count}.
        </p>
      )}
      <DatasetNote file={output.file} sandboxNote={output.sandboxNote} />
    </Frame>
  );
}

export function InventoryView({ output }: { output: InventoryOutput }) {
  return (
    <Frame
      title="Inventory"
      summary={`${output.total} products · page ${output.page} of ${output.totalPages}${output.hasNextPage ? " · more pages" : ""}`}
    >
      {output.preview.length === 0 ? (
        <Empty text="No products match those filters." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {output.preview.map((p) => (
              <TableRow key={p.productId}>
                <TableCell className="max-w-[14rem] whitespace-normal">
                  {p.name}
                </TableCell>
                <TableCell>{p.category}</TableCell>
                <TableCell className="text-right">{p.stock}</TableCell>
                <TableCell>
                  <Badge
                    variant={!p.inStock ? "destructive" : "secondary"}
                    className="rounded-full"
                  >
                    {!p.inStock ? "Out of stock" : p.lowStock ? "Low" : "OK"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {output.total > output.preview.length && (
        <p className="px-3 pb-1 text-xs text-muted-foreground">
          Showing the first {output.preview.length} of {output.total} on this
          page.
        </p>
      )}
      <DatasetNote file={output.file} sandboxNote={output.sandboxNote} />
    </Frame>
  );
}

export function SalesView({ output }: { output: SalesOutput }) {
  return (
    <Frame
      title="Sales"
      summary={`${day(output.from)} to ${day(output.to)} · ${output.days} days · ${output.totals.revenueFormatted} revenue`}
    >
      {output.preview.length === 0 ? (
        <Empty text="No sales in that window." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {output.preview.map((r) => (
              <TableRow key={r.productId}>
                <TableCell className="max-w-[14rem] whitespace-normal">
                  {r.name}
                </TableCell>
                <TableCell className="text-right">{r.unitsSold}</TableCell>
                <TableCell className="text-right">{r.ordersCount}</TableCell>
                <TableCell className="text-right">
                  {formatPrice(r.revenue, output.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {output.rowCount > output.preview.length && (
        <p className="px-3 pb-1 text-xs text-muted-foreground">
          Showing the top {output.preview.length} of {output.rowCount} products.
        </p>
      )}
      <DatasetNote file={output.file} sandboxNote={output.sandboxNote} />
    </Frame>
  );
}

export function BashView({
  output,
  running,
  command,
}: {
  output?: BashOutput;
  running?: boolean;
  command?: string;
}) {
  const shown = output?.command ?? command ?? "";
  return (
    <section
      aria-label="Sandbox command"
      className="w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h4 className="text-sm font-medium">Sandbox command</h4>
        {running ? (
          <span role="status" className="text-xs text-muted-foreground">
            Running…
          </span>
        ) : output ? (
          <Badge
            variant={output.exitCode === 0 ? "secondary" : "destructive"}
            className="rounded-full"
          >
            {output.timedOut
              ? "Timed out"
              : output.exitCode === 0
                ? "Completed"
                : `Failed (exit ${output.exitCode})`}
          </Badge>
        ) : null}
      </header>
      {shown && (
        <div className="overflow-x-auto text-xs">
          <CodeBlock code={shown} language="bash" />
        </div>
      )}
      {output?.stdout && (
        <div className="border-t border-border">
          <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
            Output
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-3 text-xs">
            {output.stdout}
          </pre>
        </div>
      )}
      {output?.stderr && (
        <div className="border-t border-border">
          <p className="px-3 pt-2 text-xs font-medium text-destructive">
            Errors
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap p-3 text-xs text-destructive">
            {output.stderr}
          </pre>
        </div>
      )}
    </section>
  );
}

export function MemorySaved({ output }: { output: MemoryOutput }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-green-600/30 bg-green-600/5 p-3 text-sm"
    >
      <p className="font-medium text-foreground">Saved to memory</p>
      <p className="mt-1 text-muted-foreground">{output.saved}</p>
    </div>
  );
}

export { ToolFailureNote };
