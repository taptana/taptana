/**
 * Botón flotante del modo local: "Terminar y exportar".
 * Lleva la clase rr-block para que rrweb no lo grabe (aparece como un rectángulo vacío).
 */

export function mountLocalButton(onExport: () => Promise<void>): void {
  const host = document.createElement('div');
  host.className = 'rr-block';
  host.setAttribute('data-taptana-ui', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; }
      button {
        font: 600 14px/1 system-ui, -apple-system, sans-serif;
        color: #fff; background: #111; border: 0; border-radius: 999px;
        padding: 12px 16px; box-shadow: 0 4px 14px rgba(0,0,0,.25); cursor: pointer;
        display: inline-flex; align-items: center; gap: 8px;
      }
      button:disabled { opacity: .6; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #ff3b30; animation: p 1.2s infinite; }
      @keyframes p { 50% { opacity: .3; } }
    </style>
    <button type="button"><span class="dot"></span>Terminar y exportar</button>
  `;
  const button = shadow.querySelector('button')!;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Exportando…';
    try {
      await onExport();
      button.textContent = 'Listo';
    } catch {
      button.textContent = 'Error al exportar';
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = '<span class="dot"></span>Terminar y exportar';
      }, 2000);
    }
  });
  document.body.appendChild(host);
}
