/**
 * Listing photo checks, before anything is stored. The type is read from the file's first bytes, never from its
 * name or the browser's Content-Type: a renamed file or a forged header can't slip another format in.
 */

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_LISTING = 30;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
export const IMAGE_EXTENSION: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const EXTENSION_TYPE: Record<string, ImageType> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);

/** JPEG, PNG or WebP by magic number; null for anything else. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export type PhotoCheck = { ok: true; type: ImageType } | { ok: false; message: string };

export function checkPhoto(bytes: Uint8Array): PhotoCheck {
  if (bytes.byteLength === 0) return { ok: false, message: "Le fichier est vide." };
  if (bytes.byteLength > MAX_PHOTO_BYTES) return { ok: false, message: `Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.` };
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, message: "Format non accepté : JPEG, PNG ou WebP uniquement." };
  return { ok: true, type };
}
