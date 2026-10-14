import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/server/auth";
import { handle, readBodyBytes } from "@/lib/server/http";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

/**
 * Better Auth reads the body itself: cap it first (413 PAYLOAD_TOO_LARGE past 64 KB, like every other route),
 * then hand Better Auth the same bytes.
 */
export const POST = handle(async (request: Request) => {
  const body = await readBodyBytes(request);
  return handlers.POST(new Request(request, { body: body.byteLength ? body : null }));
});
