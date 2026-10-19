# Colas de mensajes

Presentación interactiva (reveal.js + simulaciones en SVG) sobre colas de mensajes: asincronismo, cómo una cola amortigua picos de carga, cómo comunica componentes sin que se conozcan, y qué se complica (duplicados, DLQ, orden).

**Verla:** https://gastonprieto.github.io/presentacion-colas-mensajes/ (en el celular se ve como documento vertical).

Teclas: `→` avanzar · `S` notas del orador · `F` pantalla completa · `O` vista general · `-` / `+` velocidad de las simulaciones.

## Probar

Desde `presentaciones-guideline/tools` (después de `npm i`):

```bash
node smoke.js ../../presentacion-colas-mensajes    # escritorio
node mobile.js ../../presentacion-colas-mensajes   # celular
```

Y desde esta carpeta: `node tests/interact.js` (motor de mensajería y escenas).

Basada en [presentaciones-guideline](../presentaciones-guideline).
