"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { CircleUserRound, Menu as MenuIcon } from "lucide-react";
import Link from "next/link";

const item = "block rounded-sm px-4 py-3 text-body outline-none data-[highlighted]:bg-surface-2";

export function UserMenu() {
  return (
    <nav aria-label="Profil" className="flex items-center justify-end gap-2">
      <Link href="/login" className="hidden rounded-pill px-3 py-3 font-medium hover:bg-surface-3 lg:block">
        Devenir hôte
      </Link>
      <Link href="/login" aria-label="Connexion" data-testid="cypress-headernav-profile" className="grid size-10 place-items-center rounded-full bg-surface-3 hover:bg-line-soft">
        <CircleUserRound className="size-5" strokeWidth={1.75} />
      </Link>
      <Menu.Root modal={false}>
        <Menu.Trigger aria-label="Menu principal" className="grid size-10 place-items-center rounded-full bg-surface-3 hover:bg-line-soft data-[state=open]:shadow-e1">
          <MenuIcon className="size-4" strokeWidth={2.4} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={8} className="z-50 w-60 animate-pop-in rounded-lg bg-white py-2 shadow-popover">
            <Menu.Item asChild>
              <Link href="/login" className={`${item} font-semibold`}>
                Connexion ou inscription
              </Link>
            </Menu.Item>
            <Menu.Separator className="my-2 h-px bg-line" />
            <Menu.Item asChild>
              <Link href="/wishlists" className={item}>
                Favoris
              </Link>
            </Menu.Item>
            <Menu.Item asChild>
              <Link href="/login" className={item}>
                Devenir hôte
              </Link>
            </Menu.Item>
            <Menu.Item asChild>
              <a href="#aide" className={item}>
                Centre d&apos;aide
              </a>
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </nav>
  );
}
