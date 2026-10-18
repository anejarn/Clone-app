"use client";

import { Camera, CheckCircle2, ChevronDown, Clock, CloudUpload, MapPin, Play, RefreshCw, Wifi, WifiOff, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dayHeading } from "@/components/admin/tasks/TaskSummary";
import { TaskStatusBadge, TaskTypeBadge, TurnoverBadge } from "@/components/admin/tasks/TaskBadges";
import { compressPhoto } from "@/components/admin/tasks/compress";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { TaskStatus, TaskType } from "@/lib/generated/prisma/enums";
import { blockersMessage } from "@/lib/operations/checklist";
import { FIELD_NOTES_MAX, newOpId, type FieldOp } from "@/lib/operations/field-ops";
import { MY_DAY_SCOPE, OFFLINE_CACHE_PREFIX } from "@/lib/offline/clear";
import { allowOfflineDb } from "@/lib/offline/idb";
import { applyPending, flushQueue, localBlockers, pendingCount, RETRY_MESSAGE, type Conflict, type DaySnapshot, type DayTask, type QueuedOp } from "@/lib/offline/queue";
import { dismissConflicts, enqueue, fetchDay, forgetOtherUsers, idbQueueStore, listConflicts, listOps, loadSnapshot, saveSnapshot, sendOp } from "@/lib/offline/store";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const PAGES_CACHE = `${OFFLINE_CACHE_PREFIX}pages-v1`;
/** Unbranded operation (no opId/time/user yet). */
type NewOp = FieldOp extends infer O ? (O extends FieldOp ? Omit<O, "opId" | "at"> : never) : never;

/**
 * « Ma journée »: the agent's tasks of today and tomorrow, usable without network. The day comes from
 * GET /api/admin/journee and is kept in IndexedDB; every change (start, tick, photo, remark, finish) is queued there
 * first, shown at once, and sent in order as soon as the phone is online (lib/offline/queue.ts). The server decides
 * each change once and wins on conflicts (task taken back or cancelled meanwhile): refused changes are listed with
 * the reason. A service worker (public/sw-journee.js) keeps this page and the app's files for offline opening.
 */
export function MyDay({ user }: { user: { id: string; name: string } }) {
  const [snapshot, setSnapshot] = useState<DaySnapshot | null>(null);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const busy = useRef(false);
  const inflight = useRef(new Map<string, QueuedOp>());
  const again = useRef(false);

  const reloadLocal = useCallback(async () => {
    const [s, o, c] = await Promise.all([loadSnapshot(), listOps(), listConflicts()]);
    setSnapshot(s && s.user.id === user.id ? s : null);
    // Plus the changes being written right now, so that a reload in between doesn't hide them for a moment.
    const stored = o.filter((x) => x.userId === user.id);
    const writing = [...inflight.current.values()].filter((x) => !stored.some((y) => y.opId === x.opId));
    setOps([...stored, ...writing]);
    setConflicts(c);
  }, [user.id]);

  /** Sends the queue, then fetches the day again. Re-runs once if changes were queued meanwhile. */
  const sync = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    setSyncing(true);
    try {
      do {
        again.current = false;
        const titles = new Map((await loadSnapshot())?.tasks.map((t) => [t.id, `${t.title} · ${t.listingTitle}`]) ?? []);
        const report = await flushQueue(idbQueueStore, user.id, sendOp, (id) => titles.get(id) ?? "Tâche");
        setNotice(report.stopped ? report.stopped.message : null);
        if (report.stopped?.reason === "offline") break;
        const day = await fetchDay();
        if (day.ok) {
          if (day.day.user.id !== user.id) {
            // Another account is signed in on this browser now: this page is not theirs.
            window.location.reload();
            return;
          }
          await saveSnapshot(day.day);
        } else if (day.status === 401 || day.status === 403) setNotice(RETRY_MESSAGE.auth);
        else if (day.status === 0) setNotice(RETRY_MESSAGE.offline);
        await reloadLocal();
      } while (again.current);
    } catch {
      setStorageError(true);
    } finally {
      busy.current = false;
      setSyncing(false);
      await reloadLocal().catch(() => {});
    }
  }, [reloadLocal, user.id]);

  // Load what the phone has, then refresh from the server when online.
  useEffect(() => {
    let cancelled = false;
    allowOfflineDb();
    (async () => {
      try {
        await forgetOtherUsers(user.id);
        await reloadLocal();
      } catch {
        setStorageError(true);
      }
      if (cancelled) return;
      setLoaded(true);
      setOnline(navigator.onLine);
      if (navigator.onLine) await sync();
    })();
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      cancelled = true;
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [reloadLocal, sync, user.id]);

  // The service worker: keeps this page and the app's files for offline use (production builds only).
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let stop = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw-journee.js", { scope: MY_DAY_SCOPE, updateViaCache: "none" });
        // Not navigator.serviceWorker.ready: a page reached by a client-side navigation (e.g. from /login) was created
        // outside the worker's scope, and `ready` would never resolve for it.
        const worker = await activeWorker(reg);
        if (navigator.onLine) {
          const urls = [
            ...performance.getEntriesByType("resource").map((e) => e.name),
            ...Array.from(document.scripts, (s) => s.src),
            ...Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet],link[rel=preload]"), (l) => l.href),
          ].filter(Boolean);
          worker.postMessage({ type: "precache", urls: [...new Set(urls)] });
        }
        for (let i = 0; i < 40 && !stop; i += 1) {
          const page = await caches.open(PAGES_CACHE).then((c) => c.match(MY_DAY_SCOPE));
          if (page) {
            setOfflineReady(true);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        // No service worker (private browsing…): the page still works online, and keeps its queue offline.
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  const queue = useCallback(
    async (partial: NewOp) => {
      const op = { ...partial, opId: newOpId(), at: new Date().toISOString(), userId: user.id, queuedAt: new Date().toISOString() } as QueuedOp;
      // Shown at once (a ticked box stays ticked), stored right after.
      inflight.current.set(op.opId, op);
      setOps((prev) => [...prev, op]);
      try {
        await enqueue(op);
        inflight.current.delete(op.opId);
        await reloadLocal();
      } catch {
        inflight.current.delete(op.opId);
        setStorageError(true);
        return;
      }
      if (navigator.onLine) void sync();
    },
    [reloadLocal, sync, user.id],
  );

  const tasks = useMemo(() => (snapshot ? applyPending(snapshot.tasks, ops) : []), [snapshot, ops]);
  const pending = pendingCount(ops, user.id);
  const byDay = (d: string) => tasks.filter((t) => t.scheduledDate === d);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-3" aria-live="polite">
        <span
          data-testid="network-status"
          data-online={online}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-caption font-semibold",
            online ? "border-success bg-[#e8f5e9] text-[#1b5e20]" : "border-ink bg-ink text-white",
          )}
        >
          {online ? <Wifi className="size-3.5" aria-hidden="true" /> : <WifiOff className="size-3.5" aria-hidden="true" />}
          {online ? "En ligne" : "Hors connexion"}
        </span>
        <span data-testid="pending-count" data-count={pending} className={cn("inline-flex items-center gap-1.5 text-caption", pending ? "font-semibold" : "text-ink-muted")}>
          <CloudUpload className="size-3.5" aria-hidden="true" />
          {pending === 0 ? "Tout est envoyé" : `${pending} changement${pending > 1 ? "s" : ""} en attente d'envoi`}
        </span>
        {offlineReady && (
          <span data-testid="offline-ready" className="text-caption text-ink-muted">
            · Disponible hors connexion
          </span>
        )}
        <Button type="button" variant="outline" size="sm" className="ml-auto h-9" disabled={!online || syncing} onClick={() => void sync()}>
          <RefreshCw className={cn("size-4", syncing && "animate-spin")} aria-hidden="true" />
          {syncing ? "Synchronisation…" : "Synchroniser"}
        </Button>
        {snapshot && <p className="w-full text-micro text-ink-muted">Données du {new Date(snapshot.generatedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "short", timeStyle: "short" })}</p>}
      </div>

      {notice && pending > 0 && (
        <p role="status" className="rounded-sm bg-surface-3 p-3" data-testid="sync-notice">
          {notice}
        </p>
      )}
      {storageError && (
        <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
          Ce navigateur ne permet pas d&apos;enregistrer la journée sur l&apos;appareil (navigation privée ?) : elle ne fonctionnera qu&apos;avec du réseau.
        </p>
      )}
      {conflicts.length > 0 && (
        <div role="alert" className="rounded-lg border border-error bg-[#fdecea] p-4 text-error" data-testid="sync-conflicts">
          <p className="font-semibold">Certains changements n&apos;ont pas été enregistrés :</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {conflicts.map((c) => (
              <li key={c.opId}>
                <strong>{c.taskTitle}</strong> : {c.message}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={async () => {
              await dismissConflicts();
              await reloadLocal();
            }}
          >
            J&apos;ai compris
          </Button>
        </div>
      )}

      {!loaded ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : !snapshot ? (
        <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">
          {online ? "Chargement de votre journée…" : "Pas encore de journée enregistrée sur cet appareil : ouvrez cette page une fois avec du réseau."}
        </p>
      ) : (
        snapshot.days.map((d) => {
          const list = byDay(d);
          return (
            <section key={d} aria-labelledby={`jour-${d}`} data-testid="day" data-day={d}>
              <h2 id={`jour-${d}`} className="mb-2 text-title-s font-semibold">
                {dayHeading(d, snapshot.today)} <span className="font-normal text-ink-muted">· {list.length} tâche{list.length > 1 ? "s" : ""}</span>
              </h2>
              {list.length === 0 ? (
                <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">Aucune tâche ce jour-là.</p>
              ) : (
                <ul className="space-y-3">
                  {list.map((t) => (
                    <DayTaskCard key={t.id} task={t} online={online} queue={queue} />
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

/** The registration's worker once it is active. */
function activeWorker(reg: ServiceWorkerRegistration): Promise<ServiceWorker> {
  return new Promise((resolve) => {
    const check = () => {
      if (reg.active) resolve(reg.active);
    };
    check();
    for (const w of [reg.installing, reg.waiting]) w?.addEventListener("statechange", check);
    reg.addEventListener("updatefound", () => reg.installing?.addEventListener("statechange", check));
  });
}

function DayTaskCard({ task, online, queue }: { task: DayTask; online: boolean; queue: (op: NewOp) => Promise<void> }) {
  const [open, setOpen] = useState(task.status === "IN_PROGRESS");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState(task.fieldNotes ?? "");
  const active = task.status === "IN_PROGRESS";
  const checked = task.items.filter((i) => i.checked).length;
  const blockers = localBlockers(task);
  const missing = blockers.unchecked.length + blockers.missingPhotos.length;
  const panel = `tache-${task.id}`;

  async function addPhoto(itemId: string, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    setError(null);
    if (!file) return;
    if (!ACCEPT.includes(file.type)) return setError("Format non accepté : JPEG, PNG ou WebP.");
    const small = await compressPhoto(file);
    if (small.size > MAX_PHOTO_BYTES) return setError(`Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.`);
    await queue({ kind: "photo", taskId: task.id, itemId, photo: small } as NewOp);
    setMessage(online ? "Photo ajoutée." : "Photo enregistrée sur le téléphone : elle sera envoyée au retour du réseau.");
  }

  return (
    <li className="rounded-lg border border-line bg-white" data-testid="day-task" data-task={task.id} data-status={task.status}>
      <button type="button" className="flex w-full items-start justify-between gap-3 p-3 text-left md:px-4" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-caption font-semibold text-ink-muted">
            <Clock className="size-3.5" aria-hidden="true" />
            {task.startTime}–{task.endTime}
          </span>
          <span className="mt-0.5 block font-semibold">
            {task.title} · {task.listingTitle}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <TaskTypeBadge type={task.type as TaskType} />
            <TaskStatusBadge status={task.status as TaskStatus} />
            {task.turnover && <TurnoverBadge />}
            <span className="text-caption text-ink-muted">
              {checked}/{task.items.length} coché{checked > 1 ? "s" : ""}
            </span>
            {(task.pendingOps ?? 0) > 0 && <span className="text-caption font-semibold text-brand-deep">· non envoyé</span>}
          </span>
        </span>
        <ChevronDown className={cn("mt-1 size-5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div id={panel} className="space-y-4 border-t border-line p-3 md:px-4">
          <p className="flex items-start gap-1.5 text-caption text-ink-muted">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {task.address} · {task.placeName}
          </p>
          {task.booking && (
            <p className="text-caption">
              {task.booking.guestName ?? "Voyageur"}
              {task.booking.guests > 0 && ` · ${task.booking.guests} voyageur${task.booking.guests > 1 ? "s" : ""}`}
              {task.booking.guestPhone && (
                <>
                  {" · "}
                  <a href={`tel:${task.booking.guestPhone.replace(/\s/g, "")}`} className="underline underline-offset-2">
                    {task.booking.guestPhone}
                  </a>
                </>
              )}
              {task.booking.cancelled && <span className="ml-2 font-semibold text-error">Séjour annulé</span>}
            </p>
          )}
          {task.notes && (
            <div className="rounded-sm bg-surface-2 p-2">
              <p className="text-micro font-medium text-ink-muted">Consignes</p>
              <p className="whitespace-pre-line">{task.notes}</p>
            </div>
          )}

          <div aria-live="polite">
            {error && (
              <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error" data-testid="day-error">
                {error}
              </p>
            )}
            {message && !error && (
              <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
                {message}
              </p>
            )}
          </div>

          {task.status === "TODO" && (
            <Button
              type="button"
              variant="primary"
              className="w-full sm:w-auto"
              onClick={async () => {
                setError(null);
                await queue({ kind: "start", taskId: task.id });
                setMessage("Tâche commencée.");
              }}
            >
              <Play className="size-4" aria-hidden="true" />
              Commencer la tâche
            </Button>
          )}

          <ul className="divide-y divide-line rounded-sm border border-line" aria-label="Check-list">
            {task.items.map((item) => {
              const photos = item.photos.length + (item.pendingPhotos ?? 0);
              return (
                <li key={item.id} className="px-3 py-2.5" data-testid="day-item" data-checked={item.checked}>
                  <label className="flex min-h-11 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-6 shrink-0 accent-brand"
                      checked={item.checked}
                      disabled={!active}
                      onChange={(e) => {
                        setError(null);
                        void queue({ kind: "check", taskId: task.id, itemId: item.id, checked: e.target.checked });
                      }}
                    />
                    <span className={cn("pt-0.5", item.checked && "text-ink-muted line-through")}>{item.label}</span>
                  </label>
                  {item.requiresPhoto && (
                    <div className="mt-1 pl-9">
                      <p className={cn("text-caption font-medium", photos ? "text-success" : "text-error")}>
                        {photos ? `Photo ajoutée (${photos})` : "Photo obligatoire"}
                        {(item.pendingPhotos ?? 0) > 0 && <span className="font-normal text-ink-muted"> · {item.pendingPhotos} en attente d&apos;envoi</span>}
                      </p>
                      {active && (
                        <label className="mt-2 inline-flex h-11 cursor-pointer items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
                          <Camera className="size-4" aria-hidden="true" />
                          Prendre une photo
                          <input
                            type="file"
                            accept={ACCEPT.join(",")}
                            capture="environment"
                            className="sr-only"
                            aria-label={`Photo : ${item.label}`}
                            onChange={(e) => void addPhoto(item.id, e.currentTarget)}
                          />
                        </label>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {task.status !== "CANCELLED" && (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                await queue({ kind: "note", taskId: task.id, notes: notes.trim() });
                setMessage("Remarque enregistrée.");
              }}
            >
              <label className="block">
                <span className="mb-1 block text-micro font-medium">Remarques (pour l&apos;équipe)</span>
                <textarea
                  value={notes}
                  maxLength={FIELD_NOTES_MAX}
                  rows={2}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-sm border border-ink-faint bg-white px-3 py-2 outline-none focus:border-ink focus:ring-1 focus:ring-ink"
                />
              </label>
              <Button type="submit" variant="outline" size="sm" disabled={notes.trim() === (task.fieldNotes ?? "")}>
                Enregistrer la remarque
              </Button>
            </form>
          )}

          {active && (
            <div className="space-y-2">
              <p className="text-caption text-ink-muted">{missing === 0 ? "Tout est prêt." : `Encore ${missing} élément${missing > 1 ? "s" : ""} à cocher ou à photographier.`}</p>
              <Button
                type="button"
                variant="dark"
                className="w-full sm:w-auto"
                onClick={async () => {
                  setMessage(null);
                  if (missing > 0) return setError(blockersMessage(blockers));
                  setError(null);
                  await queue({ kind: "complete", taskId: task.id });
                  setMessage(online ? "Tâche terminée. Merci !" : "Tâche terminée sur le téléphone : elle sera envoyée au retour du réseau.");
                }}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Terminer la tâche
              </Button>
            </div>
          )}

          {online && (
            <a href={`/admin/pannes/nouvelle?tache=${task.id}`} className="inline-flex items-center gap-2 font-semibold underline underline-offset-2">
              <Wrench className="size-4" aria-hidden="true" />
              Signaler une panne
            </a>
          )}
        </div>
      )}
    </li>
  );
}
