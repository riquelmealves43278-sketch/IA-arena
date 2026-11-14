const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const cfg = Object.assign({ snap: 2, wake: true, mode: 'visual', paused: false, speed: 0, maxSec: 90, pat: 12, P: 16 }, JSON.parse(localStorage.cfg || '{}'));
const saveCfg = () => localStorage.cfg = JSON.stringify(cfg);
const db = new Promise(r => { const q = indexedDB.open('iaarena', 1); q.onupgradeneeded = () => q.result.createObjectStore('a', { keyPath: 'id' }); q.onsuccess = () => r(q.result); });
const tx = async (m, f) => { const d = await db; return new Promise(r => { const q = f(d.transaction('a', m).objectStore('a')); q.onsuccess = () => r(q.result); }); };
const put = a => tx('readwrite', s => s.put({ id: a.id, name: a.name, rom: a.rom, addr: a.addr, genome: a.genome, gen: a.gen, best: a.best }));
const agents = new Map(); let live = null;
// 1 decisão da IA = 4 quadros = 1/15 s de jogo
const wcfg = () => ({ P: cfg.P, maxSteps: cfg.maxSec * 15, patSteps: cfg.pat * 15, speed: cfg.speed, snapMs: cfg.mode === 'visual' ? cfg.snap * 1000 : 0 });
const pushCfg = () => agents.forEach(a => a.w.postMessage({ t: 'cfg', cfg: wcfg() }));
const frame = (ctx, f) => ctx.putImageData(new ImageData(new Uint8ClampedArray(f.buffer), 160, 144), 0, 0);

function addTile(a) {
  const t = document.createElement('div'); t.className = 'tile';
  t.innerHTML = '<canvas width="160" height="144"></canvas><b></b><span>Iniciando…</span><div class="row"><button>Ao vivo</button><button>Remover</button></div>';
  t.querySelector('b').textContent = a.name; a.stat = t.querySelector('span'); a.ctx = t.querySelector('canvas').getContext('2d');
  const [bl, br] = t.querySelectorAll('button'); bl.onclick = () => openLive(a);
  br.onclick = async () => { a.w.terminate(); agents.delete(a.id); t.remove(); await tx('readwrite', s => s.delete(a.id)); sum(); };
  $('#grid').append(t);
}
function start(a) {
  const w = a.w = new Worker('worker.js'); a.x = 0;
  w.onerror = e => a.stat.textContent = 'Erro ao iniciar: ' + (e.message || 'worker não carregou');
  w.onmessage = ({ data: d }) => {
    if (d.t === 'frame') { if (cfg.mode === 'visual') frame(a.ctx, d.f); }
    else if (d.t === 'stat') { a.x = d.x; a.stat.textContent = `Ger. ${d.gen} · ${Math.min(d.i + 1, d.P)}/${d.P} · melhor ${Math.max(0, d.best)} · ${d.x.toFixed(0)}×`; sum(); }
    else if (d.t === 'gen') { Object.assign(a, { gen: d.gen, best: d.best, genome: d.genome }); put(a); }
    else if (d.t === 'lframe') { if (live && live.a === a) liveFrame(d); }
    else if (d.t === 'audio') { if (live && live.a === a && live.sound) play(d.b); }
    else if (d.t === 'err') a.stat.textContent = 'Erro: ' + d.m;
  };
  w.postMessage({ t: 'init', rom: a.rom.slice(0), addr: a.addr, genome: a.genome, gen: a.gen, cfg: wcfg() });
  if (cfg.paused) w.postMessage({ t: 'pause', v: true });
}
function sum() {
  const n = agents.size, x = [...agents.values()].reduce((s, a) => s + (a.x || 0), 0);
  $('#sum').textContent = n ? `${n} agente(s) ${cfg.paused ? 'pausados' : 'treinando · ' + x.toFixed(0) + '× no total'}` : 'Nenhum agente ainda';
}
function setMode(m) {
  cfg.mode = m; saveCfg(); $('#grid').classList.toggle('off', m === 'offline');
  $$('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); pushCfg(); wake();
}
let lock = null;
async function wake() { try { if (cfg.wake && 'wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.onrelease = () => lock = null; } } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

// Botões segmentados ligados a uma chave de cfg
$$('.seg[data-key]').forEach(sg => {
  const k = sg.dataset.key, show = () => sg.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === cfg[k]));
  sg.querySelectorAll('button').forEach(b => b.onclick = () => { cfg[k] = +b.dataset.v; saveCfg(); show(); label(); pushCfg(); }); show();
});
function label() {
  $('#snapl').textContent = `Atualizar quadro a cada ${cfg.snap} s (modo visual)`;
  $('#maxl').textContent = `Duração máxima do episódio: ${cfg.maxSec} s de jogo`;
  $('#patl').textContent = `Parar se ficar ${cfg.pat} s sem tela nova`;
  $('#spdn').textContent = cfg.speed ? `Limitado a ${cfg.speed}× (poupa bateria e esquenta menos).` : 'Sem limite: o treino usa o máximo do aparelho.';
}
[['#snap', 'snap'], ['#maxs', 'maxSec'], ['#pat', 'pat']].forEach(([id, k]) => { $(id).value = cfg[k]; $(id).oninput = e => { cfg[k] = +e.target.value; saveCfg(); label(); pushCfg(); }; });
label();

// Ao vivo: o próprio Worker de treino passa a transmitir o indivíduo que está sendo avaliado agora
function openLive(a) {
  live = { a, ac: new AudioContext(), sound: false, at: 0, speed: 1 }; $('#live').hidden = false; $('#snd').textContent = 'Som: desligado';
  $('#lt').textContent = 'Carregando…'; livePost(); showLsp();
}
const livePost = on => live.a.w.postMessage({ t: 'live', on: on !== false, speed: live.speed, audio: live.sound });
const showLsp = () => $$('#lsp button').forEach(b => b.classList.toggle('on', +b.dataset.v === live.speed));
function liveFrame(d) {
  frame($('#lc').getContext('2d'), d.f);
  $$('#pad i').forEach(i => i.classList.toggle('on', (d.b >> i.dataset.k & 1) === 1));
  $('#lt').textContent = `Geração ${d.gen} · indivíduo ${Math.min(d.i + 1, d.P)}/${d.P} · ${(d.s / 15).toFixed(0)} s · telas novas ${d.fit} · melhor ${Math.max(0, d.best)}`;
}
function play(b) {
  const { ac } = live, buf = ac.createBuffer(2, 4096, 44100), l = buf.getChannelData(0), r = buf.getChannelData(1);
  for (let i = 0; i < 4096; i++) { l[i] = b[2 * i] * 0.5 / 255; r[i] = b[2 * i + 1] * 0.5 / 255; }
  const s = ac.createBufferSource(); s.buffer = buf; s.connect(ac.destination);
  if (live.at < ac.currentTime + 0.05) live.at = ac.currentTime + 0.1;
  s.start(live.at); live.at += 4096 / 44100;
}
$$('#lsp button').forEach(b => b.onclick = () => { live.speed = +b.dataset.v; showLsp(); livePost(); });
$('#snd').onclick = () => { live.sound = !live.sound; live.ac.resume(); livePost(); $('#snd').textContent = 'Som: ' + (live.sound ? 'ligado (só em 1×)' : 'desligado'); };
$('#cl').onclick = () => { livePost(false); live.ac.close(); live = null; $('#live').hidden = true; };

$('#add').onclick = () => $('#dlg').showModal();
$('#no').onclick = () => $('#dlg').close();
$('#go').onclick = async () => {
  const f = $('#rom').files[0]; if (!f) return;
  const h = $('#addr').value.trim(), addr = h ? parseInt(h, 16) : null;
  const a = { id: Date.now(), name: f.name.replace(/\.[^.]+$/, ''), rom: await f.arrayBuffer(), addr: Number.isNaN(addr) ? null : addr, genome: null, gen: 0, best: 0 };
  await put(a); agents.set(a.id, a); addTile(a); start(a); sum(); $('#dlg').close(); $('#rom').value = ''; $('#addr').value = ''; wake();
};
$$('#mode button').forEach(b => b.onclick = () => setMode(b.dataset.m));
$$('nav button').forEach(b => b.onclick = () => {
  $$('nav button').forEach(x => x.classList.toggle('on', x === b));
  $('#arena').hidden = b.dataset.v !== 'arena'; $('#cfg').hidden = b.dataset.v !== 'cfg';
});
$('#wake').checked = cfg.wake; $('#wake').onchange = e => { cfg.wake = e.target.checked; saveCfg(); if (cfg.wake) wake(); else lock && lock.release(); };
const pl = () => $('#pause').textContent = cfg.paused ? 'Continuar treino' : 'Pausar treino'; pl();
$('#pause').onclick = () => { cfg.paused = !cfg.paused; saveCfg(); agents.forEach(a => a.w.postMessage({ t: 'pause', v: cfg.paused })); pl(); sum(); };
$('#wipe').onclick = async () => { if (!confirm('Apagar todos os agentes e o treino salvo?')) return; agents.forEach(a => a.w.terminate()); agents.clear(); $('#grid').innerHTML = ''; await tx('readwrite', s => s.clear()); sum(); };
(async () => { for (const a of await tx('readonly', s => s.getAll())) { agents.set(a.id, a); addTile(a); start(a); } sum(); setMode(cfg.mode); })();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
