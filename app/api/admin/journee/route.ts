import { addDays, isoDay } from "@/lib/admin/calendar";
import { requireAdminApi } from "@/lib/server/authz";
import { handle } from "@/lib/server/http";
import { myTaskDetails, tasksToday } from "@/lib/server/operations/tasks";

/**
 * GET /api/admin/journee → « Ma journée » of the person signed in: their tasks of today and tomorrow (Marrakech) with
 * check-lists and photos, which the phone keeps for offline use (lib/offline/). Only the caller's own tasks, no
 * amounts, no access codes; never cached by the browser or the service worker.
 */
export const GET = handle(async (request: Request) => {
  const access = await requireAdminApi(request, "/admin/ma-journee");
  const today = tasksToday();
  const tasks = await myTaskDetails(access, today, addDays(today, 2));
  return Response.json(
    {
      user: { id: access.user.id, name: access.user.name },
      today: isoDay(today),
      days: [isoDay(today), isoDay(addDays(today, 1))],
      tasks,
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
