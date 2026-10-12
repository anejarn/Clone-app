import Link from "next/link";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M16 3 3 14v2h3v12h8v-8h4v8h8V16h3v-2L16 3Z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <circle cx="16" cy="14" r="2.6" fill="currentColor" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" aria-label="Nidou, page d'accueil" className="flex items-center gap-1.5 text-brand">
      <LogoMark className="size-[30px]" />
      <span className="hidden text-[24px] font-bold tracking-[-0.5px] lg:inline">nidou</span>
    </Link>
  );
}
