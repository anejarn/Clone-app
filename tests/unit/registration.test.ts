import { describe, expect, it } from "vitest";
import { isRegistrationNumber, registrationCommune } from "@/lib/registration";

describe("registration numbers", () => {
  it("are the commune INSEE code + 6 digits + 2 uppercase letters", () => {
    expect(isRegistrationNumber("05096004217KX")).toBe(true);
    expect(registrationCommune("05096004217KX")).toBe("05096");
    for (const bad of ["", "05096004217kx", "0509600421KX", "05096004217KXY", "05096 004217 KX", "2A004004217KX", "05096004217K1", " 05096004217KX"]) {
      expect(isRegistrationNumber(bad), bad).toBe(false);
    }
  });
});
