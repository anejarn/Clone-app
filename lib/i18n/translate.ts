import type { GuestLocale } from "./locales";

/**
 * Hook for machine translation of the team's texts (guide instructions, recommendations, messages later). No
 * provider is chosen: that choice (and its loi 09-08 transfer question, the texts can name people and places) is
 * the associés'. The default translator translates nothing, so the guide shows the French text when a language has
 * none. To plug a provider in, write a Translator and pass it to setTranslator() at start-up.
 */

export interface Translator {
  readonly name: string;
  /** The translation, or null when this translator can't (no provider, unsupported language, error). */
  translate(text: string, from: GuestLocale, to: GuestLocale): Promise<string | null>;
}

export class NoopTranslator implements Translator {
  readonly name = "none";
  async translate(): Promise<string | null> {
    return null;
  }
}

let current: Translator = new NoopTranslator();

export function translator(): Translator {
  return current;
}

export function setTranslator(t: Translator | undefined) {
  current = t ?? new NoopTranslator();
}
