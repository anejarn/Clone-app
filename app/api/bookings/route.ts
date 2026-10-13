import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/data/repo";
import { bookingInputSchema, createBooking, listBookings } from "@/lib/server/bookings";
import { assertSameOrigin, handle, readJson, requireUser } from "@/lib/server/http";

/** GET /api/bookings → the signed-in guest's bookings, latest stay first. */
export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  return Response.json({ bookings: await listBookings(user.id) });
});

/** POST /api/bookings { listingId, checkIn, checkOut, adults, children?, infants?, pets? } → 201 | 409 if taken. */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const booking = await createBooking(user.id, await readJson(request, bookingInputSchema));
  revalidateTag(TAGS.availability, "max");
  return Response.json(booking, { status: 201 });
});
