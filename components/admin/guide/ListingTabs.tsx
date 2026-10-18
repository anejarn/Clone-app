import Link from "next/link";

/** Tabs of a home's pages in Biens: its fiche, its welcome guide and its platforms (calendar sync, Lot 7). */
export function ListingTabs({ listingId, current }: { listingId: string; current: "fiche" | "guide" | "plateformes" }) {
  const tabs = [
    { key: "fiche", label: "Fiche", href: `/admin/biens/${listingId}` },
    { key: "guide", label: "Guide d'accueil", href: `/admin/biens/${listingId}/guide` },
    { key: "plateformes", label: "Plateformes", href: `/admin/biens/${listingId}/plateformes` },
  ] as const;
  return (
    <nav aria-label="Pages du bien" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 font-semibold ${t.key === current ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
