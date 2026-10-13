import { describe, expect, it } from "vitest";
import { errorField, normaliseRegistration, validateHostLead, type HostLeadValues } from "@/lib/host-lead";

const places = { "orcieres-merlette": "05096", "les-orres": "05098" };
const valid: HostLeadValues = {
  name: " Marie Dupont ",
  email: "marie@example.fr",
  phone: "",
  placeSlug: "orcieres-merlette",
  propertyType: "APARTMENT",
  beds: "6",
  openWinterWeeks: "8",
  registrationNumber: "",
  message: "",
  consent: true,
};

describe("owner lead form validation", () => {
  it("builds the API payload, trimming and leaving empty optional fields out", () => {
    expect(validateHostLead(valid, places).payload).toEqual({
      name: "Marie Dupont",
      email: "marie@example.fr",
      placeSlug: "orcieres-merlette",
      propertyType: "APARTMENT",
      beds: 6,
      openWinterWeeks: 8,
      consent: true,
    });
  });

  it("normalises a registration number and checks it belongs to the chosen resort", () => {
    expect(normaliseRegistration("05096 004217 kx")).toBe("05096004217KX");
    expect(validateHostLead({ ...valid, registrationNumber: "05096 004217 kx" }, places).payload?.registrationNumber).toBe("05096004217KX");
    expect(validateHostLead({ ...valid, registrationNumber: "05098004217KX" }, places).errors?.registrationNumber).toMatch(/05096/);
    expect(validateHostLead({ ...valid, registrationNumber: "0509600421KX" }, places).errors?.registrationNumber).toMatch(/13 caractères/);
  });

  it("lists every problem in form order", () => {
    const r = validateHostLead(
      { ...valid, name: "", email: "nope", phone: "abc", placeSlug: "paris", propertyType: "VILLA", beds: "0", openWinterWeeks: "27", consent: false },
      places,
    );
    expect(Object.keys(r.errors ?? {})).toEqual(["name", "email", "phone", "placeSlug", "propertyType", "beds", "openWinterWeeks", "consent"]);
  });

  it("rejects non-integer counts and over-long text", () => {
    expect(validateHostLead({ ...valid, beds: "2.5" }, places).errors?.beds).toBeDefined();
    expect(validateHostLead({ ...valid, message: "x".repeat(2001) }, places).errors?.message).toBeDefined();
    expect(validateHostLead({ ...valid, name: "x".repeat(101) }, places).errors?.name).toBeDefined();
  });

  it("maps API messages back to their field", () => {
    expect(errorField("registrationNumber : ce numéro n'est pas celui d'un logement de cette station.")).toBe("registrationNumber");
    expect(errorField("requête : Invalid input")).toBeNull();
    expect(errorField("Origine non autorisée.")).toBeNull();
  });
});
