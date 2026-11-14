// IA Arena — motor de treino (roda em Worker ou Node). Emulador: binjgb (MIT).
let SR = 44100;
const AF = 4096, SW = 20, SH = 18, NI = SW * SH, NH = 12, NO = 8;
const NW = NI * NH + NH + NH * NO + NO, FRAME = 70224, STEPS = 225, P = 16;
const BTN = ['up', 'down', 'left', 'right', 'A', 'B', 'start', 'select'];
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(6.2831853 * Math.random());

class Game {
  constructor(M, rom) {
    this.M = M; this.e = 0;
    this.size = (rom.byteLength + 0x7fff) & ~0x7fff;
    this.rom = new Uint8Array(rom); // o emulador libera a ROM ao ser deletado: copia nova a cada reset
    this.x = new Float32Array(NI); this.h = new Float32Array(NH);
  }
  reset() {
    const M = this.M;
    if (this.e) M._emulator_delete(this.e);
    const p = M._malloc(this.size);
    new Uint8Array(M.HEAP8.buffer, p, this.size).fill(0).set(this.rom);
    this.e = M._emulator_new_simple(p, this.size, SR, AF, 0);
    if (!this.e) throw new Error('ROM inválida');
    this.fbp = M._get_frame_buffer_ptr(this.e);
    this.set = BTN.map(b => M['_set_joyp_' + b]);
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
  act(w) { // rede: NI -> NH (tanh) -> NO; aperta o botão se saída > 0
    const x = this.x, h = this.h, b1 = NI * NH, w2 = b1 + NH, b2 = w2 + NH * NO;
    for (let j = 0; j < NH; j++) { let s = w[b1 + j]; const o = j * NI; for (let i = 0; i < NI; i++) s += x[i] * w[o + i]; h[j] = Math.tanh(s); }
    for (let k = 0; k < NO; k++) { let s = w[b2 + k]; for (let j = 0; j < NH; j++) s += h[j] * w[w2 + k * NH + j]; this.set[k](this.e, s > 0 ? 1 : 0); }
  }
  ram(a) { return this.M._emulator_read_mem(this.e, a); }
}

// Recompensa: estados de tela únicos (genérico, serve para qualquer jogo) + variação de um endereço de RAM (opcional).
function evaluate(g, w, addr) {
  g.reset(); const seen = new Set(); let top = 0;
  for (let s = 0; s < STEPS; s++) {
    g.obs(); g.act(w); g.run(4);
    let hsh = 2166136261; for (let i = 0; i < NI; i++) hsh = Math.imul(hsh ^ ((g.x[i] * 3.99) | 0), 16777619);
    seen.add(hsh);
    if (addr != null) top = Math.max(top, g.ram(addr));
  }
  return seen.size + top * 50;
}

class Trainer {
  constructor(g, addr, seed) {
    this.g = g; this.addr = addr; this.gen = 0; this.best = null; this.bestFit = -1; this.stale = 0; this.i = 0; this.sigma = 0.15;
    this.pop = Array.from({ length: P }, () => Trainer.rand()); this.fit = new Array(P).fill(null);
    if (seed) { this.pop[0] = Float32Array.from(seed); }
  }
  static rand() { const w = new Float32Array(NW); for (let i = 0; i < NW; i++) w[i] = gauss() * 0.3; return w; }
  static mutate(p, s) { const w = Float32Array.from(p); for (let i = 0; i < NW; i++) if (Math.random() < 0.05) w[i] += gauss() * s; return w; }
  step() { // avalia 1 indivíduo; retorna true quando fecha uma geração
    if (this.fit[this.i] == null) this.fit[this.i] = evaluate(this.g, this.pop[this.i], this.addr);
    if (++this.i < P) return false;
    const o = [...this.fit.keys()].sort((a, b) => this.fit[b] - this.fit[a]);
    if (this.fit[o[0]] > this.bestFit) { this.bestFit = this.fit[o[0]]; this.best = this.pop[o[0]].slice(); this.stale = 0; } else this.stale++;
    const boom = this.stale > 0 && this.stale % 15 === 0; // anti-estagnação: mutação maior + indivíduos novos
    this.sigma = boom ? 0.5 : 0.15;
    const el = o.slice(0, 4), np = [], nf = [];
    for (const k of el) { np.push(this.pop[k]); nf.push(this.fit[k]); }
    while (np.length < P) { np.push(boom && np.length >= P - 6 ? Trainer.rand() : Trainer.mutate(this.pop[el[(Math.random() * 4) | 0]], this.sigma)); nf.push(null); }
    this.pop = np; this.fit = nf; this.i = 4; this.gen++;
    return true;
  }
}
if (typeof module !== 'undefined') module.exports = { Game, Trainer, evaluate, NW, STEPS };
