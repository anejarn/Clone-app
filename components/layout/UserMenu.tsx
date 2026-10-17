"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { CircleUserRound, Menu as MenuIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";

/** Sigma's offer to owners, on the help page. */
const OWNERS_HREF = "/aide#proprietaires";
const item = "block w-full rounded-sm px-4 py-3 text-left text-body outline-none data-[highlighted]:bg-surface-2";

export function UserMenu() {
  const { data } = useSession();
  const router = useRouter();
  const user = data?.user;

  return (
    <nav aria-label="Profil" className="flex items-center justify-end gap-2">
      <Link href={OWNERS_HREF} className="hidden rounded-pill px-3 py-3 font-medium hover:bg-surface-3 lg:block">
        Confier mon bien
      </Link>
      {user ? (
        <Link
          href="/trips"
          aria-label={`Compte de ${user.name}`}
          className="grid size-10 place-items-center rounded-full bg-ink text-body font-semibold uppercase text-white"
          data-testid="cypress-headernav-profile"
        >
          {user.name.trim()[0] ?? "?"}
        </Link>
      ) : (
        <Link href="/login" aria-label="Connexion" data-testid="cypress-headernav-profile" className="grid size-10 place-items-center rounded-full bg-surface-3 hover:bg-line-soft">
          <CircleUserRound className="size-5" strokeWidth={1.75} />
        </Link>
      )}
      <Menu.Root modal={false}>
        <Menu.Trigger aria-label="Menu principal" className="grid size-10 place-items-center rounded-full bg-surface-3 hover:bg-line-soft data-[state=open]:shadow-e1">
          <MenuIcon className="size-4" strokeWidth={2.4} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={8} className="z-50 w-60 animate-pop-in rounded-lg bg-white py-2 shadow-popover">
            {user ? (
              <>
                <p className="truncate px-4 pb-2 pt-1 text-micro text-ink-muted">{user.email}</p>
                <Menu.Item asChild>
                  <Link href="/trips" className={`${item} font-semibold`}>
                    Mes séjours
                  </Link>
                </Menu.Item>
                <Menu.Item asChild>
                  <Link href="/wishlists" className={`${item} font-semibold`}>
                    Favoris
                  </Link>
                </Menu.Item>
              </>
            ) : (
              <>
                <Menu.Item asChild>
                  <Link href="/login" className={`${item} font-semibold`}>
                    Se connecter ou créer un compte
                  </Link>
                </Menu.Item>
                <Menu.Item asChild>
                  <Link href="/wishlists" className={item}>
                    Favoris
                  </Link>
                </Menu.Item>
              </>
            )}
            <Menu.Separator className="my-2 h-px bg-line" />
            <Menu.Item asChild>
              <Link href={OWNERS_HREF} className={item}>
                Confier mon bien
              </Link>
            </Menu.Item>
            <Menu.Item asChild>
              <Link href="/aide" className={item}>
                Aide
              </Link>
            </Menu.Item>
            {user && (
              <>
                <Menu.Separator className="my-2 h-px bg-line" />
                <Menu.Item
                  className={item}
                  onSelect={async () => {
                    await authClient.signOut();
                    router.refresh();
                  }}
                >
                  Déconnexion
                </Menu.Item>
              </>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </nav>
  );
}
