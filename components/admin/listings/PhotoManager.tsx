"use client";

import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { deletePhotoAction, movePhotoAction, uploadPhotoAction } from "@/app/admin/biens/actions";
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_LISTING } from "@/lib/storage/images";

export interface PhotoItem {
  id: string;
  url: string;
  alt: string;
}

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const iconBtn =
  "inline-grid size-9 place-items-center rounded-full border border-line bg-white text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Photos of a listing: upload (several files, sent one by one), order, cover (the first photo) and deletion.
 * The server checks each file's real type and size again (lib/storage/images.ts).
 */
export function PhotoManager({ listingId, photos }: { listingId: string; photos: PhotoItem[] }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function run(fn: () => Promise<{ error?: string }>) {
    setErrors([]);
    start(async () => {
      const r = await fn();
      if (r.error) setErrors([r.error]);
    });
  }

  function upload(files: File[]) {
    setErrors([]);
    start(async () => {
      const problems: string[] = [];
      for (const [i, file] of files.entries()) {
        setProgress(`Envoi de la photo ${i + 1} sur ${files.length}…`);
        if (!ACCEPT.includes(file.type)) {
          problems.push(`${file.name} : format non accepté (JPEG, PNG ou WebP).`);
          continue;
        }
        if (file.size > MAX_PHOTO_BYTES) {
          problems.push(`${file.name} : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.`);
          continue;
        }
        const form = new FormData();
        form.set("photo", file);
        const r = await uploadPhotoAction(listingId, form);
        if (r.error) problems.push(`${file.name} : ${r.error}`);
      }
      setProgress(null);
      setErrors(problems);
      if (fileInput.current) fileInput.current.value = "";
    });
  }

  return (
    <section aria-labelledby="photos-title" className="rounded-lg border border-line bg-white p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="photos-title" className="text-title-s font-semibold">
          Photos <span className="font-normal text-ink-muted">({photos.length}/{MAX_PHOTOS_PER_LISTING})</span>
        </h2>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-sm bg-brand px-4 font-semibold text-white hover:bg-brand-strong has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-line has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
          <ImagePlus className="size-4" aria-hidden="true" />
          Ajouter des photos
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT.join(",")}
            multiple
            disabled={pending || photos.length >= MAX_PHOTOS_PER_LISTING}
            className="sr-only"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) upload(files);
            }}
          />
        </label>
      </div>
      <p className="mt-1 text-caption text-ink-muted">JPEG, PNG ou WebP, 5 Mo au maximum par photo. La première photo est la couverture.</p>

      <div aria-live="polite" className="mt-2">
        {progress && <p>{progress}</p>}
        {errors.length > 0 && (
          <ul role="alert" className="space-y-1 text-error">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      {photos.length === 0 ? (
        <p className="mt-4 rounded-sm border border-dashed border-sep p-6 text-center text-ink-muted">Aucune photo pour l&apos;instant.</p>
      ) : (
        <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="photos">
          {photos.map((p, i) => (
            <li key={p.id} className="overflow-hidden rounded-md border border-line">
              <div className="relative aspect-[4/3] bg-surface-3">
                {/* Plain <img>: drafts' photos are staff-only (app/media), which the image optimizer can't fetch. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.alt || `Photo ${i + 1}`} className="size-full object-cover" loading="lazy" />
                {i === 0 && (
                  <span className="absolute left-2 top-2 rounded-pill bg-white px-2 py-0.5 text-micro font-semibold shadow-e1">Couverture</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 p-2">
                <div className="flex gap-1">
                  <button type="button" className={iconBtn} disabled={pending || i === 0} aria-label={`Photo ${i + 1} : déplacer avant`} onClick={() => run(() => movePhotoAction(listingId, p.id, "up"))}>
                    <ArrowLeft className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={pending || i === photos.length - 1}
                    aria-label={`Photo ${i + 1} : déplacer après`}
                    onClick={() => run(() => movePhotoAction(listingId, p.id, "down"))}
                  >
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={iconBtn} disabled={pending || i === 0} aria-label={`Photo ${i + 1} : mettre en couverture`} onClick={() => run(() => movePhotoAction(listingId, p.id, "cover"))}>
                    <Star className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  className={`${iconBtn} text-error`}
                  disabled={pending}
                  aria-label={`Photo ${i + 1} : supprimer`}
                  onClick={() => {
                    if (confirm("Supprimer cette photo ?")) run(() => deletePhotoAction(listingId, p.id));
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
