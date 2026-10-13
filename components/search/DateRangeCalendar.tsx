"use client";

import { startOfToday } from "date-fns";
import { DayPicker } from "react-day-picker";
import { fr } from "react-day-picker/locale";
import type { DateRange } from "@/lib/search/useSearchDraft";

/**
 * Two-click range calendar. The search bar uses react-day-picker's own range rules; the booking card passes
 * `isDisabled` (booked nights, minimum stay) and `onPick`, which then decides what each click does.
 */
export function DateRangeCalendar({
  value,
  onChange,
  months = 2,
  isDisabled,
  onPick,
  endMonth,
}: {
  value?: DateRange;
  onChange: (r: DateRange | undefined) => void;
  months?: number;
  isDisabled?: (day: Date) => boolean;
  onPick?: (day: Date) => void;
  endMonth?: Date;
}) {
  const today = startOfToday();
  return (
    <DayPicker
      mode="range"
      locale={fr}
      numberOfMonths={months}
      selected={value?.from ? { from: value.from, to: value.to } : undefined}
      onSelect={(r, day) => (onPick ? onPick(day) : onChange(r ? { from: r.from, to: r.to } : undefined))}
      disabled={isDisabled ? [{ before: today }, isDisabled] : { before: today }}
      startMonth={today}
      endMonth={endMonth}
      excludeDisabled={!onPick}
      defaultMonth={value?.from ?? today}
    />
  );
}
