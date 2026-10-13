/**
 * "Numéro d'enregistrement" of a furnished holiday let: the commune's INSEE code (5 digits), 6 digits and
 * 2 uppercase letters, e.g. "05096004217KX". Corsican codes (2A/2B) are out of scope.
 */
export const REGISTRATION_NUMBER_RE = /^\d{5}\d{6}[A-Z]{2}$/;

export function isRegistrationNumber(value: string): boolean {
  return REGISTRATION_NUMBER_RE.test(value);
}

/** The commune INSEE code a registration number starts with. */
export function registrationCommune(value: string): string {
  return value.slice(0, 5);
}
