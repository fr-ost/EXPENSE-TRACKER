import * as React from "react";
import { BrandMark } from "@/components/brand";

export function AuthScreen({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-[360px] animate-rise">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          {icon ?? <BrandMark className="size-12" />}
          <div className="flex flex-col gap-1.5">
            <h1 className="text-title font-semibold text-text">{title}</h1>
            <p className="text-body text-text-secondary">{description}</p>
          </div>
        </div>
        {children}
        {footer && <div className="mt-6 text-center">{footer}</div>}
      </div>
      <p className="absolute inset-x-0 bottom-6 text-center text-caption text-text-tertiary">
        Private ledger · Only you can open this
      </p>
    </main>
  );
}
