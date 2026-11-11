/**
 * Las pocas páginas HTML que el servidor escribe por su cuenta: avisos para quien llega a una
 * dirección que no le toca (un participante en el panel, alguien en la raíz sin prototipo).
 * Texto corto, de tú, legible en un celular. Sin scripts ni archivos externos.
 */

import { API_PREFIX, PANEL_PATH } from '@taptana/shared';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--text:#1c1c1a;--muted:#62625c;--line:#e4e4df;--accent:#1f6f54;--accent-text:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--card:#1f1f1c;--text:#f1f1ec;--muted:#a5a59c;--line:#33332e;--accent:#58c29b;--accent-text:#0d1f18}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;
  background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:27rem;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px}
.brand{margin:0 0 20px;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:650}
p{margin:0 0 12px}
.muted{color:var(--muted)}
.aside{margin-top:20px;padding-top:16px;border-top:1px solid var(--line);font-size:15px}
.aside p:last-child{margin-bottom:0}
.button{display:inline-block;margin-top:4px;padding:11px 18px;border-radius:10px;background:var(--accent);color:var(--accent-text);
  font-weight:600;text-decoration:none}
.button:focus-visible{outline:3px solid var(--text);outline-offset:2px}
code{font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);padding:1px 5px;border-radius:5px}
a{color:var(--accent)}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Taptana</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="brand">Taptana</p>
${body}
</main>
</body>
</html>
`;
}

/** 401: alguien abre el panel desde otro dispositivo sin la llave. */
export function panelLockedPage(opts: { wrongKey?: boolean } = {}): string {
  return page(
    'Panel protegido',
    `<h1>El panel solo se abre desde la computadora donde corre Taptana</h1>
<p>Si eres participante, abre el link del estudio que te compartieron.</p>
<div class="aside">
<p><strong>¿Organizas la prueba?</strong> ${
      opts.wrongKey ? 'La llave de este link ya no sirve. ' : ''
    }En la terminal donde corre Taptana hay un link que dice «Panel desde otro dispositivo». Ábrelo aquí y el panel queda desbloqueado en este navegador.</p>
</div>`,
  );
}

/** 403: la petición al panel viene de otro sitio web. */
export function crossSitePage(): string {
  return page(
    'Panel protegido',
    `<h1>El panel no se puede abrir desde otro sitio</h1>
<p>Por seguridad, Taptana no deja que otra página web abra o use el panel con tus grabaciones.</p>
<p class="muted">Escribe la dirección del panel directamente en el navegador.</p>`,
  );
}

/**
 * La raíz sin prototipo: casi siempre es un participante que abrió la dirección sin el resto
 * del link. El enlace al panel solo aparece si quien mira está en la computadora de Taptana.
 */
export function lostPage(opts: { showPanelLink: boolean; brokenStudyLink?: boolean }): string {
  const lead = opts.brokenStudyLink
    ? `<h1>Este link de estudio no funciona</h1>
<p>Puede que el estudio ya no exista o que el link esté incompleto. Pídele a quien te invitó que te lo mande otra vez.</p>`
    : `<h1>Abre el link que te compartieron</h1>
<p>Esta dirección sola no lleva a ningún prototipo. Usa el link completo que te mandaron, o vuelve a escanear el código QR.</p>`;
  const aside = opts.showPanelLink
    ? `<div class="aside">
<p><strong>¿Organizas la prueba?</strong> Sube tu prototipo y arma el estudio desde el panel.</p>
<p><a class="button" href="${PANEL_PATH}">Abrir el panel</a></p>
</div>`
    : '';
  return page('Taptana', `${lead}\n${aside}`);
}

export function notFoundPage(): string {
  return page(
    'No encontrado',
    `<h1>Aquí no hay nada</h1>
<p>Esta página no existe en el prototipo. Vuelve atrás, o abre de nuevo el link que te compartieron.</p>`,
  );
}

/** El panel todavía no está compilado (solo pasa al trabajar con el código fuente). */
export function panelPlaceholderPage(): string {
  return page(
    'Panel',
    `<h1>El panel todavía no está compilado</h1>
<p>Corre <code>pnpm build</code> en la raíz del repositorio y vuelve a cargar esta página.</p>
<p class="muted">Mientras tanto la API funciona: <a href="${API_PREFIX}/sessions">${API_PREFIX}/sessions</a></p>`,
  );
}

/** 502: el sitio de un prototipo por URL no respondió (apagado, sin red, o tardó demasiado). */
export function upstreamDownPage(opts: { url: string; timeout?: boolean }): string {
  return page(
    'Prototipo no disponible',
    `<h1>No pudimos abrir este prototipo</h1>
<p>Taptana intentó abrirlo en <code>${escapeHtml(opts.url)}</code> y ${opts.timeout ? 'tardó demasiado en responder' : 'no respondió'}.</p>
<p class="muted">Si eres participante, espera un momento y vuelve a cargar la página.</p>
<div class="aside">
<p><strong>¿Organizas la prueba?</strong> Revisa que el sitio esté encendido y abre esa dirección en esta computadora. Si es un servidor de desarrollo (por ejemplo <code>npm run dev</code>), tiene que seguir corriendo durante toda la prueba.</p>
</div>`,
  );
}
