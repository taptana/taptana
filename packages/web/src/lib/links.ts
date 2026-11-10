import { PREVIEW_PARAM, STUDY_PARAM, TRYOUT_PARAM, type Prototype, type ServerInfo } from '@taptana/shared';

/** URL absoluta que abre el participante para un prototipo (y opcionalmente un estudio). */
export function participantUrl(info: ServerInfo, proto: Prototype | undefined, studyId?: string): string {
  const base = info.participantUrl || `${location.origin}/`;
  const url = new URL(proto?.url ?? '/', base);
  if (studyId) url.searchParams.set(STUDY_PARAM, studyId);
  return url.toString();
}

/**
 * URL del prototipo en este mismo origen, para abrirlo dentro de un iframe del panel (teléfono
 * del constructor, mapas de calor). `screen` es un ScreenId por URL ("/carrito.html#/pago").
 */
export function prototypeFrameUrl(proto: Prototype | undefined, opts: { screen?: string; studyId?: string; tryout?: boolean; preview?: boolean } = {}): string {
  const root = new URL(proto?.url ?? '/', `${location.origin}/`);
  const screen = (opts.screen ?? '').split('~')[0] ?? '';
  const url = screen && screen !== '/' ? new URL(screen.replace(/^\//, ''), root) : root;
  if (opts.studyId) url.searchParams.set(STUDY_PARAM, opts.studyId);
  if (opts.tryout) url.searchParams.set(TRYOUT_PARAM, '1');
  if (opts.preview) url.searchParams.set(PREVIEW_PARAM, '1');
  return url.toString();
}
