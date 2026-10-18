import { AlertTriangle, Download, FileText, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { DeclareButton } from "@/components/admin/declarations/StayActions";
import { isoDay } from "@/lib/admin/calendar";
import { countryName } from "@/lib/declarations/countries";
import { FORMAT_WARNING } from "@/lib/declarations/exporters";
import { declarationQueryString, parseDeclarationQuery } from "@/lib/declarations/filters";
import { DOCUMENT_TYPE_LABEL, travelerName } from "@/lib/declarations/traveler-form";
import { entryListings } from "@/lib/server/admin/bookings";
import { requireAdminPage } from "@/lib/server/authz";
import { capturesToday, searchDeclarations, undeclaredArrivals } from "@/lib/server/declarations/travelers";
import { AppError } from "@/lib/server/errors";

export const metadata: Metadata = { title: "Déclarations" };

const jjmmaaaa = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const input = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink";

/**
 * Déclarations (ADMIN): the travellers of the arrivals in a period (decrypted, every display audited), the stays of
 * yesterday and today not declared yet, the exports for the police declaration (CSV, printable fiches) and the
 * « déclaré » mark. The DGSN format is still to be validated.
 */
export default function Page({ searchParams }: PageProps<"/admin/declarations">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/declarations");
  const today = capturesToday();
  const q = parseDeclarationQuery(await searchParams, today);
  const [homes, undeclared, result] = await Promise.all([
    entryListings(access.organizationId),
    undeclaredArrivals(access.organizationId, today, 200),
    searchDeclarations(access, q).then(
      (stays) => ({ stays, error: null as string | null }),
      (e) => {
        if (e instanceof AppError) return { stays: [], error: e.message };
        throw e;
      },
    ),
  ]);
  const qs = declarationQueryString(q);
  const count = result.stays.reduce((s, x) => s + x.travelers.length, 0);

  return (
    <AdminPage title="Déclarations" intro="Fiches de police des voyageurs, export pour la télé-déclaration DGSN et taxe de séjour.">
      <div className="space-y-6">
        <p role="note" className="flex items-start gap-2 rounded-lg border-2 border-error bg-white p-4 font-medium text-error" data-testid="format-warning">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          {FORMAT_WARNING}
        </p>

        <section className={`rounded-lg border bg-white ${undeclared.count ? "border-2 border-error" : "border-line"}`} aria-labelledby="undeclared-title" data-testid="undeclared-arrivals">
          <h2 id="undeclared-title" className={`border-b border-line px-5 py-4 text-title-s font-semibold ${undeclared.count ? "text-error" : ""}`}>
            Arrivées d&apos;hier et d&apos;aujourd&apos;hui non déclarées ({undeclared.count})
          </h2>
          {undeclared.items.length === 0 ? (
            <p className="px-5 py-4 text-ink-muted">Toutes les arrivées récentes sont déclarées.</p>
          ) : (
            <ul className="divide-y divide-line">
              {undeclared.items.map((u) => (
                <li key={u.bookingId} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="undeclared-row" data-booking={u.bookingId}>
                  <div className="min-w-0">
                    <Link href={`/admin/declarations/${u.bookingId}`} className="font-semibold hover:underline">
                      {u.guestName ?? "Voyageur sans nom"}
                    </Link>
                    <p className="truncate text-caption text-ink-muted">
                      {u.listingTitle} · arrivée le {jjmmaaaa(u.checkIn)} · {u.travelers ? `${u.travelers} fiche(s), non déclarée(s)` : "aucune fiche"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form method="get" className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end" aria-label="Filtrer les déclarations">
          <div>
            <label htmlFor="du" className="mb-1 block text-micro font-medium">
              Arrivées du
            </label>
            <input id="du" name="du" type="date" defaultValue={isoDay(q.from)} className={input} />
          </div>
          <div>
            <label htmlFor="au" className="mb-1 block text-micro font-medium">
              au
            </label>
            <input id="au" name="au" type="date" defaultValue={isoDay(q.to)} className={input} />
          </div>
          <div>
            <label htmlFor="bien" className="mb-1 block text-micro font-medium">
              Bien
            </label>
            <select id="bien" name="bien" defaultValue={q.listingId ?? ""} className={input}>
              <option value="">Tous les biens</option>
              {homes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="q" className="mb-1 block text-micro font-medium">
              Nom ou n° de pièce
            </label>
            <input id="q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={80} className={input} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="nondeclares" value="1" defaultChecked={q.undeclaredOnly} className="size-5 accent-brand" />
              Non déclarés seulement
            </label>
            <button type="submit" className="h-11 rounded-sm bg-ink px-4 font-semibold text-white hover:bg-black">
              Afficher
            </button>
          </div>
        </form>

        <div className="flex flex-wrap gap-3">
          <a href={`/api/admin/declarations/export?${declarationQueryString(q, { format: "csv" })}`} className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2" data-testid="export-csv">
            <Download className="size-4" aria-hidden="true" />
            Exporter en CSV
          </a>
          <a href={`/api/admin/declarations/export?${declarationQueryString(q, { format: "fiches" })}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2">
            <FileText className="size-4" aria-hidden="true" />
            Fiches à imprimer (PDF)
          </a>
          <Link href="/admin/declarations/taxe" className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2">
            <Receipt className="size-4" aria-hidden="true" />
            Taxe de séjour par mois
          </Link>
        </div>
        <p className="text-caption text-ink-muted">
          Chaque affichage et chaque export sont enregistrés dans le journal. Les exports sont générés à la demande et ne sont jamais conservés sur le serveur.
        </p>

        <section aria-labelledby="list-title">
          <h2 id="list-title" className="mb-3 text-title-s font-semibold">
            Voyageurs arrivés du {jjmmaaaa(isoDay(q.from))} au {jjmmaaaa(isoDay(q.to))} ({count})
          </h2>
          {result.error && (
            <p role="alert" className="mb-3 rounded-sm border border-error bg-[#fdecea] p-3 text-error">
              {result.error}
            </p>
          )}
          {result.stays.length === 0 ? (
            <p className="rounded-lg border border-line bg-white p-5 text-ink-muted">Aucune fiche voyageur pour ces critères.</p>
          ) : (
            <ul className="space-y-3" data-testid="declaration-stays" data-query={qs}>
              {result.stays.map((s) => {
                const allDeclared = s.travelers.every((t) => t.declaredAt);
                return (
                  <li key={s.bookingId} className="rounded-lg border border-line bg-white p-4" data-testid="declaration-stay" data-booking={s.bookingId}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <Link href={`/admin/declarations/${s.bookingId}`} className="font-semibold hover:underline">
                          {s.guestName ?? "Voyageur sans nom"} · {s.listingTitle}
                        </Link>
                        <p className="text-caption text-ink-muted">
                          du {jjmmaaaa(s.checkIn)} au {jjmmaaaa(s.checkOut)} · {s.adults} adulte(s){s.children + s.infants ? `, ${s.children + s.infants} mineur(s)` : ""}
                        </p>
                      </div>
                      <DeclareButton bookingId={s.bookingId} declared={allDeclared} />
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-body">
                        <thead>
                          <tr className="text-left text-caption text-ink-muted">
                            <th className="py-1 font-medium">Voyageur</th>
                            <th className="py-1 font-medium">Nationalité</th>
                            <th className="py-1 font-medium">Pièce</th>
                            <th className="py-1 font-medium">Déclaré</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.travelers.map((t) => (
                            <tr key={t.id} className="border-t border-line-soft" data-testid="declaration-traveler">
                              <td className="py-1.5">
                                {travelerName(t.identity)}
                                {t.isMinor && <span className="ml-1 text-caption text-ink-muted">(mineur)</span>}
                              </td>
                              <td className="py-1.5">{countryName(t.identity.nationality)}</td>
                              <td className="py-1.5">{t.identity.documentType ? `${DOCUMENT_TYPE_LABEL[t.identity.documentType]} ${t.identity.documentNumber}` : "—"}</td>
                              <td className="py-1.5">{t.declaredAt ? jjmmaaaa(t.declaredAt) : <span className="font-medium text-error">non</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AdminPage>
  );
}
