import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/data/repo";
import { bookingInputSchema, createBooking, listBookings } from "@/lib/server/bookings";
import { assertSameOrigin, handle, readJson, requireUser } from "@/lib/server/http";
import { publicOrgId } from "@/lib/server/org";

/** GET /api/bookings → the signed-in guest's bookings, latest stay first. */
export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  return Response.json({ bookings: await listBookings(await publicOrgId(), user.id) });
});

/** POST /api/bookings { listingId, checkIn, checkOut, adults, children?, infants?, pets? } → 201 | 409 if taken. */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const booking = await createBooking(await publicOrgId(), user.id, await readJson(request, bookingInputSchema));
  revalidateTag(TAGS.availability, "max");
  return Response.json(booking, { status: 201 });
});
