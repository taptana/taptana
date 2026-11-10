/**
 * Avisos breves ("Guardado", "Link copiado"). Uso: `toast('Link copiado')` o
 * `toast.error('No se pudo guardar')` desde cualquier parte; `<Toaster />` va una vez en App.
 */
import { useSyncExternalStore } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastKind = 'default' | 'success' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

function dismiss(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

function show(kind: ToastKind, message: string, opts: { action?: ToastItem['action']; durationMs?: number } = {}): number {
  const id = nextId++;
  items = [...items.slice(-3), { id, kind, message, ...(opts.action ? { action: opts.action } : {}) }];
  emit();
  setTimeout(() => dismiss(id), opts.durationMs ?? (kind === 'error' ? 7000 : 3500));
  return id;
}

type ToastOptions = Parameters<typeof show>[2];
export const toast = Object.assign((message: string, opts?: ToastOptions) => show('default', message, opts), {
  success: (message: string, opts?: ToastOptions) => show('success', message, opts),
  error: (message: string, opts?: ToastOptions) => show('error', message, opts),
  dismiss,
});

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end print:hidden" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border bg-popover text-popover-foreground px-4 py-3 text-sm shadow-lg',
            t.kind === 'error' && 'border-destructive/50',
          )}
        >
          {t.kind === 'success' && <CircleCheck className="size-4 mt-0.5 shrink-0 text-emerald-600" />}
          {t.kind === 'error' && <CircleAlert className="size-4 mt-0.5 shrink-0 text-destructive" />}
          <span className="flex-1 min-w-0 break-words">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="shrink-0 font-medium underline underline-offset-4 cursor-pointer"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Cerrar aviso" className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer" onClick={() => dismiss(t.id)}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
