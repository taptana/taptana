import { createContext, useContext } from 'react';
import type { Prototype, SessionSummary, StudyRecord } from '@taptana/shared';
import type { Route } from '@/router';
import type { ScreenNamer } from '@/lib/screens';
import { recordingOffset } from './logic.ts';

/** Lo que comparten todas las secciones del reporte. */
export interface ReportContextValue {
  study: StudyRecord;
  proto: Prototype | undefined;
  sessions: Map<string, SessionSummary>;
  /** Nombre para mostrar de cada sesión: etiqueta, alias o "Participante 3". */
  names: Map<string, string>;
  /** El nombre de una pantalla: el mismo que usa el constructor y el reproductor. */
  screenName: ScreenNamer;
  /** true al imprimir: se dibuja todo (todas las pestañas, todos los mapas). */
  printing: boolean;
  /** Vuelve a pedir el reporte (tras marcar un resultado o cambiar el camino esperado). */
  reload: () => Promise<void>;
}

export const ReportContext = createContext<ReportContextValue | null>(null);

export function useReport(): ReportContextValue {
  const value = useContext(ReportContext);
  if (!value) throw new Error('useReport fuera del reporte');
  return value;
}

/** Ruta al reproductor de una sesión, en el instante `at` (reloj de los eventos). */
export function recordingRoute(ctx: Pick<ReportContextValue, 'sessions'>, sessionId: string, at?: number, leadMs = 0): Route {
  const t = recordingOffset(ctx.sessions.get(sessionId)?.startedAt, at, leadMs);
  return t === undefined ? { name: 'player', id: sessionId } : { name: 'player', id: sessionId, t };
}
