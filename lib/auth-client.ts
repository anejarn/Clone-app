"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser side of Better Auth; talks to /api/auth on the current origin. With twoFactorClient, a sign-in of an
 * account with double authentification answers { twoFactorRedirect: true }: the login form then asks for the code.
 */
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
export const { useSession } = authClient;
