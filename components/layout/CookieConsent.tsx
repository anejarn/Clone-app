"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

const COOKIE = "nidou_consent";

export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Read after mount so the server render never depends on cookies.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(!document.cookie.split("; ").some((c) => c.startsWith(`${COOKIE}=`)));
  }, []);

  if (!show) return null;
  const choose = (value: "all" | "necessary") => {
    document.cookie = `${COOKIE}=${value}; max-age=${60 * 60 * 24 * 180}; path=/; samesite=lax`;
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-title"
      className="fixed bottom-20 left-1/2 z-50 w-[min(720px,calc(100%-32px))] -translate-x-1/2 animate-pop-in rounded-lg bg-white p-6 shadow-modal md:bottom-6"
    >
      <h2 id="cookie-title" className="mb-2 text-title-s font-semibold">
        Améliorez votre expérience
      </h2>
      <p>
        Nous utilisons des cookies pour personnaliser le contenu et mesurer l&apos;audience. Certains sont nécessaires au
        fonctionnement du site et ne peuvent pas être désactivés.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => choose("all")}>Accepter tout</Button>
        <Button onClick={() => choose("necessary")}>Uniquement les nécessaires</Button>
        {/* No preferences panel yet: point at the privacy links instead of guessing a choice. */}
        <a href="#aide" className="ml-1 font-semibold underline underline-offset-2">
          Gérer les préférences
        </a>
      </div>
    </div>
  );
}
