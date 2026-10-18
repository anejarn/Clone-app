"use client";

import { authClient } from "./auth-client";
import { prepareSignOut } from "./offline/clear";

/**
 * Every sign-out button: first removes what « Ma journée » keeps on this device (asking before losing unsent
 * changes), then closes the session. False when the person chose to stay signed in.
 */
export async function signOut(): Promise<boolean> {
  if (!(await prepareSignOut())) return false;
  await authClient.signOut();
  return true;
}
