import { CalendarDays, CheckCircle2, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { adjustmentLabel, RULE_KIND_LABEL, ruleDatesLabel, ruleScopeLabel } from "@/lib/admin/price-rule-form";
import { cn } from "@/lib/cn";
import { pluralize } from "@/lib/format";
import { listPriceRules, ruleListingOptions, type AdminPriceRule, type RulePeriod } from "@/lib/server/admin/prices";
import { staffToday } from "@/lib/server/admin/bookings";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Prix" };

/** URL values of the filters (French, readable in the address bar) and what they mean. */
const KIND = { saison: "SEASON", evenement: "EVENT" } as const;
const PERIOD = { "a-venir": "upcoming", "en-cours": "current", passees: "past", toutes: "all" } as const satisfies Record<string, RulePeriod>;

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const pick = <T extends Record<string, string>>(map: T, v: string): T[keyof T] | undefined => (Object.hasOwn(map, v) ? map[v as keyof T] : undefined);

export default function Page({ searchParams }: PageProps<"/admin/prix">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const { organizationId } = await requireAdminPage("/admin/prix");
  const sp = await searchParams;
  const today = staffToday();
  const listings = await ruleListingOptions(organizationId);
  const raw = { q: one(sp.q).slice(0, 100), type: one(sp.type), bien: one(sp.bien), periode: one(sp.periode) };
  const bien = listings.some((l) => l.id === raw.bien) ? raw.bien : "";
  const rules = await listPriceRules(organizationId, { q: raw.q || undefined, kind: pick(KIND, raw.type), listingId: bien || undefined, period: pick(PERIOD, raw.periode) ?? "upcoming" }, today);
  const notice = sp.cree ? "Règle créée." : sp.modifie ? "Modifications enregistrées." : sp.supprime ? "Règle supprimée." : null;
  const highlight = one(sp.cree) || one(sp.modifie);
  const select = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";

  return (
    <AdminPage
      title="Prix"
      intro="Saisons et événements : ils changent le prix de base des biens (en pourcentage, ou un prix fixe pour un bien) et peuvent allonger le séjour minimum. Le prix de base et le séjour minimum de chaque bien se modifient dans Biens."
    >
      {notice && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-brand-tint p-4 font-medium text-brand-deep">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Link href="/admin/prix/apercu" className="inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-ink px-5 font-semibold hover:bg-surface-2">
          <CalendarDays className="size-4" aria-hidden="true" />
          Calendrier des prix
        </Link>
        <Link href="/admin/prix/nouvelle" className="inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong">
          <Plus className="size-4" aria-hidden="true" />
          Nouvelle règle
        </Link>
      </div>

      <form method="get" role="search" aria-label="Filtrer les règles de prix" className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_2fr_1fr_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Recherche</span>
          <input name="q" type="search" defaultValue={raw.q} placeholder="Nom de la règle" className={select} />
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Type</span>
          <select name="type" defaultValue={raw.type} className={select}>
            <option value="">Tous</option>
            <option value="saison">Saisons</option>
            <option value="evenement">Événements</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Bien</span>
          <select name="bien" defaultValue={bien} className={select}>
            <option value="">Tous les biens</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Période</span>
          <select name="periode" defaultValue={raw.periode || "a-venir"} className={select}>
            <option value="a-venir">En cours et à venir</option>
            <option value="en-cours">En cours aujourd&apos;hui</option>
            <option value="passees">Passées</option>
            <option value="toutes">Toutes</option>
          </select>
        </label>
        <button type="submit" className="h-11 rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black">
          Filtrer
        </button>
      </form>

      <p className="mt-4 text-ink-muted" data-testid="rule-count">
        {pluralize(rules.length, "règle", "règles")}
      </p>

      {rules.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-white p-5 text-ink-muted">Aucune règle ne correspond à ces critères : les biens sont à leur prix de base.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white" data-testid="rule-rows">
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} highlight={r.id === highlight} />
          ))}
        </ul>
      )}
    </AdminPage>
  );
}

function RuleRow({ rule: r, highlight }: { rule: AdminPriceRule; highlight: boolean }) {
  const adjustment = adjustmentLabel(r.adjustmentType === "FIXED" ? { type: "FIXED", cents: r.fixedCents ?? 0 } : { type: "PERCENT", bps: r.percentBps ?? 0 });
  return (
    <li className={cn("flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between md:gap-4 md:p-4", highlight && "bg-brand-tint")} data-testid="rule-row" data-rule={r.id}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-pill px-2 py-0.5 text-micro font-semibold", r.kind === "EVENT" ? "bg-ink text-white" : "bg-surface-3 text-ink")}>{RULE_KIND_LABEL[r.kind]}</span>
          <Link href={`/admin/prix/${r.id}`} className="min-w-0 break-words font-semibold hover:underline">
            {r.name}
          </Link>
        </p>
        <p className="mt-1 text-caption text-ink-muted">
          {ruleDatesLabel(r)} · {ruleScopeLabel(r)}
          {r.priority > 0 && ` · priorité ${r.priority}`}
        </p>
      </div>
      <p className="shrink-0 md:text-right" data-testid="rule-effect">
        <span className="font-semibold">{adjustment}</span>
        {r.minNights !== null && <span className="block text-caption text-ink-muted">séjour minimum {pluralize(r.minNights, "nuit", "nuits")}</span>}
      </p>
    </li>
  );
}
