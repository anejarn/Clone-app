"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_DAYS } from "@/lib/browser-storage";

/**
 * Cookie notice. Sigma sets no optional cookies (no audience measurement, no advertising), so there is nothing
 * to accept or refuse: this only says what is stored and is dismissed once. Non-modal: a labelled region that
 * never takes focus. The cookie's value doesn't matter, only its presence.
 */
export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Read after mount so the server render never depends on cookies.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(!document.cookie.split("; ").some((c) => c.startsWith(`${CONSENT_COOKIE}=`)));
  }, []);

  // The notice is fixed over the bottom of the viewport and stays up while people browse: reserve its height
  // (plus its offset from the bottom edge) at the end of the page, so the footer's last links and the © line
  // can still be scrolled clear of it. offsetHeight ignores the pop-in transform.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!show || !el) return;
    const root = document.documentElement;
    const update = () => {
      const space = el.offsetHeight + parseFloat(getComputedStyle(el).bottom) + 16;
      root.style.setProperty("--cookie-notice-space", `${Math.ceil(space)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty("--cookie-notice-space");
    };
  }, [show]);

  if (!show) return null;
  const dismiss = () => {
    document.cookie = `${CONSENT_COOKIE}=ok; max-age=${60 * 60 * 24 * CONSENT_MAX_AGE_DAYS}; path=/; samesite=lax`;
    setShow(false);
  };

  return (
    <section
      ref={ref}
      aria-labelledby="cookie-title"
      data-testid="cookie-notice"
      className="fixed bottom-20 left-1/2 z-50 w-[min(720px,calc(100%-32px))] -translate-x-1/2 animate-pop-in rounded-lg bg-white p-6 shadow-modal md:bottom-6"
    >
      <h2 id="cookie-title" className="mb-2 text-title-s font-semibold">
        Cookies
      </h2>
      <p>
        Sigma ne dépose que les cookies qui vous gardent connecté et celui qui retient que ce message a été fermé. Sans compte, vos favoris
        restent sur cet appareil.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Button onClick={dismiss}>Fermer ce message</Button>
        <Link href="/aide#cookies" className="font-semibold underline underline-offset-2">
          Détail des cookies
        </Link>
      </div>
    </section>
  );
}
