import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { DeleteRuleForm, RuleForm } from "@/components/admin/prices/RuleForm";
import { RULE_KIND_LABEL, ruleToValues } from "@/lib/admin/price-rule-form";
import { formatDateTime } from "@/lib/format";
import { getPriceRule, ruleListingOptions } from "@/lib/server/admin/prices";
import { requireAdminPage } from "@/lib/server/authz";
import { ID_RE } from "@/lib/server/schemas";
import { deleteRuleAction, updateRuleAction } from "../actions";

export const metadata: Metadata = { title: "Règle de prix" };

export default function Page({ params }: PageProps<"/admin/prix/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requireAdminPage("/admin/prix");
  const { id } = await params;
  // Another organization's rule is "not found", as an unknown one.
  const rule = ID_RE.test(id) ? await getPriceRule(organizationId, id) : null;
  if (!rule) notFound();
  const listings = await ruleListingOptions(organizationId);
  return (
    <AdminPage
      title={rule.name}
      intro={
        <>
          <Link href="/admin/prix" className="underline underline-offset-2">
            Prix
          </Link>{" "}
          · {RULE_KIND_LABEL[rule.kind]} · modifiée le {formatDateTime(rule.updatedAt)}
        </>
      }
    >
      <div className="space-y-6">
        <RuleForm action={updateRuleAction.bind(null, rule.id)} listings={listings} initial={ruleToValues({ ...rule, listingIds: rule.listings.map((l) => l.id) })} submitLabel="Enregistrer" />
        <DeleteRuleForm action={deleteRuleAction.bind(null, rule.id)} />
      </div>
    </AdminPage>
  );
}
