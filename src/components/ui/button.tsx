import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** One Arc (default) button per screen; copper (accent) is reserved for purchase / booking invitations. */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all duration-fast ease-brand disabled:pointer-events-none disabled:opacity-45 active:translate-y-px',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:brightness-110 hover:shadow-[var(--glow)]',
        accent: 'bg-copper text-accent-foreground hover:brightness-110',
        outline: 'border border-border bg-transparent text-foreground hover:border-arc hover:text-arc',
        ghost: 'text-silver hover:bg-steel hover:text-foreground',
        destructive: 'bg-err text-accent-foreground hover:brightness-110',
        link: 'text-arc underline-offset-4 hover:underline',
      },
      size: { default: 'h-11 px-5', sm: 'h-9 px-3.5 text-[13px]', lg: 'h-12 px-7 text-base', icon: 'h-10 w-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
});
Button.displayName = 'Button';
export { buttonVariants };
