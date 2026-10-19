"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { formValues } from "@/lib/guide/form";
import { DEFAULT_GUEST_LOCALE, matchLocale } from "@/lib/i18n/locales";
import { fill, messages } from "@/lib/i18n/messages";
import { createGuestRequest } from "@/lib/server/concierge/guest";
import { clientKey } from "@/lib/server/rate-limit";

/**
 * The guest's service request from the welcome guide (Lot 4b), no account: the guide link's token is the key, and
 * everything is checked again on the server (lib/server/concierge/guest.ts: the link, the stay window, the service of
 * the link's organization, the lead time, the rate limits). Messages come back in the guest's language.
 */

export interface GuestRequestState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** The submission's values, to put back in the form after an error. */
  values?: Record<string, string>;
  optionIds?: string[];
  message?: string;
}

const FIELD_OF: Record<string, string> = { outsideStay: "date", tooSoon: "date", past: "date" };

export async function requestServiceAction(token: string, _prev: GuestRequestState, form: FormData): Promise<GuestRequestState> {
  const values = formValues(form);
  const optionIds = form.getAll("options").filter((v): v is string => typeof v === "string");
  const locale = matchLocale(values.lang) ?? DEFAULT_GUEST_LOCALE;
  const m = messages(locale).services;
  const result = await createGuestRequest(token, values, optionIds, { locale, client: clientKey(await headers()) });
  if (result.ok) {
    refresh();
    return { ok: true, message: `${m.form.sent} ${fill(m.reference, { ref: result.reference })}` };
  }
  if (result.code !== "form") return { error: m.errors[result.code], values, optionIds };
  const fieldErrors: Record<string, string> = {};
  for (const code of Object.keys(result.errors) as (keyof typeof m.errors)[]) {
    fieldErrors[FIELD_OF[code] ?? code] = fill(m.errors[code], { hours: result.leadTimeHours ?? 0 });
  }
  return { error: m.errors.form, fieldErrors, values, optionIds };
}
