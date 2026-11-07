import type { Prototype, ServerInfo } from '@taptana/shared';

/** URL absoluta que abre el participante para un prototipo (y opcionalmente un estudio). */
export function participantUrl(info: ServerInfo, proto: Prototype | undefined, studyId?: string): string {
  const base = info.participantUrl || `${location.origin}/`;
  const url = new URL(proto?.url ?? '/', base);
  if (studyId) url.searchParams.set('study', studyId);
  return url.toString();
}
