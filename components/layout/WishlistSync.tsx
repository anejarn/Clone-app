"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { attachAccount, detachAccount } from "@/lib/wishlist";

/** Points the favourites store at the account when signed in, at this browser otherwise. */
export function WishlistSync() {
  const { data, isPending } = useSession();
  const userId = data?.user.id;
  useEffect(() => {
    if (isPending) return;
    if (userId) void attachAccount();
    else detachAccount();
  }, [userId, isPending]);
  return null;
}
