/**
 * Dibujos de marca, todos con el mismo lenguaje: el tablero de puntos (la taptana) en tinta y un
 * solo punto de resaltador, el «tocado». Usan las variables del tema, así que acompañan al modo
 * claro y al oscuro. Son decorativos (aria-hidden): el texto de al lado dice lo mismo.
 */
import { cn } from '@/lib/utils';

const HOLE = 'color-mix(in oklab, var(--foreground) 22%, transparent)';
const INK = 'var(--foreground)';
const PAPER = 'var(--background)';
const MONO = 'var(--font-mono)';

function Holes({ x, y, cols, rows, step, r = 1.6, skip = [] }: { x: number; y: number; cols: number; rows: number; step: number; r?: number; skip?: string[] }) {
  const out = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (!skip.includes(`${j},${i}`)) out.push(<circle key={`${j}-${i}`} cx={x + j * step} cy={y + i * step} r={r} fill={HOLE} />);
  return <>{out}</>;
}

/**
 * Inicio: el tablero grande con el camino de una persona, dibujado como la vista «cada toque»
 * del reporte: puntos de tinta numerados y el último, el que logra la tarea, con resaltador.
 */
export function TapBoard({ className }: { className?: string }) {
  const step = 30;
  const at = (c: number, r: number): [number, number] => [24 + c * step, 24 + r * step];
  const path: Array<[number, number]> = [at(2, 1), at(8, 2), at(4, 5), at(9, 7), at(3, 9), at(7, 11)];
  const last = path[path.length - 1] as [number, number];
  return (
    <svg viewBox="0 0 378 408" className={cn('h-auto', className)} aria-hidden="true">
      <Holes x={24} y={24} cols={12} rows={13} step={step} r={1.7} skip={path.map(([x, y]) => `${(x - 24) / step},${(y - 24) / step}`)} />
      <polyline points={path.map((p) => p.join(',')).join(' ')} fill="none" stroke={INK} strokeWidth="1.25" strokeLinejoin="round" />
      {path.slice(0, -1).map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="11" fill={INK} stroke={PAPER} strokeWidth="2" />
          <text x={x} y={y + 3.6} textAnchor="middle" fontFamily={MONO} fontSize="10.5" fontWeight="500" fill={PAPER}>
            {i + 1}
          </text>
        </g>
      ))}
      <circle cx={last[0]} cy={last[1]} r="22" fill="none" stroke={INK} strokeWidth="1" />
      <circle cx={last[0]} cy={last[1]} r="14" fill="var(--mark)" stroke={INK} strokeWidth="1.5" />
      <text x={last[0]} y={last[1] + 4} textAnchor="middle" fontFamily={MONO} fontSize="11.5" fontWeight="500" fill="var(--mark-foreground)">
        {path.length}
      </text>
    </svg>
  );
}

export type EmptyArtKind = 'prototypes' | 'studies' | 'sessions' | 'results' | 'lost';

/** Estados vacíos: un trozo del tablero con un solo detalle según lo que falta. */
export function EmptyArt({ kind, className }: { kind: EmptyArtKind; className?: string }) {
  const s = 18;
  const at = (c: number, r: number): [number, number] => [12 + c * s, 12 + r * s];
  const tapped = (c: number, r: number) => {
    const [x, y] = at(c, r);
    return <circle cx={x} cy={y} r="6.5" fill="var(--mark)" stroke={INK} strokeWidth="1.25" />;
  };
  const dot = (c: number, r: number, key?: number) => {
    const [x, y] = at(c, r);
    return <circle key={key} cx={x} cy={y} r="4.5" fill={INK} />;
  };
  const line = (pts: Array<[number, number]>) => <polyline points={pts.map(([c, r]) => at(c, r).join(',')).join(' ')} fill="none" stroke={INK} strokeWidth="1" />;
  return (
    <svg viewBox="0 0 132 96" className={cn('h-auto w-32', className)} aria-hidden="true">
      <Holes x={12} y={12} cols={7} rows={5} step={s} r={1.5} />
      {kind === 'prototypes' && tapped(3, 2)}
      {kind === 'studies' && (
        <>
          {line([
            [1, 2],
            [5, 2],
          ])}
          {dot(1, 2)}
          {dot(3, 2)}
          {tapped(5, 2)}
        </>
      )}
      {kind === 'sessions' && (
        <>
          {line([
            [1, 3],
            [2, 1],
            [4, 3],
            [5, 1],
          ])}
          {dot(1, 3)}
          {dot(2, 1)}
          {dot(4, 3)}
          {tapped(5, 1)}
        </>
      )}
      {kind === 'results' && (
        <>
          {[2, 4, 3, 5, 1].map((n, col) => Array.from({ length: n }, (_, i) => (col === 3 && i === n - 1 ? <g key={`${col}-${i}`}>{tapped(col + 1, 4 - i)}</g> : dot(col + 1, 4 - i, col * 10 + i))))}
        </>
      )}
      {kind === 'lost' && (
        <>
          {line([
            [1, 3],
            [3, 2],
          ])}
          {dot(1, 3)}
          <circle cx={at(3, 2)[0]} cy={at(3, 2)[1]} r="7" fill={PAPER} stroke={INK} strokeWidth="1.25" strokeDasharray="2.5 2.5" />
        </>
      )}
    </svg>
  );
}

/**
 * Un momento de logro (estudio listo para compartir): el punto «tocado» que suelta su onda una
 * sola vez. Solo CSS; con «reducir movimiento» queda quieto.
 */
export function TapBurst({ className }: { className?: string }) {
  return (
    <span className={cn('relative grid size-14 place-items-center', className)} aria-hidden="true">
      <span className="absolute inset-0 rounded-full border border-foreground/50 animate-ripple motion-reduce:hidden" />
      <span className="relative grid size-9 place-items-center rounded-full border-[1.5px] border-foreground bg-mark text-mark-foreground animate-pop">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </span>
  );
}
