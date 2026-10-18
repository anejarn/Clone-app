import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { RuleForm } from "@/components/admin/prices/RuleForm";
import { EMPTY_RULE_VALUES } from "@/lib/admin/price-rule-form";
import { ruleListingOptions } from "@/lib/server/admin/prices";
import { requireAdminPage } from "@/lib/server/authz";
import { createRuleAction } from "../actions";

export const metadata: Metadata = { title: "Nouvelle règle de prix" };

export default function Page({ searchParams }: PageProps<"/admin/prix/nouvelle">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId } = await requireAdminPage("/admin/prix");
  const [listings, sp] = await Promise.all([ruleListingOptions(organizationId), searchParams]);
  // From a listing's price calendar: ?bien=<id> starts with that listing selected.
  const bien = typeof sp.bien === "string" && listings.some((l) => l.id === sp.bien) ? sp.bien : null;
  const initial = bien ? { ...EMPTY_RULE_VALUES, scope: "SELECTED", listingIds: [bien] } : EMPTY_RULE_VALUES;
  return (
    <AdminPage
      title="Nouvelle règle de prix"
      intro={
        <>
          <Link href="/admin/prix" className="underline underline-offset-2">
            Prix
          </Link>{" "}
          · Une saison (haute saison, basse saison) ou un événement (marathon, festival, fêtes) qui change le prix des nuits concernées.
        </>
      }
    >
      <RuleForm action={createRuleAction} listings={listings} initial={initial} submitLabel="Créer la règle" />
    </AdminPage>
  );
}
