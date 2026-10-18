"use client";

import { Camera, CheckCircle2, Play, Trash2 } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { completeTaskAction, deleteTaskPhotoAction, startTaskAction, toggleItemAction, uploadTaskPhotoAction, type WorkResult } from "@/app/admin/mes-taches/actions";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";
import { compressPhoto } from "./compress";

export interface WorkItem {
  id: string;
  label: string;
  requiresPhoto: boolean;
  checked: boolean;
  photos: { id: string; url: string }[];
}

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

/**
 * Doing a task on a phone: start, tick the items, take the required photos (the camera opens directly on phones),
 * finish. Each step is one server action (app/admin/mes-taches/actions.ts) that checks access and the rules again;
 * the page re-renders from the server after each one. "Terminer" is refused by the server while an item is unticked
 * or a required photo is missing, whatever this page shows.
 */
export function TaskWork({ taskId, status, items }: { taskId: string; status: TaskStatus; items: WorkItem[] }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<WorkResult>({});
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(items, (state, change: { id: string; checked: boolean }) =>
    state.map((i) => (i.id === change.id ? { ...i, checked: change.checked } : i)),
  );
  const active = status === "IN_PROGRESS";
  const missing = optimistic.filter((i) => !i.checked || (i.requiresPhoto && i.photos.length === 0)).length;

  function run(fn: () => Promise<WorkResult>, itemId: string | null = null) {
    setFeedback({});
    setBusyItem(itemId);
    start(async () => {
      const r = await fn();
      setFeedback(r);
      setBusyItem(null);
    });
  }

  function toggle(item: WorkItem, checked: boolean) {
    setFeedback({});
    start(async () => {
      setOptimistic({ id: item.id, checked });
      const r = await toggleItemAction(taskId, item.id, checked);
      if (r.error) setFeedback(r);
    });
  }

  function upload(item: WorkItem, input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    run(async () => {
      if (!ACCEPT.includes(file.type)) return { error: "Format non accepté : JPEG, PNG ou WebP." };
      const small = await compressPhoto(file);
      if (small.size > MAX_PHOTO_BYTES) return { error: `Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.` };
      const form = new FormData();
      form.set("photo", small);
      const r = await uploadTaskPhotoAction(taskId, item.id, form);
      input.value = "";
      return r;
    }, item.id);
  }

  return (
    <section aria-labelledby="checklist-title" className="space-y-4">
      <div aria-live="polite">
        {feedback.error && (
          <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error" data-testid="work-error">
            {feedback.error}
          </p>
        )}
        {feedback.message && (
          <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
            {feedback.message}
          </p>
        )}
      </div>

      {status === "TODO" && (
        <Button type="button" variant="primary" className="w-full sm:w-auto" disabled={pending} onClick={() => run(() => startTaskAction(taskId))}>
          <Play className="size-4" aria-hidden="true" />
          Commencer la tâche
        </Button>
      )}

      <div className="rounded-lg border border-line bg-white">
        <h2 id="checklist-title" className="border-b border-line px-4 py-3 text-title-s font-semibold">
          Check-list
        </h2>
        {!active && status !== "DONE" && <p className="px-4 pt-3 text-caption text-ink-muted">Commencez la tâche pour cocher et prendre les photos.</p>}
        <ul className="divide-y divide-line" data-testid="checklist">
          {optimistic.map((item) => (
            <li key={item.id} className="px-4 py-3" data-testid="checklist-item" data-checked={item.checked}>
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 size-6 shrink-0 accent-brand"
                  checked={item.checked}
                  disabled={!active || pending}
                  onChange={(e) => toggle(item, e.target.checked)}
                />
                <span className={cn("pt-0.5", item.checked && "text-ink-muted line-through")}>{item.label}</span>
              </label>
              {item.requiresPhoto && (
                <div className="mt-2 pl-9">
                  <p className={cn("text-caption font-medium", item.photos.length ? "text-success" : "text-error")}>
                    {item.photos.length ? `Photo ajoutée (${item.photos.length})` : "Photo obligatoire"}
                  </p>
                  {item.photos.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {item.photos.map((p, i) => (
                        <li key={p.id} className="relative">
                          {/* Plain <img>: task photos are staff-only (app/media), which the image optimizer can't fetch. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt={`${item.label}, photo ${i + 1}`} className="size-20 rounded-sm border border-line object-cover" loading="lazy" />
                          {active && (
                            <button
                              type="button"
                              className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full border border-line bg-white text-error shadow-e1"
                              aria-label={`Supprimer la photo ${i + 1} : ${item.label}`}
                              disabled={pending}
                              onClick={() => {
                                if (confirm("Supprimer cette photo ?")) run(() => deleteTaskPhotoAction(taskId, p.id), item.id);
                              }}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {active && (
                    <label className="mt-2 inline-flex h-11 cursor-pointer items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
                      <Camera className="size-4" aria-hidden="true" />
                      {busyItem === item.id ? "Envoi…" : "Prendre une photo"}
                      <input
                        type="file"
                        accept={ACCEPT.join(",")}
                        capture="environment"
                        className="sr-only"
                        aria-label={`Photo : ${item.label}`}
                        disabled={pending}
                        onChange={(e) => upload(item, e.currentTarget)}
                      />
                    </label>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {active && (
        <div className="space-y-2">
          <p className="text-caption text-ink-muted">{missing === 0 ? "Tout est prêt." : `Encore ${missing} élément${missing > 1 ? "s" : ""} à cocher ou à photographier.`}</p>
          <Button type="button" variant="dark" className="w-full sm:w-auto" disabled={pending} onClick={() => run(() => completeTaskAction(taskId))}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Terminer la tâche
          </Button>
        </div>
      )}
    </section>
  );
}
