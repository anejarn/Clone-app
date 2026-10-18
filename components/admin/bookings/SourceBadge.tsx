import { SOURCE_LABEL, SOURCES, sourceStyle } from "@/lib/admin/booking-sources";
import type { BookingSource } from "@/lib/generated/prisma/enums";

/** A small swatch in the source's calendar colour (hatched for owner blocks). Decorative: the label says it. */
export function SourceSwatch({ source, className = "size-3.5" }: { source: BookingSource; className?: string }) {
  const s = sourceStyle(source);
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-[3px] border ${className}`} style={{ background: s.background, borderColor: s.border }} />;
}

/** Swatch + name of the source. */
export function SourceBadge({ source }: { source: BookingSource }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-white px-2.5 py-0.5 text-caption font-medium" data-source={source}>
      <SourceSwatch source={source} className="size-3" />
      {SOURCE_LABEL[source]}
    </span>
  );
}

/** Legend of the calendar colours. */
export function SourceLegend() {
  return (
    <ul aria-label="Légende des sources" data-testid="calendar-legend" className="flex flex-wrap gap-x-4 gap-y-2 text-caption">
      {SOURCES.map((s) => (
        <li key={s} className="flex items-center gap-1.5" data-source={s}>
          <SourceSwatch source={s} />
          {SOURCE_LABEL[s]}
        </li>
      ))}
    </ul>
  );
}
