/** French messages for Better Auth error codes shown in the login and security forms. */
export const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Adresse e-mail ou mot de passe incorrect.",
  USER_ALREADY_EXISTS: "Un compte existe déjà avec cette adresse. Connectez-vous.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Un compte existe déjà avec cette adresse. Connectez-vous.",
  PASSWORD_TOO_SHORT: "Le mot de passe doit contenir au moins 8 caractères.",
  INVALID_EMAIL: "Adresse e-mail invalide.",
  INVALID_PASSWORD: "Mot de passe incorrect.",
  INVALID_CODE: "Code incorrect. Vérifiez que l'heure de votre téléphone est à jour, puis réessayez.",
  INVALID_BACKUP_CODE: "Code de secours incorrect ou déjà utilisé.",
  INVALID_TWO_FACTOR_COOKIE: "La vérification a expiré. Reconnectez-vous avec votre mot de passe.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Trop d'essais. Reconnectez-vous avec votre mot de passe.",
  ACCOUNT_TEMPORARILY_LOCKED: "Trop de codes incorrects : le compte est bloqué 15 minutes.",
  TOTP_ALREADY_ENABLED: "La double authentification est déjà activée.",
  ACCOUNT_DEACTIVATED: "Ce compte est désactivé. Contactez l'équipe Sigma.",
  TOO_MANY_REQUESTS: "Trop de tentatives. Patientez quelques secondes, puis réessayez.",
};

export function authErrorMessage(error: { code?: string; message?: string; status?: number }): string {
  if (error.status === 429) return AUTH_MESSAGES.TOO_MANY_REQUESTS;
  return AUTH_MESSAGES[error.code ?? ""] ?? "Une erreur est survenue. Réessayez.";
}
