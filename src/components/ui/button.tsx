import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-ink text-white shadow-xs hover:bg-ink-soft",
        secondary: "bg-surface-muted text-text hover:bg-surface-sunken",
        outline: "border border-border bg-surface text-text shadow-xs hover:border-border-strong hover:bg-surface-subtle",
        ghost: "text-text-secondary hover:bg-surface-muted hover:text-text",
        danger: "bg-negative text-white shadow-xs hover:bg-negative-text",
        "danger-soft": "bg-negative-soft text-negative-text hover:bg-[#fbe2e2]",
        link: "h-auto px-0 text-accent-text underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        sm: "h-8 rounded-sm px-3 text-small [&_svg]:size-3.5",
        md: "h-10 rounded-md px-4 text-body [&_svg]:size-4",
        lg: "h-12 rounded-lg px-5 text-[0.9375rem] [&_svg]:size-[18px]",
        icon: "size-10 rounded-md [&_svg]:size-[18px]",
        "icon-sm": "size-8 rounded-sm [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot.Root className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type ?? "button"}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-2">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export { buttonVariants };
