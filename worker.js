importScripts('binjgb.js', 'core.js');
const wasmUrl = new URL('binjgb.wasm', self.location.href).href;
let game, tr, paused = false, live = null, lastSnap = 0, lastL = 0;
let cfg = { P: 16, maxSteps: 1350, patSteps: 180, speed: 0, snapMs: 2000 };
let frames = 0, total = 0, win = performance.now(), sT = performance.now(), sTot = 0, acc = 0, prev = performance.now();
const oa = b => postMessage({ t: 'audio', b }, [b.buffer]);
onmessage = async ({ data: d }) => {
  try {
    if (d.t === 'init') {
      const M = await Binjgb({ locateFile: () => wasmUrl, print() {}, printErr() {} });
      game = new Game(M, d.rom); Object.assign(cfg, d.cfg);
      tr = new Trainer(game, d.addr, d.genome && d.genome.length === NW ? d.genome : null, cfg); tr.gen = d.gen || 0; loop();
    } else if (d.t === 'cfg') {
      const old = cfg.maxSteps + ',' + cfg.patSteps; Object.assign(cfg, d.cfg);
      if (tr && old !== cfg.maxSteps + ',' + cfg.patSteps) tr.invalidate();
      win = performance.now(); frames = 0;
    } else if (d.t === 'pause') paused = d.v;
    else if (d.t === 'live') { live = d.on ? { speed: d.speed, audio: d.audio } : null; prev = performance.now(); acc = 0; }
  } catch (e) { postMessage({ t: 'err', m: String(e && e.message || e) }); }
};
function step() { if (tr.tick(arguments[0]) === 'gen') postMessage({ t: 'gen', gen: tr.gen, best: tr.bestFit, genome: tr.best }); frames += 4; total += 4; }
function loop() {
  try {
    let delay = 0;
    if (paused) { delay = 200; win = performance.now(); frames = 0; }
    else if (live) { runLive(); delay = 8; }
    else delay = runTrain();
    stats();
    setTimeout(loop, delay);
  } catch (e) { postMessage({ t: 'err', m: String(e && e.message || e) }); }
}
function runTrain() { // treino sem renderizar; speed = limite em × tempo real (0 = máxima)
  const t0 = performance.now(), lim = () => cfg.speed * 60 * (performance.now() - win) / 1000;
  if (cfg.speed > 0) { if (frames > lim()) return Math.min(200, (frames - lim()) / (cfg.speed * 60) * 1000); if (t0 - win > 2000) { win = t0; frames = 0; } }
  while (performance.now() - t0 < 30) { step(); if (cfg.speed > 0 && frames > lim()) break; }
  if (cfg.snapMs > 0 && t0 - lastSnap > cfg.snapMs && game.e) { lastSnap = t0; const f = game.fb().slice(); postMessage({ t: 'frame', f }, [f.buffer]); }
  return 0;
}
function runLive() { // mostra o treino atual (indivíduo em avaliação) em tempo real ou acelerado
  const now = performance.now(), sp = live.speed;
  if (sp === 0) { while (performance.now() - now < 12) step(); }
  else { acc = Math.min(acc + sp * (now - prev) / 16.742, sp * 8); while (acc >= 4) { step(sp === 1 && live.audio ? oa : null); acc -= 4; } }
  prev = now;
  if (now - lastL >= 16 && game.e) {
    lastL = now; const e = tr.ep, f = game.fb().slice();
    postMessage({ t: 'lframe', f, b: e ? e.btn : 0, gen: tr.gen, i: tr.i, P: cfg.P, s: e ? e.s : 0, fit: e ? e.fit : 0, best: tr.bestFit }, [f.buffer]);
  }
}
function stats() {
  const t = performance.now(); if (t - sT < 500) return;
  postMessage({ t: 'stat', gen: tr.gen, i: tr.i, P: cfg.P, best: tr.bestFit, x: (total - sTot) / 60 / ((t - sT) / 1000) });
  sT = t; sTot = total;
}
