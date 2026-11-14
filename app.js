const $ = s => document.querySelector(s);
const cfg = Object.assign({ snap: 2, wake: true, mode: 'visual', paused: false }, JSON.parse(localStorage.cfg || '{}'));
const saveCfg = () => localStorage.cfg = JSON.stringify(cfg);
const db = new Promise(r => { const q = indexedDB.open('iaarena', 1); q.onupgradeneeded = () => q.result.createObjectStore('a', { keyPath: 'id' }); q.onsuccess = () => r(q.result); });
const tx = async (m, f) => { const d = await db; return new Promise(r => { const q = f(d.transaction('a', m).objectStore('a')); q.onsuccess = () => r(q.result); }); };
const put = a => tx('readwrite', s => s.put({ id: a.id, name: a.name, rom: a.rom, addr: a.addr, genome: a.genome, gen: a.gen, best: a.best }));
const agents = new Map(); let live = null;
const snapMs = () => cfg.mode === 'visual' ? cfg.snap * 1000 : 0;

function addTile(a) {
  const t = document.createElement('div'); t.className = 'tile';
  t.innerHTML = '<canvas width="160" height="144"></canvas><b></b><span>Iniciando…</span><div class="row"><button>Ao vivo</button><button>Remover</button></div>';
  t.querySelector('b').textContent = a.name; a.stat = t.querySelector('span'); a.ctx = t.querySelector('canvas').getContext('2d');
  const [bl, br] = t.querySelectorAll('button'); bl.onclick = () => openLive(a);
  br.onclick = async () => { a.w.terminate(); agents.delete(a.id); t.remove(); await tx('readwrite', s => s.delete(a.id)); sum(); };
  $('#grid').append(t);
}
function start(a) {
  const w = a.w = new Worker('worker.js');
  w.onmessage = ({ data: d }) => {
    if (d.t === 'frame') { if (cfg.mode === 'visual') a.ctx.putImageData(new ImageData(new Uint8ClampedArray(d.f.buffer), 160, 144), 0, 0); }
    else if (d.t === 'stat') a.stat.textContent = `Geração ${d.gen} · melhor ${d.best} · ${d.i}/16`;
    else if (d.t === 'gen') { Object.assign(a, { gen: d.gen, best: d.best, genome: d.genome }); put(a); if (live && live.a === a) live.w.postMessage({ t: 'genome', genome: d.genome }); }
    else if (d.t === 'err') a.stat.textContent = 'Erro: ' + d.m;
  };
  w.postMessage({ t: 'init', rom: a.rom.slice(0), addr: a.addr, genome: a.genome, gen: a.gen, snapMs: snapMs() });
  if (cfg.paused) w.postMessage({ t: 'pause', v: true });
}
function sum() { $('#sum').textContent = agents.size ? `${agents.size} agente(s) ${cfg.paused ? 'pausados' : 'treinando'}` : 'Nenhum agente ainda'; }
function setMode(m) {
  cfg.mode = m; saveCfg(); $('#grid').classList.toggle('off', m === 'offline');
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  agents.forEach(a => a.w.postMessage({ t: 'snap', ms: snapMs() })); wake();
}
let lock = null;
async function wake() { try { if (cfg.wake && 'wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.onrelease = () => lock = null; } } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

// Ao vivo: um Worker extra joga o melhor indivíduo em 60 fps, com som opcional
function openLive(a) {
  const ac = new AudioContext(), w = new Worker('worker.js'), c = $('#lc').getContext('2d');
  live = { a, w, ac, sound: false, at: 0 }; $('#live').hidden = false; $('#snd').textContent = 'Som: desligado';
  $('#lt').textContent = a.name + (a.genome ? ` · melhor da geração ${a.gen}` : ' · ainda sem treino (rede aleatória)');
  w.onmessage = ({ data: d }) => {
    if (d.t === 'frame') c.putImageData(new ImageData(new Uint8ClampedArray(d.f.buffer), 160, 144), 0, 0);
    else if (d.t === 'audio' && live.sound) play(d.b);
  };
  w.postMessage({ t: 'init', live: true, rom: a.rom.slice(0), genome: a.genome, sr: ac.sampleRate });
}
function play(b) {
  const { ac } = live, buf = ac.createBuffer(2, 4096, ac.sampleRate), l = buf.getChannelData(0), r = buf.getChannelData(1);
  for (let i = 0; i < 4096; i++) { l[i] = b[2 * i] * 0.5 / 255; r[i] = b[2 * i + 1] * 0.5 / 255; }
  const s = ac.createBufferSource(); s.buffer = buf; s.connect(ac.destination);
  if (live.at < ac.currentTime + 0.05) live.at = ac.currentTime + 0.1;
  s.start(live.at); live.at += 4096 / ac.sampleRate;
}
$('#snd').onclick = () => { live.sound = !live.sound; live.ac.resume(); $('#snd').textContent = 'Som: ' + (live.sound ? 'ligado' : 'desligado'); };
$('#cl').onclick = () => { live.w.terminate(); live.ac.close(); live = null; $('#live').hidden = true; };

$('#add').onclick = () => $('#dlg').showModal();
$('#no').onclick = () => $('#dlg').close();
$('#go').onclick = async () => {
  const f = $('#rom').files[0]; if (!f) return;
  const h = $('#addr').value.trim(), addr = h ? parseInt(h, 16) : null;
  const a = { id: Date.now(), name: f.name.replace(/\.[^.]+$/, ''), rom: await f.arrayBuffer(), addr: Number.isNaN(addr) ? null : addr, genome: null, gen: 0, best: 0 };
  await put(a); agents.set(a.id, a); addTile(a); start(a); sum(); $('#dlg').close(); $('#rom').value = ''; $('#addr').value = ''; wake();
};
document.querySelectorAll('#mode button').forEach(b => b.onclick = () => setMode(b.dataset.m));
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  $('#arena').hidden = b.dataset.v !== 'arena'; $('#cfg').hidden = b.dataset.v !== 'cfg';
});
$('#snap').value = cfg.snap; $('#snapl').textContent = `Atualizar quadro a cada ${cfg.snap} s (modo visual)`;
$('#snap').oninput = e => { cfg.snap = +e.target.value; $('#snapl').textContent = `Atualizar quadro a cada ${cfg.snap} s (modo visual)`; saveCfg(); agents.forEach(a => a.w.postMessage({ t: 'snap', ms: snapMs() })); };
$('#wake').checked = cfg.wake; $('#wake').onchange = e => { cfg.wake = e.target.checked; saveCfg(); if (cfg.wake) wake(); else lock && lock.release(); };
$('#pause').textContent = cfg.paused ? 'Continuar treino' : 'Pausar treino';
$('#pause').onclick = () => { cfg.paused = !cfg.paused; saveCfg(); agents.forEach(a => a.w.postMessage({ t: 'pause', v: cfg.paused })); $('#pause').textContent = cfg.paused ? 'Continuar treino' : 'Pausar treino'; sum(); };
(async () => { for (const a of await tx('readonly', s => s.getAll())) { agents.set(a.id, a); addTile(a); start(a); } sum(); setMode(cfg.mode); })();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
