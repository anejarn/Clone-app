import { describe, expect, it } from "vitest";
import { listingFormValues, listingToFormValues, newListingFormValues, parseDateInput, parseListingForm } from "@/lib/admin/listing-form";

/** A valid form, as the browser sends it (strings only). */
const VALID = {
  title: "Riad des Orangers",
  description: "Riad rénové avec patio.",
  propertyType: "RIAD",
  maxGuests: "6",
  bedrooms: "3",
  beds: "4",
  bathrooms: "2,5",
  placeId: "place_medina",
  address: "12 derb Sidi Bouloukat",
  city: "Marrakech",
  lat: "31,6295",
  lng: "-7.9811",
  amenityIds: ["wifi", "clim", "wifi"],
  houseRules: "Pas de fête\nArrivée après 15 h",
  ownerId: "owner_1",
  managementType: "MANAGED",
  commission: "17,5",
  licenseNumber: "80-14/2026/042",
  licenseExpiresAt: "2027-03-31",
  minNights: "2",
  price: "1 450,50",
  cleaningFee: "300",
  status: "DRAFT",
};

const errorsOf = (values: Record<string, unknown>) => {
  const r = parseListingForm(values);
  if (r.ok) throw new Error("expected errors");
  return r.fieldErrors;
};

describe("listing form validation", () => {
  it("turns a valid form into the stored values: centimes, basis points, dates, numbers", () => {
    const r = parseListingForm(VALID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toEqual({
      title: "Riad des Orangers",
      description: "Riad rénové avec patio.",
      propertyType: "RIAD",
      maxGuests: 6,
      bedrooms: 3,
      beds: 4,
      bathrooms: 2.5,
      placeId: "place_medina",
      address: "12 derb Sidi Bouloukat",
      city: "Marrakech",
      lat: 31.6295,
      lng: -7.9811,
      amenityIds: ["wifi", "clim"],
      houseRules: "Pas de fête\nArrivée après 15 h",
      ownerId: "owner_1",
      managementType: "MANAGED",
      commissionBps: 1750,
      licenseNumber: "80-14/2026/042",
      licenseExpiresAt: new Date("2027-03-31T00:00:00Z"),
      minNights: 2,
      priceCents: 145_050,
      cleaningFeeCents: 30_000,
      status: "DRAFT",
    });
  });

  it("requires a commission for a management mandate, between 0 and 100 %", () => {
    expect(errorsOf({ ...VALID, commission: "" }).commission).toBe("Commission : champ obligatoire");
    expect(errorsOf({ ...VALID, commission: "101" }).commission).toMatch(/entre 0 et 100/);
    expect(errorsOf({ ...VALID, commission: "-5" }).commission).toMatch(/entre 0 et 100/);
    const pct = parseListingForm({ ...VALID, commission: "20 %" });
    expect(pct.ok && pct.input.commissionBps).toBe(2000);
    const zero = parseListingForm({ ...VALID, commission: "0" });
    expect(zero.ok && zero.input.commissionBps).toBe(0);
  });

  it("gives a sub-let no commission, whatever is typed", () => {
    for (const commission of ["", "20", "abc"]) {
      const r = parseListingForm({ ...VALID, managementType: "SUBLEASE", commission });
      expect(r.ok && r.input.commissionBps).toBe(0);
    }
  });

  it("keeps the 80-14 number and expiry date together; both empty is a pending application", () => {
    expect(errorsOf({ ...VALID, licenseExpiresAt: "" }).licenseExpiresAt).toMatch(/obligatoire avec un numéro/);
    expect(errorsOf({ ...VALID, licenseNumber: "" }).licenseNumber).toMatch(/obligatoire avec une date/);
    expect(errorsOf({ ...VALID, licenseExpiresAt: "2027-02-30" }).licenseExpiresAt).toBe("Date d'expiration : date invalide");
    const pending = parseListingForm({ ...VALID, licenseNumber: "", licenseExpiresAt: "" });
    expect(pending.ok && [pending.input.licenseNumber, pending.input.licenseExpiresAt]).toEqual([null, null]);
  });

  it("refuses missing or malformed fields with a French message naming the field", () => {
    const e = errorsOf({ ...VALID, title: " a ", price: "", maxGuests: "0", bathrooms: "1,3", lat: "nord", ownerId: "", placeId: "x/y", propertyType: "CASTLE", minNights: "0" });
    expect(e).toMatchObject({
      title: "Titre : au moins 3 caractères",
      price: "Prix par nuit : champ obligatoire",
      maxGuests: "Voyageurs : entre 1 et 50",
      bathrooms: expect.stringMatching(/^Salles de bain : /),
      lat: expect.stringMatching(/^Latitude : nombre décimal/),
      ownerId: "Propriétaire : champ obligatoire",
      placeId: "Quartier : choisissez dans la liste",
      propertyType: "Type de logement : choisissez dans la liste",
      minNights: "Séjour minimum : entre 1 et 365",
    });
    expect(errorsOf({ ...VALID, price: "0" }).price).toBe("Prix par nuit : 1 MAD minimum");
    expect(errorsOf({ ...VALID, price: "-10" }).price).toMatch(/montant en dirhams/);
    expect(errorsOf({ ...VALID, cleaningFee: "1e3" }).cleaningFee).toMatch(/montant en dirhams/);
    expect(errorsOf({ ...VALID, description: "x\u0000y" }).description).toBe("Description : caractères non autorisés");
    expect(errorsOf({ ...VALID, title: "x".repeat(121) }).title).toBe("Titre : 120 caractères au maximum");
    expect(errorsOf({ ...VALID, status: "ARCHIVED" }).status).toMatch(/^Statut/);
    expect(errorsOf({ ...VALID, amenityIds: ["wifi", "../x"] }).amenityIds).toMatch(/^Équipements/);
    // A field missing altogether (a forged request) is refused too.
    const { title: _t, ...noTitle } = VALID;
    void _t;
    expect(errorsOf(noTitle).title).toBeDefined();
  });

  it("an empty cleaning fee is 0", () => {
    const r = parseListingForm({ ...VALID, cleaningFee: "" });
    expect(r.ok && r.input.cleaningFeeCents).toBe(0);
  });

  it("reads FormData: strings only, every checked amenity, files ignored", () => {
    const f = new FormData();
    for (const [k, v] of Object.entries(VALID)) if (typeof v === "string") f.set(k, v);
    f.append("amenityIds", "wifi");
    f.append("amenityIds", "piscine");
    f.set("organizationId", "someone-else");
    f.set("title", new File(["x"], "x.txt"));
    const values = listingFormValues(f);
    expect(values.amenityIds).toEqual(["wifi", "piscine"]);
    expect(values.title).toBe("");
    expect(values).not.toHaveProperty("organizationId");
  });

  it("puts a listing back into the form, and a new listing starts from the organization's commission", () => {
    const r = parseListingForm(VALID);
    if (!r.ok) throw new Error("invalid");
    const back = listingToFormValues({ ...r.input, propertyType: r.input.propertyType });
    expect(parseListingForm(back)).toEqual(r);
    expect(back).toMatchObject({ price: "1450,50", commission: "17,5", bathrooms: "2,5", licenseExpiresAt: "2027-03-31", lat: "31,6295" });
    expect(newListingFormValues(1500)).toMatchObject({ commission: "15", managementType: "MANAGED", status: "DRAFT", city: "Marrakech" });
  });

  it("parses date inputs strictly", () => {
    expect(parseDateInput("2027-03-31")).toEqual(new Date("2027-03-31T00:00:00Z"));
    for (const bad of ["31/03/2027", "2027-3-31", "2027-02-29", "", "2027-13-01"]) expect(parseDateInput(bad)).toBeNull();
    expect(parseDateInput("2028-02-29")).toEqual(new Date("2028-02-29T00:00:00Z"));
  });
});
