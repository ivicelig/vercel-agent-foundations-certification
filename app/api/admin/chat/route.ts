/**
 * Intentionally empty.
 *
 * The admin agent does NOT live here. The admin login cookie is scoped to
 * /admin, so it is never sent to /api/*, and proxy.ts only guards /admin/*.
 * A working admin route at this path would have been reachable without
 * logging in. The admin chat is served from /admin/api/chat instead.
 */
export const POST = async () =>
  Response.json({ error: "Not found." }, { status: 404 });
