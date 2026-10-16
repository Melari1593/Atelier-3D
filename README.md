# Atelier 3D

Prototipo de una página web para explorar conceptos de piezas imprimibles en 3D.

## Funciones

- **Cortador de galletas**: sube un molde (JPEG, PNG o SVG) y descarga un STL con pared y pestaña de apoyo, listo para el laminador. Usa el conversor de [Cookie-cutter](https://github.com/Melari1593/Cookie-cutter).
- **Llavero**: la silueta de la imagen (o una placa redondeada si no hay imagen) con anilla de 10 mm.
- **Placa**: placa redondeada con la silueta de la imagen en relieve de 2 mm y orificio superior opcional.
- Vistas conceptuales de figura articulada, molde negativo y conectores; para estas piezas el STL es una **base rectangular** con las dimensiones indicadas, como punto de partida para CAD.
- Ajuste de ancho, alto, grosor, color, texto, acabado, conector y orificio; umbral e inversión para detectar la silueta.
- Las imágenes se procesan solamente en el navegador.
- Guardado local de la configuración con `localStorage`.

En las piezas reales, el ancho y el alto definen la caja donde cabe la figura, y el grosor es la altura de la pieza. El texto y el conector lateral solo aparecen en la vista previa.

## Ejecutar

Abre `dist/index.html` en un navegador moderno. No necesita instalación ni servidor.

## Integración con Cookie-cutter

- `dist/js/cookie-cutter.js` es el conversor imagen → polígonos de Cookie-cutter (`js/converter.js`) convertido en script clásico, para que la página siga funcionando sin servidor. **No se edita a mano**: tras cambiar el conversor en Cookie-cutter, regenéralo con

  ```sh
  node tools/sync-cookie-cutter.mjs ../Cookie-cutter
  ```

- `dist/js/piezas.js` construye el cortador, el llavero y la placa, genera el STL binario y la vista previa.
- `dist/js/earcut.min.js` es [earcut](https://github.com/mapbox/earcut) 2.2.4 (licencia ISC), usado para triangular las tapas.

## Estado

Este es un prototipo de interfaz. El cortador, el llavero y la placa exportan mallas cerradas listas para el laminador; revisa igualmente tolerancias y resistencia antes de imprimir. Las demás piezas exportan un bloque base que hay que terminar en CAD.

Sitio privado de demostración: https://atelier-3d-utilidades.karla-m-r93.chatgpt.site
