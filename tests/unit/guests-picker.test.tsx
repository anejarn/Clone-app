// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuestsPicker, stepGuests } from "@/components/search/GuestsPicker";
import { emptyGuests, MAX_GUESTS } from "@/lib/search/params";

afterEach(cleanup);

describe("guest picker", () => {
  it("states the age bands: adults 18+, children 2–17, infants under 2 (diff search-36, mobile-32)", () => {
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

  it("disables + for adults and children once the party is full (diff search-39)", () => {
    const full = { ...emptyGuests, adults: 10, children: MAX_GUESTS - 10 };
    render(<GuestsPicker value={full} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Augmenter adultes" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Augmenter enfants" })).toHaveProperty("disabled", true);
    // Infants and pets don't count towards the cap.
    expect(screen.getByRole("button", { name: "Augmenter bébés" })).toHaveProperty("disabled", false);
    expect(stepGuests(full, "adults", 1)).toBe(full);
  });
});
