importScripts('binjgb.js', 'core.js');
const wasmUrl = new URL('binjgb.wasm', self.location.href).href;
let game, tr, snapMs = 2000, paused = false, last = 0, genome = null, sound = true;
onmessage = async ({ data: d }) => {
  try {
    if (d.t === 'init') {
      if (d.sr) SR = d.sr;
      const M = await Binjgb({ locateFile: () => wasmUrl, print() {}, printErr() {} });
      game = new Game(M, d.rom);
      if (d.live) { genome = d.genome ? Float32Array.from(d.genome) : Trainer.rand(); live(); }
      else { tr = new Trainer(game, d.addr, d.genome); tr.gen = d.gen || 0; snapMs = d.snapMs; train(); }
    } else if (d.t === 'snap') snapMs = d.ms;
    else if (d.t === 'pause') paused = d.v;
    else if (d.t === 'genome') genome = Float32Array.from(d.genome);
  } catch (e) { postMessage({ t: 'err', m: String(e.message || e) }); }
};
function train() {
  if (!paused) {
    const t0 = performance.now(), done = tr.step();
    postMessage({ t: 'stat', gen: tr.gen, best: Math.max(0, tr.bestFit), i: tr.i });
    if (snapMs > 0 && t0 - last > snapMs) { last = t0; const f = game.fb().slice(); postMessage({ t: 'frame', f }, [f.buffer]); }
    if (done) postMessage({ t: 'gen', gen: tr.gen, best: tr.bestFit, genome: tr.best });
  }
  setTimeout(train, paused ? 200 : 0);
}
function live() { // melhor indivíduo jogando em tempo real (60 fps) com som
  let n = 0, acc = 0, prev = performance.now();
  game.reset();
  setInterval(() => {
    const now = performance.now(); acc = Math.min(acc + (now - prev) / 16.742, 4); prev = now;
    while (acc >= 1) {
      if (n % 4 === 0) { game.obs(); game.act(genome); }
      game.run(1, b => postMessage({ t: 'audio', b }, [b.buffer]));
      acc--; if (++n >= STEPS * 4) { n = 0; game.reset(); }
    }
    const f = game.fb().slice(); postMessage({ t: 'frame', f }, [f.buffer]);
  }, 16);
}
