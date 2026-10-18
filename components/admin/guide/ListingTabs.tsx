import Link from "next/link";

/** Tabs of a home's pages in Biens: its fiche and its welcome guide. */
export function ListingTabs({ listingId, current }: { listingId: string; current: "fiche" | "guide" }) {
  const tabs = [
    { key: "fiche", label: "Fiche", href: `/admin/biens/${listingId}` },
    { key: "guide", label: "Guide d'accueil", href: `/admin/biens/${listingId}/guide` },
  ] as const;
  return (
    <nav aria-label="Pages du bien" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-4 py-2.5 font-semibold ${t.key === current ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
