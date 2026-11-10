/**
 * Detecta las IPs de la red local y genera el QR para la terminal.
 */

import { hostname, networkInterfaces } from 'node:os';
import qrcode from 'qrcode-terminal';

/** IPv4 privadas, sin loopback. La de Wi-Fi suele ser la primera. */
export function localAddresses(): string[] {
  const out: string[] = [];
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // Las interfaces virtuales (docker, vpn) van al final.
      if (/^(docker|br-|veth|vmnet|utun|tailscale)/.test(name)) out.push(info.address);
      else out.unshift(info.address);
    }
  }
  return out;
}

/** "::ffff:192.168.1.5" → "192.168.1.5"; "fe80::1%en0" → "fe80::1"; "[::1]" → "::1". */
export function normalizeAddress(address: string): string {
  let a = address.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone !== -1) a = a.slice(0, zone);
  if (a.startsWith('::ffff:') && a.includes('.')) a = a.slice(7);
  return a;
}

export function isLoopback(address: string): boolean {
  const a = normalizeAddress(address);
  return a === '::1' || /^127\.\d+\.\d+\.\d+$/.test(a);
}

let cachedOwn: { at: number; addresses: Set<string> } | undefined;

/**
 * Todas las direcciones de esta computadora (IPv4 e IPv6). Una conexión que viene de una de
 * ellas salió de esta misma máquina: es el diseñador abriendo el panel con su IP de la Wi-Fi.
 * Se refresca cada pocos segundos porque la IP cambia al cambiar de red.
 */
export function ownAddresses(now = Date.now()): Set<string> {
  if (!cachedOwn || now - cachedOwn.at > 5000) {
    const addresses = new Set<string>();
    for (const infos of Object.values(networkInterfaces())) {
      for (const info of infos ?? []) addresses.add(normalizeAddress(info.address));
    }
    cachedOwn = { at: now, addresses };
  }
  return cachedOwn.addresses;
}

/** Nombres con los que esta computadora se conoce a sí misma, en minúsculas. */
export function ownHostNames(): string[] {
  const name = hostname().toLowerCase();
  return name ? [name, `${name}.local`] : [];
}

export function renderQr(url: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (code: string) => resolve(code));
  });
}
