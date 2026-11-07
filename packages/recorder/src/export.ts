/** Descarga o comparte una sesión exportada (modo local). */

import type { SessionExport } from '@taptana/shared';
export { batchesToExport } from '@taptana/shared';

export function downloadExport(data: SessionExport): void {
  const json = JSON.stringify(data);
  const name = `taptana-${data.session.id}.json`;
  const file = new File([json], name, { type: 'application/json' });

  // En celulares, compartir abre AirDrop, WhatsApp, Drive... Si no se puede, descarga.
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    nav.share({ files: [file], title: 'Sesión de Taptana' }).catch(() => triggerDownload(file));
    return;
  }
  triggerDownload(file);
}

function triggerDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
