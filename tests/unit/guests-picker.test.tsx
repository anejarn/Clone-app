// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuestsPicker } from "@/components/search/GuestsPicker";
import { emptyGuests } from "@/lib/search/params";
import { touristTax } from "@/lib/tourist-tax";

afterEach(cleanup);

describe("guest picker age bands (diff search-36, mobile-32)", () => {
  it("uses the legal ages: adults 18+, children 2–17, infants under 2", () => {
    render(<GuestsPicker value={emptyGuests} onChange={() => {}} />);
    for (const [label, hint] of [
      ["Adultes", "18 ans et plus"],
      ["Enfants", "De 2 à 17 ans"],
      ["Bébés", "Moins de 2 ans"],
    ]) {
      const row = screen.getByText(label, { selector: "p" }).parentElement!;
      expect(row.textContent).toBe(`${label}${hint}`);
    }
  });

  it("so the taxe de séjour, charged per adult, never counts a minor", () => {
    const base = { inseeCode: "05098", stars: 3, nightlyCents: 20_000, nights: 4 };
    expect(touristTax({ ...base, adults: 2, children: 2, infants: 1 }).totalCents).toBe(touristTax({ ...base, adults: 2 }).totalCents);
    expect(touristTax({ ...base, adults: 2, children: 2 }).liablePersons).toBe(2);
  });
});
