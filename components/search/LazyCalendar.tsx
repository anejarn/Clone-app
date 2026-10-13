"use client";

import dynamic from "next/dynamic";

/** react-day-picker and its locale load when a dates panel first opens, not with the page. */
export const LazyCalendar = dynamic(() => import("./DateRangeCalendar").then((m) => m.DateRangeCalendar), {
  ssr: false,
  loading: () => <div aria-busy className="h-[336px] w-full max-w-[720px] animate-pulse rounded-lg bg-surface-2" />,
});
