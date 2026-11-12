import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-1 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[1rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        info: 'bg-card border-l-[3px] border-l-sky-500 [&>svg]:!text-sky-600 dark:[&>svg]:!text-sky-400',
        warning: 'bg-card border-l-[3px] border-l-amber-500 [&>svg]:!text-amber-600 dark:[&>svg]:!text-amber-400',
        success: 'bg-card border-l-[3px] border-l-emerald-500 [&>svg]:!text-emerald-600 dark:[&>svg]:!text-emerald-400',
        destructive: 'bg-card border-l-[3px] border-l-destructive text-destructive [&_[data-slot=alert-description]]:text-destructive/90',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role={variant === 'destructive' ? 'alert' : 'status'} className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('col-start-2 min-h-4 font-medium tracking-tight', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm max-w-[65ch] [&_p]:leading-relaxed', className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
