/**
 * Lee la configuración de los atributos data-* de la etiqueta <script>.
 *
 *   <script src="/__taptana/recorder.js" data-prototype="local"></script>
 *   <script src="https://taptana.midominio.com/__taptana/recorder.js"
 *           data-endpoint="https://taptana.midominio.com"
 *           data-prototype="pr_9xKq2mN"
 *           data-transport="http"></script>
 */

import { LOCAL_PROTOTYPE_ID } from '@taptana/shared';

export type TransportKind = 'http' | 'local';

export interface RecorderConfig {
  /** Origen del servidor, sin barra final. Si falta, el origen del propio script. */
  endpoint: string;
  prototypeId: string;
  transport: TransportKind;
}

declare const __TAPTANA_VERSION__: string;
export const VERSION = __TAPTANA_VERSION__;

export function readConfig(): RecorderConfig {
  const script = document.currentScript as HTMLScriptElement | null;
  const data = script?.dataset ?? {};

  let endpoint = (data['endpoint'] ?? '').replace(/\/+$/, '');
  if (!endpoint && script?.src) {
    try {
      endpoint = new URL(script.src, location.href).origin;
    } catch {
      endpoint = location.origin;
    }
  }
  if (!endpoint) endpoint = location.origin;

  const transport: TransportKind = data['transport'] === 'local' ? 'local' : 'http';

  return {
    endpoint,
    prototypeId: data['prototype'] || LOCAL_PROTOTYPE_ID,
    transport,
  };
}
