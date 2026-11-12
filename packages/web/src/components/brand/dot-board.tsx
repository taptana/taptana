import { cn } from '@/lib/utils';

/**
 * El tablero de 100 puntos: la forma en que Taptana dibuja un puntaje. Se llenan tantos hoyos
 * como puntos (en orden de lectura) con `currentColor`; el resto queda hueco. Es un dibujo
 * (aria-hidden): el número siempre va escrito al lado.
 */
export function DotBoard({ value, className }: { value: number | null; className?: string }) {
  const filled = value === null ? 0 : Math.max(0, Math.min(100, Math.round(value)));
  const dots = [];
  for (let i = 0; i < 100; i++) {
    const cx = 5 + (i % 10) * 10;
    const cy = 5 + Math.floor(i / 10) * 10;
    dots.push(
      i < filled ? (
        <circle key={i} cx={cx} cy={cy} r="3.3" fill="currentColor" />
      ) : (
        <circle key={i} cx={cx} cy={cy} r="2.8" fill="none" stroke="var(--input)" strokeWidth="1" />
      ),
    );
  }
  return (
    <svg viewBox="0 0 100 100" className={cn('shrink-0', className)} aria-hidden="true" data-slot="dot-board">
      {dots}
    </svg>
  );
}

/** La versión de una línea: diez hoyos, uno por cada diez puntos. Para encabezados y listas. */
export function DotRow({ value, className }: { value: number | null; className?: string }) {
  const filled = value === null ? 0 : Math.max(0, Math.min(10, Math.round(value / 10)));
  return (
    <svg viewBox="0 0 70 6" className={cn('h-1.5 w-[70px] shrink-0', className)} aria-hidden="true" data-slot="dot-row">
      {Array.from({ length: 10 }, (_, i) =>
        i < filled ? <circle key={i} cx={3 + i * 7} cy="3" r="2.6" fill="currentColor" /> : <circle key={i} cx={3 + i * 7} cy="3" r="2.1" fill="none" stroke="var(--input)" strokeWidth="1" />,
      )}
    </svg>
  );
}
