"use client";

import { useEffect } from "react";

/**
 * The root layout says <html lang="fr">; the guide is in the guest's language. Its content carries lang/dir itself
 * (the wrapper element), and this sets them on <html> too once in the browser, for screen readers and the browser's
 * own translation offer. Restored when leaving the page.
 */
export function DocumentLang({ lang, dir }: { lang: string; dir: "ltr" | "rtl" }) {
  useEffect(() => {
    const html = document.documentElement;
    const before = { lang: html.lang, dir: html.dir };
    html.lang = lang;
    html.dir = dir;
    return () => {
      html.lang = before.lang;
      html.dir = before.dir;
    };
  }, [lang, dir]);
  return null;
}
