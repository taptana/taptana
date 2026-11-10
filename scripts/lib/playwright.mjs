// Carga Playwright: primero el del proyecto (devDependency), si no el preinstalado del entorno.
// TAPTANA_CHROMIUM permite apuntar a un Chromium ya instalado en la máquina.
export async function loadPlaywright() {
  for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright/index.js']) {
    try {
      const mod = await import(spec);
      return mod.default ?? mod;
    } catch {
      /* se prueba el siguiente */
    }
  }
  throw new Error('No se encontró Playwright. Corre «pnpm install» y luego «npx playwright install chromium».');
}

export async function launchChromium() {
  const pw = await loadPlaywright();
  const executablePath = process.env['TAPTANA_CHROMIUM'];
  const browser = await pw.chromium.launch(executablePath ? { executablePath } : {});
  return { browser, devices: pw.devices };
}
