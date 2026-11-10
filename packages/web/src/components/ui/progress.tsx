import * as React from 'react';
import { cn } from '@/lib/utils';

/** Barra de progreso. `value` de 0 a 100. */
function Progress({ className, value, indicatorClassName, ...props }: Omit<React.ComponentProps<'div'>, 'children'> & { value: number; indicatorClassName?: string }) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      data-slot="progress"
      className={cn('bg-primary/15 relative h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <div className={cn('bg-primary h-full rounded-full transition-all', indicatorClassName)} style={{ width: `${v}%` }} />
    </div>
  );
}

export { Progress };
