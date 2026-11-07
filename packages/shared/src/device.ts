/**
 * Resume un user agent en algo legible: "iPhone · Safari 18".
 * No pretende ser exacto; sirve para distinguir sesiones en una lista.
 */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent;
  let os = 'Desconocido';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'Mac';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = 'Navegador';
  let version = '';
  const pick = (re: RegExp): boolean => {
    const m = ua.match(re);
    if (!m) return false;
    version = (m[1] ?? '').split('.')[0] ?? '';
    return true;
  };
  if (pick(/Edg(?:e|A|iOS)?\/([\d.]+)/)) browser = 'Edge';
  else if (pick(/SamsungBrowser\/([\d.]+)/)) browser = 'Samsung';
  else if (pick(/OPR\/([\d.]+)/)) browser = 'Opera';
  else if (pick(/FxiOS\/([\d.]+)/) || pick(/Firefox\/([\d.]+)/)) browser = 'Firefox';
  else if (pick(/CriOS\/([\d.]+)/) || pick(/Chrome\/([\d.]+)/)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && pick(/Version\/([\d.]+)/)) browser = 'Safari';

  return version ? `${os} · ${browser} ${version}` : `${os} · ${browser}`;
}
