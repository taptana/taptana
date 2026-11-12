import { cn } from '@/lib/utils';

/**
 * La marca: el tablero (la taptana) como un cuadrado de tinta con nueve hoyos de papel; uno ya
 * fue «tocado» y es el único punto de resaltador. Usa los tokens del tema: en oscuro el cuadrado
 * es papel y los hoyos, tinta. El favicon y `docs/img/logo.svg` son el mismo dibujo con colores fijos.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const holes: Array<[number, number]> = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) holes.push([9 + c * 7, 9 + r * 7]);
  return (
    <svg viewBox="0 0 32 32" className={cn('shrink-0', className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="32" height="32" rx="7" fill="var(--foreground)" />
      {holes.map(([x, y]) =>
        x === 23 && y === 16 ? <circle key={`${x}-${y}`} cx={x} cy={y} r="3.1" fill="var(--mark)" /> : <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" fill="var(--background)" />,
      )}
    </svg>
  );
}

/** Marca + nombre en la tipografía de títulos. */
export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={cn('size-8', markClassName)} />
      <span className="font-display text-[1.3em] font-bold tracking-[-0.03em] leading-none">Taptana</span>
    </span>
  );
}
