import Link from "next/link";

/**
 * The Sigma mark: a solid capital sigma (Σ) drawn as one path, so it needs no font and takes the colour of
 * its parent (text-brand). 4.5-unit bars and diagonals of the same perpendicular weight on a 32-unit grid.
 * app/icon.svg is the same letter, slightly heavier, in white on a rounded brand square.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M6.5 4h19v4.5h-9.7l5.94 7.5-5.94 7.5h9.7V28h-19L16 16Z" fill="currentColor" />
    </svg>
  );
}

/** Header logo: the mark plus the lowercase wordmark from lg up, the mark alone below (`markOnly` for the phone row). */
export function Logo({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <Link href="/" aria-label="Sigma, page d'accueil" className="flex w-fit shrink-0 items-center gap-1.5 justify-self-start text-brand">
      <LogoMark className="size-[30px]" />
      {!markOnly && <span className="hidden text-[24px] font-bold tracking-[-0.5px] lg:inline">sigma</span>}
    </Link>
  );
}
