/**
 * Detecta las IPs de la red local y genera el QR para la terminal.
 */

import { networkInterfaces } from 'node:os';
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

export function renderQr(url: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (code: string) => resolve(code));
  });
}
