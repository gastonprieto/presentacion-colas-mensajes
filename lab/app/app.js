// La app que pide facturas en PDF, de las dos formas de la presentación:
//   POST /facturas/sync  → genera la factura ahí mismo y el cliente espera (3 lugares; si no hay → 503)
//   POST /facturas?n=10  → deja n mensajes en la cola y responde 202 al instante
const http = require('node:http');
const { conectar, dormir, COLA, DLQ } = require('./comun');

const WORK_MS = Number(process.env.WORK_MS || 1500);
const LUGARES = Number(process.env.LUGARES || 3);
let ocupados = 0;
let numero = 0;

const log = (...a) => console.log('[app]', ...a);

function responder(res, code, texto) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(texto + '\n');
}

conectar('app').then(({ ch }) => {
  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ruta = `${req.method} ${url.pathname}`;

    if (ruta === 'POST /facturas/sync') {
      if (ocupados >= LUGARES) {
        log(`sync: ${LUGARES} lugares ocupados → 503`);
        return responder(res, 503, `503: los ${LUGARES} lugares están ocupados, no hay dónde esperar`);
      }
      const n = ++numero;
      ocupados++;
      const t0 = Date.now();
      await dormir(WORK_MS);
      ocupados--;
      log(`sync: factura #${n} generada mientras el cliente esperaba (${Date.now() - t0} ms)`);
      return responder(res, 200, `200: factura #${n} lista (esperaste ${Date.now() - t0} ms)`);
    }

    if (ruta === 'POST /facturas') {
      const cant = Math.min(Number(url.searchParams.get('n') || 1), 1000);
      const roto = url.searchParams.has('roto');
      const caer = url.searchParams.has('caer');
      const ids = [];
      for (let i = 0; i < cant; i++) {
        const id = ++numero;
        ids.push(id);
        ch.sendToQueue(COLA, Buffer.from(JSON.stringify({ id, roto, caer })), { persistent: true });
      }
      const rango = `#${ids[0]}${cant > 1 ? '…#' + ids.at(-1) : ''}`;
      const extra = roto ? ' (mensaje roto: falla siempre)' : caer ? ' (el worker se va a caer antes del ack)' : '';
      log(`encolé ${cant} factura(s) ${rango}${extra}`);
      return responder(res, 202, `202: ${cant} factura(s) en la cola (${rango})${extra}. Te aviso cuando esté.`);
    }

    if (ruta === 'GET /cola') {
      const q = await ch.checkQueue(COLA);
      const d = await ch.checkQueue(DLQ);
      return responder(res, 200, `en la cola: ${q.messageCount} · workers conectados: ${q.consumerCount} · en la DLQ: ${d.messageCount}`);
    }

    responder(res, 404, 'rutas: POST /facturas/sync · POST /facturas?n=10[&roto|&caer] · GET /cola');
  }).listen(3000, () => log('escuchando en :3000'));
});
