import "server-only";

/**
 * Outgoing notifications (e-mail, WhatsApp), behind one small interface so a provider can be plugged in later
 * without touching the callers. No provider is chosen yet (that choice, and its loi 09-08 transfer question, is the
 * associés'), so the default notifier sends nothing and says so: the back-office then shows the link to copy or
 * share by hand (wa.me link). To add a provider, write a Notifier and return it from createNotifier().
 *
 * NOTIFICATIONS_DRIVER=console (development only) prints messages to the server log instead; never in production,
 * since a message can hold a secret link.
 */

export type Channel = "email" | "whatsapp";

export interface Notification {
  /** What the message is about, for logs and templates, e.g. "invitation". */
  kind: string;
  to: { email?: string | null; phone?: string | null; name?: string | null };
  subject: string;
  text: string;
  /** Preferred channels, in order; a notifier uses the first it supports and has an address for. */
  channels?: readonly Channel[];
}

export interface DeliveryResult {
  /** True once a provider accepted the message. */
  delivered: boolean;
  channel: Channel | null;
}

export interface Notifier {
  readonly name: string;
  send(notification: Notification): Promise<DeliveryResult>;
}

/** The default: no provider configured, nothing is sent. */
export class NoopNotifier implements Notifier {
  readonly name = "none";
  async send(): Promise<DeliveryResult> {
    return { delivered: false, channel: null };
  }
}

/** Development helper: writes the message to the server log. Not "delivered": nobody received it. */
export class ConsoleNotifier implements Notifier {
  readonly name = "console";
  async send(n: Notification): Promise<DeliveryResult> {
    console.info(`[notification:${n.kind}] to ${n.to.email ?? n.to.phone ?? "?"} — ${n.subject}\n${n.text}`);
    return { delivered: false, channel: null };
  }
}

export function createNotifier(env: Record<string, string | undefined> = process.env): Notifier {
  if (env.NOTIFICATIONS_DRIVER === "console" && env.NODE_ENV !== "production") return new ConsoleNotifier();
  return new NoopNotifier();
}

let current: Notifier | undefined;

export function notifier(): Notifier {
  current ??= createNotifier();
  return current;
}

/** Tests (and a future provider set up at start-up) replace the notifier. */
export function setNotifier(n: Notifier | undefined) {
  current = n;
}
