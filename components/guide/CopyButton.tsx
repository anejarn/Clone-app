"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Copies a value (Wi-Fi password, code) to the clipboard; labels come from the guide's language. */
export function CopyButton({ value, label, copiedLabel, className }: { value: string; label: string; copiedLabel: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill border border-line bg-white px-3 text-caption font-semibold text-ink hover:border-ink ${className ?? ""}`}
    >
      {copied ? <Check className="size-4 text-success" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}
