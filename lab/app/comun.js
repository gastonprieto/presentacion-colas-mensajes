// Conexión a RabbitMQ y declaración de la cola, compartida por la app y los workers.
const amqp = require('amqplib');

const URL = process.env.RABBIT_URL || 'amqp://tienda:tienda@rabbit';
const COLA = 'facturas';
const DLQ = 'facturas.dlq';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function conectar(quien) {
  for (;;) {
    try {
      const conn = await amqp.connect(URL);
      conn.on('close', () => { console.log(`[${quien}] se cortó la conexión con RabbitMQ, me reinicio`); process.exit(1); });
      conn.on('error', () => {});
      const ch = await conn.createChannel();
      await ch.assertQueue(DLQ, { durable: true });
      // Cola quorum: guarda los mensajes en disco y cuenta las devoluciones. Un mensaje
      // devuelto más de 2 veces (3 intentos fallidos) se mueve a la DLQ.
      await ch.assertQueue(COLA, {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-delivery-limit': 2,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': DLQ,
        },
      });
      console.log(`[${quien}] conectado a RabbitMQ`);
      return { conn, ch };
    } catch {
      console.log(`[${quien}] RabbitMQ no responde, reintento en 2 s`);
      await dormir(2000);
    }
  }
}

module.exports = { conectar, dormir, COLA, DLQ };
