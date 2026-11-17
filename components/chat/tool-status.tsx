"use client";

import { Shimmer } from "@/components/ai-elements/shimmer";

/**
 * Plain-language progress text for a tool that is still running, so people
 * see "Searching the catalog…" instead of the name of a function.
 */
export function ToolProgress({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="text-sm">
      <Shimmer>{label}</Shimmer>
    </div>
  );
}
