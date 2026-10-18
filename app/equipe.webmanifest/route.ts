import { MY_DAY_MANIFEST } from "@/lib/admin/manifest";

/** GET /equipe.webmanifest: the team app's manifest (lib/admin/manifest.ts). Static: no session, no personal data. */
export function GET() {
  return new Response(JSON.stringify(MY_DAY_MANIFEST), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
