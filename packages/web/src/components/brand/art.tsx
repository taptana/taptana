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

/** Inicio: un celular con el tablero y un camino de toques. */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 372" className={cn('h-auto', className)} aria-hidden="true">
      <circle cx="92" cy="104" r="78" fill="var(--violet-soft)" />
      <circle cx="278" cy="282" r="74" fill="var(--maize-soft)" />
      <circle cx="304" cy="66" r="26" fill="var(--coral-soft)" />
      <Holes x={22} y={236} cols={4} rows={5} step={16} r={1.8} />
      <Holes x={286} y={128} cols={4} rows={4} step={16} r={1.8} />

      {/* El celular */}
      <rect x="104" y="26" width="152" height="320" rx="32" fill="var(--foreground)" />
      <rect x="111" y="33" width="138" height="306" rx="26" fill="var(--card)" />
      <rect x="160" y="42" width="40" height="7" rx="3.5" fill="var(--foreground)" opacity="0.85" />
      <Holes x={132} y={76} cols={5} rows={11} step={24} r={2.6} skip={['1,1', '3,3', '1,6', '3,8']} />
      <path d="M156 100 C 190 96, 206 118, 204 148 S 152 186, 156 220 S 176 266, 204 268" fill="none" stroke="var(--violet)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 8" />
      <Tap x={156} y={100} color="var(--sky)" />
      <Tap x={204} y={148} color="var(--maize)" />
      <Tap x={156} y={220} color="var(--pink)" />
      <Tap x={204} y={268} color="var(--coral)" r={10} rings={2} />

      {/* Lo que se ve después: un puntaje y unas barras, flotando al lado */}
      <g>
        <rect x="246" y="150" width="96" height="62" rx="16" fill="var(--card)" stroke="var(--border)" />
        <circle cx="274" cy="181" r="14" fill="none" stroke="var(--violet-soft)" strokeWidth="6" />
        <path d="M274 167 a14 14 0 1 1 -13.3 18.3" fill="none" stroke="var(--violet)" strokeWidth="6" strokeLinecap="round" />
        <rect x="298" y="171" width="30" height="6" rx="3" fill="var(--foreground)" opacity="0.8" />
        <rect x="298" y="184" width="20" height="6" rx="3" fill={HOLE} />
      </g>
      <g>
        <rect x="14" y="132" width="104" height="70" rx="16" fill="var(--card)" stroke="var(--border)" />
        <rect x="28" y="148" width="76" height="8" rx="4" fill="var(--violet-soft)" />
        <rect x="28" y="148" width="62" height="8" rx="4" fill="var(--violet)" />
        <rect x="28" y="163" width="76" height="8" rx="4" fill="var(--sky-soft)" />
        <rect x="28" y="163" width="44" height="8" rx="4" fill="var(--sky)" />
        <rect x="28" y="178" width="76" height="8" rx="4" fill="var(--coral-soft)" />
        <rect x="28" y="178" width="28" height="8" rx="4" fill="var(--coral)" />
      </g>
    </svg>
  );
}

export type EmptyArtKind = 'prototypes' | 'studies' | 'sessions' | 'results' | 'lost';

/** Estados vacíos: el tablero con un detalle distinto según lo que falta. */
export function EmptyArt({ kind, className }: { kind: EmptyArtKind; className?: string }) {
  return (
    <svg viewBox="0 0 176 124" className={cn('h-auto w-44', className)} aria-hidden="true">
      <circle cx="52" cy="52" r="42" fill={kind === 'sessions' ? 'var(--sky-soft)' : kind === 'results' ? 'var(--maize-soft)' : kind === 'studies' ? 'var(--coral-soft)' : 'var(--violet-soft)'} />
      <circle cx="140" cy="92" r="24" fill={kind === 'studies' ? 'var(--violet-soft)' : kind === 'prototypes' ? 'var(--maize-soft)' : 'var(--pink-soft)'} />
      <rect x="36" y="20" width="104" height="84" rx="16" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      {kind === 'prototypes' && (
        <>
          <Holes x={56} y={40} cols={5} rows={4} step={16} skip={['2,1', '2,2', '1,2', '3,2']} />
          <Tap x={88} y={62} color="var(--violet)" r={13} rings={0} />
          <path d="M88 68 v-12 m-5 5 l5 -5 l5 5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <Tap x={120} y={40} color="var(--coral)" r={5} />
        </>
      )}
      {kind === 'studies' && (
        <>
          {[
            ['var(--violet-soft)', 'var(--violet)', 52],
            ['var(--coral-soft)', 'var(--coral)', 40],
            ['var(--maize-soft)', 'var(--maize)', 46],
          ].map(([soft, full, w], i) => (
            <g key={i}>
              <rect x="50" y={33 + i * 21} width="16" height="16" rx="5" fill={soft as string} />
              <circle cx="58" cy={41 + i * 21} r="3.2" fill={full as string} />
              <rect x="74" y={38 + i * 21} width={w as number} height="6" rx="3" fill={HOLE} />
            </g>
          ))}
        </>
      )}
      {kind === 'sessions' && (
        <>
          <Holes x={56} y={40} cols={5} rows={4} step={16} skip={['2,1', '2,2', '1,1', '1,2', '3,1', '3,2']} />
          <path d="M56 88 C 70 70, 62 52, 76 46" fill="none" stroke="var(--sky)" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 6" />
          <circle cx="88" cy="62" r="17" fill="var(--violet)" />
          <path d="M83.5 53.5 v17 l14 -8.5 z" fill="#fff" />
          <Tap x={120} y={88} color="var(--coral)" r={5} />
        </>
      )}
      {kind === 'results' && (
        <>
          {[2, 4, 3, 5, 1].map((n, col) =>
            Array.from({ length: 5 }, (_, row) => {
              const on = 4 - row < n;
              const top = 4 - row === n - 1;
              return <circle key={`${col}-${row}`} cx={56 + col * 16} cy={36 + row * 13} r={on ? 4.6 : 2.2} fill={on ? (top && col === 3 ? 'var(--coral)' : 'var(--violet)') : HOLE} opacity={on && !(top && col === 3) ? 0.45 + (n / 5) * 0.55 : 1} />;
            }),
          )}
        </>
      )}
      {kind === 'lost' && (
        <>
          <Holes x={56} y={40} cols={5} rows={4} step={16} skip={['2,1']} />
          <path d="M56 88 C 64 70, 80 80, 88 56" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 6" />
          <circle cx="88" cy="56" r="9" fill="none" stroke="var(--pink)" strokeWidth="2" strokeDasharray="3 4" />
          <text x="88" y="60.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--pink-ink)" fontFamily="var(--font-display)">
            ?
          </text>
        </>
      )}
    </svg>
  );
}

/**
 * Un momento de logro (estudio listo para compartir): un toque que suelta sus ondas una sola vez.
 * Solo CSS; con «reducir movimiento» queda quieto.
 */
export function TapBurst({ className }: { className?: string }) {
  return (
    <span className={cn('relative grid size-14 place-items-center', className)} aria-hidden="true">
      <span className="absolute inset-0 rounded-full border-2 border-brand-coral animate-ripple motion-reduce:hidden" />
      <span className="absolute inset-0 rounded-full border-2 border-brand-maize animate-ripple [animation-delay:0.18s] motion-reduce:hidden" />
      <span className="absolute inset-1 rounded-full bg-brand-violet-soft" />
      <span className="relative grid size-9 place-items-center rounded-full bg-primary text-primary-foreground animate-pop">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </span>
  );
}
