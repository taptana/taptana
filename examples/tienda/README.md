# Verde · prototipo de ejemplo

Tienda de plantas para celular, en cuatro páginas:

1. `index.html`: lista de productos con filtros.
2. `producto.html?id=...`: galería deslizable, tamaño, "Agregar al carrito".
3. `carrito.html`: cantidades y formulario de envío (para ver cómo se tapa lo escrito).
4. `gracias.html`: confirmación.

Es el prototipo de "Ver un ejemplo" en el panel y de la demo pública.

- `study.json`: el estudio de ejemplo en el formato actual (bloques, v2): contexto, la tarea
  de compra con su camino esperado, escala, primer clic, sí o no, opción múltiple, una tarea
  que decide el moderador y una pregunta abierta. Se importa en Estudios → Importar.
- `study-v1.json`: el mismo estudio en el formato anterior (solo tareas), para probar que la
  importación de archivos viejos sigue funcionando.

Probarlo desde la raíz del repo:

```
pnpm start                      # y en Inicio, "Ver un ejemplo"
pnpm start ./examples/tienda    # o servir esta carpeta directamente
```

Nada de esto es real: el carrito vive en `localStorage` y no hay pago.
