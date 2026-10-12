"use client";

import { startOfToday } from "date-fns";
import { DayPicker } from "react-day-picker";
import { fr } from "react-day-picker/locale";
import type { DateRange } from "@/lib/search/useSearchDraft";

export function DateRangeCalendar({
  value,
  onChange,
  months = 2,
}: {
  value?: DateRange;
  onChange: (r: DateRange | undefined) => void;
  months?: number;
}) {
  const today = startOfToday();
  return (
    <DayPicker
      mode="range"
      locale={fr}
      numberOfMonths={months}
      selected={value?.from ? { from: value.from, to: value.to } : undefined}
      onSelect={(r) => onChange(r ? { from: r.from, to: r.to } : undefined)}
      disabled={{ before: today }}
      startMonth={today}
      excludeDisabled
      defaultMonth={value?.from ?? today}
    />
  );
}
