import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "@/lib/admin-auth";

/**
 * Server-side admin check for route handlers.
 *
 * `proxy.ts` already guards everything under /admin, but a route that can run
 * a sandbox must not rely on a single layer, so each admin route asks again.
 * The comparison is constant-time. The password itself is never returned,
 * logged or put in a response.
 */
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export async function isAdminRequest(): Promise<boolean> {
  const value = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!value) return false;
  return timingSafeEqual(digest(value), digest(ADMIN_PASSWORD));
}

export function notAuthorized(): Response {
  return Response.json({ error: "Not authorized." }, { status: 401 });
}
