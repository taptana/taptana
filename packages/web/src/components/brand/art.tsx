/**
 * Ilustraciones de marca, dibujadas a mano en SVG con el mismo motivo: un tablero de puntos y
 * toques de color. Usan las variables del tema, así que acompañan al modo claro y al oscuro.
 * Son decorativas (aria-hidden): el texto de al lado dice lo mismo.
 */
import { cn } from '@/lib/utils';

const HOLE = 'color-mix(in oklab, var(--foreground) 14%, transparent)';

function Holes({ x, y, cols, rows, step, r = 2.2, skip = [] }: { x: number; y: number; cols: number; rows: number; step: number; r?: number; skip?: string[] }) {
  const out = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (!skip.includes(`${j},${i}`)) out.push(<circle key={`${j}-${i}`} cx={x + j * step} cy={y + i * step} r={r} fill={HOLE} />);
  return <>{out}</>;
}

/** Un toque: punto de color con sus ondas. */
function Tap({ x, y, color, r = 8, rings = 1 }: { x: number; y: number; color: string; r?: number; rings?: number }) {
  return (
    <g>
      {rings >= 2 && <circle cx={x} cy={y} r={r * 2.9} fill="none" stroke={color} strokeWidth="1.5" opacity="0.25" />}
      {rings >= 1 && <circle cx={x} cy={y} r={r * 1.9} fill="none" stroke={color} strokeWidth="1.5" opacity="0.5" />}
      <circle cx={x} cy={y} r={r} fill={color} />
    </g>
  );
}

/* Grises de las ilustraciones, a partir de la tinta: así siguen al modo claro y al oscuro. */
const INK_SOFT = 'color-mix(in oklab, var(--foreground) 7%, transparent)';
const INK_MID = 'color-mix(in oklab, var(--foreground) 32%, transparent)';
const VIOLET_SOFT = 'color-mix(in oklab, var(--primary) 16%, transparent)';

/** Inicio: un celular con el tablero y un camino de toques; el último, el que importa, en coral. */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 372" className={cn('h-auto', className)} aria-hidden="true">
      <Holes x={22} y={236} cols={4} rows={5} step={16} r={1.8} />
      <Holes x={286} y={128} cols={4} rows={4} step={16} r={1.8} />

      {/* El celular */}
      <rect x="104" y="26" width="152" height="320" rx="32" fill="var(--foreground)" />
      <rect x="111" y="33" width="138" height="306" rx="26" fill="var(--card)" />
      <rect x="160" y="42" width="40" height="7" rx="3.5" fill="var(--foreground)" opacity="0.85" />
      <Holes x={132} y={76} cols={5} rows={11} step={24} r={2.6} skip={['1,1', '3,3', '1,6', '3,8']} />
      <path d="M156 100 C 190 96, 206 118, 204 148 S 152 186, 156 220 S 176 266, 204 268" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 8" />
      <Tap x={156} y={100} color={INK_MID} r={6} rings={0} />
      <Tap x={204} y={148} color={INK_MID} r={6} rings={0} />
      <Tap x={156} y={220} color={INK_MID} r={6} rings={0} />
      <Tap x={204} y={268} color="var(--tap)" r={10} rings={2} />

      {/* Lo que se ve después: un puntaje y unas barras, flotando al lado */}
      <g>
        <rect x="246" y="150" width="96" height="62" rx="14" fill="var(--card)" stroke="var(--border)" />
        <circle cx="274" cy="181" r="14" fill="none" stroke={INK_SOFT} strokeWidth="6" />
        <path d="M274 167 a14 14 0 1 1 -13.3 18.3" fill="none" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" />
        <rect x="298" y="171" width="30" height="6" rx="3" fill="var(--foreground)" opacity="0.8" />
        <rect x="298" y="184" width="20" height="6" rx="3" fill={HOLE} />
      </g>
      <g>
        <rect x="14" y="132" width="104" height="70" rx="14" fill="var(--card)" stroke="var(--border)" />
        {[62, 44, 28].map((w, i) => (
          <g key={i}>
            <rect x="28" y={148 + i * 15} width="76" height="8" rx="4" fill={INK_SOFT} />
            <rect x="28" y={148 + i * 15} width={w} height="8" rx="4" fill={i === 0 ? 'var(--foreground)' : INK_MID} />
          </g>
        ))}
      </g>
    </svg>
  );
}

export type EmptyArtKind = 'prototypes' | 'studies' | 'sessions' | 'results' | 'lost';

/** Estados vacíos: el tablero en grises con un solo detalle violeta según lo que falta. */
export function EmptyArt({ kind, className }: { kind: EmptyArtKind; className?: string }) {
  return (
    <svg viewBox="0 0 176 124" className={cn('h-auto w-40', className)} aria-hidden="true">
      <rect x="36" y="20" width="104" height="84" rx="16" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      {kind === 'prototypes' && (
        <>
          <Holes x={56} y={40} cols={5} rows={4} step={16} skip={['2,1', '2,2', '1,2', '3,2']} />
          <Tap x={88} y={62} color="var(--primary)" r={13} rings={0} />
          <path d="M88 68 v-12 m-5 5 l5 -5 l5 5" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === 'studies' && (
        <>
          {[52, 40, 46].map((w, i) => (
            <g key={i}>
              <rect x="50" y={33 + i * 21} width="16" height="16" rx="5" fill={i === 0 ? VIOLET_SOFT : INK_SOFT} />
              <circle cx="58" cy={41 + i * 21} r="3.2" fill={i === 0 ? 'var(--primary)' : INK_MID} />
              <rect x="74" y={38 + i * 21} width={w} height="6" rx="3" fill={HOLE} />
            </g>
          ))}
        </>
      )}
      {kind === 'sessions' && (
        <>
          <Holes x={56} y={40} cols={5} rows={4} step={16} skip={['2,1', '2,2', '1,1', '1,2', '3,1', '3,2']} />
          <path d="M56 88 C 70 70, 62 52, 76 46" fill="none" stroke={INK_MID} strokeWidth="2" strokeLinecap="round" strokeDasharray="1 6" />
          <circle cx="88" cy="62" r="17" fill="var(--primary)" />
          <path d="M83.5 53.5 v17 l14 -8.5 z" fill="var(--primary-foreground)" />
        </>
      )}
      {kind === 'results' && (
        <>
          {[2, 4, 3, 5, 1].map((n, col) =>
            Array.from({ length: 5 }, (_, row) => {
              const on = 4 - row < n;
              const top = 4 - row === n - 1;
              return <circle key={`${col}-${row}`} cx={56 + col * 16} cy={36 + row * 13} r={on ? 4.6 : 2.2} fill={on ? (top && col === 3 ? 'var(--primary)' : INK_MID) : HOLE} />;
            }),
          )}
        </>
      )}
      {kind === 'lost' && (
        <>
          <Holes x={56} y={40} cols={5} rows={4} step={16} skip={['2,1']} />
          <path d="M56 88 C 64 70, 80 80, 88 56" fill="none" stroke={INK_MID} strokeWidth="2" strokeLinecap="round" strokeDasharray="1 6" />
          <circle cx="88" cy="56" r="9" fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="3 4" />
          <text x="88" y="60.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--primary)" fontFamily="var(--font-display)">
            ?
          </text>
        </>
      )}
    </svg>
  );
}

/**
 * Un momento de logro (estudio listo para compartir): un toque que suelta su onda una sola vez.
 * Solo CSS; con «reducir movimiento» queda quieto.
 */
export function TapBurst({ className }: { className?: string }) {
  return (
    <span className={cn('relative grid size-14 place-items-center', className)} aria-hidden="true">
      <span className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ripple motion-reduce:hidden" />
      <span className="absolute inset-1 rounded-full bg-primary/10" />
      <span className="relative grid size-9 place-items-center rounded-full bg-primary text-primary-foreground animate-pop">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </span>
  );
}
