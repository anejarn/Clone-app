"use client";

import { useEffect, useState } from "react";

/**
 * Time left until the codes open (days, hours, minutes), updated every 30 seconds; when the time comes the page
 * reloads, so the server shows the codes (they are never sent to the browser before). The server renders the
 * absolute date and time next to it, so the page reads fine without JavaScript.
 */
export function Countdown({ until, label, units }: { until: string; label: string; units: { days: string; hours: string; minutes: string } }) {
  const target = new Date(until).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= target) window.location.reload();
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [target]);
  if (now === null || now >= target) return null;
  const minutes = Math.ceil((target - now) / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-ink" data-testid="codes-countdown">
      <span className="text-ink-muted">{label}</span>
      <span className="font-semibold tabular-nums">
        {d > 0 && `${d} ${units.days} `}
        {(d > 0 || h > 0) && `${h} ${units.hours} `}
        {`${m} ${units.minutes}`}
      </span>
    </p>
  );
}
