'use strict';
/* Ironfall 2200 — original real-time strategy game. All code, models and music are procedurally generated. */
(function () {
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);   // looks only (effects, sounds): may differ between phones
// gameplay randomness: the same seed gives the same sequence on every phone, so a multiplayer game stays identical everywhere
let SRS = 1; const SR = () => { SRS = (SRS + 0x6D2B79F5) | 0; let t = Math.imul(SRS ^ (SRS >>> 15), 1 | SRS); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const srand = (a, b) => a + SR() * (b - a);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const pick = a => a[(Math.random() * a.length) | 0];
const TAU = Math.PI * 2;
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

// multiplayer: settings handed over from the lobby through a reload (same seed + map as the host)
const NETCFG = (() => { try { const v = JSON.parse(sessionStorage.getItem('ironfall.net') || 'null'); sessionStorage.removeItem('ironfall.net'); return v; } catch (e) { return null; } })();
const S = { running: false, paused: false, time: 0, diff: 1, tl: 0, over: false, stats: { built: 0, lost: 0, killed: 0 } };
const CAP = 500;

// ================= NOISE / TERRAIN =================
let SEED = NETCFG ? NETCFG.seed | 0 : (Math.random() * 100000) | 0;
function hash2(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(SEED, 982451653)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y); const xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, y) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < 4; i++) { s += vnoise(x * f + i * 17.3, y * f - i * 9.1) * a; n += a; a *= 0.5; f *= 2.03; } return s / n; }

// Map: player base in the south (summer). Enemy citadel in the centre, surrounded by
// three rings of outposts whose technology grows weaker towards the edge.
// Biomes by direction: north = winter, east = sand desert, south = summer, west = mountains.
const MAPS = [
  { name: 'Normală', size: 300, rings: [[112, 5, 0, 1.3], [78, 4, 1, 1.7], [46, 3, 2, 1.2]], gar: 1 },
  { name: 'Mare', size: 420, rings: [[165, 7, 0, 1.2], [128, 6, 1, 1.3], [90, 5, 1, 1.3], [52, 4, 2, 1.2]], gar: 0.85 },
  { name: 'Uriașă', size: 560, rings: [[228, 9, 0, 1.1], [185, 8, 0, 1.2], [140, 7, 1, 1.3], [98, 5, 2, 1.3], [56, 4, 2, 1.2]], gar: 0.7 },
  { name: 'Gigantică', size: 2000, rings: [[760, 12, 0, 1.0], [610, 11, 0, 1.1], [460, 10, 1, 1.2], [320, 8, 1, 1.3], [200, 6, 2, 1.2], [95, 4, 2, 1.2]], gar: 0.55 },
];
// player-made maps (saved on the phone, shareable as a short code)
const BUILTIN_MAPS = MAPS.length;
function genRings(size, nr, dens) { const out = []; const r0 = size * 0.38, r1 = size * 0.16;
  for (let i = 0; i < nr; i++) { const r = Math.round(nr > 1 ? r0 - (r0 - r1) * i / (nr - 1) : (r0 + r1) / 2); const tier = Math.min(2, Math.floor(i * 3 / nr)); out.push([r, Math.max(2, Math.round(Math.min(12, r / 22) * dens)), tier, 1.25]); } return out; }
function cleanMap(m) { if (!m || typeof m !== 'object') return null; const size = clamp(Math.round(+m.size / 20) * 20 || 300, 240, 2000), nr = clamp(+m.nr | 0 || 3, 1, 5), dens = clamp(+m.dens || 1, 0.5, 1.6), oil = clamp(+m.oil || 1, 0.5, 2);
  const name = String(m.name || 'Harta mea').replace(/[<>&"]/g, '').slice(0, 18) || 'Harta mea'; const seed = m.seed === null || m.seed === undefined || m.seed === '' ? null : (Math.abs(+m.seed | 0) % 1000000);
  return { name, size, nr, dens, oil, seed, rings: genRings(size, nr, dens), gar: clamp(1.15 - size / 1000, 0.55, 1), custom: true }; }
let CUSTOM_MAPS = []; try { CUSTOM_MAPS = (JSON.parse(localStorage.getItem('ironfall.maps') || '[]') || []).map(cleanMap).filter(Boolean).slice(0, 12); } catch (e) {}
MAPS.push(...CUSTOM_MAPS);
const mapCode = m => 'IF1-' + btoa(unescape(encodeURIComponent(JSON.stringify({ name: m.name, size: m.size, nr: m.nr, dens: m.dens, oil: m.oil, seed: m.seed })))).replace(/=+$/, '');
const mapFromCode = c => { try { c = String(c).trim().replace(/^IF1-/i, ''); return cleanMap(JSON.parse(decodeURIComponent(escape(atob(c))))); } catch (e) { return null; } };
let MAPI = 0; try { MAPI = clamp(+(localStorage.getItem('ironfall.map') || 0) | 0, 0, MAPS.length - 1); } catch (e) {}
if (NETCFG) { const md = NETCFG.mdef && cleanMap(NETCFG.mdef); if (md) { MAPS.push(md); MAPI = MAPS.length - 1; } else MAPI = clamp(NETCFG.map | 0, 0, BUILTIN_MAPS - 1); }
const MC = MAPS[MAPI];
if (!NETCFG && MC.seed !== null && MC.seed !== undefined) SEED = MC.seed;
const MAP = MC.size, HALF = MAP / 2, EDGE = HALF - 9, SC = MAP / 300;
const PLAYER = { x: 0, z: HALF - 26 };
// co-op: up to 10 commanders. The host is at PLAYER; guests 1..9 get bases in two rows along the southern edge.
const BSP = Math.round(44 * Math.min(SC, 1.3)), ROWA = HALF - 34, ROWB = HALF - 34 - Math.round(44 * Math.min(SC, 1.3));
const GUEST_BASE = [PLAYER, { x: BSP, z: ROWA }, { x: -BSP, z: ROWA }, { x: BSP * 2, z: ROWA - 4 }, { x: -BSP * 2, z: ROWA - 4 },
  { x: 0, z: ROWB }, { x: BSP, z: ROWB + 4 }, { x: -BSP, z: ROWB + 4 }, { x: Math.round(BSP * 1.75), z: ROWB + 14 }, { x: -Math.round(BSP * 1.75), z: ROWB + 14 }];
const PLAYER2 = GUEST_BASE[1], MAXP = GUEST_BASE.length;
const CENTER = { x: 0, z: 0 };
const BASES = [PLAYER, CENTER];
const RINGS = MC.rings.map(([r, n, tier, gap]) => ({ r, n, tier, gap }));
const OUTPOSTS = [];
RINGS.forEach((R, ri) => {
  for (let i = 0; i < R.n; i++) {
    // keep the southern approach free near the player: spread over the remaining arc
    const gap = R.gap; const span = TAU - gap; const a0 = gap / 2;
    const a = a0 + span * (i + 0.5) / R.n;
    OUTPOSTS.push({ x: Math.sin(a) * R.r, z: Math.cos(a) * R.r, tier: R.tier, a, prodT: 0, nextWave: 0, citadel: false });
  }
});
OUTPOSTS.push({ x: 0, z: 0, tier: 3, a: 0, prodT: 0, nextWave: 0, citadel: true });
const FLAT = [{ x: PLAYER.x, z: PLAYER.z - 8, r: 44 }, ...GUEST_BASE.slice(1).map(b => ({ x: b.x, z: b.z, r: 24 })), { x: 0, z: 0, r: 34 }, ...OUTPOSTS.filter(o => !o.citadel).map(o => ({ x: o.x, z: o.z, r: 16 }))];
const WELL_POS = [[-14, PLAYER.z + 12], [16, PLAYER.z + 10], [0, PLAYER.z - 16], ...GUEST_BASE.slice(1).map(b => [b.x + (b.x < 0 ? -12 : 12), b.z + 9]), ...[[-40, 118], [42, 116], [-70, 95], [72, 92], [0, 70], [-95, 40], [96, 30], [-20, -96], [30, -120], [-110, -40], [110, -70], [-60, -130], [70, 60], [-60, 60]].map(([x, z]) => [x * SC, z * SC])];
{ let k = 0; const extra = Math.min(170, Math.round(16 * (SC * SC - 1) + (MC.custom ? 14 * Math.min(SC * SC, 11) * (MC.oil - 1) : 0))); for (let t = 0; k < extra && t < 9000; t++) { const x = (hash2(t, 7) - 0.5) * (MAP - 40), z = (hash2(t, 13) - 0.5) * (MAP - 40);
  if (Math.hypot(x, z) < 40 || Math.hypot(x - PLAYER.x, z - PLAYER.z) < 35 || GUEST_BASE.some(b => Math.hypot(x - b.x, z - b.z) < 30) || OUTPOSTS.some(o => Math.hypot(o.x - x, o.z - z) < 24) || WELL_POS.some(w => Math.hypot(w[0] - x, w[1] - z) < 30)) continue; WELL_POS.push([x, z]); k++; } }
for (const o of OUTPOSTS) if (!o.citadel) { const a = o.a + 0.18; const r = Math.hypot(o.x, o.z) + 9; WELL_POS.push([Math.sin(a) * r, Math.cos(a) * r]); }
WELL_POS.push([14, 8], [-14, -8]);
for (let i = WELL_POS.length - 1; i >= 3 + MAXP - 1; i--) { const [x, z] = WELL_POS[i]; if (Math.abs(x) > EDGE - 6 || Math.abs(z) > EDGE - 6 || (MC.custom && MC.oil < 1 && hash2(i, 31) > MC.oil)) WELL_POS.splice(i, 1); }

function biomeW(x, z) {
  const a = Math.atan2(x, z) + (fbm(x * 0.008 + 7, z * 0.008) - 0.5) * 1.6;
  const near = c => Math.max(0, 1 - Math.abs(angDiff(a, c)) / (Math.PI / 2.1));
  let snow = near(Math.PI), green = near(0), sand = near(Math.PI / 2), mtn = near(-Math.PI / 2);
  const s = snow + green + sand + mtn + 1e-6; return { snow: snow / s, green: green / s, sand: sand / s, mtn: mtn / s };
}
function rawH(x, z) {
  const w = biomeW(x, z);
  let h = (fbm(x * 0.02 + 50, z * 0.02 + 50) - 0.5) * 10 + (vnoise(x * 0.13, z * 0.13) - 0.5) * 1.6;
  const r = 1 - Math.abs(fbm(x * 0.017 + 90, z * 0.017 - 40) * 2 - 1);
  const mm = smooth(clamp((r - 0.52) / 0.3, 0, 1));
  h += mm * mm * 34 * (0.2 + 0.9 * w.mtn + 0.4 * w.snow);
  if (w.sand > 0.05) { const d = Math.sin(x * 0.11 + fbm(x * 0.03, z * 0.03) * 6 + z * 0.05); h += Math.pow(d * 0.5 + 0.5, 2) * 4.5 * w.sand; }
  return h;
}
function heightFull(x, z) {
  let h = rawH(x, z);
  for (const f of FLAT) { const dx = x - f.x, dz = z - f.z; const d = Math.sqrt(dx * dx + dz * dz); if (d < f.r + 14) { if (f.h === undefined) f.h = Math.max(rawH(f.x, f.z), 0); const t = smooth(clamp((d - f.r) / 14, 0, 1)); h = f.h * (1 - t) + h * t; } }
  const e = Math.max(Math.abs(x), Math.abs(z)); if (e > HALF - 12) h += Math.pow(e - (HALF - 12), 1.5) * 0.8;
  return h;
}
const WELLS = WELL_POS.map(p => ({ x: p[0], z: p[1], h: heightFull(p[0], p[1]), pump: null, fxT: Math.random() }));
// height grid cache (1 unit resolution) for fast lookups
// big maps use a coarser grid that matches the terrain mesh vertices exactly
const TSEG = MAP > 600 ? 600 : Math.min(300, Math.round(MAP / 1.5));
const HR = MAP > 600 ? MAP / TSEG : 1, HN = Math.round(MAP / HR) + 1; const HG = new Float32Array(HN * HN);
for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) HG[j * HN + i] = heightFull(i * HR - HALF, j * HR - HALF);
for (const w of WELLS) { const i0 = Math.max(0, Math.floor((w.x - 6 + HALF) / HR)), i1 = Math.min(HN - 1, Math.ceil((w.x + 6 + HALF) / HR)), j0 = Math.max(0, Math.floor((w.z - 6 + HALF) / HR)), j1 = Math.min(HN - 1, Math.ceil((w.z + 6 + HALF) / HR));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = i * HR - HALF - w.x, dz = j * HR - HALF - w.z; const d2 = dx * dx + dz * dz; if (d2 < 36) { const t = smooth(clamp((Math.sqrt(d2) - 3) / 3, 0, 1)); const k = j * HN + i; HG[k] = w.h * (1 - t) + HG[k] * t; } } }
function heightAt(x, z) {
  const fx = clamp((x + HALF) / HR, 0, HN - 1.001), fz = clamp((z + HALF) / HR, 0, HN - 1.001); const i = fx | 0, j = fz | 0; const u = fx - i, v = fz - j;
  const k = j * HN + i; return (HG[k] * (1 - u) + HG[k + 1] * u) * (1 - v) + (HG[k + HN] * (1 - u) + HG[k + HN + 1] * u) * v;
}

// ================= THREE SETUP =================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
const scene = new THREE.Scene();
const FOG = 0xb09a78;
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 80, 200);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 500 * clamp(SC * 0.85, 1, 2.2)); const tmpC = new THREE.Color();
scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x5a4832, 1.9));
const sun = new THREE.DirectionalLight(0xfff0d6, 3.1);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220; sun.shadow.bias = -0.0008;
scene.add(sun); scene.add(sun.target);

// ---- procedural textures (generated in code, no external assets)
function canvasTex(size, draw) { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); draw(g, size); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function grain(g, n, a, b) { const img = g.getImageData(0, 0, n, n); const d = img.data; for (let i = 0; i < d.length; i += 4) { const v = (Math.random() - 0.5) * a + b; d[i] += v; d[i + 1] += v; d[i + 2] += v; } g.putImageData(img, 0, 0); }
// metal / concrete panels with rivets, seams, grime streaks
const panelTex = canvasTex(256, (g, n) => {
  g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, n, n); grain(g, n, 22, 0);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '80,70,60' : '255,255,255'},${Math.random() * 0.06})`; g.fillRect(Math.random() * n, Math.random() * n, 20 + Math.random() * 80, 20 + Math.random() * 80); }
  g.strokeStyle = 'rgba(40,40,40,.55)'; g.lineWidth = 2; for (let k = 0; k <= n; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, n); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(n, k); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; for (let k = 2; k <= n; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, n); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(n, k); g.stroke(); }
  for (let x = 0; x < n; x += 64) for (let y = 0; y < n; y += 64) for (const [dx, dy] of [[6, 6], [58, 6], [6, 58], [58, 58]]) { g.fillStyle = 'rgba(30,30,30,.6)'; g.beginPath(); g.arc(x + dx, y + dy, 2.2, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(x + dx - 0.7, y + dy - 0.7, 1, 0, TAU); g.fill(); }
  for (let i = 0; i < 26; i++) { const x = Math.random() * n, y = Math.random() * n; const gr = g.createLinearGradient(x, y, x, y + 60); gr.addColorStop(0, 'rgba(60,45,30,.22)'); gr.addColorStop(1, 'rgba(60,45,30,0)'); g.fillStyle = gr; g.fillRect(x, y, 3 + Math.random() * 5, 60); }
});
// fine ground grain for the terrain
const groundTex = canvasTex(256, (g, n) => {
  g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, n, n); grain(g, n, 40, 0);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,50,40' : '255,250,240'},${Math.random() * 0.18})`; const r = Math.random() * 2.5 + 0.5; g.beginPath(); g.arc(Math.random() * n, Math.random() * n, r, 0, TAU); g.fill(); }
});
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x3d7fd1) }, horizon: { value: new THREE.Color(0xd8cdb8) }, sunDir: { value: new THREE.Vector3(-0.45, 0.6, 0.35).normalize() }, time: { value: 0 } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float time; varying vec3 vDir;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=n(p)*a; p*=2.03; a*=0.5; } return s; }
    void main(){
      float y = max(vDir.y, 0.0);
      vec3 col = mix(horizon, top, pow(y, 0.55));
      float sd = max(dot(vDir, sunDir), 0.0);
      col += vec3(1.0,0.85,0.6) * (pow(sd, 400.0) * 3.0 + pow(sd, 12.0) * 0.35);
      vec2 cp = vDir.xz / (vDir.y + 0.15) * 1.6 + vec2(time * 0.01, time * 0.004);
      float c = smoothstep(0.48, 0.78, fbm(cp));
      vec3 cc = mix(vec3(0.82,0.84,0.88), vec3(1.0,0.97,0.92), smoothstep(0.0,1.0,sd));
      col = mix(col, cc, c * smoothstep(0.02, 0.25, y) * 0.85);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(420 * clamp(SC * 0.85, 1, 2.2), 32, 16), skyMat); sky.renderOrder = -1; sky.frustumCulled = false;
const matVC = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, map: panelTex, shininess: 18, specular: 0x2a2a2a });
const matUnit = new THREE.MeshPhongMaterial({ vertexColors: true, map: panelTex, shininess: 30, specular: 0x3a3a3a }); // metal sheen // smooth shading = rounder look
const matPlain = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const matGlow = new THREE.MeshBasicMaterial({ vertexColors: true });
const _cc = {}; function C(hex) { return _cc[hex] || (_cc[hex] = new THREE.Color(hex)); }

const G = {
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6).toNonIndexed(),
  cyl10: new THREE.CylinderGeometry(1, 1, 1, 12).toNonIndexed(),
  cyl16: new THREE.CylinderGeometry(1, 1, 1, 16).toNonIndexed(),
  sph: new THREE.SphereGeometry(1, 14, 10).toNonIndexed(),
  cool: new THREE.LatheGeometry(Array.from({ length: 9 }, (_, i) => { const t = i / 8; return new THREE.Vector2(0.78 + 0.32 * Math.pow(2 * t - 1.15, 2), t); }), 18).toNonIndexed(),
  cone: new THREE.ConeGeometry(1, 1, 8).toNonIndexed(),
  dome: new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, Math.PI / 2).toNonIndexed(),
  ico: new THREE.IcosahedronGeometry(1, 0).toNonIndexed(),
  hull: prismX([[-0.5, -0.5], [0.36, -0.5], [0.5, -0.12], [0.5, 0.0], [0.18, 0.5], [-0.44, 0.5], [-0.5, 0.3]]),
  wedge: prismY([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.18], [0.24, 0.5], [-0.24, 0.5], [-0.5, 0.18]]),
};
// side profile (z forward, y up) extruded across x, centred, size 1
function prismX(pts) { const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); g.rotateY(-Math.PI / 2); const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; }
// top outline (x right, y = forward) extruded upward, height 0..1
function prismY(pts) { const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, 1, 0); const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; }
class Builder {
  constructor() { this.parts = []; }
  add(geo, sx, sy, sz, x, y, z, color, rx = 0, ry = 0, rz = 0) { this.parts.push({ geo, sx, sy, sz, x, y, z, color, rx, ry, rz }); return this; }
  box(w, h, d, x, y, z, c, rx, ry, rz) { return this.add(G.box, w, h, d, x, y, z, c, rx, ry, rz); }
  // yellow/black warning band on a face: ax 'z' = band faces ±z (runs along x), ax 'x' = faces ±x (runs along z)
  hazard(len, h, x, y, z, ax, sgn) { const n = Math.max(2, Math.round(len / (h * 1.1))), st = len / n, t = 0.025;
    if (ax === 'z') { this.box(len, h, t, x, y, z, 0xe0b020); for (let i = 0; i < n; i++) this.box(st * 0.42, h * 1.15, t * 1.6, x - len / 2 + (i + 0.5) * st, y, z + sgn * 0.008, 0x161616, 0, 0, 0.62); }
    else { this.box(t, h, len, x, y, z, 0xe0b020); for (let i = 0; i < n; i++) this.box(t * 1.6, h * 1.15, st * 0.42, x + sgn * 0.008, y, z - len / 2 + (i + 0.5) * st, 0x161616, 0.62, 0, 0); }
    return this; }
  // woodland camouflage patches on the faces of a box (box rotated rx about X)
  camo(w, h, d, x, y, z, rx = 0, n = 7) { const C = [0x8fa284, 0xcdbf92, 0x4f5f3c, 0x5a4a30], c = Math.cos(rx), s = Math.sin(rx);
    const put = (ox, oy, oz, sx, sy, sz, i) => this.add(G.sph, sx, sy, sz, x + ox, y + oy * c - oz * s, z + oy * s + oz * c, C[i % 4], rx, 0, 0);
    for (let i = 0; i < n; i++) { const u = ((i * 0.618) % 1) - 0.5, v = ((i * 0.382 + 0.2) % 1) - 0.5;
      put(u * w * 0.8, h / 2, v * d * 0.85, w * 0.22, 0.02, d * 0.16, i);
      put((i % 2 ? 1 : -1) * w / 2, u * h * 0.6, v * d * 0.85, 0.02, h * 0.22, d * 0.17, i + 1); }
    return this; }
  cyl(r, h, x, y, z, c, rx, ry, rz) { return this.add(G.cyl10, r, h, r, x, y, z, c, rx, ry, rz); }
  build() {
    let n = 0; for (const p of this.parts) n += p.geo.attributes.position.count;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), nor = new Float32Array(n * 3); const nm = new THREE.Matrix3(), nv = new THREE.Vector3();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
    let o = 0;
    for (const p of this.parts) {
      q.setFromEuler(e.set(p.rx || 0, p.ry || 0, p.rz || 0));
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, p.sy, p.sz));
      const a = p.geo.attributes.position, na = p.geo.attributes.normal, c = C(p.color); nm.getNormalMatrix(m);
      for (let i = 0; i < a.count; i++) {
        v.fromBufferAttribute(a, i).applyMatrix4(m);
        pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z; nv.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); nor[o * 3] = nv.x; nor[o * 3 + 1] = nv.y; nor[o * 3 + 2] = nv.z;
        col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b; o++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uv = new Float32Array(n * 2); const uvs = this.uvScale || 0.5;
    for (let i = 0; i < n; i += 3) {
      const ax = pos[i * 3], ay = pos[i * 3 + 1], az = pos[i * 3 + 2];
      const ux = pos[i * 3 + 3] - ax, uy = pos[i * 3 + 4] - ay, uz = pos[i * 3 + 5] - az, vx = pos[i * 3 + 6] - ax, vy = pos[i * 3 + 7] - ay, vz = pos[i * 3 + 8] - az;
      const nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx);
      for (let k = 0; k < 3; k++) { const j = i + k, x = pos[j * 3], y = pos[j * 3 + 1], z = pos[j * 3 + 2];
        if (ny >= nx && ny >= nz) { uv[j * 2] = x * uvs; uv[j * 2 + 1] = z * uvs; } else if (nx >= nz) { uv[j * 2] = z * uvs; uv[j * 2 + 1] = y * uvs; } else { uv[j * 2] = x * uvs; uv[j * 2 + 1] = y * uvs; } }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.computeBoundingSphere();
    return g;
  }
}

// ---- terrain
let terrainMesh;
// detail texture for the ground: R = grass, G = sand/snow, B = rock (tileable, generated in code)
const terrainTex = (() => {
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  const chan = draw => { const cv = document.createElement('canvas'); cv.width = cv.height = n; const x = cv.getContext('2d'); x.fillStyle = '#808080'; x.fillRect(0, 0, n, n); draw(x); return x.getImageData(0, 0, n, n).data; };
  const wrap = (x, f) => { for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) f(ox, oy); };
  const R = Math.random;
  const grass = chan(x => {
    for (let i = 0; i < 260; i++) { const cx = R() * n, cy = R() * n, r = 10 + R() * 40, v = R() < 0.5 ? 60 : 200; wrap(x, (ox, oy) => { const gr = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r); gr.addColorStop(0, `rgba(${v},${v},${v},.18)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); x.fillStyle = gr; x.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2); }); }
    x.lineCap = 'round';
    for (let i = 0; i < 5200; i++) { const cx = R() * n, cy = R() * n, l = 3 + R() * 7, a = -Math.PI / 2 + (R() - 0.5) * 1.2, v = R() < 0.55 ? 40 + R() * 50 : 170 + R() * 80;
      x.strokeStyle = `rgba(${v},${v},${v},${0.35 + R() * 0.4})`; x.lineWidth = 0.8 + R() * 1.2; wrap(x, (ox, oy) => { x.beginPath(); x.moveTo(cx + ox, cy + oy); x.lineTo(cx + ox + Math.cos(a) * l, cy + oy + Math.sin(a) * l); x.stroke(); }); }
  });
  const sand = chan(x => {
    for (let y = 0; y < n; y += 1) { const v = 128 + Math.sin((y + Math.sin(y * 0.05) * 6) / n * TAU * 22) * 26; x.fillStyle = `rgba(${v},${v},${v},.55)`; x.fillRect(0, y, n, 1); }
    for (let i = 0; i < 2200; i++) { const cx = R() * n, cy = R() * n, r = 0.6 + R() * 2.2, v = R() < 0.6 ? 70 : 220; x.fillStyle = `rgba(${v},${v},${v},${0.3 + R() * 0.5})`; wrap(x, (ox, oy) => { x.beginPath(); x.arc(cx + ox, cy + oy, r, 0, TAU); x.fill(); }); }
  });
  const rock = chan(x => {
    for (let i = 0; i < 90; i++) { const cx = R() * n, cy = R() * n, r = 20 + R() * 60, v = R() < 0.5 ? 80 : 180; wrap(x, (ox, oy) => { const gr = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r); gr.addColorStop(0, `rgba(${v},${v},${v},.35)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); x.fillStyle = gr; x.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2); }); }
    for (let i = 0; i < 70; i++) { let px = R() * n, py = R() * n, a = R() * TAU; x.strokeStyle = `rgba(30,30,30,${0.4 + R() * 0.4})`; x.lineWidth = 0.8 + R() * 1.6; const pts = [[px, py]];
      for (let k = 0; k < 14; k++) { a += (R() - 0.5) * 1.1; px += Math.cos(a) * 7; py += Math.sin(a) * 7; pts.push([px, py]); }
      wrap(x, (ox, oy) => { x.beginPath(); pts.forEach(([u, v], k) => k ? x.lineTo(u + ox, v + oy) : x.moveTo(u + ox, v + oy)); x.stroke(); }); }
    for (let i = 0; i < 1500; i++) { const v = R() < 0.5 ? 60 : 210; x.fillStyle = `rgba(${v},${v},${v},.35)`; x.fillRect(R() * n, R() * n, 1 + R() * 2, 1 + R() * 2); }
  });
  const img = g.createImageData(n, n); for (let i = 0; i < n * n * 4; i += 4) { img.data[i] = grass[i]; img.data[i + 1] = sand[i]; img.data[i + 2] = rock[i]; img.data[i + 3] = 255; } g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
})();
function terrainMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: terrainTex });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 bio;\nvarying vec4 vBio;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBio = bio;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vBio;\nfloat th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }').replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec3 d1 = texture2D(map, vMapUv * 0.42).rgb, d2 = texture2D(map, vMapUv * 0.11 + vec2(0.31, 0.17)).rgb, d3 = texture2D(map, vMapUv * 1.3).rgb;
  vec3 dd = d1 * 0.5 + d2 * 0.3 + d3 * 0.2;
  float ws = vBio.x + vBio.y + vBio.z + 0.0001;
  float det = (dd.r * vBio.x + dd.g * vBio.y + dd.b * vBio.z) / ws;
  det = clamp((det - 0.5) * 2.6 + 0.5, 0.0, 1.0);
  diffuseColor.rgb *= mix(1.0, 0.58 + det * 0.84, clamp(ws, 0.0, 1.0));
  // concrete plates (2 m) with seams in base areas
  vec2 q = vMapUv * 2.5; vec2 f = fract(q); float seam = smoothstep(0.0, 0.035, f.x) * smoothstep(1.0, 0.965, f.x) * smoothstep(0.0, 0.035, f.y) * smoothstep(1.0, 0.965, f.y);
  float plate = (0.9 + th(floor(q)) * 0.16) * mix(0.62, 1.0, seam) * (0.85 + d3.b * 0.3);
  diffuseColor.rgb *= mix(1.0, plate, vBio.w);
#endif`);
  };
  return m;
}
function buildTerrain() {
  const SEG = TSEG;
  const g = new THREE.PlaneGeometry(MAP, MAP, SEG, SEG); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals(); const nrm = g.attributes.normal;
  const cols = new Float32Array(pos.count * 3), bio = new Float32Array(pos.count * 4), uv = new Float32Array(pos.count * 2); const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const cx = pos.getX(i), cy = pos.getY(i), cz = pos.getZ(i); const slope = 1 - Math.abs(nrm.getY(i));
    const bw = biomeW(cx, cz); const nz = fbm(cx * 0.07 + 300, cz * 0.07); const t1 = smooth(clamp((nz - 0.4) / 0.25, 0, 1));
    const grass = [lerp(0.33, 0.45, t1), lerp(0.50, 0.40, t1), lerp(0.20, 0.22, t1)];
    const sand = [lerp(0.88, 0.80, t1), lerp(0.73, 0.62, t1), lerp(0.46, 0.38, t1)];
    const snow = [lerp(0.93, 0.80, t1 * 0.5), lerp(0.95, 0.85, t1 * 0.5), lerp(0.99, 0.92, t1 * 0.5)];
    const rock = [lerp(0.50, 0.42, t1), lerp(0.46, 0.39, t1), lerp(0.42, 0.36, t1)];
    let r = grass[0] * bw.green + sand[0] * bw.sand + snow[0] * bw.snow + rock[0] * bw.mtn;
    let gg = grass[1] * bw.green + sand[1] * bw.sand + snow[1] * bw.snow + rock[1] * bw.mtn;
    let bb = grass[2] * bw.green + sand[2] * bw.sand + snow[2] * bw.snow + rock[2] * bw.mtn;
    let wg = bw.green, wsd = bw.sand + bw.snow * 0.8, wr = bw.mtn, wc = 0;
    if (slope > 0.2) { const t = clamp((slope - 0.2) / 0.25, 0, 1) * (1 - bw.sand * 0.7); r = lerp(r, 0.40, t); gg = lerp(gg, 0.37, t); bb = lerp(bb, 0.35, t); wr = lerp(wr, 1, t); wg *= 1 - t; wsd *= 1 - t; }
    if (cy > 16) { const t = clamp((cy - 16) / 5, 0, 1) * clamp(1 - slope * 1.5, 0.3, 1); r = lerp(r, 0.95, t); gg = lerp(gg, 0.96, t); bb = lerp(bb, 0.99, t); wsd = lerp(wsd, 0.4, t); wg *= 1 - t; wr *= 1 - t * 0.7; }
    const sc2 = fbm(cx * 0.05 - 200, cz * 0.05 + 100); if (sc2 > 0.7) { const t = clamp((sc2 - 0.7) / 0.08, 0, 1) * 0.6; r = lerp(r, 0.24, t); gg = lerp(gg, 0.21, t); bb = lerp(bb, 0.19, t); wr = lerp(wr, 1, t); }
    // dirt patches and tracks break up big uniform areas
    const dn = fbm(cx * 0.16 + 50, cz * 0.16 - 70); if (dn > 0.62 && bw.green > 0.3) { const t = clamp((dn - 0.62) / 0.1, 0, 1) * 0.55 * bw.green; r = lerp(r, 0.47, t); gg = lerp(gg, 0.40, t); bb = lerp(bb, 0.28, t); wsd = lerp(wsd, 1, t); wg *= 1 - t * 0.6; }
    for (const B of FLAT) { const d = Math.hypot(cx - B.x, cz - B.z); const pr = B.r - 4; if (d < pr + 1.5) { const t = clamp((pr - d) / 4 + 0.35, 0, 1); r = lerp(r, 0.53, t); gg = lerp(gg, 0.52, t); bb = lerp(bb, 0.49, t); wc = Math.max(wc, t); wg *= 1 - t; wsd *= 1 - t; wr *= 1 - t; } }
    for (const w of WELLS) { const d = Math.hypot(cx - w.x, cz - w.z); if (d < 2.6) { r = 0.08; gg = 0.07; bb = 0.06; } else if (d < 4) { r *= 0.6; gg *= 0.55; bb *= 0.5; } }
    const conc = (heightAt(cx + 4, cz) + heightAt(cx - 4, cz) + heightAt(cx, cz + 4) + heightAt(cx, cz - 4)) / 4 - cy;
    const v = (0.94 + (fbm(cx * 0.4, cz * 0.4) - 0.5) * 0.16) * clamp(1 - conc * 0.05, 0.72, 1.12); c.setRGB(r * v, gg * v, bb * v, THREE.SRGBColorSpace);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    bio[i * 4] = wg; bio[i * 4 + 1] = wsd; bio[i * 4 + 2] = wr; bio[i * 4 + 3] = wc;
    uv[i * 2] = cx / 5; uv[i * 2 + 1] = cz / 5;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.setAttribute('bio', new THREE.BufferAttribute(bio, 4)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  terrainMesh = new THREE.Mesh(g, terrainMaterial());
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);
}

// ---- decor
const OBST = []; const OB = new Map(); const OBC = 16;
function obKey(i, j) { return i * 1000 + j; }
function indexObst() { OB.clear(); for (const o of OBST) { const i0 = Math.floor((o.x - o.r) / OBC), i1 = Math.floor((o.x + o.r) / OBC), j0 = Math.floor((o.z - o.r) / OBC), j1 = Math.floor((o.z + o.r) / OBC); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = obKey(i, j); if (!OB.has(k)) OB.set(k, []); OB.get(k).push(o); } } }
const _ob = []; function obstNear(x, z) { _ob.length = 0; const ci = Math.floor(x / OBC), cj = Math.floor(z / OBC); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = OB.get(obKey(i, j)); if (a) for (const o of a) if (_ob.indexOf(o) < 0) _ob.push(o); } return _ob; }
// map decoration (rocks, trees, grass) is placed from the map's seed: every phone gets the same obstacles, so units path the same way everywhere
let DRS = 1; const DR = () => { DRS = (DRS + 0x6D2B79F5) | 0; let t = Math.imul(DRS ^ (DRS >>> 15), 1 | DRS); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const drand = (x, y) => x + DR() * (y - x);
const dpick = a => a[(DR() * a.length) | 0];
function buildDecor() { DRS = SEED ^ 0x5eed1;
  const B = new Builder();
  const ok = (x, z, m) => { if (Math.abs(x) > EDGE - 2 || Math.abs(z) > EDGE - 2) return false; for (const b of FLAT) if (Math.hypot(x - b.x, z - b.z) < b.r + 6 + m) return false; for (const w of WELLS) if (Math.hypot(x - w.x, z - w.z) < 8 + m) return false; return true; };
  // impassable mountain peaks
  for (let z = -EDGE; z <= EDGE; z += 5) for (let x = -EDGE; x <= EDGE; x += 5) { if (heightAt(x, z) > 15 && ok(x, z, -6)) OBST.push({ x, z, r: 3.4, mtn: true }); }
  let tries = 0, clusters = 0;
  while (clusters < Math.round(34 * Math.min(SC * SC, 9)) && tries < 900 * Math.min(SC * SC, 9)) {
    tries++; const cx = drand(-EDGE, EDGE), cz = drand(-EDGE, EDGE); if (!ok(cx, cz, 6)) continue;
    clusters++; const n = 3 + (DR() * 5 | 0);
    for (let i = 0; i < n; i++) {
      const x = cx + drand(-8, 8), z = cz + drand(-8, 8); if (!ok(x, z, 2)) continue;
      const w = drand(2.5, 6), d = drand(2.5, 6), h = drand(1.5, 9), ry = drand(0, 3); const y = heightAt(x, z);
      const col = dpick([0x7a766e, 0x6b665e, 0x878074, 0x5f5a53]);
      B.box(w, h, d, x, y + h / 2 - 0.6, z, col, drand(-0.05, 0.05), ry, drand(-0.05, 0.05));
      if (h > 3) { B.box(w * 1.02, 0.45, d * 0.25, x, y + h * 0.55, z, 0x24211e, 0, ry, 0); B.box(w * 0.25, 0.45, d * 1.02, x, y + h * 0.55, z, 0x24211e, 0, ry, 0); }
      if (DR() < 0.6) B.box(w * drand(0.3, 0.7), drand(0.5, 2), d * drand(0.3, 0.7), x + drand(-0.5, 0.5), y + h - 0.2, z + drand(-0.5, 0.5), col, drand(-0.4, 0.4), ry, drand(-0.4, 0.4));
      OBST.push({ x, z, r: Math.max(w, d) * 0.6 });
      for (let k = 0; k < 4; k++) { const rx = x + drand(-4, 4), rz = z + drand(-4, 4); B.add(G.ico, drand(0.3, 0.9), drand(0.2, 0.5), drand(0.3, 0.9), rx, heightAt(rx, rz) + 0.1, rz, col, drand(0, 3), drand(0, 3), 0); }
    }
  }
  // vegetation by biome
  for (let i = 0; i < 1400 * Math.min(SC * SC, 2.6); i++) {
    const x = drand(-EDGE, EDGE), z = drand(-EDGE, EDGE); if (!ok(x, z, -10)) continue; const y = heightAt(x, z); if (y > 15) continue;
    const w = biomeW(x, z); const roll = DR();
    if (roll < w.snow) { // snowy pine
      if (fbm(x * 0.05, z * 0.05 + 40) < 0.45) continue; const h = drand(3.5, 7); const tl = drand(-0.05, 0.05);
      B.add(G.cone, 0.28, h * 0.5, 0.28, x, y + h * 0.25, z, 0x3b2a1e);
      const greens = [0x1f3b2c, 0x24432f, 0x1a3427];
      for (let k = 0; k < 4; k++) { const s = (1 - k * 0.22) * h * 0.27; const yy = y + h * (0.3 + k * 0.18); B.add(G.cone, s, h * 0.3, s, x, yy, z, greens[k % 3], tl, k * 0.7, tl); B.add(G.cone, s * 0.8, h * 0.1, s * 0.8, x, yy + h * 0.1, z, 0xeef3f8, tl, k * 0.7 + 0.3, tl); }
      B.add(G.cone, h * 0.06, h * 0.12, h * 0.06, x, y + h * 0.98, z, 0xf4f8fc);
    } else if (roll < w.snow + w.green) { // leafy tree / bush
      if (fbm(x * 0.05, z * 0.05 + 40) < 0.42) continue; const h = drand(2.6, 5);
      const pal = dpick([[0x3f6b2a, 0x4d7a30, 0x5f8a36], [0x36602a, 0x447030, 0x527d34], [0x557a2c, 0x6a8f34, 0x7a9a3a]]);
      B.add(G.cone, 0.24, h * 0.75, 0.24, x, y + h * 0.37, z, 0x4a3524);
      B.add(G.cyl6, 0.07, h * 0.35, 0.07, x + 0.25, y + h * 0.55, z, 0x4a3524, 0, 0, -0.7);
      B.add(G.cyl6, 0.07, h * 0.3, 0.07, x - 0.2, y + h * 0.5, z + 0.15, 0x4a3524, 0.4, 0, 0.7);
      B.add(G.ico, h * 0.36, h * 0.3, h * 0.36, x, y + h * 0.72, z, pal[0], drand(0, 3), drand(0, 3), 0);
      for (let k = 0; k < 3; k++) { const a = k / 3 * TAU + drand(0, 1); B.add(G.ico, h * 0.24, h * 0.21, h * 0.24, x + Math.sin(a) * h * 0.26, y + h * drand(0.72, 0.9), z + Math.cos(a) * h * 0.26, pal[1 + (k % 2)], drand(0, 3), drand(0, 3), 0); }
      B.add(G.ico, h * 0.2, h * 0.18, h * 0.2, x, y + h * 1.0, z, pal[2], 1, 2, 0);
      if (DR() < 0.4) for (let k = 0; k < 3; k++) B.add(G.ico, 0.35, 0.25, 0.35, x + drand(-1.4, 1.4), y + 0.2, z + drand(-1.4, 1.4), pal[0], drand(0, 3), 0, 0);
    } else if (roll < w.snow + w.green + w.sand) { // cactus / dry palm
      if (DR() < 0.6) continue;
      if (DR() < 0.6) { const h = drand(1.5, 3); B.add(G.cyl6, 0.22, h, 0.22, x, y + h / 2, z, 0x4f7a3a); B.add(G.cyl6, 0.13, h * 0.4, 0.13, x + 0.35, y + h * 0.55, z, 0x4f7a3a); B.add(G.cyl6, 0.13, 0.4, 0.13, x + 0.2, y + h * 0.38, z, 0x4f7a3a, 0, 0, Math.PI / 2); }
      else { const h = drand(4, 6); B.add(G.cyl6, 0.18, h, 0.18, x, y + h / 2, z, 0x6e5838, 0.1, 0, 0.08); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; B.box(0.15, 0.08, 2, x + Math.sin(a) * 0.9, y + h - 0.3, z + Math.cos(a) * 0.9, 0x5f7a32, 0, a, 0); } }
    } else { // dead tree on rock land
      if (DR() < 0.7) continue; const h = drand(1.8, 3.4);
      B.add(G.cyl6, 0.14, h, 0.14, x, y + h / 2, z, 0x3b2e22, drand(-0.15, 0.15), 0, drand(-0.15, 0.15));
      B.add(G.cyl6, 0.07, h * 0.5, 0.07, x + 0.3, y + h * 0.75, z, 0x3b2e22, 0, 0, -0.8);
    }
  }
  for (let i = 0; i < 320 * Math.min(SC * SC, 9); i++) {
    const x = drand(-EDGE, EDGE), z = drand(-EDGE, EDGE); if (!ok(x, z, -10)) continue; const s = drand(0.4, 2.2); const w = biomeW(x, z);
    const col = w.snow > 0.5 ? dpick([0xc8d0d8, 0x9aa4ad]) : w.sand > 0.5 ? dpick([0xb08a5a, 0x9c7a50]) : dpick([0x7b6f5f, 0x6a6052, 0x8a7d6a]);
    B.add(G.ico, s * drand(0.8, 1.3), s * drand(0.5, 0.9), s * drand(0.8, 1.3), x, heightAt(x, z) + s * 0.2, z, col, drand(0, 3), drand(0, 3), drand(0, 3));
    if (s > 1.4) OBST.push({ x, z, r: s });
  }
  // wells: small rock ring
  for (const w of WELLS) for (let k = 0; k < 7; k++) { const a = k / 7 * TAU; const x = w.x + Math.cos(a) * 3.3, z = w.z + Math.sin(a) * 3.3; B.add(G.ico, 0.5, 0.35, 0.5, x, heightAt(x, z), z, 0x3b342b, a, a, 0); }
  B.uvScale = 0.35; const m = new THREE.Mesh(B.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: groundTex })); m.castShadow = true; m.receiveShadow = true; scene.add(m);
  indexObst();
  buildGroundCover();
}
function buildGroundCover() { DRS = SEED ^ 0x9a55;
  const tuft = new THREE.ConeGeometry(0.12, 0.9, 3); tuft.translate(0, 0.45, 0);
  const blob = new THREE.IcosahedronGeometry(0.28, 0);
  const flower = new THREE.SphereGeometry(0.12, 5, 4); flower.translate(0, 0.55, 0);
  const mat = new THREE.MeshLambertMaterial();
  const GK = Math.min(SC * SC, 2.2), N = Math.round(9000 * GK), NB = Math.round(2500 * GK), NF = Math.round(1600 * GK);
  const grass = new THREE.InstancedMesh(tuft, mat, N), blobs = new THREE.InstancedMesh(blob, mat, NB), flowers = new THREE.InstancedMesh(flower, new THREE.MeshBasicMaterial(), NF);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  const near = (x, z) => { for (const f of FLAT) if (Math.hypot(x - f.x, z - f.z) < f.r - 3) return true; for (const w of WELLS) if (Math.hypot(x - w.x, z - w.z) < 4.5) return true; return false; };
  let gi = 0, bi = 0, fi = 0;
  for (let tries = 0; tries < 60000 * GK && (gi < N || bi < NB); tries++) {
    const x = drand(-EDGE, EDGE), z = drand(-EDGE, EDGE); if (near(x, z)) continue; const y = heightAt(x, z); if (y > 15) continue;
    const w = biomeW(x, z); const r = DR();
    if (r < w.green && gi < N) {
      if (fbm(x * 0.09 + 11, z * 0.09) < 0.4) continue;
      for (let k = 0; k < 3 && gi < N; k++) { const xx = x + drand(-0.5, 0.5), zz = z + drand(-0.5, 0.5); e.set(drand(-0.25, 0.25), drand(0, 6), drand(-0.25, 0.25)); q.setFromEuler(e); const s2 = drand(0.6, 1.4); sc.set(s2, s2 * drand(0.7, 1.3), s2); ps.set(xx, heightAt(xx, zz) - 0.05, zz); m.compose(ps, q, sc); grass.setMatrixAt(gi, m); col.setHSL(drand(0.22, 0.3), drand(0.45, 0.65), drand(0.22, 0.36)); grass.setColorAt(gi++, col); }
      if (fi < NF && DR() < 0.18) { ps.set(x, y, z); sc.set(1, 1, 1); q.identity(); m.compose(ps, q, sc); flowers.setMatrixAt(fi, m); flowers.setColorAt(fi++, C(dpick([0xffe24a, 0xff5a5a, 0xffffff, 0xb07aff, 0xff9a3a]))); }
    } else if (bi < NB) {
      let c2; if (w.snow > 0.5) c2 = dpick([0xf2f6fa, 0xdfe7ef]); else if (w.sand > 0.5) c2 = dpick([0x8a7a4a, 0x9a8650, 0x6f6a3a]); else if (w.mtn > 0.5) c2 = dpick([0x7a7166, 0x6a635a]); else c2 = dpick([0x5a6a32, 0x6e6a3c]);
      if (w.green > 0.5) continue;
      e.set(drand(0, 3), drand(0, 6), drand(0, 3)); q.setFromEuler(e); const s2 = drand(0.5, 1.6); sc.set(s2, s2 * drand(0.4, 0.8), s2); ps.set(x, y + 0.05, z); m.compose(ps, q, sc); blobs.setMatrixAt(bi, m); blobs.setColorAt(bi++, C(c2));
    }
  }
  grass.count = gi; blobs.count = bi; flowers.count = fi;
  for (const im of [grass, blobs, flowers]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.receiveShadow = true; scene.add(im); }
}

// ================= DEFINITIONS =================
const TEAMC = [
  { body: 0x71804e, dark: 0x3d432f, acc: 0x3f9fe0, mini: '#5fc0ff', name: 'Tu' },
  { body: 0x7e5544, dark: 0x3d2a23, acc: 0xe0402a, mini: '#ff5a3a', name: 'Inamic' },
  { body: 0x4e6a8a, dark: 0x27364a, acc: 0xffc832, mini: '#ffd23a', name: 'Aliat (albastru-galben)' }, // co-op guest commanders
  { body: 0x8a7348, dark: 0x463a24, acc: 0x30e0b0, mini: '#30e0b0', name: 'Aliat (nisip-turcoaz)' },
  { body: 0x5c5f66, dark: 0x2c2e33, acc: 0xc068ff, mini: '#c068ff', name: 'Aliat (gri-violet)' },
  { body: 0x6e6a4a, dark: 0x37352a, acc: 0xff8c1a, mini: '#ff9a30', name: 'Aliat (kaki-portocaliu)' },
  { body: 0x52485e, dark: 0x29232f, acc: 0xff5ab4, mini: '#ff6ac0', name: 'Aliat (mov-roz)' },
  { body: 0x8c8c86, dark: 0x45453f, acc: 0xf4f4f0, mini: '#f4f4f0', name: 'Aliat (gri-alb)' },
  { body: 0x3e5a3e, dark: 0x1f2d1f, acc: 0xa8ff3a, mini: '#b0ff50', name: 'Aliat (verde-lime)' },
  { body: 0x2e3e5e, dark: 0x171f2f, acc: 0x4a8cff, mini: '#5a9aff', name: 'Aliat (bleumarin)' },
  { body: 0x6a5a48, dark: 0x352d24, acc: 0xb0d8f0, mini: '#b8e0f8', name: 'Aliat (maro-argintiu)' },
];
const CH = {
  scout: { name: 'Cercetaș', hp: 80, cost: 25, spd: 1.25, size: 0.8, hue: 0xb8a868 },
  light: { name: 'Ușor', hp: 110, cost: 35, spd: 1, size: 0.9 },
  medium: { name: 'Mediu', hp: 210, cost: 65, spd: 0.88, size: 1.1 },
  assault: { name: 'Asalt', hp: 290, cost: 90, spd: 0.84, size: 1.2, hue: 0x3a4a2a },
  heavy: { name: 'Greu', hp: 360, cost: 105, spd: 0.74, size: 1.3 },
  titan: { name: 'Titan', hp: 560, cost: 170, spd: 0.6, size: 1.55, hue: 0x50565e },
  nova: { name: 'Nova', hp: 420, cost: 150, spd: 0.95, size: 1.25, gold: true },
  drone: { name: 'Dronă', hp: 70, cost: 30, spd: 1.25, size: 0.85, only: 'rotor' },
  cyborg: { name: 'Cyborg', hp: 150, cost: 35, spd: 1, size: 0.62, only: 'legs' },
  hcyborg: { name: 'Cyborg greu', hp: 270, cost: 65, spd: 0.85, size: 0.74, only: 'legs' },
};
const PR = {
  wheels: { name: 'Roți', hp: 1, spd: 1, cost: 10 },
  tracks: { name: 'Șenile', hp: 1.35, spd: 0.78, cost: 30 },
  halftrack: { name: 'Semi-șenile', hp: 1.18, spd: 0.9, cost: 20 },
  hover: { name: 'Hover', hp: 0.85, spd: 1.5, cost: 25 },
  legs: { name: 'Picioare', hp: 1, spd: 0.62, cost: 0 },
  rotor: { name: 'Rotoare', hp: 0.8, spd: 1.55, cost: 20, air: 'rotor' },
  vtol: { name: 'Reactor VTOL', hp: 0.8, spd: 2.4, cost: 70, air: 'vtol' },
};
const WP = {
  mg: { name: 'Mitralieră', dmg: 7, rof: 0.22, range: 12, cost: 20, kind: 'mg' },
  cannon: { name: 'Tun', dmg: 42, rof: 1.7, range: 14, cost: 45, kind: 'shell' },
  mortar: { name: 'Mortier', dmg: 38, rof: 3.4, range: 26, cost: 70, kind: 'mortar', splash: 3.6, art: 'mortar' },
  imortar: { name: 'Mortier incendiar', dmg: 22, rof: 3.6, range: 25, cost: 90, kind: 'mortar', splash: 3.2, fire: 14, art: 'mortar' },
  empmortar: { name: 'Mortier IEM', dmg: 10, rof: 4, range: 24, cost: 110, kind: 'mortar', splash: 4.2, emp: 3, art: 'mortar' },
  salvo: { name: 'Lansator salve', dmg: 16, rof: 5, range: 32, cost: 100, kind: 'salvo', splash: 2.6, n: 6, art: 'salvo' },
  howitzer: { name: 'Obuzier', dmg: 70, rof: 5.5, range: 40, cost: 140, kind: 'mortar', splash: 4.6, art: 'how' },
  ihowitzer: { name: 'Obuzier incendiar', dmg: 45, rof: 6, range: 38, cost: 160, kind: 'mortar', splash: 4.6, fire: 20, art: 'how' },
  rhowitzer: { name: 'Obuzier rapid', dmg: 55, rof: 2.6, range: 38, cost: 190, kind: 'mortar', splash: 4.2, art: 'how' },
  hhowitzer: { name: 'Obuzier greu', dmg: 140, rof: 8, range: 50, cost: 240, kind: 'mortar', splash: 6.5, art: 'how', big: 1 },
  plasma: { name: 'Lansator plasmă', dmg: 90, rof: 6, range: 36, cost: 260, kind: 'mortar', splash: 6, fire: 25, plasma: 1, art: 'plasma' },
  ballistic: { name: 'Rachetă balistică', dmg: 220, rof: 12, range: 60, cost: 320, kind: 'salvo', splash: 7.5, n: 1, big: 1, art: 'salvo' },
  rbattery: { name: 'Baterie Tunet', dmg: 26, rof: 9, range: 70, cost: 220, kind: 'salvo', splash: 3.4, n: 12, art: 'salvo', site: 1 },
  smissile: { name: 'Rachete Săgeată', dmg: 70, rof: 7, range: 60, cost: 260, kind: 'salvo', splash: 3.2, n: 4, art: 'salvo', site: 1 },
  omissile: { name: 'Rachetă Orizont', dmg: 380, rof: 18, range: 120, cost: 420, kind: 'salvo', splash: 9, n: 1, big: 1, art: 'salvo', site: 1 },
  icbm: { name: 'Rachetă balistică strategică', dmg: 900, rof: 40, range: 9999, kind: 'salvo', splash: 16, n: 1, big: 1, site: 1 },
  flame: { name: 'Aruncător de flăcări', dmg: 10, rof: 0.16, range: 8, cost: 50, kind: 'flame' },
  laser: { name: 'Laser', dmg: 22, rof: 0.55, range: 17, cost: 80, kind: 'laser' },
  rockets: { name: 'Rachete', dmg: 30, rof: 2.4, range: 18, cost: 60, kind: 'rocket', splash: 2.8 },
  viper: { name: 'Rachete Viperă', dmg: 62, rof: 3.4, range: 22, cost: 115, kind: 'rocket', splash: 2.4, heavy: true, fam: 'rockets' },
  bomb: { name: 'Bombe aeriene', dmg: 150, rof: 0.45, range: 5, cost: 45, kind: 'bomb', splash: 4.5 },
  fbomb: { name: 'Bombe incendiare', dmg: 70, rof: 0.45, range: 5, cost: 60, kind: 'bomb', splash: 5.5, fire: 30 },
  hbomb: { name: 'Bombă grea', dmg: 420, rof: 0.6, range: 5, cost: 90, kind: 'bomb', splash: 6.5, big: true },
  radar: { name: 'Radar', dmg: 0, range: 0, cost: 40, kind: 'radar', aura: 24 },
  repair: { name: 'Reparator', dmg: 0, range: 0, cost: 50, kind: 'repair', heal: 16, reach: 7 },
  truck: { name: 'Constructor', dmg: 0, range: 0, cost: 40, kind: 'truck' },
};
// longer attack range for every weapon (direct fire +40%, artillery +25%, flamer +25%)
for (const k in WP) { const w = WP[k]; if (w.range) w.range = Math.round(w.range * (w.art ? 1.25 : w.kind === 'flame' ? 1.25 : 1.4)); if (w.art) { w.rof = +(w.rof * 0.55).toFixed(2); w.sight = w.range; w.range = w.range * 3; } } // artillery: 3x range, but beyond its own sight it needs radar // artillery reloads ~45% faster
// weapon reach grows with the map: on the 2 km map the cannon reaches 500 m and the mortar 150 m (radar-guided artillery 3x that);
// on the normal 300 m map ranges stay as they are, in between they scale linearly with the map size
const RNG_T = clamp((MAP - 300) / 1700, 0, 1), RNG_D = 1 + (500 / WP.cannon.range - 1) * RNG_T, RNG_A = 1 + (150 / WP.mortar.sight - 1) * RNG_T, PROJ_SPD = Math.sqrt(RNG_D);
for (const k in WP) { const w = WP[k]; if (!w.range || w.range >= 9999 || w.kind === 'bomb') continue;
  if (w.art) { w.sight = Math.round(w.sight * RNG_A); w.range = w.sight * 3; } else w.range = Math.round(w.range * (w.kind === 'flame' ? Math.sqrt(RNG_D) : RNG_D)); }
const wfam = w => w.art ? 'art' : w.fam || w.id;
const BASE_SPEED = 5.4;
const BD = {
  hq: { name: 'Cartier General', icon: '🏛', hp: 1600, cost: 300, size: 6.5, time: 40, h: 5.5 },
  factory: { name: 'Fabrică', icon: '🏭', hp: 1100, cost: 250, size: 7, time: 35, h: 5 },
  lab: { name: 'Laborator', icon: '🔬', hp: 700, cost: 150, size: 5, time: 25, h: 4.5 },
  pump: { name: 'Pompă petrol', icon: '🛢', hp: 450, cost: 50, size: 3.6, time: 12, h: 4 },
  generator: { name: 'Generator', icon: '⚡', hp: 900, cost: 100, size: 5.5, time: 22, h: 6 },
  tower: { name: 'Turn apărare', icon: '🗼', hp: 700, cost: 120, size: 3, time: 18, h: 6.2, ty: 5.25 },
  ptrap: { name: 'Arici antitanc', icon: '', hp: 380, cost: 15, size: 2.2, time: 5, h: 1.5, req: 'traps' },
  pwall: { name: 'Zid beton', icon: '', hp: 1400, cost: 40, size: 5, time: 10, h: 3, r: 2.7, req: 'traps' },
  repairbay: { name: 'Atelier reparații', icon: '', hp: 800, cost: 160, size: 5.5, time: 24, h: 4, req: 'repair' },
  silo: { name: 'Siloz rachetă balistică', short: 'Siloz', icon: '', hp: 3200, cost: 900, size: 8, time: 60, h: 0.8, req: 'icbm' },
  airfactory: { name: 'Fabrică de aeronave', short: 'Fabr. aeronave', icon: '', hp: 1000, cost: 280, size: 8, time: 40, h: 5, req: 'drone' },
  cybfactory: { name: 'Fabrică de cyborgi', short: 'Fabr. cyborgi', icon: '', hp: 900, cost: 180, size: 6, time: 30, h: 4.5, req: 'cyborg' },
  vpad: { name: 'Platformă de realimentare', short: 'Platformă VTOL', icon: '', hp: 450, cost: 70, size: 4, time: 12, h: 0.5, req: 'vtol', flat: 1 },
  radartower: { name: 'Turn radar', icon: '', hp: 600, cost: 140, size: 3.5, time: 20, h: 7, req: null },
  citadel: { name: 'CETATEA', icon: '🏰', hp: 6000, cost: 0, size: 10, time: 1, h: 9 },
  wall: { name: 'Zid', icon: '🧱', hp: 1400, cost: 0, size: 5, time: 1, h: 3, r: 2.7 },
};
// defensive structures: class x weapon (generated)
const DCLASS = {
  tower: { name: 'Turn', hp: 750, cost: 90, size: 3, time: 18, h: 6.2, ty: 5.25, ts: 1, rb: 2, dm: 1.3, req: null, wps: ['mg', 'cannon', 'flame', 'rockets', 'laser'] },
  bunker: { name: 'Buncăr', hp: 1300, cost: 110, size: 3.4, time: 22, h: 2, ty: 1.35, ts: 1, rb: -1, dm: 1.25, req: 'bunker', wps: ['mg', 'cannon', 'flame', 'laser'] },
  hard: { name: 'Fortificație', hp: 1700, cost: 170, size: 3.8, time: 28, h: 3.8, ty: 3.5, ts: 1.15, rb: 3, dm: 1.6, req: 'hardpoint', wps: ['mg', 'cannon', 'flame', 'rockets', 'laser'] },
  fort: { name: 'Fortăreață', hp: 5200, cost: 560, size: 8, time: 70, h: 6, ty: 5.6, ts: 1.9, rb: 6, dm: 3.6, req: 'fortress', wps: ['cannon', 'rockets', 'laser'] },
  pit: { name: 'Amplasament', hp: 700, cost: 80, size: 3.6, time: 18, h: 1.5, ty: 0.75, ts: 1.1, rb: 0, dm: 1.4, req: null, wps: ['mortar', 'imortar', 'empmortar', 'salvo', 'howitzer', 'ihowitzer', 'rhowitzer', 'hhowitzer', 'plasma', 'ballistic', 'rbattery', 'smissile', 'omissile'] },
};
const IMP_SND = { mortar: 'imp_mortar', rmortar: 'imp_mortar', imortar: 'imp_inc', ihowitzer: 'imp_inc', empmortar: 'imp_salvo', salvo: 'imp_salvo', howitzer: 'imp_how', rhowitzer: 'imp_how', hhowitzer: 'imp_hhow', ballistic: 'imp_hhow', plasma: 'imp_plasma', rbattery: 'imp_salvo', smissile: 'imp_rocket', omissile: 'imp_hhow' };
const ART_SND = { mortar: 'art_mortar', imortar: 'art_inc', empmortar: 'art_emp', rmortar: 'art_rmortar', salvo: 'art_salvo', howitzer: 'art_how', ihowitzer: 'art_inc', rhowitzer: 'art_rhow', hhowitzer: 'art_hhow', plasma: 'art_plasma', ballistic: 'art_ball', rbattery: 'art_salvo', smissile: 'art_salvo', omissile: 'art_ball' };
const ART_W = ['mortar', 'imortar', 'empmortar', 'salvo', 'howitzer', 'ihowitzer', 'rhowitzer', 'hhowitzer', 'plasma', 'ballistic'];
const WSHORT = { mg: 'mitralieră', cannon: 'tun', flame: 'flăcări', rockets: 'rachete', viper: 'rachete Viperă', rbattery: 'baterie Tunet', smissile: 'rachete Săgeată', omissile: 'rachetă Orizont', laser: 'laser', mortar: 'mortier', imortar: 'mortier incendiar', empmortar: 'mortier IEM', salvo: 'salve', howitzer: 'obuzier', ihowitzer: 'obuzier incendiar', rhowitzer: 'obuzier rapid', hhowitzer: 'obuzier greu', plasma: 'plasmă', ballistic: 'rachetă balistică' };
for (const [ck, c] of Object.entries(DCLASS)) for (const w of c.wps) BD['d_' + ck + '_' + w] = { short: WSHORT[w][0].toUpperCase() + WSHORT[w].slice(1), name: `${c.name} ${WSHORT[w]}`, icon: '', hp: c.hp, cost: c.cost + (WP[w].site ? Math.round(WP[w].cost * 0.8) : 0), size: c.size, time: c.time, h: c.h, tw: w, cls: ck, req: c.req, ty: c.ty, ts: c.ts, rb: c.rb, dm: c.dm };
// enemy technology tiers: 0 = outer ring (weak) … 3 = citadel (latest technology)
const TIERS = [
  { name: 'Avanpost', ch: ['light'], pr: ['wheels'], wp: ['mg'], tower: 'mg', hp: 1, garrison: 3, towers: 2 },
  { name: 'Fort', ch: ['light', 'medium'], pr: ['wheels', 'tracks'], wp: ['mg', 'cannon', 'flame'], tower: 'mg', hp: 1.1, garrison: 5, towers: 3 },
  { name: 'Bastion', ch: ['medium', 'assault', 'heavy'], pr: ['halftrack', 'tracks', 'hover'], wp: ['cannon', 'rockets'], tower: 'cannon', hp: 1.25, garrison: 7, towers: 4 },
  { name: 'Cetate', ch: ['heavy', 'titan', 'nova'], pr: ['tracks', 'hover'], wp: ['rockets', 'cannon', 'laser', 'viper'], tower: 'rockets', hp: 1.5, garrison: 10, towers: 8 },
];
const RS = [
  { id: 'halftrack', name: 'Semi-șenile', cost: 60, time: 16, req: [] },
  { id: 'tracks', name: 'Șenile', cost: 90, time: 22, req: [] },
  { id: 'cannon', name: 'Tun', cost: 110, time: 25, req: [] },
  { id: 'medium', name: 'Șasiu mediu', cost: 120, time: 28, req: [] },
  { id: 'hover', name: 'Hover', cost: 130, time: 28, req: ['tracks'] },
  { id: 'rockets', name: 'Rachete', cost: 170, time: 35, req: ['cannon'] },
  { id: 'heavy', name: 'Șasiu greu', cost: 200, time: 40, req: ['medium'] },
  { id: 'tower2', name: 'Turnuri cu tun', cost: 150, time: 30, req: ['cannon'] },
  { id: 'armor', name: 'Blindaj compozit +25%', cost: 220, time: 42, req: ['medium'] },
  { id: 'engine', name: 'Motoare turbo +20%', cost: 160, time: 32, req: ['tracks'] },
  { id: 'prod', name: 'Producție automată +40%', cost: 200, time: 38, req: [] },
  { id: 'radar', name: 'Radar de luptă', cost: 110, time: 24, req: [] },
  { id: 'repair', name: 'Modul reparator', cost: 130, time: 28, req: [] },
  { id: 'scout', name: 'Șasiu Cercetaș', cost: 80, time: 18, req: [] },
  { id: 'assault', name: 'Șasiu de Asalt', cost: 170, time: 34, req: ['medium'] },
  { id: 'titan', name: 'Șasiu Titan', cost: 260, time: 48, req: ['heavy', 'armor'] },
  { id: 'traps', name: 'Arici și ziduri', cost: 60, time: 14, req: [] },
  { id: 'cyborg', name: 'Cyborgi', cost: 120, time: 26, req: [] },
  { id: 'hcyborg', name: 'Cyborg greu', cost: 210, time: 40, req: ['cyborg', 'armor'] },
  { id: 'drone', name: 'Drone', cost: 150, time: 30, req: ['radar'] },
  { id: 'vtol', name: 'Aeronave VTOL', cost: 260, time: 46, req: ['drone', 'hover'] },
  { id: 'bomb', name: 'Bombe aeriene', cost: 200, time: 38, req: ['vtol', 'mortar'] },
  { id: 'fbomb', name: 'Bombe incendiare', cost: 240, time: 42, req: ['bomb', 'flame'] },
  { id: 'hbomb', name: 'Bombă grea', cost: 320, time: 55, req: ['bomb', 'heavy'] },
  { id: 'bunker', name: 'Buncăre', cost: 110, time: 24, req: [] },
  { id: 'hardpoint', name: 'Fortificații', cost: 200, time: 36, req: ['bunker', 'armor'] },
  { id: 'fortress', name: 'Fortărețe', cost: 380, time: 60, req: ['hardpoint', 'heavy'] },
  { id: 'mortar', name: 'Mortier', cost: 150, time: 30, req: ['cannon'] },
  { id: 'imortar', name: 'Mortier incendiar', cost: 170, time: 32, req: ['mortar', 'flame'] },
  { id: 'empmortar', name: 'Mortier IEM', cost: 220, time: 40, req: ['imortar', 'radar'] },
  { id: 'salvo', name: 'Lansator salve', cost: 190, time: 36, req: ['mortar', 'rockets'] },
  { id: 'howitzer', name: 'Obuzier', cost: 230, time: 42, req: ['mortar', 'heavy'] },
  { id: 'ihowitzer', name: 'Obuzier incendiar', cost: 250, time: 44, req: ['howitzer', 'imortar'] },
  { id: 'rhowitzer', name: 'Obuzier rapid', cost: 280, time: 48, req: ['howitzer', 'prod'] },
  { id: 'hhowitzer', name: 'Obuzier greu', cost: 330, time: 55, req: ['rhowitzer', 'titan'] },
  { id: 'plasma', name: 'Lansator plasmă', cost: 380, time: 60, req: ['howitzer', 'laser'] },
  { id: 'ballistic', name: 'Rachetă balistică', cost: 420, time: 65, req: ['salvo', 'hhowitzer'] },
  { id: 'flame', name: 'Aruncător de flăcări', cost: 120, time: 26, req: [] },
  { id: 'laser', name: 'Laser de luptă', cost: 240, time: 45, req: ['rockets'] },
  { id: 'rbattery', name: 'Baterie de rachete Tunet', cost: 280, time: 50, req: ['salvo', 'hardpoint'] },
  { id: 'smissile', name: 'Rachete ghidate Săgeată', cost: 340, time: 58, req: ['rbattery', 'laser'] },
  { id: 'omissile', name: 'Rachetă Orizont', cost: 480, time: 75, req: ['smissile', 'ballistic'] },
  { id: 'icbm', name: 'Siloz de rachete balistice', cost: 600, time: 90, req: ['omissile'] },
  { id: 'viper', name: 'Rachete Viperă', cost: 300, time: 52, req: ['rockets', 'heavy'] },
  { id: 'nova', name: 'Șasiu Nova (auriu)', cost: 300, time: 52, req: ['titan', 'laser'] },
  { id: 'radar2', name: 'Radar avansat', cost: 180, time: 34, req: ['radar'] },
  { id: 'repair2', name: 'Reparare rapidă', cost: 170, time: 32, req: ['repair'] },
];

// research icons: small original SVG drawings
const SV = (inner) => `<svg class="ric" viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const BRANCHES = [
  { name: 'Mobilitate', ids: ['halftrack', 'tracks', 'hover', 'engine'] },
  { name: 'Corp și blindaj', ids: ['scout', 'medium', 'assault', 'heavy', 'armor', 'titan', 'nova'] },
  { name: 'Armament', ids: ['cannon', 'flame', 'rockets', 'viper', 'laser'] },
  { name: 'Artilerie', ids: ['rbattery', 'smissile', 'omissile', 'icbm', 'mortar', 'imortar', 'empmortar', 'salvo', 'howitzer', 'ihowitzer', 'rhowitzer', 'hhowitzer', 'plasma', 'ballistic'] },
  { name: 'Sprijin', ids: ['radar', 'radar2', 'repair', 'repair2'] },
  { name: 'Apărare', ids: ['traps', 'tower2', 'bunker', 'hardpoint', 'fortress'] },
  { name: 'Aviație și cyborgi', ids: ['cyborg', 'hcyborg', 'drone', 'vtol', 'bomb', 'fbomb', 'hbomb'] },
  { name: 'Industrie', ids: ['prod'] },
];
// ---- upgrade lines Mk I-III (generated) ----
const ROM = ['I', 'II', 'III'];
const FAMS = { mg: ['Mitralieră', 'mg', null], cannon: ['Tun', 'cannon', 'cannon'], flame: ['Flăcări', 'flame', 'flame'], rockets: ['Rachete', 'rockets', 'rockets'], laser: ['Laser', 'laser', 'laser'], art: ['Artilerie', 'howitzer', 'mortar'] };
const UPG = {};
function addUpg(id, name, base, req, cost, time, kind, fx, branch) { RS.push({ id, name, cost, time, req: req.filter(Boolean) }); UPG[id] = { base, kind, fx }; (BRANCHES.find(b => b.name === branch) || BRANCHES[0]).ids.push(id); }
BRANCHES.splice(4, 0, { name: 'Muniție', ids: [] }, { name: 'Cadență', ids: [] });
for (const [f, [nm, , rq]] of Object.entries(FAMS)) for (let m = 1; m <= 3; m++) {
  addUpg(`${f}_dmg${m}`, `Muniție ${nm} Mk ${ROM[m - 1]}`, f, [rq, m > 1 ? `${f}_dmg${m - 1}` : null], 70 + 60 * m, 16 + 10 * m, 'dmg', T => { T.dmg[f] = (T.dmg[f] || 1) + 0.2; }, 'Muniție');
  addUpg(`${f}_rof${m}`, `Încărcare ${nm} Mk ${ROM[m - 1]}`, f, [rq, m > 1 ? `${f}_rof${m - 1}` : `${f}_dmg1`], 80 + 60 * m, 18 + 10 * m, 'rof', T => { T.rof[f] = (T.rof[f] || 1) * 0.88; }, 'Cadență');
}
for (let m = 1; m <= 3; m++) {
  addUpg(`armor${m + 1}`, `Blindaj compozit Mk ${ROM[m]}`, 'armor', [m > 1 ? `armor${m}` : 'armor'], 160 + 70 * m, 30 + 8 * m, 'up', (T, team) => scaleHp(team, 1.15, 'unit'), 'Corp și blindaj');
  addUpg(`engine${m + 1}`, `Motoare turbo Mk ${ROM[m]}`, 'engine', [m > 1 ? `engine${m}` : 'engine'], 130 + 60 * m, 26 + 8 * m, 'up', (T, team) => { T.spdMul *= 1.1; for (const e of ents) if (e.alive && e.team === team && e.kind === 'unit') e.st.speed *= 1.1; }, 'Mobilitate');
  addUpg(`sarmor${m}`, `Beton armat Mk ${ROM[m - 1]}`, 'hardpoint', [m > 1 ? `sarmor${m - 1}` : 'traps'], 90 + 60 * m, 20 + 8 * m, 'up', (T, team) => { T.shpMul *= 1.2; scaleHp(team, 1.2, 'bld'); }, 'Apărare');
  addUpg(`power${m}`, `Turbină generator Mk ${ROM[m - 1]}`, 'power', [m > 1 ? `power${m - 1}` : null], 120 + 80 * m, 24 + 10 * m, 'up', T => { T.powMul += 0.25; }, 'Industrie');
  addUpg(`rspeed${m}`, `Analiză date Mk ${ROM[m - 1]}`, 'rspeed', [m > 1 ? `rspeed${m - 1}` : null], 100 + 70 * m, 20 + 10 * m, 'up', T => { T.rsMul += 0.25; }, 'Industrie');
  if (m < 3) addUpg(`prod${m + 1}`, `Producție automată Mk ${ROM[m]}`, 'prod', [m > 1 ? `prod${m}` : 'prod'], 200 + 80 * m, 38 + 8 * m, 'up', T => { T.prodMul += 0.3; }, 'Industrie');
}
// technology level at the start (T1 = from scratch … T4 = everything researched), for all sides
const TL_DEPTH = [0, 2, 4, 99], TL_ENERGY = [500, 1000, 1600, 2500], TL_NAME = ['T1', 'T2', 'T3', 'T4'];
const RS_DEPTH = {}; { const dep = id => { if (RS_DEPTH[id]) return RS_DEPTH[id]; const r = RS.find(x => x.id === id); return RS_DEPTH[id] = 1 + Math.max(0, ...(r ? r.req : []).map(dep)); }; RS.forEach(r => dep(r.id)); }
function applyTechLevel(tl) { tl = clamp(tl | 0, 0, 3); if (!tl) return;
  const ids = RS.filter(r => RS_DEPTH[r.id] <= TL_DEPTH[tl]).sort((a, b) => RS_DEPTH[a.id] - RS_DEPTH[b.id]).map(r => r.id);
  for (let t = 0; t < TEAMS.length; t++) { TEAMS[t].energy = TL_ENERGY[tl]; for (const id of ids) finishResearch(t, id); } }
function scaleHp(team, k, kind) { for (const e of ents) if (e.alive && e.team === team && e.kind === kind) { const r = e.hp / e.maxHp; e.maxHp = Math.round(e.maxHp * k); e.hp = e.maxHp * r; } if (kind === 'unit') TEAMS[team].hpMul *= k; }
const RICON = {
  cyborg: SV(`<circle cx="24" cy="9" r="5" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><rect x="20" y="9" width="8" height="3" fill="#3f9fe0"/><path d="M16 16h16l-2 14H18z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><path d="M19 30l-3 14M29 30l3 14" stroke="#c9b48a" stroke-width="4"/><path d="M32 18l6 8h6" stroke="#3a3a36" stroke-width="3"/><path d="M16 18l-5 9" stroke="#c9b48a" stroke-width="3"/>`),
  hcyborg: SV(`<circle cx="24" cy="9" r="5" fill="#3d432f" stroke="#c9b48a" stroke-width="2"/><rect x="20" y="9" width="8" height="3" fill="#e0402a"/><path d="M12 15h24l-3 16H15z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><rect x="9" y="14" width="8" height="7" rx="2" fill="#f0b44a"/><rect x="31" y="14" width="8" height="7" rx="2" fill="#f0b44a"/><path d="M18 31l-3 13M30 31l3 13" stroke="#c9b48a" stroke-width="5"/><path d="M36 22l6 6h5" stroke="#3a3a36" stroke-width="4"/>`),
  drone: SV(`<path d="M12 12l24 24M36 12L12 36" stroke="#c9b48a" stroke-width="3"/><ellipse cx="24" cy="24" rx="7" ry="5" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><circle cx="24" cy="28" r="2" fill="#3f9fe0"/>${[[10, 10], [38, 10], [10, 38], [38, 38]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="2.5" fill="#3a3a36" opacity=".7"/><circle cx="${x}" cy="${y}" r="2" fill="#f0b44a"/>`).join('')}`),
  vtol: SV(`<path d="M24 4l4 12 16 10v4l-16-4-1 10 6 5v3l-9-3-9 3v-3l6-5-1-10-16 4v-4l16-10z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><rect x="21" y="10" width="6" height="6" rx="2" fill="#3f9fe0"/><path d="M16 46l2-6M32 46l-2-6" stroke="#f0b44a" stroke-width="3"/>`),
  fbomb: SV(`<path d="M24 46c-9 0-13-6-11-12 2 3 4 3 5 1-1-5 2-9 6-11-1 4 2 6 4 7 1-2 1-4 0-6 5 3 8 8 7 13 0 5-4 8-11 8z" fill="#e0602a" stroke="#f0b44a" stroke-width="1.5"/><ellipse cx="24" cy="14" rx="6" ry="10" fill="#a83a26" stroke="#c9b48a" stroke-width="2"/><rect x="18" y="10" width="12" height="3" fill="#f0b44a"/>`),
  hbomb: SV(`<ellipse cx="24" cy="22" rx="11" ry="16" fill="#2e3236" stroke="#c9b48a" stroke-width="2"/><path d="M24 38v7M15 45l9-7 9 7" stroke="#c9b48a" stroke-width="3"/><rect x="13" y="14" width="22" height="4" fill="#e0402a"/><rect x="13" y="24" width="22" height="2" fill="#f0b44a"/>`),
  bomb: SV(`<ellipse cx="24" cy="22" rx="8" ry="14" fill="#3d432f" stroke="#c9b48a" stroke-width="2"/><path d="M24 36v8M17 42l7-6 7 6" stroke="#c9b48a" stroke-width="2.5"/><rect x="16" y="16" width="16" height="3" fill="#f0b44a"/><path d="M24 2v4" stroke="#e0402a" stroke-width="3"/>`),
  halftrack: SV(`<rect x="10" y="14" width="30" height="9" rx="4" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><circle cx="12" cy="32" r="7" fill="#2a2823" stroke="#c9b48a" stroke-width="2"/><circle cx="12" cy="32" r="2.5" fill="#3f9fe0"/><rect x="22" y="24" width="22" height="14" rx="7" fill="#2a2823" stroke="#c9b48a" stroke-width="2"/><circle cx="29" cy="31" r="3.5" fill="#6b6658"/><circle cx="37" cy="31" r="3.5" fill="#6b6658"/>`),
  tracks: SV(`<rect x="5" y="22" width="38" height="16" rx="8" fill="#2a2823" stroke="#c9b48a" stroke-width="2"/><circle cx="13" cy="30" r="4" fill="#6b6658"/><circle cx="24" cy="30" r="4" fill="#6b6658"/><circle cx="35" cy="30" r="4" fill="#6b6658"/><path d="M9 22h30" stroke="#8a826e" stroke-width="2" stroke-dasharray="3 3"/><rect x="12" y="12" width="24" height="9" rx="4" fill="#71804e"/>`),
  cannon: SV(`<path d="M10 34a14 10 0 0 1 28 0z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><rect x="22" y="20" width="22" height="5" rx="2" fill="#3a3a36" stroke="#c9b48a" stroke-width="1.5" transform="rotate(-18 22 22)"/><rect x="8" y="34" width="32" height="6" rx="3" fill="#3d432f"/><circle cx="44" cy="12" r="3" fill="#ffcf5a"/>`),
  medium: SV(`<rect x="6" y="28" width="36" height="10" rx="5" fill="#2a2823"/><path d="M9 28l4-8h22l4 8z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><path d="M18 20a6 5 0 0 1 12 0z" fill="#5c6a3e"/><rect x="28" y="15" width="14" height="3" rx="1.5" fill="#3a3a36"/><text x="24" y="47" font-size="8" text-anchor="middle" fill="#f0b44a" font-family="sans-serif" font-weight="bold">II</text>`),
  hover: SV(`<ellipse cx="24" cy="38" rx="17" ry="4" fill="#3f9fe0" opacity=".55"/><path d="M8 30a16 8 0 0 1 32 0z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><ellipse cx="24" cy="31" rx="17" ry="3.5" fill="#3d432f"/><path d="M12 43q4-3 8 0t8 0 8 0" stroke="#66ccff" stroke-width="2"/><path d="M19 22a5 4 0 0 1 10 0z" fill="#5c6a3e"/>`),
  rockets: SV(`<g transform="rotate(-35 24 24)"><rect x="14" y="8" width="7" height="24" rx="3.5" fill="#e8e8e8" stroke="#c9b48a" stroke-width="1.5"/><path d="M14 12l3.5-6 3.5 6z" fill="#e0402a"/><path d="M15 32l2.5 9 2.5-9z" fill="#ff9a2a"/><rect x="27" y="12" width="7" height="24" rx="3.5" fill="#e8e8e8" stroke="#c9b48a" stroke-width="1.5"/><path d="M27 16l3.5-6 3.5 6z" fill="#e0402a"/><path d="M28 36l2.5 8 2.5-8z" fill="#ff9a2a"/></g>`),
  heavy: SV(`<rect x="3" y="28" width="42" height="12" rx="6" fill="#2a2823"/><path d="M5 28l3-11h32l3 11z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><path d="M14 17a10 7 0 0 1 20 0z" fill="#5c6a3e" stroke="#c9b48a" stroke-width="1.5"/><rect x="30" y="10" width="15" height="4" rx="2" fill="#3a3a36"/><text x="24" y="38" font-size="8" text-anchor="middle" fill="#f0b44a" font-family="sans-serif" font-weight="bold">III</text>`),
  tower2: SV(`<rect x="14" y="20" width="20" height="22" fill="#8c867a" stroke="#c9b48a" stroke-width="2"/><rect x="12" y="17" width="24" height="4" fill="#3f9fe0"/><path d="M16 17a8 6 0 0 1 16 0z" fill="#71804e"/><rect x="28" y="9" width="16" height="4" rx="2" fill="#3a3a36" transform="rotate(-12 28 11)"/><rect x="20" y="28" width="8" height="3" fill="#1c1c1c"/>`),
  armor: SV(`<path d="M24 5l16 6v11c0 11-7 18-16 21C15 40 8 33 8 22V11z" fill="#5c6a3e" stroke="#c9b48a" stroke-width="2"/><path d="M24 11l10 4v7c0 7-4 12-10 14-6-2-10-7-10-14v-7z" fill="#71804e"/><path d="M19 24l4 4 7-8" stroke="#f0b44a" stroke-width="3"/>`),
  engine: SV(`<circle cx="22" cy="26" r="11" fill="#5a564f" stroke="#c9b48a" stroke-width="2"/><circle cx="22" cy="26" r="4" fill="#f0b44a"/><path d="M22 15v-4M22 41v-4M11 26H7M37 26h-4M14 18l-3-3M30 34l3 3M14 34l-3 3M30 18l3-3" stroke="#c9b48a" stroke-width="3"/><path d="M38 12h8M36 18h10M40 24h6" stroke="#66ccff" stroke-width="2.5"/>`),
  radar: SV(`<path d="M24 44V26" stroke="#c9b48a" stroke-width="3"/><path d="M14 44h20" stroke="#c9b48a" stroke-width="3"/><path d="M8 10a20 20 0 0 0 26 22z" fill="#9ab0b8" stroke="#c9b48a" stroke-width="2"/><path d="M21 21l9-9" stroke="#3a3a36" stroke-width="2"/><circle cx="31" cy="11" r="2.5" fill="#e0402a"/><path d="M34 6a10 10 0 0 1 8 8M36 2a15 15 0 0 1 10 10" stroke="#66ccff" stroke-width="2"/>`),
  repair: SV(`<path d="M10 38l16-16" stroke="#c9b48a" stroke-width="7"/><path d="M10 38l16-16" stroke="#8c867a" stroke-width="4"/><path d="M24 12a9 9 0 0 0 12 12l4 4 4-4-4-4a9 9 0 0 0-12-12l5 5-3 4-4 1z" fill="#c9c2b0" stroke="#5a564f" stroke-width="1.5"/><circle cx="14" cy="14" r="8" fill="#2e8a3e" stroke="#bff08a" stroke-width="2"/><path d="M14 9v10M9 14h10" stroke="#fff" stroke-width="3"/>`),
  scout: SV(`<rect x="10" y="29" width="28" height="7" rx="3.5" fill="#2a2823"/><path d="M12 29l4-5h14l8 5z" fill="#8a9a5e" stroke="#c9b48a" stroke-width="2"/><path d="M22 24l2-4h5l1 4z" fill="#9fd3e6"/><path d="M40 16h6M38 20h8" stroke="#66ccff" stroke-width="2"/>`),
  assault: SV(`<rect x="5" y="29" width="38" height="10" rx="5" fill="#2a2823"/><path d="M6 29l5-9h26l6 9z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><path d="M4 30l6-12M44 30l-6-12" stroke="#3d432f" stroke-width="4"/><path d="M16 20a8 6 0 0 1 16 0z" fill="#5c6a3e"/><path d="M30 15l14-4" stroke="#3a3a36" stroke-width="3"/>`),
  titan: SV(`<rect x="2" y="30" width="44" height="12" rx="6" fill="#2a2823"/><path d="M3 30l3-12h36l3 12z" fill="#5c6a3e" stroke="#c9b48a" stroke-width="2"/><path d="M7 22h34" stroke="#3d432f" stroke-width="5"/><path d="M12 18a12 8 0 0 1 24 0z" fill="#71804e" stroke="#c9b48a" stroke-width="1.5"/><rect x="32" y="8" width="14" height="4" rx="2" fill="#3a3a36"/><rect x="32" y="13" width="14" height="4" rx="2" fill="#3a3a36"/>`),
  nova: SV(`<rect x="6" y="30" width="36" height="9" rx="4.5" fill="#2a2823"/><path d="M7 30q2-10 17-10t17 10z" fill="#d4a832" stroke="#fff0b0" stroke-width="2"/><ellipse cx="22" cy="23" rx="7" ry="3.5" fill="#2a3a44"/><path d="M9 29h30" stroke="#66e0ff" stroke-width="2"/><path d="M40 10l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#ffe680"/>`),
  traps: SV(`<path d="M8 40l14-22M22 40L8 18M15 14v28" stroke="#5a564f" stroke-width="4"/><path d="M26 40V24h18v16z" fill="#8c867a" stroke="#c9b48a" stroke-width="2"/><path d="M26 28h18M32 24v4M38 28v6M26 34h18" stroke="#5a564f" stroke-width="1.5"/>`),
  bunker: SV(`<path d="M4 40q4-16 20-16t20 16z" fill="#8c867a" stroke="#c9b48a" stroke-width="2"/><rect x="14" y="31" width="20" height="4" rx="1" fill="#1c1c1c"/><path d="M24 33h20" stroke="#3a3a36" stroke-width="3"/>`),
  hardpoint: SV(`<rect x="8" y="20" width="32" height="22" fill="#8c867a" stroke="#c9b48a" stroke-width="2"/><path d="M8 26h32M8 34h32M18 20v6M30 26v8M18 34v8" stroke="#5a564f" stroke-width="1.5"/><path d="M14 20l4-8h12l4 8z" fill="#5c6a3e" stroke="#c9b48a" stroke-width="1.5"/><path d="M28 14h16" stroke="#3a3a36" stroke-width="3"/>`),
  fortress: SV(`<path d="M3 42V22l6-4 6 4v-6l9-6 9 6v6l6-4 6 4v20z" fill="#8c867a" stroke="#c9b48a" stroke-width="2"/><path d="M17 16a7 5 0 0 1 14 0z" fill="#5c6a3e"/><path d="M28 12h18M28 16h16" stroke="#3a3a36" stroke-width="3"/><rect x="20" y="32" width="8" height="10" rx="4" fill="#2a2823"/>`),
  mortar: SV(`<ellipse cx="22" cy="40" rx="18" ry="4" fill="#5a564f"/><path d="M14 38l6-22 6 2-4 21z" fill="#3a3a36" stroke="#c9b48a" stroke-width="1.5"/><path d="M10 38h20" stroke="#c9b48a" stroke-width="3"/><path d="M24 12q10-10 20 2" stroke="#ffcf5a" stroke-width="2" stroke-dasharray="3 3"/><circle cx="44" cy="15" r="3" fill="#e0402a"/>`),
  imortar: SV(`<ellipse cx="22" cy="40" rx="18" ry="4" fill="#5a564f"/><path d="M14 38l6-22 6 2-4 21z" fill="#3a3a36" stroke="#c9b48a" stroke-width="1.5"/><path d="M15 32l9 3M17 26l8 3" stroke="#e0402a" stroke-width="2"/><path d="M34 14c4-6 8-2 10-7 0 6-2 8 0 12-3-1-6 2-10-1z" fill="#ff8a2a"/>`),
  empmortar: SV(`<ellipse cx="22" cy="40" rx="18" ry="4" fill="#5a564f"/><path d="M14 38l6-22 6 2-4 21z" fill="#3a3a36" stroke="#66ccff" stroke-width="1.5"/><path d="M34 6l-4 8h6l-4 9" stroke="#66e0ff" stroke-width="2.5"/><circle cx="40" cy="30" r="5" stroke="#66e0ff" stroke-width="2"/><circle cx="40" cy="30" r="9" stroke="#66e0ff" stroke-width="1" opacity=".6"/>`),
  salvo: SV(`<rect x="6" y="30" width="34" height="8" rx="2" fill="#3d432f"/><g transform="rotate(-30 22 26)"><rect x="8" y="16" width="30" height="12" rx="2" fill="#71804e" stroke="#c9b48a" stroke-width="1.5"/><circle cx="36" cy="19" r="2" fill="#1c1c1c"/><circle cx="36" cy="25" r="2" fill="#1c1c1c"/><circle cx="31" cy="19" r="2" fill="#1c1c1c"/><circle cx="31" cy="25" r="2" fill="#1c1c1c"/></g><path d="M38 6l4 4M42 4l3 5" stroke="#ff9a2a" stroke-width="2"/>`),
  howitzer: SV(`<path d="M6 40l8-10h20l8 10z" fill="#3d432f"/><path d="M16 30l24-18" stroke="#3a3a36" stroke-width="5"/><path d="M18 31l12-9" stroke="#71804e" stroke-width="7"/><circle cx="12" cy="38" r="4" fill="#2a2823" stroke="#c9b48a" stroke-width="1.5"/><circle cx="36" cy="38" r="4" fill="#2a2823" stroke="#c9b48a" stroke-width="1.5"/><path d="M40 12l5-3" stroke="#ffcf5a" stroke-width="2"/>`),
  ihowitzer: SV(`<path d="M6 40l8-10h20l8 10z" fill="#3d432f"/><path d="M16 30l24-18" stroke="#3a3a36" stroke-width="5"/><path d="M18 31l12-9" stroke="#b8432c" stroke-width="7"/><path d="M38 8c3-5 6-1 8-5 0 5-2 6 0 9-3-1-5 1-8-1z" fill="#ff8a2a"/>`),
  rhowitzer: SV(`<path d="M6 40l8-10h20l8 10z" fill="#3d432f"/><path d="M14 28l24-18M18 32l24-18" stroke="#3a3a36" stroke-width="4"/><path d="M18 31l10-7" stroke="#71804e" stroke-width="8"/><path d="M40 6l5-2M44 12l4-1" stroke="#ffcf5a" stroke-width="2"/>`),
  hhowitzer: SV(`<path d="M3 42l8-12h26l8 12z" fill="#3d432f"/><path d="M14 30l30-22" stroke="#2e2e2a" stroke-width="7"/><path d="M16 32l14-10" stroke="#50565e" stroke-width="10"/><text x="10" y="18" font-size="9" fill="#f0b44a" font-family="sans-serif" font-weight="bold">XL</text>`),
  plasma: SV(`<path d="M6 40l8-10h20l8 10z" fill="#3d432f"/><path d="M16 30l22-16" stroke="#3a3a40" stroke-width="7"/><path d="M20 27l4-3M26 23l4-3M32 19l4-3" stroke="#60ff90" stroke-width="3"/><circle cx="41" cy="11" r="5" fill="#9affb8" stroke="#2eaa4a" stroke-width="2"/>`),
  rbattery: SV(`<rect x="6" y="34" width="36" height="7" rx="2" fill="#3d432f"/><g transform="rotate(-28 24 26)"><rect x="5" y="16" width="12" height="14" fill="#7b7f82" stroke="#c9b48a" stroke-width="1.2"/><rect x="18" y="16" width="12" height="14" fill="#7b7f82" stroke="#c9b48a" stroke-width="1.2"/><rect x="31" y="16" width="12" height="14" fill="#7b7f82" stroke="#c9b48a" stroke-width="1.2"/><g fill="#111"><circle cx="9" cy="20" r="1.5"/><circle cx="13" cy="20" r="1.5"/><circle cx="9" cy="26" r="1.5"/><circle cx="13" cy="26" r="1.5"/><circle cx="22" cy="20" r="1.5"/><circle cx="26" cy="20" r="1.5"/><circle cx="22" cy="26" r="1.5"/><circle cx="26" cy="26" r="1.5"/><circle cx="35" cy="20" r="1.5"/><circle cx="39" cy="20" r="1.5"/><circle cx="35" cy="26" r="1.5"/><circle cx="39" cy="26" r="1.5"/></g></g><path d="M8 34h32" stroke="#e0b020" stroke-width="3" stroke-dasharray="3 3"/>`),
  smissile: SV(`<rect x="8" y="34" width="32" height="7" rx="2" fill="#3d432f"/><g transform="rotate(-30 24 24)"><rect x="4" y="27" width="38" height="3" fill="#5a5e60"/><g fill="#eef0f2" stroke="#c9b48a" stroke-width=".8"><rect x="6" y="11" width="30" height="3.4" rx="1.6"/><rect x="6" y="16" width="30" height="3.4" rx="1.6"/><rect x="6" y="21" width="30" height="3.4" rx="1.6"/></g><g fill="#3f9fe0"><path d="M36 11l5 1.7-5 1.7z"/><path d="M36 16l5 1.7-5 1.7z"/><path d="M36 21l5 1.7-5 1.7z"/></g></g>`),
  omissile: SV(`<rect x="6" y="36" width="36" height="7" rx="2" fill="#3d432f"/><rect x="8" y="22" width="5" height="14" fill="#6a6e70"/><rect x="35" y="22" width="5" height="14" fill="#6a6e70"/><g transform="rotate(-55 24 30)"><rect x="6" y="26" width="32" height="8" rx="4" fill="#2e3236" stroke="#c9b48a" stroke-width="1.2"/><path d="M38 26l8 4-8 4z" fill="#c8321e"/><path d="M14 26v8M22 26v8M30 26v8" stroke="#e0b020" stroke-width="2"/><path d="M6 26l-4-3M6 34l-4 3" stroke="#1e1e1e" stroke-width="2"/></g>`),
  icbm: SV(`<rect x="4" y="36" width="40" height="7" fill="#8c867a" stroke="#c9b48a" stroke-width="1.2"/><path d="M8 36h7M33 36h7" stroke="#e0b020" stroke-width="3"/><rect x="15" y="34" width="18" height="4" fill="#111"/><rect x="20" y="10" width="8" height="26" rx="3" fill="#dfe3e6" stroke="#c9b48a" stroke-width="1"/><path d="M20 12l4-8 4 8z" fill="#2e3236"/><path d="M20 22h8" stroke="#c8321e" stroke-width="2"/><path d="M14 34l-4-6M34 34l4-6" stroke="#bbb" stroke-width="2" opacity=".7"/>`),
  ballistic: SV(`<path d="M10 42h28" stroke="#c9b48a" stroke-width="3"/><path d="M24 4c5 6 6 12 6 30h-12c0-18 1-24 6-30z" fill="#e8e8e8" stroke="#c9b48a" stroke-width="1.5"/><path d="M18 26l-5 8h5zM30 26l5 8h-5z" fill="#b8432c"/><path d="M20 34l4 7 4-7" fill="#ff9a2a"/><rect x="20" y="12" width="8" height="3" fill="#b8432c"/>`),
  flame: SV(`<rect x="6" y="20" width="9" height="18" rx="4.5" fill="#b8432c" stroke="#c9b48a" stroke-width="1.5"/><rect x="16" y="22" width="9" height="16" rx="4.5" fill="#b8432c" stroke="#c9b48a" stroke-width="1.5"/><path d="M24 28h8" stroke="#3a3a36" stroke-width="4"/><path d="M32 28c6-8 10-2 14-8-1 7-4 9-2 14-4-2-7 2-12-2z" fill="#ff8a2a"/><path d="M33 28c4-4 6-1 9-4-1 4-2 5-1 8-3-1-5 1-8-1z" fill="#ffe680"/>`),
  viper: SV(`<rect x="8" y="30" width="32" height="9" rx="3" fill="#3d432f"/><rect x="17" y="22" width="14" height="10" fill="#71804e" stroke="#c9b48a" stroke-width="1.5"/><path d="M17 30h14" stroke="#e0b020" stroke-width="3" stroke-dasharray="2.5 2.5"/><g transform="rotate(-14 24 22)"><rect x="3" y="14" width="22" height="4.5" rx="2" fill="#e8e8e8" stroke="#c9b48a" stroke-width="1"/><path d="M25 14l5 2.25-5 2.25z" fill="#e0402a"/><rect x="25" y="20" width="0" height="0"/><rect x="23" y="24" width="22" height="4.5" rx="2" fill="#e8e8e8" stroke="#c9b48a" stroke-width="1"/><path d="M45 24l3 2.25-3 2.25z" fill="#e0402a"/><path d="M3 14l-2-2M3 18.5l-2 2" stroke="#3a3a36" stroke-width="1.5"/></g>`),
  laser: SV(`<path d="M8 34a10 7 0 0 1 20 0z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><rect x="18" y="22" width="16" height="5" rx="2.5" fill="#3a3a40" transform="rotate(-15 18 24)"/><circle cx="34" cy="19" r="3" fill="#fff2a0"/><path d="M36 18l10-3" stroke="#ffd84a" stroke-width="3"/><path d="M36 18l10-3" stroke="#fff" stroke-width="1"/><rect x="6" y="34" width="26" height="6" rx="3" fill="#3d432f"/>`),
  radar2: SV(`<path d="M24 44V28" stroke="#c9b48a" stroke-width="3"/><path d="M14 44h20" stroke="#c9b48a" stroke-width="3"/><rect x="8" y="10" width="32" height="16" rx="2" fill="#3d4a52" stroke="#c9b48a" stroke-width="2"/><path d="M14 12v12M20 12v12M26 12v12M32 12v12" stroke="#6fa8c8" stroke-width="2.5"/><path d="M40 4l4 6h-3v6h-2v-6h-3z" fill="#7fb84a"/>`),
  repair2: SV(`<path d="M8 40l14-14" stroke="#8c867a" stroke-width="6"/><path d="M20 14a8 8 0 0 0 11 11l4 4 4-4-4-4a8 8 0 0 0-11-11l5 5-3 3-4 1z" fill="#c9c2b0" stroke="#5a564f" stroke-width="1.5"/><circle cx="13" cy="14" r="8" fill="#2e8a3e" stroke="#bff08a" stroke-width="2"/><path d="M13 9v10M8 14h10" stroke="#fff" stroke-width="3"/><path d="M36 36l6-6M36 42l6-6" stroke="#ffcf5a" stroke-width="3"/>`),
  wheels: SV(`<rect x="8" y="16" width="32" height="10" rx="4" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><circle cx="14" cy="32" r="7" fill="#2a2823" stroke="#c9b48a" stroke-width="2"/><circle cx="34" cy="32" r="7" fill="#2a2823" stroke="#c9b48a" stroke-width="2"/><circle cx="14" cy="32" r="2.5" fill="#8a826e"/><circle cx="34" cy="32" r="2.5" fill="#8a826e"/>`),
  light: SV(`<rect x="8" y="28" width="32" height="8" rx="4" fill="#2a2823"/><path d="M11 28l3-6h20l3 6z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><text x="24" y="46" font-size="8" text-anchor="middle" fill="#f0b44a" font-family="sans-serif" font-weight="bold">I</text>`),
  mg: SV(`<path d="M14 32a10 7 0 0 1 20 0z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><rect x="26" y="22" width="18" height="3" rx="1.5" fill="#3a3a36"/><rect x="26" y="27" width="18" height="3" rx="1.5" fill="#3a3a36"/><rect x="10" y="32" width="28" height="6" rx="3" fill="#3d432f"/><path d="M45 20l2-2M45 31l2 2" stroke="#ffcf5a" stroke-width="2"/>`),
  truck: SV(`<rect x="4" y="18" width="24" height="16" rx="3" fill="#f0b44a" stroke="#7a5a1a" stroke-width="2"/><path d="M28 22h8l6 7v5H28z" fill="#d89a30" stroke="#7a5a1a" stroke-width="2"/><circle cx="12" cy="37" r="5" fill="#2a2823" stroke="#c9b48a" stroke-width="2"/><circle cx="34" cy="37" r="5" fill="#2a2823" stroke="#c9b48a" stroke-width="2"/><path d="M8 18l6-10h6" stroke="#555" stroke-width="3"/>`),
  prod: SV(`<path d="M5 40V22l9 6v-6l9 6v-6l9 6V12h8v28z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><rect x="34" y="6" width="4" height="7" fill="#6f6a61"/><circle cx="18" cy="35" r="5" fill="#3d432f" stroke="#f0b44a" stroke-width="2"/><path d="M18 28v2M18 40v2M11 35h2M23 35h2" stroke="#f0b44a" stroke-width="2"/><rect x="28" y="32" width="6" height="8" fill="#24221f"/>`),
};
// UI icons: original SVG drawings, same style as research icons
const SI = (inner, cls = 'ui') => `<svg class="${cls}" viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const K = '#c9b48a', OL = '#71804e', OD = '#3d432f', AM = '#f0b44a', BL = '#3f9fe0';
const UIC = {
  airfactory: SI(`<path d="M3 42V24a21 16 0 0 1 42 0v18z" fill="${OL}" stroke="${K}" stroke-width="2"/><path d="M14 42V30h20v12" fill="#2c2a26" stroke="${K}" stroke-width="1.5"/><path d="M24 26l2 6 8 4v2l-8-2-1 4 3 2v1l-4-1-4 1v-1l3-2-1-4-8 2v-2l8-4z" fill="${AM}"/>`),
  cybfactory: SI(`<rect x="4" y="18" width="40" height="24" fill="${OL}" stroke="${K}" stroke-width="2"/><rect x="8" y="10" width="6" height="10" fill="${BL}" stroke="${K}" stroke-width="1.5"/><rect x="34" y="10" width="6" height="10" fill="${BL}" stroke="${K}" stroke-width="1.5"/><circle cx="24" cy="25" r="3" fill="${AM}"/><path d="M20 29h8l-1 7h-6zM21 36l-1 5M27 36l1 5" stroke="${AM}" stroke-width="2" fill="${AM}"/>`),
  vpad: SI(`<ellipse cx="24" cy="30" rx="20" ry="11" fill="#6f6a61" stroke="${K}" stroke-width="2"/><ellipse cx="24" cy="30" rx="14" ry="7.5" fill="none" stroke="${AM}" stroke-width="2"/><path d="M18 26v8M30 26v8M18 30h12" stroke="#fff" stroke-width="2.5"/><path d="M24 4l3 8 9 5v2l-9-2-1 5 3 2v1l-5-1-5 1v-1l3-2-1-5-9 2v-2l9-5z" fill="${OL}" stroke="${K}" stroke-width="1"/>`),
  silo: SI(`<rect x="3" y="30" width="42" height="12" fill="#8c867a" stroke="${K}" stroke-width="2"/><ellipse cx="24" cy="31" rx="13" ry="4" fill="#222"/><rect x="6" y="27" width="14" height="5" fill="#6f7a52" stroke="${K}"/><rect x="28" y="27" width="14" height="5" fill="#6f7a52" stroke="${K}"/><rect x="21" y="6" width="6" height="23" rx="2" fill="#dfe3e6" stroke="${K}"/><path d="M21 8l3-6 3 6z" fill="#2e3236"/><path d="M4 42h40" stroke="#e0b020" stroke-width="2" stroke-dasharray="3 3"/>`),
  generator: SI(`<path d="M7 42c3-9 3-18 0-27h14c-3 9-3 18 0 27z" fill="#8c867a" stroke="${K}" stroke-width="2"/><path d="M24 42c3-9 3-18 0-27h14c-3 9-3 18 0 27z" fill="#a39d90" stroke="${K}" stroke-width="2"/><path d="M12 12q2-5 6-4M29 12q2-5 6-4" stroke="#ddd" stroke-width="2.5" opacity=".8"/><path d="M42 18l-6 10h5l-4 10" stroke="${AM}" stroke-width="3"/>`),
  factory: SI(`<path d="M4 42V24l10 6v-6l10 6v-6l10 6V10h8v32z" fill="${OL}" stroke="${K}" stroke-width="2"/><rect x="8" y="34" width="5" height="4" fill="${AM}"/><rect x="17" y="34" width="5" height="4" fill="${AM}"/><rect x="26" y="34" width="5" height="4" fill="${AM}"/><path d="M36 6q3-3 6-1" stroke="#ccc" stroke-width="2"/>`),
  lab: SI(`<rect x="6" y="22" width="26" height="18" rx="2" fill="#9ab0b8" stroke="${K}" stroke-width="2"/><rect x="9" y="26" width="20" height="5" fill="${BL}"/><rect x="32" y="14" width="10" height="26" rx="4" fill="#c9ced2" stroke="${K}" stroke-width="2"/><path d="M32 22h10M32 30h10" stroke="#60e0ff" stroke-width="2.5"/><rect x="10" y="16" width="16" height="6" fill="#7d8a90" stroke="${K}" stroke-width="1.5"/><rect x="4" y="40" width="40" height="4" rx="1" fill="${OD}"/>`),
  tower: SI(`<rect x="15" y="20" width="18" height="22" fill="#8c867a" stroke="${K}" stroke-width="2"/><rect x="12" y="16" width="24" height="5" fill="${OD}" stroke="${K}" stroke-width="1.5"/><path d="M17 16a7 6 0 0 1 14 0z" fill="${OL}"/><path d="M29 12l14-4" stroke="#3a3a36" stroke-width="4"/><rect x="21" y="27" width="6" height="3" fill="#1c1c1c"/>`),
  hq: SI(`<path d="M6 42V22h36v20z" fill="${OL}" stroke="${K}" stroke-width="2"/><path d="M4 22l20-12 20 12z" fill="#5c6a3e" stroke="${K}" stroke-width="2"/><rect x="20" y="30" width="8" height="12" fill="${OD}"/><rect x="10" y="27" width="6" height="5" fill="${AM}"/><rect x="32" y="27" width="6" height="5" fill="${AM}"/><path d="M24 10V3" stroke="${K}" stroke-width="2"/><path d="M24 3h8l-2 3 2 3h-8" fill="#c0392b"/>`),
  truck: SI(`<rect x="4" y="18" width="24" height="16" rx="3" fill="${AM}" stroke="#7a5a1a" stroke-width="2"/><path d="M28 22h8l6 7v5H28z" fill="#d89a30" stroke="#7a5a1a" stroke-width="2"/><rect x="31" y="24" width="6" height="5" fill="#9ad4ff"/><circle cx="12" cy="37" r="5" fill="#2a2823" stroke="${K}" stroke-width="2"/><circle cx="34" cy="37" r="5" fill="#2a2823" stroke="${K}" stroke-width="2"/><path d="M8 18l6-10h6" stroke="#555" stroke-width="3"/>`),
  tank: SI(`<rect x="4" y="29" width="40" height="11" rx="5.5" fill="#2a2823" stroke="${K}" stroke-width="1.5"/><circle cx="12" cy="34.5" r="2.5" fill="#6b6658"/><circle cx="24" cy="34.5" r="2.5" fill="#6b6658"/><circle cx="36" cy="34.5" r="2.5" fill="#6b6658"/><path d="M7 29q2-8 8-8h18q6 0 8 8z" fill="${OL}" stroke="${K}" stroke-width="2"/><path d="M15 21a9 7 0 0 1 18 0z" fill="#5c6a3e" stroke="${K}" stroke-width="1.5"/><path d="M30 17l15-4" stroke="#3a3a36" stroke-width="3.5"/>`),
  design: SI(`<circle cx="24" cy="24" r="9" fill="${OD}" stroke="${K}" stroke-width="2"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11 11l4 4M33 33l4 4M11 37l4-4M33 15l4-4" stroke="${K}" stroke-width="4"/><circle cx="24" cy="24" r="3.5" fill="${AM}"/>`),
  army: SI(`<path d="M10 38L34 8M38 38L14 8" stroke="#d8d8d8" stroke-width="4"/><path d="M6 34l8 8M42 34l-8 8" stroke="${AM}" stroke-width="5"/><path d="M30 8h6v6M18 8h-6v6" stroke="#d8d8d8" stroke-width="2.5"/>`),
  box: SI(`<rect x="7" y="9" width="34" height="28" rx="3" stroke="${BL}" stroke-width="3" stroke-dasharray="6 4"/><path d="M26 24l14 6-6 2 5 7-3 2-5-7-4 5z" fill="#fff" stroke="#333" stroke-width="1.5"/>`),
  base: SI(`<circle cx="24" cy="24" r="16" stroke="${K}" stroke-width="2.5"/><circle cx="24" cy="24" r="8" stroke="${AM}" stroke-width="2.5"/><path d="M24 2v10M24 36v10M2 24h10M36 24h10" stroke="${K}" stroke-width="3"/><circle cx="24" cy="24" r="2.5" fill="${AM}"/>`),
  energy: SI(`<path d="M28 3L10 27h12l-4 18 20-26H26z" fill="${AM}" stroke="#7a5a1a" stroke-width="2"/>`),
  units: SI(`<path d="M6 30q0-20 18-20t18 20z" fill="${OL}" stroke="${K}" stroke-width="2"/><path d="M3 30h42" stroke="${K}" stroke-width="3"/><path d="M14 22q10-6 20 0" stroke="#90a060" stroke-width="2"/>`),
  clock: SI(`<circle cx="24" cy="26" r="16" fill="#2a2823" stroke="${K}" stroke-width="3"/><path d="M24 26V16M24 26l7 5" stroke="${AM}" stroke-width="3"/><path d="M19 5h10M24 5v5" stroke="${K}" stroke-width="3"/>`),
  pause: SI(`<rect x="13" y="10" width="7" height="28" rx="2" fill="${K}"/><rect x="28" y="10" width="7" height="28" rx="2" fill="${K}"/>`),
  amove: SI(`<path d="M6 40L30 16" stroke="#d8d8d8" stroke-width="4"/><path d="M26 10h14v14" stroke="${AM}" stroke-width="4"/><path d="M4 34l10 10" stroke="${AM}" stroke-width="4"/>`),
  stop: SI(`<rect x="11" y="11" width="26" height="26" rx="4" fill="#c0392b" stroke="#f5c0b0" stroke-width="2"/>`),
  ok: SI(`<path d="M9 25l10 10 20-22" stroke="#bff08a" stroke-width="5"/>`),
  no: SI(`<path d="M12 12l24 24M36 12L12 36" stroke="#ffc0b0" stroke-width="5"/>`),
  enemy: SI(`<path d="M24 5c-10 0-16 7-16 16 0 6 3 9 6 11v6h20v-6c3-2 6-5 6-11 0-9-6-16-16-16z" fill="#c9c2b0" stroke="#7a2a1a" stroke-width="2"/><circle cx="17" cy="22" r="4.5" fill="#7a1a10"/><circle cx="31" cy="22" r="4.5" fill="#7a1a10"/><path d="M20 38v5M24 38v5M28 38v5" stroke="#7a2a1a" stroke-width="2"/>`),
  wall: SI(`<path d="M4 42V18h6v-6h6v6h6v-6h6v6h6v-6h6v6h4v24z" fill="#8c867a" stroke="${K}" stroke-width="2"/><path d="M4 30h40M16 18v12M28 30v12" stroke="#5a564f" stroke-width="2"/>`),
  citadel: SI(`<path d="M6 42V16h8v6h6V10h8v12h6v-6h8v26z" fill="#8c867a" stroke="${K}" stroke-width="2"/><rect x="20" y="32" width="8" height="10" rx="4" fill="#2a2823"/><path d="M24 10V3h7l-2 2 2 2h-7" fill="#c0392b"/>`),
  pump: SI(`<path d="M8 40h32M14 40l6-24h8l6 24" stroke="${K}" stroke-width="3"/><rect x="18" y="8" width="12" height="8" fill="${OD}"/>`),
};
const BIC = t => UIC[t] || '';
{ const inner = svg => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const BASEI = { mg: RICON.mg, cannon: RICON.cannon, flame: RICON.flame, rockets: RICON.rockets, laser: RICON.laser, art: RICON.howitzer, armor: RICON.armor, engine: RICON.engine, hardpoint: RICON.hardpoint, power: UIC.generator, rspeed: UIC.lab, prod: RICON.prod };
  for (const [id, u] of Object.entries(UPG)) { const mk = id.match(/(\d)$/)[1]; const lvl = u.kind === 'up' ? (+mk) : +mk; const badge = u.kind === 'dmg' ? '#e0402a' : u.kind === 'rof' ? '#3f9fe0' : '#7fb84a';
    RICON[id] = SV(`<g transform="translate(2 4) scale(.82)">${inner(BASEI[u.base])}</g><circle cx="38" cy="10" r="9" fill="${badge}" stroke="#fff" stroke-width="1.5"/><text x="38" y="14" font-size="${u.kind === 'up' ? 9 : 10}" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="bold">${u.kind === 'dmg' ? '+' : u.kind === 'rof' ? '»' : '▲'}</text><text x="38" y="45" font-size="9" text-anchor="middle" fill="#f0b44a" font-family="sans-serif" font-weight="bold">${['I', 'II', 'III', 'IV'][lvl - 1] || ''}</text>`); } }
for (const [k, r] of [['repairbay', 'repair'], ['radartower', 'radar'], ['ptrap', 'traps'], ['pwall', 'hardpoint']]) UIC[k] = RICON[r].replace('class="ric"', 'class="ui"');
for (const k in BD) if (BD[k].cls) UIC[k] = RICON[BD[k].tw] ? RICON[BD[k].tw].replace('class="ric"', 'class="ui"') : UIC.tower;
for (const k in BD) if (BD[k].cls) BD[k].cost = DCLASS[BD[k].cls].cost + WP[BD[k].tw].cost * 2;
for (const k in WP) WP[k].id = k;
// air & cyborg rules
const FACT_TYPES = new Set(['factory', 'airfactory', 'cybfactory']);
const CYB_WP = ['mg', 'cannon', 'flame', 'rockets', 'laser'], DRONE_WP = ['mg', 'rockets', 'laser'], VTOL_WP = ['mg', 'cannon', 'rockets', 'viper', 'laser', 'bomb', 'fbomb', 'hbomb'];
const VAMMO = { mg: 10, cannon: 4, rockets: 4, viper: 2, laser: 6, bomb: 2, fbomb: 2, hbomb: 1 }; // VTOL attack runs before it must return to a rearming pad
const VTOL_ALT = 11, DRONE_ALT = 5.5;
const facFor = d => d.pr === 'legs' ? 'cybfactory' : PR[d.pr] && PR[d.pr].air ? 'airfactory' : 'factory';
function validDesign(d) { const c = CH[d.ch], p = PR[d.pr]; if (!c || !p || !WP[d.wp]) return false;
  if (c.only ? c.only !== d.pr : (d.pr === 'legs' || d.pr === 'rotor')) return false;
  if (d.pr === 'legs') return CYB_WP.includes(d.wp); if (d.pr === 'rotor') return DRONE_WP.includes(d.wp); if (d.pr === 'vtol') return VTOL_WP.includes(d.wp); return WP[d.wp].kind !== 'bomb'; }
const canHitAir = w => !w.art && ['mg', 'rocket', 'laser'].includes(w.kind); // like classic RTS: cannons, flamers and artillery cannot hit aircraft in flight
const flying = e => !!(e.air && e.alt > 1.5);
function mkTeam(i) { return { i, energy: 500, tech: new Set(['light', 'wheels', 'mg', 'truck']), researching: new Set(), hpMul: 1, spdMul: 1, prodMul: 1, shpMul: 1, powMul: 1, rsMul: 1, dmg: {}, rof: {}, units: 0, inc: 0 }; }
const TEAMS = [mkTeam(0), mkTeam(1)];

function unitStats(d, team) {
  const T = TEAMS[team], c = CH[d.ch], p = PR[d.pr], w = WP[d.wp];
  const cost = c.cost + p.cost + w.cost;
  return { hp: Math.round(c.hp * p.hp * T.hpMul * (d.wp === 'truck' ? 0.8 : 1)), speed: BASE_SPEED * c.spd * p.spd * T.spdMul, cost, w, range: w.range || 0, time: 3 + cost / 16 };
}
function designName(d) { return d.wp === 'truck' && d.ch === 'light' && d.pr === 'wheels' ? 'Constructor' : `${PR[d.pr].name}·${CH[d.ch].name}·${WP[d.wp].name}`; }

// ================= GEOMETRY CACHES =================
const geoCache = {};
const MSL_GEO = {};
function missileGeo(kind) {
  if (MSL_GEO[kind]) return MSL_GEO[kind];
  const K = { rocket: [0.045, 0xeeeeee, 0xc8321e, 0x3a3a36, 0xc8321e], viper: [0.05, 0xeeeeee, 0xc8321e, 0x3a3a36, 0xc8321e], seeker: [0.04, 0x7d8a5c, 0x3f9fe0, 0x3a3a36, 0xcdbf92],
    salvo: [0.06, 0xb8bcc0, 0xc8321e, 0x3a3a36, 0x5a5e60], orizont: [0.065, 0x5f6a48, 0xc8321e, 0x2e3328, 0xcdbf92], ballistic: [0.08, 0xe8e8e8, 0xb8432c, 0xb8432c, 0x3a3a36], icbm: [0.075, 0xdfe3e6, 0x2e3236, 0x3a3a36, 0xc8321e] }[kind] || [0.05, 0xeeeeee, 0xc8321e, 0x333333, 0xc8321e];
  const [r, body, nose, fin, band] = K, B = new Builder(), bl = 0.78;
  B.add(G.cyl16, r, bl, r, 0, -0.5 + bl / 2, 0, body);                                     // body (built along +y)
  B.add(G.cone, r, 1 - bl, r, 0, -0.5 + bl + (1 - bl) / 2, 0, nose);                         // nose
  for (const k of kind === 'orizont' ? [0.22, 0.42, 0.62] : [0.55]) B.add(G.cyl16, r * 1.04, 0.035, r * 1.04, 0, -0.5 + bl * k, 0, band);
  B.add(G.cyl16, r * 0.8, 0.04, r * 0.8, 0, -0.5 - 0.01, 0, 0x222222);                       // nozzle
  for (let f = 0; f < 4; f++) { const a = f * Math.PI / 2 + Math.PI / 4; B.box(0.012, 0.16, r * 2.6, Math.sin(a) * r * 1.6, -0.42, Math.cos(a) * r * 1.6, fin, 0, a, 0); }
  if (kind === 'orizont' || kind === 'ballistic') for (let f = 0; f < 4; f++) { const a = f * Math.PI / 2 + Math.PI / 4; B.box(0.008, 0.08, r * 1.6, Math.sin(a) * r * 1.2, 0.05, Math.cos(a) * r * 1.2, fin, 0, a, 0); }
  const g = B.build(); g.rotateX(Math.PI / 2); return MSL_GEO[kind] = g;
}
function wpMini(tb, wp, s, T, x, y, z) { // compact weapon for cyborgs and drones, barrel along +z
  const P2 = Math.PI / 2;
  if (wp === 'mg') { tb.box(0.16 * s, 0.18 * s, 0.55 * s, x, y, z, 0x2a2a2a); for (const sx of [-1, 1]) tb.add(G.cyl6, 0.035 * s, 0.6 * s, 0.035 * s, x + sx * 0.05 * s, y, z + 0.55 * s, 0x111111, P2, 0, 0); tb.box(0.08 * s, 0.2 * s, 0.12 * s, x, y - 0.17 * s, z + 0.05 * s, 0x3a3a36); }
  else if (wp === 'cannon') { tb.box(0.22 * s, 0.22 * s, 0.6 * s, x, y, z, T.dark); tb.add(G.cyl16, 0.07 * s, 0.95 * s, 0.07 * s, x, y, z + 0.75 * s, 0x2e3128, P2, 0, 0); tb.add(G.cyl16, 0.09 * s, 0.14 * s, 0.09 * s, x, y, z + 1.2 * s, 0x1a1a1a, P2, 0, 0); }
  else if (wp === 'flame') { tb.add(G.cyl16, 0.12 * s, 0.5 * s, 0.12 * s, x, y, z, 0xa83a26, P2, 0, 0); tb.add(G.cyl10, 0.05 * s, 0.5 * s, 0.05 * s, x, y, z + 0.45 * s, 0x3a3a36, P2, 0, 0); tb.add(G.cone, 0.08 * s, 0.14 * s, 0.08 * s, x, y, z + 0.75 * s, 0x1a1a1a, -P2, 0, 0); tb.box(0.04 * s, 0.04 * s, 0.04 * s, x, y - 0.06 * s, z + 0.78 * s, 0x66ccff); }
  else if (wp === 'rockets') { tb.box(0.34 * s, 0.3 * s, 0.7 * s, x, y, z + 0.1 * s, T.body); tb.box(0.36 * s, 0.06 * s, 0.72 * s, x, y + 0.12 * s, z + 0.1 * s, T.acc); for (const ox of [-0.08, 0.08]) for (const oy of [-0.07, 0.07]) { tb.add(G.cyl6, 0.055 * s, 0.06 * s, 0.055 * s, x + ox * s, y + oy * s, z + 0.47 * s, 0x111111, P2, 0, 0); tb.add(G.cone, 0.045 * s, 0.08 * s, 0.045 * s, x + ox * s, y + oy * s, z + 0.5 * s, 0xc8321e, P2, 0, 0); } }
  else { tb.box(0.18 * s, 0.2 * s, 0.55 * s, x, y, z, 0x3a3a36); tb.add(G.cyl16, 0.05 * s, 0.75 * s, 0.05 * s, x, y, z + 0.6 * s, 0x9adfff, P2, 0, 0); tb.add(G.sph, 0.08 * s, 0.08 * s, 0.08 * s, x, y, z + 0.98 * s, 0x66e0ff); for (let k = 0; k < 3; k++) tb.add(G.cyl16, 0.08 * s, 0.03 * s, 0.08 * s, x, y, z + (0.35 + k * 0.15) * s, T.acc, P2, 0, 0); }
}
function smallUnitGeo(d, T, s, B, tb) {
  if (d.pr === 'legs') { // armoured cyborg infantry: pelvis on the body, legs animated separately, torso turns with the weapon
    const hy = 1.25 * s, heavy = d.ch === 'hcyborg';
    B.box(0.6 * s, 0.26 * s, 0.38 * s, 0, hy, 0, T.dark); B.box(0.62 * s, 0.06 * s, 0.4 * s, 0, hy + 0.1 * s, 0, T.acc);
    const lg = new Builder(); lg.uvScale = 1.1; const lw = heavy ? 1.25 : 1;
    lg.box(0.22 * s * lw, 0.62 * s, 0.26 * s * lw, 0, -0.32 * s, 0, T.body); lg.add(G.sph, 0.15 * s * lw, 0.15 * s, 0.15 * s, 0, -0.64 * s, 0.06 * s, T.acc);
    lg.box(0.19 * s * lw, 0.58 * s, 0.24 * s * lw, 0, -0.93 * s, -0.02 * s, T.dark); lg.box(0.26 * s * lw, 0.12 * s, 0.42 * s, 0, -1.2 * s, 0.07 * s, 0x2a2a26);
    const tb2 = tb; const ty = hy + 0.1 * s;
    tb2.box(0.72 * s, 0.72 * s, 0.46 * s, 0, 0.38 * s, 0, T.body); tb2.camo(0.74 * s, 0.6 * s, 0.48 * s, 0, 0.36 * s, 0, 0, 4);
    tb2.box(0.6 * s, 0.32 * s, 0.1 * s, 0, 0.5 * s, 0.24 * s, T.dark); tb2.box(0.62 * s, 0.07 * s, 0.11 * s, 0, 0.34 * s, 0.25 * s, T.acc);
    tb2.box(0.5 * s, 0.55 * s, 0.26 * s, 0, 0.42 * s, -0.34 * s, 0x3a3f2c); tb2.add(G.cyl6, 0.02 * s, 0.6 * s, 0.02 * s, -0.18 * s, 0.95 * s, -0.4 * s, 0x222222);
    tb2.add(G.sph, 0.2 * s, 0.22 * s, 0.22 * s, 0, 0.92 * s, 0.02 * s, T.dark); tb2.box(0.28 * s, 0.07 * s, 0.1 * s, 0, 0.94 * s, 0.19 * s, 0x3fb0ff);
    for (const sx of [-1, 1]) { tb2.add(G.sph, (heavy ? 0.24 : 0.17) * s, 0.15 * s, (heavy ? 0.24 : 0.17) * s, sx * 0.44 * s, 0.7 * s, 0, heavy ? T.acc : T.dark);
      tb2.box(0.15 * s, 0.5 * s, 0.16 * s, sx * 0.44 * s, 0.4 * s, 0.1 * s, T.body, -0.6, 0, 0); }
    wpMini(tb2, d.wp, s * (heavy ? 1.25 : 1), T, 0.42 * s, 0.32 * s, 0.38 * s);
    return { body: B.build(), tur: tb2.build(), turY: ty, msl: null, legGeo: lg.build(), hips: [[-0.17 * s, hy, 0], [0.17 * s, hy, 0]] };
  }
  // quad-rotor drone
  const by = 0.45 * s;
  B.add(G.sph, 0.5 * s, 0.28 * s, 0.75 * s, 0, by, 0, T.body); B.add(G.sph, 0.42 * s, 0.1 * s, 0.6 * s, 0, by + 0.2 * s, -0.05 * s, T.dark);
  B.box(0.52 * s, 0.05 * s, 0.1 * s, 0, by + 0.05 * s, 0.68 * s, T.acc); B.box(0.2 * s, 0.06 * s, 0.05 * s, 0, by + 0.1 * s, 0.74 * s, 0x3fb0ff);
  const rot = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const x = sx * 0.95 * s, z = sz * 0.95 * s; const a = Math.atan2(x, z);
    B.box(0.09 * s, 0.07 * s, 1.25 * s, x / 2, by + 0.05 * s, z / 2, T.dark, 0, a, 0); B.add(G.cyl16, 0.12 * s, 0.2 * s, 0.12 * s, x, by + 0.1 * s, z, 0x2a2a2a);
    B.add(G.cyl16, 0.48 * s, 0.03 * s, 0.48 * s, x, by + 0.02 * s, z, T.acc); B.box(0.05 * s, 0.05 * s, 0.05 * s, x, by - 0.02 * s, z, sz > 0 ? 0x40ff60 : 0xff3020);
    rot.push([x, by + 0.24 * s, z]); }
  for (const sx of [-1, 1]) { B.box(0.04 * s, 0.35 * s, 0.04 * s, sx * 0.3 * s, by - 0.25 * s, 0, 0x333333); B.box(0.05 * s, 0.04 * s, 0.8 * s, sx * 0.3 * s, by - 0.42 * s, 0, 0x2a2a2a); }
  const bl = new Builder(); bl.box(0.95 * s, 0.015 * s, 0.09 * s, 0, 0, 0, 0x1a1a1a); bl.box(0.09 * s, 0.015 * s, 0.95 * s, 0, 0, 0, 0x1a1a1a); bl.add(G.cyl16, 0.06 * s, 0.05 * s, 0.06 * s, 0, 0.01 * s, 0, 0x8e8e88);
  tb.add(G.sph, 0.18 * s, 0.18 * s, 0.18 * s, 0, 0, 0.2 * s, 0x2a2a2a); tb.add(G.sph, 0.07 * s, 0.07 * s, 0.07 * s, 0, 0, 0.36 * s, 0x3fb0ff);
  wpMini(tb, d.wp, s, T, 0, -0.08 * s, 0.1 * s);
  return { body: B.build(), tur: tb.build(), turY: by - 0.22 * s, msl: null, rotors: rot, bladeGeo: bl.build() };
}
function unitGeo(d, team) {
  const key = d.ch + d.pr + d.wp + team; if (geoCache[key]) return geoCache[key];
  const hu = CH[d.ch].hue; const tn = (c, k) => new THREE.Color(c).lerp(new THREE.Color(hu), 0.65).multiplyScalar(k).getHex(); const tk = hu ? 1 : 1;
  const T = CH[d.ch].gold ? { ...TEAMC[team], body: 0xd4a832, dark: 0x5e4c1c } : hu ? { ...TEAMC[team], body: tn(TEAMC[team].body, 1), dark: tn(TEAMC[team].dark, 0.55) } : TEAMC[team], s = CH[d.ch].size, B = new Builder(), tb = new Builder(); B.uvScale = tb.uvScale = 1.1;
  if (d.pr === 'rotor' || d.pr === 'legs') return geoCache[key] = smallUnitGeo(d, T, s, B, tb);
  const L = 2.4 * s, W = 1.65 * s, H = (d.pr === 'tracks' || d.pr === 'halftrack' ? 0.6 : 0.72) * s; const PI2 = Math.PI / 2;
  let by, msl = null;
  const wheel = (r, wd, x, y, z, sx) => { // chunky off-road tyre: tread rings, deep rim, coloured hub
    B.add(G.cyl16, r, wd, r, x, y, z, 0x1b1a18, 0, 0, PI2);
    for (const o of [-0.36, 0, 0.36]) B.add(G.cyl16, r * 1.04, wd * 0.16, r * 1.04, x + o * wd, y, z, 0x262421, 0, 0, PI2);
    B.add(G.cyl16, r * 0.62, wd * 1.04, r * 0.62, x, y, z, 0x8e8e88, 0, 0, PI2);
    B.add(G.cyl16, r * 0.4, wd * 1.1, r * 0.4, x, y, z, T.acc, 0, 0, PI2);
    B.add(G.sph, r * 0.18, wd * 0.25, r * 0.18, x + sx * wd * 0.58, y, z, 0xcfcfc8, 0, 0, PI2);
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; B.box(0.04 * s, r * 0.08, r * 0.08, x + sx * wd * 0.54, y + Math.sin(a) * r * 0.5, z + Math.cos(a) * r * 0.5, 0x3a3a36); } };
  if (d.pr === 'wheels') {
    const r = 0.5 * s; by = r * 0.9 + H / 2 + 0.05; const xs = W / 2 + 0.08 * s;
    const zs = d.ch === 'light' || d.ch === 'scout' ? [-L * 0.32, L * 0.32] : [-L * 0.37, 0, L * 0.37];
    for (const z of zs) for (const sx of [-1, 1]) wheel(r, 0.36 * s, sx * xs, r, z, sx);
    for (const sx of [-1, 1]) { B.add(G.cyl16, 0.36 * s, L * 0.98, 0.2 * s, sx * (W / 2 - 0.02), by - H * 0.12, 0, T.dark, PI2, 0, 0); B.box(0.05 * s, 0.05 * s, L * 0.9, sx * (W / 2 + 0.15 * s), by - H * 0.02, 0, T.acc); } // fenders + stripe
  } else if (d.pr === 'halftrack') {
    const r = 0.46 * s, th = 0.56 * s, tr = th / 2; by = Math.max(r * 0.9, th * 0.78) + H / 2 + 0.03; const xs = W / 2 + 0.1 * s;
    for (const sx of [-1, 1]) {
      wheel(r, 0.34 * s, sx * xs, r, L * 0.34, sx);
      const x = sx * (W / 2 + 0.14 * s), z0 = -L * 0.16;
      B.box(0.46 * s, th, L * 0.5, x, tr, z0, 0x262421);
      B.add(G.cyl16, tr, 0.46 * s, tr, x, tr, z0 + L * 0.25, 0x262421, 0, 0, PI2); B.add(G.cyl16, tr, 0.46 * s, tr, x, tr, z0 - L * 0.25, 0x262421, 0, 0, PI2);
      for (let k = 0; k < 3; k++) B.add(G.cyl16, tr * 0.66, 0.5 * s, tr * 0.66, x, tr * 0.9, z0 - L * 0.17 + k * L * 0.17, 0x8e8e88, 0, 0, PI2);
      for (let k = 0; k < 9; k++) B.box(0.48 * s, 0.05 * s, 0.07 * s, x, th + 0.005, z0 - L * 0.24 + k * L * 0.06, 0x3a3833);
      B.add(G.cyl16, 0.3 * s, L * 0.98, 0.16 * s, x, Math.max(th, r * 1.6) * 0.9 + 0.02, 0, T.dark, PI2, 0, 0);
      B.box(0.05 * s, 0.05 * s, L * 0.9, sx * (W / 2 + 0.33 * s), by - H * 0.05, 0, T.acc);
    }
  } else if (d.pr === 'tracks') {
    const th = 0.62 * s, tr = th / 2; by = th * 0.75 + H / 2;
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 + 0.15 * s);
      B.box(0.5 * s, th, L * 0.86, x, tr, 0, 0x262421);
      B.add(G.cyl16, tr, 0.5 * s, tr, x, tr, L * 0.43, 0x262421, 0, 0, PI2); B.add(G.cyl16, tr, 0.5 * s, tr, x, tr, -L * 0.43, 0x262421, 0, 0, PI2);
      for (let k = 0; k < 5; k++) B.add(G.cyl16, tr * 0.62, 0.53 * s, tr * 0.62, x, tr * 0.9, -L * 0.36 + k * L * 0.18, 0x4a473f, 0, 0, PI2);
      B.add(G.cyl16, 0.3 * s, L * 0.98, 0.14 * s, x, th + 0.02, 0, T.dark, PI2, 0, 0); // rounded track guard
    }
  } else if (d.pr === 'vtol') { // gunship: swept wings, twin lift-jet nacelles, twin tail fins, landing struts
    by = 0.75 + H / 2;
    for (const sx of [-1, 1]) {
      B.box(W * 1.25, 0.09 * s, L * 0.36, sx * W * 0.95, by + H * 0.05, -L * 0.04, T.body, 0, sx * 0.18, 0); B.box(0.16 * s, 0.1 * s, L * 0.3, sx * W * 1.55, by + H * 0.05, -L * 0.1, T.acc);
      B.add(G.cyl16, 0.24 * s, L * 0.55, 0.24 * s, sx * W * 0.78, by - H * 0.05, -L * 0.04, T.dark, Math.PI / 2, 0, 0);
      B.add(G.cyl16, 0.26 * s, 0.08 * s, 0.26 * s, sx * W * 0.78, by - H * 0.05, L * 0.24, 0x8e8e88, Math.PI / 2, 0, 0);
      B.add(G.cyl16, 0.17 * s, 0.1 * s, 0.17 * s, sx * W * 0.78, by - H * 0.05, -L * 0.32, 0x1a1a1a, Math.PI / 2, 0, 0);
      B.box(0.07 * s, 0.6 * s, 0.45 * s, sx * W * 0.32, by + H * 0.6, -L * 0.42, T.dark, 0, 0, sx * 0.3);
      B.box(0.1 * s, 0.05 * s, 0.4 * s, sx * W * 0.34, by + H * 0.9, -L * 0.44, T.acc, 0, 0, sx * 0.3);
      B.add(G.cyl6, 0.04 * s, 0.7 * s, 0.04 * s, sx * W * 0.35, by - H / 2 - 0.3 * s, L * 0.2, 0x333333); B.add(G.cyl6, 0.04 * s, 0.7 * s, 0.04 * s, sx * W * 0.35, by - H / 2 - 0.3 * s, -L * 0.25, 0x333333);
      B.box(0.08 * s, 0.05 * s, L * 0.6, sx * W * 0.35, by - H / 2 - 0.62 * s, 0, 0x2a2a2a); }
    B.box(W * 0.5, 0.25 * s, L * 0.25, 0, by + H * 0.55, L * 0.22, 0x9fd3e6); // cockpit canopy
  } else {
    by = 0.6 + H / 2; B.add(G.cyl16, W * 0.78, 0.4, L * 0.6, 0, 0.32, 0, T.dark); B.add(G.cyl16, W * 0.82, 0.12, L * 0.63, 0, 0.14, 0, 0x2a2622);
  }
  // modern angular hull: sloped glacis, flat deck, angled rear
  B.add(G.hull, W * 0.98, H, L, 0, by, 0, T.body);
  B.add(G.hull, W * 0.7, H * 0.12, L * 0.5, 0, by + H * 0.5, -L * 0.18, T.dark); // engine deck
  for (let k = 0; k < 4; k++) B.box(W * 0.6, 0.03, 0.06 * s, 0, by + H * 0.57, -L * 0.36 + k * L * 0.07, 0x22241c); // grille slats
  B.box(W * 0.9, 0.05 * s, L * 0.02, 0, by + H * 0.1, L * 0.47, T.acc); // glacis team line
  if (d.pr !== 'vtol') { // ribbed armour: raised bands across the hull, pale trim along the upper edges
    const hi = new THREE.Color(T.body).multiplyScalar(1.22).getHex(), lo = new THREE.Color(T.body).multiplyScalar(0.72).getHex();
    for (let k = 0; k < 7; k++) { const z = -L * 0.4 + k * L * 0.125;
      for (const sx of [-1, 1]) { B.box(0.07 * s, H * 0.62, 0.11 * s, sx * W * 0.495, by + H * 0.02, z, hi); B.box(0.072 * s, H * 0.62, 0.03 * s, sx * W * 0.497, by + H * 0.02, z - 0.07 * s, lo); } }
    for (let k = 0; k < 3; k++) { const z = L * 0.09 + k * L * 0.1; B.box(W * 0.9, 0.06 * s, 0.11 * s, 0, by + H * 0.52, z, hi); B.box(W * 0.9, 0.065 * s, 0.03 * s, 0, by + H * 0.52, z - 0.07 * s, lo); }
    for (const sx of [-1, 1]) B.box(0.06 * s, 0.05 * s, L * 0.92, sx * W * 0.47, by + H * 0.5, 0, 0xd6d4c8); }
  if (d.pr === 'tracks') for (const sx of [-1, 1]) { // armoured side skirts
    const x = sx * (W / 2 + 0.36 * s);
    B.box(0.07 * s, H * 0.62, L * 0.92, x, by - H * 0.18, 0.02 * s, T.body, 0, 0, sx * 0.06);
    for (let k = 0; k < 5; k++) B.box(0.08 * s, H * 0.6, 0.03 * s, x, by - H * 0.18, -L * 0.37 + k * L * 0.185, T.dark);
    B.box(0.09 * s, 0.06 * s, L * 0.9, x, by + H * 0.12, 0, T.acc);
  }
  // body-specific shapes
  if (d.ch === 'scout') { B.box(W * 0.45, 0.06 * s, L * 0.22, 0, by + H * 0.52, L * 0.12, 0x9fd3e6); B.add(G.cyl6, 0.02, 0.9 * s, 0.02, W * 0.3, by + H + 0.4 * s, -L * 0.35, 0x222222); }
  if (d.ch === 'assault') {
    for (const sx of [-1, 1]) { B.box(0.08 * s, H * 0.8, L * 0.72, sx * (W * 0.5 + 0.03 * s), by + H * 0.05, 0.05 * s, T.dark, 0, 0, -sx * 0.28); for (let k = 0; k < 4; k++) B.add(G.sph, 0.04 * s, 0.04 * s, 0.04 * s, sx * (W * 0.53 + 0.03 * s), by + H * 0.1, -L * 0.25 + k * L * 0.17, 0x8a826e); }
    B.box(W * 0.92, 0.08 * s, L * 0.2, 0, by + H * 0.3, L * 0.42, T.dark, 0.6, 0, 0);
  }
  if (d.ch === 'titan') {
    B.add(G.hull, W * 1.04, H * 0.35, L * 0.86, 0, by + H * 0.55, -L * 0.04, T.dark);
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) B.box(0.14 * s, H * 0.5, L * 0.19, sx * (W * 0.5 + 0.1 * s), by + H * 0.02, -L * 0.31 + k * L * 0.21, T.body);
    B.box(W * 0.5, 0.22 * s, 0.25 * s, 0, by + H * 0.45, -L * 0.48, 0x2a2a2a);
  }
  if (d.ch === 'nova') {
    B.add(G.sph, W * 0.4, H * 0.42, L * 0.34, 0, by + H * 0.5, -L * 0.14, 0x22323c);
    for (const sx of [-1, 1]) { B.box(0.05 * s, 0.06 * s, L * 0.86, sx * W * 0.5, by + H * 0.18, 0, 0x66e0ff); B.add(G.cone, 0.13 * s, 0.4 * s, 0.13 * s, sx * W * 0.32, by, -L * 0.55, 0x66e0ff, -PI2, 0, 0); }
    B.box(W * 0.72, 0.06 * s, 0.05 * s, 0, by + H * 0.22, L * 0.5, 0x66e0ff);
  }
  if (d.wp !== 'truck' && d.ch !== 'nova') {
    for (const sx of [-1, 1]) B.box(0.22 * s, 0.26 * s, 0.14 * s, sx * W * 0.3, by + H * 0.55, -L * 0.47, 0x4a5a2a); // jerrycans
  }
  for (const sx of [-1, 1]) B.box(0.16 * s, 0.1 * s, 0.05 * s, sx * W * 0.36, by + H * 0.08, L * 0.5, 0xfff2c0); // LED headlights
  for (const sx of [-1, 1]) B.box(0.1 * s, 0.06 * s, 0.03 * s, sx * W * 0.38, by + H * 0.1, -L * 0.5, 0xff3020); // tail lights
  const top = by + H / 2 + 0.05;
  if (WP[d.wp].kind === 'bomb') { // bombs hung under the belly on a pylon
    const w = WP[d.wp], by2 = -H - 0.3 * s, n = w.big ? 1 : 3, r = (w.big ? 0.32 : 0.17) * s, len = (w.big ? 1.9 : 0.95) * s, col = w.fire ? 0xa83a26 : w.big ? 0x2e3236 : 0x3d432f;
    tb.box(W * 0.5, 0.12 * s, L * 0.5, 0, by2 + r + 0.08 * s, 0, T.dark);
    for (let i = 0; i < n; i++) { const x = n === 1 ? 0 : (i - 1) * 0.42 * s;
      tb.add(G.cyl16, r, len, r, x, by2, 0, col, Math.PI / 2, 0, 0); tb.add(G.sph, r, r, r * 1.6, x, by2, len / 2, col); tb.add(G.cone, r * 0.8, r * 1.6, r * 0.8, x, by2, -len / 2 - r * 0.7, col, -Math.PI / 2, 0, 0);
      for (const a of [0, Math.PI / 2]) tb.box(a ? 0.02 * s : r * 2.6, a ? r * 2.6 : 0.02 * s, 0.3 * s, x, by2, -len / 2 - r * 0.9, 0x3a3a36);
      tb.add(G.cyl16, r * 1.04, 0.08 * s, r * 1.04, x, by2, len * 0.2, w.fire ? 0xf0b44a : 0xc8321e, Math.PI / 2, 0, 0); }
  } else if (d.wp === 'mg') {
    tb.add(G.dome, 0.5 * s, 0.45 * s, 0.55 * s, 0, 0.02, 0, T.body); tb.add(G.cyl16, 0.52 * s, 0.08, 0.57 * s, 0, 0.05, 0, T.acc);
    tb.add(G.sph, 0.18 * s, 0.18 * s, 0.18 * s, 0, 0.3 * s, 0.45 * s, T.dark);
    for (const sx of [-1, 1]) tb.add(G.cyl16, 0.06 * s, 1.1 * s, 0.06 * s, sx * 0.12 * s, 0.28 * s, 0.95 * s, 0x1a1a1a, PI2, 0, 0);
  } else if (d.wp === 'cannon') {
    const KX = 1.32, KY = 1.22, KZ = 1.12; // larger, wider turret; barrels keep their round section
    const TC = { box: (w, h, dd, x, y, z, c, rx, ry, rz) => tb.box(w * KX, h * KY, dd * KZ, x * KX, y * KY, z * KZ, c, rx, ry, rz),
      add: (g, w, h, dd, x, y, z, c, rx, ry, rz) => rx || ry || rz ? tb.add(g, w * 1.15, h * KZ, dd * 1.15, x * KX, y * KY, z * KZ, c, rx, ry, rz) : tb.add(g, w * KX, h * KY, dd * KZ, x * KX, y * KY, z * KZ, c, rx, ry, rz) };
    // modern MBT turret: arrow-shaped wedge armour, bustle, long smoothbore gun
    tb.add(G.cyl16, 0.95 * s, 0.14 * s, 0.95 * s, 0, 0.0, -0.1 * s, T.dark); // heavy turret ring
    for (const sx of [-1, 1]) { // bolted side armour modules and stowage boxes
      TC.box(0.16 * s, 0.36 * s, 1.5 * s, sx * 0.72 * s, 0.2 * s, -0.25 * s, T.body, 0, 0, sx * 0.12);
      for (let k = 0; k < 4; k++) TC.box(0.17 * s, 0.32 * s, 0.03 * s, sx * 0.72 * s, 0.2 * s, -0.85 * s + k * 0.4 * s, T.dark, 0, 0, sx * 0.12);
      TC.box(0.22 * s, 0.2 * s, 0.5 * s, sx * 0.62 * s, 0.32 * s, -1.0 * s, 0x4a5a2a); }
    TC.box(0.62 * s, 0.42 * s, 0.34 * s, 0, 0.22 * s, 0.9 * s, T.dark); // massive gun mantlet
    TC.box(0.66 * s, 0.06 * s, 0.36 * s, 0, 0.45 * s, 0.9 * s, T.acc);
    TC.add(G.wedge, 1.38 * s, 0.4 * s, 1.8 * s, 0, 0.02, -0.05 * s, T.body);
    TC.add(G.wedge, 1.0 * s, 0.06 * s, 1.3 * s, 0, 0.44 * s, -0.12 * s, T.dark); // roof plate
    TC.box(1.0 * s, 0.32 * s, 0.55 * s, 0, 0.2 * s, -1.05 * s, T.body); // bustle
    for (let k = 0; k < 3; k++) TC.box(1.08 * s, 0.03 * s, 0.03 * s, 0, 0.22 * s + k * 0.08 * s, -1.35 * s, 0x2a2a2a); // bustle rack
    TC.box(1.27 * s, 0.05 * s, 0.9 * s, 0, 0.3 * s, -0.1 * s, T.acc); // team band
    // gun: mantlet, barrel with thermal sleeve, fume extractor, muzzle reference
    TC.box(0.42 * s, 0.3 * s, 0.25 * s, 0, 0.22 * s, 0.86 * s, T.dark);
    TC.add(G.cyl16, 0.085 * s, 2.6 * s, 0.085 * s, 0, 0.24 * s, 2.25 * s, 0x2e3128, Math.PI / 2, 0, 0);
    TC.add(G.cyl16, 0.11 * s, 0.7 * s, 0.11 * s, 0, 0.24 * s, 1.35 * s, T.dark, Math.PI / 2, 0, 0);
    TC.add(G.cyl16, 0.14 * s, 0.32 * s, 0.14 * s, 0, 0.24 * s, 2.0 * s, T.dark, Math.PI / 2, 0, 0);
    TC.add(G.cyl16, 0.1 * s, 0.6 * s, 0.1 * s, 0, 0.24 * s, 2.6 * s, T.dark, Math.PI / 2, 0, 0);
    TC.add(G.cyl16, 0.1 * s, 0.12 * s, 0.1 * s, 0, 0.24 * s, 3.5 * s, 0x1a1a1a, Math.PI / 2, 0, 0);
    TC.box(0.08 * s, 0.07 * s, 0.1 * s, 0, 0.35 * s, 3.45 * s, 0x1a1a1a);
    // sights, cupola, smoke dischargers, antenna
    TC.box(0.26 * s, 0.22 * s, 0.24 * s, 0.32 * s, 0.58 * s, -0.2 * s, T.dark); TC.box(0.2 * s, 0.12 * s, 0.03 * s, 0.32 * s, 0.6 * s, -0.07 * s, 0x3fb0ff);
    TC.box(0.24 * s, 0.18 * s, 0.22 * s, -0.36 * s, 0.53 * s, 0.25 * s, T.dark); TC.box(0.18 * s, 0.1 * s, 0.03 * s, -0.36 * s, 0.55 * s, 0.37 * s, 0x3fb0ff);
    TC.add(G.cyl16, 0.18 * s, 0.1 * s, 0.18 * s, -0.25 * s, 0.49 * s, -0.45 * s, T.dark);
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) TC.add(G.cyl10, 0.045 * s, 0.22 * s, 0.045 * s, sx * 0.6 * s, 0.32 * s + k * 0.07 * s, 0.1 * s, 0x2a2a2a, Math.PI / 2 - 0.5, sx * 0.5, 0);
    TC.add(G.cyl6, 0.02, 1.3 * s, 0.02, -0.45 * s, 0.95 * s, -0.8 * s, 0x222222, -0.12, 0, 0);
  } else if (d.wp === 'viper') { // pivot block with two side arms, each carrying a pair of long missiles
    tb.add(G.cyl16, 0.45 * s, 0.14 * s, 0.45 * s, 0, 0.07 * s, 0, T.dark); tb.add(G.cyl16, 0.47 * s, 0.04 * s, 0.47 * s, 0, 0.15 * s, 0, T.acc);
    tb.box(0.55 * s, 0.42 * s, 0.75 * s, 0, 0.38 * s, -0.05 * s, T.body); tb.camo(0.57 * s, 0.42 * s, 0.75 * s, 0, 0.38 * s, -0.05 * s, 0, 5); tb.box(0.5 * s, 0.1 * s, 0.6 * s, 0, 0.62 * s, -0.1 * s, T.dark);
    tb.hazard(0.55 * s, 0.1 * s, 0, 0.3 * s, 0.33 * s, 'z', 1); tb.box(0.16 * s, 0.08 * s, 0.03 * s, 0.12 * s, 0.5 * s, 0.33 * s, 0x3fb0ff);
    const a = 0.22, ca = Math.cos(a), sa = Math.sin(a);
    for (const sx of [-1, 1]) { const ax = sx * 0.62 * s;
      tb.box(0.36 * s, 0.1 * s, 0.14 * s, sx * 0.4 * s, 0.48 * s, 0, T.acc);                       // arm
      tb.box(0.42 * s, 0.08 * s, 1.5 * s, ax, 0.5 * s + 0.1 * s * sa, 0.15 * s, T.body, -a, 0, 0); tb.camo(0.42 * s, 0.1 * s, 1.5 * s, ax, 0.5 * s + 0.1 * s * sa, 0.15 * s, -a, 4);   // rail
      tb.hazard(0.42 * s, 0.06 * s, ax, 0.45 * s - 0.6 * s * sa, 0.15 * s - 0.6 * s * ca, 'z', -1);
      for (const ox of [-0.11, 0.11]) { const x = ax + ox * s, y = 0.62 * s, z = 0.12 * s, L = 1.7 * s;
        tb.add(G.cyl16, 0.085 * s, L, 0.085 * s, x, y + sa * 0.05 * s, z, 0xe8e8e8, Math.PI / 2 - a, 0, 0);
        tb.add(G.cone, 0.085 * s, 0.3 * s, 0.085 * s, x, y + sa * (L / 2 + 0.15 * s), z + ca * (L / 2 + 0.15 * s), 0xc8321e, Math.PI / 2 - a, 0, 0);
        tb.add(G.cyl16, 0.09 * s, 0.12 * s, 0.09 * s, x, y + sa * L * 0.25, z + ca * L * 0.25, 0xc8321e, Math.PI / 2 - a, 0, 0);
        for (const fx of [-1, 1]) tb.box(0.012 * s, 0.2 * s, 0.22 * s, x + fx * 0.06 * s, y - sa * L * 0.42 + 0.06 * s, z - ca * L * 0.42, 0x3a3a36, -a, 0, 0); } }
  } else if (d.wp === 'rockets') {
    tb.add(G.dome, 0.42 * s, 0.35 * s, 0.42 * s, 0, 0.02, 0, T.dark);
    for (const sx of [-1, 1]) {
      tb.add(G.cyl16, 0.33 * s, 1.1 * s, 0.33 * s, sx * 0.42 * s, 0.5 * s, 0.1 * s, T.body, PI2 - 0.25, 0, 0);
      tb.add(G.cyl16, 0.35 * s, 0.1 * s, 0.35 * s, sx * 0.42 * s, 0.37 * s, 0.6 * s, T.acc, PI2 - 0.25, 0, 0);
      for (const ox of [-0.12, 0.12]) for (const oy of [-0.12, 0.12]) tb.add(G.cyl6, 0.08 * s, 0.1, 0.08 * s, sx * 0.42 * s + ox * s, 0.5 * s + oy * s + 0.15 * s, 0.67 * s, 0x111111, PI2 - 0.25, 0, 0);
    }
  } else if (WP[d.wp].art && d.wp !== 'mortar') {
    const w = WP[d.wp], A = w.art; const tint = w.fire ? 0xb8432c : w.emp ? 0x3f9fe0 : w.plasma ? 0x2eaa4a : T.body;
    if (A === 'mortar') {
      tb.add(G.cyl16, 0.55 * s, 0.12 * s, 0.55 * s, 0, 0.06 * s, 0, 0x5a564f); tb.add(G.cyl16, 0.57 * s, 0.05 * s, 0.57 * s, 0, 0.14 * s, 0, T.acc); tb.box(1.0 * s, 0.32 * s, 0.34 * s, 0, 0.3 * s, -0.5 * s, 0x6f7a52); tb.camo(1.0 * s, 0.34 * s, 0.34 * s, 0, 0.3 * s, -0.5 * s, 0, 4); for (const sx of [-1, 1]) { tb.box(0.3 * s, 0.3 * s, 0.7 * s, sx * 0.55 * s, 0.25 * s, -0.1 * s, 0x6f7a52); tb.camo(0.3 * s, 0.32 * s, 0.7 * s, sx * 0.55 * s, 0.25 * s, -0.1 * s, 0, 3); }
      tb.add(G.cyl16, 0.17 * s, 1.1 * s, 0.17 * s, 0, 0.6 * s, 0.2 * s, 0x34342e, 0.75, 0, 0); for (let k = 0; k < 2; k++) tb.add(G.cyl16, 0.2 * s, 0.08 * s, 0.2 * s, 0, (0.45 + k * 0.3) * s, (0.08 + k * 0.28) * s, tint, 0.75, 0, 0);
      if (w.emp) for (const sx of [-1, 1]) tb.add(G.sph, 0.12 * s, 0.12 * s, 0.12 * s, sx * 0.4 * s, 0.3 * s, -0.3 * s, 0x66e0ff);
      else tb.box(0.6 * s, 0.3 * s, 0.35 * s, 0, 0.25 * s, -0.4 * s, w.fire ? 0xa83a26 : 0x6a5a3a);
    } else if (A === 'salvo') {
      tb.add(G.cyl16, 0.5 * s, 0.15 * s, 0.5 * s, 0, 0.08 * s, 0, T.dark);
      const tube = (x, y, z, r, L, a, c) => tb.add(G.cyl16, r, L, r, x, y, z, c, Math.PI / 2 - a, 0, 0);
      if (d.wp === 'rbattery') { // three grey launcher blocks side by side, 3x3 tubes each, on a heavy cradle
        const a = 0.6, ca = Math.cos(a), sa = Math.sin(a), P = (x, y, z) => [x, 0.85 * s + y * ca + z * sa, 0.0 * s - y * sa + z * ca];
        tb.box(1.3 * s, 0.5 * s, 0.9 * s, 0, 0.35 * s, -0.25 * s, T.dark); tb.hazard(1.3 * s, 0.14 * s, 0, 0.3 * s, 0.205 * s, 'z', 1);
        for (const sx of [-1, 1]) tb.box(0.12 * s, 0.8 * s, 0.5 * s, sx * 0.55 * s, 0.6 * s, -0.1 * s, 0x4a4a46);
        for (let b = -1; b <= 1; b++) { const ox = b * 0.5 * s;
          { const [x, y, z] = P(ox, 0, 0); tb.box(0.46 * s, 0.5 * s, 1.5 * s, x, y, z, 0x6f7a52, -a, 0, 0); tb.camo(0.46 * s, 0.52 * s, 1.5 * s, x, y, z, -a, 5); }
          { const [x, y, z] = P(ox, 0, -0.55 * s); tb.box(0.48 * s, 0.52 * s, 0.1 * s, x, y, z, T.acc, -a, 0, 0); } { const [x, y, z] = P(ox, 0.26 * s, 0.3 * s); tb.box(0.47 * s, 0.03 * s, 0.25 * s, x, y, z, T.acc, -a, 0, 0); }
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const [x, y, z] = P(ox + (i - 1) * 0.13 * s, (j - 1) * 0.13 * s, 0.76 * s); tb.add(G.cyl10, 0.055 * s, 0.04 * s, 0.055 * s, x, y, z, 0x111111, Math.PI / 2 - a, 0, 0); } }
      } else if (d.wp === 'smissile') { // camouflaged launch box: 2x2 canisters, seeker tips peeking out of the openings
        const a = 0.45, ca = Math.cos(a), sa = Math.sin(a), P = (x, y, z) => [x, 0.78 * s + y * ca + z * sa, 0.05 * s - y * sa + z * ca];
        tb.box(1.0 * s, 0.45 * s, 0.8 * s, 0, 0.3 * s, -0.25 * s, 0x5f6a48); tb.camo(1.0 * s, 0.47 * s, 0.8 * s, 0, 0.3 * s, -0.25 * s, 0, 5); tb.hazard(1.0 * s, 0.12 * s, 0, 0.26 * s, 0.155 * s, 'z', 1);
        for (const sx of [-1, 1]) tb.box(0.1 * s, 0.7 * s, 0.4 * s, sx * 0.5 * s, 0.55 * s, -0.15 * s, 0x3a3a36);
        { const [x, y, z] = P(0, 0, 0); tb.box(1.0 * s, 0.86 * s, 2.0 * s, x, y, z, 0x6f7a52, -a, 0, 0); tb.camo(1.0 * s, 0.88 * s, 2.0 * s, x, y, z, -a, 8); }
        { const [x, y, z] = P(0, 0.45 * s, -0.2 * s); tb.box(0.7 * s, 0.06 * s, 0.9 * s, x, y, z, 0x4f5f3c, -a, 0, 0); }                 // top hatch
        for (const zz of [-0.6, 0.6]) { const [x, y, z] = P(0, 0, zz * s); tb.box(1.04 * s, 0.9 * s, 0.1 * s, x, y, z, T.acc, -a, 0, 0); } // reinforcing ribs in team colour
        { const [x, y, z] = P(0, 0, 1.0 * s); tb.box(1.0 * s, 0.86 * s, 0.04 * s, x, y, z, 0x2e3328, -a, 0, 0); }                         // front face
        for (const ox of [-0.24, 0.24]) for (const oy of [-0.2, 0.2]) { const [x, y, z] = P(ox * s, oy * s, 1.02 * s); tb.add(G.cyl16, 0.15 * s, 0.05 * s, 0.15 * s, x, y, z, 0x111111, Math.PI / 2 - a, 0, 0);
          const [x2, y2, z2] = P(ox * s, oy * s, 1.0 * s); tb.add(G.cone, 0.09 * s, 0.22 * s, 0.09 * s, x2, y2, z2, 0x3f9fe0, Math.PI / 2 - a, 0, 0); }
      } else if (d.wp === 'omissile') { // one huge missile sealed in a camouflaged canister on an erector
        const a = 0.95, L = 3.6 * s, ca = Math.cos(a), sa = Math.sin(a);
        tb.box(1.3 * s, 0.4 * s, 1.3 * s, 0, 0.25 * s, 0, 0x5f6a48); tb.camo(1.3 * s, 0.42 * s, 1.3 * s, 0, 0.25 * s, 0, 0, 6); tb.hazard(1.3 * s, 0.14 * s, 0, 0.25 * s, 0.655 * s, 'z', 1);
        for (const sx of [-1, 1]) { tb.box(0.16 * s, 0.9 * s, 0.5 * s, sx * 0.62 * s, 0.75 * s, -0.35 * s, 0x3a3a36); tb.add(G.cyl10, 0.06 * s, 1.4 * s, 0.06 * s, sx * 0.3 * s, 0.9 * s, -0.1 * s, 0xb8b8b0, 0.7, 0, 0); }
        const c0 = [0, 0.75 * s + sa * L * 0.42, -0.35 * s + ca * L * 0.42];
        tb.box(1.0 * s, 1.0 * s, L, c0[0], c0[1], c0[2], 0x6f7a52, -a, 0, 0); tb.camo(1.0 * s, 1.02 * s, L, c0[0], c0[1], c0[2], -a, 10);
        for (const k of [-0.38, 0, 0.38]) tb.box(1.06 * s, 1.06 * s, 0.14 * s, c0[0], c0[1] + sa * L * k, c0[2] + ca * L * k, T.acc, -a, 0, 0);       // canister rings in team colour
        { const k = 0.505; tb.box(0.9 * s, 0.9 * s, 0.05 * s, c0[0], c0[1] + sa * L * k, c0[2] + ca * L * k, 0x2e3328, -a, 0, 0); tb.add(G.cyl16, 0.32 * s, 0.07 * s, 0.32 * s, c0[0], c0[1] + sa * L * (k + 0.01), c0[2] + ca * L * (k + 0.01), 0xc8321e, Math.PI / 2 - a, 0, 0); } // front cap
        msl = { kind: 'orizont', x: c0[0], y: c0[1], z: c0[2], a, len: L * 0.92 };
      } else if (w.big) { tb.box(0.25 * s, 0.9 * s, 0.25 * s, 0.35 * s, 0.5 * s, -0.2 * s, 0x5a564f); tb.box(0.5 * s, 0.12 * s, 2.0 * s, 0, 0.45 * s, 0.05 * s, 0x3a3a36, -0.62, 0, 0); msl = { kind: 'ballistic', x: 0, y: 0.8 * s, z: 0.15 * s, a: 0.62, len: 2.45 * s }; }
      else { // big armoured rocket pod: 4x3 tubes with red warheads
        const a = 0.55, ca = Math.cos(a), sa = Math.sin(a), P = (x, y, z) => [x, 0.75 * s + y * ca + z * sa, 0.05 * s - y * sa + z * ca];
        tb.box(0.35 * s, 0.6 * s, 0.4 * s, 0, 0.35 * s, -0.1 * s, T.dark);
        tb.box(0.9 * s, 0.22 * s, 0.7 * s, 0, 0.2 * s, -0.1 * s, T.body); tb.hazard(0.9 * s, 0.1 * s, 0, 0.2 * s, 0.255 * s, 'z', 1);
        { const [x, y, z] = P(0, 0, 0); tb.box(1.2 * s, 0.82 * s, 1.5 * s, x, y, z, T.body, -a, 0, 0); tb.camo(1.2 * s, 0.84 * s, 1.5 * s, x, y, z, -a); }
        for (const zz of [-0.45, 0.45]) { const [x, y, z] = P(0, 0, zz * s); tb.box(1.26 * s, 0.86 * s, 0.12 * s, x, y, z, T.acc, -a, 0, 0); }
        for (const sx of [-1, 1]) { const [x, y, z] = P(sx * 0.62 * s, 0, 0); tb.box(0.06 * s, 0.9 * s, 1.56 * s, x, y, z, T.dark, -a, 0, 0); }
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const ox = (i - 1.5) * 0.26 * s, oy = (j - 1) * 0.24 * s;
          { const [x, y, z] = P(ox, oy, 0.76 * s); tb.add(G.cyl10, 0.1 * s, 0.06 * s, 0.1 * s, x, y, z, 0x111111, Math.PI / 2 - a, 0, 0); }
          { const [x, y, z] = P(ox, oy, 0.72 * s); tb.add(G.sph, 0.07 * s, 0.07 * s, 0.07 * s, x, y, z, 0xc8321e); } }
      }
    } else if (d.wp === 'hhowitzer') { // three long barrels on a big armoured cradle, splinter camouflage
      const ang = 0.5, Lb = 3.1 * s, rr = 0.12 * s, CAMO = [0x8fa284, 0xcdbf92, 0x5e7058, 0x9ab6b8];
      const along = (k, ox) => [ox, 0.62 * s + Math.sin(ang) * Lb * k, 0.05 * s + Math.cos(ang) * Lb * k];
      tb.add(G.cyl16, 0.7 * s, 0.16 * s, 0.7 * s, 0, 0.08 * s, 0, 0x4a4a46); tb.add(G.cyl16, 0.72 * s, 0.05 * s, 0.72 * s, 0, 0.17 * s, 0, T.acc);
      tb.box(1.25 * s, 0.75 * s, 1.1 * s, 0, 0.55 * s, -0.05 * s, CAMO[0], -0.18, 0, 0);
      for (const sx of [-1, 1]) { tb.box(0.1 * s, 0.85 * s, 1.2 * s, sx * 0.66 * s, 0.6 * s, 0, CAMO[2], -0.18, 0, 0); tb.add(G.cyl16, 0.2 * s, 0.14 * s, 0.2 * s, sx * 0.72 * s, 0.62 * s, 0.05 * s, 0x3a3a36, 0, 0, Math.PI / 2); }
      for (let i = 0; i < 9; i++) { const c = CAMO[i % 4]; tb.add(G.sph, 0.22 * s, 0.05 * s, 0.18 * s, (i % 3 - 1) * 0.42 * s, 0.4 * s + (i % 2) * 0.32 * s, (i / 9 - 0.5) * 0.9 * s, c, 0, i, 0); }
      for (const ox of [-0.3, 0, 0.3]) {
        const [x0, y0, z0] = along(0.5, ox * s); tb.add(G.cyl16, rr, Lb, rr, x0, y0, z0, 0x3a4436, Math.PI / 2 - ang, 0, 0);
        const [x1, y1, z1] = along(0.18, ox * s); tb.add(G.cyl16, rr * 1.65, Lb * 0.3, rr * 1.65, x1, y1, z1, T.acc, Math.PI / 2 - ang, 0, 0);
        for (const k of [0.45, 0.68]) { const [xc, yc, zc] = along(k, ox * s); tb.add(G.cyl16, rr * 1.2, 0.12 * s, rr * 1.2, xc, yc, zc, CAMO[(k * 10 | 0) % 4], Math.PI / 2 - ang, 0, 0); }
        const [x2, y2, z2] = along(1.0, ox * s); tb.add(G.cyl16, rr * 1.5, 0.28 * s, rr * 1.5, x2, y2, z2, 0x2a2a26, Math.PI / 2 - ang, 0, 0);
        const [x3, y3, z3] = along(0.3, ox * s); tb.add(G.cyl10, rr * 0.45, Lb * 0.35, rr * 0.45, x3, y3 - 0.2 * s, z3, 0xb8b8b0, Math.PI / 2 - ang, 0, 0); // recoil cylinder
      }
      tb.box(1.0 * s, 0.4 * s, 0.6 * s, 0, 0.45 * s, -0.75 * s, 0x5a5a3a); for (let k = 0; k < 4; k++) tb.add(G.cyl10, 0.07 * s, 0.4 * s, 0.07 * s, -0.3 * s + k * 0.2 * s, 0.75 * s, -0.75 * s, 0xc9a23a);
      tb.add(G.cyl6, 0.02, 1.0 * s, 0.02, 0.55 * s, 1.3 * s, -0.5 * s, 0x222222);
    } else {
      // enclosed armoured gun house, long barrel with bore evacuator and muzzle brake, warning stripes
      const L = (w.big ? 2.7 : 2.2) * s, rr = (w.big ? 0.14 : 0.1) * s, ang = 0.5, ca = Math.cos(ang), sa = Math.sin(ang);
      const py = 0.6 * s, pz = 0.5 * s, along = (k, ox) => [ox, py + sa * L * k, pz + ca * L * k], R = Math.PI / 2 - ang;
      tb.add(G.cyl16, 0.6 * s, 0.14 * s, 0.6 * s, 0, 0.07 * s, 0, T.dark); tb.add(G.cyl16, 0.62 * s, 0.04 * s, 0.62 * s, 0, 0.15 * s, 0, T.acc);
      tb.box(1.0 * s, 0.5 * s, 1.15 * s, 0, 0.42 * s, -0.1 * s, T.body); tb.camo(1.02 * s, 0.5 * s, 1.15 * s, 0, 0.42 * s, -0.1 * s, 0, 7);                       // gun house
      tb.box(1.0 * s, 0.34 * s, 0.4 * s, 0, 0.5 * s, 0.52 * s, T.body, -0.55, 0, 0); tb.camo(1.0 * s, 0.36 * s, 0.4 * s, 0, 0.5 * s, 0.52 * s, -0.55, 3);            // sloped glacis
      tb.box(0.94 * s, 0.08 * s, 1.1 * s, 0, 0.7 * s, -0.12 * s, T.dark); tb.box(1.04 * s, 0.07 * s, 1.2 * s, 0, 0.66 * s, -0.1 * s, T.acc);                       // roof + team band
      tb.add(G.cyl16, 0.16 * s, 0.1 * s, 0.16 * s, 0.25 * s, 0.78 * s, -0.35 * s, T.dark); tb.box(0.14 * s, 0.08 * s, 0.03 * s, -0.3 * s, 0.6 * s, 0.38 * s, 0x3fb0ff);
      tb.hazard(1.0 * s, 0.18 * s, 0, 0.26 * s, 0.47 * s, 'z', 1);
      for (const sx of [-1, 1]) tb.hazard(1.0 * s, 0.16 * s, sx * 0.505 * s, 0.24 * s, -0.1 * s, 'x', sx);
      tb.box(0.42 * s, 0.36 * s, 0.24 * s, 0, py, pz + 0.04 * s, T.dark, -ang * 0.5, 0, 0);       // mantlet
      const tubes = d.wp === 'rhowitzer' ? [-0.13, 0.13] : [0];
      for (const ox of tubes) { const o = ox * s;
        { const [x, y, z] = along(0.5, o); tb.add(G.cyl16, rr, L, rr, x, y, z, w.plasma ? 0x3a3a40 : 0x2e2e2a, R, 0, 0); }
        { const [x, y, z] = along(0.16, o); tb.add(G.cyl16, rr * 1.55, L * 0.28, rr * 1.55, x, y, z, tint, R, 0, 0); }
        { const [x, y, z] = along(0.6, o); tb.add(G.cyl16, rr * 1.45, L * 0.12, rr * 1.45, x, y, z, 0x3a3a36, R, 0, 0); }   // bore evacuator
        { const [x, y, z] = along(0.98, o); tb.box(rr * 3.2, rr * 2.2, L * 0.1, x, y, z, 0x262622, -ang, 0, 0); }          // muzzle brake
        { const [x, y, z] = along(0.98, o); for (const sx of [-1, 1]) tb.box(0.012 * s, rr * 1.6, L * 0.05, x + sx * rr * 1.62, y, z, 0x111111, -ang, 0, 0); } }
      if (w.plasma) for (let k = 1; k <= 3; k++) { const [x, y, z] = along(k * 0.22, 0); tb.add(G.cyl16, rr * 1.8, 0.08 * s, rr * 1.8, x, y, z, 0x60ff90, R, 0, 0); }
      for (const sx of [-1, 1]) tb.box(0.12 * s, 0.26 * s, 0.5 * s, sx * 0.58 * s, 0.4 * s, -0.3 * s, 0x5a5a3a);                       // side stowage
      tb.box(0.8 * s, 0.22 * s, 0.25 * s, 0, 0.35 * s, -0.8 * s, 0x6a5a3a);
      tb.add(G.cyl6, 0.02, 1.0 * s, 0.02, -0.4 * s, 1.2 * s, -0.55 * s, 0x222222);
    }
  } else if (d.wp === 'mortar') {
    tb.add(G.cyl16, 0.55 * s, 0.12 * s, 0.55 * s, 0, 0.06 * s, 0, 0x5a564f); tb.add(G.cyl16, 0.57 * s, 0.05 * s, 0.57 * s, 0, 0.14 * s, 0, T.acc); tb.box(1.0 * s, 0.32 * s, 0.34 * s, 0, 0.3 * s, -0.5 * s, 0x6f7a52); tb.camo(1.0 * s, 0.34 * s, 0.34 * s, 0, 0.3 * s, -0.5 * s, 0, 4); for (const sx of [-1, 1]) { tb.box(0.3 * s, 0.3 * s, 0.7 * s, sx * 0.55 * s, 0.25 * s, -0.1 * s, 0x6f7a52); tb.camo(0.3 * s, 0.32 * s, 0.7 * s, sx * 0.55 * s, 0.25 * s, -0.1 * s, 0, 3); }
    tb.add(G.cyl16, 0.17 * s, 1.1 * s, 0.17 * s, 0, 0.6 * s, 0.2 * s, 0x34342e, 0.75, 0, 0); tb.add(G.cyl16, 0.2 * s, 0.12 * s, 0.2 * s, 0, 1.0 * s, 0.55 * s, 0x2a2a26, 0.75, 0, 0);
    for (const sx of [-1, 1]) tb.add(G.cyl6, 0.04 * s, 0.7 * s, 0.04 * s, sx * 0.25 * s, 0.35 * s, 0.35 * s, 0x3a3a36, -0.5, 0, sx * 0.3);
    tb.box(0.3 * s, 0.25 * s, 0.3 * s, 0.35 * s, 0.25 * s, -0.3 * s, 0x6a5a3a); tb.box(0.3 * s, 0.25 * s, 0.3 * s, -0.35 * s, 0.25 * s, -0.3 * s, 0x6a5a3a);
  } else if (d.wp === 'flame') {
    tb.add(G.dome, 0.5 * s, 0.38 * s, 0.55 * s, 0, 0.02, 0, T.body); tb.add(G.cyl16, 0.52 * s, 0.06 * s, 0.57 * s, 0, 0.05, 0, T.acc);
    for (const sx of [-1, 1]) { tb.add(G.cyl16, 0.17 * s, 0.75 * s, 0.17 * s, sx * 0.22 * s, 0.35 * s, -0.55 * s, 0xa83a26, Math.PI / 2, 0, 0); tb.add(G.sph, 0.17 * s, 0.17 * s, 0.17 * s, sx * 0.22 * s, 0.35 * s, -0.18 * s, 0xa83a26); }
    tb.add(G.cyl16, 0.09 * s, 1.0 * s, 0.09 * s, 0, 0.28 * s, 0.75 * s, 0x2e2e2a, Math.PI / 2, 0, 0);
    tb.add(G.cyl16, 0.14 * s, 0.25 * s, 0.14 * s, 0, 0.28 * s, 1.3 * s, 0x3a3a36, Math.PI / 2, 0, 0);
    tb.add(G.sph, 0.06 * s, 0.06 * s, 0.06 * s, 0, 0.2 * s, 1.45 * s, 0xff9a20);
  } else if (d.wp === 'laser') {
    tb.add(G.dome, 0.58 * s, 0.42 * s, 0.62 * s, 0, 0.02, -0.12 * s, T.body); tb.add(G.cyl16, 0.6 * s, 0.06 * s, 0.64 * s, 0, 0.05, -0.12 * s, T.acc);
    tb.add(G.cyl16, 0.1 * s, 2.0 * s, 0.1 * s, 0, 0.3 * s, 1.15 * s, 0x34343a, Math.PI / 2, 0, 0);
    for (let k = 0; k < 3; k++) tb.add(G.cyl16, 0.16 * s, 0.08 * s, 0.16 * s, 0, 0.3 * s, 0.55 * s + k * 0.45 * s, 0xffd84a, Math.PI / 2, 0, 0);
    tb.add(G.sph, 0.13 * s, 0.13 * s, 0.13 * s, 0, 0.3 * s, 2.15 * s, 0xfff2a0);
    for (const sx of [-1, 1]) { tb.box(0.18 * s, 0.24 * s, 0.5 * s, sx * 0.5 * s, 0.22 * s, -0.25 * s, T.dark); tb.box(0.04 * s, 0.16 * s, 0.4 * s, sx * 0.6 * s, 0.22 * s, -0.25 * s, 0x66e0ff); }
  } else if (d.wp === 'radar') {
    tb.add(G.cyl16, 0.42 * s, 0.22 * s, 0.42 * s, 0, 0.11 * s, 0, T.dark); tb.add(G.cyl16, 0.44 * s, 0.05 * s, 0.44 * s, 0, 0.22 * s, 0, T.acc);
    tb.add(G.cyl10, 0.07 * s, 0.9 * s, 0.07 * s, 0, 0.65 * s, 0, 0x3a3a36);
    tb.box(1.3 * s, 0.6 * s, 0.1 * s, 0, 1.2 * s, 0.05 * s, 0x3d4a52, -0.3, 0, 0); // phased-array panel
    tb.box(1.18 * s, 0.5 * s, 0.04 * s, 0, 1.2 * s, 0.11 * s, 0x6fa8c8, -0.3, 0, 0);
    for (let k = -2; k <= 2; k++) tb.box(0.02 * s, 0.5 * s, 0.05 * s, k * 0.22 * s, 1.2 * s, 0.12 * s, 0x2a3a44, -0.3, 0, 0);
    tb.box(0.2 * s, 0.2 * s, 0.25 * s, 0, 1.15 * s, -0.12 * s, T.dark);
    tb.add(G.sph, 0.07 * s, 0.07 * s, 0.07 * s, 0.6 * s, 1.5 * s, 0.0, 0xff3020);
    for (const sx of [-1, 1]) tb.box(0.18 * s, 0.25 * s, 0.3 * s, sx * 0.4 * s, 0.25 * s, -0.25 * s, T.body);
  } else if (d.wp === 'repair') {
    tb.add(G.dome, 0.5 * s, 0.35 * s, 0.55 * s, 0, 0.02, -0.15 * s, T.body); tb.add(G.cyl16, 0.52 * s, 0.06 * s, 0.57 * s, 0, 0.05, -0.15 * s, T.acc);
    tb.box(0.5 * s, 0.32 * s, 0.05 * s, 0, 0.35 * s, -0.55 * s, 0xf2f2ea); tb.box(0.3 * s, 0.08 * s, 0.06 * s, 0, 0.35 * s, -0.56 * s, 0x2eaa4a); tb.box(0.08 * s, 0.24 * s, 0.06 * s, 0, 0.35 * s, -0.56 * s, 0x2eaa4a);
    tb.box(0.14 * s, 0.14 * s, 1.1 * s, 0, 0.5 * s, 0.4 * s, 0xd9b23a, -0.45, 0, 0); // arm
    tb.box(0.12 * s, 0.12 * s, 0.8 * s, 0, 0.62 * s, 1.05 * s, 0xd9b23a, 0.5, 0, 0); // forearm
    tb.add(G.cyl16, 0.14 * s, 0.25 * s, 0.14 * s, 0, 0.35 * s, 1.35 * s, 0x5a564f, Math.PI / 2, 0, 0); // tool head
    for (const sx of [-1, 1]) tb.box(0.05 * s, 0.05 * s, 0.22 * s, sx * 0.08 * s, 0.35 * s, 1.55 * s, 0x8c867a);
    tb.add(G.sph, 0.1 * s, 0.1 * s, 0.1 * s, 0.25 * s, 0.45 * s, -0.2 * s, 0x40ff80);
  } else {
    tb.add(G.sph, 0.48 * s, 0.38 * s, 0.4 * s, 0, 0.3 * s, 0.55 * s, 0xc9a23a); tb.add(G.cyl16, 0.49 * s, 0.1 * s, 0.41 * s, 0, 0.42 * s, 0.55 * s, T.acc);
    tb.add(G.sph, 0.3 * s, 0.16 * s, 0.12 * s, 0, 0.42 * s, 0.88 * s, 0x223344);
    tb.add(G.cyl16, 0.12 * s, 1.9 * s, 0.12 * s, 0, 0.75 * s, -0.4 * s, 0xd9b23a, PI2 - 0.4, 0, 0);
    tb.add(G.cyl6, 0.05, 0.6 * s, 0.05, 0, 0.9 * s, -1.25 * s, 0x333333);
    tb.add(G.sph, 0.12 * s, 0.12 * s, 0.12 * s, 0.3 * s, 0.7 * s, 0.4 * s, 0xff9a20);
  }
  const res = { body: B.build(), tur: tb.build(), turY: top, msl };
  geoCache[key] = res; return res;
}

const bldCache = {};
function bldGeo(type, team) {
  if (BD[type] && BD[type].cls) { if (BD[type].cls === 'tower') type = 'tower'; else type = 'cls_' + BD[type].cls; }
  const key = type + team; if (bldCache[key]) return bldCache[key];
  const T = TEAMC[team]; const B = new Builder(); const conc = 0x8c867a, conc2 = 0x6f6a61; const anim = {};
  switch (type) {
    case 'hq':
      B.box(7.2, 2, 7.2, 0, -0.5, 0, conc); B.box(5.2, 2.4, 5.2, 0, 1.7, 0, T.body); B.box(5.3, 0.35, 5.3, 0, 2.7, 0, T.acc);
      B.box(5.25, 0.45, 4.4, 0, 1.6, 0, 0x1c2228); B.box(4.4, 0.45, 5.25, 0, 1.6, 0, 0x1c2228);
      B.box(3.4, 1.6, 3.4, 0, 3.7, 0, T.dark); for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0.6, 3.2, 0.6, sx * 2.6, 1.6, sz * 2.6, T.dark);
      B.add(G.cyl6, 0.1, 4, 0.1, 1.3, 6, 1.3, 0x333333); B.box(0.6, 0.6, 0.6, -1.2, 4.8, -1.2, 0x444444);
      for (let k = 0; k < 3; k++) B.box(1.0, 0.1, 0.1, 1.3, 5 + k * 0.8, 1.3, 0x333333);
      B.box(2.2, 2.2, 0.15, 0, 1.5, 2.65, 0x2c2a26); B.box(2.6, 0.25, 0.9, 0, 2.75, 2.95, T.acc); B.box(2.4, 0.3, 1.2, 0, 0.6, 3.3, 0x55524b, 0.15, 0, 0);
      for (const sx of [-1, 1]) { B.box(0.15, 1.6, 0.15, sx * 1.6, 1.2, 3.4, 0x444444); B.box(0.25, 0.25, 0.25, sx * 1.6, 2.05, 3.4, 0xfff2c0); }
      B.box(1.2, 0.5, 1.2, 1.1, 4.7, -1.1, 0x3a3833); for (let k = 0; k < 3; k++) B.box(0.06, 0.4, 1.0, 0.75 + k * 0.35, 5.0, -1.1, 0x22201d);
      { const d = new Builder(); d.add(G.dome, 1.3, 0.5, 1.3, 0, 0, 0, 0xd8d4c8, Math.PI * 0.75, 0, 0); d.add(G.cyl6, 0.06, 1, 0.06, 0, 0.3, 0.3, 0x333333, 0.6, 0, 0); anim.dish = d.build(); }
      break;
    case 'factory': {
      B.box(8.6, 2, 7.8, 0, -0.5, 0, conc); B.box(8.4, 0.12, 7.6, 0, 0.52, 0, 0x7a746a);
      B.box(7, 3.2, 5.6, 0, 2, 0, T.body);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0.35, 3.4, 0.35, sx * 3.45, 2.1, sz * 2.75, T.dark);
      for (let i = 0; i < 4; i++) B.box(0.18, 3.1, 0.12, -2.6 + i * 1.75, 2, 2.82, T.dark);
      // sawtooth roof with skylights
      for (let i = 0; i < 3; i++) { B.box(2.5, 0.22, 5.8, -2.3 + i * 2.33, 3.95, 0, T.dark, 0, 0, 0.35); B.box(0.1, 0.9, 5.5, -1.15 + i * 2.33, 4.05, 0, 0x9fd3e6); }
      // window band on the sides
      for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) B.box(0.08, 0.55, 0.9, sx * 3.52, 2.9, -2 + k * 1.33, 0x9fd3e6);
      // big door with hazard stripes
      B.box(3.2, 2.4, 0.15, 0, 1.6, 2.86, 0x2c2a26); for (let k = 0; k < 6; k++) B.box(0.18, 2.3, 0.05, -1.25 + k * 0.5, 1.6, 2.95, 0x3a3833);
      for (let k = 0; k < 8; k++) B.box(0.45, 0.28, 0.2, -1.6 + k * 0.45 + 0.22, 2.98, 2.9, k % 2 ? 0x1c1c1c : 0xe8c02a, 0, 0, 0.5);
      B.box(7.05, 0.3, 5.65, 0, 1, 0, T.acc); B.box(0.5, 0.2, 0.2, -1.9, 3.05, 2.95, 0xfff2c0); B.box(0.5, 0.2, 0.2, 1.9, 3.05, 2.95, 0xfff2c0);
      // ramp in front
      B.box(3.4, 0.3, 1.6, 0, 0.45, 3.6, 0x55524b, 0.18, 0, 0);
      // chimneys with rings
      for (const [cx, h] of [[-2.6, 3.5], [-1.5, 3]]) { B.cyl(0.45, h, cx, 3.4 + h / 2, -1.9, conc2); B.cyl(0.52, 0.2, cx, 3.6 + h * 0.6, -1.9, T.acc); B.cyl(0.55, 0.25, cx, 3.35 + h, -1.9, 0x3a3631); }
      // storage tanks with bands + pipes
      for (const tz of [-1.6, 0.5]) { B.cyl(0.85, 2.4, 3.95, 1.2, tz, 0x7d786e); B.cyl(0.9, 0.15, 3.95, 0.8, tz, T.dark); B.cyl(0.9, 0.15, 3.95, 1.7, tz, T.dark); B.add(G.dome, 0.85, 0.3, 0.85, 3.95, 2.4, tz, 0x7d786e); }
      B.add(G.cyl6, 0.12, 2.6, 0.12, 3.95, 2.7, -0.55, 0x4a4a46, Math.PI / 2, 0, 0); B.add(G.cyl6, 0.12, 0.9, 0.12, 3.6, 2.7, -0.55, 0x4a4a46, 0, 0, Math.PI / 2);
      // side annex + vents
      B.box(1.8, 2, 3.2, -4.3, 1.1, -0.8, T.dark); B.box(1.9, 0.15, 3.3, -4.3, 2.15, -0.8, T.acc);
      for (let k = 0; k < 3; k++) B.box(0.1, 0.5, 0.7, -5.22, 1.2, -1.9 + k * 0.9, 0x22201d);
      // roof catwalk, railing and crane
      B.box(5.5, 0.08, 0.7, 0.4, 4.45, -2.5, 0x4a4a46); for (let k = 0; k < 8; k++) B.box(0.05, 0.6, 0.05, -2.2 + k * 0.75, 4.75, -2.85, 0xd9b23a); B.box(5.5, 0.05, 0.05, 0.4, 5.05, -2.85, 0xd9b23a);
      B.box(0.3, 2.2, 0.3, 2.9, 5.4, -2.1, 0xd9b23a); B.box(3.2, 0.25, 0.25, 1.6, 6.5, -2.1, 0xd9b23a); B.box(0.08, 1, 0.08, 0.3, 5.9, -2.1, 0x333333);
      // ladder
      for (let k = 0; k < 7; k++) B.box(0.5, 0.05, 0.05, 3.62, 0.6 + k * 0.5, 2.0, 0x8a8a84); B.box(0.05, 3.6, 0.05, 3.4, 2.3, 2.0, 0x8a8a84); B.box(0.05, 3.6, 0.05, 3.84, 2.3, 2.0, 0x8a8a84);
      break; }
    case 'lab': { // modern research facility: concrete + glass blocks, glowing reactor, rooftop gear
      const GL = 0x5fb8d8, GLD = 0x2d6a86;
      B.box(6.2, 1.6, 6.2, 0, -0.4, 0, conc); B.box(6.0, 0.12, 6.0, 0, 0.42, 0, 0x7a746a);
      B.box(4.6, 2.0, 3.6, -0.5, 1.45, 0.4, T.body); B.box(4.65, 0.22, 3.65, -0.5, 2.5, 0.4, T.acc);           // main block
      B.box(4.62, 0.5, 0.08, -0.5, 1.75, 2.22, GL); B.box(0.08, 0.5, 3.4, 1.82, 1.75, 0.4, GL);               // glass band
      for (let k = -2; k <= 2; k++) B.box(0.08, 0.55, 0.1, -0.5 + k * 0.9, 1.75, 2.24, GLD);                   // mullions
      B.box(1.2, 1.3, 0.12, -1.8, 1.1, 2.24, 0x24221f); B.box(1.4, 0.12, 0.6, -1.8, 1.82, 2.45, T.dark);        // door + canopy
      B.box(3.0, 1.3, 2.4, -1.0, 3.25, 0.0, conc);                                                              // upper floor, set back
      B.box(3.02, 0.9, 0.06, -1.0, 3.3, 1.22, GL); B.box(0.06, 0.9, 2.3, 0.52, 3.3, 0.0, GL);
      B.box(3.1, 0.16, 2.5, -1.0, 3.98, 0.0, T.dark);
      // reactor / particle chamber with glowing rings
      B.add(G.cyl16, 1.05, 3.0, 1.05, 2.0, 1.9, -1.4, 0xb8bcc0); for (const y of [1.0, 1.9, 2.8]) B.add(G.cyl16, 1.12, 0.16, 1.12, 2.0, y, -1.4, 0x60e0ff);
      B.add(G.dome, 1.05, 0.5, 1.05, 2.0, 3.4, -1.4, 0x9aa0a6); B.add(G.cyl10, 0.14, 0.6, 0.14, 2.0, 3.9, -1.4, 0x60e0ff);
      B.add(G.cyl10, 0.16, 2.2, 0.16, 0.9, 2.2, -1.4, 0x8a8a84, 0, 0, Math.PI / 2);                            // pipe to building
      // roof: solar panels, fans, antenna mast
      for (let k = 0; k < 3; k++) B.box(0.8, 0.06, 1.0, -2.2 + k * 0.95, 4.2, -0.5, 0x1e3448, -0.35, 0, 0);
      for (const fx2 of [-1.7, -0.3]) { B.add(G.cyl16, 0.42, 0.3, 0.42, fx2, 4.2, 0.65, 0x6a6a66); B.add(G.cyl16, 0.34, 0.05, 0.34, fx2, 4.36, 0.65, 0x22201d); }
      B.add(G.cyl6, 0.05, 1.8, 0.05, 1.3, 3.4, 1.8, 0x333333); B.box(0.12, 0.12, 0.12, 1.3, 4.3, 1.8, 0xff3020);
      { const d = new Builder(); d.add(G.cyl10, 0.08, 0.5, 0.08, 0, 0.25, 0, 0x4a4a46); d.add(G.dome, 0.75, 0.3, 0.75, 0, 0.55, 0, 0xe0ddd4, Math.PI * 0.7, 0, 0); d.add(G.cyl6, 0.03, 0.6, 0.03, 0, 0.75, 0.25, 0x333333, 0.6, 0, 0); anim.dish = d.build(); }
      break;
    }
    case 'generator': {
      B.box(6.2, 2, 6.2, 0, -0.5, 0, conc); B.box(6, 0.12, 6, 0, 0.52, 0, 0x7a746a);
      B.box(3.2, 2.4, 2.6, -0.9, 1.7, 0.9, T.body); B.box(3.25, 0.3, 2.65, -0.9, 2.95, 0.9, T.acc);
      for (let k = 0; k < 4; k++) B.box(0.08, 1.2, 0.5, 0.72, 1.6, -0.1 + k * 0.62, 0x22201d); // vents
      // cooling towers (hyperboloid look from stacked tapered rings)
      for (const [cx, cz] of [[1.6, -1.4], [-1.7, -1.7]]) {
        B.add(G.cool, 1.05, 3.5, 1.05, cx, 0.85, cz, 0xc4beb2); B.add(G.cool, 0.98, 3.4, 0.98, cx, 0.9, cz, 0x5a554d);
        B.cyl(0.98, 0.15, cx, 4.35, cz, T.dark); B.cyl(0.88, 0.2, cx, 4.3, cz, 0x2a2622); B.cyl(1.0, 0.2, cx, 1.6, cz, T.acc);
      }
      // transformer coils + insulators
      for (let k = 0; k < 3; k++) { const x = 2.1, z = 0.6 + k * 0.9; B.cyl(0.32, 1.2, x, 1.2, z, 0x5a5650); for (let r = 0; r < 4; r++) B.cyl(0.22, 0.08, x, 2.0 + r * 0.18, z, 0xd8d4c8); B.cyl(0.1, 0.5, x, 2.9, z, 0x8a8a84); }
      B.box(0.06, 0.06, 2.0, 2.1, 3.15, 1.5, 0x222222);
      // pylon with cables
      B.box(0.15, 4.5, 0.15, -2.6, 2.6, 2.5, 0x4a4a46); B.box(1.6, 0.12, 0.12, -2.6, 4.6, 2.5, 0x4a4a46); B.box(1.0, 0.12, 0.12, -2.6, 4.0, 2.5, 0x4a4a46);
      B.box(0.05, 0.05, 2.4, -2.0, 4.5, 1.3, 0x222222, 0.25, 0, 0);
      // fuel pipe + hazard fence
      B.add(G.cyl6, 0.14, 4.6, 0.14, 0, 0.75, 2.75, 0x6a645a, 0, 0, Math.PI / 2);
      for (const sx of [-1, 1]) B.box(0.1, 0.7, 6, sx * 2.95, 0.9, 0, 0xd9b23a); B.box(6, 0.1, 0.1, 0, 1.2, -2.95, 0xd9b23a);
      { const d = new Builder(); d.cyl(0.62, 0.12, 0, 0, 0, 0x3a3833); for (let k = 0; k < 4; k++) d.box(1.1, 0.04, 0.22, 0, 0.08, 0, 0x8a8a84, 0, k * Math.PI / 4, 0.25); anim.fan = d.build();
        const c = new Builder(); for (let k = 0; k < 3; k++) c.cyl(0.24, 0.08, 2.1, 2.62, 0.6 + k * 0.9, 0x7fe8ff); anim.glow = c.build(); }
      break; }
    case 'pump':
      B.box(3.8, 1.2, 3.8, 0, -0.2, 0, conc2);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(G.cyl6, 0.09, 3.3, 0.09, sx * 0.75, 1.8, sz * 0.75, 0x3a3a3a, -sz * 0.2, 0, sx * 0.2);
      B.box(0.35, 0.35, 0.35, 0, 3.45, 0, 0x333333);
      B.add(G.cyl10, 0.6, 1.4, 0.6, 1.25, 1.05, 1.1, T.body); B.box(0.9, 0.8, 1, -1.15, 0.8, 1.1, T.acc);
      B.cyl(0.65, 0.12, 1.25, 0.6, 1.1, T.dark); B.cyl(0.65, 0.12, 1.25, 1.5, 1.1, T.dark);
      B.add(G.cyl6, 0.1, 2.4, 0.1, 0, 0.6, 0.2, 0x4a4a46, 0, 0, Math.PI / 2); B.add(G.cyl6, 0.25, 0.9, 0.25, 0, 0.7, -1.3, 0x5a564f);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0.12, 0.6, 0.12, sx * 1.75, 0.65, sz * 1.75, 0xd9b23a);
      B.box(3.5, 0.06, 0.06, 0, 0.95, 1.75, 0xd9b23a); B.box(3.5, 0.06, 0.06, 0, 0.95, -1.75, 0xd9b23a); B.box(0.06, 0.06, 3.5, 1.75, 0.95, 0, 0xd9b23a); B.box(0.06, 0.06, 3.5, -1.75, 0.95, 0, 0xd9b23a);
      { const d = new Builder(); d.box(0.25, 0.3, 3.4, 0, 0, 0.3, 0x2f2f2f); d.box(0.45, 0.9, 0.35, 0, -0.25, 2.0, 0x4a4a4a); d.box(0.4, 0.5, 0.4, 0, -0.2, -1.4, T.dark); anim.beam = d.build(); }
      break;
    case 'repairbay':
      B.box(7.2, 1.2, 7.2, 0, -0.3, 0, conc); B.box(6.6, 0.1, 6.6, 0, 0.32, 0, 0x5a564f);
      for (let k = 0; k < 8; k++) B.box(0.5, 0.12, 0.3, -2.8 + k * 0.8, 0.33, 3.1, k % 2 ? 0x1c1c1c : 0xe8c02a);
      for (const sx of [-1, 1]) { B.box(0.35, 4.2, 0.35, sx * 2.9, 2.3, -1.2, 0xd9b23a); B.box(0.35, 4.2, 0.35, sx * 2.9, 2.3, 1.2, 0xd9b23a); }
      B.box(6.2, 0.45, 0.45, 0, 4.4, -1.2, 0xd9b23a); B.box(6.2, 0.45, 0.45, 0, 4.4, 1.2, 0xd9b23a); B.box(0.6, 0.6, 2.8, 0.8, 4.0, 0, 0x4a4a46);
      B.add(G.cyl6, 0.05, 1.4, 0.05, 0.8, 3.0, 0, 0x222222); B.box(0.5, 0.3, 0.5, 0.8, 2.2, 0, 0x5a564f);
      B.box(2.2, 2.4, 1.8, -2.4, 1.4, -2.6, T.body); B.box(1.6, 1.6, 0.1, -2.4, 1.6, -1.65, 0xf2f2ea); B.box(1.1, 0.35, 0.12, -2.4, 1.6, -1.6, 0x2eaa4a); B.box(0.35, 1.1, 0.12, -2.4, 1.6, -1.6, 0x2eaa4a);
      for (const sx of [-1, 1]) { B.add(G.cyl6, 0.08, 2.2, 0.08, sx * 3.3, 1.4, 3.3, 0x333333); B.add(G.sph, 0.22, 0.22, 0.22, sx * 3.3, 2.6, 3.3, 0x60ff90); }
      B.box(6.6, 0.25, 0.25, 0, 0.6, -3.4, T.acc);
      break;
    case 'silo': { // everything sits flush with the ground: apron, rim, dark shaft, lid rails, small control bunker
      B.box(9, 0.6, 9, 0, -0.15, 0, conc); B.box(8.6, 0.06, 8.6, 0, 0.17, 0, conc2);
      B.add(G.cyl16, 2.9, 0.32, 2.9, 0, 0.3, 0, 0x6f6a61); B.add(G.cyl16, 2.25, 0.34, 2.25, 0, 0.31, 0, 0x0c0c0c);
      for (const sz of [-1, 1]) { B.box(8.4, 0.16, 0.35, 0, 0.26, sz * 2.75, 0x4a4a46); for (let k = -4; k <= 4; k++) B.box(0.12, 0.2, 0.42, k * 1.0, 0.3, sz * 2.75, 0x2e2e2a); }
      B.hazard(8.6, 0.12, 0, 0.12, 4.32, 'z', 1); B.hazard(8.6, 0.12, 0, 0.12, -4.32, 'z', -1); B.hazard(8.6, 0.12, 4.32, 0.12, 0, 'x', 1); B.hazard(8.6, 0.12, -4.32, 0.12, 0, 'x', -1);
      B.box(1.8, 0.9, 1.4, 3.3, 0.6, 3.3, T.body); B.camo(1.8, 0.92, 1.4, 3.3, 0.6, 3.3, 0, 5); B.box(0.5, 0.08, 0.05, 3.3, 0.75, 4.01, 0x3fb0ff); B.add(G.cyl6, 0.03, 2.2, 0.03, 3.8, 2.0, 3.0, 0x222222);
      for (const [vx, vz] of [[-3.4, 3.4], [-3.4, -3.4], [3.4, -3.4]]) { B.add(G.cyl10, 0.22, 0.5, 0.22, vx, 0.4, vz, 0x5a5a56); B.add(G.cyl10, 0.26, 0.06, 0.26, vx, 0.66, vz, 0x2e2e2a); }
      for (const [lx, lz] of [[-4.1, 0], [4.1, 0], [0, -4.1], [0, 4.1]]) B.box(0.18, 0.12, 0.18, lx, 0.24, lz, 0xff4020);
      { const d = new Builder(); d.box(2.9, 0.3, 5.4, 0, 0, 0, 0x6f7a52); d.camo(2.9, 0.32, 5.4, 0, 0, 0, 0, 6); d.box(0.3, 0.36, 5.4, 1.3, 0.02, 0, T.acc); d.hazard(2.9, 0.1, 0, 0.0, 2.72, 'z', 1); d.hazard(2.9, 0.1, 0, 0.0, -2.72, 'z', -1); anim.lid = d.build(); }
      break; }
    case 'airfactory': { // arched hangar, control tower, apron with markings, windsock
      B.box(9.6, 2, 9.4, 0, -0.5, 0, conc); B.box(9.4, 0.1, 9.2, 0, 0.52, 0, 0x7a746a);
      B.add(G.cyl16, 3.7, 7.2, 3.3, 0, 0.55, -0.6, T.body, Math.PI / 2, 0, 0); B.box(7.6, 1.2, 7.4, 0, 0, -0.6, conc2);
      for (let k = 0; k < 5; k++) B.add(G.cyl16, 3.78, 0.16, 3.38, 0, 0.55, -4 + k * 1.7, T.dark, Math.PI / 2, 0, 0);
      B.add(G.cyl16, 3.74, 0.4, 3.34, 0, 0.55, 2.85, T.acc, Math.PI / 2, 0, 0);
      B.box(5.0, 3.2, 0.12, 0, 2.0, 3.0, 0x2c2a26); for (let k = 0; k < 6; k++) B.box(0.06, 3.1, 0.14, -2.1 + k * 0.84, 2.0, 3.02, 0x3a3833);
      for (let k = 0; k < 6; k++) B.box(0.8, 0.22, 0.14, -2.1 + k * 0.84, 3.7, 3.04, k % 2 ? 0x1a1a1a : 0xf0b44a);
      B.box(1.3, 4.6, 1.3, 3.9, 2.3, -3.6, conc2); B.box(1.9, 1.0, 1.9, 3.9, 5.0, -3.6, 0x9fd3e6); B.box(2.1, 0.2, 2.1, 3.9, 5.6, -3.6, T.acc); B.add(G.cyl6, 0.04, 1.4, 0.04, 3.9, 6.4, -3.6, 0x333333); B.box(0.2, 0.2, 0.2, 3.9, 7.1, -3.6, 0xff3020);
      B.box(7.0, 0.06, 2.6, 0, 0.58, 4.4, 0x55524b); for (let k = 0; k < 3; k++) B.box(1.0, 0.08, 0.22, -2.4 + k * 2.4, 0.6, 4.4, 0xf0f0e8); for (const sx of [-1, 1]) B.box(0.12, 0.08, 2.4, sx * 3.4, 0.6, 4.4, 0xf0b44a);
      B.add(G.cyl6, 0.05, 3, 0.05, -4.3, 1.9, 3.9, 0x6a6a64); B.add(G.cone, 0.22, 0.9, 0.22, -4.3, 3.2, 4.3, 0xff7a20, Math.PI / 2, 0, 0);
      break; }
    case 'cybfactory': { // armoured block with growth vats and pipes
      B.box(7.2, 2, 6.8, 0, -0.5, 0, conc); B.box(5.8, 3.0, 4.8, 0, 2.0, -0.3, T.body); B.box(5.9, 0.3, 4.9, 0, 3.6, -0.3, T.acc); B.box(4.6, 0.5, 3.6, 0, 3.95, -0.6, T.dark);
      for (const sx of [-1, 1]) { B.add(G.cyl16, 0.55, 2.6, 0.55, sx * 2.0, 1.8, 2.35, 0x9fd3e6); B.add(G.cyl16, 0.4, 2.3, 0.4, sx * 2.0, 1.7, 2.35, 0x4fd08a); B.add(G.cyl16, 0.62, 0.25, 0.62, sx * 2.0, 3.15, 2.35, T.dark); B.add(G.cyl16, 0.62, 0.25, 0.62, sx * 2.0, 0.55, 2.35, T.dark); }
      B.box(1.8, 2.2, 0.12, 0, 1.6, 2.13, 0x2c2a26); B.box(1.9, 0.18, 0.14, 0, 2.8, 2.15, 0xf0b44a);
      for (let k = 0; k < 3; k++) B.add(G.cyl10, 0.1, 4.6, 0.1, -2.7, 2.6, -2.4 + k * 0.5, 0x8e8e88, Math.PI / 2, 0, 0.05 * k);
      B.add(G.cyl16, 0.4, 2.2, 0.4, 2.2, 4.8, -2.0, 0x55524b); B.add(G.cyl16, 0.48, 0.2, 0.48, 2.2, 5.9, -2.0, T.acc);
      B.box(0.6, 0.6, 0.6, -1.4, 4.4, -1.4, 0x3a3833); for (let k = 0; k < 3; k++) B.box(0.05, 0.5, 0.55, -1.65 + k * 0.25, 4.5, -1.4, 0x22201d);
      break; }
    case 'vpad': { // rearming pad: concrete disc, amber ring, H marking, edge lights, fuel bowser
      B.add(G.cyl16, 2.2, 0.5, 2.2, 0, 0.0, 0, 0x6f6a61); B.add(G.cyl16, 1.9, 0.04, 1.9, 0, 0.27, 0, 0xf0b44a); B.add(G.cyl16, 1.72, 0.05, 1.72, 0, 0.28, 0, 0x55524b);
      B.box(0.18, 0.04, 1.3, -0.45, 0.31, 0, 0xf0f0e8); B.box(0.18, 0.04, 1.3, 0.45, 0.31, 0, 0xf0f0e8); B.box(0.9, 0.04, 0.18, 0, 0.31, 0, 0xf0f0e8);
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; B.box(0.14, 0.12, 0.14, Math.sin(a) * 2.1, 0.3, Math.cos(a) * 2.1, k % 2 ? 0x40ff60 : 0xfff2c0); }
      B.box(0.7, 0.55, 1.1, 2.3, 0.3, -1.4, T.dark); B.add(G.cyl16, 0.3, 0.9, 0.3, 2.3, 0.62, -1.4, 0xc8321e, Math.PI / 2, 0, 0); B.add(G.cyl6, 0.04, 1.2, 0.04, 1.9, 0.4, -0.8, 0x222222, 0, 0, 1.2);
      break; }
    case 'radartower':
      B.box(3.6, 1.2, 3.6, 0, -0.3, 0, conc); B.box(2.4, 1.6, 2.4, 0, 0.9, 0, T.body); B.box(2.5, 0.25, 2.5, 0, 1.75, 0, T.acc);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0.18, 5.2, 0.18, sx * 0.8, 4.3, sz * 0.8, 0x6a6a64, sz * 0.08, 0, -sx * 0.08);
      for (let k = 0; k < 5; k++) { const y = 2.2 + k * 1.0, w = 1.6 - k * 0.12; B.box(w, 0.08, 0.08, 0, y, 0.8 - k * 0.04, 0x6a6a64); B.box(w, 0.08, 0.08, 0, y, -0.8 + k * 0.04, 0x6a6a64); B.box(0.08, 0.08, w, 0.8 - k * 0.04, y, 0, 0x6a6a64); B.box(0.08, 0.08, w, -0.8 + k * 0.04, y, 0, 0x6a6a64); }
      B.box(1.4, 0.3, 1.4, 0, 6.9, 0, T.dark);
      { const d = new Builder(); d.box(2.6, 1.2, 0.15, 0, 0.6, 0, 0x3d4a52, -0.25, 0, 0); d.box(2.4, 1.0, 0.06, 0, 0.6, 0.08, 0x6fa8c8, -0.25, 0, 0); for (let k = -3; k <= 3; k++) d.box(0.04, 1.0, 0.08, k * 0.32, 0.6, 0.1, 0x2a3a44, -0.25, 0, 0); d.box(0.3, 0.4, 0.3, 0, 0.1, -0.2, 0x333333); d.add(G.sph, 0.1, 0.1, 0.1, 1.3, 1.3, 0, 0xff3020); anim.dish = d.build(); }
      break;
    case 'ptrap': czech(B, -0.6, -0.4, 0, 0.3); czech(B, 0.7, -0.4, 0.4, 1.1); B.box(2.2, 0.2, 2.2, 0, -0.3, 0, 0x6a6458); break;
    case 'pwall': return bldGeo('wall', team);
    case 'cls_bunker':
      B.add(G.dome, 2.0, 1.6, 2.0, 0, 0, 0, conc); B.add(G.cyl16, 2.1, 0.4, 2.1, 0, 0.0, 0, conc2); B.box(2.6, 0.32, 0.6, 0, 0.75, 1.7, 0x1c1c1c, 0, 0, 0); B.box(0.6, 0.32, 2.6, 1.7, 0.75, 0, 0x1c1c1c); B.box(0.6, 0.32, 2.6, -1.7, 0.75, 0, 0x1c1c1c);
      B.add(G.cyl16, 0.9, 0.2, 0.9, 0, 1.45, 0, T.acc); for (let k = 0; k < 8; k++) B.add(G.sph, 0.45, 0.3, 0.3, Math.sin(k * 0.8) * 2.3, -0.1, Math.cos(k * 0.8) * 2.3, 0x9a8a62, 0, k * 0.8, 0);
      break;
    case 'cls_hard':
      B.box(3.6, 3.3, 3.6, 0, 1.0, 0, conc); B.box(3.8, 0.6, 3.8, 0, -0.5, 0, conc2); B.box(3.7, 0.35, 3.7, 0, 2.7, 0, T.acc); B.box(3.9, 0.45, 3.9, 0, 3.1, 0, T.dark);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0.7, 3.6, 0.7, sx * 1.6, 1.2, sz * 1.6, 0x6f6a61);
      for (let k = -1; k <= 1; k++) for (const sz of [-1, 1]) B.box(0.9, 0.12, 0.08, k * 1.1, 1.6, sz * 1.82, 0x5a564f);
      break;
    case 'cls_fort':
      B.box(9, 2.2, 9, 0, 0, 0, conc2); B.box(8, 3.6, 8, 0, 2.2, 0, conc); B.box(8.2, 0.4, 8.2, 0, 3.9, 0, T.acc); B.box(5.4, 1.6, 5.4, 0, 4.8, 0, T.dark);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B.add(G.cyl16, 1.3, 5.6, 1.3, sx * 4, 2.6, sz * 4, conc); B.add(G.cyl16, 1.45, 0.4, 1.45, sx * 4, 5.5, sz * 4, T.dark); for (let k = 0; k < 6; k++) B.box(0.4, 0.5, 0.3, sx * 4 + Math.sin(k) * 1.3, 5.9, sz * 4 + Math.cos(k) * 1.3, conc); B.add(G.cyl6, 0.06, 2, 0.06, sx * 4, 6.9, sz * 4, 0x333333); }
      for (let k = -2; k <= 2; k++) for (const sz of [-1, 1]) { B.box(0.8, 0.5, 0.1, k * 1.5, 2.6, sz * 4.02, 0xffd27a); B.box(0.1, 0.5, 0.8, sz * 4.02, 2.6, k * 1.5, 0xffd27a); }
      break;
    case 'cls_pit': // stepped concrete cross with a turntable in the middle
      for (const a of [Math.PI / 4, -Math.PI / 4]) { B.box(4.4, 0.32, 1.25, 0, 0.0, 0, conc2, 0, a, 0); B.box(3.6, 0.3, 1.0, 0, 0.3, 0, conc, 0, a, 0);
        for (const e of [-1, 1]) { B.box(0.5, 0.2, 1.3, Math.cos(a) * e * 2.05, 0.06, -Math.sin(a) * e * 2.05, 0x7a7468, 0, a, 0); for (let k = -1; k <= 1; k++) B.box(0.05, 0.12, 0.12, Math.cos(a) * e * 1.6 - Math.sin(a) * k * 0.32, 0.47, -Math.sin(a) * e * 1.6 - Math.cos(a) * k * 0.32, 0x4a463f, 0, a, 0); } }
      B.add(G.cyl16, 1.25, 0.34, 1.25, 0, 0.35, 0, conc2); B.add(G.cyl16, 1.05, 0.1, 1.05, 0, 0.55, 0, 0x4a4a46); B.add(G.cyl16, 1.1, 0.05, 1.1, 0, 0.52, 0, T.acc);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(G.cyl10, 0.07, 0.5, 0.07, sx * 0.85, 0.6, sz * 0.85, 0x8a5a2a);
      for (const sx of [-1, 1]) { B.box(0.42, 0.32, 0.36, sx * 1.55, 0.6, -0.15, 0x5a5a3a); B.box(0.38, 0.28, 0.32, sx * 1.55, 0.9, -0.15, 0x6a5a3a); }
      break;
    case 'tower':
      // tall concrete pillar with a gun platform on top
      B.box(3.0, 0.9, 3.0, 0, -0.1, 0, conc2); B.box(2.5, 0.5, 2.5, 0, 0.55, 0, conc);
      B.add(G.cyl10, 0.85, 3.6, 0.85, 0, 2.5, 0, conc); for (let k = 0; k < 3; k++) B.add(G.cyl10, 0.92, 0.14, 0.92, 0, 1.3 + k * 1.2, 0, conc2);
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; B.box(0.3, 3.4, 0.45, Math.sin(a) * 0.82, 2.3, Math.cos(a) * 0.82, conc2, 0, a, 0); }
      B.add(G.cyl10, 1.45, 0.45, 1.45, 0, 4.5, 0, T.dark); B.add(G.cyl10, 1.5, 0.12, 1.5, 0, 4.78, 0, T.acc); B.add(G.cone, 1.3, 0.6, 1.3, 0, 4.05, 0, conc2, Math.PI, 0, 0);
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; B.box(0.35, 0.35, 0.18, Math.sin(a) * 1.35, 5.0, Math.cos(a) * 1.35, T.dark, 0, a, 0); }
      B.box(0.06, 0.06, 0.06, 0.95, 4.75, 0.95, 0xff3020);
      for (let k = 0; k < 4; k++) B.add(G.ico, 0.5, 0.3, 0.5, Math.sin(k * 1.6) * 2, 0.3, Math.cos(k * 1.6) * 2, 0x8a7d62, k, k, 0);
      break;
    case 'wall': {
      const st = 0x7a7368, st2 = 0x655f56;
      B.box(5.7, 3.6, 2.0, 0, 1.3, 0, st);                       // main wall body
      B.box(5.8, 0.5, 2.6, 0, -0.1, 0, st2);                      // footing
      for (const sz of [-1, 1]) B.box(0.7, 2.6, 0.5, 0, 0.9, sz * 1.15, st2); // buttresses
      B.box(5.75, 0.3, 2.3, 0, 3.15, 0, T.dark);                  // walkway
      for (let i = -2; i <= 2; i++) for (const sz of [-1, 1]) B.box(0.75, 0.8, 0.35, i * 1.15, 3.7, sz * 1.0, st); // crenellations both sides
      B.box(5.72, 0.28, 2.02, 0, 2.2, 0, T.acc);                  // team band
      for (const sx of [-1.9, 1.9]) B.box(0.18, 0.45, 2.04, sx, 1.4, 0, 0x2a2622); // arrow slits
      break; }
    case 'citadel': {
      const st = 0x6e675c, st2 = 0x5a544b, win = 0xffd27a;
      B.box(15, 2.4, 15, 0, -0.6, 0, st2); B.box(14.2, 0.3, 14.2, 0, 0.7, 0, 0x4a453e);
      // tier 1: wide base with buttresses and lit windows
      B.box(11, 4.6, 11, 0, 2.9, 0, T.body); B.box(11.15, 0.45, 11.15, 0, 4.9, 0, T.acc);
      for (let k = -2; k <= 2; k++) for (const sd of [-1, 1]) { B.box(0.6, 0.9, 0.12, k * 2, 3.2, sd * 5.53, win); B.box(0.12, 0.9, 0.6, sd * 5.53, 3.2, k * 2, win); B.box(0.9, 4.2, 0.6, k * 2 + 1, 2.4, sd * 5.7, st2); B.box(0.6, 4.2, 0.9, sd * 5.7, 2.4, k * 2 + 1, st2); }
      // gate on the front
      B.box(3, 3, 0.4, 0, 1.6, 5.6, 0x241f1a); B.box(3.8, 0.6, 0.6, 0, 3.3, 5.7, T.dark); for (let k = 0; k < 5; k++) B.box(0.12, 2.8, 0.1, -1.2 + k * 0.6, 1.6, 5.82, 0x3a3530);
      // tier 2
      B.box(7.6, 3.4, 7.6, 0, 6.8, 0, T.dark); B.box(7.75, 0.4, 7.75, 0, 8.6, 0, T.acc);
      for (let k = -1; k <= 1; k++) for (const sd of [-1, 1]) { B.box(0.55, 1.1, 0.12, k * 2.2, 7, sd * 3.83, win); B.box(0.12, 1.1, 0.55, sd * 3.83, 7, k * 2.2, win); }
      for (let k = -3; k <= 3; k++) for (const sd of [-1, 1]) { B.box(0.6, 0.6, 0.3, k * 1.1, 9.1, sd * 3.75, T.dark); B.box(0.3, 0.6, 0.6, sd * 3.75, 9.1, k * 1.1, T.dark); }
      // keep / spire
      B.box(4, 3.6, 4, 0, 10.6, 0, T.body); B.box(4.15, 0.35, 4.15, 0, 12.4, 0, T.acc);
      for (const sd of [-1, 1]) { B.box(0.5, 1.2, 0.12, 0, 10.8, sd * 2.03, win); B.box(0.12, 1.2, 0.5, sd * 2.03, 10.8, 0, win); }
      B.add(G.cone, 2.6, 3.6, 2.6, 0, 14.4, 0, T.dark, 0, Math.PI / 4, 0);
      B.add(G.cyl6, 0.12, 5, 0.12, 0, 18.5, 0, 0x333333); B.add(G.ico, 0.45, 0.45, 0.45, 0, 21, 0, 0xff3020);
      B.box(1.6, 0.9, 0.06, 0.85, 20.2, 0, T.acc);
      // round corner towers with crenellations and banners
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * 5.6, z = sz * 5.6;
        B.cyl(1.55, 9.5, x, 4.2, z, st); B.cyl(1.7, 0.35, x, 3, z, T.acc); B.cyl(1.8, 0.5, x, 9.1, z, T.dark);
        for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; B.box(0.5, 0.7, 0.5, x + Math.sin(a) * 1.6, 9.7, z + Math.cos(a) * 1.6, st, 0, a, 0); }
        B.add(G.cone, 1.7, 2.6, 1.7, x, 10.8, z, T.dark);
        B.add(G.cyl6, 0.06, 2.4, 0.06, x, 13, z, 0x333333); B.box(0.05, 0.8, 1.2, x, 13.6, z + 0.6, T.acc);
        B.box(0.4, 0.7, 0.1, x + sx * 0.2, 6.5, z + sz * 1.56, win);
      }
      break; }
  }
  const res = { geo: B.build(), anim }; bldCache[key] = res; return res;
}

// ================= ENTITIES =================
const ents = []; let uid = 1; const EID = new Map(); const byId = id => EID.get(id);
const glowDisc = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
const glowMat = TEAMC.map((t, i) => new THREE.MeshBasicMaterial({ color: [0x66ccff, 0xff7040, 0xffd040][i] || t.acc, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));

function createUnit(team, d, x, z, tier, pal) {
  if (pal === undefined) pal = team;
  const T = TEAMS[team]; const st = unitStats(d, team); if (tier !== undefined) st.hp = Math.round(st.hp * TIERS[tier].hp); const g = unitGeo(d, pal);
  const grp = new THREE.Group(); grp.rotation.order = 'YXZ';
  const body = new THREE.Mesh(g.body, matUnit); body.castShadow = true; grp.add(body);
  const tur = new THREE.Mesh(g.tur, matUnit); tur.position.y = g.turY; tur.castShadow = true; grp.add(tur); const mslMesh = attachMissile(tur, g);
  if (d.pr === 'hover') { const gl = new THREE.Mesh(glowDisc, glowMat[pal]); gl.scale.set(CH[d.ch].size * 1.3, 1, CH[d.ch].size * 1.7); gl.position.y = 0.05; grp.add(gl); }
  scene.add(grp);
  const u = { kind: 'unit', team, d, st, x, z, y: heightAt(x, z), hp: st.hp, maxHp: st.hp, r: 1.0 * CH[d.ch].size, h: g.turY + 0.6, heading: team === 0 ? Math.PI * 0.75 : -Math.PI * 0.25, vx: 0, vz: 0, mesh: grp, tur, mslMesh, turYaw: 0, state: 'idle', tx: x, tz: z, target: null, cd: srand(0, 0.5), acq: srand(0, 0.3), isTruck: d.wp === 'truck', bob: Math.random() * 6, smokeT: 0, alive: true, id: uid++, lastHit: -99, amove: false, lx: x, lz: z, tier, post: null, pal, fire: 0, mvo: 1, ret: 0, pat: null };
  u.air = PR[d.pr].air || null; u.alt = u.air === 'rotor' ? DRONE_ALT : 0; u.maxAmmo = u.air === 'vtol' ? (VAMMO[d.wp] || 4) : 0; u.ammo = u.maxAmmo;
  if (g.legGeo) { u.legs = g.hips.map(h => { const l = new THREE.Mesh(g.legGeo, matUnit); l.position.set(h[0], h[1], h[2]); l.castShadow = true; grp.add(l); return l; }); u.walk = 0; }
  if (g.rotors) u.rotors = g.rotors.map(r => { const b = new THREE.Mesh(g.bladeGeo, matUnit); b.position.set(r[0], r[1], r[2]); grp.add(b); return b; });
  ents.push(u); EID.set(u.id, u); T.units++; return u;
}

function bldY(x, z, size) { const r = size * 0.4; let s = 0; const pts = [[0, 0], [r, r], [-r, r], [r, -r], [-r, -r]]; for (const p of pts) s += heightAt(x + p[0], z + p[1]); return s / pts.length; }
function attachMissile(turMesh, g) { if (!g.msl) return null; const m = new THREE.Mesh(missileGeo(g.msl.kind), matVC); m.position.set(g.msl.x, g.msl.y, g.msl.z); m.rotation.x = -g.msl.a; m.scale.setScalar(g.msl.len); m.castShadow = true; turMesh.add(m); return m; }
function makeBldMesh(type, team) { // team = colour palette index
  const g = bldGeo(type, team); const grp = new THREE.Group(); const main = new THREE.Mesh(g.geo, matVC); main.castShadow = true; main.receiveShadow = true; grp.add(main); const parts = {};
  if (type === 'hq') { const d = new THREE.Mesh(g.anim.dish, matVC); d.position.set(-1.2, 5.4, -1.2); grp.add(d); parts.dish = d; }
  if (type === 'lab') { const d = new THREE.Mesh(g.anim.dish, matVC); d.position.set(-1.6, 4.05, 0.2); grp.add(d); parts.dish = d; }
  if (type === 'generator') { const f = new THREE.Mesh(g.anim.fan, matVC); f.position.set(-0.9, 3.15, 0.9); grp.add(f); parts.fan = f; const gl = new THREE.Mesh(g.anim.glow, matGlow); grp.add(gl); parts.glow = gl; }
  if (type === 'pump') { const b = new THREE.Mesh(g.anim.beam, matVC); b.position.set(0, 3.55, 0); grp.add(b); parts.beam = b; }
  if (type === 'silo') { for (const sd of [-1, 1]) { const l = new THREE.Mesh(g.anim.lid, matVC); l.position.set(sd * 1.45, 0.5, 0); l.scale.x = sd; l.castShadow = true; grp.add(l); parts[sd < 0 ? 'lidL' : 'lidR'] = l; }
    const L = 9; const m = new THREE.Mesh(missileGeo('icbm'), matVC); m.rotation.x = -Math.PI / 2; m.scale.setScalar(L); m.position.y = -L * 0.62; grp.add(m); parts.msl = m; parts.mslL = L; }
  if (type === 'radartower') { const d = new THREE.Mesh(g.anim.dish, matVC); d.position.set(0, 7.05, 0); grp.add(d); parts.dish = d; }
  if (type === 'tower' || BD[type].tw) {
    const t = new THREE.Group(); t.position.y = BD[type].ty || 3.3; t.scale.setScalar(BD[type].ts || 1); grp.add(t);
    parts.wl = BD[type].tw ? [BD[type].tw] : ['mg', 'cannon', 'rockets', 'laser'];
    for (const w of parts.wl) { const ug = unitGeo({ ch: 'heavy', pr: 'wheels', wp: w }, team); const m = new THREE.Mesh(ug.tur, matUnit); m.castShadow = true; m.visible = false; t.add(m); parts[w] = m; const ms = attachMissile(m, ug); if (ms) parts.msl = ms; }
    parts.tur = t;
  }
  return { grp, parts };
}
function wellAt(x, z) { for (const w of WELLS) if (Math.hypot(w.x - x, w.z - z) < 1) return w; return null; }

function createBuilding(team, type, x, z, complete, rotOverride, tier, pal) {
  if (pal === undefined) pal = team;
  const def = BD[type]; const m = makeBldMesh(type, pal);
  const y = (type === 'pump' || type === 'generator') ? heightAt(x, z) : bldY(x, z, def.size); m.grp.position.set(x, y, z);
  const rot = rotOverride !== undefined && rotOverride !== null ? rotOverride : Math.round(Math.atan2(-x, -z) / (Math.PI / 2)) * (Math.PI / 2); m.grp.rotation.y = rot;
  scene.add(m.grp);
  const maxHp = Math.round(def.hp * TEAMS[team].shpMul * (tier !== undefined ? TIERS[tier].hp : 1));
  const b = { kind: 'bld', type, team, x, z, y, rot, def, hp: complete ? maxHp : maxHp * 0.1, maxHp, r: def.r || def.size * 0.55, h: def.h, tier, mesh: m.grp, parts: m.parts, complete: !!complete, built: complete ? 1 : 0, queue: [], prod: 0, rally: null, res: null, resProg: 0, cd: 0, acq: 0, target: null, turYaw: 0, alive: true, id: uid++, smokeT: 0, lastHit: -99, anim: Math.random() * 6, pal };
  if (!complete) m.grp.scale.y = 0.12;
  if (type === 'pump' || type === 'generator') { const w = wellAt(x, z); b.well = w; if (w) w.pump = b; }
  ents.push(b); EID.set(b.id, b); return b;
}
function completeBld(b) {
  b.complete = true; b.built = 1; b.mesh.scale.y = 1;
  if (b.team === 0) teamToast(`${b.def.icon} ${b.def.name} — gata!`, 'done');
}

// ================= FX =================
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
// solid round fireball for gun flashes: white-hot core, yellow body, orange rim
const ballTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,250,210,1)'); gr.addColorStop(0.22, 'rgba(255,225,70,1)'); gr.addColorStop(0.6, 'rgba(255,165,25,1)'); gr.addColorStop(0.82, 'rgba(240,90,10,.75)'); gr.addColorStop(1, 'rgba(200,60,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
function makePool(n, blend) { const arr = []; for (let i = 0; i < n; i++) { const m = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: blend }); const s = new THREE.Sprite(m); s.visible = false; scene.add(s); arr.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, a0: 1, g: 0, smoke: false }); } return arr; }
const addPool = makePool(420, THREE.AdditiveBlending), normPool = makePool(900, THREE.NormalBlending);
let addIdx = 0, normIdx = 0;
const FXT = {
  flash: { life: 0.14, s0: 1.6, s1: 4, a: 1, color: 0xfff0b0, v: 0, vy: 0 },
  fire: { life: 0.6, s0: 1.2, s1: 2.6, a: 0.95, color: 0xff7a22, v: 1.2, vy: 2 },
  spark: { life: 0.45, s0: 0.35, s1: 0.1, a: 1, color: 0xffd060, v: 6, vy: 7, g: 14 },
  smoke: { life: 2.6, s0: 1, s1: 4.2, a: 0.55, color: 0x48433c, v: 0.4, vy: 1.6, wind: 0.6 },
  mtrail: { life: 4.2, s0: 0.75, s1: 2.3, a: 0.62, color: 0xd6d2ca, v: 0.04, vy: 0.12, wind: 0.12 },
  trail: { life: 2.6, s0: 0.8, s1: 3.2, a: 0.85, color: 0xc4bfb5, v: 0.15, vy: 0.5, wind: 0.35 },
  dust: { life: 1.1, s0: 1, s1: 2.8, a: 0.4, color: 0xb59c78, v: 0.8, vy: 0.6 },
  blastball: { life: 0.42, s0: 2.4, s1: 5.2, a: 1, color: 0xffffff, v: 0, vy: 1.2, tex: 'ball' },
  gunflash: { life: 0.22, s0: 3.4, s1: 1.6, a: 1, color: 0xffffff, v: 0, vy: 0.4, tex: 'ball' },
  muzzle: { life: 0.06, s0: 0.7, s1: 1.1, a: 1, color: 0xfff3c0, v: 0, vy: 0 },
  snow: { life: 5, s0: 0.35, s1: 0.3, a: 0.9, color: 0xffffff, v: 0.6, vy: -5, wind: 0.8 },
  steam: { life: 3, s0: 1.2, s1: 4.5, a: 0.5, color: 0xf2f2ee, v: 0.3, vy: 2.2, wind: 0.5 },
  flame: { life: 0.5, s0: 1.4, s1: 0.4, a: 0.9, color: 0xff8a30, v: 0.3, vy: 3 },
  ember: { life: 1.4, s0: 0.22, s1: 0.05, a: 1, color: 0xff9a30, v: 3, vy: 6, g: 4 },
  fireball: { life: 0.9, s0: 1.5, s1: 4.2, a: 0.9, color: 0xff6a18, v: 0.6, vy: 2.6 },
  blacksmoke: { life: 5, s0: 1.4, s1: 6.5, a: 0.62, color: 0x24211e, v: 0.35, vy: 2.4, wind: 0.7 },
};
function fx(type, x, y, z, size = 1) {
  const P = FXT[type]; const normal = type === 'smoke' || type === 'trail' || type === 'mtrail' || type === 'dust' || type === 'snow' || type === 'steam';
  const p = (normal || type === 'blacksmoke' || P.tex === 'ball') ? normPool[normIdx = (normIdx + 1) % normPool.length] : addPool[addIdx = (addIdx + 1) % addPool.length];
  p.life = p.max = P.life * rand(0.8, 1.2); p.s0 = P.s0 * size; p.s1 = P.s1 * size; p.a0 = P.a; p.smoke = normal || type === 'blacksmoke'; p.fast = type === 'trail' || type === 'mtrail'; p.ball = P.tex === 'ball';
  p.vx = rand(-P.v, P.v) + (P.wind || 0); p.vy = P.vy * rand(0.6, 1.2); p.vz = rand(-P.v, P.v); p.g = P.g || 0;
  p.s.material.color.setHex(P.color); { const mp = P.tex === 'ball' ? ballTex : glowTex; if (p.s.material.map !== mp) p.s.material.map = mp; p.s.material.depthTest = P.tex !== 'ball'; } p.s.position.set(x, y, z); p.s.visible = true; p.s.scale.setScalar(p.s0);
}
function updFx(dt) {
  for (const pool of [addPool, normPool]) for (const p of pool) {
    if (!p.s.visible) continue; p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
    const k = 1 - p.life / p.max; p.s.scale.setScalar(lerp(p.s0, p.s1, k));
    p.s.material.opacity = p.ball ? (k < 0.45 ? 1 : (1 - k) / 0.55) : p.smoke ? p.a0 * (1 - k) * Math.min(1, k * (p.fast ? 30 : 6)) : p.a0 * (1 - k);
    if (p.s.position.y < -50) p.life = 0;
    p.vy -= p.g * dt; p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
  }
}
let shake = 0;
// ---- explosion extras: ground shockwave, scorch marks, flying debris
const shockGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
const shocks = []; for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); m.visible = false; scene.add(m); shocks.push({ m, t: 0, max: 1, r: 1 }); }
const scorchTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(10,8,6,.95)'); gr.addColorStop(0.55, 'rgba(25,20,15,.7)'); gr.addColorStop(1, 'rgba(30,25,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(32 + rand(-24, 24), 32 + rand(-24, 24), rand(1, 4), 0, TAU); g.fill(); } return new THREE.CanvasTexture(c); })();
const scorchGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const scorches = []; let scIdx = 0; for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); m.visible = false; m.renderOrder = 1; scene.add(m); scorches.push({ m, t: 0 }); }
const debGeo = new THREE.BoxGeometry(1, 1, 1); const debMats = [0x2a2622, 0x4a4438, 0x6a5a40, 0x3a3f30].map(c => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
const debris = []; let dbIdx = 0; for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(debGeo, debMats[i % 4]); m.visible = false; scene.add(m); debris.push({ m, t: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, smk: 0 }); }
function shockwave(x, z, r) { const s = shocks.find(q => !q.m.visible) || shocks[0]; s.m.position.set(x, heightAt(x, z) + 0.25, z); s.t = 0; s.max = 0.32 + r * 0.03; s.r = r; s.m.visible = true; }
function scorch(x, z, r) { const s = scorches[scIdx = (scIdx + 1) % scorches.length]; s.m.position.set(x, heightAt(x, z) + 0.08, z); s.m.rotation.y = rand(0, TAU); s.m.scale.set(r * 2, 1, r * 2); s.t = 40; s.m.visible = true; s.m.material.opacity = 0.85; }
function throwDebris(x, y, z, n, pw) { for (let i = 0; i < n; i++) { const d = debris[dbIdx = (dbIdx + 1) % debris.length]; const sz = rand(0.15, 0.4) * Math.min(2, pw); d.m.scale.set(sz, sz * rand(0.4, 1), sz * rand(0.6, 1.4)); d.m.position.set(x, y, z); const a = rand(0, TAU), v = rand(3, 7) * pw; d.vx = Math.sin(a) * v; d.vz = Math.cos(a) * v; d.vy = rand(5, 10) * pw; d.rx = rand(-12, 12); d.rz = rand(-12, 12); d.t = 3.5; d.smk = 0; d.burn = Math.random() < 0.5; d.m.visible = true; } }
const EXPL = 3; // impact explosions are 3x their original size
// solid 3D fireballs: opaque yellow-white core inside an orange shell, grows fast, darkens to red and fades
// fireball like a photo of a real gas explosion: soft round clouds, white-hot centre, then yellow, orange, deep red,
// dark smoke at the blurry edge. Painted once into textures; each explosion layers a few of them and lets them cool down.
const FB_TEX = (() => {
  const ramp = (h, cs) => { for (let i = 1; i < cs.length; i++) if (h <= cs[i][0]) { const a = cs[i - 1], b = cs[i], t = (h - a[0]) / (b[0] - a[0]); return [0, 1, 2].map(j => a[1][j] + (b[1][j] - a[1][j]) * t); } return cs[cs.length - 1][1]; };
  const HOT = [[0, [120, 30, 8]], [0.18, [205, 60, 12]], [0.38, [255, 135, 30]], [0.58, [255, 205, 80]], [0.78, [255, 244, 190]], [1, [255, 255, 245]]];
  const COOL = [[0, [34, 22, 18]], [0.16, [90, 28, 12]], [0.36, [180, 50, 12]], [0.6, [240, 110, 26]], [0.82, [255, 170, 60]], [1, [255, 215, 110]]];
  const mk = (seed, cs, soft, heatK) => { const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    const ph = [0, 1, 2, 3, 4, 5].map(k => seed * 1.7 + k * 2.3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, a = Math.atan2(v, u), r = Math.hypot(u, v);
      const edge = 0.8 + 0.08 * Math.sin(3 * a + ph[0]) + 0.06 * Math.sin(5 * a + ph[1]) + 0.04 * Math.sin(9 * a + ph[2]) + 0.025 * Math.sin(15 * a + ph[3]);
      const turb = Math.sin(u * 9 + ph[4]) * Math.sin(v * 8 + ph[5]) * 0.5 + Math.sin(u * 19 + v * 7 + ph[2]) * Math.sin(v * 17 - u * 5 + ph[3]) * 0.3;
      const rr = r / edge; const heat = Math.max(0, Math.min(1, (1 - Math.pow(rr, 1.3)) * heatK + turb * 0.13));
      const al = Math.max(0, Math.min(1, (1 - rr) / soft)) * (0.85 + turb * 0.15); const col = ramp(heat, cs), o = (y * S + x) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = Math.max(0, Math.min(255, al * al * (3 - 2 * al) * 255)); }
    g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { hot: [0, 1, 2, 3].map(k => mk(k + 1, HOT, 0.5, 1.15)), cool: [0, 1, 2, 3].map(k => mk(k + 7, COOL, 0.32, 0.92)) }; })();
const FB_OP = 0.6; // explosions are 40% see-through
const FBALLS = []; for (let i = 0; i < 40; i++) {
  const g = new THREE.Group(); const sp = (tex, blend, order) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: blend || THREE.NormalBlending })); m.renderOrder = order; g.add(m); return m; };
  const body = [0, 1, 2, 3, 4].map(j => ({ m: sp(FB_TEX.cool[(i + j) % 4], 0, 2), dx: 0, dy: 0, dz: 0, s: 1 }));
  const core = [0, 1, 2].map(j => ({ m: sp(FB_TEX.hot[(i + j) % 4], 0, 3), dx: 0, dy: 0, dz: 0, s: 1 }));
  const glow = sp(glowTex, THREE.AdditiveBlending, 4);
  g.visible = false; scene.add(g); FBALLS.push({ m: g, body, core, glow, t: 0, life: 0, r: 1 }); }
let fbIdx = 0;
// light rays bursting out of an explosion: thin bright spikes, mostly upwards and sideways
const RAY_GEO = [0, 1, 2].map(v => { const B = new Builder(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), e = new THREE.Euler(), d = new THREE.Vector3();
  for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU + v * 0.7 + Math.sin(i * 3.1 + v) * 0.2, el = 0.05 + Math.abs(Math.sin(i * 1.7 + v * 2.3)) * 1.1; d.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).normalize();
    const L = 0.6 + Math.abs(Math.sin(i * 2.9 + v)) * 0.6; q.setFromUnitVectors(up, d); e.setFromQuaternion(q);
    B.add(G.cone, 0.045, L, 0.045, d.x * L / 2, d.y * L / 2, d.z * L / 2, i % 3 ? 0xffe9a0 : 0xffffff, e.x, e.y, e.z); }
  return B.build(); });
const RAYS = []; for (let i = 0; i < 20; i++) { const m = new THREE.Mesh(RAY_GEO[i % 3], new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false })); m.visible = false; m.renderOrder = 3; scene.add(m); RAYS.push({ m, t: 0, life: 0.32, r: 1 }); }
let rayIdx = 0;
// burning streamers: fly out along the rays, arc over and fall to the ground trailing black smoke
const STREAM = [];
function streamers(x, y, z, r) { const n = Math.max(3, Math.min(12, Math.round(r * 1.3))); const a0 = rand(0, TAU);
  for (let i = 0; i < n; i++) { if (STREAM.length > 90) STREAM.shift(); const a = a0 + (i / n) * TAU + rand(-0.25, 0.25), el = rand(0.35, 1.1), sp = r * rand(3.2, 4.6) + 4;
    STREAM.push({ x, y, z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, t: 0, life: rand(1.2, 1.9), tr: 0, s: Math.max(0.5, r * 0.16) }); } }
function updStreamers(dt) { for (let i = STREAM.length - 1; i >= 0; i--) { const q = STREAM[i]; q.t += dt; q.vy -= 13 * dt; q.vx *= 1 - 0.6 * dt; q.vz *= 1 - 0.6 * dt;
  q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; const gy = heightAt(q.x, q.z);
  q.tr -= dt; if (q.tr <= 0) { q.tr = 0.03; const k = q.t / q.life; fx('blacksmoke', q.x, q.y, q.z, q.s * (0.75 + k * 0.6)); if (k < 0.7) fx('fire', q.x, q.y, q.z, q.s * 0.55 * (1 - k)); }
  if (q.y <= gy + 0.2 || q.t >= q.life) { fx('smoke', q.x, gy + 0.3, q.z, q.s * 1.2); fx('fire', q.x, gy + 0.2, q.z, q.s * 0.6); STREAM.splice(i, 1); } } }
function rays3D(x, y, z, r, life, tint) { const f = RAYS[rayIdx = (rayIdx + 1) % RAYS.length]; f.t = 0; f.r = r; f.life = life || 0.35; f.m.position.set(x, y, z); f.m.rotation.y = rand(0, TAU); f.m.visible = true; f.m.scale.setScalar(0.01); f.m.material.opacity = 0.4; const tt = tint || [1, 1, 1]; f.m.material.color.setRGB(tt[0], tt[1], tt[2]); }
function updRays(dt) { for (const f of RAYS) { if (!f.m.visible) continue; f.t += dt; const k = f.t / f.life; if (k >= 1) { f.m.visible = false; continue; }
  f.m.scale.setScalar(f.r * (0.5 + 1.3 * (1 - Math.pow(1 - k, 3)))); f.m.material.opacity = 0.4 * (k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75); } }
const XLIGHTS = []; for (let i = 0; i < 4; i++) { const L = new THREE.PointLight(0xffc070, 0, 10, 1.6); L.visible = true; scene.add(L); XLIGHTS.push({ L, t: 1, life: 1, peak: 0 }); } let xlIdx = 0;
function xlight(x, y, z, r, tint, life) { if (Math.abs(x - cam.x) > 120 || Math.abs(z - cam.z) > 120) return; let o = XLIGHTS[0]; for (const q of XLIGHTS) if (q.t / q.life > o.t / o.life) o = q; const tt = tint || [1, 1, 1];
  o.t = 0; o.life = life; o.peak = 30 * r * r + 40; o.L.position.set(x, y + r * 0.6, z); o.L.distance = r * 9 + 8; o.L.color.setRGB(Math.min(1, tt[0]), Math.min(1, 0.72 * tt[1] + 0.05), Math.min(1, 0.4 * tt[2] + 0.05)); }
function updXLights(dt) { for (const o of XLIGHTS) { if (o.t >= o.life) { o.L.intensity = 0; continue; } o.t += dt; const k = Math.min(1, o.t / o.life); o.L.intensity = o.peak * (k < 0.1 ? k / 0.1 : Math.pow(1 - (k - 0.1) / 0.9, 2)); } }
function fireball3D(x, y, z, r, tint, str, lm) { xlight(x, y, z, r, tint, (0.5 + r * 0.04) * (lm || 1)); const f = FBALLS[fbIdx = (fbIdx + 1) % FBALLS.length];
  f.t = 0; f.tint = tint || [1, 1, 1]; f.life = (0.75 + r * 0.05) * (lm || 1); f.r = r; f.m.position.set(x, y + r * 0.45, z); f.m.visible = true;
  for (const q of f.body) { q.dx = rand(-0.4, 0.4); q.dy = rand(-0.15, 0.4); q.dz = rand(-0.4, 0.4); q.s = rand(0.75, 1.05); q.m.material.rotation = rand(0, TAU); q.m.material.color.setRGB(Math.min(1, f.tint[0]), Math.min(1, 0.4 + 0.6 * f.tint[1]), Math.min(1, 0.4 + 0.6 * f.tint[2])); }
  for (const q of f.core) { q.dx = rand(-0.18, 0.18); q.dy = rand(-0.1, 0.2); q.dz = rand(-0.18, 0.18); q.s = rand(0.7, 0.95); q.m.material.rotation = rand(0, TAU); q.m.material.color.setRGB(Math.min(1, f.tint[0]), Math.min(1, 0.55 + 0.45 * f.tint[1]), Math.min(1, 0.55 + 0.45 * f.tint[2])); }
  f.glow.material.color.setRGB(Math.min(1, f.tint[0]), Math.min(1, 0.55 * f.tint[1]), Math.min(1, 0.25 * f.tint[2]));
  updFireballs(0, f);
  if (str !== 0 && Math.abs(x - cam.x) < 110 && Math.abs(z - cam.z) < 110) streamers(x, y + r * 0.35, z, r * (str || 1)); }
function updFireballs(dt, only) { for (const f of only ? [only] : FBALLS) { if (!f.m.visible) continue; f.t += dt; const k = f.t / f.life; if (k >= 1) { f.m.visible = false; continue; }
  const grow = 1 - Math.pow(1 - Math.min(1, k / 0.28), 3), R = f.r * (0.3 + 0.75 * grow + 0.3 * k); f.m.position.y += dt * f.r * 0.5;
  // the cloud: grows fast, rises a little, cools from orange to red and smoke, then fades
  const bo = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4, dk = Math.max(0, (k - 0.35) / 0.65);
  for (const q of f.body) { const sc = R * 1.5 * q.s * (1 + 0.25 * k); q.m.scale.set(sc, sc, 1); q.m.position.set(q.dx * R, q.dy * R + k * R * 0.25, q.dz * R); q.m.material.opacity = bo * FB_OP;
    const c = 1 - dk * 0.62; q.m.material.color.setRGB(Math.min(1, f.tint[0]) * c, Math.min(1, 0.4 + 0.6 * f.tint[1]) * c * (1 - dk * 0.25), Math.min(1, 0.4 + 0.6 * f.tint[2]) * c * (1 - dk * 0.4)); }
  // the white-hot heart: biggest at the start, shrinks and fades as it burns out
  const co = k < 0.2 ? 1 : Math.max(0, 1 - (k - 0.2) / 0.35);
  for (const q of f.core) { const sc = R * 1.25 * q.s * (1 - 0.35 * k); q.m.scale.set(sc, sc, 1); q.m.position.set(q.dx * R, q.dy * R, q.dz * R); q.m.material.opacity = co * FB_OP; q.m.visible = co > 0; }
  const go = k < 0.1 ? 0.45 : Math.max(0, 0.45 * (1 - (k - 0.1) / 0.4)); f.glow.scale.setScalar(R * 2.4); f.glow.material.opacity = go; f.glow.visible = go > 0; } }
const XST = { shell: { t: [1, 0.85, 0.55], str: 0.6 }, rocket: { t: [1, 0.6, 0.35], str: 1 }, mortar: { t: [1, 0.78, 0.42], str: 0.9, dirt: 1 }, how: { t: [1, 0.7, 0.35], str: 1.3, dirt: 1.5 },
  salvo: { t: [1, 0.62, 0.3], str: 0.8 }, fire: { t: [1, 0.32, 0.12], str: 1.4, flames: 1 }, emp: { t: [0.3, 0.65, 1], str: 0, sparks: 1 }, plasma: { t: [0.5, 0.78, 1], str: 0.6, sparks: 1 },
  heavy: { t: [1, 0.42, 0.18], str: 1.7, dirt: 2 }, bomb: { t: [1, 0.66, 0.3], str: 1.2, dirt: 2 }, icbm: { t: [1, 0.95, 0.85], str: 2, dirt: 3 }, def: { t: [1, 1, 1], str: 1 } };
const xstyle = p => { const W = p.w; if (!W) return p.kind === 'shell' ? XST.shell : XST.rocket; return W.emp ? XST.emp : W.plasma ? XST.plasma : W.fire ? XST.fire : W.id === 'icbm' ? XST.icbm : W.kind === 'bomb' ? XST.bomb : W.big ? XST.heavy : W.art === 'how' ? XST.how : W.kind === 'salvo' ? XST.salvo : W.kind === 'rocket' ? XST.rocket : XST.mortar; };
function impactFx(x, y, z, sz, big, st) { st = st || XST.def;
  const near = Math.abs(x - cam.x) < 110 && Math.abs(z - cam.z) < 110;
  fx('flash', x, y, z, sz * 0.5); fireball3D(x, y, z, sz * 1.1, st.t, st.str);  fx('fire', x, y, z, sz * 0.5);
  if (st.dirt) for (let k = 0; k < 3 + st.dirt * 2; k++) fx('dust', x + rand(-1, 1) * sz * 0.3, y + rand(0.3, 1.6) * sz * 0.5, z + rand(-1, 1) * sz * 0.3, sz * (0.5 + st.dirt * 0.25));
  if (st.flames) for (let k = 0; k < 6; k++) fx('flame', x + rand(-1, 1) * sz * 0.5, y + 0.3, z + rand(-1, 1) * sz * 0.5, sz * 0.5);
  if (st.sparks) for (let k = 0; k < 14; k++) fx('spark', x, y + 0.5, z, 1.6);
  if (!near) { fx('smoke', x, y + 0.5, z, sz * 0.9); return; }
  for (let i = 0; i < 2; i++) fx('fireball', x + rand(-0.4, 0.4) * sz, y + rand(0.1, 0.5) * sz, z + rand(-0.4, 0.4) * sz, sz * 0.7);
  fx('smoke', x, y + 0.5 * sz, z, sz * 0.9); fx('smoke', x + rand(-1, 1) * sz * 0.4, y + 0.9 * sz, z + rand(-1, 1) * sz * 0.4, sz * 0.7); fx('blacksmoke', x, y + 0.4 * sz, z, sz * 0.55);
  fx('dust', x, y, z, sz * 0.9); for (let k = 0; k < 6; k++) fx('spark', x, y + 0.3, z, 1.2); for (let k = 0; k < 4; k++) fx('ember', x, y + 0.3, z, 1);
  scorch(x, z, sz * 0.6); if (sz > 4) throwDebris(x, y + 0.3, z, big ? 6 : 3, 0.9);
  if (big) for (let k = 0; k < 4; k++) fx('fire', x + rand(-1, 1) * sz * 0.4, y, z + rand(-1, 1) * sz * 0.4, sz * 0.45);
  shake = Math.max(shake, Math.min(0.6, sz * 0.05 * Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / 80)));
}
// an air bomb: a carpet of fireballs that go up one after another over the whole blast area, with dark rubble thrown high
function bombFx(x, y, z, w) { if (Math.abs(x - cam.x) > 130 || Math.abs(z - cam.z) > 130) return;
  const n = w.big ? 8 : 5, R = w.splash * 0.85, fire = !!w.fire, tint = fire ? [1, 0.4, 0.16] : [1, 0.68, 0.32];
  throwDebris(x, y + 0.5, z, w.big ? 16 : 10, w.big ? 1.5 : 1.15);
  for (let i = 0; i < n; i++) { const a = rand(0, TAU), d = R * Math.sqrt(rand(0.05, 1)), bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
    later(i * rand(0.04, 0.08), () => { const gy = heightAt(bx, bz), r = (w.big ? 3.6 : 2.4) * rand(0.8, 1.15);
      fireball3D(bx, gy + 0.2, bz, r, tint, 0.4, 0.9); fx('fire', bx, gy + 0.4, bz, r * 0.5); fx('dust', bx, gy + 0.2, bz, r * 0.7);
      for (let k = 0; k < 3; k++) fx('ember', bx, gy + 0.5, bz, 1.2); if (fire) for (let k = 0; k < 3; k++) fx('flame', bx + rand(-1, 1), gy + 0.3, bz + rand(-1, 1), r * 0.45);
      if (i % 2 === 0) fx('blacksmoke', bx, gy + r * 0.6, bz, r * 0.6); scorch(bx, bz, r * 0.5); }); } }
// missiles on launchers: hidden after launch, back after reload
const reloadVis = [];
function updReload() { const t = S.time; for (let i = reloadVis.length - 1; i >= 0; i--) if (t >= reloadVis[i].t) { reloadVis[i].m.visible = true; reloadVis.splice(i, 1); } }
function updBoomFx(dt) {
  updReload(); updXLights(dt); updFireballs(dt); updRays(dt); updStreamers(dt);
  for (const s of shocks) if (s.m.visible) { s.t += dt; const k = s.t / s.max; if (k >= 1) { s.m.visible = false; continue; } const r = s.r * (0.6 + 2.4 * Math.sqrt(k)); s.m.scale.set(r, 1, r); s.m.material.opacity = 0.55 * (1 - k) * (1 - k); }
  for (const s of scorches) if (s.m.visible) { s.t -= dt; if (s.t < 8) s.m.material.opacity = 0.85 * Math.max(0, s.t / 8); if (s.t <= 0) s.m.visible = false; }
  for (const d of debris) if (d.m.visible) { d.t -= dt; const p = d.m.position; d.vy -= 18 * dt; p.x += d.vx * dt; p.y += d.vy * dt; p.z += d.vz * dt; d.m.rotation.x += d.rx * dt; d.m.rotation.z += d.rz * dt;
    const gy = heightAt(p.x, p.z) + 0.1; if (p.y < gy) { p.y = gy; if (Math.abs(d.vy) > 2.5) { d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; d.rx *= 0.5; d.rz *= 0.5; } else { d.vx = d.vz = d.vy = d.rx = d.rz = 0; } }
    d.smk -= dt; if (d.burn && d.smk <= 0 && d.t > 1.2) { d.smk = 0.07; fx('smoke', p.x, p.y, p.z, 0.3); if (d.vy > 0) fx('fire', p.x, p.y, p.z, 0.25); }
    if (d.t < 0.8) d.m.scale.multiplyScalar(1 - dt * 2.5); if (d.t <= 0) d.m.visible = false; }
}
function explosion(x, y, z, size) {
  const near = Math.abs(x - cam.x) < 90 && Math.abs(z - cam.z) < 90; // keep effects cheap off-screen
  fx('flash', x, y, z, size * 1.3); fireball3D(x, y, z, size * 1.6);
  if (near) {
    for (let i = 0; i < 2 + size * 2; i++) fx('fireball', x + rand(-0.6, 0.6) * size, y + rand(0, 0.6) * size, z + rand(-0.6, 0.6) * size, size * 0.75);
    for (let i = 0; i < 3 + size * 3; i++) fx('fire', x + rand(-0.5, 0.5) * size, y + rand(0, 0.5) * size, z + rand(-0.5, 0.5) * size, size * 0.8);
    for (let i = 0; i < 5 * size; i++) fx('spark', x, y, z, 1);
    for (let i = 0; i < 4 + size * 3; i++) fx('ember', x, y + 0.3, z, 1);
    for (let i = 0; i < 2 + size * 2; i++) fx('smoke', x + rand(-1, 1) * size, y + rand(0, 1), z + rand(-1, 1) * size, size);
    for (let i = 0; i < 1 + size; i++) later(0.15 + i * 0.12, () => fx('blacksmoke', x + rand(-0.5, 0.5) * size, y + 0.8, z + rand(-0.5, 0.5) * size, size * 0.8));
    fx('dust', x, heightAt(x, z) + 0.3, z, size * 1.5);
    shockwave(x, z, size * 1.6); scorch(x, z, size * 1.4); throwDebris(x, y + 0.5, z, Math.round(3 + size * 3), 0.7 + size * 0.25);
  }
  sfx(size > 1.5 ? 'bigboom' : 'boom', x, z);
  if (size > 1.5) { later(0.12, () => sfx('collapse', x, z)); } else { later(0.08, () => sfx('debris', x, z)); if (Math.random() < 0.45) later(rand(0.5, 1.1), () => { sfx('cookoff', x, z); fx('spark', x, y + 0.5, z, 1.2); fx('fire', x, y + 0.6, z, 0.6); }); }
  if (size > 1.5) shake = Math.max(shake, 0.5 * clamp(1 - Math.hypot(x - cam.x, z - cam.z) / 60, 0, 1));
}

// tracers & projectiles
// tracers: short glowing bolts that fly to the target (bright core + soft halo)
const tracerGeo = new THREE.BoxGeometry(0.07, 0.07, 1); const tracerMat = new THREE.MeshBasicMaterial({ color: 0xf4ffc0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
const tracerHaloGeo = new THREE.BoxGeometry(0.26, 0.26, 1.15); const tracerHaloMat = new THREE.MeshBasicMaterial({ color: 0xc8ff60, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
const tracers = []; for (let i = 0; i < 90; i++) { const m = new THREE.Mesh(tracerGeo, tracerMat); m.add(new THREE.Mesh(tracerHaloGeo, tracerHaloMat)); m.visible = false; m.renderOrder = 3; scene.add(m); tracers.push({ m, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, d: 0, p: 0, L: 1 }); }
let trIdx = 0;
const beamGeo = new THREE.BoxGeometry(0.26, 0.26, 1), beamMat = new THREE.MeshBasicMaterial({ color: 0xffe04a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const beamCore = new THREE.MeshBasicMaterial({ color: 0xffffff }); const beamCoreGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
const beams = []; for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(beamGeo, beamMat); m.add(new THREE.Mesh(beamCoreGeo, beamCore)); m.visible = false; scene.add(m); beams.push({ m, life: 0 }); }
let bmIdx = 0;
function beam(x1, y1, z1, x2, y2, z2) { const t = beams[bmIdx = (bmIdx + 1) % beams.length]; const d = Math.hypot(x2 - x1, y2 - y1, z2 - z1); t.m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2); t.m.lookAt(x2, y2, z2); t.m.scale.set(1, 1, d); t.m.visible = true; t.life = 0.14; }
function tracer(x1, y1, z1, x2, y2, z2) { const t = tracers[trIdx = (trIdx + 1) % tracers.length]; const d = Math.hypot(x2 - x1, y2 - y1, z2 - z1) || 0.01;
  Object.assign(t, { x: x1, y: y1, z: z1, dx: (x2 - x1) / d, dy: (y2 - y1) / d, dz: (z2 - z1) / d, d, p: 0, L: Math.min(3, 0.6 + d * 0.3) }); t.m.lookAt(x2, y2, z2); t.m.position.set(x1, y1, z1); t.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(t.dx, t.dy, t.dz)); t.m.scale.set(1, 1, 0.01); t.m.visible = true; }
function updTracers(dt) { for (const t of tracers) { if (!t.m.visible) continue; t.p += 150 * dt; const head = Math.min(t.p, t.d), tail = Math.max(0, t.p - t.L); if (tail >= t.d) { t.m.visible = false; continue; }
  const mid = (head + tail) / 2; t.m.position.set(t.x + t.dx * mid, t.y + t.dy * mid, t.z + t.dz * mid); t.m.scale.set(1, 1, Math.max(0.05, head - tail)); } }
const plasmaMat = new THREE.MeshBasicMaterial({ color: 0x9affb8 });
const shellGeo = new THREE.SphereGeometry(0.2, 6, 4), rocketGeo = new THREE.ConeGeometry(0.18, 1.0, 6).rotateX(Math.PI / 2);
const artShellGeo = (() => { const B = new Builder(); B.add(G.cyl16, 0.16, 0.5, 0.16, 0, 0, 0, 0x1c1c1c); B.add(G.cone, 0.16, 0.32, 0.16, 0, 0.41, 0, 0x262626); B.add(G.cyl16, 0.17, 0.06, 0.17, 0, -0.12, 0, 0x6a5a3a); B.add(G.cyl16, 0.12, 0.1, 0.12, 0, -0.3, 0, 0x111111); const g = B.build(); g.rotateX(Math.PI / 2); return g; })();
const shellMat = new THREE.MeshBasicMaterial({ color: 0xffd27a }), rocketMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
const mslExh = new THREE.ConeGeometry(0.07, 0.7, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.85), mslExhCore = new THREE.ConeGeometry(0.035, 0.4, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.7);
const exhGeo = new THREE.ConeGeometry(0.12, 1.1, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.85), exhCoreGeo = new THREE.ConeGeometry(0.06, 0.6, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.6);
const exhMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), exhCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const projs = [];
function spawnProj(kind, src, tgt, dmg, splash, ox, oy, oz, w, realT, mlen, lift) {
  const rk = kind === 'rocket' || (w && w.kind === 'salvo'); let m;
  if (rk && !(w && w.plasma)) { const mk = !w ? 'rocket' : w.id === 'viper' ? 'viper' : w.id === 'smissile' ? 'seeker' : w.id === 'omissile' ? 'orizont' : w.id === 'ballistic' ? 'ballistic' : w.id === 'icbm' ? 'icbm' : w.kind === 'salvo' ? 'salvo' : 'rocket';
    m = new THREE.Mesh(missileGeo(mk), matVC); m.add(new THREE.Mesh(mslExh, exhMat)); m.add(new THREE.Mesh(mslExhCore, exhCoreMat));
    m.scale.setScalar(mlen || ({ rocket: 1.5, viper: 2.3, seeker: 2.0, orizont: 4.5, ballistic: 3, salvo: 1.4 })[mk]); }
  else if (kind === 'shell') { m = new THREE.Mesh(artShellGeo, matVC); m.scale.setScalar(1.5); const g = new THREE.Mesh(shellGeo, shellMat); g.scale.setScalar(0.9); g.position.z = -0.45; m.add(g); }
  else if (kind === 'mortar' && !(w && w.plasma)) { m = new THREE.Mesh(artShellGeo, matVC); m.scale.setScalar(w && w.big ? 2.6 : w && w.art === 'how' ? 2.0 : 1.7); }
  else { m = new THREE.Mesh(shellGeo, w && w.plasma ? plasmaMat : shellMat); if (kind === 'mortar') m.scale.setScalar(w && w.big ? 2.6 : w && w.plasma ? 2.4 : 1.6); }
  scene.add(m); if (lift) m.position.set(ox, oy, oz);
  const tx = tgt.x, tz = tgt.z, ty = tgt.y + (tgt.kind === 'bld' ? 1.5 : 0.8); const d = Math.hypot(tx - ox, tz - oz); const spd = (kind === 'shell' ? 26 : kind === 'mortar' ? 26 : 22) * (kind === 'mortar' ? Math.sqrt(RNG_A) : PROJ_SPD);
  projs.push({ kind, m, team: src.team, src, tgt, ox, oy, oz, tx, ty, tz, t: 0, dur: w && w.kind === 'bomb' ? 0.75 : Math.max(0.12, kind === 'mortar' ? Math.min(d / spd, 3 + d / 120) : d / spd), arc: w && w.kind === 'bomb' ? 0 : kind === 'shell' ? d * 0.05 : kind === 'mortar' ? Math.min(d * 0.55, 60 + d * 0.1) : d * 0.13, dmg, splash, smokeT: 0, w, realT, lift: !!lift, big: !!(w && w.big) });
}
const fireZones = [];
function updFireZones(dt) {
  for (let i = fireZones.length - 1; i >= 0; i--) { const f = fireZones[i]; f.t -= dt; f.fxT -= dt;
    if (f.fxT <= 0) { f.fxT = 0.12; fx('flame', f.x + rand(-f.r, f.r) * 0.7, heightAt(f.x, f.z) + 0.4, f.z + rand(-f.r, f.r) * 0.7, 1.2); }
    for (const e of ents) if (e.alive && e.team !== f.team && !flying(e) && Math.hypot(e.x - f.x, e.z - f.z) < f.r + e.r * 0.5) damage(e, f.dps * dt, f.src);
    if (f.t <= 0) fireZones.splice(i, 1); }
}
function updProjs(dt) {
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i]; p.t += dt / p.dur;
    if (p.tgt.alive) { p.tx = p.tgt.x; p.tz = p.tgt.z; p.ty = p.tgt.y + (p.tgt.kind === 'bld' ? 1.5 : 0.8); }
    const k = Math.min(1, p.lift ? Math.pow(p.t, 1.6) : p.t); const x = lerp(p.ox, p.tx, k), z = lerp(p.oz, p.tz, k), y = lerp(p.oy, p.ty, k) + Math.sin(k * Math.PI) * p.arc;
    const px = p.m.position.x, py = p.m.position.y, pz = p.m.position.z;
    p.m.position.set(x, y, z); if (p.w && p.w.plasma && Math.random() < 0.5) fx('spark', x, y, z, 0.6); if (p.kind === 'rocket' || (p.w && p.w.kind === 'salvo')) { p.m.lookAt(x + (x - px), y + (y - py), z + (z - pz)); p.smokeT -= dt; if (p.smokeT <= 0) { const hv = p.w && (p.w.heavy || p.w.big); p.smokeT = 0.035; fx('trail', x, y, z, p.big ? 1.8 : hv ? 0.75 : 0.55); fx('fire', x, y, z, p.big ? 1.0 : hv ? 0.45 : 0.32); if (p.big && Math.random() < 0.3) fx('blacksmoke', x, y, z, 0.8); } }
    else if (p.kind === 'shell') { p.m.lookAt(x + (x - px), y + (y - py), z + (z - pz)); p.smokeT -= dt; if (p.smokeT <= 0) { p.smokeT = 0.03; fx('trail', x, y, z, 0.5); fx('fire', x, y, z, 0.28); } }
    else if (p.kind === 'mortar' && !(p.w && p.w.plasma)) { p.m.lookAt(x + (x - px), y + (y - py), z + (z - pz)); p.sd = (p.sd || 0) + Math.hypot(x - px, y - py, z - pz); const gap = p.w && p.w.big ? 2.2 : 1.7; if (p.sd >= gap && p.w.kind !== 'bomb') { p.sd = 0; fx('mtrail', x, y, z, p.w && p.w.big ? 1.25 : 1); } }
    if (p.kind === 'mortar' && !p.wh && p.dur > 1.2 && (1 - p.t) * p.dur < 0.95 && !(p.w && (p.w.plasma || p.w.kind === 'salvo' || p.w.id === 'ballistic'))) { p.wh = 1; sfx('whistle', p.tx, p.tz); }
    if (k >= 1) {
      scene.remove(p.m); projs.splice(i, 1);
      { const big = p.w && p.w.big; const base = p.kind === 'shell' ? 1 : p.kind === 'rocket' ? (p.w && p.w.heavy ? 1.3 : 1) : p.w && p.w.kind === 'salvo' ? (big ? 2.6 : 1.2) : big ? 2.6 : 1.5;
        impactFx(x, y, z, p.w && p.w.id === 'icbm' ? 11 : Math.min(6.5, base * EXPL), big, xstyle(p)); if (p.w && p.w.kind === 'bomb') bombFx(x, y, z, p.w); if (p.w && p.w.id === 'icbm') { for (let k = 0; k < 8; k++) fx('blacksmoke', x + rand(-4, 4), y + 4 + k * 2.2, z + rand(-4, 4), 4 + k * 0.4); fireball3D(x, y + 8, z, 7); } }
      sfx(p.kind === 'shell' ? 'imp_shell' : p.kind === 'rocket' ? 'imp_rocket' : (p.w && IMP_SND[p.w.id]) || 'imp_mortar', x, z); if (p.kind !== 'mortar' && p.tgt.alive) sfx('hit', x, z);
      if (p.w && p.w.fire) fireZones.push({ x, z, r: p.splash, t: 5, dps: p.w.fire, team: p.team, src: p.src, fxT: 0 });
      if (p.w && p.w.emp) { sfx('art_emp', x, z); for (const e of ents) if (e.alive && e.kind === 'unit' && e.team !== p.team && Math.hypot(e.x - x, e.z - z) < p.splash) e.stun = p.w.emp; for (let s = 0; s < 6; s++) fx('spark', x + rand(-2, 2), y + rand(0, 2), z + rand(-2, 2), 1.2); }
      if (p.realT && p.realT.alive && Math.hypot(p.realT.x - x, p.realT.z - z) < p.splash + p.realT.r) damage(p.realT, p.dmg, p.src);
      if (p.tgt.alive) damage(p.tgt, p.dmg, p.src);
      if (p.splash) for (const e of ents) if (e.alive && e.team !== p.team && e !== p.tgt && !flying(e) && Math.hypot(e.x - x, e.z - z) < p.splash + e.r * 0.5) damage(e, p.dmg * 0.5, p.src);
    }
  }
  updTracers(dt);
  for (const t of beams) if (t.m.visible) { t.life -= dt; t.m.scale.x = t.m.scale.y = Math.max(0.2, t.life / 0.14); if (t.life <= 0) t.m.visible = false; }
}

// wrecks
const wrecks = [];
const matWreck = new THREE.MeshLambertMaterial({ color: 0x2a2622, flatShading: true });
function addWreck(e) {
  let m;
  if (e.kind === 'unit') { m = new THREE.Mesh(unitGeo(e.d, e.pal).body, matWreck); m.position.set(e.x, e.y - 0.15, e.z); m.rotation.set(rand(-0.2, 0.2), e.heading, rand(-0.2, 0.2)); }
  else { const B = new Builder(); for (let i = 0; i < 9; i++) B.add(G.ico, rand(0.6, 1.6), rand(0.3, 0.9), rand(0.6, 1.6), rand(-e.r, e.r) * 0.7, 0, rand(-e.r, e.r) * 0.7, pick([0x3a3530, 0x2a2622, 0x4a443c]), rand(0, 3), rand(0, 3), 0); m = new THREE.Mesh(B.build(), matVC); m.position.set(e.x, e.y, e.z); }
  let fly = null;
  if (e.kind === 'unit' && e.legs) { m.geometry = e.tur.geometry; m.position.set(e.x, heightAt(e.x, e.z) + 0.25, e.z); m.rotation.set(-Math.PI / 2 + rand(-0.2, 0.2), e.heading, rand(-0.3, 0.3)); scene.add(m); wrecks.push({ m, fly: null, life: 14, smokeT: 0, x: e.x, y: e.y, z: e.z }); return; }
  if (e.kind === 'unit' && flying(e)) { const t = new THREE.Mesh(e.tur.geometry, matWreck); t.position.y = unitGeo(e.d, e.pal).turY; m.add(t); m.position.set(e.x, e.y, e.z);
    fly = { m, vx: e.vx * 0.8, vy: 1, vz: e.vz * 0.8, sx: rand(-2, 2), sz: rand(-4, 4), rest: false, trail: 0, crash: true }; scene.add(m); wrecks.push({ m: new THREE.Object3D(), fly, life: 25, smokeT: 0, x: e.x, y: e.y, z: e.z }); return; }
  if (e.kind === 'unit' && e.tur) { const tm = new THREE.Mesh(e.tur.geometry, matWreck); const ty = e.heading + (e.turYaw || 0); tm.position.set(e.x, e.y + (e.h || 1.5) - 0.4, e.z); tm.rotation.set(0, ty, 0); scene.add(tm);
    if (Math.random() < 0.65 && Math.abs(e.x - cam.x) < 140 && Math.abs(e.z - cam.z) < 140) { const a = rand(0, TAU), hs = rand(1.5, 4.5); fly = { m: tm, vx: Math.sin(a) * hs, vy: rand(8, 14), vz: Math.cos(a) * hs, sx: rand(-6, 6), sz: rand(-6, 6), rest: false, trail: 0 }; }
    else { tm.rotation.set(rand(-0.15, 0.15), ty + rand(-0.4, 0.4), rand(-0.15, 0.15)); fly = { m: tm, rest: true }; } }
  scene.add(m); wrecks.push({ m, fly, life: e.kind === 'unit' ? 25 : 60, smokeT: 0, x: e.x, y: e.y, z: e.z, big: e.kind !== 'unit' });
}
function updWrecks(dt) {
  for (let i = wrecks.length - 1; i >= 0; i--) {
    const w = wrecks[i]; w.life -= dt; w.smokeT -= dt;
    if (w.smokeT <= 0 && w.life > 8) { w.smokeT = w.big ? 0.25 : 0.6; fx('smoke', w.x + rand(-1, 1), w.y + 1, w.z + rand(-1, 1), w.big ? 1.2 : 0.6); }
    const f = w.fly; if (f && !f.rest) { f.vy -= 24 * dt; const P = f.m.position; P.x += f.vx * dt; P.y += f.vy * dt; P.z += f.vz * dt; f.m.rotation.x += f.sx * dt; f.m.rotation.z += f.sz * dt;
      f.trail -= dt; if (f.trail <= 0) { f.trail = 0.04; fx('blacksmoke', P.x, P.y, P.z, 0.5); if (Math.random() < 0.5) fx('fire', P.x, P.y, P.z, 0.4); }
      const gy = heightAt(P.x, P.z) + 0.25; if (P.y < gy && f.vy < 0) { P.y = gy; if (f.crash) { f.crash = false; explosion(P.x, gy + 0.5, P.z, 1); w.x = P.x; w.z = P.z; w.y = gy; f.vy = -2; f.vx *= 0.3; f.vz *= 0.3; } if (f.vy < -4) { f.vy *= -0.32; f.vx *= 0.55; f.vz *= 0.55; f.sx *= 0.4; f.sz *= 0.4; fx('dust', P.x, gy, P.z, 1); if (Math.random() < 0.6) sfx('debris', P.x, P.z); } else { f.rest = true; f.m.rotation.x = rand(-0.5, 0.5) + (Math.random() < 0.3 ? Math.PI : 0); f.m.rotation.z = rand(-0.4, 0.4); } } }
    if (w.life < 3) { w.m.position.y -= dt * 0.4; if (f) f.m.position.y -= dt * 0.4; }
    if (w.life <= 0) { scene.remove(w.m); if (f) scene.remove(f.m); wrecks.splice(i, 1); }
  }
}

// ================= COMBAT =================
let heat = 0, lastAlert = -99;
const pings = [];
function damage(e, amt, src) {
  if (!e.alive || S.over) return;
  e.hp -= amt; e.lastHit = S.time;
  heat = Math.min(1.5, heat + amt * (e.team === 0 ? 0.01 : 0.005));
  if (e.team === 0 && S.time - lastAlert > 25) { lastAlert = S.time; teamToast('⚠ Ești atacat!', 'alert', e.x, e.z); }
  if (e.kind === 'unit' && src && src.alive && e.st.range > 0 && (e.state === 'idle' || e.state === 'patrol') && e.fire !== 2) { e.target = src; e.state = 'engage'; e.lx = e.x; e.lz = e.z; }
  if (e.hp <= 0) { if (src && src.kind === 'unit' && src.alive) { src.kills = (src.kills || 0) + 1; const rk = src.kills >= 15 ? 3 : src.kills >= 8 ? 2 : src.kills >= 3 ? 1 : 0; if (rk > (src.rank || 0)) { src.rank = rk; if (src.team === 0) fx('spark', src.x, src.y + 2, src.z, 1.4); } } kill(e); }
}
function kill(e) {
  e.alive = false; e.hp = 0; scene.remove(e.mesh);
  if (e.kind === 'unit') { TEAMS[e.team].units--; explosion(e.x, e.y + 0.8, e.z, 1); addWreck(e); if (e.team === 0) S.stats.lost++; else S.stats.killed++; }
  else {
    explosion(e.x, e.y + 1.5, e.z, 2.4);
    for (let k = 0; k < 3; k++) later(0.25 * (k + 1), () => explosion(e.x + rand(-e.r, e.r), e.y + rand(1, 3), e.z + rand(-e.r, e.r), 1.4));
    if (e.well && e.well.pump === e) e.well.pump = null; addWreck(e);
  }
  if (e.selected) { e.selected = false; sel = sel.filter(s => s !== e); panelSig = ''; }
}
const timers = []; function later(t, fn) { timers.push({ t: S.time + t, fn }); }

// radar spotting: enemies near a friendly radar tower / radar vehicle can be shelled by artillery emplacements from afar
const SPOT = [[], []]; let spotT = 0;
function updSpot(dt) { spotT -= dt; if (spotT > 0) return; spotT = 0.5;
  for (let t = 0; t < 2; t++) { const src = []; const adv = TEAMS[t].tech.has('radar2');
    for (const e of ents) if (e.alive && e.team === t && ((e.type === 'radartower' && e.complete) || (e.kind === 'unit' && e.st.w.kind === 'radar'))) src.push([e.x, e.z, e.kind === 'bld' ? (adv ? 80 : 60) : (adv ? 52 : 40)]);
    const out = []; if (src.length) for (const e of ents) { if (!e.alive || e.team === t || (e.team !== 0 && e.team !== 1)) continue; for (const [x, z, r] of src) if (Math.hypot(e.x - x, e.z - z) < r) { out.push(e); break; } }
    SPOT[t] = out; } }
function nearestSpotted(team, x, z, range) { let best = null, bd = 1e9; for (const e of SPOT[team] || []) { if (!e.alive || flying(e)) continue; const d = Math.hypot(e.x - x, e.z - z) - e.r; if (d < range && d < bd) { bd = d; best = e; } } return best; }
function nearestEnemy(team, x, z, range, w) {
  let best = null, bd = 1e9; const na = w && !canHitAir(w);
  for (const e of ents) { if (!e.alive || e.team === team || (na && flying(e))) continue; const d = Math.hypot(e.x - x, e.z - z) - e.r; if (d > range) continue; const s = d + (e.kind === 'bld' ? 5 : 0); if (s < bd) { bd = s; best = e; } }
  return best;
}
function inRange(u, t, extra) { return Math.hypot(t.x - u.x, t.z - u.z) - t.r <= u.st.range * (u.rb || 1) + (extra || 0); }

function fireWeapon(src, t, w, mx, my, mz, mul) {
  const dmg = w.dmg * (mul || 1) * (TEAMS[src.team].dmg[wfam(w)] || 1) * (1 + 0.1 * (src.rank || 0));
  if (src.kind === 'unit') src.kv = (src.kv || 0) + (w.kind === 'shell' ? 3.2 : w.kind === 'mortar' ? (w.art === 'how' ? 4 : 2.2) : w.kind === 'rocket' || w.kind === 'missile' ? 1 : 0.35) / Math.max(0.8, CH[src.d.ch].size);
  if (w.kind === 'shell') { const hx = (mx - src.x), hz = (mz - src.z), hl = Math.hypot(hx, hz) || 1; const big = (src.kind === 'bld' ? 1.25 : 1) * 3;
    if (Math.abs(mx - cam.x) < 140 && Math.abs(mz - cam.z) < 140) fireball3D(mx + hx / hl * 0.5 * big, my - big * 0.15, mz + hz / hl * 0.5 * big, 0.55 * big, null, 0, 0.55); fx('gunflash', mx, my, mz, 0.5 * big); fx('fire', mx + hx / hl * 0.6, my, mz + hz / hl * 0.6, 0.6); fx('muzzle', mx, my, mz, 1.6); }
  else if (w.kind === 'mg') fx('gunflash', mx, my, mz, 0.35);
  else fx('muzzle', mx, my, mz, 1.4);
  if (w.kind === 'mg') { const ty = t.y + (t.kind === 'bld' ? 1.5 : 0.7); tracer(mx, my, mz, t.x + rand(-0.4, 0.4), ty, t.z + rand(-0.4, 0.4)); if (Math.random() < 0.3) { fx('spark', t.x, ty, t.z, 1); if (Math.random() < 0.5) sfx('ric', t.x, t.z); } damage(t, dmg, src); sfx('mg', mx, mz); }
  else if (w.kind === 'shell') { spawnProj('shell', src, t, dmg, 0, mx, my, mz); const hx = mx - src.x, hz = mz - src.z, hl = Math.hypot(hx, hz) || 1; for (let i = 0; i < 6; i++) { const d = i * 1.6; fx('smoke', mx + hx / hl * d + rand(-0.8, 0.8), my + rand(-0.3, 0.6), mz + hz / hl * d + rand(-0.8, 0.8), 1.4 + i * 0.25); } fx('trail', mx, my, mz, 2.2); fx('dust', src.x, src.y + 0.3, src.z, 2.2); sfx('shell', mx, mz); }
  else if (w.kind === 'mortar') { spawnProj('mortar', src, t, dmg, w.splash, mx, my, mz, w); fx('smoke', mx, my, mz, w.big ? 2.6 : 1.5); fx('smoke', mx, my + 0.8, mz, w.big ? 2 : 1.1); fx('trail', mx, my, mz, w.big ? 2 : 1.2); fx('flash', mx, my, mz, w.big ? 1.2 : 0.6); sfx(ART_SND[w.id] || 'art_mortar', mx, mz); }
  else if (w.kind === 'salvo') { sfx(ART_SND[w.id], mx, mz);
    const ms = w.n === 1 ? (src.mslMesh || (src.parts && src.parts.msl)) : null; let mlen = 0;
    if (ms && S.time >= (src.mslT || 0)) { const v = new THREE.Vector3(); ms.getWorldPosition(v); mx = v.x; my = v.y; mz = v.z; mlen = ms.getWorldScale(v).x; ms.visible = false; src.mslT = S.time + w.rof * 0.7; reloadVis.push({ m: ms, t: src.mslT }); }
    for (let i = 0; i < w.n; i++) later(i * 0.12, () => { if (src.alive && t.alive) { spawnProj('mortar', src, { ...t, x: t.x + srand(-2.5, 2.5) * (w.n > 1 ? 1 : 0), z: t.z + srand(-2.5, 2.5) * (w.n > 1 ? 1 : 0), alive: false, kind: t.kind, y: t.y }, dmg, w.splash, mx, my, mz, w, t, mlen, !!mlen); fx('fire', mx, my, mz, w.big ? 1.4 : 0.55); fx('smoke', mx, my - 0.3, mz, w.big ? 3 : 1.4); fx('trail', mx, my, mz, w.big ? 2.6 : 1.2); if (w.big) fx('dust', src.x, src.y + 0.3, src.z, 4); } }); }
  else if (w.kind === 'flame') { const ty = t.y + (t.kind === 'bld' ? 1.2 : 0.6);
    for (let k = 1; k <= 5; k++) { const f = k / 5; fx('flame', lerp(mx, t.x, f) + rand(-0.3, 0.3), lerp(my, ty, f) + rand(-0.2, 0.3), lerp(mz, t.z, f) + rand(-0.3, 0.3), 0.6 + f * 1.1); }
    if (Math.random() < 0.4) fx('smoke', t.x, ty + 1, t.z, 0.7); damage(t, dmg, src);
    for (const e of ents) if (e.alive && e !== t && e.team !== src.team && e.kind === 'unit' && !flying(e) && Math.hypot(e.x - t.x, e.z - t.z) < 2.4) damage(e, dmg * 0.5, src);
    sfx('flame', mx, mz); }
  else if (w.kind === 'laser') { const ty = t.y + (t.kind === 'bld' ? 1.5 : 0.7); beam(mx, my, mz, t.x, ty, t.z); fx('spark', t.x, ty, t.z, 1.4); fx('flash', t.x, ty, t.z, 0.8); damage(t, dmg, src); sfx('laser', mx, mz); }
  else if (w.kind === 'bomb') { const n = w.big ? 1 : 3, sp = w.big ? 0.3 : 2; for (let i = 0; i < n; i++) later(i * 0.14, () => { if (src.alive) spawnProj('mortar', src, { x: t.x + srand(-sp, sp), z: t.z + srand(-sp, sp), y: heightAt(t.x, t.z) - 0.8, kind: 'unit', alive: false }, dmg, w.splash, src.x, src.y - 0.4, src.z, w, t); }); sfx('whistle', t.x, t.z); }
  else if (w.kind === 'rocket') { for (let i = 0; i < 2; i++) later(i * 0.15, () => { if (src.alive && t.alive) { spawnProj('rocket', src, t, dmg, w.splash, mx, my, mz, w); if (w.heavy) { fx('fire', mx, my, mz, 0.7); fx('smoke', mx, my, mz, 1); } } }); sfx('rocket', mx, mz); }
}

// ================= MOVEMENT =================
function steer(u, tx, tz, dt, arrive) {
  const dx = tx - u.x, dz = tz - u.z; const d = Math.hypot(dx, dz);
  let dvx = 0, dvz = 0;
  if (d > arrive) {
    let sx = dx / d, sz = dz / d; let spd = u.st.speed; if (d < 3) spd *= Math.max(0.35, d / 3);
    let ax = 0, az = 0;
    const check = (ox, oz, or) => {
      const rx = ox - u.x, rz = oz - u.z; const proj = rx * sx + rz * sz; const look = 5 + or; if (proj < 0 || proj > look || proj - or > d) return;
      const perp = rx * sz - rz * sx; const need = or + u.r + 0.6; if (Math.abs(perp) >= need) return;
      const wgt = (1 - proj / look) * 2.2; if (perp > 0) { ax -= sz * wgt; az += sx * wgt; } else { ax += sz * wgt; az -= sx * wgt; }
    };
    if (!u.air) for (const o of obstNear(u.x, u.z)) check(o.x, o.z, o.r);
    if (!u.air) for (const e of ents) if (e.kind === 'bld' && e.alive && !e.def.flat && e !== u.buildTarget && e !== u.target && Math.abs(e.x - u.x) < 16 && Math.abs(e.z - u.z) < 16) check(e.x, e.z, e.r);
    sx += ax; sz += az; const l = Math.hypot(sx, sz) || 1; dvx = sx / l * spd; dvz = sz / l * spd;
  }
  const k = Math.min(1, dt * 5); u.vx = lerp(u.vx, dvx, k); u.vz = lerp(u.vz, dvz, k);
}
function collide(u) {
  if (u.air) { u.x = clamp(u.x, -EDGE, EDGE); u.z = clamp(u.z, -EDGE, EDGE); return; }
  for (const o of obstNear(u.x, u.z)) { const dx = u.x - o.x, dz = u.z - o.z; const m = o.r + u.r; const d2 = dx * dx + dz * dz; if (d2 < m * m && d2 > 1e-6) { const d = Math.sqrt(d2); u.x = o.x + dx / d * m; u.z = o.z + dz / d * m; } }
  for (const e of ents) { if (e.kind !== 'bld' || !e.alive || e.def.flat) continue; const dx = u.x - e.x, dz = u.z - e.z; const m = e.r + u.r; const d2 = dx * dx + dz * dz; if (d2 < m * m && d2 > 1e-6) { const d = Math.sqrt(d2); u.x = e.x + dx / d * m; u.z = e.z + dz / d * m; } }
  u.x = clamp(u.x, -EDGE, EDGE); u.z = clamp(u.z, -EDGE, EDGE);
}
function separate() { // spatial grid so hundreds of units stay cheap
  const C = 4, grid = new Map(), us = [];
  for (const e of ents) if (e.alive && e.kind === 'unit') { us.push(e); const k = Math.floor(e.x / C) * 4096 + Math.floor(e.z / C); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(e); }
  for (const a of us) { const gx = Math.floor(a.x / C), gz = Math.floor(a.z / C);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) { const c = grid.get((gx + ox) * 4096 + gz + oz); if (!c) continue;
      for (const b of c) { if (b.id <= a.id || flying(a) !== flying(b)) continue; const dx = b.x - a.x, dz = b.z - a.z; const m = a.r + b.r + 0.15; const d2 = dx * dx + dz * dz; if (d2 < m * m && d2 > 1e-6) { const d = Math.sqrt(d2); const o = (m - d) * 0.3; const nx = dx / d, nz = dz / d; a.x -= nx * o; a.z -= nz * o; b.x += nx * o; b.z += nz * o; } } } }
}

// ================= UNIT / BUILDING UPDATE =================
function supportTick(u, dt) {
  const w = u.st.w;
  if (w.kind === 'radar') {
    u.turYaw += dt * 1.8; u.tur.rotation.y = u.turYaw; u.sT = (u.sT || 0) - dt;
    if (u.sT <= 0) { u.sT = 0.5; const adv = TEAMS[u.team].tech.has('radar2'); const ar = w.aura * (adv ? 1.4 : 1); for (const e of ents) if (e.alive && e.kind === 'unit' && e.team === u.team && e !== u && e.st.w.dmg > 0 && Math.hypot(e.x - u.x, e.z - u.z) < ar) { e.rb = adv ? 1.35 : 1.25; e.rbT = 1.2; } }
    return;
  }
  if (w.kind === 'repair') {
    u.sT = (u.sT || 0) - dt;
    if (u.sT <= 0) { u.sT = 0.6; let best = null, bd = 18;
      for (const e of ents) if (e.alive && e.team === u.team && e !== u && e.hp < e.maxHp && (e.kind === 'unit' || e.complete)) { const d = Math.hypot(e.x - u.x, e.z - u.z) - e.r; if (d < bd) { bd = d; best = e; } }
      u.heal = best;
      if (best && bd > w.reach + (TEAMS[u.team].tech.has('repair2') ? 3 : 0) && (u.state === 'idle' || u.state === 'heal')) { u.state = 'heal'; u.tx = best.x; u.tz = best.z; }
      else if (u.state === 'heal' && (!best || bd <= w.reach + (TEAMS[u.team].tech.has('repair2') ? 3 : 0))) { u.state = 'idle'; } }
    const t = u.heal; const fast = TEAMS[u.team].tech.has('repair2');
    if (t && t.alive && t.hp < t.maxHp && Math.hypot(t.x - u.x, t.z - u.z) - t.r <= w.reach + (fast ? 3 : 0)) {
      t.hp = Math.min(t.maxHp, t.hp + w.heal * (fast ? 1.8 : 1) * dt * (t.kind === 'bld' ? 1.5 : 1));
      const a = Math.atan2(t.x - u.x, t.z - u.z); u.turYaw += clamp(angDiff(u.turYaw, angDiff(u.heading, a)), -4 * dt, 4 * dt);
      if (Math.random() < dt * 8) { const ty = t.y + (t.kind === 'bld' ? 1.5 : 0.8); tracer(u.x, u.y + u.h - 0.2, u.z, t.x + rand(-0.4, 0.4), ty, t.z + rand(-0.4, 0.4)); fx('spark', t.x + rand(-0.5, 0.5), ty, t.z + rand(-0.5, 0.5), 0.8); }
      if (u.team === 0 && Math.random() < dt * 2) sfx('weld', u.x, u.z);
    }
  }
}
// ---- VTOL: attack runs with limited ammunition, then return to a rearming pad (one aircraft per pad) ----
function padFor(u) {
  let best = null, bs = 1e9;
  for (const e of ents) { if (!e.alive || e.team !== u.team || e.type !== 'vpad' || !e.complete) continue;
    let load = 0; for (const o of ents) if (o.alive && o !== u && o.pad === e && o.kind === 'unit') load++;
    const sc = Math.hypot(e.x - u.x, e.z - u.z) + load * 60; if (sc < bs) { bs = sc; best = e; } }
  return best;
}
function vtolTick(u, dt) {
  const w = u.st.w, s = CH[u.d.ch].size;
  if (u.target && !u.target.alive) { u.target = null; if (u.state === 'attack' || u.state === 'engage') u.state = 'rearm'; }
  if (u.state === 'engage') u.state = 'attack';
  if (u.state === 'amove' && u.ammo > 0) { u.acq -= dt; if (u.acq <= 0) { u.acq = 0.4; const t = nearestEnemy(u.team, u.x, u.z, 34, w); if (t) { u.target = t; u.state = 'attack'; } } }
  if (u.state === 'attack' && u.ammo <= 0) { u.state = 'rearm'; u.target = null; }
  if (u.state === 'rearm' && (!u.pad || !u.pad.alive)) u.pad = padFor(u);
  let tx = null, tz = null, land = false, fast = false, landY = 0;
  if (u.state === 'attack' && u.target) { tx = u.target.x; tz = u.target.z; fast = true; u.atPad = false; }
  else if (u.state === 'move' || u.state === 'amove') { tx = u.tx; tz = u.tz; u.atPad = false; if (Math.hypot(tx - u.x, tz - u.z) < 1.5) { u.state = 'idle'; u.amove = false; } }
  else if (u.state === 'rearm') {
    if (u.pad) { const p = u.pad; const busy = ents.some(o => o.alive && o !== u && o.atPad === p);
      if (busy && SR() < dt) { const q = padFor(u); if (q && !ents.some(o => o.alive && o !== u && o.atPad === q)) u.pad = q; }
      if (busy) { const a = S.time * 0.6 + u.id; tx = p.x + Math.sin(a) * 9; tz = p.z + Math.cos(a) * 9; } // wait in a holding circle
      else { tx = p.x; tz = p.z; land = true; landY = 0.35;
        if (Math.hypot(tx - u.x, tz - u.z) < 1.2 && u.alt < 0.5) { u.atPad = p; u.rt = (u.rt || 0) + dt; const per = 4.5 / u.maxAmmo;
          while (u.rt > per && u.ammo < u.maxAmmo) { u.rt -= per; u.ammo++; fx('spark', u.x + rand(-1, 1), u.y + 0.8, u.z + rand(-1, 1), 0.8); if (u.team === 0 && Math.random() < 0.5) sfx('weld', u.x, u.z); }
          u.hp = Math.min(u.maxHp, u.hp + 30 * dt);
          if (u.ammo >= u.maxAmmo && u.hp >= u.maxHp) { u.rt = 0; u.atPad = false; u.pad = null; const a = (u.id * 2.39) % TAU; u.state = 'move'; u.tx = clamp(p.x + Math.sin(a) * 7, -EDGE, EDGE); u.tz = clamp(p.z + Math.cos(a) * 7, -EDGE, EDGE); } } } }
    else { // no pad: wait beside the aircraft factory, unarmed
      const f = ents.find(e => e.alive && e.team === u.team && e.type === 'airfactory');
      if (f) { tx = f.x + Math.sin(f.rot) * (f.r + 6); tz = f.z + Math.cos(f.rot) * (f.r + 6); land = true; }
      if (u.team === 0 && !u.warned) { u.warned = true; teamToast('✈ Construiește o Platformă de realimentare — aeronavele fără muniție așteaptă'); } }
  }
  if (u.state === 'idle') land = true;
  if (u.state !== 'rearm') u.warned = false;
  const spd = u.st.speed;
  const dist = tx === null ? 0 : Math.hypot(tx - u.x, tz - u.z);
  if (tx !== null && !(land && dist < 1.2)) {
    const want = Math.atan2(tx - u.x, tz - u.z), turn = fast ? 1.8 : 2.6;
    if (fast && dist < 5 && !(u.egress > 0)) u.egress = 1.4; // attack run: fly straight past the target, then turn back for the next pass
    if (u.egress > 0) u.egress -= dt; else u.heading += clamp(angDiff(u.heading, want), -turn * dt, turn * dt);
    let v = spd * clamp(u.alt / (VTOL_ALT * 0.6), 0.15, 1); if (!fast) { if (dist < 10) v *= Math.max(0.2, dist / 10); v *= Math.max(0.2, Math.cos(Math.min(Math.PI / 2, Math.abs(angDiff(u.heading, want))))); }
    const k = Math.min(1, dt * 2.2); u.vx = lerp(u.vx, Math.sin(u.heading) * v, k); u.vz = lerp(u.vz, Math.cos(u.heading) * v, k);
    u.alt = Math.min(VTOL_ALT, u.alt + dt * 7);
  } else {
    const k = Math.min(1, dt * 2.5); u.vx = lerp(u.vx, 0, k); u.vz = lerp(u.vz, 0, k);
    if (tx !== null) { u.x = lerp(u.x, tx, Math.min(1, dt * 3)); u.z = lerp(u.z, tz, Math.min(1, dt * 3)); }
    if (land) u.alt = Math.max(landY, u.alt - dt * 4.5);
  }
  u.x += u.vx * dt; u.z += u.vz * dt; u.x = clamp(u.x, -EDGE, EDGE); u.z = clamp(u.z, -EDGE, EDGE);
  u.turYaw = 0; u.tur.rotation.y = 0;
  const t = u.target;
  if (u.state === 'attack' && t && t.alive && u.ammo > 0 && u.alt > VTOL_ALT * 0.6) { u.cd -= dt;
    const d = Math.hypot(t.x - u.x, t.z - u.z) - t.r, a = Math.atan2(t.x - u.x, t.z - u.z);
    if (d <= u.st.range && Math.abs(angDiff(u.heading, a)) < (w.kind === 'bomb' ? 1.0 : 0.38) && u.cd <= 0) {
      fireWeapon(u, t, w, u.x + Math.sin(u.heading) * 1.8 * s, u.y + 0.5, u.z + Math.cos(u.heading) * 1.8 * s, 1); u.ammo--;
      u.cd = u.cdMax = w.rof * (w.kind === 'mg' ? 1 : 1.6) * (TEAMS[u.team].rof[wfam(w)] || 1); } }
  else u.cd = Math.max(0, u.cd - dt);
}
// ---- standing orders (fire / movement / retreat), patrol, return, recycle
const resume = u => u.pat ? 'patrol' : u.amove ? 'amove' : 'idle';
function homeFor(u, types) {   // nearest own building of one of the types, the unit's own player first
  let best = null, bd = 1e9;
  for (const e of ents) if (e.alive && e.kind === 'bld' && e.team === u.team && e.complete && types.includes(e.type)) {
    const d = Math.hypot(e.x - u.x, e.z - u.z) + (e.pal === u.pal ? 0 : 400); if (d < bd) { bd = d; best = e; } }
  return best;
}
function sendTo(u, b, state) {
  const a = Math.atan2(u.x - b.x, u.z - b.z), r = b.r + (state === 'recycle' ? 1.5 : 3.5);
  u.state = state; u.rto = b; u.target = null; u.amove = false; u.pat = null; u.buildTarget = null;
  u.tx = r1(b.x + Math.sin(a) * r); u.tz = r1(b.z + Math.cos(a) * r);
}
function goRetreat(u, forced) {
  const b = homeFor(u, ['repairbay']) || (forced ? null : homeFor(u, ['hq', 'factory', 'cybfactory']));
  if (!b) { u.retHold = true; return false; } sendTo(u, b, 'retreat'); return true;
}
function recycleUnit(u) {
  const T = TEAMS[u.team]; T.energy += Math.round(unitStats(u.d, u.team).cost * 0.5 * Math.max(0.2, u.hp / u.maxHp));
  u.alive = false; u.hp = 0; scene.remove(u.mesh); T.units--;
  for (let k = 0; k < 6; k++) fx('spark', u.x + rand(-1, 1), u.y + rand(0.3, 1.6), u.z + rand(-1, 1), 1);
  if (u.selected) { u.selected = false; sel = sel.filter(s => s !== u); panelSig = ''; }
}
function updUnit(u, dt) {
  const w = u.st.w;
  if (u.air === 'vtol' && !(u.stun > 0)) { vtolTick(u, dt); unitVisual(u, dt); return; }
  if (u.air === 'rotor') u.alt = Math.min(DRONE_ALT, (u.alt || 0) + dt * 4);
  if (u.stun > 0) { u.stun -= dt; u.vx *= 0.8; u.vz *= 0.8; if (Math.random() < dt * 6) fx('spark', u.x + rand(-0.6, 0.6), u.y + u.h * 0.7, u.z + rand(-0.6, 0.6), 0.8); return; }
  if (u.rbT > 0) { u.rbT -= dt; if (u.rbT <= 0) u.rb = 1; }
  if (w.kind === 'radar' || w.kind === 'repair') supportTick(u, dt);
  if (u.ret && !u.isTruck) { const thr = u.maxHp * (u.ret === 1 ? 0.5 : 0.25);
    if (u.hp >= thr) u.retHold = false;
    else if (!u.retHold && u.state !== 'retreat' && u.state !== 'recycle') goRetreat(u, false); }
  if (u.state === 'retreat' && u.hp >= u.maxHp * 0.98) { u.state = 'idle'; u.rto = null; }
  if (u.target && !u.target.alive) { u.target = null; if (u.state === 'engage' || u.state === 'attack') u.state = resume(u); }
  u.acq -= dt;
  if (w.dmg > 0 && u.acq <= 0 && u.state !== 'attack' && u.state !== 'retreat' && u.state !== 'recycle' && u.fire === 0) {
    u.acq = 0.35 + SR() * 0.15;
    const passive = u.state === 'move'; const vis = (w.art ? w.sight : u.st.range) + (passive || u.mvo === 2 ? 0 : 9);
    if (!u.target || !inRange(u, u.target)) {
      const t = nearestEnemy(u.team, u.x, u.z, vis, w) || (w.art && !passive ? nearestSpotted(u.team, u.x, u.z, u.st.range) : null);
      if (t) { u.target = t; if (u.state === 'idle' || u.state === 'amove' || u.state === 'patrol') { if (u.state === 'idle') { u.lx = u.x; u.lz = u.z; } u.state = 'engage'; } }
      else if (passive && u.target && !inRange(u, u.target, 4)) u.target = null;
    }
  }
  if (u.defending && u.post && Math.hypot(u.x - u.post.x, u.z - u.post.z) > (u.post.citadel ? 60 : 42)) { u.defending = false; u.target = null; u.amove = false; u.state = 'move'; u.tx = u.post.x + srand(-8, 8); u.tz = u.post.z + srand(-8, 8); }
  let mx = null, mz = null, arrive = 0.6;
  switch (u.state) {
    case 'heal': if (u.heal && u.heal.alive) { u.tx = u.heal.x; u.tz = u.heal.z; } // fallthrough
    case 'move': case 'amove': mx = u.tx; mz = u.tz; arrive = 0.8; if (Math.hypot(u.tx - u.x, u.tz - u.z) < 1.3) { u.state = 'idle'; u.amove = false; } break;
    case 'patrol': mx = u.tx; mz = u.tz; arrive = 0.8; if (!u.pat) { u.state = 'idle'; break; }
      if (Math.hypot(u.tx - u.x, u.tz - u.z) < 1.5) { const ox = u.tx, oz = u.tz; u.tx = u.pat.x; u.tz = u.pat.z; u.pat = { x: ox, z: oz }; } break;
    case 'retreat': case 'recycle': { const b = u.rto;
      if (!b || !b.alive) { u.state = 'idle'; u.rto = null; break; }
      mx = u.tx; mz = u.tz; arrive = 0.8;
      if (Math.hypot(u.tx - u.x, u.tz - u.z) < 2.2) { mx = null;
        if (u.state === 'recycle') { recycleUnit(u); return; }
        if (b.type !== 'repairbay') { u.state = 'idle'; u.rto = null; u.retHold = true; } }
      break; }
    case 'engage': case 'attack': {
      const t = u.target; if (!t || !t.alive) { u.state = resume(u); u.target = null; break; }
      const d = Math.hypot(t.x - u.x, t.z - u.z) - t.r;
      if (u.state === 'engage') {
        if (u.mvo === 2 && d > u.st.range) { u.target = null; u.state = resume(u); break; }
        const over = u.mvo === 0 ? 45 : 14, leash = u.mvo === 0 ? 80 : 24;
        if (d > u.st.range + over || (!u.amove && !u.pat && Math.hypot(u.x - u.lx, u.z - u.lz) > leash)) { u.target = null; if (u.amove || u.pat) u.state = resume(u); else { u.state = 'move'; u.tx = u.lx; u.tz = u.lz; } break; }
      }
      if (d > u.st.range * 0.9 && !(u.mvo === 2 && u.state === 'engage')) { mx = t.x; mz = t.z; arrive = 0; }
      break;
    }
    case 'build': {
      const b = u.buildTarget;
      if (!b || !b.alive || (b.complete && b.hp >= b.maxHp)) { u.state = 'idle'; u.buildTarget = null; truckAuto(u); break; }
      const d = Math.hypot(b.x - u.x, b.z - u.z) - b.r - u.r;
      if (d > 1.3) { mx = b.x; mz = b.z; arrive = 0; }
      else {
        if (!b.complete) { b.built += dt / b.def.time; b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * dt / b.def.time); if (b.built >= 1) completeBld(b); }
        else b.hp = Math.min(b.maxHp, b.hp + 30 * dt);
        if (Math.random() < dt * 10) fx('spark', b.x + rand(-b.r, b.r) * 0.6, b.y + rand(0.5, 3), b.z + rand(-b.r, b.r) * 0.6, 1);
        const a = Math.atan2(b.x - u.x, b.z - u.z); u.turYaw += clamp(angDiff(u.turYaw, angDiff(u.heading, a)), -4 * dt, 4 * dt);
        if (u.team === 0 && Math.random() < dt * 3) sfx('weld', u.x, u.z);
      }
      break;
    }
  }
  if (mx !== null) steer(u, mx, mz, dt, arrive); else { const k = Math.max(0, 1 - dt * 8); u.vx *= k; u.vz *= k; }
  u.x += u.vx * dt; u.z += u.vz * dt; collide(u);

  // aim & fire
  const t = u.target;
  if (t && flying(t) && !canHitAir(w)) { u.target = null; if (u.state === 'engage' || u.state === 'attack') u.state = resume(u); }
  else if (t && t.alive && w.dmg > 0) {
    const a = Math.atan2(t.x - u.x, t.z - u.z); const local = angDiff(u.heading, a);
    u.turYaw += clamp(angDiff(u.turYaw, local), -5 * dt, 5 * dt);
    u.cd -= dt;
    if (inRange(u, t, 0.5) && Math.abs(angDiff(u.turYaw, local)) < 0.25 && u.cd <= 0) {
      const wy = u.heading + u.turYaw; const s = CH[u.d.ch].size;
      const ml = (w.kind === 'shell' ? 3.9 : w.kind === 'laser' ? 2.3 : w.kind === 'flame' ? 1.5 : w.kind === 'mortar' ? (w.art === 'how' ? 2.2 : 1.2) : 1.6) * s; fireWeapon(u, t, w, u.x + Math.sin(wy) * ml, u.y + u.h - 0.3, u.z + Math.cos(wy) * ml, u.rb > 1.3 ? 1.25 : u.rb > 1 ? 1.15 : 1);
      u.cd = u.cdMax = w.rof * srand(0.9, 1.1) * (TEAMS[u.team].rof[wfam(w)] || 1);
    }
  } else if ((!u.isTruck || u.state !== 'build') && w.kind !== 'radar' && !(w.kind === 'repair' && u.heal)) { u.cd = Math.max(0, u.cd - dt); u.turYaw += clamp(angDiff(u.turYaw, 0), -2 * dt, 2 * dt); }
  u.tur.rotation.y = u.turYaw;
  const sp = Math.hypot(u.vx, u.vz);
  if (sp > 0.4) { const th = Math.atan2(u.vx, u.vz); u.heading += clamp(angDiff(u.heading, th), -5 * dt, 5 * dt); }
  unitVisual(u, dt);
}
function unitVisual(u, dt) {
  u.y = heightAt(u.x, u.z) + (u.alt || 0); let yy = u.y;
  if (u.air === 'rotor') { u.bob += dt * 2.2; yy += Math.sin(u.bob) * 0.18; }
  if (u.rotors) for (let i = 0; i < u.rotors.length; i++) u.rotors[i].rotation.y += dt * (i % 2 ? 38 : -38);
  if (u.legs) { const v = Math.hypot(u.vx, u.vz); u.walk += dt * v * 3.4; const a = Math.sin(u.walk) * 0.6 * Math.min(1, v / 1.2); u.legs[0].rotation.x = a; u.legs[1].rotation.x = -a; yy += Math.abs(Math.cos(u.walk)) * 0.06 * Math.min(1, v); }
  if (u.air === 'vtol' && u.alt > 0.3) { if (Math.random() < dt * 14) { const sh = Math.sin(u.heading), ch = Math.cos(u.heading); for (const sx of [-1, 1]) fx('trail', u.x - ch * sx * 1.6 - sh * 1.4, yy + 0.6, u.z + sh * sx * 1.6 - ch * 1.4, 0.35); } if (u.alt < 4 && Math.random() < dt * 10) fx('dust', u.x + rand(-1.5, 1.5), heightAt(u.x, u.z) + 0.2, u.z + rand(-1.5, 1.5), 1.2); }
  if (u.d.pr === 'hover') { u.bob += dt * 3; yy += 0.2 + Math.sin(u.bob) * 0.08; }
  const sp = Math.hypot(u.vx, u.vz);
  const sh = Math.sin(u.heading), ch = Math.cos(u.heading);
  const hf = heightAt(u.x + sh, u.z + ch), hb = heightAt(u.x - sh, u.z - ch), hr = heightAt(u.x + ch, u.z - sh), hl = heightAt(u.x - ch, u.z + sh);
  const flat = u.d.pr === 'hover' || (u.air && u.alt > 0.5) || u.legs; let pitch = flat ? 0 : -Math.atan2(hf - hb, 2), roll = flat ? 0 : Math.atan2(hr - hl, 2);
  if (dt > 0) { // suspension physics: recoil spring + lean from acceleration and turning
    u.kk = u.kk || 0; u.kv = u.kv || 0; u.kv += (-60 * u.kk - 7 * u.kv) * dt; u.kk += u.kv * dt;
    const fwd = u.vx * sh + u.vz * ch, acc = clamp((fwd - (u.pf || 0)) / dt, -40, 40), turn = angDiff(u.ph === undefined ? u.heading : u.ph, u.heading) / dt; u.pf = fwd; u.ph = u.heading;
    const hv = u.air ? 3 : u.d.pr === 'hover' ? 2 : u.legs ? 0.3 : 1, tp = clamp(-acc * 0.006 * hv, -0.09, 0.09), tr = clamp(-turn * fwd * 0.012 * hv, -0.1, 0.1), kf = Math.min(1, dt * 5);
    u.lp = lerp(u.lp || 0, tp, kf); u.lr = lerp(u.lr || 0, tr, kf);
    const ty = u.turYaw || 0, k = u.kk * 0.25; pitch += u.lp - k * Math.cos(ty); roll += u.lr + k * Math.sin(ty);
    const rc = Math.max(0, u.kk) * 0.9; u.tur.position.x = -Math.sin(ty) * rc; u.tur.position.z = -Math.cos(ty) * rc; }
  u.mesh.position.set(u.x, yy, u.z); u.mesh.rotation.set(pitch, u.heading, roll);
  if (sp > 1 && !u.air && !u.legs && Math.abs(u.x - cam.x) < 60 && Math.abs(u.z - cam.z) < 60 && Math.random() < dt * 4) fx('smoke', u.x - sh * 1.4 * CH[u.d.ch].size, yy + 0.6, u.z - ch * 1.4 * CH[u.d.ch].size, 0.22);
  if (sp > 2 && !u.air && Math.random() < dt * (u.d.pr === 'hover' ? 8 : u.legs ? 1 : 4)) fx('dust', u.x - sh * 1.2, u.y + 0.3, u.z - ch * 1.2, u.d.pr === 'hover' ? 0.9 : 0.6);
  if (u.hp < u.maxHp * 0.5) { u.smokeT -= dt; if (u.smokeT <= 0) { u.smokeT = 0.25; fx('smoke', u.x, yy + 1.2, u.z, 0.5); if (u.hp < u.maxHp * 0.25) fx('fire', u.x, yy + 1, u.z, 0.45); } }
}

function truckAuto(u) {
  let best = null, bd = 30;
  for (const e of ents) if (e.alive && e.kind === 'bld' && e.team === u.team && !e.complete) { const d = Math.hypot(e.x - u.x, e.z - u.z); if (d < bd) { bd = d; best = e; } }
  if (best) { u.state = 'build'; u.buildTarget = best; }
}

function localToWorld(b, lx, lz) { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; }
// strategic missile silo: lids slide open, missile rises out of the shaft, hot launch, lids close, long reload
function siloTarget(b) { let t = nearestSpotted(b.team, b.x, b.z, 1e9); if (t) return t; let best = null, bd = 1e9;
  for (const e of ents) if (e.alive && e.team !== b.team && e.kind === 'bld' && (e.team === 0 || e.team === 1)) { const d = Math.hypot(e.x - b.x, e.z - b.z); if (d < bd) { bd = d; best = e; } } return best; }
function siloTick(b, dt) { const P = b.parts, L = P.mslL, w = WP.icbm; if (b.sPh === undefined) { b.sPh = 'idle'; b.sT = 6; }
  b.sT -= dt; const lid = k => { P.lidL.position.x = -1.45 - 2.7 * k; P.lidR.position.x = 1.45 + 2.7 * k; };
  if (b.sPh === 'idle') { if (b.sT <= 0) { const t = siloTarget(b); if (t) { b.sTarget = t; b.sPh = 'open'; b.sT = 1.4; sfx('art_hhow', b.x, b.z); } else b.sT = 2; } }
  else if (b.sPh === 'open') { lid(1 - Math.max(0, b.sT) / 1.4); if (b.sT <= 0) { b.sPh = 'rise'; b.sT = 1.6; P.msl.visible = true; } }
  else if (b.sPh === 'rise') { const k = 1 - Math.max(0, b.sT) / 1.6; P.msl.position.y = -L * 0.62 + L * 0.72 * (1 - Math.pow(1 - k, 2));
    if (Math.random() < 0.5) fx('steam', b.x + rand(-2, 2), b.y + 0.6, b.z + rand(-2, 2), 1.6);
    if (b.sT <= 0) { const t = b.sTarget && b.sTarget.alive ? b.sTarget : siloTarget(b);
      if (t) { fireWeapon(b, t, w, b.x, b.y + 4, b.z, 1); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; fx('blacksmoke', b.x + Math.sin(a) * 3, b.y + 0.8, b.z + Math.cos(a) * 3, 3.2); fx('dust', b.x + Math.sin(a) * 4.5, b.y + 0.4, b.z + Math.cos(a) * 4.5, 3); }
        fx('fireball', b.x, b.y + 1.5, b.z, 3); fx('flash', b.x, b.y + 2, b.z, 4); shockwave(b.x, b.z, 5); shake = Math.max(shake, 0.5 * Math.max(0, 1 - Math.hypot(b.x - cam.x, b.z - cam.z) / 120)); }
      P.msl.visible = false; P.msl.position.y = -L * 0.62; b.sPh = 'close'; b.sT = 1.6; } }
  else if (b.sPh === 'close') { lid(Math.max(0, b.sT) / 1.6); if (b.sT <= 0) { lid(0); b.sPh = 'idle'; b.sT = w.rof * (TEAMS[b.team].rof.art || 1); P.msl.visible = true; } } }
function updBld(b, dt) {
  if (!b.complete) { b.mesh.scale.y = 0.12 + 0.88 * b.built; return; }
  b.anim += dt; const T = TEAMS[b.team];
  if (b.parts.beam) { b.parts.beam.rotation.x = Math.sin(b.anim * 2.2) * 0.35; if (Math.random() < dt * 0.8) fx('smoke', b.x, b.y + 4, b.z, 0.4); }
  if (b.parts.dish) b.parts.dish.rotation.y += dt * 0.8;
  if (b.type === 'generator') {
    b.parts.fan.rotation.y += dt * 9; b.parts.glow.visible = Math.sin(b.anim * 6) > -0.6;
    if (Math.random() < dt * 3) { for (const [lx, lz] of [[1.6, -1.4], [-1.7, -1.7]]) { const [wx, wz] = localToWorld(b, lx, lz); fx('steam', wx, b.y + 4.8, wz, 1); } }
    if (Math.random() < dt * 1.5) { const [wx, wz] = localToWorld(b, 2.1, 1.5); fx('spark', wx, b.y + 3, wz, 1); }
  }
  if (FACT_TYPES.has(b.type)) {
    if (b.queue.length) {
      if (Math.random() < dt * 4) { const [wx, wz] = localToWorld(b, -2.6, -1.9); fx('smoke', wx, b.y + 7, wz, 0.9); }
      const d = b.queue[0]; const st = unitStats(d, b.team); b.prod += dt * T.prodMul;
      if (b.prod >= st.time) { if (T.units < CAP) { b.queue.shift(); b.prod = 0; spawnFromFactory(b, d); } else b.prod = st.time; }
    }
  }
  if (b.type === 'lab' && b.res) { b.resProg += dt * TEAMS[b.team].rsMul; if (Math.random() < dt * 2) fx('muzzle', b.x, b.y + 4.3, b.z, 1.5); if (b.resProg >= b.res.time) { const id = b.res.id; b.res = null; b.resProg = 0; b.lastRes = id; finishResearch(b.team, id); if (b.team === 0) { techPopup(id); } } }
  if (b.type === 'repairbay') {
    b.acq -= dt; if (b.acq <= 0) { b.acq = 0.5; const fast = T.tech.has('repair2');
      for (const e of ents) if (e.alive && e.kind === 'unit' && e.team === b.team && e.hp < e.maxHp && Math.hypot(e.x - b.x, e.z - b.z) < 11) { e.hp = Math.min(e.maxHp, e.hp + (fast ? 40 : 25) * 0.5); if (Math.random() < 0.6) { tracer(b.x + 0.8, b.y + 3.6, b.z, e.x, e.y + 0.8, e.z); fx('spark', e.x, e.y + 0.9, e.z, 0.8); } } }
  }
  if (b.type === 'silo' && b.parts.msl && b.complete) siloTick(b, dt);
  if (b.type === 'radartower') {
    b.acq -= dt; if (b.acq <= 0) { b.acq = 0.5; const adv = T.tech.has('radar2'), ar = adv ? 44 : 34;
      for (const e of ents) if (e.alive && e.kind === 'unit' && e.team === b.team && e.st.w.dmg > 0 && Math.hypot(e.x - b.x, e.z - b.z) < ar) { e.rb = adv ? 1.35 : 1.25; e.rbT = 1.2; } }
  }
  if (b.type === 'tower' || b.def.tw) {
    const wk = b.def.tw || (b.tier !== undefined ? TIERS[b.tier].tower : (T.tech.has('tower2') ? 'cannon' : 'mg'));
    for (const k of b.parts.wl) b.parts[k].visible = k === wk; const w = WP[wk]; const range = w.range + (b.def.rb !== undefined ? b.def.rb : 2);
    {
    b.acq -= dt; if (b.acq <= 0) { b.acq = 0.4; if (!b.target || !b.target.alive || Math.hypot(b.target.x - b.x, b.target.z - b.z) - b.target.r > (b.tgtR || range)) { const own = w.art ? w.sight + (b.def.rb || 0) : range; b.target = nearestEnemy(b.team, b.x, b.z, own, w); b.tgtR = own;
      if (!b.target && w.art) { const er = w.id === 'omissile' ? 1e9 : range; b.target = nearestSpotted(b.team, b.x, b.z, er); if (b.target) b.tgtR = er; } } }
    b.cd -= dt;
    if (b.target && b.target.alive) {
      const a = Math.atan2(b.target.x - b.x, b.target.z - b.z); const local = angDiff(b.rot, a); b.turYaw += clamp(angDiff(b.turYaw, local), -4 * dt, 4 * dt);
      if (b.cd <= 0 && Math.abs(angDiff(b.turYaw, local)) < 0.2) { const wy = b.rot + b.turYaw; const ts = b.def.ts || 1; fireWeapon(b, b.target, w, b.x + Math.sin(wy) * 2 * ts, b.y + (b.def.ty || 3.3) + 0.3 * ts, b.z + Math.cos(wy) * 2 * ts, b.def.dm || 1.3); b.cd = w.rof * (TEAMS[b.team].rof[wfam(w)] || 1); }
    }
    b.parts.tur.rotation.y = b.turYaw; }
  }
  if (b.hp < b.maxHp * 0.5) { b.smokeT -= dt; if (b.smokeT <= 0) { b.smokeT = 0.2; fx('smoke', b.x + rand(-1, 1), b.y + b.h, b.z + rand(-1, 1), 1); if (b.hp < b.maxHp * 0.3) fx('fire', b.x + rand(-1, 1), b.y + b.h * 0.8, b.z + rand(-1, 1), 0.9); } }
}
function spawnFromFactory(b, d) {
  const fxv = Math.sin(b.rot), fz = Math.cos(b.rot);
  const u = createUnit(b.team, d, b.x + fxv * (b.r + 1.6), b.z + fz * (b.r + 1.6), undefined, b.pal); u.heading = b.rot;
  if (b.team === 0) S.stats.built++;
  if (u.isTruck && b.team === 0) { truckAuto(u); if (u.state === 'build') return; }
  if (u.air === 'vtol' && padFor(u)) { u.state = 'rearm'; return; }
  const rx = b.rally ? b.rally.x : b.x + fxv * (b.r + 7) + srand(-3, 3), rz = b.rally ? b.rally.z : b.z + fz * (b.r + 7) + srand(-3, 3);
  orderMove([u], rx + srand(-1.5, 1.5), rz + srand(-1.5, 1.5), false, true);
}
function finishResearch(team, id) {
  const T = TEAMS[team]; if (T.tech.has(id)) return; T.tech.add(id); T.researching.delete(id);
  if (UPG[id]) UPG[id].fx(T, team);
  if (id === 'armor') { T.hpMul *= 1.25; for (const e of ents) if (e.alive && e.team === team) { const r = e.hp / e.maxHp; e.maxHp = Math.round(e.maxHp * 1.25); e.hp = e.maxHp * r; } }
  if (id === 'engine') { T.spdMul *= 1.2; for (const e of ents) if (e.alive && e.team === team && e.kind === 'unit') e.st.speed *= 1.2; }
  if (id === 'prod') T.prodMul = 1.4;
  if (id === 'cyborg') T.tech.add('legs'); if (id === 'drone') T.tech.add('rotor');
  panelSig = '';
}

// ================= ORDERS =================
const markerGeo = new THREE.RingGeometry(0.8, 1.1, 24).rotateX(-Math.PI / 2);
const markers = [];
function marker(x, z, color) { const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false })); m.position.set(x, heightAt(x, z) + 0.15, z); scene.add(m); markers.push({ m, t: 0.8 }); }
function orderMove(units, x, z, amove, silent) {
  const list = formation(units, x, z);
  if (silent) applyMove(list, amove); else doCmd(['mv', list, amove ? 1 : 0]);
  if (!silent) { marker(x, z, amove ? 0xff6040 : 0x80ff80); sfx('ack'); }
}
function applyMove(list, amove) {
  for (const [id, tx, tz] of list) { const u = byId(id); if (!u || !u.alive || u.kind !== 'unit') continue;
    u.tx = tx; u.tz = tz; u.state = amove ? 'amove' : 'move'; u.amove = !!amove; u.pat = null; u.rto = null; if (!amove) u.target = null; u.buildTarget = null; }
}
function formation(units, x, z) {
  const n = units.length; const cols = Math.ceil(Math.sqrt(n)); const rows = Math.ceil(n / cols); const sp = 2.8;
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw), fwx = -Math.sin(cam.yaw), fwz = -Math.cos(cam.yaw);
  return units.map((u, i) => {
    const c = i % cols, r = Math.floor(i / cols); const ox = (c - (cols - 1) / 2) * sp, oz = (r - (rows - 1) / 2) * sp;
    return [u.id, r1(clamp(x + rx * ox + fwx * oz, -EDGE, EDGE)), r1(clamp(z + rz * ox + fwz * oz, -EDGE, EDGE))];
  });
}
function orderAttack(units, t) { const us = units.filter(u => u.st.w.dmg > 0); if (us.length) { doCmd(['at', us.map(u => u.id), t.id]); marker(t.x, t.z, 0xff3020); sfx('ack'); } }
function orderBuild(trucks, b) { if (!trucks.length) return; doCmd(['bd', trucks.map(u => u.id), b.id]); sfx('ack'); }
const r1 = v => Math.round(v * 10) / 10;
// ---- commands: every change to the game goes through here so the host can run it for both players
// an order: alone it runs now; online it goes to the host, which puts it into a turn that every phone runs
function doCmd(c) { if (!NET.on || !NET.started) execCmd(c, 0); else if (NET.host) NET.pend.push([0, c]); else netSend({ t: 'c', c }); }
function execCmd(c, pal) {
  const T = TEAMS[0]; const U = ids => (ids || []).map(byId).filter(e => e && e.alive && e.team === 0);
  const say = m => { if (pal === myPal()) toast(m); };   // only the player who gave the order hears why it failed
  switch (c[0]) {
    case 'mv': applyMove(c[1].filter(x => { const u = byId(x[0]); return u && u.team === 0; }), c[2]); break;
    case 'at': { const t = byId(c[2]); if (!t || !t.alive) break; for (const u of U(c[1])) if (u.kind === 'unit' && u.st.w.dmg > 0 && !(flying(t) && !canHitAir(u.st.w))) { u.state = 'attack'; u.target = t; u.amove = false; u.pat = null; u.rto = null; } break; }
    case 'bd': { const b = byId(c[2]); if (!b || !b.alive || b.kind !== 'bld') break; for (const u of U(c[1])) if (u.isTruck) { u.state = 'build'; u.buildTarget = b; u.target = null; u.pat = null; } break; }
    case 'st': for (const u of U(c[1])) if (u.kind === 'unit') { u.state = 'idle'; u.target = null; u.amove = false; u.pat = null; u.rto = null; u.vx = u.vz = 0; } break;
    case 'or': { const k = c[2], v = c[3] | 0; if (!['fire', 'mvo', 'ret'].includes(k) || v < 0 || v > 2) break;
      for (const u of U(c[1])) if (u.kind === 'unit') { u[k] = v; if (k === 'fire' && v && u.state === 'engage') { u.target = null; u.state = resume(u); } if (k === 'ret') u.retHold = false; } break; }
    case 'pt': for (const [id, tx, tz] of c[1] || []) { const u = byId(id); if (!u || !u.alive || u.team !== 0 || u.kind !== 'unit' || u.isTruck) continue;
      u.pat = { x: r1(u.x), z: r1(u.z) }; u.tx = tx; u.tz = tz; u.state = 'patrol'; u.amove = false; u.target = null; u.rto = null; u.buildTarget = null; } break;
    case 'rb': { let n = 0; for (const u of U(c[1])) if (u.kind === 'unit') { const b = homeFor(u, ['hq']) || homeFor(u, ['factory', 'cybfactory', 'airfactory']); if (!b) continue;
      const a = n * 2.4, rr = b.r + 4 + Math.floor(n / 8) * 3; n++; u.pat = null; u.rto = null; u.buildTarget = null; u.target = null;
      u.tx = r1(b.x + Math.sin(a) * rr); u.tz = r1(b.z + Math.cos(a) * rr); u.state = 'move'; u.amove = false; } if (!n) say('Nu ai Cartier General'); break; }
    case 'rr': { let n = 0; for (const u of U(c[1])) if (u.kind === 'unit' && !u.air) { if (goRetreat(u, true)) n++; } if (!n) say('Construiește un Atelier de reparații'); break; }
    case 'rc': { let n = 0; for (const u of U(c[1])) if (u.kind === 'unit') { const b = homeFor(u, ['factory', 'cybfactory', 'airfactory', 'hq']); if (b) { sendTo(u, b, 'recycle'); n++; } } if (!n) say('Nu ai fabrică pentru reciclare'); break; }
    case 'pl': { const [, type, x, z, ids] = c; const def = BD[type]; if (!def) break;
      if (!canPlace(type, x, z, 0)) { say('Nu se poate construi aici'); break; }
      if (type === 'lab' && labCount() >= MAX_LABS) { say(`Maxim ${MAX_LABS} laboratoare`); break; }
      if (T.energy < def.cost) { say('Energie insuficientă'); break; }
      T.energy -= def.cost; const b = createBuilding(0, type, x, z, false, undefined, undefined, pal | 0); for (const u of U(ids)) if (u.isTruck) { u.state = 'build'; u.buildTarget = b; u.target = null; } break; }
    case 'ra': { const f = byId(c[1]); if (f && f.team === 0) f.rally = { x: c[2], z: c[3] }; break; }
    case 'q': { const f = byId(c[1]); if (!f || !f.alive || f.team !== 0 || !FACT_TYPES.has(f.type)) break; const d = c[2]; if (!validDesign(d) || facFor(d) !== f.type) break;
      let k = 0; for (let i = 0; i < Math.min(5, c[3] | 0); i++) { const cost = unitStats(d, 0).cost; if (T.energy < cost || f.queue.length >= 8) break; T.energy -= cost; f.queue.push({ ch: d.ch, pr: d.pr, wp: d.wp }); k++; }
      if (!k) say('Energie insuficientă sau coadă plină'); panelSig = ''; break; }
    case 'uq': { const f = byId(c[1]); if (!f || f.team !== 0 || !f.queue) break; const i = c[2] | 0; const d = f.queue[i]; if (d) { T.energy += unitStats(d, 0).cost; f.queue.splice(i, 1); if (i === 0) f.prod = 0; panelSig = ''; } break; }
    case 'rs': { let l = byId(c[1]); const r = RS.find(x => x.id === c[2]); if (!r) break;
      if (!l || !l.alive || l.team !== 0 || l.type !== 'lab' || !l.complete || l.res) l = ents.find(e => e.alive && e.team === 0 && e.type === 'lab' && e.complete && !e.res);
      if (!l) { say('Toate laboratoarele sunt ocupate'); break; }
      if (T.tech.has(r.id) || T.researching.has(r.id) || (r.req && !r.req.every(q => T.tech.has(q)))) break;
      if (T.energy >= r.cost) { T.energy -= r.cost; l.res = r; l.resProg = 0; T.researching.add(r.id); panelSig = ''; } else say('Energie insuficientă'); break; }
  }
}
// big "research complete" card with the technology's icon
const techQ = []; let techBusy = false;
function techPopup(id) { techQ.push(id); if (!techBusy) techNext(); }
function techNext() {
  const id = techQ.shift(); const el = $('techPop'); if (id === undefined || !el) { techBusy = false; return; } techBusy = true;
  const r = RS.find(x => x.id === id); el.innerHTML = `<div class="tpi">${RICON[id] || ''}</div><div class="tpt"><small>🔬 Cercetare finalizată</small><b>${r ? r.name : id}</b></div>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); sfx('done');
  setTimeout(() => { el.classList.remove('show'); setTimeout(techNext, 350); }, 2600);
}
function teamToast(msg, snd, x, z) { toast(msg); if (snd) sfx(snd); if (x !== undefined) pings.push({ x, z, t: 2 }); }

function canPlace(type, x, z, team) {
  const def = BD[type]; const r = def.size * 0.55;
  if (Math.abs(x) > EDGE - 4 || Math.abs(z) > EDGE - 4) return false;
  if (type === 'pump' || type === 'generator') { const w = wellAt(x, z); if (!w || w.pump) return false; }
  else for (const w of WELLS) if (Math.hypot(w.x - x, w.z - z) < r + 3) return false;
  for (const e of ents) if (e.alive && e.kind === 'bld' && Math.hypot(e.x - x, e.z - z) < r + e.r + 1) return false;
  for (const o of obstNear(x, z)) if (Math.hypot(o.x - x, o.z - z) < r + o.r) return false;
  if (type !== 'pump' && type !== 'generator') { let mn = 1e9, mxh = -1e9; for (const p of [[0, 0], [r, r], [-r, r], [r, -r], [-r, -r]]) { const h = heightAt(x + p[0], z + p[1]); mn = Math.min(mn, h); mxh = Math.max(mxh, h); } if (mxh - mn > 3.2) return false; }
  if (team === 0 && !ents.some(e => e.alive && e.team === 0 && e.kind === 'bld' && Math.hypot(e.x - x, e.z - z) < 50) && type !== 'pump' && type !== 'generator') return false;
  return true;
}

// ================= AI =================
// Every outpost has a factory that builds units of its technology tier, keeps a garrison,
// defends itself and, after a while, sends attack waves toward the player.
const ENEMY_DEF = [['tower'], ['tower', 'd_bunker_flame', 'd_pit_mortar'], ['d_hard_cannon', 'd_pit_howitzer', 'd_hard_rockets', 'd_pit_salvo'], ['d_hard_laser']];
const spick = a => a[(SR() * a.length) | 0];
function tierDesign(t) { const T = TIERS[t]; return { ch: spick(T.ch), pr: spick(T.pr), wp: spick(T.wp) }; }
const AI = { tick: 0 };
const CAP_E = Math.round(95 * Math.min(SC, 1.6));
function aiTick() {
  const t = S.time; const dm = [1.4, 1, 0.75][S.diff];
  const enemyUnits = ents.filter(e => e.alive && e.team === 1 && e.kind === 'unit');
  const playerUnits = ents.filter(e => e.alive && e.team === 0);
  for (const o of OUTPOSTS) {
    if (!o.alive) continue;
    const f = o.factories.find(x => x.alive);
    if (!f && !o.citadel && !o.towers.some(x => x.alive)) { o.alive = false; if (!S.over) teamToast(`🏴 ${TIERS[o.tier].name} cucerit!`, 'done'); continue; }
    const garrison = enemyUnits.filter(u => u.post === o);
    const home = garrison.filter(u => u.state === 'idle' && Math.hypot(u.x - o.x, u.z - o.z) < 30);
    // production
    o.prodT -= 1;
    if (f && o.prodT <= 0 && enemyUnits.length < CAP_E) {
      o.prodT = (28 + o.tier * 7) * dm;
      const fxv = Math.sin(f.rot), fz = Math.cos(f.rot);
      const u = createUnit(1, tierDesign(o.tier), f.x + fxv * (f.r + 1.6), f.z + fz * (f.r + 1.6), o.tier); u.post = o; u.heading = f.rot;
      u.state = 'move'; u.tx = o.x + srand(-9, 9); u.tz = o.z + srand(-9, 9);
    }
    // defence: player units near the outpost
    const threat = playerUnits.find(e => Math.hypot(e.x - o.x, e.z - o.z) < (o.citadel ? 48 : 34));
    if (threat) {
      for (const u of garrison) if (u.state === 'idle' || u.state === 'move') { u.state = 'amove'; u.amove = true; u.tx = threat.x; u.tz = threat.z; u.defending = true; }
      if (o.citadel) for (const u of enemyUnits) if (u.post && u.post.tier === 2 && u.state === 'idle') { u.state = 'amove'; u.amove = true; u.tx = threat.x; u.tz = threat.z; u.defending = true; }
    }
    // attack waves (outer outposts attack first; the citadel only defends until late)
    if (t >= o.nextWave && home.length > TIERS[o.tier].garrison) {
      const extra = home.slice(TIERS[o.tier].garrison);
      const targets = playerUnits.filter(e => e.kind === 'bld');
      if (targets.length && extra.length >= 2) {
        const tg = targets.reduce((a, b) => Math.hypot(a.x - o.x, a.z - o.z) < Math.hypot(b.x - o.x, b.z - o.z) ? a : b);
        for (const u of extra) { u.state = 'amove'; u.amove = true; u.tx = tg.x + srand(-6, 6); u.tz = tg.z + srand(-6, 6); u.post = null; u.defending = false; }
        toast(`⚠ Val de atac din ${TIERS[o.tier].name}!`); pings.push({ x: o.x, z: o.z, t: 2 });
      }
      o.nextWave = t + srand(90, 140) * dm;
    }
  }
}
// decorative (non-entity) fortifications around every enemy base
function fortDecor(o) {
  const B = new Builder(); const T = TEAMC[1];
  const gy = (x, z) => heightAt(x, z);
  const flag = (x, z, h) => { const y = gy(x, z); B.add(G.cyl6, 0.08, h, 0.08, x, y + h / 2, z, 0x333333); B.box(0.05, 0.9, 1.5, x, y + h - 0.5, z + 0.75, T.acc); B.box(0.06, 0.3, 1.5, x, y + h - 0.85, z + 0.75, 0x1c1c1c); };
  if (o.citadel) {
    const WR = 25;
    for (const g of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      for (const side of [-1, 1]) { // gate towers
        const a = g + side * 0.2; const x = Math.sin(a) * WR, z = Math.cos(a) * WR, y = gy(x, z);
        B.box(3, 6.5, 3, x, y + 2.6, z, 0x7a7368, 0, a, 0); B.box(3.2, 0.4, 3.2, x, y + 5.9, z, TEAMC[1].dark, 0, a, 0);
        for (const [dx, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1], [0, -1.1], [0, 1.1], [-1.1, 0], [1.1, 0]]) { const c = Math.cos(a), s2 = Math.sin(a); B.box(0.6, 0.8, 0.6, x + dx * c + dz * s2, y + 6.5, z - dx * s2 + dz * c, 0x7a7368, 0, a, 0); }
        B.box(0.5, 1, 0.1, x + Math.sin(g) * 1.55, y + 4, z + Math.cos(g) * 1.55, 0xffd27a, 0, g, 0);
        flag(x, z, 10);
      }
      const x = Math.sin(g) * WR, z = Math.cos(g) * WR, y = gy(x, z); // arch over the gate
      B.box(7, 1.2, 2.6, x, y + 5.4, z, 0x6e675c, 0, g, 0); B.box(7.1, 0.22, 2.7, x, y + 4.9, z, T.acc, 0, g, 0); for (let k = -3; k <= 3; k++) B.box(0.6, 0.7, 2.6, x + Math.cos(g) * k, y + 6.3, z - Math.sin(g) * k, 0x6e675c, 0, g, 0);
      for (let k = 0; k < 6; k++) { const r = WR + 6 + k * 1.2; const xx = Math.sin(g) * r, zz = Math.cos(g) * r; B.box(4, 0.08, 1, xx, gy(xx, zz) + 0.05, zz, 0x4a453e, 0, g + Math.PI / 2, 0); } // road
    }
    for (let k = 0; k < 40; k++) { const a = k / 40 * TAU; const r = WR + 4.5; const x = Math.sin(a) * r, z = Math.cos(a) * r; if ([0, Math.PI / 2, Math.PI, Math.PI * 1.5].some(g => Math.abs(angDiff(a, g)) < 0.3)) continue; czech(B, x, gy(x, z), z, a); }
  } else {
    const R = 15, n = 26, ang = Math.atan2(PLAYER.x - o.x, PLAYER.z - o.z);
    for (let k = 0; k < n; k++) { // sandbag ring with an opening toward the centre
      const a = k / n * TAU; if (Math.abs(angDiff(a, ang + Math.PI)) < 0.35) continue;
      const x = o.x + Math.sin(a) * R, z = o.z + Math.cos(a) * R, y = gy(x, z);
      for (let l = 0; l < 2 + (o.tier > 0 ? 1 : 0); l++) B.add(G.ico, 1.0, 0.38, 0.6, x + Math.cos(a) * (l % 2 ? 0.5 : 0), y + 0.3 + l * 0.42, z - Math.sin(a) * (l % 2 ? 0.5 : 0), l % 2 ? 0x8c7a56 : 0x7d6c4b, 0, a + Math.PI / 2, 0);
    }
    for (let k = 0; k < 7 + o.tier * 3; k++) { const a = ang + (k - (6 + o.tier * 3) / 2) * 0.22; const r = R + 4 + (k % 2) * 1.5; const x = o.x + Math.sin(a) * r, z = o.z + Math.cos(a) * r; czech(B, x, gy(x, z), z, a); }
    // watchtower with searchlight
    const wa = ang + Math.PI * 0.75; const wx = o.x + Math.sin(wa) * 10, wz = o.z + Math.cos(wa) * 10, wy = gy(wx, wz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(G.cyl6, 0.12, 6, 0.12, wx + sx * 0.8, wy + 3, wz + sz * 0.8, 0x4a3a2a, sz * 0.06, 0, -sx * 0.06);
    B.box(2.4, 0.2, 2.4, wx, wy + 6, wz, 0x5a4a36); B.box(2.4, 1, 0.1, wx, wy + 6.6, wz + 1.2, 0x5a4a36); B.box(2.4, 1, 0.1, wx, wy + 6.6, wz - 1.2, 0x5a4a36); B.box(0.1, 1, 2.4, wx + 1.2, wy + 6.6, wz, 0x5a4a36);
    B.add(G.cone, 1.9, 1.2, 1.9, wx, wy + 7.9, wz, T.dark, 0, Math.PI / 4, 0); B.cyl(0.3, 0.4, wx, wy + 6.6, wz + 0.4, 0xfff4c0, Math.PI / 2, 0, 0);
    flag(o.x + Math.sin(ang + 0.5) * 7, o.z + Math.cos(ang + 0.5) * 7, 7 + o.tier);
    if (o.tier >= 1) for (let k = 0; k < 4; k++) { const a = ang + Math.PI + (k - 1.5) * 0.7; const x = o.x + Math.sin(a) * 6, z = o.z + Math.cos(a) * 6; B.box(2.5, 1.6, 2, x, gy(x, z) + 0.6, z, 0x6a645a, 0, a, 0); B.box(2.6, 0.25, 2.1, x, gy(x, z) + 1.5, z, T.dark, 0, a, 0); } // crates/bunkers
  }
  B.uvScale = 0.6; const m = new THREE.Mesh(B.build(), matVC); m.castShadow = true; m.receiveShadow = true; scene.add(m);
}
function czech(B, x, y, z, a) { for (let k = 0; k < 3; k++) B.box(0.18, 0.18, 2, x, y + 0.6, z, 0x3a3631, k === 0 ? 0.6 : (k === 1 ? -0.6 : 0), a + k * 1.05, k === 2 ? 0.6 : 0); }
function setupEnemy() {
  const dm = [1.4, 1, 0.75][S.diff];
  for (const o of OUTPOSTS) {
    o.alive = true; o.factories = []; o.towers = [];
    const T = TIERS[o.tier]; const ang = Math.atan2(PLAYER.x - o.x, PLAYER.z - o.z);
    o.nextWave = (o.citadel ? 900 : [240, 360, 520][o.tier]) * dm + srand(0, 60);
    o.prodT = srand(5, 25);
    if (o.citadel) {
      createBuilding(1, 'citadel', 0, 0, true, 0, 3);
      for (const [fx2, fz2, r] of [[0, 14, 0], [0, -14, Math.PI]]) o.factories.push(createBuilding(1, 'factory', fx2, fz2, true, r, 3));
      createBuilding(1, 'lab', 13, 0, true, -Math.PI / 2, 3); createBuilding(1, 'hq', -13, 0, true, Math.PI / 2, 3);
      // ring wall with four gates
      const WR = 25; const n = 30;
      for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * TAU; const gate = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].some(g => Math.abs(angDiff(a, g)) < 0.16); if (gate) continue; createBuilding(1, 'wall', Math.sin(a) * WR, Math.cos(a) * WR, true, a, 3); }
      for (let i = 0; i < T.towers; i++) { const a = i / T.towers * TAU + 0.2; o.towers.push(createBuilding(1, i % 2 ? 'd_hard_laser' : 'd_hard_rockets', Math.sin(a) * 20, Math.cos(a) * 20, true, a, 3)); }
      for (const a of [Math.PI / 4, -Math.PI / 4]) o.towers.push(createBuilding(1, 'd_fort_laser', Math.sin(a) * 33, Math.cos(a) * 33, true, a, 3));
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; o.towers.push(createBuilding(1, 'd_bunker_laser', Math.sin(a) * 31, Math.cos(a) * 31, true, a, 3)); }
      for (const w of WELLS) if (Math.hypot(w.x, w.z) < 20) createBuilding(1, 'generator', w.x, w.z, true, null, 3);
    } else {
      o.factories.push(createBuilding(1, 'factory', o.x, o.z, true, Math.round(ang / (Math.PI / 2)) * (Math.PI / 2), o.tier));
      for (let i = 0; i < T.towers; i++) { const a = ang + (i - (T.towers - 1) / 2) * 0.9; o.towers.push(createBuilding(1, ENEMY_DEF[o.tier][i % ENEMY_DEF[o.tier].length], o.x + Math.sin(a) * 11, o.z + Math.cos(a) * 11, true, a, o.tier)); }
      const w = WELLS.find(w => Math.hypot(w.x - o.x, w.z - o.z) < 14); if (w) createBuilding(1, 'generator', w.x, w.z, true, null, o.tier);
    }
    fortDecor(o);
    for (let i = 0; i < Math.max(2, Math.round(T.garrison * MC.gar)); i++) { const a = srand(0, TAU), r = srand(5, o.citadel ? 18 : 10); const u = createUnit(1, tierDesign(o.tier), o.x + Math.sin(a) * r, o.z + Math.cos(a) * r, o.tier); u.post = o; }
  }
}
// ================= CAMERA / INPUT =================
const cam = { x: PLAYER.x, z: PLAYER.z - 8, dist: 46, yaw: 0, ty: 0 };
function updateCamera(dt) {
  cam.dist = clamp(cam.dist, 14, 120); cam.x = clamp(cam.x, -EDGE, EDGE); cam.z = clamp(cam.z, -EDGE, EDGE);
  const pitch = lerp(0.55, 1.05, Math.pow((cam.dist - 14) / 106, 0.7));
  cam.ty = lerp(cam.ty, Math.max(0, heightAt(cam.x, cam.z)), Math.min(1, dt * 5));
  const cp = Math.cos(pitch) * cam.dist; let sx = 0, sy = 0; if (shake > 0) { sx = rand(-1, 1) * shake; sy = rand(-1, 1) * shake; shake = Math.max(0, shake - dt * 1.5); }
  camera.position.set(cam.x + Math.sin(cam.yaw) * cp + sx, cam.ty + Math.sin(pitch) * cam.dist + sy, cam.z + Math.cos(cam.yaw) * cp);
  { const gh = heightAt(camera.position.x, camera.position.z) + 4; if (camera.position.y < gh) camera.position.y = gh; }
  camera.lookAt(cam.x, cam.ty, cam.z);
  scene.fog.near = cam.dist * 1.1 + 20; scene.fog.far = cam.dist * 2.6 + 90;
  { const w = biomeW(cam.x, cam.z); const c = scene.fog.color; const tr = 0.62 * w.green + 0.86 * w.sand + 0.80 * w.snow + 0.66 * w.mtn, tg = 0.70 * w.green + 0.74 * w.sand + 0.84 * w.snow + 0.64 * w.mtn, tb = 0.62 * w.green + 0.56 * w.sand + 0.90 * w.snow + 0.62 * w.mtn; const k = Math.min(1, dt * 1.5) || 1; tmpC.setRGB(tr, tg, tb, THREE.SRGBColorSpace); c.lerp(tmpC, k); scene.background.copy(c); skyMat.uniforms.horizon.value.copy(c).lerp(C(0xffffff), 0.15); skyMat.uniforms.time.value = S.time; sky.position.copy(camera.position);
    if (S.running && !S.paused && w.snow > 0.45) for (let i = 0; i < 3; i++) if (Math.random() < w.snow) fx('snow', cam.x + rand(-40, 40), cam.ty + rand(15, 30), cam.z + rand(-40, 40), 1); }
  sun.position.set(cam.x - 40, 90, cam.z + 30); sun.target.position.set(cam.x, 0, cam.z);
  const sr = clamp(cam.dist * 0.9, 30, 80); sc.left = -sr; sc.right = sr; sc.top = sr; sc.bottom = -sr; sc.updateProjectionMatrix();
}
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function screenToGround(sx, sy) {
  ndc.set(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); const o = ray.ray.origin, d = ray.ray.direction;
  let t = 0, prev = 0;
  for (let i = 0; i < 600; i++) { t += 0.6; const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t; if (y < heightAt(x, z)) { let a = prev, b = t; for (let k = 0; k < 10; k++) { const m = (a + b) / 2; if (o.y + d.y * m < heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; } const m = (a + b) / 2; return { x: o.x + d.x * m, z: o.z + d.z * m }; } prev = t; }
  return null;
}
const _v = new THREE.Vector3();
function toScreen(x, y, z) { _v.set(x, y, z).project(camera); return { x: (_v.x + 1) / 2 * innerWidth, y: (1 - _v.y) / 2 * innerHeight, z: _v.z }; }
function pickEntity(sx, sy) {
  let best = null, bs = 1e9; const ppu = innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
  for (const e of ents) {
    if (!e.alive) continue; const p = toScreen(e.x, e.y + e.h * 0.45, e.z); if (p.z > 1) continue;
    const dc = camera.position.distanceTo(_v.set(e.x, e.y, e.z)); const rad = Math.max(e.kind === 'unit' ? 30 : 24, e.r * ppu / dc * 1.15);
    const d = Math.hypot(p.x - sx, p.y - sy); if (d < rad) { const s = d / rad + (e.kind === 'bld' ? 0.35 : 0); if (s < bs) { bs = s; best = e; } }
  }
  return best;
}

let sel = [], panelSig = '', placing = null, boxMode = false, amoveNext = false, patrolNext = false, ordOpen = false;
function setSel(arr) { for (const e of sel) e.selected = false; sel = arr.filter(e => e && e.alive); for (const e of sel) e.selected = true; amoveNext = false; patrolNext = false; panelSig = ''; }

const ptrs = new Map(); let gesture = null, lpTimer = null, lastTap = { t: 0, e: null };
canvas.addEventListener('pointerdown', e => {
  if (!S.running || S.paused) return; canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) {
    gesture = { type: boxMode ? 'boxwait' : 'tap', sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
    clearTimeout(lpTimer); lpTimer = setTimeout(() => { if (gesture && gesture.type === 'tap') { gesture.type = 'box'; if (navigator.vibrate) navigator.vibrate(25); } }, 420);
  } else if (ptrs.size === 2) {
    clearTimeout(lpTimer); const [a, b] = [...ptrs.values()];
    gesture = { type: 'two', d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p || !gesture) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (gesture.type === 'two' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    cam.dist *= gesture.d / Math.max(10, d); cam.yaw -= angDiff(gesture.a, ang); panBy(mx - gesture.mx, my - gesture.my);
    gesture.d = d; gesture.a = ang; gesture.mx = mx; gesture.my = my; return;
  }
  gesture.x = e.clientX; gesture.y = e.clientY;
  const moved = Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy);
  if (gesture.type === 'tap' && moved > 10) { gesture.type = 'pan'; clearTimeout(lpTimer); }
  if (gesture.type === 'boxwait' && moved > 10) gesture.type = 'box';
  if (gesture.type === 'pan') panBy(dx, dy);
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); clearTimeout(lpTimer);
  if (!gesture) return;
  if (ptrs.size === 0) {
    if (gesture.type === 'tap' || gesture.type === 'boxwait') handleTap(gesture.sx, gesture.sy);
    else if (gesture.type === 'box') boxSelect(gesture.sx, gesture.sy, gesture.x, gesture.y);
    gesture = null;
  } else gesture = { type: 'none' };
}
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist *= e.deltaY > 0 ? 1.1 : 0.9; }, { passive: false });
addEventListener('keydown', e => { if (e.key === 'q') cam.yaw += 0.1; if (e.key === 'e') cam.yaw -= 0.1; });
function panBy(dx, dy) {
  const wpp = 2 * cam.dist * Math.tan(camera.fov * Math.PI / 360) / innerHeight * 1.15;
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw), fwx = -Math.sin(cam.yaw), fwz = -Math.cos(cam.yaw);
  cam.x -= rx * dx * wpp; cam.z -= rz * dx * wpp; cam.x += fwx * dy * wpp * 1.3; cam.z += fwz * dy * wpp * 1.3;
}
function boxSelect(x1, y1, x2, y2) {
  const minx = Math.min(x1, x2), maxx = Math.max(x1, x2), miny = Math.min(y1, y2), maxy = Math.max(y1, y2);
  const us = ents.filter(e => { if (!e.alive || e.team !== 0 || e.kind !== 'unit') return false; const p = toScreen(e.x, e.y + 0.8, e.z); return p.x >= minx && p.x <= maxx && p.y >= miny && p.y <= maxy && p.z < 1; });
  if (us.length) { setSel(us); sfx('click'); }
  if (boxMode) { boxMode = false; $('bBox').classList.remove('on'); }
}
function handleTap(sx, sy) {
  if (placing) { const g = screenToGround(sx, sy); if (g) movePlacing(g.x, g.z); return; }
  const hit = pickEntity(sx, sy); const g = screenToGround(sx, sy);
  const units = sel.filter(e => e.kind === 'unit' && e.team === 0); const trucks = units.filter(u => u.isTruck);
  if (hit) {
    if (hit.team === 1) { if (units.some(u => !u.isTruck)) orderAttack(units, hit); else { setSel([hit]); sfx('click'); } return; }
    if (trucks.length && hit.kind === 'bld' && (!hit.complete || hit.hp < hit.maxHp)) { orderBuild(trucks, hit); marker(hit.x, hit.z, 0xffd040); return; }
    const now = performance.now();
    if (hit.kind === 'unit' && lastTap.e === hit && now - lastTap.t < 400) {
      const key = designName(hit.d); setSel(ents.filter(e => e.alive && e.team === 0 && e.kind === 'unit' && designName(e.d) === key && toScreen(e.x, e.y, e.z).z < 1 && Math.hypot(e.x - cam.x, e.z - cam.z) < cam.dist * 1.5));
    } else setSel([hit]);
    lastTap = { t: now, e: hit }; sfx('click'); return;
  }
  if (!g) return;
  if (trucks.length) { const w = WELLS.find(w => !w.pump && Math.hypot(w.x - g.x, w.z - g.z) < 4); if (w && TEAMS[0].energy >= BD.generator.cost) { doCmd(['pl', 'generator', w.x, w.z, trucks.map(u => u.id)]); sfx('ack'); marker(w.x, w.z, 0xffd040); return; } }
  if (units.length && patrolNext) { const army = units.filter(u => !u.isTruck); if (army.length) { doCmd(['pt', formation(army, g.x, g.z)]); marker(g.x, g.z, 0x60b0ff); sfx('ack'); } patrolNext = false; panelSig = ''; return; }
  if (units.length) { orderMove(units, g.x, g.z, amoveNext); amoveNext = false; panelSig = ''; return; }
  const f = sel.length === 1 && sel[0].kind === 'bld' && sel[0].team === 0 && FACT_TYPES.has(sel[0].type) ? sel[0] : null;
  if (f) { doCmd(['ra', f.id, r1(g.x), r1(g.z)]); marker(g.x, g.z, 0x60c0ff); toast('📍 Punct de adunare setat'); return; }
  if (sel.length) setSel([]);
}

// placement
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x60ff60, transparent: true, opacity: 0.45, depthWrite: false });
function startPlacing(type) {
  const trucks = sel.filter(e => e.isTruck); if (!trucks.length) return;
  const m = new THREE.Mesh(bldGeo(type, 0).geo, ghostMat); scene.add(m);
  placing = { type, x: cam.x, z: cam.z, ghost: m, trucks, valid: false };
  if (type === 'pump' || type === 'generator') { let best = null, bd = 1e9; for (const w of WELLS) { if (w.pump) continue; const d = Math.hypot(w.x - trucks[0].x, w.z - trucks[0].z); if (d < bd) { bd = d; best = w; } } if (best) { movePlacing(best.x, best.z); cam.x = best.x; cam.z = best.z; } }
  else movePlacing(cam.x, cam.z);
  panelSig = '';
}
function movePlacing(x, z) {
  const p = placing; if (p.type === 'pump' || p.type === 'generator') { const w = WELLS.find(w => Math.hypot(w.x - x, w.z - z) < 6); if (w) { x = w.x; z = w.z; } }
  p.x = x; p.z = z; p.valid = canPlace(p.type, x, z, 0);
  p.ghost.position.set(x, (p.type === 'pump' || p.type === 'generator') ? heightAt(x, z) : bldY(x, z, BD[p.type].size), z); p.ghost.rotation.y = Math.round(Math.atan2(-x, -z) / (Math.PI / 2)) * (Math.PI / 2);
  ghostMat.color.setHex(p.valid ? 0x60ff60 : 0xff4040); panelSig = '';
}
function confirmPlacing() {
  const p = placing; if (!p || !p.valid) return; const def = BD[p.type];
  if (TEAMS[0].energy < def.cost) { toast('Energie insuficientă'); return; }
  doCmd(['pl', p.type, p.x, p.z, p.trucks.filter(t => t.alive).map(u => u.id)]); sfx('ack');
  cancelPlacing();
}
function cancelPlacing() { if (!placing) return; scene.remove(placing.ghost); placing = null; panelSig = ''; }

// ================= UI =================
const panel = $('panel'); let panelMini = false;
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); toastT = 2.6; }
function fmtTime(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function computeSig() {
  const T = TEAMS[0]; let s = (placing ? 'P' + placing.type + placing.valid : '') + '|' + sel.map(e => e.id).join(',') + '|' + T.tech.size + '|' + amoveNext + patrolNext + ordOpen + '|' + labCount() + '|' + sel.map(e => e.kind === 'unit' ? '' + e.fire + e.mvo + e.ret : '').join('');
  for (const e of sel) if (e.kind === 'bld') s += `|${e.complete}|${e.queue.length}|${e.res ? e.res.id : ''}|${[...T.researching].join()}`;
  if (sel[0] && sel[0].type === 'lab') s += '|L' + ents.filter(e => e.alive && e.team === 0 && e.type === 'lab').map(e => e.id + (e.complete ? 'c' : '') + (e.res ? e.res.id : '') + (e.lastRes || '')).join(',');
  const costs = [35, 50, 65, 75, 100, 120, 130, 140, 150, 160, 180, 200, 220, 250, 300]; s += '|' + costs.map(c => T.energy >= c ? 1 : 0).join('');
  return s;
}
let buildTab = 'base', defCls = 'tower', labBr = 0;
function buildMenu(T) {
  let h = `<div class="tabs"><button data-act="btab" data-v="base" class="${buildTab === 'base' ? 'on' : ''}">${UIC.factory}Bază</button><button data-act="btab" data-v="def" class="${buildTab === 'def' ? 'on' : ''}">${UIC.tower}Apărare</button></div>`;
  if (buildTab === 'base') {
    h += `<div class="grid">${bdBtn('generator')}${bdBtn('factory')}${bdBtn('lab')}${['repairbay', 'radartower', 'cybfactory', 'airfactory', 'vpad', 'silo'].filter(k => !BD[k].req || T.tech.has(BD[k].req)).map(bdBtn).join('')}${ents.some(e => e.alive && e.team === 0 && e.type === 'hq') ? '' : bdBtn('hq')}</div>`;
  } else {
    const cls = Object.keys(DCLASS).filter(c => !DCLASS[c].req || T.tech.has(DCLASS[c].req)); if (!cls.includes(defCls)) defCls = 'tower';
    h += `<div class="chips">${cls.map(c => `<button data-act="dcls" data-v="${c}" class="${defCls === c ? 'on' : ''}">${DCLASS[c].name}</button>`).join('')}</div>`;
    const ws = DCLASS[defCls].wps.filter(w => w === 'mg' || T.tech.has(w));
    h += `<div class="grid">${defCls === 'tower' ? bdBtn('tower') : ''}${ws.filter(w => !(defCls === 'tower' && (w === 'mg' || w === 'cannon'))).map(w => bdBtn('d_' + defCls + '_' + w)).join('')}${T.tech.has('traps') ? bdBtn('ptrap') + bdBtn('pwall') : ''}</div>`;
    if (!ws.length) h += `<div class="hint">Cercetează mai întâi o armă potrivită (ex.: Mortier pentru amplasamente).</div>`;
  }
  return h;
}
const MAX_LABS = 5; const labCount = () => ents.filter(e => e.alive && e.team === 0 && e.type === 'lab').length;
function bdBtn(type) { const d = BD[type]; const lim = type === 'lab' ? labCount() : -1; const full = lim >= MAX_LABS;
  return `<button data-act="build" data-v="${type}" ${TEAMS[0].energy < d.cost || full ? 'disabled' : ''}>${BIC(type)}<span class="bn">${d.short || d.name}${lim >= 0 ? ` ${lim}/${MAX_LABS}` : ''}</span><small>${full ? 'maxim' : d.cost + '<i class="eu">⚡</i>'}</small></button>`; }
let lastDesigns = [];
function renderPanel() {
  const T = TEAMS[0]; let h = '';
  if (placing) {
    const d = BD[placing.type];
    h = `<div class="ph"><span>${BIC(placing.type)}Plasează: ${d.name}</span><span class="pc">${d.cost}<i class="eu">⚡</i></span></div><div class="hint">${placing.type === 'pump' || placing.type === 'generator' ? 'Atinge o sondă de petrol liberă (pată neagră).' : 'Atinge harta pentru a muta clădirea. Verde = loc bun.'}</div>
    <div class="row"><button data-act="place-ok" class="ok" ${placing.valid && T.energy >= d.cost ? '' : 'disabled'}>${UIC.ok}Construiește</button><button data-act="place-cancel" class="bad">${UIC.no}Anulează</button></div>`;
  } else if (!sel.length) {
    h = '';
  } else if (sel[0].team === 1) {
    const e = sel[0]; h = `<div class="ph"><span>${UIC.enemy}Inamic: ${e.kind === 'bld' ? e.def.name : designName(e.d)}</span></div><div class="bar"><i id="pHp"></i></div><div class="hint">Selectează unitățile tale și atinge inamicul pentru atac.</div>`;
  } else if (sel[0].kind === 'unit') {
    const trucks = sel.filter(u => u.isTruck), army = sel.filter(u => !u.isTruck);
    h = `<div class="ph"><span>${army.length ? UIC.tank + army.length + ' unități ' : ''}${trucks.length ? UIC.truck + trucks.length + ' constructori' : ''}</span></div>`;
    if (sel.length === 1) h += `<div class="hint">${designName(sel[0].d)}</div><div class="bar"><i id="pHp"></i></div>`;
    if (trucks.length) h += buildMenu(T);
    if (army.length) { h += `<div class="row"><button data-act="amove" class="${amoveNext ? 'on' : ''}">${UIC.amove}Atac-deplasare</button><button data-act="stop">${UIC.stop}Stop</button><button data-act="ordt" class="${ordOpen ? 'on' : ''}">📋 Ordine</button></div>`;
      if (ordOpen) h += ordersBox(army); }
  } else {
    const b = sel[0];
    h = `<div class="ph"><span>${BIC(b.type)}${b.def.name}</span><span id="pHpT"></span></div><div class="bar"><i id="pHp"></i></div>`;
    if (!b.complete) h += `<div class="hint">În construcție…</div><div class="bar b"><i id="pBuild"></i></div><div class="hint">Selectează constructori și atinge clădirea ca să ajute.</div>`;
    else if (FACT_TYPES.has(b.type)) {
      h += `<div class="lbl">Producție</div><div class="queue">${b.queue.map((d, i) => `<button data-act="unq" data-v="${i}">${d.wp === 'truck' ? UIC.truck : UIC.tank}${i === 0 ? '<span id="pProdT"></span>' : ''} ✖</button>`).join('') || '<span class="hint">Coada e goală</span>'}</div><div class="bar o"><i id="pProd"></i></div>`;
      const truck = { ch: 'light', pr: 'wheels', wp: 'truck' };
      h += `<div class="grid">` + (b.type === 'factory' ? `<button data-act="produce" data-v='${JSON.stringify(truck)}' ${T.energy < unitStats(truck, 0).cost || b.queue.length >= 8 ? 'disabled' : ''}>${UIC.truck}<span class="bn">Constructor</span><small>${unitStats(truck, 0).cost}<i class="eu">⚡</i></small></button>` : '');
      const mine = lastDesigns.filter(d => facFor(d) === b.type); const quick = mine.length ? mine : [defDesign(b.type)];
      if (b.type === 'airfactory') { const pads = ents.filter(e => e.alive && e.team === 0 && e.type === 'vpad').length, vt = ents.filter(e => e.alive && e.team === 0 && e.air === 'vtol').length; h += `<div class="hint" style="grid-column:1/-1">Platforme de realimentare: <b>${pads}</b> · aeronave VTOL: <b>${vt}</b>. Fiecare VTOL are muniție pentru câteva atacuri, apoi se întoarce singur pe platformă.</div>`; }
      for (const d of quick) { const c = unitStats(d, 0).cost; h += `<button data-act="produce" data-v='${JSON.stringify(d)}' ${T.energy < c || b.queue.length >= 8 || !validDesign(d) || !T.tech.has(d.ch) || !T.tech.has(d.pr) ? 'disabled' : ''}>${d.wp === 'radar' || d.wp === 'repair' || d.wp === 'truck' ? RICON[d.wp].replace('class="ric"', 'class="ui"') : d.pr === 'legs' ? RICON.cyborg.replace('class="ric"', 'class="ui"') : d.pr === 'rotor' ? RICON.drone.replace('class="ric"', 'class="ui"') : d.pr === 'vtol' ? RICON.vtol.replace('class="ric"', 'class="ui"') : UIC.tank}<span class="bn">${designName(d)}</span><small>${c}<i class="eu">⚡</i></small></button>`; }
      h += `<button data-act="designer" class="ok">${UIC.design}<span class="bn">Proiectant</span></button></div><div class="hint">Atinge harta pentru punctul de adunare.</div>`;
    } else if (b.type === 'lab') {
      h += `<div class="lbl">Cercetare</div>`;
      const labs = ents.filter(e => e.alive && e.team === 0 && e.type === 'lab');
      const busy = labs.filter(l => l.res).length;
      const free = labs.filter(l => l.complete && !l.res).length;
      h += `<div class="labs"><div class="labsh">Laboratoare: <b>${labs.length}/${MAX_LABS}</b> · cercetări în paralel: <b>${busy}</b> · libere <b>${free}</b>${free ? ' — alege o cercetare, merge în primul laborator liber' : ''}</div>`;
      if (false) labs.forEach((l, i) => { h += `<button class="labrow ${l === b ? 'cur' : ''} ${l.res ? '' : 'idle'}" data-act="sellab" data-v="${l.id}">${l.res ? RICON[l.res.id] : l.lastRes ? `<span class="lastico">${RICON[l.lastRes]}</span>` : UIC.lab.replace('class="ui"', 'class="ric"')}<span class="ln">#${i + 1}</span><span class="lt"><b>${!l.complete ? 'În construcție' : l.res ? l.res.name : l.lastRes ? '✔ ' + (RS.find(x => x.id === l.lastRes) || {}).name + ' — liber' : 'Liber — alege o cercetare'}</b>${l.res ? `<span class="bar b"><i id="labB${l.id}"></i></span>` : ''}</span><span class="lr" id="labT${l.id}"></span></button>`; });
      h += `</div>`;
      const avail = br => br.ids.filter(id => { const r = RS.find(x => x.id === id); return !T.tech.has(id) && !r.req.some(q => !T.tech.has(q)); }).length;
      h += `<div class="chips">${BRANCHES.map((br, i) => `<button data-act="rbr" data-v="${i}" class="${labBr === i ? 'on' : ''}">${br.name}${avail(br) ? ` <b class="cnt">${avail(br)}</b>` : ''}</button>`).join('')}</div>`;
      for (const br of [BRANCHES[labBr]]) {
        const st = id => { const r = RS.find(x => x.id === id); return T.tech.has(id) ? 3 : T.researching.has(id) ? 0 : r.req.some(q => !T.tech.has(q)) ? 2 : 1; };
        h += `<div class="rgrid">`;
        for (const id of [...br.ids].sort((a, c) => st(a) - st(c))) { const r = RS.find(x => x.id === id);
          const done = T.tech.has(r.id), locked = !done && r.req.some(q => !T.tech.has(q)), busy = !done && T.researching.has(r.id);
          const meta = done ? '✔ Cercetat' : locked ? '🔒 ' + r.req.map(q => RS.find(x => x.id === q).name).join(', ') : busy ? '⏳ În curs' : `${r.cost}⚡ · ${r.time}s`;
          const cls = done ? 'done' : locked ? 'locked' : busy ? 'busy' : '';
          const dis = done || locked || busy || !free || T.energy < r.cost;
          h += `<button class="rcard ${cls}" data-act="research" data-v="${r.id}" ${dis ? 'disabled' : ''}>${RICON[r.id]}<span class="rn">${r.name}</span><span class="rm">${meta}</span></button>`;
        }
        h += `</div>`;
      }
    } else if (b.type === 'generator') { h += `<div class="hint">Extrage petrol din sondă și produce +${(4 * T.powMul).toFixed(1)} ⚡/s.</div>`; }
    else if (b.type === 'repairbay') h += `<div class="hint">Repară automat unitățile tale aflate la mai puțin de 11 m.</div>`;
    else if (b.type === 'radartower') h += `<div class="hint">Unitățile tale din jur (${T.tech.has('radar2') ? 44 : 34} m) trag mai departe și mai tare. Inamicii văzuți de radar (${T.tech.has('radar2') ? 80 : 60} m) pot fi loviți de artilerie de la distanță: toată artileria până la bătaia ei maximă (de 3× mai mare decât ce vede singură), Rachetă Orizont fără limită.</div>`;
    else if (b.def.tw) h += `<div class="hint">${b.def.name}: ${WP[b.def.tw].name.toLowerCase()}, rază ${WP[b.def.tw].range + (b.def.rb || 0)} m. Atacă automat inamicii din apropiere.</div>`;
    else if (b.type === 'tower') h += `<div class="hint">Atacă automat inamicii din apropiere. ${TEAMS[0].tech.has('tower2') ? 'Armă: tun.' : 'Armă: mitralieră (cercetează „Turnuri cu tun”).'}</div>`;
    else if (b.type === 'hq') h += `<div class="hint">Centrul de comandă. Dă +1.5 ⚡/s. Nu-l pierde!</div>`;
  }
  panel.innerHTML = h.replace('<div class="ph">', '<div class="ph"><button class="pmin" data-act="pmin">' + (panelMini ? '▴' : '▾') + '</button>');
  panel.classList.toggle('mini', panelMini);
}
function updDyn() {
  labColPos();
  const e = sel[0]; if (!e) return;
  const hp = $('pHp'); if (hp) { const r = clamp(e.hp / e.maxHp, 0, 1); hp.style.width = (r * 100) + '%'; hp.style.background = r > 0.5 ? '#7fb84a' : r > 0.25 ? '#e0b030' : '#d04020'; }
  const ht = $('pHpT'); if (ht) ht.textContent = Math.ceil(e.hp) + '/' + e.maxHp;
  const pb = $('pBuild'); if (pb) pb.style.width = (e.built * 100) + '%';
  const pp = $('pProd'); if (pp) pp.style.width = e.queue && e.queue.length ? (e.prod / unitStats(e.queue[0], 0).time * 100) + '%' : '0%';
  const pr = $('pRes'); if (pr && e.res) pr.style.width = (e.resProg / e.res.time * 100) + '%';
  if (e.type === 'lab') for (const l of ents) if (l.alive && l.type === 'lab' && l.team === 0) { const bb = $('labB' + l.id), tt = $('labT' + l.id), lc = $('lc' + l.id), lt = $('lct' + l.id);
    if (lc) lc.style.setProperty('--p', (l.res ? l.resProg / l.res.time * 100 : !l.complete ? (l.built || 0) * 100 : 0) + '%');
    if (lt) lt.textContent = l.res ? fmtTime(Math.ceil((l.res.time - l.resProg) / (TEAMS[0].rsMul || 1))) : '';
    if (bb && l.res) bb.style.width = (l.resProg / l.res.time * 100) + '%';
    if (tt) tt.textContent = l.res ? fmtTime(Math.ceil((l.res.time - l.resProg) / (TEAMS[0].rsMul || 1))) : ''; }
}
const ORD = [['fire', 'Foc', ['🔥 Liber', '↩ Ripostă', '✋ Nu trage']], ['mvo', 'Poziție', ['Urmărește', '🛡 Păzește', '📌 Pe loc']], ['ret', 'Retragere', ['💀 Niciodată', '❤ La 50%', '❤ La 25%']]];
function ordersBox(army) {
  let h = '<div class="ord">';
  for (const [k, name, opts] of ORD) { const same = army.every(u => u[k] === army[0][k]) ? army[0][k] : -1;
    h += `<span class="ol">${name}</span>` + opts.map((t, i) => `<button data-act="ord" data-k="${k}" data-v="${i}" class="${same === i ? 'on' : ''}">${t}</button>`).join(''); }
  h += `</div><div class="ord2"><button data-act="patrol" class="${patrolNext ? 'on' : ''}">🔁 Patrulare</button><button data-act="rtb">🏠 La bază</button><button data-act="rtr">🔧 La reparații</button><button data-act="recyc">♻ Reciclează</button></div>`;
  return h;
}
// the five research labs as small fixed tiles on the left side of the research menu
function labColHtml() {
  const labs = ents.filter(e => e.alive && e.team === 0 && e.type === 'lab'); let h = '';
  for (let i = 0; i < MAX_LABS; i++) { const l = labs[i];
    if (!l) { h += `<div class="lt none"><span class="pl">＋</span><span class="n">${i + 1}</span></div>`; continue; }
    h += `<button class="lt ${l === sel[0] ? 'cur' : ''} ${!l.complete ? 'bld' : l.res ? '' : 'free'}" data-lab="${l.id}" id="lc${l.id}"><span class="ring"></span>${l.res ? RICON[l.res.id] : `<span class="pl">${l.complete ? '＋' : '⚒'}</span>`}<span class="n">${i + 1}</span><span class="tm" id="lct${l.id}"></span></button>`; }
  return h;
}
function labColPos() {
  const lc = $('labCol'); if (lc.classList.contains('hidden')) return;
  const r = panel.getBoundingClientRect(); if (!r.height) { lc.style.display = 'none'; return; } lc.style.display = '';
  const sz = Math.round(clamp((Math.max(r.height, 150) - 4 * 7) / 5 * 0.72, 24, 34));
  lc.style.setProperty('--s', sz + 'px'); lc.style.left = Math.max(2, r.left - sz - 7) + 'px'; lc.style.top = (r.top + 4) + 'px';
}
$('labCol').addEventListener('click', ev => { const b = ev.target.closest('[data-lab]'); if (!b) return; const l = byId(+b.dataset.lab); if (l && l.alive) { sfx('click'); setSel([l]); } });
function updatePanel() { const s = computeSig(); if (s !== panelSig) { panelSig = s; renderPanel();
    const lc = $('labCol'), on = !placing && sel.length === 1 && sel[0].type === 'lab' && sel[0].team === 0;
    lc.classList.toggle('hidden', !on); if (on) lc.innerHTML = labColHtml(); }
  updDyn(); }
panel.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return; const act = b.dataset.act, v = b.dataset.v; sfx('click');
  const T = TEAMS[0]; const e = sel[0];
  if (act === 'pmin') { panelMini = !panelMini; panelSig = ''; return; }
  if (act === 'sellab') { const l = ents.find(x => x.id === +v); if (l) { setSel([l]); cam.x = l.x; cam.z = l.z; } return; }
  if (act === 'rbr') { labBr = +v; panelSig = ''; return; }
  if (act === 'btab') { buildTab = v; panelSig = ''; return; }
  if (act === 'dcls') { defCls = v; panelSig = ''; return; }
  if (act === 'build') startPlacing(v);
  else if (act === 'place-ok') confirmPlacing();
  else if (act === 'place-cancel') cancelPlacing();
  else if (act === 'amove') { amoveNext = !amoveNext; patrolNext = false; panelSig = ''; if (amoveNext) toast('Atinge harta: unitățile atacă pe drum'); }
  else if (act === 'stop') { patrolNext = false; doCmd(['st', sel.filter(u => u.kind === 'unit').map(u => u.id)]); }
  else if (act === 'ordt') { ordOpen = !ordOpen; panelSig = ''; }
  else if (act === 'ord') doCmd(['or', sel.filter(u => u.kind === 'unit' && !u.isTruck).map(u => u.id), b.dataset.k, +v]);
  else if (act === 'patrol') { patrolNext = !patrolNext; amoveNext = false; panelSig = ''; if (patrolNext) toast('Atinge harta: unitățile patrulează între locul lor și punctul ales'); }
  else if (act === 'rtb') { doCmd(['rb', sel.filter(u => u.kind === 'unit').map(u => u.id)]); sfx('ack'); }
  else if (act === 'rtr') { doCmd(['rr', sel.filter(u => u.kind === 'unit').map(u => u.id)]); sfx('ack'); }
  else if (act === 'recyc') { doCmd(['rc', sel.filter(u => u.kind === 'unit').map(u => u.id)]); sfx('ack'); }
  else if (act === 'produce') queueUnit(e, JSON.parse(v), 1);
  else if (act === 'unq') doCmd(['uq', e.id, +v]);
  else if (act === 'designer') openDesigner(e);
  else if (act === 'research') { const r = RS.find(x => x.id === v); const l = !e.res && e.complete ? e : ents.find(x => x.alive && x.team === 0 && x.type === 'lab' && x.complete && !x.res);
    if (!l) toast('Toate laboratoarele sunt ocupate'); else if (T.energy >= r.cost) { doCmd(['rs', l.id, r.id]); panelSig = ''; } }
});
function queueUnit(f, d, n) {
  const T = TEAMS[0];
  if (T.energy < unitStats(d, 0).cost || f.queue.length >= 8) toast('Energie insuficientă sau coadă plină'); else doCmd(['q', f.id, { ch: d.ch, pr: d.pr, wp: d.wp }, n]);
  panelSig = '';
  if (!(d.wp === 'truck' && d.ch === 'light' && d.pr === 'wheels')) { lastDesigns = [d, ...lastDesigns.filter(x => designName(x) !== designName(d))].slice(0, 3); }
}

// designer
let dsg = { ch: 'light', pr: 'wheels', wp: 'mg' }, dsgFactory = null;
function defDesign(ft) { return ft === 'cybfactory' ? { ch: 'cyborg', pr: 'legs', wp: 'mg' } : ft === 'airfactory' ? (TEAMS[0].tech.has('vtol') ? { ch: 'light', pr: 'vtol', wp: 'mg' } : { ch: 'drone', pr: 'rotor', wp: 'mg' }) : { ch: 'light', pr: 'wheels', wp: 'mg' }; }
function dsgLists(ft) { const std = Object.keys(CH).filter(k => !CH[k].only);
  if (ft === 'cybfactory') return { pr: ['legs'], ch: ['cyborg', 'hcyborg'], wp: CYB_WP };
  if (ft === 'airfactory') return { pr: ['rotor', 'vtol'], ch: dsg.pr === 'rotor' ? ['drone'] : std, wp: dsg.pr === 'rotor' ? DRONE_WP : VTOL_WP };
  return { pr: Object.keys(PR).filter(k => !PR[k].air && k !== 'legs'), ch: std, wp: null }; }
function fixDesign(ft, f) { const T = TEAMS[0]; const D = defDesign(ft);
  if (facFor(dsg) !== ft) Object.assign(dsg, D);
  if (ft === 'airfactory') { if (f === 'ch') dsg.pr = dsg.ch === 'drone' ? 'rotor' : 'vtol'; if (dsg.pr === 'rotor') dsg.ch = 'drone'; else if (dsg.ch === 'drone') dsg.ch = 'light'; }
  if (ft === 'cybfactory' && !CH[dsg.ch].only) dsg.ch = 'cyborg';
  if (!validDesign(dsg)) dsg.wp = 'mg'; if (!validDesign(dsg)) Object.assign(dsg, D); }
let dsgBase = null;
function openDesigner(f) { dsgFactory = f; const mine = lastDesigns.filter(d => facFor(d) === f.type); if (mine[0]) dsg = { ...mine[0] }; fixDesign(f.type); dsgBase = { ...(mine[0] || dsg) }; $('designer').classList.remove('hidden'); renderDesigner(); }
// numbers used by the comparison bars and the spider chart
function dsgVals(d) { const st = unitStats(d, 0), w = st.w; return { hp: st.hp, spd: st.speed, atk: w.dmg > 0 ? w.dmg / w.rof : 0, rng: st.range, sup: w.kind === 'radar' ? w.aura : w.kind === 'repair' ? w.heal : 0, cost: st.cost, time: st.time }; }
const DSG_AX = [['hp', 'Viață', 900], ['spd', 'Viteză', 9], ['atk', 'Atac', 45], ['rng', 'Rază', 36], ['cost', 'Ieftin', 420]];
function drawRadar(cur, base) {
  const c = $('dRadar'); if (!c) return; const g = c.getContext('2d'), W = c.width, H = c.height, cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) * 0.36, n = DSG_AX.length;
  g.clearRect(0, 0, W, H); const pt = (i, k) => { const a = -Math.PI / 2 + i / n * TAU; return [cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k]; };
  const norm = (v, ax) => clamp(ax[0] === 'cost' ? 1 - v[ax[0]] / ax[2] : v[ax[0]] / ax[2], 0.04, 1);
  g.strokeStyle = '#ffffff22'; g.lineWidth = 1; for (const k of [0.33, 0.66, 1]) { g.beginPath(); for (let i = 0; i <= n; i++) { const [x, y] = pt(i % n, k); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  for (let i = 0; i < n; i++) { const [x, y] = pt(i, 1); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); const [lx, ly] = pt(i, 1.28); g.fillStyle = '#cfc8b8'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(DSG_AX[i][1], lx, ly); }
  const poly = (v, fill, line) => { g.beginPath(); DSG_AX.forEach((ax, i) => { const [x, y] = pt(i, norm(v, ax)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fillStyle = fill; g.fill(); g.strokeStyle = line; g.lineWidth = 1.5; g.stroke(); };
  if (base) poly(base, 'rgba(160,160,170,.18)', 'rgba(200,200,210,.7)'); poly(cur, 'rgba(110,210,70,.35)', '#8be05a');
}
const DICON = { ...RICON, rotor: RICON.drone, legs: RICON.cyborg };
function renderDesigner() {
  const T = TEAMS[0];
  const card = (obj, field, k, sub) => { const ok = T.tech.has(k); const o = obj[k];
    return `<button data-f="${field}" data-k="${k}" class="dcard ${dsg[field] === k ? 'on' : ''}" ${ok ? '' : 'disabled'}>${DICON[k] || ''}<span class="rn">${o.name}</span><span class="rm">${ok ? sub(o) : '🔒 cercetează'}</span></button>`; };
  const ft = dsgFactory ? dsgFactory.type : 'factory', LS = dsgLists(ft);
  $('dPr').innerHTML = LS.pr.map(k => card(PR, 'pr', k, o => `${o.cost}⚡ · viteză ×${o.spd}`)).join('');
  $('dCh').innerHTML = LS.ch.map(k => card(CH, 'ch', k, o => `${o.cost}⚡ · ${o.hp} viață`)).join('');
  $('dWp').innerHTML = (LS.wp || ['mg', 'cannon', 'flame', 'rockets', 'viper', 'laser', 'mortar', ...ART_W.filter(k => k !== 'mortar' && T.tech.has(k)), 'radar', 'repair', 'truck']).map(k => card(WP, 'wp', k, o => o.kind === 'radar' ? `${o.cost}⚡ · +25% rază aliați` : o.kind === 'repair' ? `${o.cost}⚡ · repară ${o.heal}/s` : o.kind === 'truck' ? `${o.cost}⚡ · construiește` : `${o.cost}⚡ · rază ${o.range}`)).join('');
  const st = unitStats(dsg, 0); const cur = dsgVals(dsg), base = dsgBase && designName(dsgBase) !== designName(dsg) ? dsgVals(dsgBase) : null;
  // bar with a marker for the previous design and a coloured difference
  const bar = (n, k, mx, fmt, lowGood) => { const v = cur[k], b = base ? base[k] : null; const d = b === null ? 0 : v - b; const good = lowGood ? d < 0 : d > 0;
    const dl = b === null || Math.abs(d) < 1e-6 ? '' : `<em class="${good ? 'up' : 'dn'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</em>`;
    return `<div class="st"><span>${n}</span><div class="bar cmp"><i style="width:${clamp(v / mx, 0, 1) * 100}%"></i>${b !== null ? `<b style="left:${clamp(b / mx, 0, 1) * 100}%"></b>` : ''}</div><span>${fmt(v)}${dl}</span></div>`; };
  const w = st.w; const R0 = v => String(Math.round(v)), R1 = v => v.toFixed(1);
  const third = w.kind === 'radar' ? bar('Radar', 'sup', 30, v => R0(v) + 'm') : w.kind === 'repair' ? bar('Reparare', 'sup', 20, v => R0(v) + '/s') : w.kind === 'truck' ? '<div class="hint">Construiește și repară clădiri.</div>' : bar('Atac', 'atk', 45, R0) + bar('Rază', 'rng', 36, R0);
  $('dName').innerHTML = `${designName(dsg)}<small>${PR[dsg.pr].name} · ${CH[dsg.ch].name} · ${WP[dsg.wp].name}</small>`;
  $('dStats').innerHTML = `${bar('Viață', 'hp', 900, R0)}${bar('Viteză', 'spd', 9, R1)}${third}${bar('Cost', 'cost', 420, v => R0(v) + '⚡', true)}${bar('Timp', 'time', 30, v => R0(v) + 's', true)}${base ? `<div class="cmpnote"><i></i> față de: ${designName(dsgBase)}</div>` : ''}`;
  drawRadar(cur, base);
  updatePreview();
}
$('designer').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b || b.disabled) return; sfx('click');
  if (b.dataset.f) { dsg[b.dataset.f] = b.dataset.k; fixDesign(dsgFactory ? dsgFactory.type : 'factory', b.dataset.f); renderDesigner(); return; }
  const a = b.dataset.d; if (a === 'close') $('designer').classList.add('hidden');
  if ((a === 'q1' || a === 'q5') && dsgFactory && dsgFactory.alive) { queueUnit(dsgFactory, { ...dsg }, a === 'q1' ? 1 : 5); $('designer').classList.add('hidden'); }
});
let prevR = null, prevScene, prevCam, prevGrp;
function updatePreview() {
  try {
    if (!prevR) { prevR = new THREE.WebGLRenderer({ canvas: $('prev'), antialias: true, alpha: true }); prevR.setPixelRatio(Math.min(devicePixelRatio, 2)); prevR.setSize(260, $('prev').clientHeight || 150, false); prevScene = new THREE.Scene(); prevScene.add(new THREE.HemisphereLight(0xffffff, 0x444033, 2)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 5, 4); prevScene.add(dl); prevCam = new THREE.PerspectiveCamera(35, 260 / 150, 0.1, 50); prevCam.position.set(4.5, 3.2, 5.5); prevCam.lookAt(0, 0.8, 0); }
    if (prevGrp) prevScene.remove(prevGrp); prevGrp = new THREE.Group(); const g = unitGeo(dsg, myPal()); prevGrp.add(new THREE.Mesh(g.body, matUnit)); const t = new THREE.Mesh(g.tur, matUnit); t.position.y = g.turY; prevGrp.add(t); if (g.legGeo) for (const h of g.hips) { const l = new THREE.Mesh(g.legGeo, matUnit); l.position.set(h[0], h[1], h[2]); prevGrp.add(l); } if (g.rotors) for (const r of g.rotors) { const bl = new THREE.Mesh(g.bladeGeo, matUnit); bl.position.set(r[0], r[1], r[2]); prevGrp.add(bl); } if (CH[dsg.ch].only) prevGrp.scale.setScalar(1.8); prevGrp.position.x = -1.6; prevScene.add(prevGrp);
  } catch (e) { prevR = null; }
}

// minimap
const mini = $('mini'), mctx = mini.getContext('2d'); const MS = 150; let miniBg;
function buildMiniBg() {
  const c = document.createElement('canvas'); c.width = c.height = MS; const g = c.getContext('2d'); const img = g.createImageData(MS, MS);
  for (let j = 0; j < MS; j++) for (let i = 0; i < MS; i++) { const x = (i / MS - 0.5) * MAP, z = (j / MS - 0.5) * MAP; const h = heightAt(x, z); const w = biomeW(x, z); const v = clamp(0.75 + h * 0.02, 0.4, 1.2); const k = (j * MS + i) * 4; const snowy = h > 16 ? 1 : 0;
    const r = 90 * w.green + 220 * w.sand + 230 * w.snow + 125 * w.mtn, g = 125 * w.green + 185 * w.sand + 236 * w.snow + 118 * w.mtn, b = 60 * w.green + 120 * w.sand + 245 * w.snow + 108 * w.mtn;
    img.data[k] = snowy ? 240 : r * v; img.data[k + 1] = snowy ? 244 : g * v; img.data[k + 2] = snowy ? 250 : b * v; img.data[k + 3] = 255; }
  g.putImageData(img, 0, 0); g.fillStyle = 'rgba(70,66,60,.9)'; for (const o of OBST) { if (o.mtn) continue; g.beginPath(); g.arc((o.x / MAP + 0.5) * MS, (o.z / MAP + 0.5) * MS, Math.max(1, o.r / MAP * MS), 0, TAU); g.fill(); }
  miniBg = c;
}
let miniView = null, miniViewT = 0;
function drawMini(dt) {
  const W = mini.width; mctx.save(); mctx.clearRect(0, 0, W, W); mctx.beginPath(); mctx.arc(W / 2, W / 2, W / 2, 0, TAU); mctx.clip();
  mctx.translate(W / 2, W / 2); mctx.rotate(cam.yaw); mctx.translate(-W / 2, -W / 2);
  mctx.drawImage(miniBg, 0, 0, W, W); const k = W / MAP; const P = (x) => (x + HALF) * k;
  for (const w of WELLS) { mctx.fillStyle = w.pump ? TEAMC[w.pump.pal].mini : '#111'; mctx.fillRect(P(w.x) - 2, P(w.z) - 2, 4, 4); }
  for (const e of ents) { if (!e.alive) continue; mctx.fillStyle = e.selected ? '#fff' : TEAMC[e.pal].mini; const s = e.kind === 'bld' ? 5 : 3; mctx.fillRect(P(e.x) - s / 2, P(e.z) - s / 2, s, s); }
  for (let i = pings.length - 1; i >= 0; i--) { const p = pings[i]; p.t -= dt; if (p.t <= 0) { pings.splice(i, 1); continue; } mctx.strokeStyle = 'rgba(255,80,40,' + p.t / 2 + ')'; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(P(p.x), P(p.z), (2 - p.t) * 12 + 3, 0, TAU); mctx.stroke(); }
  miniViewT -= dt; if (miniViewT <= 0) { miniViewT = 0.2; const pts = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(p => screenToGround(p[0], p[1])); miniView = pts.every(p => p) ? pts : null; }
  if (miniView) { mctx.strokeStyle = 'rgba(255,255,255,.8)'; mctx.lineWidth = 1.2; mctx.beginPath(); miniView.forEach((p, i) => i ? mctx.lineTo(P(p.x), P(p.z)) : mctx.moveTo(P(p.x), P(p.z))); mctx.closePath(); mctx.stroke(); }
  mctx.restore();
}
function miniTap(e) { const r = mini.getBoundingClientRect(); let px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5; const c = Math.cos(-cam.yaw), s = Math.sin(-cam.yaw); const x = px * c - py * s, y = px * s + py * c; cam.x = x * MAP; cam.z = y * MAP; }
let miniDown = false;
mini.addEventListener('pointerdown', e => { miniDown = true; mini.setPointerCapture(e.pointerId); miniTap(e); });
mini.addEventListener('pointermove', e => { if (miniDown) miniTap(e); });
mini.addEventListener('pointerup', () => miniDown = false);

// overlay
const ov = $('ov'), og = ov.getContext('2d');
function drawOverlay() {
  og.clearRect(0, 0, ov.width, ov.height);
  for (const e of ents) {
    if (!e.alive) continue; const show = e.selected || e.hp < e.maxHp - 0.5 || (e.kind === 'bld' && !e.complete); if (!show && !e.rank) continue;
    const p = toScreen(e.x, e.y + e.h + 0.7, e.z); if (p.z > 1 || p.x < -50 || p.x > innerWidth + 50 || p.y < -20 || p.y > innerHeight + 20) continue;
    if (e.rank) { og.fillStyle = '#ffd23a'; og.strokeStyle = '#000a'; og.lineWidth = 1; for (let k = 0; k < e.rank; k++) { const cx = p.x + (e.kind === 'bld' ? 30 : 22), cy = p.y + 6 - k * 6; og.beginPath(); og.moveTo(cx - 6, cy); og.lineTo(cx, cy - 4.5); og.lineTo(cx + 6, cy); og.lineTo(cx + 6, cy + 2.6); og.lineTo(cx, cy - 1.9); og.lineTo(cx - 6, cy + 2.6); og.closePath(); og.fill(); og.stroke(); } }
    if (e.selected) { const c = toScreen(e.x, e.y + e.h * 0.45, e.z), q = toScreen(e.x + e.r * 1.25, e.y + e.h * 0.45, e.z); const hw = clamp(Math.hypot(q.x - c.x, q.y - c.y), 10, 90) * 1.1, hh = hw * 0.85, k = Math.max(4, hw * 0.35);
      og.strokeStyle = e.team === 1 ? '#ff7050' : '#e8ffe0'; og.lineWidth = 1.6; og.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = c.x + sx * hw, y = c.y + sy * hh; og.moveTo(x - sx * k, y); og.lineTo(x, y); og.lineTo(x, y - sy * k); } og.stroke(); }
    if (!show) continue;
    const w = e.kind === 'bld' ? 46 : 28; const r = clamp(e.hp / e.maxHp, 0, 1);
    og.fillStyle = 'rgba(0,0,0,.6)'; og.fillRect(p.x - w / 2 - 1, p.y - 1, w + 2, 6);
    og.fillStyle = e.team === 1 ? (r > 0.5 ? '#e05a3a' : '#a02010') : (r > 0.5 ? '#7fd04a' : r > 0.25 ? '#e0b030' : '#d04020'); og.fillRect(p.x - w / 2, p.y, w * r, 4);
    if (e.kind === 'bld' && !e.complete) { og.fillStyle = '#3f9fe0'; og.fillRect(p.x - w / 2, p.y + 6, w * e.built, 3); }
    if (e.kind === 'unit' && e.team === 0 && e.st.w.dmg > 0) {   // white reload line under the health bar
      const k = e.cdMax > 0 ? clamp(1 - e.cd / e.cdMax, 0, 1) : 1;
      og.fillStyle = 'rgba(0,0,0,.7)'; og.fillRect(p.x - w / 2 - 1, p.y + 4, w + 2, 4);
      og.fillStyle = k >= 1 ? '#ffffff' : '#d8d8d8'; og.fillRect(p.x - w / 2, p.y + 5, w * k, 2);
      og.strokeStyle = 'rgba(255,255,255,.35)'; og.lineWidth = 1; og.strokeRect(p.x - w / 2 - 1.5, p.y - 1.5, w + 3, 10); }
  }
  if (gesture && gesture.type === 'box') { og.strokeStyle = '#7fff7f'; og.lineWidth = 1.5; og.fillStyle = 'rgba(120,255,120,.12)'; const x = Math.min(gesture.sx, gesture.x), y = Math.min(gesture.sy, gesture.y), w = Math.abs(gesture.x - gesture.sx), h = Math.abs(gesture.y - gesture.sy); og.fillRect(x, y, w, h); og.strokeRect(x, y, w, h); }
}
// selection rings
const ringGeo = new THREE.RingGeometry(1, 1.18, 28).rotateX(-Math.PI / 2);
const ringMats = [new THREE.MeshBasicMaterial({ color: 0x80ff80, transparent: true, opacity: 0.9, depthWrite: false }), new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.9, depthWrite: false })];
const rings = []; for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(ringGeo, ringMats[0]); m.visible = false; scene.add(m); rings.push(m); }
function updRings() { let i = 0; for (const e of sel) { if (i >= rings.length) break; if (!e.alive) continue; const m = rings[i++]; m.material = ringMats[e.team]; m.visible = true; m.position.set(e.x, (e.kind === 'unit' ? heightAt(e.x, e.z) : e.y) + 0.15, e.z); m.scale.setScalar(e.r * 1.25); } for (; i < rings.length; i++) rings[i].visible = false; }

// well flames
function updWells(dt) { for (const w of WELLS) { if (w.pump) continue; w.fxT -= dt; if (w.fxT <= 0) { w.fxT = 0.09; fx('flame', w.x + rand(-0.6, 0.6), w.h + 0.6, w.z + rand(-0.6, 0.6), 1); if (Math.random() < 0.25) fx('smoke', w.x, w.h + 2.5, w.z, 0.9); } } }

// ================= AUDIO (procedural, original) =================
const AU = { ctx: null, music: true, sfx: true, heat: 0, step: 0, nextT: 0 };
const BPM = 84, STEP = 60 / BPM / 4;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const PROG_A = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
const PROG_B = [[50, 53, 57], [48, 52, 55], [46, 50, 53], [45, 49, 52]];
const SCALE = [62, 64, 65, 67, 69, 70, 72, 74];
function audioInit() {
  if (AU.ctx) { AU.ctx.resume(); return; } const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const ctx = AU.ctx = new AC();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(ctx.destination);
  AU.master = ctx.createGain(); AU.master.gain.value = 0.9; AU.master.connect(comp);
  AU.mus = ctx.createGain(); AU.mus.gain.value = 0.55; AU.mus.connect(AU.master);
  AU.sfxG = ctx.createGain(); AU.sfxG.gain.value = 0.7; AU.sfxG.connect(AU.master);
  const len = ctx.sampleRate * 3, ir = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  AU.rev = ctx.createConvolver(); AU.rev.buffer = ir; const rg = ctx.createGain(); rg.gain.value = 0.5; AU.rev.connect(rg); rg.connect(AU.mus);
  AU.dly = ctx.createDelay(1); AU.dly.delayTime.value = STEP * 3; const fb = ctx.createGain(); fb.gain.value = 0.38; AU.dly.connect(fb); fb.connect(AU.dly); const dl = ctx.createGain(); dl.gain.value = 0.5; AU.dly.connect(dl); dl.connect(AU.mus);
  AU.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = AU.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const n = ctx.createBufferSource(); n.buffer = AU.noise; n.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.7; const wg = ctx.createGain(); wg.gain.value = 0.05; const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 200; lfo.connect(lg); lg.connect(bp.frequency); n.connect(bp); bp.connect(wg); wg.connect(AU.mus); n.start(); lfo.start();
  AU.nextT = ctx.currentTime + 0.1; setInterval(schedule, 50); setTimeout(() => { if (!SB.click) buildSfx(); }, 30);
}
function schedule() { const ctx = AU.ctx; if (!ctx || ctx.state !== 'running') return; if (AU.nextT < ctx.currentTime) AU.nextT = ctx.currentTime + 0.05; while (AU.nextT < ctx.currentTime + 0.25) { if (AU.music && !S.paused) playStep(AU.step, AU.nextT); AU.nextT += STEP; AU.step++; } }
function env(g, t, a, peak, dur, rel) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + Math.max(a, dur)); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, dur) + rel); }
function playStep(s, t) {
  const ctx = AU.ctx; const bar = Math.floor(s / 16), st = s % 16, sec = Math.floor(bar / 8) % 4;
  const prog = sec === 2 ? PROG_B : PROG_A; const ch = prog[Math.floor(bar / 2) % 4]; const heat = AU.heat;
  if (st === 0 && bar % 2 === 0) pad(ch, t, STEP * 32);
  const root = ch[0] - 12;
  if (heat > 0.35) { if (st % 2 === 0) bass(root + (st === 14 ? 7 : 0), t, STEP * 1.5, 0.14); } else if (st === 0 || st === 10) bass(root, t, STEP * (st === 0 ? 9 : 5), 0.18);
  if (sec === 1 || sec === 3 || heat > 0.5) { if (st % 2 === 0 || heat > 0.7) { const pat = [0, 1, 2, 1, 0, 2, 1, 2]; arp(ch[pat[(st >> 1) % 8]] + ((st % 8 < 4) ? 12 : 24), t); } }
  if (sec === 2 && st % 8 === 0 && Math.random() < 0.65) lead(pick(SCALE) + (Math.random() < 0.3 ? 12 : 0), t, STEP * rand(4, 8));
  if (heat > 0.3) { if (st === 0 || st === 6 || st === 10) kick(t); if (st === 4 || st === 12) snare(t); if (st % 2 === 1) hat(t, 0.04 + heat * 0.03); }
  else if (st === 0 && bar % 4 === 0) boom(t);
}
function osc(type, f, t, dur) { const o = AU.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur); return o; }
function pad(ch, t, dur) {
  const ctx = AU.ctx; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2; f.frequency.setValueAtTime(350, t); f.frequency.linearRampToValueAtTime(900 + AU.heat * 800, t + dur * 0.5); f.frequency.linearRampToValueAtTime(400, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.055, t + 2.5); g.gain.setValueAtTime(0.055, t + dur - 1); g.gain.linearRampToValueAtTime(0.0001, t + dur + 2);
  f.connect(g); g.connect(AU.mus); g.connect(AU.rev);
  for (const n of ch) for (const det of [-8, 8]) { const o = osc('sawtooth', mtof(n + 12), t, dur + 2.2); o.detune.value = det; o.connect(f); }
  const sub = osc('sine', mtof(ch[0]), t, dur + 2.2); const sg = ctx.createGain(); sg.gain.value = 0.6; sub.connect(sg); sg.connect(f);
}
function bass(n, t, dur, vol) { const ctx = AU.ctx; const o = osc('sawtooth', mtof(n), t, dur + 0.4); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; const g = ctx.createGain(); env(g, t, 0.01, vol, dur * 0.6, 0.3); o.connect(f); f.connect(g); g.connect(AU.mus); }
function arp(n, t) { const ctx = AU.ctx; const o = osc('triangle', mtof(n), t, 0.4); const g = ctx.createGain(); env(g, t, 0.005, 0.04, 0.02, 0.25); o.connect(g); g.connect(AU.dly); g.connect(AU.mus); }
function lead(n, t, dur) { const ctx = AU.ctx; const o = osc('sine', mtof(n), t, dur + 1); const l = osc('sine', 5, t, dur + 1); const lg = ctx.createGain(); lg.gain.value = 10; l.connect(lg); lg.connect(o.detune); const g = ctx.createGain(); env(g, t, 0.3, 0.05, dur * 0.7, 0.8); o.connect(g); g.connect(AU.mus); g.connect(AU.rev); }
function kick(t) { const ctx = AU.ctx; const o = osc('sine', 130, t, 0.4); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); const g = ctx.createGain(); env(g, t, 0.003, 0.45, 0.02, 0.3); o.connect(g); g.connect(AU.mus); }
function noiseSrc(t, dur) { const s = AU.ctx.createBufferSource(); s.buffer = AU.noise; s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05); return s; }
function snare(t) { const ctx = AU.ctx; const s = noiseSrc(t, 0.25); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200; const g = ctx.createGain(); env(g, t, 0.002, 0.14, 0.01, 0.15); s.connect(f); f.connect(g); g.connect(AU.mus); g.connect(AU.rev); }
function hat(t, v) { const ctx = AU.ctx; const s = noiseSrc(t, 0.06); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = ctx.createGain(); env(g, t, 0.001, v, 0.005, 0.04); s.connect(f); f.connect(g); g.connect(AU.mus); }
function boom(t) { const ctx = AU.ctx; const o = osc('sine', 60, t, 2.5); o.frequency.exponentialRampToValueAtTime(30, t + 2); const g = ctx.createGain(); env(g, t, 0.01, 0.3, 0.05, 2); o.connect(g); g.connect(AU.mus); g.connect(AU.rev); }
// ---- realistic procedural sound effects (pre-rendered once into buffers) ----
const SB = {};
function buildSfx() {
  const ctx = AU.ctx, SR = ctx.sampleRate, TAU2 = Math.PI * 2;
  const lpA = f => 1 - Math.exp(-TAU2 * f / SR);
  const W = () => Math.random() * 2 - 1;
  const mk = (dur, fn, drive = 1.2) => {
    const n = Math.floor(dur * SR), b = ctx.createBuffer(1, n, SR), d = b.getChannelData(0); let pk = 1e-6;
    for (let i = 0; i < n; i++) { const v = Math.tanh(fn(i / SR, i) * drive); d[i] = v; pk = Math.max(pk, Math.abs(v)); }
    const fade = Math.min(n, SR * 0.02); for (let i = 0; i < n; i++) { d[i] /= pk; if (i > n - fade) d[i] *= (n - i) / fade; }
    return b;
  };
  // filters as closures
  const LP = () => { let y = 0; return (x, f) => (y += lpA(f) * (x - y)); };
  const BR = () => { let y = 0; return () => (y = (y + 0.02 * W()) / 1.02) * 3.5; }; // brown noise
  // gun crack + body + low thump
  const gun = (dur, crackDecay, bodyF0, bodyF1, bodyDecay, thumpF0, thumpF1, thumpAmp, rumbleAmp) => { const l1 = LP(), l2 = LP(), br = BR(); let ph = 0;
    return mk(dur, t => { const crack = W() * Math.exp(-t * crackDecay);
      const bf = bodyF1 + (bodyF0 - bodyF1) * Math.exp(-t * 8); const body = l1(W(), bf) * Math.exp(-t * bodyDecay) * 2.2;
      const tf = thumpF1 + (thumpF0 - thumpF1) * Math.exp(-t * 12); ph += TAU2 * tf / SR; const thump = Math.sin(ph) * Math.exp(-t * 7) * thumpAmp;
      const rum = l2(br(), 180) * Math.exp(-t * 2.2) * rumbleAmp; return crack * 0.9 + body + thump + rum; }, 1.6); };
  SB.cannon = [gun(1.8, 220, 3200, 160, 6, 75, 34, 1.1, 0.9), gun(1.8, 260, 2800, 140, 5.5, 68, 30, 1.2, 1.0)];
  SB.mg = [0, 1, 2].map(k => { const l = LP(), l2 = LP(); return mk(0.22, t => { const crack = W() * Math.exp(-t * (380 + k * 40)); const body = l(W(), 2200 - k * 300) * Math.exp(-t * 38) * 1.6; const thump = Math.sin(TAU2 * (130 + k * 15) * t) * Math.exp(-t * 45) * 0.6; const tail = l2(W(), 700) * Math.exp(-t * 14) * 0.35; const bolt = t > 0.05 && t < 0.058 ? W() * 0.35 : 0; return crack + body + thump + tail + bolt; }, 1.8); });
  { const l = LP(), l2 = LP(), br = BR(); SB.rocket = mk(1.4, t => { const pop = W() * Math.exp(-t * 120) * 0.8; const att = Math.min(1, t / 0.04); const f = 900 + 3200 * Math.exp(-t * 2.5); const hiss = (l2(W(), f) - l(W(), 300) * 0.5) * att * Math.exp(-t * 2.4) * 1.4; const roar = br() * att * Math.exp(-t * 2.8) * 0.6; return pop + hiss + roar; }); }
  const boom = (dur, decay, f0, f1, low, debris) => { const l = LP(), l2 = LP(), br = BR(); let ph = 0;
    return mk(dur, t => { const crack = W() * Math.exp(-t * 90) * 0.9; const f = f1 + (f0 - f1) * Math.exp(-t * 3); const rum = l(br() * 0.7 + W() * 0.3, f) * Math.exp(-t * decay) * 2.4; ph += TAU2 * (low * (0.6 + 0.4 * Math.exp(-t * 4))) / SR; const sub = Math.sin(ph) * Math.exp(-t * decay * 1.3) * 0.9;
      const deb = t > 0.15 && Math.random() < debris * Math.exp(-t * 2) ? W() * 0.6 : 0; const dd = l2(deb, 2500) * 1.5; return crack + rum + sub + dd; }, 1.5); };
  SB.boom = [boom(2.4, 2.2, 1600, 120, 55, 0.004), boom(2.4, 2.0, 1400, 100, 48, 0.005)];
  SB.bigboom = [boom(4.2, 1.15, 1300, 70, 40, 0.007)];
  { const l = LP(); const P = [[440, 6], [1187, 9], [1993, 13], [3121, 18], [4470, 24]]; SB.hit = mk(0.7, t => { let s = W() * Math.exp(-t * 90) * 0.7 + l(W(), 900) * Math.exp(-t * 18) * 0.8; for (const [f, d] of P) s += Math.sin(TAU2 * f * t + f) * Math.exp(-t * d) * 0.22; return s; }); }
  // electric arc welding: steady mains buzz + sizzling arc, smooth fade, no knocks
  { const l = LP(), l2 = LP(); let env = 0.6, tgt = 0.6; SB.weld = [0, 1, 2].map(k => mk(0.9, (t, i) => { if (i % 220 === 0) tgt = 0.45 + Math.random() * 0.55; env += (tgt - env) * 0.004;
      const f0 = 100 + k * 3; let buzz = 0; for (let h = 1; h <= 7; h += 2) buzz += Math.sin(TAU2 * f0 * h * t) / h; buzz = Math.tanh(buzz * 2.2) * 0.35;
      const hiss = (W() - l(W(), 2200)) * 0.55; const sizzle = l2((Math.random() < 0.004 ? W() * 3 : 0), 6000) * 0.8;
      const fade = Math.min(1, t / 0.12) * Math.min(1, (0.9 - t) / 0.2); return (buzz + hiss * env + sizzle) * fade * 0.8; }, 1)); }
  { const l = LP(); SB.click = mk(0.04, t => l(W(), 2500) * 0.7 * Math.exp(-t * 160), 1); }
  { const l = LP(), l2 = LP(); SB.ack = mk(0.32, t => { const radio = (l(W(), 3200) - l2(W(), 900)) * (t < 0.06 || t > 0.24 ? 0.9 : 0.12); return radio; }, 1); }
  { const l = LP(); let ph = 0; SB.laser = mk(0.45, t => { const f = 600 + 2600 * Math.exp(-t * 9); ph += TAU2 * (f + 180 * Math.sin(TAU2 * 55 * t)) / SR; return (Math.sin(ph) * 0.8 + Math.sin(ph * 1.5) * 0.3 + l(W(), 5000) * 0.25) * Math.min(1, t * 300) * Math.exp(-t * 7); }, 1.3); }
  { const l = LP(), l2 = LP(), br = BR(); SB.flame = mk(0.4, t => (l(W(), 1400) * 1.4 + l2(br(), 200) * 0.8 + (Math.random() < 0.02 ? W() * 0.5 : 0)) * Math.min(1, t * 60) * Math.exp(-t * 5)); }
  // ---- artillery: each weapon has its own firing sound
  { const l = LP(); let ph = 0; SB.art_mortar = mk(0.7, t => { ph += TAU2 * (60 + 140 * Math.exp(-t * 18)) / SR; return Math.sin(ph) * Math.exp(-t * 9) * 1.2 + l(W(), 900) * Math.exp(-t * 14) * 0.9 + W() * Math.exp(-t * 300) * 0.5; }); }
  { const l = LP(); SB.art_rmortar = mk(0.5, t => { const k = Math.floor(t / 0.12), tt = t - k * 0.12; return k < 3 ? (Math.sin(TAU2 * (90 + 120 * Math.exp(-tt * 25)) * tt) * Math.exp(-tt * 20) + l(W(), 1100) * Math.exp(-tt * 22) * 0.7) : 0; }); }
  SB.art_how = gun(2.6, 160, 2200, 90, 3.6, 60, 26, 1.5, 1.4);
  SB.art_rhow = gun(1.6, 240, 2600, 120, 5, 70, 32, 1.1, 0.9);
  SB.art_hhow = gun(4, 90, 1600, 60, 2.2, 46, 20, 2, 2);
  { const l = LP(), l2 = LP(); SB.art_inc = mk(1.8, t => { const b = l(W(), 1400) * Math.exp(-t * 5) * 1.4 + Math.sin(TAU2 * (55 + 40 * Math.exp(-t * 10)) * t) * Math.exp(-t * 5); const whoosh = l2(W(), 600 + 2400 * Math.exp(-t * 3)) * Math.min(1, t * 8) * Math.exp(-t * 2.2) * 0.9; return b + whoosh; }); }
  { const l = LP(); let ph = 0; SB.art_emp = mk(1.2, t => { ph += TAU2 * (300 + 1800 * Math.exp(-t * 6) + 120 * Math.sin(TAU2 * 30 * t)) / SR; const zap = (Math.random() < 0.06 ? W() : 0) * Math.exp(-t * 3); return Math.sin(ph) * 0.5 * Math.exp(-t * 3) + zap * 1.4 + Math.sin(TAU2 * 70 * t) * Math.exp(-t * 12) * 0.8 + l(W(), 700) * Math.exp(-t * 18); }); }
  { const l = LP(); let ph = 0; SB.art_plasma = mk(1.4, t => { ph += TAU2 * (200 + 900 * (1 - Math.exp(-t * 4))) / SR; const crackle = (Math.random() < 0.03 ? W() : 0) * Math.exp(-t * 2); return (Math.sin(ph) + 0.5 * Math.sin(ph * 2.02)) * Math.min(1, t * 10) * Math.exp(-t * 2.4) * 0.6 + crackle + l(W(), 500) * Math.exp(-t * 10) * 1.2; }); }
  { const l = LP(), l2 = LP(); SB.art_salvo = mk(1.3, t => { let s = 0; for (let k = 0; k < 4; k++) { const tt = t - k * 0.12; if (tt > 0) s += (W() * Math.exp(-tt * 140) * 0.6 + l(W(), 3000 * Math.exp(-tt * 2)) * Math.exp(-tt * 4) * 0.6); } return s + l2(W(), 250) * Math.exp(-t * 3) * 0.6; }); }
  { const l = LP(), l2 = LP(), br = BR(); SB.art_ball = mk(4, t => { const ign = W() * Math.exp(-t * 40) * 0.8; const roar = (l(br(), 220) * 1.6 + l2(W(), 1400) * 0.5) * Math.min(1, t * 2.5) * Math.exp(-t * 0.9); return ign + roar; }, 1.6); }
  // ---- impacts: every projectile lands with its own explosion (blast + sub thump + dirt/debris rain)
  const blast = (dur, o) => { const l = LP(), l2 = LP(), l3 = LP(), br = BR(); let ph = 0;
    return mk(dur, t => { const crack = W() * Math.exp(-t * o.crack) * o.ca;
      const f = o.f1 + (o.f0 - o.f1) * Math.exp(-t * 4); const body = l(br() * 0.6 + W() * 0.4, f) * Math.exp(-t * o.decay) * 2.2;
      ph += TAU2 * o.sub * (0.55 + 0.45 * Math.exp(-t * 5)) / SR; const sub = Math.sin(ph) * Math.exp(-t * o.decay * 1.4) * o.sa;
      const t2 = t - o.dd; const deb = t2 > 0 && Math.random() < o.deb * Math.exp(-t2 * 2.5) ? W() : 0;
      const dirt = l2(deb, 3500) * 1.6 + (t2 > 0 ? l3(W(), 1800) * Math.exp(-t2 * 3) * o.sand * Math.min(1, t2 * 10) : 0);
      return crack + body + sub + dirt; }, 1.5); };
  SB.imp_shell = [blast(1.6, { crack: 160, ca: 1, f0: 2600, f1: 150, decay: 4, sub: 65, sa: 0.8, dd: 0.12, deb: 0.006, sand: 0.25 }), blast(1.6, { crack: 180, ca: 1, f0: 2300, f1: 140, decay: 4.4, sub: 70, sa: 0.8, dd: 0.1, deb: 0.006, sand: 0.3 })];
  SB.imp_rocket = [blast(1.4, { crack: 200, ca: 1.2, f0: 3500, f1: 200, decay: 5, sub: 80, sa: 0.6, dd: 0.1, deb: 0.004, sand: 0.2 }), blast(1.4, { crack: 230, ca: 1.2, f0: 3800, f1: 220, decay: 5.4, sub: 85, sa: 0.6, dd: 0.08, deb: 0.004, sand: 0.2 })];
  SB.imp_mortar = [blast(2.2, { crack: 110, ca: 0.9, f0: 1800, f1: 110, decay: 2.8, sub: 52, sa: 1, dd: 0.2, deb: 0.008, sand: 0.45 }), blast(2.2, { crack: 120, ca: 0.9, f0: 2000, f1: 120, decay: 3, sub: 56, sa: 1, dd: 0.18, deb: 0.009, sand: 0.4 })];
  SB.imp_how = [blast(3, { crack: 80, ca: 1, f0: 1500, f1: 80, decay: 1.8, sub: 42, sa: 1.2, dd: 0.25, deb: 0.01, sand: 0.5 })];
  SB.imp_hhow = [blast(4.5, { crack: 60, ca: 1, f0: 1300, f1: 60, decay: 1.1, sub: 34, sa: 1.4, dd: 0.3, deb: 0.012, sand: 0.6 })];
  SB.imp_salvo = [blast(1.2, { crack: 220, ca: 1, f0: 3000, f1: 180, decay: 5.5, sub: 70, sa: 0.5, dd: 0.1, deb: 0.003, sand: 0.15 })];
  { const l = LP(), l2 = LP(), br = BR(); let ph = 0; SB.imp_inc = mk(2.4, t => { ph += TAU2 * (35 + 40 * Math.exp(-t * 6)) / SR; const whump = Math.sin(ph) * Math.exp(-t * 4) * 1.3;
      const roar = (l(br(), 300) * 1.2 + l2(W(), 1600) * 0.5) * Math.min(1, t * 6) * Math.exp(-t * 1.2); const crackle = Math.random() < 0.02 * Math.exp(-t) ? W() * 0.9 : 0; return W() * Math.exp(-t * 120) * 0.6 + whump + roar + crackle; }); }
  { const l = LP(); let ph = 0; const b = blast(2, { crack: 140, ca: 0.8, f0: 2200, f1: 150, decay: 2.6, sub: 60, sa: 0.9, dd: 0.2, deb: 0.004, sand: 0.2 }).getChannelData(0);
    SB.imp_plasma = mk(2, (t, i) => { ph += TAU2 * (1400 * Math.exp(-t * 3) + 180) / SR; const zap = (Math.random() < 0.05 * Math.exp(-t * 2) ? W() : 0) + Math.sin(ph) * 0.35 * Math.exp(-t * 4); return b[i] + l(zap, 6000) * 1.2; }); }
  // wreck: scattered metal clanks and rattles after a vehicle blows up
  SB.debris = [0, 1].map(v => { const l = LP(); const hits = []; for (let i = 0; i < 14; i++) hits.push([0.05 + Math.pow(Math.random(), 1.6) * 1.5, 600 + Math.random() * 2600, 0.3 + Math.random() * 0.7]);
    return mk(1.8, t => { let s = 0; for (const [t0, f, a] of hits) { const tt = t - t0; if (tt > 0 && tt < 0.25) s += (Math.sin(TAU2 * f * tt) * 0.6 + Math.sin(TAU2 * f * 1.47 * tt) * 0.35 + W() * 0.5) * Math.exp(-tt * 28) * a * Math.exp(-t0 * 1.2); } return s + l(W(), 1200) * Math.exp(-t * 4) * 0.25; }, 1.2); });
  // building collapse: long low rumble with falling concrete
  { const l = LP(), l2 = LP(), l3 = LP(), br = BR(); SB.collapse = mk(4.2, t => { const env = Math.min(1, t * 3) * Math.exp(-t * 0.75); const rum = l(br(), 140) * 2.2 * env; const crunch = l2(Math.random() < 0.012 * Math.exp(-t * 0.6) ? W() * 3 : 0, 1800) * 1.4; const grit = l3(W(), 900) * env * 0.35; return rum + crunch + grit; }, 1.4); }
  // ammunition cooking off: irregular pops and crackles
  { const l = LP(); const pops = []; for (let i = 0; i < 9; i++) pops.push([Math.random() * 1.6, 0.4 + Math.random() * 0.6]);
    SB.cookoff = mk(2.2, t => { let s = 0; for (const [t0, a] of pops) { const tt = t - t0; if (tt > 0 && tt < 0.2) s += (W() * Math.exp(-tt * 160) + Math.sin(TAU2 * 110 * tt) * Math.exp(-tt * 30) * 0.8) * a; } return s + l(Math.random() < 0.02 ? W() * 1.5 : 0, 3000) * Math.exp(-t * 0.8); }, 1.5); }
  SB.boom.push(boom(2.6, 1.9, 1800, 110, 52, 0.006), boom(2.2, 2.6, 2200, 140, 62, 0.003));
  SB.bigboom.push(boom(4.6, 1.0, 1100, 60, 36, 0.009));
  // incoming artillery whistle (falling pitch) heard just before the shell lands
  SB.whistle = [0, 1].map(k => { const l = LP(); let ph = 0; return mk(1.0, t => { const f = (1700 - k * 200) - 900 * t + 25 * Math.sin(TAU2 * 7 * t); ph += TAU2 * f / SR; return (Math.sin(ph) * 0.7 + l(W(), f) * 0.35) * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 30); }, 1); });
  // bullet ricochet off armour
  SB.ric = [0, 1, 2].map(k => { const l = LP(); let ph = 0; return mk(0.4, t => { ph += TAU2 * ((3200 - k * 500) - 1400 * t) / SR; return W() * Math.exp(-t * 400) * 0.8 + Math.sin(ph) * Math.exp(-t * 9) * 0.6 + l(W(), 5000) * Math.exp(-t * 30) * 0.3; }, 1); });
  const bell = (f, dur) => mk(dur, t => (Math.sin(TAU2 * f * t) + 0.45 * Math.sin(TAU2 * f * 2.01 * t) * Math.exp(-t * 3) + 0.2 * Math.sin(TAU2 * f * 3.02 * t) * Math.exp(-t * 6)) * Math.min(1, t * 400) * Math.exp(-t * 3.2), 1);
  SB.done = [bell(784, 1.2)]; SB.done2 = [bell(1175, 1.4)];
  SB.alert = mk(1.1, t => { const on = (t % 0.5) < 0.38 ? 1 : 0; const f = 420 + 40 * Math.sin(TAU2 * 6 * t); let s = 0; for (let k = 1; k <= 7; k += 2) s += Math.sin(TAU2 * f * k * t) / k; return s * on * 0.7; }, 1.4);
  // short outdoor reverb for effects
  const len = SR * 1.4, ir = ctx.createBuffer(2, len, SR); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = W() * Math.pow(1 - i / len, 4) * (i < SR * 0.01 ? 0 : 1); }
  AU.srev = ctx.createConvolver(); AU.srev.buffer = ir; const rg = ctx.createGain(); rg.gain.value = 0.35; AU.srev.connect(rg); rg.connect(AU.sfxG);
  // engine rumble loop (louder when units move near the camera)
  { const n = SR * 2, b = ctx.createBuffer(1, n, SR), d = b.getChannelData(0); const br = BR(); for (let i = 0; i < n; i++) { const t = i / SR; d[i] = br() * 0.5 * (0.75 + 0.25 * Math.sin(TAU2 * 21 * t)) + Math.sin(TAU2 * 42 * t) * 0.25 + Math.sin(TAU2 * 63 * t + 1) * 0.12; }
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; AU.engG = ctx.createGain(); AU.engG.gain.value = 0; s.connect(f); f.connect(AU.engG); AU.engG.connect(AU.sfxG); s.start(); }
}
let engT = 0;
function engineAudio(dt) {
  if (!AU.engG) return; engT += dt; if (engT < 0.2) return; engT = 0; let n = 0;
  for (const e of ents) if (e.alive && e.kind === 'unit' && Math.hypot(e.vx, e.vz) > 1 && Math.hypot(e.x - cam.x, e.z - cam.z) < 35 + cam.dist * 0.4) n++;
  const lvl = AU.sfx && !S.paused ? clamp(n / 6, 0, 1) * 0.5 * clamp(60 / (cam.dist + 20), 0.3, 1) : 0;
  AU.engG.gain.setTargetAtTime(lvl, AU.ctx.currentTime, 0.4);
}
const lastS = {};
function sfx(type, x, z) {
  const ctx = AU.ctx; if (!ctx || !AU.sfx || ctx.state !== 'running') return; if (!SB.click) buildSfx();
  const t = ctx.currentTime;
  const thr = { weld: 0.55, flame: 0.12, laser: 0.06, mg: 0.07, shell: 0.05, rocket: 0.08, boom: 0.06, bigboom: 0.2, hit: 0.05, imp_shell: 0.05, imp_rocket: 0.06, imp_mortar: 0.07, imp_how: 0.12, imp_hhow: 0.2, imp_inc: 0.15, imp_plasma: 0.12, imp_salvo: 0.09, whistle: 0.15, ric: 0.12, debris: 0.1, collapse: 0.4, cookoff: 0.3, click: 0.03, ack: 0.25 }[type] || 0; if (lastS[type] && t - lastS[type] < thr) return; lastS[type] = t;
  let vol = 1, pan = 0;
  if (x !== undefined) { const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz); vol = clamp(1 - d / (60 + cam.dist), 0, 1) * clamp(70 / (cam.dist + 20), 0.4, 1); if (vol < 0.03) return; pan = clamp((dx * Math.cos(cam.yaw) - dz * Math.sin(cam.yaw)) / 40, -0.7, 0.7); }
  const key = type === 'shell' ? 'cannon' : type; let buf = SB[key]; if (!buf) return; if (Array.isArray(buf)) buf = pick(buf);
  const VOL = { art_mortar: 0.7, art_rmortar: 0.6, art_how: 0.85, art_rhow: 0.75, art_hhow: 1, art_inc: 0.75, art_emp: 0.5, art_plasma: 0.55, art_salvo: 0.6, art_ball: 0.9, weld: 0.14, flame: 0.3, laser: 0.35, cannon: 0.75, mg: 0.32, rocket: 0.5, boom: 0.85, bigboom: 1, hit: 0.35, imp_shell: 0.7, imp_rocket: 0.75, imp_mortar: 0.85, imp_how: 0.95, imp_hhow: 1, imp_inc: 0.8, imp_plasma: 0.75, imp_salvo: 0.6, whistle: 0.3, ric: 0.22, debris: 0.45, collapse: 0.8, cookoff: 0.4, click: 0.25, ack: 0.22, done: 0.3, done2: 0.3, alert: 0.25 }[key] || 0.4;
  const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = ['click', 'ack', 'done', 'done2', 'alert'].includes(key) ? 1 : rand(0.9, 1.1);
  const g = ctx.createGain(); g.gain.value = VOL * vol; const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const loud = key.startsWith('imp_') || key.startsWith('art_') || ['boom', 'bigboom', 'cannon', 'rocket', 'collapse', 'debris', 'cookoff'].includes(key);
  if (loud && x !== undefined) { const d = Math.hypot(x - cam.x, z - cam.z); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(16000 / (1 + Math.pow(d / 22, 1.7)), 500, 16000); s.connect(lp); lp.connect(g); } else s.connect(g);
  if (p) { p.pan.value = pan; g.connect(p); p.connect(AU.sfxG); if (['cannon', 'boom', 'bigboom', 'rocket', 'hit', 'collapse', 'debris', 'cookoff'].includes(key) || key.startsWith('art_') || key.startsWith('imp_')) p.connect(AU.srev); } else g.connect(AU.sfxG);
  s.start(t);
  if (type === 'done') setTimeout(() => sfx('done2'), 140);
}

// ================= MULTIPLAYER (co-op: two commanders share one army against the citadel) =================
// The host phone runs the whole battle. The guest sends its orders and receives the state ~10x/s.
// Phones meet through the room server (room code); then talk directly (WebRTC) or, if a network blocks
// that, through the server.
const NET_URL = (() => { try { return localStorage.getItem('ironfall.server') || 'https://easofty.com/ironfall/api.php'; } catch (e) { return 'https://easofty.com/ironfall/api.php'; } })();
const NET = { on: false, host: false, cl: false, room: '', after: 0, me: 1, peers: {}, guests: [], ready: new Set(), players: [], gone: new Set(), ack: {}, pend: [], rx: {}, out: [], lastRx: 0, started: false, prepared: false, loopT: null, fails: 0 };
// up to 4 commanders: the host plus guests 1..3, each with a base and a colour of their own (one army, shared energy and research)
const palOf = k => k ? k + 1 : 0;   // guest k (1..9) uses colour k+1 (colour 1 is the enemy)
async function api(a, params, body) {
  const q = new URLSearchParams(Object.assign({ a, room: NET.room, me: NET.host ? 'h' : 'c' + (NET.me || 1) }, params || {}));
  const ctl = window.AbortController ? new AbortController() : null; const to = ctl ? setTimeout(() => ctl.abort(), 8000) : 0;
  try { const r = await fetch(NET_URL + '?' + q.toString(), Object.assign(body ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } } : { cache: 'no-store' }, ctl ? { signal: ctl.signal } : {}));
    if (!r.ok) { let j = null; try { j = await r.json(); } catch (x) {} throw new Error(j && j.err ? 'srv:' + j.err : 'http ' + r.status); } return await r.json(); } finally { clearTimeout(to); }
}
// direct links: the guest has one (key 'h', to the host); the host has one per guest (keys 1..3)
const peer = k => NET.peers[k] || (NET.peers[k] = { pc: null, dc: null, dcRx: 0, dcSnap: 0, rtcT: 0 });
const dcOpen = k => { const p = NET.peers[k === undefined ? 'h' : k]; return !!(p && p.dc && p.dc.readyState === 'open'); };
// the guest trusts the direct link only while game state actually arrives on it
const dcLive = k => dcOpen(k) && (NET.host || performance.now() - (NET.peers.h.dcSnap || 0) < 1500);
function queueOut(m) {
  NET.out.push(m); if (NET.out.length > 400) NET.out.splice(0, NET.out.length - 400);
  if (NET.out.length === 1 && NET.on) { clearTimeout(NET.loopT); NET.loopT = setTimeout(netPollLoop, 60); }
}
function netSend(m, to) {
  if (!NET.host) { if (NET.started) m.ack = LS.turn; if (dcLive('h') || (dcOpen('h') && m.t === 'p')) { try { NET.peers.h.dc.send(JSON.stringify(m)); return; } catch (e) { rtcDrop('h'); } } queueOut(m); return; }
  const list = to !== undefined ? [to] : NET.guests, srv = [];
  for (const k of list) { if (dcOpen(k)) { try { NET.peers[k].dc.send(JSON.stringify(m)); continue; } catch (e) { rtcDrop(k); } } srv.push(k); }
  if (srv.length) queueOut(to === undefined && srv.length === NET.guests.length ? m : Object.assign({}, m, { _to: srv }));
}
// one request does everything: deliver my queued messages and fetch the ones waiting for me
function netPollLoop() {
  clearTimeout(NET.loopT);
  const go = async () => {
    const out = NET.out.splice(0, 80);
    try {
      const r = await api('sync', { after: NET.after, st: NET.host && NET.started ? 1 : 0 }, { to: out }); NET.fails = 0;
      if (r && NET.host) { const g = Array.isArray(r.guests) ? r.guests.map(Number) : r.joined ? [1] : []; if (g.join() !== NET.guests.join()) { NET.guests = g; onGuests(); } }
      if (r && r.msgs) for (const [seq, m] of r.msgs) { if (seq <= NET.after) continue; NET.after = seq; netRecv(m); }
    } catch (e) { NET.out.unshift(...out); NET.fails++; if (NET.fails > 2) netStatus('Conexiune slabă cu serverul… se reîncearcă'); }
    const allDirect = NET.host ? NET.guests.length && NET.guests.every(k => dcOpen(k)) : dcLive('h'); const wait = allDirect ? 1500 : NET.out.length ? 120 : 200;
    NET.loopT = setTimeout(go, NET.fails ? Math.min(3000, 400 * NET.fails) : wait);
  };
  go();
}
function netRecv(m, via) {
  if (!m || typeof m !== 'object') return;
  NET.lastRx = performance.now();
  if (NET.host) {
    const k = via !== undefined ? via : (m._from | 0) || 1; NET.rx[k] = NET.lastRx;
    if (m.ack !== undefined) NET.ack[k] = Math.max(NET.ack[k] || 0, m.ack | 0);
    if (m.t === 'p') return;
    if (m.t === 'sdp' || m.t === 'ice') return rtcSignal(m, k);
    if (m.t === 'hi' || m.t === 'nm') { if (m.n) NET.names[k] = cleanName(m.n) || 'Aliat'; if (m.t === 'nm') { mpHostRefresh(); netSend({ t: 'chh', h: NET.chat }, k); return; } }
    if (m.t === 'hi') netSend({ t: 'cfg', seed: SEED, map: MAPI, diff: S.diff, tl: S.tl, mdef: MC.custom ? MC : null, slot: k }, k);
    else if (m.t === 'ready') { if (NET.started) netSend({ t: 'late' }, k); else { NET.ready.add(k); mpHostRefresh(); } }
    else if (m.t === 'c' && Array.isArray(m.c) && NET.players.includes(k)) NET.pend.push([palOf(k), m.c]);   // goes into the next turn
    else if (m.t === 'ch' && !NET.started && m.x) { const x = String(m.x).replace(/[\u0000-\u001f]/g, '').slice(0, 120), n = NET.names[k] || 'Aliat'; chatAdd(k, n, x); netSend({ t: 'ch', k, n, x }); }
    else if (m.t === 'rq') lsResend(k, m.n | 0);
    else if (m.t === 'h') lsCheck(k, m.n | 0, m.h | 0);
  } else {
    if (m.t === 'p') return;
    if (m.t === 'sdp' || m.t === 'ice') return rtcSignal(m, 'h');
    if (m.t === 'cfg') { if (NETCFG) return; if (m.slot) NET.me = m.slot | 0; try { sessionStorage.setItem('ironfall.net', JSON.stringify({ room: NET.room, me: NET.me, seed: m.seed, map: m.map, diff: m.diff, tl: m.tl | 0, mdef: m.mdef || null, after: NET.after })); } catch (e) {} location.reload(); }
    else if (m.t === 'go') lsBegin(m.pl);
    else if (m.t === 'lob' && Array.isArray(m.p)) { NET.lob = m.p; mpLobby(); }
    else if (m.t === 'ch') chatAdd(m.k | 0, cleanName(m.n) || 'Aliat', String(m.x || '').slice(0, 120));
    else if (m.t === 'chh' && Array.isArray(m.h)) { NET.chat = m.h.slice(-40); mpLobby(); }
    else if (m.t === 'T') lsTurns(m);
    else if (m.t === 'fx') LS.fix = m;   // applied when my simulation reaches that turn
    else if (m.t === 'late') { NET.on = false; $('mp').classList.remove('hidden'); mpView('msg', '❌ Partida a început fără tine. Cere-i gazdei o partidă nouă.'); }
  }
}
function onGuests() { if (!NET.started) mpHostRefresh(); }
// --- WebRTC direct links; each is watched by a heartbeat and falls back to the server if it goes quiet
function rtcMake(k) {
  if (!window.RTCPeerConnection) return null;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] });
  pc.onicecandidate = e => { if (e.candidate) netSend({ t: 'ice', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }, NET.host ? k : undefined); };
  pc.ondatachannel = e => rtcChannel(e.channel, k);
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && peer(k).pc === pc) rtcDrop(k); };
  peer(k).pc = pc; return pc;
}
function rtcChannel(dc, k) { const p = peer(k); p.dc = dc; dc.onmessage = e => { p.dcRx = performance.now(); try { const m = JSON.parse(e.data); if (m && m.t === 'T') p.dcSnap = p.dcRx; netRecv(m, NET.host ? k : undefined); } catch (x) {} }; dc.onopen = () => { p.dcRx = performance.now(); toast(NET.host ? `🔗 Legătură directă cu ${TEAMC[palOf(k)].name}` : '🔗 Legătură directă cu gazda'); }; dc.onclose = () => { if (p.dc === dc) rtcDrop(k); }; }
function rtcDrop(k) {   // a direct link died: go back to the server and resend the whole world
  const p = peer(k); const had = dcOpen(k) || p.dc; try { p.dc && p.dc.close(); } catch (e) {} try { p.pc && p.pc.close(); } catch (e) {}
  p.dc = null; p.pc = null; if (NET.host) p.rtcT = 20;
  if (had && NET.started) toast('↺ Legătura directă s-a pierdut — continuăm prin server');
  clearTimeout(NET.loopT); NET.loopT = setTimeout(netPollLoop, 50);
}
async function rtcOffer(k) { try { const pc = rtcMake(k); if (!pc) return; rtcChannel(pc.createDataChannel('g', { ordered: true }), k); const o = await pc.createOffer(); await pc.setLocalDescription(o); netSend({ t: 'sdp', d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }, k); } catch (e) {} }
async function rtcSignal(m, k) {
  const p = peer(k), to = NET.host ? k : undefined;
  try {
    if (m.t === 'sdp') {
      if (m.d.type === 'offer') { if (p.pc) { try { p.pc.close(); } catch (e) {} } p.dc = null; const pc = rtcMake(k); if (!pc) return; await pc.setRemoteDescription(m.d); const a = await pc.createAnswer(); await pc.setLocalDescription(a); netSend({ t: 'sdp', d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }, to); }
      else if (p.pc) await p.pc.setRemoteDescription(m.d);
    } else if (m.t === 'ice' && p.pc) await p.pc.addIceCandidate(m.c);
  } catch (e) {}
}
// ================= LOCKSTEP (how Warzone-style RTS games play online) =================
// Every phone runs the whole battle itself. Only the players' orders travel over the network.
// Time is cut into turns of 0.1 s (3 steps of 1/30 s). The host decides in which turn each order runs and
// sends the list of turns; every phone executes the same orders in the same turn, with the same random
// numbers, so all copies of the battle stay identical. Every 5 s the phones compare a fingerprint of the
// world; a phone that drifted apart gets the host's state.
const TICK = 1 / 30, TPT = 3, MAXLAG = 60;   // MAXLAG: the host waits for a phone more than 6 s behind
const LS = { acc: 0, turn: 0, tick: 0, have: -1, q: new Map(), sent: -1, sendT: 0, hist: new Map(), hash: new Map(), rqT: 0, pingT: 0, lastT: 0, fix: null, wait: '', fixT: {} };
const myPal = () => NET.on && !NET.host ? palOf(NET.me) : 0;
function lsFrame(dt) {
  if (!NET.host) { const behind = LS.have - LS.turn; if (behind > 3) dt += TICK * Math.min(behind - 2, 8); }   // catch up smoothly when turns piled up
  LS.acc = Math.min(LS.acc + dt, 0.6); let steps = 0;
  while (LS.acc >= TICK && steps < 40 && !S.over) {
    if (LS.tick === 0 && !lsTurnStart()) { LS.acc = Math.min(LS.acc, TICK); break; }
    update(TICK); steps++; LS.acc -= TICK;
    if (++LS.tick >= TPT) { LS.tick = 0; lsTurnEnd(); LS.turn++; }
  }
  if (NET.host) lsHostSend(dt);
  else { LS.pingT -= dt; if (LS.pingT <= 0) { LS.pingT = 0.5; netSend({ t: 'p' }); } }   // carries how far I got (ack)
}
function lsTurnStart() {
  let cmds;
  if (NET.host) {
    const slow = NET.players.filter(k => !NET.gone.has(k) && LS.turn - (NET.ack[k] || 0) > MAXLAG);
    LS.wait = slow.map(k => TEAMC[palOf(k)].name).join(', '); if (slow.length) return false;
    const fixK = Object.keys(LS.fixT).filter(k => LS.fixT[k] === 1);
    if (fixK.length) { const s = lsSnap(); for (const k of fixK) { LS.fixT[k] = performance.now() + 8000; netSend({ t: 'fx', n: LS.turn, s }, +k); } }
    cmds = NET.pend.splice(0); if (cmds.length) LS.hist.set(LS.turn, cmds);
    if (LS.turn % 100 === 0) for (const n of LS.hist.keys()) if (n < LS.turn - 3000) LS.hist.delete(n);
  } else {
    if (LS.turn > LS.have) return false;   // the host has not sent this turn yet
    if (LS.fix && LS.fix.n === LS.turn) { lsApplyFix(LS.fix.s); LS.fix = null; }
    cmds = LS.q.get(LS.turn) || []; LS.q.delete(LS.turn);
  }
  for (const [pal, c] of cmds) { try { execCmd(c, pal); } catch (e) {} }
  return true;
}
function lsTurnEnd() {
  if (window.__lsDump) window.__lsDump(LS.turn);
  if (LS.turn % 50) return; const h = worldHash();
  if (NET.host) { LS.hash.set(LS.turn, h); LS.hash.delete(LS.turn - 3000); } else netSend({ t: 'h', n: LS.turn, h });
}
function worldHash() {
  let h = SRS | 0;
  for (const e of ents) if (e.alive) h = (Math.imul(h, 31) + e.id * 7 + Math.round(e.x * 64) * 3 + Math.round(e.z * 64) * 5 + Math.round(e.hp * 8)) | 0;
  return (Math.imul(h, 31) + Math.round(TEAMS[0].energy * 8)) | 0;
}
function lsHostSend(dt) {
  for (const k of NET.players) { const p = peer(k); if (!p.dc && p.rtcT > 0) { p.rtcT -= dt; if (p.rtcT <= 0) rtcOffer(k); } }
  const now = performance.now(); if (now < LS.sendT || LS.turn - 1 <= LS.sent) return;
  LS.sendT = now + (NET.players.every(k => dcOpen(k)) ? 90 : 240);
  const a = LS.sent + 1, b = LS.turn - 1; LS.sent = b;
  netSend({ t: 'T', a, b, c: lsCmds(a, b) });
}
function lsCmds(a, b) { const out = []; for (const [n, cmds] of LS.hist) if (n >= a && n <= b) for (const [pal, c] of cmds) out.push([n, pal, c]); return out; }
function lsResend(k, n) { if (n > LS.sent) return; netSend({ t: 'T', a: Math.max(0, n), b: LS.sent, c: lsCmds(n, LS.sent) }, k); }
function lsTurns(m) {
  LS.lastT = performance.now();
  if (m.a > LS.have + 1) { if (LS.lastT > LS.rqT) { LS.rqT = LS.lastT + 1000; netSend({ t: 'rq', n: LS.have + 1 }); } return; }   // a gap: ask again
  if (m.b <= LS.have) return;
  for (const [n, pal, c] of m.c || []) if (n > LS.have) { if (!LS.q.has(n)) LS.q.set(n, []); LS.q.get(n).push([pal, c]); }
  LS.have = m.b;
}
function lsCheck(k, n, h) {
  const mine = LS.hash.get(n); if (mine === undefined || mine === h) return;
  if (!LS.fixT[k] || (LS.fixT[k] > 1 && performance.now() > LS.fixT[k])) { LS.fixT[k] = 1; console.log('desync', k, n); }
}
// the host's full state, sent to a phone that drifted apart
function lsSnap() {
  return { r: SRS, uid, time: S.time, T: TEAMS.map(T => [T.energy, [...T.tech]]),
    u: ents.filter(e => e.alive && e.kind === 'unit').map(e => [e.id, e.team, e.d.ch, e.d.pr, e.d.wp, e.tier === undefined ? -1 : e.tier, e.pal, e.x, e.z, e.heading, e.turYaw, e.hp, e.maxHp, e.state, e.tx, e.tz, e.target ? e.target.id : 0, e.alt || 0, e.ammo === undefined ? -1 : e.ammo, e.cd, e.fire, e.mvo, e.ret, e.pat ? [e.pat.x, e.pat.z] : 0]),
    b: ents.filter(e => e.alive && e.kind === 'bld').map(e => [e.id, e.team, e.type, e.x, e.z, e.rot, e.tier === undefined ? -1 : e.tier, e.pal, e.hp, e.maxHp, e.built, e.complete ? 1 : 0, e.target ? e.target.id : 0]) };
}
function lsApplyFix(s) { console.log("fix applied");
  const adopt = (e, id) => { EID.delete(e.id); e.id = id; EID.set(id, e); };
  const keep = new Set([...s.u.map(a => a[0]), ...s.b.map(a => a[0])]);
  for (const e of ents) if (e.alive && !keep.has(e.id)) { e.alive = false; e.hp = 0; scene.remove(e.mesh); if (e.kind === 'unit') TEAMS[e.team].units--; if (e.selected) { e.selected = false; sel = sel.filter(x => x !== e); } }
  for (let i = ents.length - 1; i >= 0; i--) if (!ents[i].alive) ents.splice(i, 1);
  for (const [id, team, type, x, z, rot, tier, pal, hp, mhp, built, comp] of s.b) { let b = byId(id);
    if (!b) { b = createBuilding(team, type, x, z, !!comp, rot, tier < 0 ? undefined : tier, pal); adopt(b, id); }
    b.maxHp = mhp; b.hp = hp; b.built = built; if (comp && !b.complete) completeBld(b); }
  for (const [id, team, ch, pr, wp, tier, pal, x, z, hd, ty, hp, mhp, st, tx, tz] of s.u) { let u = byId(id);
    if (!u) { u = createUnit(team, { ch, pr, wp }, x, z, tier < 0 ? undefined : tier, pal); adopt(u, id); }
    Object.assign(u, { x, z, heading: hd, turYaw: ty, hp, maxHp: mhp, state: st, tx, tz }); }
  for (const a of s.u) { const u = byId(a[0]); u.target = a[16] ? byId(a[16]) || null : null; u.alt = a[17]; if (a[18] >= 0) u.ammo = a[18]; u.cd = a[19]; u.fire = a[20] | 0; u.mvo = a[21] === undefined ? 1 : a[21]; u.ret = a[22] | 0; u.pat = a[23] ? { x: a[23][0], z: a[23][1] } : null; if (u.state === 'retreat' || u.state === 'recycle') u.state = 'idle'; }
  for (const a of s.b) { const b = byId(a[0]); b.target = a[12] ? byId(a[12]) || null : null; }
  s.T.forEach(([en, tech], t) => { TEAMS[t].energy = en; for (const id of tech) if (!TEAMS[t].tech.has(id)) finishResearch(t, id); });
  SRS = s.r; uid = s.uid; S.time = s.time; panelSig = '';
}
// --- start: the host picks who plays; everybody builds the same starting world
function hostStart() {
  if (NET.started || !NET.ready.size) return; NET.started = true; NET.players = [...NET.ready].sort();
  for (const k of NET.guests) if (!NET.ready.has(k)) netSend({ t: 'late' }, k);
  for (const k of NET.players) { netSend({ t: 'go', pl: NET.players }, k); NET.rx[k] = performance.now(); }
  $('mp').classList.add('hidden'); $('intro').classList.add('hidden'); startGame();
  toast('👥 ' + [0, ...NET.players].map(k => k ? TEAMC[palOf(k)].name : 'Tu (verde-albastru)').join(' · ')); for (const k of NET.players) rtcOffer(k);
}
function lsBegin(pl) {
  if (NET.started || !NET.prepared) return; NET.started = true; NET.players = (pl || []).map(Number);
  $('mp').classList.add('hidden'); netStatus(''); $('hud').classList.remove('hidden');
  setupForces(); S.running = true; LS.lastT = performance.now();
  const GB = GUEST_BASE[NET.me] || PLAYER2; cam.x = GB.x; cam.z = GB.z - 8;
  toast(`👥 Tu: ${TEAMC[palOf(NET.me)].name.replace('Aliat ', '')} · Gazda: verde-albastru`);
}
function netWatch() {   // connection banner for both sides
  if (!NET.on || !NET.started || S.over) return;
  const now = performance.now();
  if (NET.host) {
    for (const k of NET.players) if (dcOpen(k)) { netSend({ t: 'p' }, k); if (now - NET.peers[k].dcRx > 5000) rtcDrop(k); }
    for (const k of NET.players) if (!NET.gone.has(k) && now - (NET.rx[k] || now) > 30000) { NET.gone.add(k); teamToast(`👋 ${TEAMC[palOf(k)].name} a ieșit din joc`); }
    netStatus(LS.wait ? '⏳ Se așteaptă ' + LS.wait + '…' : '');
  } else {
    if (dcOpen('h') && now - NET.peers.h.dcRx > 5000) rtcDrop('h');
    netStatus(now - LS.lastT > 3000 ? '⏳ Se așteaptă gazda… (verifică internetul)' : '');
  }
}
setInterval(netWatch, 1000);
function netStatus(t) { const el = $('netSt'); if (!el) return; el.textContent = t; el.classList.toggle('hidden', !t); }
// --- lobby: who is in the room, who is ready, and a chat everybody in the room can read before the battle
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cleanName = n => String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);
NET.name = (() => { try { return cleanName(localStorage.getItem('ironfall.name')) || 'Comandant'; } catch (e) { return 'Comandant'; } })();
NET.names = {}; NET.chat = []; NET.lob = [];
function lobList() { return NET.host ? [[0, NET.name, 1], ...NET.guests.map(k => [k, NET.names[k] || '…', NET.ready.has(k) ? 1 : 0])] : NET.lob; }
function lobBroadcast() { if (NET.host && !NET.started && NET.guests.length) netSend({ t: 'lob', p: lobList() }); }
function mpLobby() {
  const pl = $('mpPl'); if (pl) { const L = lobList();
    pl.innerHTML = `👥 Jucători: <b>${L.length || 1}/${MAXP}</b>` + L.map(([k, n, r]) => `<div class="mppl"><span style="color:${TEAMC[palOf(k)].mini}">■</span> ${esc(n)}${k === (NET.host ? 0 : NET.me) ? ' <i>(tu)</i>' : ''}${k ? '' : ' <i>gazda</i>'} <small>${k ? (r ? '✔ gata' : '⏳ încarcă…') : ''}</small></div>`).join(''); }
  const ch = $('mpChat'); if (ch) { ch.innerHTML = NET.chat.map(([k, n, x]) => `<div><b style="color:${TEAMC[palOf(k)].mini}">${esc(n)}:</b> ${esc(x)}</div>`).join('') || '<div class="dim">Niciun mesaj încă — salută-ți aliații!</div>'; ch.scrollTop = ch.scrollHeight; }
  if (NET.host) { const n = NET.guests.length, msg = $('mpMsg');
    if (msg) msg.textContent = !n ? 'Se așteaptă jucătorii…' : NET.ready.size ? (NET.ready.size < n ? 'Unii prieteni încă încarcă harta — poți începe, dar cei care nu sunt gata rămân pe dinafară.' : 'Toți sunt gata!') : 'Prietenii încarcă harta…';
    const b = $('mpStart'); if (b) b.disabled = !NET.ready.size; }
}
function mpHostRefresh() { mpLobby(); lobBroadcast(); }
function chatAdd(k, n, x) { NET.chat.push([k, n, x]); if (NET.chat.length > 40) NET.chat.shift(); mpLobby(); if (k !== (NET.host ? 0 : NET.me)) sfx('click'); }
function chatSay() { const el = $('mpSay'); if (!el) return; const x = el.value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120); if (!x) return; el.value = '';
  if (NET.host) { chatAdd(0, NET.name, x); if (NET.guests.length) netSend({ t: 'ch', k: 0, n: NET.name, x }); } else netSend({ t: 'ch', x }); }
const lobbyBox = () => `<div class="mplob"><div class="mpset" id="mpPl"></div><div class="mpchatw"><div class="mpchat" id="mpChat"></div><div class="mpsay"><input id="mpSay" maxlength="120" placeholder="Scrie un mesaj…" autocomplete="off"><button data-mp="say">➤</button></div></div></div>`;
function mpOpen() { $('mp').classList.remove('hidden'); mpView('menu'); }
const mpSet = () => `🗺️ <b>${MC.name}</b> (${MC.size} m) · ${['Ușor', 'Normal', 'Greu'][S.diff]} · tehnologie <b>${TL_NAME[S.tl]}</b>`;
function mpView(v, txt) {
  const box = $('mpBody');
  if (v === 'menu') box.innerHTML = `<p class="mph">Joacă împreună cu până la ${MAXP - 1} prieteni (${MAXP} jucători), de oriunde. Comandați aceeași armată (energie și cercetare comune), fiecare cu baza și culoarea lui, împotriva citadelei. Harta, dificultatea și nivelul de tehnologie le alege cel care creează partida.</p>
    <div class="mpset">${mpSet()}</div>
    <div class="mpb" id="mpTl">${TL_NAME.map((n, i) => `<button data-tl="${i}" class="${i === S.tl ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="mpb"><input id="mpName" maxlength="16" placeholder="Numele tău" value="${esc(NET.name)}" autocomplete="off"></div>
    <div class="mpb"><button class="ok big" data-mp="create">➕ Creează partidă</button></div>
    <div class="mpb"><input id="mpCode" maxlength="5" placeholder="COD" autocomplete="off" autocapitalize="characters"><button class="ok big" data-mp="join">➜ Intră cu cod</button></div>
    <div class="mpb"><button data-mp="close">Înapoi</button></div>`;
  else if (v === 'wait') { box.innerHTML = `<p class="mph">Codul camerei (până la ${MAXP - 1} prieteni): <span class="mpcode sm">${NET.room}</span></p><div class="mpset">${mpSet()}</div>${lobbyBox()}<p class="mph" id="mpMsg">${txt || ''}</p><div class="mpb"><button class="ok big" data-mp="start" id="mpStart" disabled>▶ Începe lupta</button><button data-mp="cancel">Anulează</button></div>`; mpHostRefresh(); }
  else if (v === 'msg') box.innerHTML = `<p class="mph">${txt}</p><div class="mpb"><button data-mp="cancel">Înapoi</button></div>`;
  else if (v === 'guest') { box.innerHTML = `<p class="mph">Camera <b>${NET.room}</b> · ${mpSet()}</p>${lobbyBox()}<div class="mpb" id="mpGo"><button class="ok big" data-mp="go">▶ Sunt gata</button><button data-mp="cancel">Ieși</button></div><p class="mph" id="mpMsg"></p>`; mpLobby(); }
}
function saveName() { const el = $('mpName'); if (!el) return; NET.name = cleanName(el.value) || 'Comandant'; try { localStorage.setItem('ironfall.name', NET.name); } catch (e) {} }
async function mpClick(ev) {
  const tb = ev.target.closest('[data-tl]'); if (tb && !NET.on) { saveName(); S.tl = +tb.dataset.tl; try { localStorage.setItem('ironfall.tl', S.tl); } catch (e) {} tlRefresh(); mpView('menu'); sfx('click'); return; }
  const b = ev.target.closest('[data-mp]'); if (!b) return; const a = b.dataset.mp; sfx('click');
  if (a === 'say') { chatSay(); return; }
  if (a === 'close') { saveName(); $('mp').classList.add('hidden'); return; }
  if (a === 'cancel') { if (NET.room) api('leave').catch(() => {}); location.reload(); return; }
  if (a === 'create') { saveName(); mpView('msg', 'Se creează camera…');
    try { const r = await api('create', { mode: 'coop', map: MAPI }); if (!r.room) throw 0; NET.on = NET.host = true; NET.room = r.room; mpView('wait'); netPollLoop(); }
    catch (e) { mpView('msg', '❌ Nu mă pot conecta la server. Verifică internetul.'); } return; }
  if (a === 'join') { saveName(); const code = ($('mpCode').value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (code.length !== 5) { toast('Codul are 5 caractere'); return; }
    mpView('msg', 'Se intră în camera ' + code + '…');
    try { NET.room = code; NET.me = 1; const r = await api('join'); if (r.slot) NET.me = r.slot | 0; if (r.err) { mpView('msg', '❌ ' + (r.err === 'nu există camera' ? 'Nu există camera ' + code : r.err)); NET.room = ''; return; }
      NET.on = NET.cl = true; netPollLoop(); netSend({ t: 'hi', n: NET.name }); mpView('msg', 'Se primește harta…'); }
    catch (e) { mpView('msg', String(e && e.message).startsWith('srv:') ? '❌ ' + e.message.slice(4) : '❌ Nu mă pot conecta la server. Verifică internetul.'); } return; }
  if (a === 'start') { if (NET.host && NET.ready.size) { audioInit(); hostStart(); } return; }
  if (a === 'go') { audioInit(); const g = $('mpGo'); if (g) g.innerHTML = '<p class="mph">✔ Ești gata. Se așteaptă ca gazda să înceapă lupta…</p>'; $('intro').classList.add('hidden'); clientPrepare(); netSend({ t: 'ready' }); }
}
function clientPrepare() {   // build the map while the host is still in the lobby; the armies come with the host's start signal
  scene.add(sky); buildTerrain(); buildDecor(); buildMiniBg(); NET.prepared = true;
  const GB = GUEST_BASE[NET.me] || PLAYER2; cam.x = GB.x; cam.z = GB.z - 8; $('mp').classList.remove('hidden');
}

// ================= GAME FLOW =================
function setupGame() { scene.add(sky); buildTerrain(); buildDecor(); buildMiniBg(); setupForces(); }
function setupForces() {   // the same on every phone of a multiplayer game: same ids, same random numbers
  uid = 1; SRS = Math.imul(SEED | 0, 2654435761) | 0;
  const B = PLAYER;
  createBuilding(0, 'hq', B.x - 6, B.z + 6, true, Math.PI);
  createBuilding(0, 'factory', B.x + 9, B.z - 2, true, Math.PI);
  createBuilding(0, 'generator', B.x - 14, B.z + 12, true);
  for (let i = 0; i < 3; i++) createUnit(0, { ch: 'light', pr: 'wheels', wp: 'truck' }, B.x - 4 + i * 3, B.z - 10);
  for (let i = 0; i < 4; i++) createUnit(0, { ch: 'light', pr: 'wheels', wp: 'mg' }, B.x + 6 + i * 3, B.z - 13);
  for (const k of NET.players) { const P = GUEST_BASE[k], pal = palOf(k), sd = P.x < 0 ? -1 : 1;
    createBuilding(0, 'hq', P.x + 5 * sd, P.z + 5, true, Math.PI, undefined, pal); createBuilding(0, 'factory', P.x - 6 * sd, P.z - 2, true, Math.PI, undefined, pal);
    for (let i = 0; i < 2; i++) createUnit(0, { ch: 'light', pr: 'wheels', wp: 'truck' }, P.x - 3 + i * 3, P.z - 10, undefined, pal);
    for (let i = 0; i < 3; i++) createUnit(0, { ch: 'light', pr: 'wheels', wp: 'mg' }, P.x - 3 + i * 3, P.z - 13, undefined, pal);
  }
  for (const u of ents) if (u.kind === 'unit') u.heading = Math.PI;
  setupEnemy();
  applyTechLevel(S.tl);
}
let ecoT = 0, aiT = 0, uiT = 0, winT = 0;
function update(dt) {
  S.time += dt;
  for (let i = timers.length - 1; i >= 0; i--) if (S.time >= timers[i].t) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  ecoT += dt; if (ecoT >= 1) { ecoT -= 1; for (const T of TEAMS) { const gens = ents.filter(e => e.alive && e.team === T.i && e.type === 'generator' && e.complete).length; const hq = ents.some(e => e.alive && e.team === T.i && e.type === 'hq'); T.inc = (hq ? 1.5 : 0.5) + 4 * gens * T.powMul; T.energy += T.inc; } }
  aiT += dt; if (aiT >= 1) { aiT = 0; aiTick(); }
  for (const e of ents) if (e.alive) (e.kind === 'unit' ? updUnit : updBld)(e, dt);
  separate();
  for (let i = ents.length - 1; i >= 0; i--) if (!ents[i].alive) ents.splice(i, 1);
  updSpot(dt); updProjs(dt); updWrecks(dt); updWells(dt); updFireZones(dt); updBoomFx(dt);
  for (let i = markers.length - 1; i >= 0; i--) { const m = markers[i]; m.t -= dt; m.m.scale.setScalar(0.4 + m.t); m.m.material.opacity = m.t; if (m.t <= 0) { scene.remove(m.m); markers.splice(i, 1); } }
  engineAudio(dt); heat = Math.max(0, heat - dt * 0.08); AU.heat = lerp(AU.heat, clamp(heat, 0, 1), dt * 0.5);
  winT += dt; if (winT > 1) { winT = 0; checkEnd(); }
}
function checkEnd() {
  if (S.over) return;
  const has = (t, types) => ents.some(e => e.alive && e.team === t && types.includes(e.type));
  if (!has(1, ['citadel'])) endGame(true);
  else if (!has(0, ['hq', 'factory']) && !ents.some(e => e.alive && e.team === 0 && e.isTruck)) endGame(false);
}
function endGame(win) {
  S.over = true; $('end').classList.remove('hidden'); $('endT').textContent = win ? 'VICTORIE' : 'ÎNFRÂNGERE';
  $('endS').innerHTML = `Timp: ${fmtTime(S.time)} · Unități produse: ${S.stats.built} · Inamici distruși: ${S.stats.killed} · Pierderi: ${S.stats.lost}`;
  sfx(win ? 'done' : 'alert');
}

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000) * (window.__speed || 1); last = now;
  if (S.running && !S.paused && !S.over) (NET.started ? lsFrame : update)(dt);
  updFx(S.paused ? 0 : dt);
  updateCamera(dt); updRings();
  if (prevR && !$('designer').classList.contains('hidden') && prevGrp) { prevGrp.rotation.y += dt * 0.8; prevR.render(prevScene, prevCam); }
  renderer.render(scene, camera);
  if (S.running) {
    drawOverlay(); drawMini(dt);
    uiT -= dt; if (uiT <= 0) { uiT = 0.2; const T = TEAMS[0]; $('en').textContent = Math.floor(T.energy); $('inc').textContent = '+' + T.inc.toFixed(1) + '/s'; $('uc').textContent = T.units; $('clk').textContent = fmtTime(S.time); updatePanel(); }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
  }
}
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  ov.width = w; ov.height = h;
}
addEventListener('resize', resize);

// buttons
try { const d0 = localStorage.getItem('ironfall.diff'); if (d0 !== null) { S.diff = +d0; document.querySelectorAll('#diff button').forEach(x => x.classList.toggle('on', +x.dataset.v === S.diff)); } } catch (e) {}
document.querySelectorAll('#diff button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#diff button').forEach(x => x.classList.remove('on')); b.classList.add('on'); S.diff = +b.dataset.v; }));
function startGame() { audioInit(); $('intro').classList.add('hidden'); $('hud').classList.remove('hidden'); setupGame(); S.running = true; toast('Construiește generatoare pe sondele de petrol! ⚡'); }
$('bPlay').addEventListener('click', startGame);
$('bMp').addEventListener('click', () => { audioInit(); mpOpen(); });
$('mp').addEventListener('click', mpClick);
$('mp').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'mpSay') { e.preventDefault(); chatSay(); } });
if (NETCFG) { NET.on = NET.cl = true; NET.me = clamp(NETCFG.me | 0 || 1, 1, MAXP - 1); NET.room = NETCFG.room; NET.after = NETCFG.after | 0; S.diff = NETCFG.diff | 0; S.tl = NETCFG.tl | 0; $('mp').classList.remove('hidden'); mpView('guest'); netPollLoop(); netSend({ t: 'nm', n: NET.name }); }
$('bHelp').addEventListener('click', () => $('help').classList.remove('hidden'));
$('pHelp').addEventListener('click', () => $('help').classList.remove('hidden'));
$('hClose').addEventListener('click', () => $('help').classList.add('hidden'));
$('bPause').addEventListener('click', () => { S.paused = !NET.on; $('pause').classList.remove('hidden'); sfx('click'); });
$('pResume').addEventListener('click', () => { S.paused = false; $('pause').classList.add('hidden'); });
$('pMusic').addEventListener('click', e => { AU.music = !AU.music; e.target.textContent = '🎵 Muzică: ' + (AU.music ? 'DA' : 'NU'); });
$('pSfx').addEventListener('click', e => { AU.sfx = !AU.sfx; e.target.textContent = '🔊 Sunete: ' + (AU.sfx ? 'DA' : 'NU'); });
$('pRestart').addEventListener('click', () => location.reload());
$('bAgain').addEventListener('click', () => location.reload());
// ---- tech level selector ----
function tlRefresh() { document.querySelectorAll('#tlSel button').forEach(x => x.classList.toggle('on', +x.dataset.v === S.tl)); const n = RS.filter(r => RS_DEPTH[r.id] <= TL_DEPTH[S.tl]).length;
  const el = $('tlInfo'); if (el) el.textContent = S.tl ? `${TL_NAME[S.tl]}: ${n} tehnologii deja cercetate · ${TL_ENERGY[S.tl]}⚡ la start (și pentru inamic)` : 'T1: pornești de la zero, cu 500⚡'; }
try { const t0 = localStorage.getItem('ironfall.tl'); if (t0 !== null && !NETCFG) S.tl = clamp(+t0 | 0, 0, 3); } catch (e) {}
document.querySelectorAll('#tlSel button').forEach(b => b.addEventListener('click', () => { S.tl = +b.dataset.v; try { localStorage.setItem('ironfall.tl', S.tl); } catch (e) {} tlRefresh(); sfx('click'); }));
tlRefresh();
// ---- map list + map maker ----
function saveCustomMaps() { try { localStorage.setItem('ironfall.maps', JSON.stringify(CUSTOM_MAPS.map(m => ({ name: m.name, size: m.size, nr: m.nr, dens: m.dens, oil: m.oil, seed: m.seed })))); } catch (e) {} }
function loadMap(i) { const mm = $('mapSel'); try { localStorage.setItem('ironfall.map', i); localStorage.setItem('ironfall.diff', S.diff); } catch (e) {} if (mm) mm.classList.add('loading'); setTimeout(() => location.reload(), 50); }
{ const mm = $('mapSel'); if (mm) {
  mm.innerHTML = MAPS.slice(0, BUILTIN_MAPS + CUSTOM_MAPS.length).map((m, i) => { const n = m.rings.reduce((a, r) => a + r[1], 0) + 1;
    return `<button data-m="${i}" class="mapc ${i === MAPI ? 'on' : ''}">${m.custom ? `<i class="cp" data-cp="${i}" title="Cod pentru prieten">🔗</i><i class="del" data-del="${i}" title="Șterge">✕</i>` : ''}<b>${m.custom ? '★ ' : ''}${m.name}</b><small>${m.size}×${m.size} m · ${n} baze inamice</small><small>${m.rings.length} inele de forturi</small></button>`; }).join('')
    + `<button class="mapc add" data-m="new"><b>＋</b><small>Hartă nouă</small></button>`;
  mm.addEventListener('click', ev => {
    const del = ev.target.closest('[data-del]'); if (del) { ev.stopPropagation(); const i = +del.dataset.del; const m = MAPS[i];
      if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'șterge?'; setTimeout(() => { del.dataset.sure = ''; del.textContent = '✕'; }, 2500); return; }
      CUSTOM_MAPS.splice(CUSTOM_MAPS.indexOf(m), 1); saveCustomMaps(); loadMap(MAPI === i ? 0 : MAPI > i ? MAPI - 1 : MAPI); return; }
    const cp = ev.target.closest('[data-cp]'); if (cp) { ev.stopPropagation(); const code = mapCode(MAPS[+cp.dataset.cp]); mapEdOpen(); $('meCode').value = code; $('meCode').select();
      try { navigator.clipboard.writeText(code).then(() => toast('Codul hărții a fost copiat — trimite-l prietenului')).catch(() => toast('Copiază codul de mai jos și trimite-l prietenului')); } catch (e) {} return; }
    const b = ev.target.closest('[data-m]'); if (!b) return; sfx('click'); if (b.dataset.m === 'new') { mapEdOpen(); return; }
    const i = +b.dataset.m; if (i !== MAPI) loadMap(i); }); } }
const ME = { size: 360, nr: 3, dens: 1, oil: 1, fixed: false };
function meRead() { ME.size = +$('meSize').value; ME.nr = +$('meRing').value; $('meSizeV').textContent = ME.size + ' m'; $('meRingV').textContent = ME.nr; mePreview(); }
function mePreview() { const c = $('mePrev'); if (!c) return; const g = c.getContext('2d'), W = c.width, k = W / Math.max(600, ME.size * 1.05), cx = W / 2;
  g.fillStyle = '#1b1a16'; g.fillRect(0, 0, W, W); const half = ME.size / 2 * k;
  const gr = g.createLinearGradient(0, cx - half, 0, cx + half); gr.addColorStop(0, '#c9d2d6'); gr.addColorStop(0.5, '#8d7a52'); gr.addColorStop(1, '#5f7a3a');
  g.fillStyle = gr; g.fillRect(cx - half, cx - half, half * 2, half * 2); g.strokeStyle = '#f0b44a'; g.lineWidth = 1; g.strokeRect(cx - half, cx - half, half * 2, half * 2);
  const rings = genRings(ME.size, ME.nr, ME.dens); const col = ['#e0c060', '#e08a40', '#e05030'];
  for (const [r, n, tier, gap] of rings) { g.strokeStyle = '#0006'; g.setLineDash([3, 3]); g.beginPath(); g.arc(cx, cx, r * k, 0, TAU); g.stroke(); g.setLineDash([]);
    for (let i = 0; i < n; i++) { const a = gap / 2 + (TAU - gap) * (i + 0.5) / n; g.fillStyle = col[tier]; g.beginPath(); g.arc(cx + Math.sin(a) * r * k, cx + Math.cos(a) * r * k, 3.2, 0, TAU); g.fill(); } }
  g.fillStyle = '#c02020'; g.beginPath(); g.arc(cx, cx, 6, 0, TAU); g.fill();
  const pz = cx + (ME.size / 2 - 26) * k; g.fillStyle = '#4ad04a'; g.fillRect(cx - 5, pz - 5, 10, 10);
  const wells = Math.round(Math.min(190, 19 + 14 * (ME.size / 300) ** 2 * ME.oil)); g.fillStyle = '#111'; for (let i = 0; i < wells; i++) { const x = (Math.sin(i * 91.7) * 0.5) * (ME.size - 40) * k, z = (Math.cos(i * 37.3) * 0.5) * (ME.size - 40) * k; g.fillRect(cx + x - 1.5, cx + z - 1.5, 3, 3); }
  g.fillStyle = '#ddd'; g.font = '10px sans-serif'; g.fillText(`${rings.reduce((a, r) => a + r[1], 0) + 1} baze inamice`, 6, W - 6); }
function meOpt(id, cb) { document.querySelectorAll(`#${id} button`).forEach(b => b.addEventListener('click', () => { document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('on', x === b)); cb(b.dataset.v); mePreview(); sfx('click'); })); }
function mapEdOpen() { $('mapEd').classList.remove('hidden'); $('meCode').value = ''; meRead(); }
meOpt('meDens', v => ME.dens = +v); meOpt('meOil', v => ME.oil = +v);
meOpt('meSeedM', v => { ME.fixed = v === 'f'; $('meSeedL').classList.toggle('hidden', !ME.fixed); if (ME.fixed && !$('meSeed').value) $('meSeed').value = (Math.random() * 999999) | 0; });
$('meSize').addEventListener('input', meRead); $('meRing').addEventListener('input', meRead);
function meAdd(m) { if (!m) { toast('Cod de hartă greșit'); return; } if (CUSTOM_MAPS.length >= 12) CUSTOM_MAPS.shift(); CUSTOM_MAPS.push(m); saveCustomMaps(); loadMap(BUILTIN_MAPS + CUSTOM_MAPS.length - 1); }
$('mapEd').addEventListener('click', ev => { const b = ev.target.closest('[data-me]'); if (!b) return; sfx('click'); const a = b.dataset.me;
  if (a === 'close') $('mapEd').classList.add('hidden');
  else if (a === 'imp') meAdd(mapFromCode($('meCode').value));
  else if (a === 'save') meAdd(cleanMap({ name: $('meName').value, size: ME.size, nr: ME.nr, dens: ME.dens, oil: ME.oil, seed: ME.fixed ? +$('meSeed').value : null })); });
$('bAll').innerHTML = UIC.army + '<span>Armata</span>'; $('bTrucks').innerHTML = UIC.truck + '<span>Constr.</span>';
$('bBox').innerHTML = UIC.box + '<span>Selecție</span>'; $('bBase').innerHTML = UIC.base + '<span>Baza</span>'; $('bPause').innerHTML = UIC.pause;
document.querySelectorAll('#top .ri').forEach(el => el.innerHTML = UIC[el.dataset.i]);
$('bAll').addEventListener('click', () => { setSel(ents.filter(e => e.alive && e.team === 0 && e.kind === 'unit' && !e.isTruck)); sfx('click'); });
$('bTrucks').addEventListener('click', () => { setSel(ents.filter(e => e.alive && e.team === 0 && e.isTruck)); sfx('click'); });
$('bBox').addEventListener('click', () => { boxMode = !boxMode; $('bBox').classList.toggle('on', boxMode); sfx('click'); });
$('bBase').addEventListener('click', () => { const hq = ents.find(e => e.alive && e.team === 0 && e.kind === 'bld') || { x: BASES[0].x, z: BASES[0].z }; cam.x = hq.x; cam.z = hq.z; sfx('click'); });

window.onAppPause = () => { if (S.running && !S.over && !NET.on) { S.paused = true; $('pause').classList.remove('hidden'); } if (AU.ctx) AU.ctx.suspend(); };
window.onAppResume = () => { if (AU.ctx) AU.ctx.resume(); };
window.onBack = () => {
  if (!$('help').classList.contains('hidden')) { $('help').classList.add('hidden'); return true; }
  if (!$('designer').classList.contains('hidden')) { $('designer').classList.add('hidden'); return true; }
  if (placing) { cancelPlacing(); return true; }
  if (!S.running || S.over) return false;
  if (S.paused || !$('pause').classList.contains('hidden')) return false;
  S.paused = !NET.on; $('pause').classList.remove('hidden'); return true;
};
window.__game = { RICON, RS, LS, worldHash, bombFx, fireball3D, kill, wrecks, FBALLS, updFireballs, SPOT, nearestSpotted, WP, impactFx, XST, heightAt,  killNear: () => { for (const e of ents) if (e.alive && e.team === 1 && Math.hypot(e.x - PLAYER2.x, e.z - PLAYER2.z) < 25) kill(e); }, NET, execCmd, doCmd, byId, PLAYER, PLAYER2, S, TEAMS, ents, cam, setSel, sel: () => sel, createUnit, createBuilding, sfx, AU, SB, buildSfx, projs: () => projs, BD, WP };

resize(); updateCamera(0); requestAnimationFrame(loop);
// background scene behind the intro
buildTerrainPreview();
function buildTerrainPreview() { /* terrain is built on start; show sky meanwhile */ }
})();
