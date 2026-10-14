// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateRangeCalendar } from "@/components/search/DateRangeCalendar";
import { datesLabel } from "@/components/search/summary";
import type { DateRange } from "@/lib/search/useSearchDraft";
import { useSearchDraft } from "@/lib/search/useSearchDraft";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockClear());

/** What the calendar hands us: a local-midnight Date for the clicked day. */
const clicked = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe(`search draft (TZ=${process.env.TZ ?? "system"})`, () => {
  it("puts the clicked calendar days in the URL, whatever the timezone", () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => {
      result.current.choosePlace({ slug: "lyon", name: "Lyon", country: "France", tagline: "", image: "" });
      result.current.setRange({ from: clicked(2027, 3, 5), to: clicked(2027, 3, 8) });
      result.current.setGuests({ adults: 2, children: 1, infants: 0, pets: 0 });
    });
    act(() => result.current.submit());
    expect(push).toHaveBeenCalledWith("/s/lyon/homes?checkin=2027-03-05&checkout=2027-03-08&adults=2&children=1");
  });

  it("labels the clicked days, not their UTC neighbours", () => {
    expect(datesLabel({ from: clicked(2027, 1, 30), to: clicked(2027, 2, 1) })).toBe("30 janv. – 1 févr.");
    expect(datesLabel({ from: clicked(2027, 3, 5) })).toBe("5 mars");
  });

  it("labels a check-in alone as one day, also when the end is the same day (diff search-34)", () => {
    expect(datesLabel({ from: clicked(2026, 11, 24) })).toBe("24 nov.");
    expect(datesLabel({ from: clicked(2026, 11, 24), to: clicked(2026, 11, 24) })).toBe("24 nov.");
    expect(datesLabel({ from: clicked(2026, 11, 24), to: clicked(2026, 11, 26) })).toBe("24–26 nov.");
    expect(datesLabel(undefined)).toBeUndefined();
  });

  it("labels the calendar's first click as that day alone", () => {
    let picked: DateRange | undefined;
    render(<DateRangeCalendar months={1} onChange={(r) => (picked = r)} />);
    fireEvent.click(screen.getByRole("button", { name: /mois suivant/i }));
    const day = (screen.getAllByRole("gridcell").find((c) => c.getAttribute("data-day")?.endsWith("-24")) as HTMLElement).querySelector("button")!;
    fireEvent.click(day);
    // react-day-picker hands over a one-day range: { from: 24, to: 24 }.
    expect(picked?.from?.getDate()).toBe(24);
    expect(picked?.to === undefined || picked.to.getTime() === picked.from!.getTime()).toBe(true);
    expect(datesLabel(picked)).toMatch(/^24 \S+\.?$/);
    expect(datesLabel(picked)).not.toContain("–");
  });

  it("submits a check-in alone without dates", () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => result.current.setRange({ from: clicked(2027, 3, 5), to: clicked(2027, 3, 5) }));
    act(() => result.current.submit());
    expect(push).toHaveBeenLastCalledWith("/s/partout/homes");
  });

  it("reads initial URL dates back as the same calendar days", () => {
    const { result } = renderHook(() => useSearchDraft({ checkin: "2027-03-05", checkout: "2027-03-08" }));
    expect(result.current.range?.from?.getDate()).toBe(5);
    expect(result.current.range?.to?.getDate()).toBe(8);
  });
});

describe("destination resolution on submit", () => {
  it("uses the first suggestion for typed text, else the slugified text, else 'partout'", () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => result.current.setWhere("anne"));
    act(() => result.current.submit({ slug: "annecy", name: "Annecy", country: "France", tagline: "", image: "" }));
    expect(push).toHaveBeenLastCalledWith("/s/annecy/homes");
    act(() => result.current.setWhere("Île de Ré"));
    act(() => result.current.submit());
    expect(push).toHaveBeenLastCalledWith("/s/ile-de-re/homes");
    act(() => result.current.setWhere("   "));
    act(() => result.current.submit());
    expect(push).toHaveBeenLastCalledWith("/s/partout/homes");
  });

  it("drops a half-picked range", () => {
    const { result } = renderHook(() => useSearchDraft());
    act(() => result.current.setRange({ from: clicked(2027, 3, 5) }));
    act(() => result.current.submit());
    expect(push).toHaveBeenLastCalledWith("/s/partout/homes");
  });
});
