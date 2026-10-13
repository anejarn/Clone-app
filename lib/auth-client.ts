"use client";

import { createAuthClient } from "better-auth/react";

/** Browser side of Better Auth; talks to /api/auth on the current origin. */
export const authClient = createAuthClient();
export const { useSession } = authClient;
