/**
 * Los colores de marca como clases de Tailwind, en un solo lugar. Cada tono tiene un «azulejo»
 * (fondo suave + tinta con contraste AA) para íconos y etiquetas, y un color pleno para puntos
 * e ilustraciones. Qué tono le toca a cada tipo de bloque lo decide `shared` (BLOCK_KIND_TONES).
 */
import { BLOCK_KIND_TONES, type BlockKind, type BrandTone } from '@taptana/shared';

export const TONE_TILE: Record<BrandTone, string> = {
  violet: 'bg-brand-violet-soft text-brand-violet-ink',
  coral: 'bg-brand-coral-soft text-brand-coral-ink',
  maize: 'bg-brand-maize-soft text-brand-maize-ink',
  sky: 'bg-brand-sky-soft text-brand-sky-ink',
  pink: 'bg-brand-pink-soft text-brand-pink-ink',
  indigo: 'bg-brand-indigo-soft text-brand-indigo-ink',
  stone: 'bg-brand-stone-soft text-brand-stone-ink',
};

/** Un lavado muy suave del tono, para el fondo de una tarjeta chica (el texto encima sigue en tinta normal). */
export const TONE_WASH: Record<BrandTone, string> = {
  violet: 'bg-brand-violet-soft/45',
  coral: 'bg-brand-coral-soft/45',
  maize: 'bg-brand-maize-soft/50',
  sky: 'bg-brand-sky-soft/45',
  pink: 'bg-brand-pink-soft/45',
  indigo: 'bg-brand-indigo-soft/45',
  stone: 'bg-brand-stone-soft/60',
};

/** Solo la tinta (texto pequeño de etiqueta sobre papel o tarjeta). */
export const TONE_INK: Record<BrandTone, string> = {
  violet: 'text-brand-violet-ink',
  coral: 'text-brand-coral-ink',
  maize: 'text-brand-maize-ink',
  sky: 'text-brand-sky-ink',
  pink: 'text-brand-pink-ink',
  indigo: 'text-brand-indigo-ink',
  stone: 'text-brand-stone-ink',
};

/** El color pleno, para un punto o una marca pequeña (nunca texto). */
export const TONE_DOT: Record<BrandTone, string> = {
  violet: 'bg-brand-violet',
  coral: 'bg-brand-coral',
  maize: 'bg-brand-maize',
  sky: 'bg-brand-sky',
  pink: 'bg-brand-pink',
  indigo: 'bg-brand-indigo',
  stone: 'bg-brand-stone-ink/50',
};

export const kindTone = (kind: BlockKind): BrandTone => BLOCK_KIND_TONES[kind];
