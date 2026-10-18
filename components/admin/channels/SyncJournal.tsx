import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { OUTCOME_LABEL, TRIGGER_LABEL } from "@/lib/admin/channels";
import { formatDateTime } from "@/lib/format";
import type { RunView } from "@/lib/server/channels/conflicts";

/** The sync journal (Lot 7): one row per read of a feed. Server component. */
export function SyncJournal({ runs, showListing }: { runs: RunView[]; showListing: boolean }) {
  if (!runs.length) return <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">Aucune synchronisation pour l&apos;instant.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full min-w-[640px] text-left text-body" data-testid="sync-journal">
        <thead className="border-b border-line text-caption text-ink-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Heure</th>
            {showListing && <th className="px-3 py-2 font-semibold">Bien</th>}
            <th className="px-3 py-2 font-semibold">Plateforme</th>
            <th className="px-3 py-2 font-semibold">Résultat</th>
            <th className="px-3 py-2 font-semibold">Événements</th>
            <th className="px-3 py-2 font-semibold">Changements</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDateTime(r.startedAt)}
                <span className="block text-caption text-ink-muted">{TRIGGER_LABEL[r.trigger]}</span>
              </td>
              {showListing && <td className="px-3 py-2">{r.listingTitle}</td>}
              <td className="px-3 py-2">{SOURCE_LABEL[r.source]}</td>
              <td className={`px-3 py-2 ${r.outcome === "ERROR" ? "text-error" : ""}`}>
                {r.outcome ? OUTCOME_LABEL[r.outcome] : "En cours"}
                {r.httpStatus ? ` · HTTP ${r.httpStatus}` : ""}
                {r.errorMessage && <span className="block text-caption">{r.errorMessage}</span>}
              </td>
              <td className="px-3 py-2">{r.eventsSeen}</td>
              <td className="px-3 py-2 text-caption">
                {r.created} créée(s) · {r.updated} modifiée(s) · {r.cancelled} annulée(s) · <span className={r.conflicts ? "font-semibold text-error" : ""}>{r.conflicts} conflit(s)</span> · {r.ignored} ignoré(s)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
