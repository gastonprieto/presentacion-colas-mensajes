// Worker: toma de a un mensaje por vez, genera la factura y recién ahí confirma (ack).
// Todos los workers son copias iguales que compiten por los mensajes de la misma cola.
const os = require('node:os');
const { conectar, dormir, COLA } = require('./comun');

const WORK_MS = Number(process.env.WORK_MS || 1500);
const yo = `worker ${os.hostname().slice(0, 6)}`;
const log = (...a) => console.log(`[${yo}]`, ...a);

conectar(yo).then(async ({ ch }) => {
  await ch.prefetch(1); // no tomar otro mensaje hasta terminar el actual
  await ch.consume(COLA, async (msg) => {
    const { id, roto, caer } = JSON.parse(msg.content.toString());
    const entregas = (msg.properties.headers?.['x-delivery-count'] || 0) + 1;
    const aviso = msg.fields.redelivered ? ` ⚠ REENTREGADO (entrega ${entregas}): es un reintento, o un duplicado si el anterior llegó a hacerlo` : '';
    log(`tomé la factura #${id}${aviso}`);
    await dormir(WORK_MS * (0.6 + Math.random() * 0.8)); // unas facturas tardan más que otras

    if (roto) {
      log(`✗ factura #${id} falló (entrega ${entregas} de 3) → la devuelvo a la cola`);
      return ch.nack(msg, false, true); // a la tercera falla RabbitMQ la manda a la DLQ
    }
    if (caer && !msg.fields.redelivered) {
      log(`📧 mail de la factura #${id} enviado… y me caigo ANTES del ack 💥`);
      process.exit(1);
    }
    ch.ack(msg);
    log(`✓ factura #${id} lista`);
  });
  log(`esperando mensajes de "${COLA}" (${WORK_MS} ms por factura)`);
});

process.on('SIGTERM', () => { log('me apagan'); process.exit(0); });
