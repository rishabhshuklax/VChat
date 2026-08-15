import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Pill buttons, editorial-style. `accent` is the one loud thing on any screen;
 * `ink` is the workhorse on paper; `surface` the workhorse in the dark room.
 */
type Variant = 'accent' | 'ink' | 'surface' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  accent: 'bg-accent text-soot shadow-[0_10px_30px_-10px_var(--color-accent)] hover:bg-accent-deep',
  ink: 'bg-soot text-paper hover:bg-soot/85',
  surface: 'bg-surface-2 text-ink border border-line hover:bg-surface-3 hover:border-line-bright',
  outline: 'border border-current/25 text-current hover:border-current/60',
  ghost: 'text-current/70 hover:text-current hover:bg-current/10',
  danger: 'bg-danger text-white hover:brightness-110',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-13 px-7 text-base gap-2.5',
  xl: 'h-15 px-9 text-lg gap-3',
};

export function Button({
  variant = 'surface',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium tracking-tight',
        'transition-[background-color,border-color,color,transform,filter,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]',
        'active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
