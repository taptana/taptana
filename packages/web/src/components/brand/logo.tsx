import { cn } from '@/lib/utils';

/**
 * La marca (la única pieza con varios colores del panel): un tablero redondeado con una cuadrícula de hoyos (la taptana) donde dos ya fueron
 * «tocados»: uno coral, con su onda, y uno maíz. Los colores son fijos (no dependen del tema)
 * para que el logo sea el mismo en el panel, el favicon y la presentación.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const holes: Array<[number, number]> = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) holes.push([9 + c * 7, 9 + r * 7]);
  return (
    <svg viewBox="0 0 32 32" className={cn('shrink-0', className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="32" height="32" rx="9" fill="#5F3ED8" />
      {holes.map(([x, y]) => {
        if (x === 16 && y === 16) return null;
        if (x === 23 && y === 9) return <circle key={`${x}-${y}`} cx={x} cy={y} r="2.4" fill="#F8D14F" />;
        return <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" fill="#fff" opacity="0.42" />;
      })}
      <circle cx="16" cy="16" r="5.1" fill="none" stroke="#FB794A" strokeWidth="1.3" opacity="0.55" />
      <circle cx="16" cy="16" r="2.9" fill="#FB794A" />
    </svg>
  );
}

/** Marca + nombre en la tipografía de títulos. */
export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={cn('size-8', markClassName)} />
      <span className="font-display text-[1.3em] font-bold tracking-tight leading-none">Taptana</span>
    </span>
  );
}
