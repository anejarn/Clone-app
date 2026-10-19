import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import type { OwnerMessages } from "@/lib/i18n/owner";

/** A booking source in the owner's language: platform names as they are, the others translated. */
export function sourceLabel(source: string, t: OwnerMessages): string {
  if (source === "DIRECT" || source === "OTHER" || source === "OWNER") return t.sources[source];
  return SOURCE_LABEL[source as keyof typeof SOURCE_LABEL] ?? source;
}
