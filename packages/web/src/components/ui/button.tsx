import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-ink cursor-pointer",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        outline: 'border border-input bg-transparent hover:border-foreground hover:bg-accent/60',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-foreground underline underline-offset-4 decoration-foreground/40 decoration-1 hover:decoration-foreground',
      },
      size: {
        default: 'h-11 sm:h-10 px-4 py-2 has-[>svg]:px-3.5',
        sm: 'h-10 sm:h-9 rounded-md gap-2 px-3 has-[>svg]:px-3',
        lg: 'h-12 sm:h-11 rounded-md px-6 text-base has-[>svg]:px-5',
        icon: 'size-11 sm:size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
