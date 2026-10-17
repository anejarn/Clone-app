import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-semibold transition-colors duration-200 ease-standard disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-strong active:bg-brand-deep disabled:bg-line",
        dark: "bg-ink text-white hover:bg-black disabled:bg-line",
        outline: "border border-ink bg-white text-ink hover:bg-surface-2",
        link: "underline underline-offset-2 hover:text-black",
      },
      size: {
        md: "h-12 rounded-sm px-6 text-body-l",
        sm: "h-10 rounded-sm px-4 text-body",
        none: "",
      },
    },
    defaultVariants: { variant: "dark", size: "md" },
  },
);

export function Button({ className, variant, size, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size: variant === "link" ? "none" : size }), className)} {...props} />;
}

export const iconButtonVariants = cva(
  "inline-grid shrink-0 place-items-center rounded-full transition duration-200 ease-standard disabled:cursor-default disabled:opacity-35",
  {
    variants: {
      size: {
        sm: "size-8 border border-line bg-white enabled:hover:shadow-e1",
        md: "size-10 bg-surface-3 hover:bg-line-soft",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export function IconButton({
  className,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof iconButtonVariants> & { "aria-label": string }) {
  return <button type="button" className={cn(iconButtonVariants({ size }), className)} {...props} />;
}
