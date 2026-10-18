import { navFor, STAFF_ROLES } from "@/lib/admin/sections";
import { checkAccess } from "@/lib/server/authz";
import { AdminNav } from "./AdminNav";

/**
 * The back-office frame around every /admin page. Reads the session, so it sits behind <Suspense> in the layout.
 * Draws nothing for visitors who aren't staff (the page itself answers 404 or redirects), and no sections for
 * staff who still have to turn on double authentification.
 */
export async function AdminChrome() {
  const access = await checkAccess(STAFF_ROLES, { allowWithoutTwoFactor: true });
  if (!access.ok) return null;
  const role = access.user.role as "ADMIN" | "AGENT";
  const items = !access.user.twoFactorEnabled ? [] : navFor(role).map(({ href, label, ready }) => ({ href, label, ready }));
  return <AdminNav items={items} user={{ name: access.user.name, role }} />;
}
