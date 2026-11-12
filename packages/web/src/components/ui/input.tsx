import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground border-input h-11 sm:h-10 w-full min-w-0 rounded-md border bg-card dark:bg-input/30 px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive flex field-sizing-content min-h-20 w-full rounded-md border bg-card dark:bg-input/30 px-3 py-2.5 text-base leading-normal shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn('flex items-center gap-2 text-[15px] leading-snug font-medium select-none mb-2', className)}
      {...props}
    />
  );
}

/** Select nativo con el estilo de shadcn. Suficiente para el constructor; sin Radix. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'border-input h-11 sm:h-10 w-full rounded-md border bg-transparent px-3 py-1 text-base md:text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50',
        'dark:bg-input/30 bg-card',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Input, Textarea, Label, NativeSelect };
