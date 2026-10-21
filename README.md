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

## Laboratorio con Docker

Lo mismo que muestran las simulaciones, con servicios reales: una **app** que pide facturas en PDF, **RabbitMQ** con la cola `facturas` (y su DLQ `facturas.dlq`) y **workers** iguales que las generan. Hace falta Docker con Compose.

```bash
docker compose up -d --build        # levanta todo (1 worker)
docker compose logs -f app worker   # en otra terminal: quién encola y qué worker toma cada factura
docker compose down -v              # al terminar (-v borra también los mensajes guardados)
```

| Dirección | Qué es |
|---|---|
| `localhost:8080` | la app (rutas abajo) |
| `http://localhost:15672` | panel de RabbitMQ (usuario `tienda`, clave `tienda`). En **Queues and Streams → facturas** está el gráfico de mensajes en la cola y la cantidad de consumidores |

| Ruta de la app | Qué hace |
|---|---|
| `POST /facturas/sync` | genera la factura mientras el cliente espera (1,5 s). Tiene 3 lugares: si están ocupados, **503** |
| `POST /facturas?n=10` | deja 10 mensajes en la cola y responde **202** al instante |
| `POST /facturas?roto` | un mensaje que falla siempre |
| `POST /facturas?caer` | un mensaje con el que el worker se cae justo antes del ack |
| `GET /cola` | mensajes en la cola, workers conectados y mensajes en la DLQ |

El código está en `lab/app/`: `app.js` (la app), `worker.js` (el worker) y `comun.js` (la conexión y la declaración de la cola).

### Recorrido

**"Te espero hasta que termines" vs. "Te dejo el pedido y sigo".** Un pico de 30 pedidos a la vez:

```bash
# sincrónico: sólo entran 3, el resto rebota
seq 30 | xargs -P30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -XPOST localhost:8080/facturas/sync | sort | uniq -c
#   3 200
#  27 503

# con cola: los 30 reciben 202 al instante
seq 30 | xargs -P30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -XPOST localhost:8080/facturas | sort | uniq -c
#  30 202
curl localhost:8080/cola        # …pero el trabajo sigue pendiente: la respuesta es inmediata, la factura no
```

**La cola absorbe los picos.** Con el panel de RabbitMQ abierto en la cola `facturas`, mandá un pico y mirá el gráfico: sube de golpe y baja de a poco, al ritmo del worker (una factura cada ~1,5 s), llegue como llegue la carga.

```bash
curl -XPOST 'localhost:8080/facturas?n=30'
```

**Más workers, la cola baja más rápido.** Los workers son copias iguales que compiten por los mensajes: cada mensaje lo toma uno solo. En los logs se ve qué worker tomó cada factura.

```bash
curl -XPOST 'localhost:8080/facturas?n=40'
docker compose up -d --scale worker=5
curl localhost:8080/cola                      # repetilo: baja cinco veces más rápido
docker compose up -d --scale worker=1         # volver a 1
```

**El que produce no depende del que consume.**

```bash
docker compose stop worker
curl -XPOST 'localhost:8080/facturas?n=10'    # la app ni se entera: 202
curl localhost:8080/cola                      # en la cola: 10 · workers conectados: 0
docker compose start worker                   # vuelven y se ponen al día solos, sin perder nada
```

**Fallas que hay que tener en cuenta.** Con 2 workers se ve mejor:

```bash
docker compose up -d --scale worker=2

# 💥 Cae antes del ack: el worker manda el mail y se cae sin confirmar. RabbitMQ le da el
# mensaje a otro worker, que lo procesa de nuevo → el mail sale dos veces (duplicado)
curl -XPOST 'localhost:8080/facturas?caer'
docker compose logs worker --since 30s        # "me caigo ANTES del ack" y después "⚠ REENTREGADO"

# ☠ Mensaje roto: falla en cada intento; a la tercera, RabbitMQ lo aparta en la DLQ
curl -XPOST 'localhost:8080/facturas?roto'
docker compose logs worker --since 30s        # entrega 1 de 3, 2 de 3, 3 de 3
curl localhost:8080/cola                      # en la DLQ: 1  (verlo en el panel: Queues → facturas.dlq → Get messages)

# 🔀 El orden no está garantizado: con varios workers, cada factura tarda distinto
curl -XPOST 'localhost:8080/facturas?n=6'
docker compose logs -f worker | grep lista    # terminan en otro orden que #1, #2, #3…
```

### Romper cosas

| Qué romper | Comando | Qué se ve | Volver |
|---|---|---|---|
| Todos los workers | `docker compose stop worker` | La app sigue respondiendo 202; la cola crece en el panel y `GET /cola` muestra 0 workers | `docker compose start worker` |
| Un worker en medio de una factura | Con 2 workers y mensajes en la cola: `docker kill lab-colas-mensajes-worker-1` (nombres en `docker compose ps`) | La factura que tenía a medias no se pierde: sin ack, RabbitMQ se la da al otro worker (aparece `⚠ REENTREGADO`) | `docker start lab-colas-mensajes-worker-1` |
| Workers lentos | `docker compose up -d --scale worker=1` y `curl -XPOST 'localhost:8080/facturas?n=100'` | La cola sigue creciendo mientras lleguen más de los que se procesan: una cola sin límite puede crecer sin control | escalar workers |
| El broker | `docker compose stop rabbit` | `POST /facturas` falla (`Empty reply` / `Failed to connect`): la cola también es una pieza que se puede caer. La app y los workers se reinician y reintentan conectarse cada 2 s | `docker compose start rabbit` |
| Mensajes guardados | Con mensajes en la cola: `docker compose stop worker rabbit` y después `docker compose start rabbit worker` | Los mensajes siguen ahí: la cola los guarda en disco (volumen `rabbit`) | — |

Si RabbitMQ queda más de un minuto en `health: starting` (`docker compose ps`) después de un `start`, recrealo: `docker compose up -d --force-recreate rabbit`. Los mensajes están en el volumen y no se pierden.
