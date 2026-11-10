/**
 * Pone el servidor a escuchar. Si el puerto está ocupado (lo típico: otra ventana de Taptana
 * que quedó abierta) prueba los siguientes en vez de fallar.
 */

import { createAdaptorServer, type ServerType } from '@hono/node-server';

/** Cuántos puertos más se prueban después del pedido. */
export const PORT_ATTEMPTS = 20;

/** No se pudo escuchar. El mensaje está escrito para mostrarlo tal cual. */
export class ListenError extends Error {}

export interface Listening {
  server: ServerType;
  /** El puerto donde quedó escuchando. Distinto del pedido si ese estaba ocupado. */
  port: number;
}

export interface ListenOptions {
  port: number;
  host: string;
  /** Por defecto PORT_ATTEMPTS. */
  attempts?: number;
}

type FetchHandler = Parameters<typeof createAdaptorServer>[0]['fetch'];

export function listen(fetch: FetchHandler, opts: ListenOptions): Promise<Listening> {
  const first = opts.port;
  const last = Math.min(65535, first + (opts.attempts ?? PORT_ATTEMPTS));
  return new Promise((resolve, reject) => {
    const server = createAdaptorServer({ fetch, hostname: opts.host });
    let port = first;
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === 'EADDRINUSE' && port < last) {
        port += 1;
        server.listen(port, opts.host);
        return;
      }
      server.off('error', onError);
      reject(new ListenError(explain(err, first, last, opts.host)));
    };
    server.on('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve({ server, port });
    });
    server.listen(port, opts.host);
  });
}

function explain(err: NodeJS.ErrnoException, first: number, last: number, host: string): string {
  switch (err.code) {
    case 'EADDRINUSE':
      return first === last
        ? `El puerto ${first} está ocupado por otro programa. Ciérralo o elige otro puerto con --port.`
        : `Los puertos del ${first} al ${last} están ocupados. Cierra el programa que los usa (¿otra ventana de Taptana?) o elige otro con --port.`;
    case 'EACCES':
      return `Esta computadora no deja usar el puerto ${first}. Elige uno mayor a 1024 con --port, por ejemplo --port 4321.`;
    case 'EADDRNOTAVAIL':
    case 'ENOTFOUND':
      return `Esta computadora no tiene la dirección «${host}». Revisa --host (o quítalo para escuchar en toda la red).`;
    default:
      return `No se pudo arrancar el servidor: ${err.message}`;
  }
}
