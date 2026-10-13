import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know the custom font sizes from globals.css (@theme --text-*); otherwise it reads
 * `text-body-l` as a colour and silently drops `text-white` next to it.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["micro", "caption", "body", "body-l", "title-s", "title", "title-l", "display"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
