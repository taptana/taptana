# Verde · prototipo de ejemplo

Tienda de plantas para celular, en cuatro páginas:

1. `index.html` — lista de productos con filtros.
2. `producto.html?id=...` — galería deslizable, tamaño, "Agregar al carrito".
3. `carrito.html` — cantidades y formulario de envío (para ver el enmascarado al reproducir).
4. `gracias.html` — confirmación.

Probar con Taptana desde la raíz del repo:

```
pnpm dev
```

Nada de esto es real: el carrito vive en `localStorage` y no hay pago.
