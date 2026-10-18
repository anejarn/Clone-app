/**
 * Shrinks a phone photo before upload: at most MAX_SIDE pixels on its longer side, re-encoded as JPEG. Phones take
 * 3–8 MB pictures; the server takes 5 MB at most and the agent may be on a weak mobile connection. Small files (under
 * SKIP_BELOW) and anything the browser can't decode are sent as they are; the server checks the real type anyway.
 */
const MAX_SIDE = 1600;
const SKIP_BELOW = 600 * 1024;
const QUALITY = 0.82;

export async function compressPhoto(file: File): Promise<File> {
  if (file.size < SKIP_BELOW || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
