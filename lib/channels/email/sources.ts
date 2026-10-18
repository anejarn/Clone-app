import type { InboundEmailSource } from "./types";

/**
 * The pull sources of booking e-mails (Lot 7b): none until the associés choose a receiving service. A push service
 * needs nothing here (it posts to /api/inbound-email/<token>); an IMAP mailbox or a provider's API would be an
 * InboundEmailSource added here (or with setInboundEmailSources at start-up), read by the worker at every tick.
 */

let sources: InboundEmailSource[] = [];

export function inboundEmailSources(): readonly InboundEmailSource[] {
  return sources;
}

/** Tests and the start-up of a chosen provider replace the list. */
export function setInboundEmailSources(list: readonly InboundEmailSource[] | undefined) {
  sources = [...(list ?? [])];
}
