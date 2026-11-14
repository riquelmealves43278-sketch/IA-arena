// IA Arena — motor de treino (roda em Worker ou Node). Emulador: binjgb (MIT).
let SR = 44100;
const AF = 4096, SW = 20, SH = 18, NI = SW * SH, NH = 12, NO = 8;
const NW = NI * NH + NH + NH * NO + NO, FRAME = 70224;
const BTN = ['up', 'down', 'left', 'right', 'A', 'B', 'start', 'select'];
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(6.2831853 * Math.random());
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

class Game {
  constructor(M, rom) {
    this.M = M; this.e = 0; this.rom = new Uint8Array(rom); // o emulador libera a ROM ao ser deletado: copia nova a cada reset
    this.size = (rom.byteLength + 0x7fff) & ~0x7fff;
    this.x = new Float32Array(NI); this.h = new Float32Array(NH);
  }
  reset() {
    const M = this.M;
    if (this.e) { M._emulator_delete(this.e); M._joypad_delete(this.jb); }
    const p = M._malloc(this.size);
    new Uint8Array(M.HEAP8.buffer, p, this.size).fill(0).set(this.rom);
    this.e = M._emulator_new_simple(p, this.size, SR, AF, 0);
    if (!this.e) throw new Error('ROM inválida');
    this.fbp = M._get_frame_buffer_ptr(this.e);
    // sem este callback o emulador ignora os botões (era o bug: a IA nunca controlava o jogo)
    this.jb = M._joypad_new(); M._emulator_set_default_joypad_callback(this.e, this.jb);
    this.set = BTN.map(b => M['_set_joyp_' + b]); this.set.forEach(f => f(this.e, 0));
  }
  fb() { return new Uint8Array(this.M.HEAP8.buffer, this.fbp, 160 * 144 * 4); }
  audio() { return new Uint8Array(this.M.HEAP8.buffer, this.M._get_audio_buffer_ptr(this.e), AF * 2).slice(); }
  run(frames, onAudio) {
    const M = this.M, t = M._emulator_get_ticks_f64(this.e) + frames * FRAME;
    for (;;) {
      const ev = M._emulator_run_until_f64(this.e, t);
      if ((ev & 2) && onAudio) onAudio(this.audio());
      if (ev & 4) break;
    }
  }
  obs() {
    const f = this.fb(), x = this.x;
    for (let y = 0; y < SH; y++) for (let i = 0; i < SW; i++) x[y * SW + i] = f[((y * 8 + 4) * 160 + i * 8 + 4) * 4] / 255;
  }
  // rede NI -> NH (tanh) -> NO; cada saída vira probabilidade de apertar o botão (política estocástica com semente)
  act(w, rng) {
    const x = this.x, h = this.h, b1 = NI * NH, w2 = b1 + NH, b2 = w2 + NH * NO; let m = 0;
    for (let j = 0; j < NH; j++) { let s = w[b1 + j]; const o = j * NI; for (let i = 0; i < NI; i++) s += x[i] * w[o + i]; h[j] = Math.tanh(s); }
    for (let k = 0; k < NO; k++) {
      let s = w[b2 + k]; for (let j = 0; j < NH; j++) s += h[j] * w[w2 + k * NH + j];
      const on = rng() < 1 / (1 + Math.exp(-s)) ? 1 : 0; this.set[k](this.e, on); m |= on << k;
    }
    return m;
  }
  ram(a) { return this.M._emulator_read_mem(this.e, a); }
}

// Um episódio = 1 partida. Termina no tempo máximo ou quando fica "paciência" sem ver nenhuma tela nova.
class Episode {
  constructor(g, w, addr, cfg, seeded) {
    g.reset(); Object.assign(this, { g, w, addr, cfg, seen: new Set(), top: 0, s: 0, last: 0, btn: 0, done: false, rng: mulberry(seeded ? 1337 : Date.now()) });
  }
  tick(oa) { // 1 decisão = 4 quadros
    const g = this.g; g.obs(); this.btn = g.act(this.w, this.rng); g.run(4, oa);
    let h = 2166136261; for (let i = 0; i < NI; i++) h = Math.imul(h ^ ((g.x[i] * 3.99) | 0), 16777619);
    if (!this.seen.has(h)) { this.seen.add(h); this.last = this.s; }
    if (this.addr != null) this.top = Math.max(this.top, g.ram(this.addr));
    if (++this.s >= this.cfg.maxSteps || this.s - this.last > this.cfg.patSteps) this.done = true;
  }
  get fit() { return this.seen.size + this.top * 50; }
}

class Trainer {
  constructor(g, addr, seed, cfg) {
    Object.assign(this, { g, addr, cfg, gen: 0, best: null, bestFit: -1, stale: 0, i: 0, ep: null });
    this.pop = Array.from({ length: cfg.P }, () => Trainer.rand()); this.fit = new Array(cfg.P).fill(null);
    if (seed) this.pop[0] = Float32Array.from(seed);
  }
  static rand() { const w = new Float32Array(NW); for (let i = 0; i < NW; i++) w[i] = gauss() * (i < NI * NH ? 0.05 : 0.5); return w; }
  static mutate(p, s) { const w = Float32Array.from(p); for (let i = 0; i < NW; i++) if (Math.random() < 0.05) w[i] += gauss() * s * (i < NI * NH ? 0.3 : 1); return w; }
  invalidate() { this.fit = this.fit.map(() => null); this.i = 0; this.ep = null; this.bestFit = -1; this.stale = 0; }
  tick(oa) { // avança 1 decisão; devolve 'gen' quando fecha uma geração
    if (!this.ep) {
      while (this.i < this.pop.length && this.fit[this.i] != null) this.i++;
      if (this.i >= this.pop.length) return this.nextGen();
      this.ep = new Episode(this.g, this.pop[this.i], this.addr, this.cfg, true);
    }
    this.ep.tick(oa);
    if (this.ep.done) { this.fit[this.i] = this.ep.fit; this.ep = null; this.i++; if (this.i >= this.pop.length) return this.nextGen(); }
    return null;
  }
  nextGen() {
    const P = this.cfg.P, o = [...this.fit.keys()].sort((a, b) => this.fit[b] - this.fit[a]);
    if (this.fit[o[0]] > this.bestFit) { this.bestFit = this.fit[o[0]]; this.best = this.pop[o[0]].slice(); this.stale = 0; } else this.stale++;
    const boom = this.stale > 0 && this.stale % 15 === 0, sg = boom ? 0.5 : 0.2; // anti-estagnação
    const el = o.slice(0, Math.max(2, P >> 2)), np = [], nf = [];
    for (const k of el) { np.push(this.pop[k]); nf.push(this.fit[k]); }
    while (np.length < P) { np.push(boom && np.length >= P - 6 ? Trainer.rand() : Trainer.mutate(this.pop[el[(Math.random() * el.length) | 0]], sg)); nf.push(null); }
    this.pop = np; this.fit = nf; this.i = 0; this.gen++;
    return 'gen';
  }
}
if (typeof module !== 'undefined') module.exports = { Game, Trainer, Episode, NW };
