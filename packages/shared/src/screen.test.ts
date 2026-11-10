import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countScreens,
  isRouteHash,
  knownScreens,
  maskUrl,
  samePath,
  sameScreen,
  screenId,
  screenLabel,
  screenParts,
  screenPath,
  screenSlug,
  screenUrl,
  virtualScreenId,
} from './screen.js';
import type { TaptanaEvent } from './events.js';

test('screenId: the base case "/" and folders become index.html', () => {
  assert.equal(screenId('/'), '/index.html');
  assert.equal(screenId(''), '/index.html');
  assert.equal(screenId('/index.html'), '/index.html');
  assert.equal(screenId('/carpeta/'), '/carpeta/index.html');
  assert.equal(screenId('/a/b/'), '/a/b/index.html');
});

test('screenId: drops the query string and keeps the file', () => {
  assert.equal(screenId('/producto.html?id=3'), '/producto.html');
  assert.equal(screenId('/producto.html?id=3&color=rojo'), '/producto.html');
  assert.equal(screenId('/?study=st_1'), '/index.html');
  assert.equal(screenId('/buscar?q=a~b'), '/buscar');
});

test('screenId: tolerates a missing leading slash, "./", repeated slashes and full URLs', () => {
  assert.equal(screenId('producto.html'), '/producto.html');
  assert.equal(screenId('./producto.html'), '/producto.html');
  assert.equal(screenId('//a//b.html'), '/a/b.html');
  assert.equal(screenId('http://localhost:4321/producto.html?id=echeveria'), '/producto.html');
  assert.equal(screenId('https://demo.example/tienda/#/carrito'), '/tienda/index.html#/carrito');
  assert.equal(screenId('  /gracias.html  '), '/gracias.html');
});

test('screenId: history routes without extension stay as they are', () => {
  assert.equal(screenId('/checkout'), '/checkout');
  assert.equal(screenId('/checkout/pago'), '/checkout/pago');
});

test('screenId: hash routes "#/x" and "#!/x" are part of the screen', () => {
  assert.equal(screenId('/index.html#/carrito'), '/index.html#/carrito');
  assert.equal(screenId('/#/carrito'), '/index.html#/carrito');
  assert.equal(screenId('/index.html#!/carrito'), '/index.html#!/carrito');
  assert.equal(screenId('/index.html#!carrito'), '/index.html#!carrito');
  assert.equal(screenId('/index.html?x=1#/carrito'), '/index.html#/carrito');
  assert.equal(screenId('/index.html#/producto/3'), '/index.html#/producto/3');
});

test('screenId: the query and the trailing slash of a hash route are ignored', () => {
  assert.equal(screenId('/index.html#/buscar?q=ana'), '/index.html#/buscar');
  assert.equal(screenId('/index.html#/carrito/'), '/index.html#/carrito');
});

test('screenId: the root hash route is the screen without hash', () => {
  assert.equal(screenId('/index.html#/'), '/index.html');
  assert.equal(screenId('/#!/'), '/index.html');
  assert.equal(screenId('/index.html#!'), '/index.html');
});

test('screenId: plain anchors like "#top" are ignored', () => {
  assert.equal(screenId('/index.html#top'), '/index.html');
  assert.equal(screenId('/producto.html?id=1#opiniones'), '/producto.html');
  assert.equal(screenId('/#'), '/index.html');
});

test('screenId: virtual screens "~name" on a URL or on a hash route', () => {
  assert.equal(screenId('/index.html~checkout'), '/index.html~checkout');
  assert.equal(screenId('/~checkout'), '/~checkout', 'a segment that starts with ~ is a normal path');
  assert.equal(screenId('/index.html#/carrito~pago'), '/index.html#/carrito~pago');
  assert.equal(screenId('/index.html~Datos de envío'), '/index.html~datos-de-envio');
  assert.equal(screenId('/index.html~checkout#top'), '/index.html~checkout');
  assert.equal(screenId('/index.html~'), '/index.html');
});

test('screenId: a tilde inside a folder name is not a virtual screen', () => {
  assert.equal(screenId('/~ana/index.html'), '/~ana/index.html');
  assert.equal(screenId('/a~b/c.html'), '/a~b/c.html');
});

test('screenId: decodes percent-encoding so written and recorded paths agree', () => {
  assert.equal(screenId('/caf%C3%A9.html'), '/café.html');
  assert.equal(screenId('/café.html'), '/café.html');
  assert.equal(screenId('/100%.html'), '/100%.html', 'a broken escape is left alone');
});

test('screenId is idempotent', () => {
  const inputs = [
    '/', '/a/', '/producto.html?id=3', '/index.html#/carrito/', '/index.html#/', '/index.html~Paso 2',
    '/index.html#/carrito~Pago', 'http://x.test/a?b=1#top', '/checkout', '/caf%C3%A9.html', '/~ana/',
  ];
  for (const input of inputs) {
    const once = screenId(input);
    assert.equal(screenId(once), once, input);
  }
});

test('screenParts splits path, route hash and virtual name', () => {
  assert.deepEqual(screenParts('/index.html#/carrito~pago'), { path: '/index.html', hash: '#/carrito', virtual: 'pago' });
  assert.deepEqual(screenParts('/producto.html?id=1#top'), { path: '/producto.html' });
  assert.deepEqual(screenParts('/'), { path: '/index.html' });
});

test('sameScreen: ignores query, anchors, trailing slash and index.html', () => {
  assert.equal(sameScreen('/gracias.html?x=1', '/gracias.html'), true);
  assert.equal(sameScreen('/', '/index.html'), true);
  assert.equal(sameScreen('', '/'), true);
  assert.equal(sameScreen('/carpeta', '/carpeta/'), true);
  assert.equal(sameScreen('/carpeta/', '/carpeta/index.html'), true);
  assert.equal(sameScreen('/index.html#top', '/'), true);
  assert.equal(sameScreen('gracias.html', '/gracias.html'), true);
  assert.equal(sameScreen('/gracias.html', '/carrito.html'), false);
});

test('sameScreen: hash routes and virtual screens tell screens apart', () => {
  assert.equal(sameScreen('/index.html#/carrito', '/#/carrito'), true);
  assert.equal(sameScreen('/index.html#/carrito', '/index.html#/pago'), false);
  assert.equal(sameScreen('/index.html#/carrito', '/index.html'), false);
  assert.equal(sameScreen('/index.html#/', '/index.html'), true);
  assert.equal(sameScreen('/index.html~checkout', '/~checkout'), false);
  assert.equal(sameScreen('/index.html~checkout', '/index.html'), false);
  assert.equal(sameScreen('/index.html~Checkout', '/index.html~checkout'), true);
  assert.equal(sameScreen('/index.html#/carrito?x=1', '/index.html#/carrito/'), true);
});

test('screenLabel gives a short readable name', () => {
  assert.equal(screenLabel('/producto.html'), 'producto');
  assert.equal(screenLabel('/index.html#/carrito'), 'carrito');
  assert.equal(screenLabel('/index.html~checkout'), 'checkout');
  assert.equal(screenLabel('/index.html'), 'inicio');
  assert.equal(screenLabel('/'), 'inicio');
  assert.equal(screenLabel('/tienda/'), 'tienda');
  assert.equal(screenLabel('/tienda/carrito.html?x=1'), 'carrito');
  assert.equal(screenLabel('/checkout'), 'checkout');
  assert.equal(screenLabel('/index.html#!/producto/3'), 'producto/3');
  assert.equal(screenLabel('/index.html#!carrito'), 'carrito');
  assert.equal(screenLabel('/index.html#/carrito~pago'), 'pago');
});

test('screenUrl and virtualScreenId', () => {
  assert.equal(screenUrl('/index.html#/carrito~pago'), '/index.html#/carrito');
  assert.equal(screenUrl('/index.html~checkout'), '/index.html');
  assert.equal(virtualScreenId('/?x=1', 'Checkout'), '/index.html~checkout');
  assert.equal(virtualScreenId('/index.html#/carrito', 'Datos de envío'), '/index.html#/carrito~datos-de-envio');
  assert.equal(virtualScreenId('/index.html~otra', 'pago'), '/index.html~pago');
  assert.equal(virtualScreenId('/index.html', '  '), '/index.html');
});

test('screenSlug and isRouteHash', () => {
  assert.equal(screenSlug('Datos de envío'), 'datos-de-envio');
  assert.equal(screenSlug('  ¡Gracias!  '), 'gracias');
  assert.equal(screenSlug('paso_2'), 'paso-2');
  assert.equal(screenSlug('checkout'), 'checkout');
  assert.equal(screenSlug('x'.repeat(80)).length, 40);
  assert.equal(isRouteHash('#/carrito'), true);
  assert.equal(isRouteHash('#!/carrito'), true);
  assert.equal(isRouteHash('/carrito'), true);
  assert.equal(isRouteHash('#top'), false);
  assert.equal(isRouteHash(''), false);
});

test('screenPath and samePath stay as aliases', () => {
  assert.equal(screenPath, screenId);
  assert.equal(samePath, sameScreen);
  assert.equal(screenPath('/producto.html?id=3'), '/producto.html');
  assert.equal(samePath('/gracias.html?x=1', '/gracias.html'), true);
});

test('maskUrl keeps the path and the parameter names, and hides every value', () => {
  assert.equal(maskUrl('/buscar?q=zapatos rojos'), '/buscar?q=*');
  assert.equal(maskUrl('/buscar?q=ana&orden=precio'), '/buscar?q=*&orden=*');
  assert.equal(maskUrl('/producto.html?id=3'), '/producto.html?id=*');
  assert.equal(maskUrl('/a?q='), '/a?q=*');
  assert.equal(maskUrl('/a?vacio'), '/a?vacio');
  assert.equal(maskUrl('/a?x=1=2'), '/a?x=*');
  assert.equal(maskUrl('/producto.html'), '/producto.html');
  assert.equal(maskUrl('/'), '/');
  assert.equal(maskUrl(''), '');
});

test('maskUrl keeps route hashes (masking their query) and drops other hashes', () => {
  assert.equal(maskUrl('/index.html#/carrito'), '/index.html#/carrito');
  assert.equal(maskUrl('/index.html#!/carrito'), '/index.html#!/carrito');
  assert.equal(maskUrl('/index.html#/buscar?q=ana'), '/index.html#/buscar?q=*');
  assert.equal(maskUrl('/index.html?u=ana#/perfil?tab=datos'), '/index.html?u=*#/perfil?tab=*');
  assert.equal(maskUrl('/index.html#top'), '/index.html');
  assert.equal(maskUrl('/login?email=ana@x.com#access_token=abc'), '/login?email=*');
});

test('maskUrl works on full URLs (referrer, rrweb Meta href) and on ScreenIds', () => {
  assert.equal(maskUrl('http://localhost:4321/producto.html?id=echeveria'), 'http://localhost:4321/producto.html?id=*');
  assert.equal(maskUrl('http://192.168.1.5:4321/?study=st_abc#top'), 'http://192.168.1.5:4321/?study=*');
  assert.equal(maskUrl('/index.html~checkout'), '/index.html~checkout');
});

test('maskUrl is idempotent and does not change which screen a URL is', () => {
  for (const url of ['/buscar?q=ana', '/index.html#/buscar?q=ana', 'http://x.test/a?b=1&c=2#top', '/a?flag']) {
    assert.equal(maskUrl(maskUrl(url)), maskUrl(url), url);
    assert.equal(screenId(maskUrl(url)), screenId(url), url);
  }
});

test('countScreens counts distinct screens, not page loads', () => {
  const nav = (t: number, to: string): TaptanaEvent => ({ kind: 'taptana', type: 'navigation', t, from: '', to });
  const events: TaptanaEvent[] = [
    nav(1, '/'),
    nav(2, '/producto.html?id=1'),
    nav(3, '/index.html'),
    nav(4, '/producto.html?id=2'),
    nav(5, '/index.html#/carrito'),
    nav(6, '/index.html~checkout'),
    { kind: 'rrweb', t: 7, data: {} },
    { kind: 'taptana', type: 'scroll', t: 8, x: 0, y: 0, depth: 1 },
  ];
  assert.equal(countScreens(events), 4);
  assert.equal(countScreens([]), 0);
});

test('knownScreens: the HTML files first, then what sessions saw that is not a file', () => {
  const nav = (to: string, title?: string): TaptanaEvent =>
    title === undefined ? { kind: 'taptana', type: 'navigation', t: 1, from: '', to } : { kind: 'taptana', type: 'navigation', t: 1, from: '', to, title };
  const files = [{ path: '/index.html', title: 'Verde · Plantas' }, { path: '/producto.html', title: '' }, { path: 'index.html', title: 'Repetida' }];
  const events: TaptanaEvent[] = [
    nav('/', 'Plantas para tu casa'),
    nav('/producto.html?id=*', 'Monstera'),
    nav('/index.html#/carrito', 'Tu carrito'),
    nav('/index.html#/carrito'),
    nav('/index.html~checkout', 'Pago'),
    nav('/checkout'),
    { kind: 'taptana', type: 'scroll', t: 2, x: 0, y: 0, depth: 1 },
  ];
  assert.deepEqual(knownScreens(files, events), [
    { id: '/index.html', label: 'inicio', source: 'file', title: 'Verde · Plantas' },
    { id: '/producto.html', label: 'producto', source: 'file', title: 'Monstera' },
    { id: '/index.html#/carrito', label: 'carrito', source: 'seen', title: 'Tu carrito' },
    { id: '/index.html~checkout', label: 'checkout', source: 'seen', title: 'Pago' },
    { id: '/checkout', label: 'checkout', source: 'seen' },
  ]);
  assert.deepEqual(knownScreens([]), []);
  assert.deepEqual(knownScreens([{ path: '/a/' }]), [{ id: '/a/index.html', label: 'a', source: 'file' }]);
});
