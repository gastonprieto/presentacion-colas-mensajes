/* Una función por slide interactiva. Cada una recibe el <section> y devuelve { start, stop }.
   main.js las crea la primera vez que se visita la slide y las pausa al salir.
   Para una slide nueva: <section data-scene="nombre"> en index.html + S.nombre = slide => { … } acá. */
(function () {
  'use strict';

  const { Sim, Clock, svgEl, cubic, curve, edge, pop, C } = window.NetKit;
  const S = {};

  /* ---------- helpers ---------- */

  // Crea la Sim sobre <svg class="sim"> y conecta los widgets que haya en la slide:
  // .stats (data-fields, data-window), .strip, canvas.chart, canvas.histo
  function setup(slide, opts) {
    const sim = new Sim(slide.querySelector('svg.sim'), opts);
    const st = slide.querySelector('.stats');
    if (st) Widgets.stats(st, sim, st.dataset.fields ? st.dataset.fields.split(',') : null, +(st.dataset.window || 5));
    const strip = slide.querySelector('.strip');
    if (strip) Widgets.strip(strip, sim);
    const cv = slide.querySelector('canvas.chart');
    if (cv) Widgets.chart(cv, sim);
    const hist = slide.querySelector('canvas.histo');
    if (hist) Widgets.histogram(hist, sim);
    return sim;
  }

  function on(slide, sel, fn) {
    slide.querySelectorAll(sel).forEach(b => b.addEventListener('click', e => { fn(b, e); b.blur(); }));
  }

  // Control segmentado: <div class="seg" data-group="x"><button data-v="a">…
  function seg(slide, group, fn) {
    const root = slide.querySelector(`.seg[data-group="${group}"]`);
    root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      root.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      b.blur();
      fn(b.dataset.v);
    }));
  }

  // Muestra solo los elementos [data-mode] que coinciden
  function showMode(slide, mode) {
    slide.querySelectorAll('[data-mode]').forEach(el => { el.hidden = el.dataset.mode !== mode; });
  }

  const life = sim => ({ start: () => sim.start(), stop: () => sim.stop(), sim });

  // Crea un MsgSim sobre <svg class="sim"> y conecta .mstats y canvas.qchart si existen
  function msetup(slide, opts) {
    const sim = new MsgKit.MsgSim(slide.querySelector('svg.sim'), opts);
    const st = slide.querySelector('.mstats');
    if (st) Widgets.mstats(st, sim, st.dataset.fields.split(','), +(st.dataset.window || 5));
    const qc = slide.querySelector('canvas.qchart');
    if (qc && Widgets.qchart) Widgets.qchart(qc, sim);
    return sim;
  }

  const fmtRate = r => `${String(r).replace('.', ',')} /s`;
  const FACTURA = { producer: 'App', producerSub: 'pide la factura', service: 'Facturación', serviceSub: 'genera el PDF · 1,5 s', worker: 'Worker' };

  /* ---------- 1. portada: cola decorativa de fondo ---------- */

  S.title = slide => {
    const sim = new MsgKit.MsgSim(slide.querySelector('svg.bg'), {
      mode: 'queue', rate: 2.5, workers: 3, workTime: 1, seed: 11, pops: false
    });
    return life(sim);
  };

  /* ---------- 2. sincrónico: el que pide espera; sin lugar → 503 ---------- */

  S.sync = slide => {
    const base = { mode: 'sync', rate: 2, slots: 3, workTime: 1.5, seed: 2, labels: FACTURA };
    const sim = msetup(slide, base);
    const range = slide.querySelector('input[type=range]');
    const out = slide.querySelector('.rate-out'), cap = slide.querySelector('.cap-out');
    const sync = () => {
      const r = +range.value, c = sim.o.slots / sim.o.workTime;
      out.textContent = fmtRate(r);
      cap.innerHTML = `capacidad ≈ <b>${String(c).replace('.', ',')}</b> pedidos/s · ${r > c ? '<b style="color:#f87171">se satura</b>' : 'da abasto'}`;
    };
    range.addEventListener('input', () => { sim.setRate(+range.value); sync(); });
    on(slide, '[data-act=reset]', () => { range.value = 2; sim.reset(base); sync(); });
    sync();
    return life(sim);
  };

  /* ---------- 3. asincrónico: misma carga, sincrónico vs. con cola ---------- */

  S.async = slide => {
    const opts = mode => ({ mode, rate: 4, slots: 3, workers: 2, workTime: 1.5, seed: 3, labels: FACTURA });
    const sim = msetup(slide, opts('sync'));
    showMode(slide, 'sync');
    seg(slide, 'mode', v => { showMode(slide, v); sim.reset(opts(v)); });
    return life(sim);
  };

  /* ---------- 4. picos: la cola absorbe; sin cola, 503 ---------- */

  S.peak = slide => {
    const opts = mode => ({ mode, rate: 1, workers: 2, slots: 2, workTime: 0.8, seed: 4 });
    const sim = msetup(slide, opts('queue'));
    let mode = 'queue';
    showMode(slide, mode);
    seg(slide, 'mode', v => { mode = v; showMode(slide, v); sim.reset(opts(v)); });
    on(slide, '[data-act=burst]', () => sim.burst(30, 3));
    on(slide, '[data-act=reset]', () => sim.reset(opts(mode)));
    return life(sim);
  };

  /* ---------- 5. más workers: consumidores iguales que compiten ---------- */

  S.workers = slide => {
    const base = { mode: 'queue', rate: 4, workers: 1, workTime: 1, seed: 5 };
    const sim = msetup(slide, base);
    const cap = slide.querySelector('.cap-out');
    const sync = () => {
      const n = sim.o.workers, c = n / sim.o.workTime;
      cap.innerHTML = `<b>${n}</b> worker${n > 1 ? 's' : ''} · procesan ≈ <b>${c}</b>/s · llegan <b>${sim.o.rate}</b>/s → la cola ${c > sim.o.rate ? 'se vacía' : c === sim.o.rate ? 'apenas alcanza' : 'crece'}`;
    };
    on(slide, '[data-act=add]', () => { sim.addWorker(); sync(); });
    on(slide, '[data-act=remove]', () => { sim.removeWorker(); sync(); });
    on(slide, '[data-act=reset]', () => { sim.reset(base); sync(); });
    sync();
    return life(sim);
  };

  /* ---------- 6. desacople: apagar los workers no afecta a la app ---------- */

  S.decouple = slide => {
    const base = { mode: 'queue', rate: 2, workers: 2, workTime: 0.6, seed: 6, clickWorkers: true };
    const sim = msetup(slide, base);
    const btn = slide.querySelector('[data-act=toggle]');
    const label = () => {
      const anyUp = sim.workers.some(w => !w.off);
      btn.textContent = anyUp ? '⏻ Apagar workers' : '⏻ Prender workers';
      return anyUp;
    };
    on(slide, '[data-act=toggle]', () => { sim.setWorkersUp(!label()); label(); });
    on(slide, '[data-act=reset]', () => { sim.reset(base); label(); });
    sim.svg.addEventListener('click', () => setTimeout(label));
    return life(sim);
  };

  /* ---------- 8. fallas: duplicado sin ack y mensaje que siempre falla → DLQ ---------- */

  S.failures = slide => {
    const base = { mode: 'queue', rate: 1.5, workers: 2, workTime: 1, maxRetries: 3, seed: 8 };
    const sim = msetup(slide, base);
    on(slide, '[data-act=crash]', () => sim.crashBeforeAck());
    on(slide, '[data-act=poison]', () => sim.sendPoison());
    on(slide, '[data-act=reset]', () => sim.reset(base));
    return life(sim);
  };

  window.Scenes = S;
})();
