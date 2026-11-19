'use strict';
/* Ironfall 2200 — original real-time strategy game. All code, models and music are procedurally generated. */
(function () {
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const pick = a => a[(Math.random() * a.length) | 0];
const TAU = Math.PI * 2;
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

const S = { running: false, paused: false, time: 0, diff: 1, over: false, stats: { built: 0, lost: 0, killed: 0 } };
const CAP = 40;

// ================= NOISE / TERRAIN =================
const SEED = (Math.random() * 100000) | 0;
function hash2(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(SEED, 982451653)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y); const xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, y) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < 4; i++) { s += vnoise(x * f + i * 17.3, y * f - i * 9.1) * a; n += a; a *= 0.5; f *= 2.03; } return s / n; }

// Map: player base in the south (summer). Enemy citadel in the centre, surrounded by
// three rings of outposts whose technology grows weaker towards the edge.
// Biomes by direction: north = winter, east = sand desert, south = summer, west = mountains.
const MAP = 300, HALF = MAP / 2, EDGE = HALF - 9;
const PLAYER = { x: 0, z: 124 };
const CENTER = { x: 0, z: 0 };
const BASES = [PLAYER, CENTER];
const RINGS = [{ r: 112, n: 5, tier: 0 }, { r: 78, n: 4, tier: 1 }, { r: 46, n: 3, tier: 2 }];
const OUTPOSTS = [];
RINGS.forEach((R, ri) => {
  for (let i = 0; i < R.n; i++) {
    // keep the southern approach free near the player: spread over the remaining arc
    const gap = [1.3, 1.7, 1.2][ri]; const span = TAU - gap; const a0 = gap / 2;
    const a = a0 + span * (i + 0.5) / R.n;
    OUTPOSTS.push({ x: Math.sin(a) * R.r, z: Math.cos(a) * R.r, tier: R.tier, a, prodT: 0, nextWave: 0, citadel: false });
  }
});
OUTPOSTS.push({ x: 0, z: 0, tier: 3, a: 0, prodT: 0, nextWave: 0, citadel: true });
const FLAT = [{ x: PLAYER.x, z: PLAYER.z, r: 26 }, { x: 0, z: 0, r: 34 }, ...OUTPOSTS.filter(o => !o.citadel).map(o => ({ x: o.x, z: o.z, r: 16 }))];
const WELL_POS = [[-14, 136], [16, 134], [0, 108], [-40, 118], [42, 116], [-70, 95], [72, 92], [0, 70], [-95, 40], [96, 30], [-20, -96], [30, -120], [-110, -40], [110, -70], [-60, -130], [70, 60], [-60, 60]];
for (const o of OUTPOSTS) if (!o.citadel) { const a = o.a + 0.18; const r = Math.hypot(o.x, o.z) + 9; WELL_POS.push([Math.sin(a) * r, Math.cos(a) * r]); }
WELL_POS.push([14, 8], [-14, -8]);

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
const HN = MAP + 1; const HG = new Float32Array(HN * HN);
for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
  const x = i - HALF, z = j - HALF; let h = heightFull(x, z);
  for (const w of WELLS) { const dx = x - w.x, dz = z - w.z; const d2 = dx * dx + dz * dz; if (d2 < 36) { const t = smooth(clamp((Math.sqrt(d2) - 3) / 3, 0, 1)); h = w.h * (1 - t) + h * t; } }
  HG[j * HN + i] = h;
}
function heightAt(x, z) {
  const fx = clamp(x + HALF, 0, HN - 1.001), fz = clamp(z + HALF, 0, HN - 1.001); const i = fx | 0, j = fz | 0; const u = fx - i, v = fz - j;
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
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 500); const tmpC = new THREE.Color();
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
const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), skyMat); sky.renderOrder = -1; sky.frustumCulled = false;
const matVC = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: panelTex });
const matUnit = new THREE.MeshLambertMaterial({ vertexColors: true, map: panelTex }); // smooth shading = rounder look
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
};
class Builder {
  constructor() { this.parts = []; }
  add(geo, sx, sy, sz, x, y, z, color, rx = 0, ry = 0, rz = 0) { this.parts.push({ geo, sx, sy, sz, x, y, z, color, rx, ry, rz }); return this; }
  box(w, h, d, x, y, z, c, rx, ry, rz) { return this.add(G.box, w, h, d, x, y, z, c, rx, ry, rz); }
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
function buildTerrain() {
  const SEG = 200;
  const g = new THREE.PlaneGeometry(MAP, MAP, SEG, SEG); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  const ng = g.toNonIndexed(); g.dispose();
  const pos = ng.attributes.position; const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color(); const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), n = new THREE.Vector3(), t2 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); cc.fromBufferAttribute(pos, i + 2);
    const cx = (a.x + b.x + cc.x) / 3, cy = (a.y + b.y + cc.y) / 3, cz = (a.z + b.z + cc.z) / 3;
    n.subVectors(b, a).cross(t2.subVectors(cc, a)).normalize();
    const slope = 1 - Math.abs(n.y);
    const bw = biomeW(cx, cz); const nz = fbm(cx * 0.07 + 300, cz * 0.07); const t1 = smooth(clamp((nz - 0.4) / 0.25, 0, 1));
    // per-biome ground colour
    const grass = [lerp(0.33, 0.45, t1), lerp(0.50, 0.40, t1), lerp(0.20, 0.22, t1)];
    const sand = [lerp(0.88, 0.80, t1), lerp(0.73, 0.62, t1), lerp(0.46, 0.38, t1)];
    const snow = [lerp(0.93, 0.80, t1 * 0.5), lerp(0.95, 0.85, t1 * 0.5), lerp(0.99, 0.92, t1 * 0.5)];
    const rock = [lerp(0.50, 0.42, t1), lerp(0.46, 0.39, t1), lerp(0.42, 0.36, t1)];
    let r = grass[0] * bw.green + sand[0] * bw.sand + snow[0] * bw.snow + rock[0] * bw.mtn;
    let gg = grass[1] * bw.green + sand[1] * bw.sand + snow[1] * bw.snow + rock[1] * bw.mtn;
    let bb = grass[2] * bw.green + sand[2] * bw.sand + snow[2] * bw.snow + rock[2] * bw.mtn;
    if (slope > 0.2) { const t = clamp((slope - 0.2) / 0.25, 0, 1) * (1 - bw.sand * 0.7); r = lerp(r, 0.40, t); gg = lerp(gg, 0.37, t); bb = lerp(bb, 0.35, t); }
    if (cy > 16) { const t = clamp((cy - 16) / 5, 0, 1) * clamp(1 - slope * 1.5, 0.3, 1); r = lerp(r, 0.95, t); gg = lerp(gg, 0.96, t); bb = lerp(bb, 0.99, t); }
    const sc2 = fbm(cx * 0.05 - 200, cz * 0.05 + 100); if (sc2 > 0.7) { const t = clamp((sc2 - 0.7) / 0.08, 0, 1) * 0.6; r = lerp(r, 0.24, t); gg = lerp(gg, 0.21, t); bb = lerp(bb, 0.19, t); }
    for (const B of FLAT) { const d = Math.hypot(cx - B.x, cz - B.z); const pr = B.r - 4; if (d < pr) { const t = clamp((pr - d) / 4, 0, 1); const grid = ((Math.floor(cx / 4) + Math.floor(cz / 4)) & 1) ? 0.55 : 0.5; r = lerp(r, grid, t); gg = lerp(gg, grid * 0.98, t); bb = lerp(bb, grid * 0.92, t); } }
    for (const w of WELLS) { const d = Math.hypot(cx - w.x, cz - w.z); if (d < 2.6) { r = 0.08; gg = 0.07; bb = 0.06; } else if (d < 4) { r *= 0.6; gg *= 0.55; bb *= 0.5; } }
    const conc = (heightAt(cx + 4, cz) + heightAt(cx - 4, cz) + heightAt(cx, cz + 4) + heightAt(cx, cz - 4)) / 4 - cy;
    const v = (0.92 + hash2(i, 7) * 0.14) * clamp(1 - conc * 0.05, 0.72, 1.12); c.setRGB(r * v, gg * v, bb * v, THREE.SRGBColorSpace);
    for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = c.r; cols[(i + k) * 3 + 1] = c.g; cols[(i + k) * 3 + 2] = c.b; }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3)); ng.computeVertexNormals();
  { const uv = new Float32Array(pos.count * 2); for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / 5; uv[i * 2 + 1] = pos.getZ(i) / 5; } ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
  terrainMesh = new THREE.Mesh(ng, new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTex }));
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);
}

// ---- decor
const OBST = []; const OB = new Map(); const OBC = 16;
function obKey(i, j) { return i * 1000 + j; }
function indexObst() { OB.clear(); for (const o of OBST) { const i0 = Math.floor((o.x - o.r) / OBC), i1 = Math.floor((o.x + o.r) / OBC), j0 = Math.floor((o.z - o.r) / OBC), j1 = Math.floor((o.z + o.r) / OBC); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = obKey(i, j); if (!OB.has(k)) OB.set(k, []); OB.get(k).push(o); } } }
const _ob = []; function obstNear(x, z) { _ob.length = 0; const ci = Math.floor(x / OBC), cj = Math.floor(z / OBC); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = OB.get(obKey(i, j)); if (a) for (const o of a) if (_ob.indexOf(o) < 0) _ob.push(o); } return _ob; }
function buildDecor() {
  const B = new Builder();
  const ok = (x, z, m) => { if (Math.abs(x) > EDGE - 2 || Math.abs(z) > EDGE - 2) return false; for (const b of FLAT) if (Math.hypot(x - b.x, z - b.z) < b.r + 6 + m) return false; for (const w of WELLS) if (Math.hypot(x - w.x, z - w.z) < 8 + m) return false; return true; };
  // impassable mountain peaks
  for (let z = -EDGE; z <= EDGE; z += 5) for (let x = -EDGE; x <= EDGE; x += 5) { if (heightAt(x, z) > 15 && ok(x, z, -6)) OBST.push({ x, z, r: 3.4, mtn: true }); }
  let tries = 0, clusters = 0;
  while (clusters < 34 && tries < 900) {
    tries++; const cx = rand(-EDGE, EDGE), cz = rand(-EDGE, EDGE); if (!ok(cx, cz, 6)) continue;
    clusters++; const n = 3 + (Math.random() * 5 | 0);
    for (let i = 0; i < n; i++) {
      const x = cx + rand(-8, 8), z = cz + rand(-8, 8); if (!ok(x, z, 2)) continue;
      const w = rand(2.5, 6), d = rand(2.5, 6), h = rand(1.5, 9), ry = rand(0, 3); const y = heightAt(x, z);
      const col = pick([0x7a766e, 0x6b665e, 0x878074, 0x5f5a53]);
      B.box(w, h, d, x, y + h / 2 - 0.6, z, col, rand(-0.05, 0.05), ry, rand(-0.05, 0.05));
      if (h > 3) { B.box(w * 1.02, 0.45, d * 0.25, x, y + h * 0.55, z, 0x24211e, 0, ry, 0); B.box(w * 0.25, 0.45, d * 1.02, x, y + h * 0.55, z, 0x24211e, 0, ry, 0); }
      if (Math.random() < 0.6) B.box(w * rand(0.3, 0.7), rand(0.5, 2), d * rand(0.3, 0.7), x + rand(-0.5, 0.5), y + h - 0.2, z + rand(-0.5, 0.5), col, rand(-0.4, 0.4), ry, rand(-0.4, 0.4));
      OBST.push({ x, z, r: Math.max(w, d) * 0.6 });
      for (let k = 0; k < 4; k++) { const rx = x + rand(-4, 4), rz = z + rand(-4, 4); B.add(G.ico, rand(0.3, 0.9), rand(0.2, 0.5), rand(0.3, 0.9), rx, heightAt(rx, rz) + 0.1, rz, col, rand(0, 3), rand(0, 3), 0); }
    }
  }
  // vegetation by biome
  for (let i = 0; i < 1400; i++) {
    const x = rand(-EDGE, EDGE), z = rand(-EDGE, EDGE); if (!ok(x, z, -10)) continue; const y = heightAt(x, z); if (y > 15) continue;
    const w = biomeW(x, z); const roll = Math.random();
    if (roll < w.snow) { // snowy pine
      if (fbm(x * 0.05, z * 0.05 + 40) < 0.45) continue; const h = rand(3.5, 7); const tl = rand(-0.05, 0.05);
      B.add(G.cone, 0.28, h * 0.5, 0.28, x, y + h * 0.25, z, 0x3b2a1e);
      const greens = [0x1f3b2c, 0x24432f, 0x1a3427];
      for (let k = 0; k < 4; k++) { const s = (1 - k * 0.22) * h * 0.27; const yy = y + h * (0.3 + k * 0.18); B.add(G.cone, s, h * 0.3, s, x, yy, z, greens[k % 3], tl, k * 0.7, tl); B.add(G.cone, s * 0.8, h * 0.1, s * 0.8, x, yy + h * 0.1, z, 0xeef3f8, tl, k * 0.7 + 0.3, tl); }
      B.add(G.cone, h * 0.06, h * 0.12, h * 0.06, x, y + h * 0.98, z, 0xf4f8fc);
    } else if (roll < w.snow + w.green) { // leafy tree / bush
      if (fbm(x * 0.05, z * 0.05 + 40) < 0.42) continue; const h = rand(2.6, 5);
      const pal = pick([[0x3f6b2a, 0x4d7a30, 0x5f8a36], [0x36602a, 0x447030, 0x527d34], [0x557a2c, 0x6a8f34, 0x7a9a3a]]);
      B.add(G.cone, 0.24, h * 0.75, 0.24, x, y + h * 0.37, z, 0x4a3524);
      B.add(G.cyl6, 0.07, h * 0.35, 0.07, x + 0.25, y + h * 0.55, z, 0x4a3524, 0, 0, -0.7);
      B.add(G.cyl6, 0.07, h * 0.3, 0.07, x - 0.2, y + h * 0.5, z + 0.15, 0x4a3524, 0.4, 0, 0.7);
      B.add(G.ico, h * 0.36, h * 0.3, h * 0.36, x, y + h * 0.72, z, pal[0], rand(0, 3), rand(0, 3), 0);
      for (let k = 0; k < 3; k++) { const a = k / 3 * TAU + rand(0, 1); B.add(G.ico, h * 0.24, h * 0.21, h * 0.24, x + Math.sin(a) * h * 0.26, y + h * rand(0.72, 0.9), z + Math.cos(a) * h * 0.26, pal[1 + (k % 2)], rand(0, 3), rand(0, 3), 0); }
      B.add(G.ico, h * 0.2, h * 0.18, h * 0.2, x, y + h * 1.0, z, pal[2], 1, 2, 0);
      if (Math.random() < 0.4) for (let k = 0; k < 3; k++) B.add(G.ico, 0.35, 0.25, 0.35, x + rand(-1.4, 1.4), y + 0.2, z + rand(-1.4, 1.4), pal[0], rand(0, 3), 0, 0);
    } else if (roll < w.snow + w.green + w.sand) { // cactus / dry palm
      if (Math.random() < 0.6) continue;
      if (Math.random() < 0.6) { const h = rand(1.5, 3); B.add(G.cyl6, 0.22, h, 0.22, x, y + h / 2, z, 0x4f7a3a); B.add(G.cyl6, 0.13, h * 0.4, 0.13, x + 0.35, y + h * 0.55, z, 0x4f7a3a); B.add(G.cyl6, 0.13, 0.4, 0.13, x + 0.2, y + h * 0.38, z, 0x4f7a3a, 0, 0, Math.PI / 2); }
      else { const h = rand(4, 6); B.add(G.cyl6, 0.18, h, 0.18, x, y + h / 2, z, 0x6e5838, 0.1, 0, 0.08); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; B.box(0.15, 0.08, 2, x + Math.sin(a) * 0.9, y + h - 0.3, z + Math.cos(a) * 0.9, 0x5f7a32, 0, a, 0); } }
    } else { // dead tree on rock land
      if (Math.random() < 0.7) continue; const h = rand(1.8, 3.4);
      B.add(G.cyl6, 0.14, h, 0.14, x, y + h / 2, z, 0x3b2e22, rand(-0.15, 0.15), 0, rand(-0.15, 0.15));
      B.add(G.cyl6, 0.07, h * 0.5, 0.07, x + 0.3, y + h * 0.75, z, 0x3b2e22, 0, 0, -0.8);
    }
  }
  for (let i = 0; i < 320; i++) {
    const x = rand(-EDGE, EDGE), z = rand(-EDGE, EDGE); if (!ok(x, z, -10)) continue; const s = rand(0.4, 2.2); const w = biomeW(x, z);
    const col = w.snow > 0.5 ? pick([0xc8d0d8, 0x9aa4ad]) : w.sand > 0.5 ? pick([0xb08a5a, 0x9c7a50]) : pick([0x7b6f5f, 0x6a6052, 0x8a7d6a]);
    B.add(G.ico, s * rand(0.8, 1.3), s * rand(0.5, 0.9), s * rand(0.8, 1.3), x, heightAt(x, z) + s * 0.2, z, col, rand(0, 3), rand(0, 3), rand(0, 3));
    if (s > 1.4) OBST.push({ x, z, r: s });
  }
  // wells: small rock ring
  for (const w of WELLS) for (let k = 0; k < 7; k++) { const a = k / 7 * TAU; const x = w.x + Math.cos(a) * 3.3, z = w.z + Math.sin(a) * 3.3; B.add(G.ico, 0.5, 0.35, 0.5, x, heightAt(x, z), z, 0x3b342b, a, a, 0); }
  B.uvScale = 0.35; const m = new THREE.Mesh(B.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: groundTex })); m.castShadow = true; m.receiveShadow = true; scene.add(m);
  indexObst();
  buildGroundCover();
}
function buildGroundCover() {
  const tuft = new THREE.ConeGeometry(0.12, 0.9, 3); tuft.translate(0, 0.45, 0);
  const blob = new THREE.IcosahedronGeometry(0.28, 0);
  const flower = new THREE.SphereGeometry(0.12, 5, 4); flower.translate(0, 0.55, 0);
  const mat = new THREE.MeshLambertMaterial();
  const N = 9000, NB = 2500, NF = 1600;
  const grass = new THREE.InstancedMesh(tuft, mat, N), blobs = new THREE.InstancedMesh(blob, mat, NB), flowers = new THREE.InstancedMesh(flower, new THREE.MeshBasicMaterial(), NF);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  const near = (x, z) => { for (const f of FLAT) if (Math.hypot(x - f.x, z - f.z) < f.r - 3) return true; for (const w of WELLS) if (Math.hypot(x - w.x, z - w.z) < 4.5) return true; return false; };
  let gi = 0, bi = 0, fi = 0;
  for (let tries = 0; tries < 60000 && (gi < N || bi < NB); tries++) {
    const x = rand(-EDGE, EDGE), z = rand(-EDGE, EDGE); if (near(x, z)) continue; const y = heightAt(x, z); if (y > 15) continue;
    const w = biomeW(x, z); const r = Math.random();
    if (r < w.green && gi < N) {
      if (fbm(x * 0.09 + 11, z * 0.09) < 0.4) continue;
      for (let k = 0; k < 3 && gi < N; k++) { const xx = x + rand(-0.5, 0.5), zz = z + rand(-0.5, 0.5); e.set(rand(-0.25, 0.25), rand(0, 6), rand(-0.25, 0.25)); q.setFromEuler(e); const s2 = rand(0.6, 1.4); sc.set(s2, s2 * rand(0.7, 1.3), s2); ps.set(xx, heightAt(xx, zz) - 0.05, zz); m.compose(ps, q, sc); grass.setMatrixAt(gi, m); col.setHSL(rand(0.22, 0.3), rand(0.45, 0.65), rand(0.22, 0.36)); grass.setColorAt(gi++, col); }
      if (fi < NF && Math.random() < 0.18) { ps.set(x, y, z); sc.set(1, 1, 1); q.identity(); m.compose(ps, q, sc); flowers.setMatrixAt(fi, m); flowers.setColorAt(fi++, C(pick([0xffe24a, 0xff5a5a, 0xffffff, 0xb07aff, 0xff9a3a]))); }
    } else if (bi < NB) {
      let c2; if (w.snow > 0.5) c2 = pick([0xf2f6fa, 0xdfe7ef]); else if (w.sand > 0.5) c2 = pick([0x8a7a4a, 0x9a8650, 0x6f6a3a]); else if (w.mtn > 0.5) c2 = pick([0x7a7166, 0x6a635a]); else c2 = pick([0x5a6a32, 0x6e6a3c]);
      if (w.green > 0.5) continue;
      e.set(rand(0, 3), rand(0, 6), rand(0, 3)); q.setFromEuler(e); const s2 = rand(0.5, 1.6); sc.set(s2, s2 * rand(0.4, 0.8), s2); ps.set(x, y + 0.05, z); m.compose(ps, q, sc); blobs.setMatrixAt(bi, m); blobs.setColorAt(bi++, C(c2));
    }
  }
  grass.count = gi; blobs.count = bi; flowers.count = fi;
  for (const im of [grass, blobs, flowers]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.receiveShadow = true; scene.add(im); }
}

// ================= DEFINITIONS =================
const TEAMC = [
  { body: 0x71804e, dark: 0x3d432f, acc: 0x3f9fe0, mini: '#5fc0ff', name: 'Tu' },
  { body: 0x7e5544, dark: 0x3d2a23, acc: 0xe0402a, mini: '#ff5a3a', name: 'Inamic' },
];
const CH = {
  light: { name: 'Ușor', hp: 110, cost: 35, spd: 1, size: 0.9 },
  medium: { name: 'Mediu', hp: 210, cost: 65, spd: 0.88, size: 1.1 },
  heavy: { name: 'Greu', hp: 360, cost: 105, spd: 0.74, size: 1.3 },
};
const PR = {
  wheels: { name: 'Roți', hp: 1, spd: 1, cost: 10 },
  tracks: { name: 'Șenile', hp: 1.35, spd: 0.78, cost: 30 },
  hover: { name: 'Hover', hp: 0.85, spd: 1.5, cost: 25 },
};
const WP = {
  mg: { name: 'Mitralieră', dmg: 7, rof: 0.22, range: 12, cost: 20, kind: 'mg' },
  cannon: { name: 'Tun', dmg: 42, rof: 1.7, range: 14, cost: 45, kind: 'shell' },
  rockets: { name: 'Rachete', dmg: 30, rof: 2.4, range: 18, cost: 60, kind: 'rocket', splash: 2.8 },
  truck: { name: 'Constructor', dmg: 0, range: 0, cost: 40, kind: 'truck' },
};
const BASE_SPEED = 5.4;
const BD = {
  hq: { name: 'Cartier General', icon: '🏛', hp: 1600, cost: 300, size: 6.5, time: 40, h: 5.5 },
  factory: { name: 'Fabrică', icon: '🏭', hp: 1100, cost: 250, size: 7, time: 35, h: 5 },
  lab: { name: 'Laborator', icon: '🔬', hp: 700, cost: 150, size: 5, time: 25, h: 4.5 },
  pump: { name: 'Pompă petrol', icon: '🛢', hp: 450, cost: 50, size: 3.6, time: 12, h: 4 },
  generator: { name: 'Generator', icon: '⚡', hp: 900, cost: 100, size: 5.5, time: 22, h: 6 },
  tower: { name: 'Turn apărare', icon: '🗼', hp: 700, cost: 120, size: 3, time: 18, h: 4 },
  citadel: { name: 'CETATEA', icon: '🏰', hp: 6000, cost: 0, size: 10, time: 1, h: 9 },
  wall: { name: 'Zid', icon: '🧱', hp: 1400, cost: 0, size: 5, time: 1, h: 3, r: 2.7 },
};
// enemy technology tiers: 0 = outer ring (weak) … 3 = citadel (latest technology)
const TIERS = [
  { name: 'Avanpost', ch: ['light'], pr: ['wheels'], wp: ['mg'], tower: 'mg', hp: 1, garrison: 3, towers: 2 },
  { name: 'Fort', ch: ['light', 'medium'], pr: ['wheels', 'tracks'], wp: ['mg', 'cannon'], tower: 'mg', hp: 1.1, garrison: 5, towers: 3 },
  { name: 'Bastion', ch: ['medium', 'heavy'], pr: ['tracks', 'hover'], wp: ['cannon', 'rockets'], tower: 'cannon', hp: 1.25, garrison: 7, towers: 4 },
  { name: 'Cetate', ch: ['heavy'], pr: ['tracks', 'hover'], wp: ['rockets', 'cannon'], tower: 'rockets', hp: 1.5, garrison: 10, towers: 8 },
];
const RS = [
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
];

// research icons: small original SVG drawings
const SV = (inner) => `<svg class="ric" viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const RICON = {
  tracks: SV(`<rect x="5" y="22" width="38" height="16" rx="8" fill="#2a2823" stroke="#c9b48a" stroke-width="2"/><circle cx="13" cy="30" r="4" fill="#6b6658"/><circle cx="24" cy="30" r="4" fill="#6b6658"/><circle cx="35" cy="30" r="4" fill="#6b6658"/><path d="M9 22h30" stroke="#8a826e" stroke-width="2" stroke-dasharray="3 3"/><rect x="12" y="12" width="24" height="9" rx="4" fill="#71804e"/>`),
  cannon: SV(`<path d="M10 34a14 10 0 0 1 28 0z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><rect x="22" y="20" width="22" height="5" rx="2" fill="#3a3a36" stroke="#c9b48a" stroke-width="1.5" transform="rotate(-18 22 22)"/><rect x="8" y="34" width="32" height="6" rx="3" fill="#3d432f"/><circle cx="44" cy="12" r="3" fill="#ffcf5a"/>`),
  medium: SV(`<rect x="6" y="28" width="36" height="10" rx="5" fill="#2a2823"/><path d="M9 28l4-8h22l4 8z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><path d="M18 20a6 5 0 0 1 12 0z" fill="#5c6a3e"/><rect x="28" y="15" width="14" height="3" rx="1.5" fill="#3a3a36"/><text x="24" y="47" font-size="8" text-anchor="middle" fill="#f0b44a" font-family="sans-serif" font-weight="bold">II</text>`),
  hover: SV(`<ellipse cx="24" cy="38" rx="17" ry="4" fill="#3f9fe0" opacity=".55"/><path d="M8 30a16 8 0 0 1 32 0z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><ellipse cx="24" cy="31" rx="17" ry="3.5" fill="#3d432f"/><path d="M12 43q4-3 8 0t8 0 8 0" stroke="#66ccff" stroke-width="2"/><path d="M19 22a5 4 0 0 1 10 0z" fill="#5c6a3e"/>`),
  rockets: SV(`<g transform="rotate(-35 24 24)"><rect x="14" y="8" width="7" height="24" rx="3.5" fill="#e8e8e8" stroke="#c9b48a" stroke-width="1.5"/><path d="M14 12l3.5-6 3.5 6z" fill="#e0402a"/><path d="M15 32l2.5 9 2.5-9z" fill="#ff9a2a"/><rect x="27" y="12" width="7" height="24" rx="3.5" fill="#e8e8e8" stroke="#c9b48a" stroke-width="1.5"/><path d="M27 16l3.5-6 3.5 6z" fill="#e0402a"/><path d="M28 36l2.5 8 2.5-8z" fill="#ff9a2a"/></g>`),
  heavy: SV(`<rect x="3" y="28" width="42" height="12" rx="6" fill="#2a2823"/><path d="M5 28l3-11h32l3 11z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><path d="M14 17a10 7 0 0 1 20 0z" fill="#5c6a3e" stroke="#c9b48a" stroke-width="1.5"/><rect x="30" y="10" width="15" height="4" rx="2" fill="#3a3a36"/><text x="24" y="38" font-size="8" text-anchor="middle" fill="#f0b44a" font-family="sans-serif" font-weight="bold">III</text>`),
  tower2: SV(`<rect x="14" y="20" width="20" height="22" fill="#8c867a" stroke="#c9b48a" stroke-width="2"/><rect x="12" y="17" width="24" height="4" fill="#3f9fe0"/><path d="M16 17a8 6 0 0 1 16 0z" fill="#71804e"/><rect x="28" y="9" width="16" height="4" rx="2" fill="#3a3a36" transform="rotate(-12 28 11)"/><rect x="20" y="28" width="8" height="3" fill="#1c1c1c"/>`),
  armor: SV(`<path d="M24 5l16 6v11c0 11-7 18-16 21C15 40 8 33 8 22V11z" fill="#5c6a3e" stroke="#c9b48a" stroke-width="2"/><path d="M24 11l10 4v7c0 7-4 12-10 14-6-2-10-7-10-14v-7z" fill="#71804e"/><path d="M19 24l4 4 7-8" stroke="#f0b44a" stroke-width="3"/>`),
  engine: SV(`<circle cx="22" cy="26" r="11" fill="#5a564f" stroke="#c9b48a" stroke-width="2"/><circle cx="22" cy="26" r="4" fill="#f0b44a"/><path d="M22 15v-4M22 41v-4M11 26H7M37 26h-4M14 18l-3-3M30 34l3 3M14 34l-3 3M30 18l3-3" stroke="#c9b48a" stroke-width="3"/><path d="M38 12h8M36 18h10M40 24h6" stroke="#66ccff" stroke-width="2.5"/>`),
  prod: SV(`<path d="M5 40V22l9 6v-6l9 6v-6l9 6V12h8v28z" fill="#71804e" stroke="#c9b48a" stroke-width="2"/><rect x="34" y="6" width="4" height="7" fill="#6f6a61"/><circle cx="18" cy="35" r="5" fill="#3d432f" stroke="#f0b44a" stroke-width="2"/><path d="M18 28v2M18 40v2M11 35h2M23 35h2" stroke="#f0b44a" stroke-width="2"/><rect x="28" y="32" width="6" height="8" fill="#24221f"/>`),
};
function mkTeam(i) { return { i, energy: 500, tech: new Set(['light', 'wheels', 'mg', 'truck']), researching: new Set(), hpMul: 1, spdMul: 1, prodMul: 1, units: 0, inc: 0 }; }
const TEAMS = [mkTeam(0), mkTeam(1)];

function unitStats(d, team) {
  const T = TEAMS[team], c = CH[d.ch], p = PR[d.pr], w = WP[d.wp];
  const cost = c.cost + p.cost + w.cost;
  return { hp: Math.round(c.hp * p.hp * T.hpMul * (d.wp === 'truck' ? 0.8 : 1)), speed: BASE_SPEED * c.spd * p.spd * T.spdMul, cost, w, range: w.range || 0, time: 3 + cost / 16 };
}
function designName(d) { return d.wp === 'truck' ? 'Constructor' : `${CH[d.ch].name}·${PR[d.pr].name}·${WP[d.wp].name}`; }

// ================= GEOMETRY CACHES =================
const geoCache = {};
function unitGeo(d, team) {
  const key = d.ch + d.pr + d.wp + team; if (geoCache[key]) return geoCache[key];
  const T = TEAMC[team], s = CH[d.ch].size, B = new Builder(), tb = new Builder(); B.uvScale = tb.uvScale = 1.1;
  const L = 2.3 * s, W = 1.6 * s, H = 0.75 * s; const PI2 = Math.PI / 2;
  let by;
  if (d.pr === 'wheels') {
    const r = 0.42 * s; by = r + H / 2 + 0.05; const xs = W / 2 + 0.05;
    const zs = d.ch === 'light' ? [-L * 0.32, L * 0.32] : [-L * 0.36, 0, L * 0.36];
    for (const z of zs) for (const sx of [-1, 1]) { B.add(G.cyl16, r, 0.3 * s, r, sx * xs, r, z, 0x1d1c1a, 0, 0, PI2); B.add(G.cyl16, r * 0.82, 0.33 * s, r * 0.82, sx * xs, r, z, 0x2a2926, 0, 0, PI2); B.add(G.sph, r * 0.42, 0.2 * s, r * 0.42, sx * (xs + 0.12 * s), r, z, 0x7a7a70, 0, 0, PI2); }
    for (const sx of [-1, 1]) B.add(G.cyl16, 0.32 * s, L * 0.95, 0.18 * s, sx * (W / 2 - 0.05), by - H * 0.15, 0, T.dark, PI2, 0, 0); // rounded fenders
  } else if (d.pr === 'tracks') {
    const th = 0.62 * s, tr = th / 2; by = th * 0.75 + H / 2;
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 + 0.15 * s);
      B.box(0.5 * s, th, L * 0.86, x, tr, 0, 0x262421);
      B.add(G.cyl16, tr, 0.5 * s, tr, x, tr, L * 0.43, 0x262421, 0, 0, PI2); B.add(G.cyl16, tr, 0.5 * s, tr, x, tr, -L * 0.43, 0x262421, 0, 0, PI2);
      for (let k = 0; k < 5; k++) B.add(G.cyl16, tr * 0.62, 0.53 * s, tr * 0.62, x, tr * 0.9, -L * 0.36 + k * L * 0.18, 0x4a473f, 0, 0, PI2);
      B.add(G.cyl16, 0.3 * s, L * 0.98, 0.14 * s, x, th + 0.02, 0, T.dark, PI2, 0, 0); // rounded track guard
    }
  } else {
    by = 0.6 + H / 2; B.add(G.cyl16, W * 0.78, 0.4, L * 0.6, 0, 0.32, 0, T.dark); B.add(G.cyl16, W * 0.82, 0.12, L * 0.63, 0, 0.14, 0, 0x2a2622);
  }
  // rounded hull: core + cylindrical sides + sloped rounded nose/tail + domed deck
  B.box(W * 0.72, H, L * 0.8, 0, by, 0, T.body);
  for (const sx of [-1, 1]) B.add(G.cyl16, H * 0.5, L * 0.8, H * 0.5, sx * W * 0.36, by, 0, T.body, PI2, 0, 0);
  B.add(G.cyl16, H * 0.5, W * 0.72, H * 0.5, 0, by, L * 0.4, T.body, 0, 0, PI2);
  B.add(G.cyl16, H * 0.5, W * 0.72, H * 0.5, 0, by, -L * 0.4, T.body, 0, 0, PI2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(G.sph, H * 0.5, H * 0.5, H * 0.5, sx * W * 0.36, by, sz * L * 0.4, T.body);
  B.add(G.sph, W * 0.52, H * 0.32, L * 0.52, 0, by + H * 0.42, -L * 0.05, T.body);
  B.add(G.cyl16, H * 0.25, W * 0.6, H * 0.18, 0, by + H * 0.35, -L * 0.42, T.dark, 0, 0, PI2); // engine grille
  B.add(G.cyl16, W * 0.5, 0.06 * s, L * 0.3, 0, by + H * 0.66, 0.1 * s, T.acc);        // team stripe (oval)
  if (d.wp !== 'truck') {
    B.add(G.cyl6, 0.025, 1.6 * s, 0.025, -W * 0.32, by + H * 0.5 + 0.8 * s, -L * 0.32, 0x222222, -0.15, 0, 0); // antenna
    B.add(G.sph, 0.05, 0.05, 0.05, -W * 0.32, by + H * 0.5 + 1.6 * s, -L * 0.36, 0xff3020);
    for (const sx of [-1, 1]) B.box(0.22 * s, 0.32 * s, 0.14 * s, sx * W * 0.22, by + H * 0.62, -L * 0.42, 0x4a5a2a); // jerrycans
    B.box(0.5 * s, 0.22 * s, 0.32 * s, W * 0.18, by + H * 0.6, -L * 0.24, 0x6a5a3a); // crate
  }
  for (const sx of [-1, 1]) B.add(G.cyl16, 0.07 * s, 0.35 * s, 0.07 * s, sx * W * 0.3, by + H * 0.2, -L * 0.5 - 0.1 * s, 0x2a2a2a, Math.PI / 2, 0, 0); // exhausts
  for (const sx of [-1, 1]) B.add(G.sph, 0.13 * s, 0.13 * s, 0.08 * s, sx * W * 0.3, by + H * 0.1, L * 0.4 + H * 0.45, 0xfff2c0); // round headlights
  const top = by + H / 2 + 0.05;
  if (d.wp === 'mg') {
    tb.add(G.dome, 0.5 * s, 0.45 * s, 0.55 * s, 0, 0.02, 0, T.body); tb.add(G.cyl16, 0.52 * s, 0.08, 0.57 * s, 0, 0.05, 0, T.acc);
    tb.add(G.sph, 0.18 * s, 0.18 * s, 0.18 * s, 0, 0.3 * s, 0.45 * s, T.dark);
    for (const sx of [-1, 1]) tb.add(G.cyl16, 0.06 * s, 1.1 * s, 0.06 * s, sx * 0.12 * s, 0.28 * s, 0.95 * s, 0x1a1a1a, PI2, 0, 0);
  } else if (d.wp === 'cannon') {
    tb.add(G.dome, 0.72 * s, 0.55 * s, 0.78 * s, 0, 0.02, -0.08 * s, T.body); tb.add(G.cyl16, 0.74 * s, 0.1, 0.8 * s, 0, 0.06, -0.08 * s, T.acc);
    tb.add(G.dome, 0.25 * s, 0.18 * s, 0.25 * s, 0.22 * s, 0.5 * s, -0.25 * s, T.dark); // commander cupola
    tb.add(G.cyl16, 0.24 * s, 0.4 * s, 0.24 * s, 0, 0.28 * s, 0.7 * s, T.dark, PI2, 0, 0); // round mantlet
    tb.add(G.cyl16, 0.12 * s, 1.8 * s, 0.12 * s, 0, 0.28 * s, 1.6 * s, 0x2a2a2a, PI2, 0, 0);
    tb.add(G.cyl16, 0.18 * s, 0.35 * s, 0.18 * s, 0, 0.28 * s, 2.45 * s, 0x2a2a2a, PI2, 0, 0);
  } else if (d.wp === 'rockets') {
    tb.add(G.dome, 0.42 * s, 0.35 * s, 0.42 * s, 0, 0.02, 0, T.dark);
    for (const sx of [-1, 1]) {
      tb.add(G.cyl16, 0.33 * s, 1.1 * s, 0.33 * s, sx * 0.42 * s, 0.5 * s, 0.1 * s, T.body, PI2 - 0.25, 0, 0);
      tb.add(G.cyl16, 0.35 * s, 0.1 * s, 0.35 * s, sx * 0.42 * s, 0.37 * s, 0.6 * s, T.acc, PI2 - 0.25, 0, 0);
      for (const ox of [-0.12, 0.12]) for (const oy of [-0.12, 0.12]) tb.add(G.cyl6, 0.08 * s, 0.1, 0.08 * s, sx * 0.42 * s + ox * s, 0.5 * s + oy * s + 0.15 * s, 0.67 * s, 0x111111, PI2 - 0.25, 0, 0);
    }
  } else {
    tb.add(G.sph, 0.48 * s, 0.38 * s, 0.4 * s, 0, 0.3 * s, 0.55 * s, 0xc9a23a); tb.add(G.cyl16, 0.49 * s, 0.1 * s, 0.41 * s, 0, 0.42 * s, 0.55 * s, T.acc);
    tb.add(G.sph, 0.3 * s, 0.16 * s, 0.12 * s, 0, 0.42 * s, 0.88 * s, 0x223344);
    tb.add(G.cyl16, 0.12 * s, 1.9 * s, 0.12 * s, 0, 0.75 * s, -0.4 * s, 0xd9b23a, PI2 - 0.4, 0, 0);
    tb.add(G.cyl6, 0.05, 0.6 * s, 0.05, 0, 0.9 * s, -1.25 * s, 0x333333);
    tb.add(G.sph, 0.12 * s, 0.12 * s, 0.12 * s, 0.3 * s, 0.7 * s, 0.4 * s, 0xff9a20);
  }
  const res = { body: B.build(), tur: tb.build(), turY: top };
  geoCache[key] = res; return res;
}

const bldCache = {};
function bldGeo(type, team) {
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
    case 'lab':
      B.box(5.6, 2, 5.6, 0, -0.5, 0, conc); B.box(4.2, 2.2, 4.2, 0, 1.6, 0, T.body); B.box(4.25, 0.3, 4.25, 0, 2.4, 0, T.acc);
      B.add(G.dome, 1.7, 1.4, 1.7, 0, 2.7, 0, 0x7fc4d8); B.add(G.cyl6, 0.08, 2.5, 0.08, 1.6, 4, 1.6, 0x333333);
      B.box(1.6, 1.4, 1.2, -2.6, 1.2, 0, T.dark); B.box(1.2, 1.8, 0.15, 0, 1.4, 2.12, 0x24221f);
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; B.box(0.12, 1.4, 0.12, Math.sin(a) * 1.75, 3.0, Math.cos(a) * 1.75, 0xd8d4c8); }
      B.box(4.25, 0.35, 0.6, 0, 1.9, 0, 0x7fc4d8); B.box(0.6, 0.35, 4.25, 0, 1.9, 0, 0x7fc4d8);
      B.cyl(0.5, 1.4, 2.7, 0.9, 1.5, 0x8a8a84); B.cyl(0.5, 1.4, 2.7, 0.9, 0.3, 0x8a8a84); B.add(G.cyl6, 0.08, 1.4, 0.08, 2.7, 1.8, 0.9, 0x4a4a46, Math.PI / 2, 0, 0);
      break;
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
    case 'tower':
      B.box(3.2, 1.6, 3.2, 0, -0.2, 0, conc); B.box(2.3, 2.8, 2.3, 0, 1.6, 0, conc2); B.box(2.4, 0.35, 2.4, 0, 2.6, 0, T.acc); B.box(2.6, 0.4, 2.6, 0, 3.1, 0, T.dark);
      B.box(2.35, 0.3, 0.6, 0, 1.6, 0, 0x1c1c1c); B.box(0.6, 0.3, 2.35, 0, 1.6, 0, 0x1c1c1c);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0.5, 0.5, 0.5, sx * 1.35, 3.35, sz * 1.35, T.dark);
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
const ents = []; let uid = 1;
const glowDisc = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
const glowMat = [new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), new THREE.MeshBasicMaterial({ color: 0xff7040, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })];

function createUnit(team, d, x, z, tier) {
  const T = TEAMS[team]; const st = unitStats(d, team); if (tier !== undefined) st.hp = Math.round(st.hp * TIERS[tier].hp); const g = unitGeo(d, team);
  const grp = new THREE.Group(); grp.rotation.order = 'YXZ';
  const body = new THREE.Mesh(g.body, matUnit); body.castShadow = true; grp.add(body);
  const tur = new THREE.Mesh(g.tur, matUnit); tur.position.y = g.turY; tur.castShadow = true; grp.add(tur);
  if (d.pr === 'hover') { const gl = new THREE.Mesh(glowDisc, glowMat[team]); gl.scale.set(CH[d.ch].size * 1.3, 1, CH[d.ch].size * 1.7); gl.position.y = 0.05; grp.add(gl); }
  scene.add(grp);
  const u = { kind: 'unit', team, d, st, x, z, y: heightAt(x, z), hp: st.hp, maxHp: st.hp, r: 1.0 * CH[d.ch].size, h: g.turY + 0.6, heading: team === 0 ? Math.PI * 0.75 : -Math.PI * 0.25, vx: 0, vz: 0, mesh: grp, tur, turYaw: 0, state: 'idle', tx: x, tz: z, target: null, cd: rand(0, 0.5), acq: rand(0, 0.3), isTruck: d.wp === 'truck', bob: Math.random() * 6, smokeT: 0, alive: true, id: uid++, lastHit: -99, amove: false, lx: x, lz: z, tier, post: null };
  ents.push(u); T.units++; return u;
}

function bldY(x, z, size) { const r = size * 0.4; let s = 0; const pts = [[0, 0], [r, r], [-r, r], [r, -r], [-r, -r]]; for (const p of pts) s += heightAt(x + p[0], z + p[1]); return s / pts.length; }
function makeBldMesh(type, team) {
  const g = bldGeo(type, team); const grp = new THREE.Group(); const main = new THREE.Mesh(g.geo, matVC); main.castShadow = true; main.receiveShadow = true; grp.add(main); const parts = {};
  if (type === 'hq') { const d = new THREE.Mesh(g.anim.dish, matVC); d.position.set(-1.2, 5.4, -1.2); grp.add(d); parts.dish = d; }
  if (type === 'generator') { const f = new THREE.Mesh(g.anim.fan, matVC); f.position.set(-0.9, 3.15, 0.9); grp.add(f); parts.fan = f; const gl = new THREE.Mesh(g.anim.glow, matGlow); grp.add(gl); parts.glow = gl; }
  if (type === 'pump') { const b = new THREE.Mesh(g.anim.beam, matVC); b.position.set(0, 3.55, 0); grp.add(b); parts.beam = b; }
  if (type === 'tower') {
    const t = new THREE.Group(); t.position.y = 3.3; grp.add(t);
    for (const w of ['mg', 'cannon', 'rockets']) { const m = new THREE.Mesh(unitGeo({ ch: 'heavy', pr: 'wheels', wp: w }, team).tur, matUnit); m.castShadow = true; m.visible = false; t.add(m); parts[w] = m; }
    parts.tur = t;
  }
  return { grp, parts };
}
function wellAt(x, z) { for (const w of WELLS) if (Math.hypot(w.x - x, w.z - z) < 1) return w; return null; }

function createBuilding(team, type, x, z, complete, rotOverride, tier) {
  const def = BD[type]; const m = makeBldMesh(type, team);
  const y = (type === 'pump' || type === 'generator') ? heightAt(x, z) : bldY(x, z, def.size); m.grp.position.set(x, y, z);
  const rot = rotOverride !== undefined && rotOverride !== null ? rotOverride : Math.round(Math.atan2(-x, -z) / (Math.PI / 2)) * (Math.PI / 2); m.grp.rotation.y = rot;
  scene.add(m.grp);
  const maxHp = Math.round(def.hp * TEAMS[team].hpMul * (tier !== undefined ? TIERS[tier].hp : 1));
  const b = { kind: 'bld', type, team, x, z, y, rot, def, hp: complete ? maxHp : maxHp * 0.1, maxHp, r: def.r || def.size * 0.55, h: def.h, tier, mesh: m.grp, parts: m.parts, complete: !!complete, built: complete ? 1 : 0, queue: [], prod: 0, rally: null, res: null, resProg: 0, cd: 0, acq: 0, target: null, turYaw: 0, alive: true, id: uid++, smokeT: 0, lastHit: -99, anim: Math.random() * 6 };
  if (!complete) m.grp.scale.y = 0.12;
  if (type === 'pump' || type === 'generator') { const w = wellAt(x, z); b.well = w; if (w) w.pump = b; }
  ents.push(b); return b;
}
function completeBld(b) {
  b.complete = true; b.built = 1; b.mesh.scale.y = 1;
  if (b.team === 0) { toast(`${b.def.icon} ${b.def.name} — gata!`); sfx('done'); }
}

// ================= FX =================
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
function makePool(n, blend) { const arr = []; for (let i = 0; i < n; i++) { const m = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: blend }); const s = new THREE.Sprite(m); s.visible = false; scene.add(s); arr.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, a0: 1, g: 0, smoke: false }); } return arr; }
const addPool = makePool(180, THREE.AdditiveBlending), normPool = makePool(160, THREE.NormalBlending);
let addIdx = 0, normIdx = 0;
const FXT = {
  flash: { life: 0.14, s0: 1.6, s1: 4, a: 1, color: 0xfff0b0, v: 0, vy: 0 },
  fire: { life: 0.6, s0: 1.2, s1: 2.6, a: 0.95, color: 0xff7a22, v: 1.2, vy: 2 },
  spark: { life: 0.45, s0: 0.35, s1: 0.1, a: 1, color: 0xffd060, v: 6, vy: 7, g: 14 },
  smoke: { life: 2.6, s0: 1, s1: 4.2, a: 0.55, color: 0x48433c, v: 0.4, vy: 1.6, wind: 0.6 },
  dust: { life: 1.1, s0: 1, s1: 2.8, a: 0.4, color: 0xb59c78, v: 0.8, vy: 0.6 },
  muzzle: { life: 0.06, s0: 0.7, s1: 1.1, a: 1, color: 0xfff3c0, v: 0, vy: 0 },
  snow: { life: 5, s0: 0.35, s1: 0.3, a: 0.9, color: 0xffffff, v: 0.6, vy: -5, wind: 0.8 },
  steam: { life: 3, s0: 1.2, s1: 4.5, a: 0.5, color: 0xf2f2ee, v: 0.3, vy: 2.2, wind: 0.5 },
  flame: { life: 0.5, s0: 1.4, s1: 0.4, a: 0.9, color: 0xff8a30, v: 0.3, vy: 3 },
};
function fx(type, x, y, z, size = 1) {
  const P = FXT[type]; const normal = type === 'smoke' || type === 'dust' || type === 'snow' || type === 'steam';
  const p = normal ? normPool[normIdx = (normIdx + 1) % normPool.length] : addPool[addIdx = (addIdx + 1) % addPool.length];
  p.life = p.max = P.life * rand(0.8, 1.2); p.s0 = P.s0 * size; p.s1 = P.s1 * size; p.a0 = P.a; p.smoke = normal;
  p.vx = rand(-P.v, P.v) + (P.wind || 0); p.vy = P.vy * rand(0.6, 1.2); p.vz = rand(-P.v, P.v); p.g = P.g || 0;
  p.s.material.color.setHex(P.color); p.s.position.set(x, y, z); p.s.visible = true; p.s.scale.setScalar(p.s0);
}
function updFx(dt) {
  for (const pool of [addPool, normPool]) for (const p of pool) {
    if (!p.s.visible) continue; p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
    const k = 1 - p.life / p.max; p.s.scale.setScalar(lerp(p.s0, p.s1, k));
    p.s.material.opacity = p.smoke ? p.a0 * (1 - k) * Math.min(1, k * 6) : p.a0 * (1 - k);
    if (p.s.position.y < -50) p.life = 0;
    p.vy -= p.g * dt; p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
  }
}
let shake = 0;
function explosion(x, y, z, size) {
  fx('flash', x, y, z, size);
  for (let i = 0; i < 3 + size * 3; i++) fx('fire', x + rand(-0.5, 0.5) * size, y + rand(0, 0.5) * size, z + rand(-0.5, 0.5) * size, size * 0.8);
  for (let i = 0; i < 5 * size; i++) fx('spark', x, y, z, 1);
  for (let i = 0; i < 2 + size * 2; i++) fx('smoke', x + rand(-1, 1) * size, y + rand(0, 1), z + rand(-1, 1) * size, size);
  fx('dust', x, heightAt(x, z) + 0.3, z, size * 1.5);
  sfx(size > 1.5 ? 'bigboom' : 'boom', x, z);
  if (size > 1.5) shake = Math.max(shake, 0.5 * clamp(1 - Math.hypot(x - cam.x, z - cam.z) / 60, 0, 1));
}

// tracers & projectiles
const tracerGeo = new THREE.BoxGeometry(0.07, 0.07, 1); const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
const tracers = []; for (let i = 0; i < 50; i++) { const m = new THREE.Mesh(tracerGeo, tracerMat); m.visible = false; scene.add(m); tracers.push({ m, life: 0 }); }
let trIdx = 0;
function tracer(x1, y1, z1, x2, y2, z2) { const t = tracers[trIdx = (trIdx + 1) % tracers.length]; const d = Math.hypot(x2 - x1, y2 - y1, z2 - z1); t.m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2); t.m.lookAt(x2, y2, z2); t.m.scale.set(1, 1, d); t.m.visible = true; t.life = 0.06; }
const shellGeo = new THREE.SphereGeometry(0.2, 6, 4), rocketGeo = new THREE.ConeGeometry(0.13, 0.7, 5).rotateX(Math.PI / 2);
const shellMat = new THREE.MeshBasicMaterial({ color: 0xffd27a }), rocketMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
const projs = [];
function spawnProj(kind, src, tgt, dmg, splash, ox, oy, oz) {
  const m = new THREE.Mesh(kind === 'shell' ? shellGeo : rocketGeo, kind === 'shell' ? shellMat : rocketMat); scene.add(m);
  const tx = tgt.x, tz = tgt.z, ty = tgt.y + (tgt.kind === 'bld' ? 1.5 : 0.8); const d = Math.hypot(tx - ox, tz - oz); const spd = kind === 'shell' ? 34 : 22;
  projs.push({ kind, m, team: src.team, src, tgt, ox, oy, oz, tx, ty, tz, t: 0, dur: Math.max(0.12, d / spd), arc: kind === 'shell' ? d * 0.05 : d * 0.13, dmg, splash, smokeT: 0 });
}
function updProjs(dt) {
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i]; p.t += dt / p.dur;
    if (p.tgt.alive) { p.tx = p.tgt.x; p.tz = p.tgt.z; p.ty = p.tgt.y + (p.tgt.kind === 'bld' ? 1.5 : 0.8); }
    const k = Math.min(1, p.t); const x = lerp(p.ox, p.tx, k), z = lerp(p.oz, p.tz, k), y = lerp(p.oy, p.ty, k) + Math.sin(k * Math.PI) * p.arc;
    const px = p.m.position.x, py = p.m.position.y, pz = p.m.position.z;
    p.m.position.set(x, y, z); if (p.kind === 'rocket') { p.m.lookAt(x + (x - px), y + (y - py), z + (z - pz)); p.smokeT -= dt; if (p.smokeT <= 0) { p.smokeT = 0.03; fx('smoke', x, y, z, 0.35); fx('fire', x, y, z, 0.3); } }
    if (k >= 1) {
      scene.remove(p.m); projs.splice(i, 1);
      fx('flash', x, y, z, p.kind === 'rocket' ? 1 : 0.7); fx('fire', x, y, z, 0.7); fx('smoke', x, y, z, 0.6); for (let s = 0; s < 4; s++) fx('spark', x, y, z, 1);
      sfx('hit', x, z);
      if (p.tgt.alive) damage(p.tgt, p.dmg, p.src);
      if (p.splash) for (const e of ents) if (e.alive && e.team !== p.team && e !== p.tgt && Math.hypot(e.x - x, e.z - z) < p.splash + e.r * 0.5) damage(e, p.dmg * 0.5, p.src);
    }
  }
  for (const t of tracers) if (t.m.visible) { t.life -= dt; if (t.life <= 0) t.m.visible = false; }
}

// wrecks
const wrecks = [];
const matWreck = new THREE.MeshLambertMaterial({ color: 0x2a2622, flatShading: true });
function addWreck(e) {
  let m;
  if (e.kind === 'unit') { m = new THREE.Mesh(unitGeo(e.d, e.team).body, matWreck); m.position.set(e.x, e.y - 0.15, e.z); m.rotation.set(rand(-0.2, 0.2), e.heading, rand(-0.2, 0.2)); }
  else { const B = new Builder(); for (let i = 0; i < 9; i++) B.add(G.ico, rand(0.6, 1.6), rand(0.3, 0.9), rand(0.6, 1.6), rand(-e.r, e.r) * 0.7, 0, rand(-e.r, e.r) * 0.7, pick([0x3a3530, 0x2a2622, 0x4a443c]), rand(0, 3), rand(0, 3), 0); m = new THREE.Mesh(B.build(), matVC); m.position.set(e.x, e.y, e.z); }
  scene.add(m); wrecks.push({ m, life: e.kind === 'unit' ? 25 : 60, smokeT: 0, x: e.x, y: e.y, z: e.z, big: e.kind !== 'unit' });
}
function updWrecks(dt) {
  for (let i = wrecks.length - 1; i >= 0; i--) {
    const w = wrecks[i]; w.life -= dt; w.smokeT -= dt;
    if (w.smokeT <= 0 && w.life > 8) { w.smokeT = w.big ? 0.25 : 0.6; fx('smoke', w.x + rand(-1, 1), w.y + 1, w.z + rand(-1, 1), w.big ? 1.2 : 0.6); }
    if (w.life < 3) w.m.position.y -= dt * 0.4;
    if (w.life <= 0) { scene.remove(w.m); wrecks.splice(i, 1); }
  }
}

// ================= COMBAT =================
let heat = 0, lastAlert = -99;
const pings = [];
function damage(e, amt, src) {
  if (!e.alive || S.over) return;
  e.hp -= amt; e.lastHit = S.time;
  heat = Math.min(1.5, heat + amt * (e.team === 0 ? 0.01 : 0.005));
  if (e.team === 0 && S.time - lastAlert > 25) { lastAlert = S.time; toast('⚠ Ești atacat!'); sfx('alert'); pings.push({ x: e.x, z: e.z, t: 2 }); }
  if (e.kind === 'unit' && src && src.alive && e.st.range > 0 && e.state === 'idle') { e.target = src; e.state = 'engage'; e.lx = e.x; e.lz = e.z; }
  if (e.hp <= 0) kill(e);
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

function nearestEnemy(team, x, z, range) {
  let best = null, bd = 1e9;
  for (const e of ents) { if (!e.alive || e.team === team) continue; const d = Math.hypot(e.x - x, e.z - z) - e.r; if (d > range) continue; const s = d + (e.kind === 'bld' ? 5 : 0); if (s < bd) { bd = s; best = e; } }
  return best;
}
function inRange(u, t, extra) { return Math.hypot(t.x - u.x, t.z - u.z) - t.r <= u.st.range + (extra || 0); }

function fireWeapon(src, t, w, mx, my, mz, mul) {
  const dmg = w.dmg * (mul || 1);
  fx('muzzle', mx, my, mz, w.kind === 'mg' ? 0.8 : 1.4);
  if (w.kind === 'mg') { const ty = t.y + (t.kind === 'bld' ? 1.5 : 0.7); tracer(mx, my, mz, t.x + rand(-0.4, 0.4), ty, t.z + rand(-0.4, 0.4)); if (Math.random() < 0.3) fx('spark', t.x, ty, t.z, 1); damage(t, dmg, src); sfx('mg', mx, mz); }
  else if (w.kind === 'shell') { spawnProj('shell', src, t, dmg, 0, mx, my, mz); fx('smoke', mx, my, mz, 0.6); sfx('shell', mx, mz); }
  else if (w.kind === 'rocket') { for (let i = 0; i < 2; i++) later(i * 0.15, () => { if (src.alive && t.alive) spawnProj('rocket', src, t, dmg, w.splash, mx, my, mz); }); sfx('rocket', mx, mz); }
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
    for (const o of obstNear(u.x, u.z)) check(o.x, o.z, o.r);
    for (const e of ents) if (e.kind === 'bld' && e.alive && e !== u.buildTarget && e !== u.target && Math.abs(e.x - u.x) < 16 && Math.abs(e.z - u.z) < 16) check(e.x, e.z, e.r);
    sx += ax; sz += az; const l = Math.hypot(sx, sz) || 1; dvx = sx / l * spd; dvz = sz / l * spd;
  }
  const k = Math.min(1, dt * 5); u.vx = lerp(u.vx, dvx, k); u.vz = lerp(u.vz, dvz, k);
}
function collide(u) {
  for (const o of obstNear(u.x, u.z)) { const dx = u.x - o.x, dz = u.z - o.z; const m = o.r + u.r; const d2 = dx * dx + dz * dz; if (d2 < m * m && d2 > 1e-6) { const d = Math.sqrt(d2); u.x = o.x + dx / d * m; u.z = o.z + dz / d * m; } }
  for (const e of ents) { if (e.kind !== 'bld' || !e.alive) continue; const dx = u.x - e.x, dz = u.z - e.z; const m = e.r + u.r; const d2 = dx * dx + dz * dz; if (d2 < m * m && d2 > 1e-6) { const d = Math.sqrt(d2); u.x = e.x + dx / d * m; u.z = e.z + dz / d * m; } }
  u.x = clamp(u.x, -EDGE, EDGE); u.z = clamp(u.z, -EDGE, EDGE);
}
function separate() {
  const us = ents.filter(e => e.alive && e.kind === 'unit');
  for (let i = 0; i < us.length; i++) { const a = us[i]; for (let j = i + 1; j < us.length; j++) { const b = us[j]; const dx = b.x - a.x, dz = b.z - a.z; const m = a.r + b.r + 0.15; const d2 = dx * dx + dz * dz; if (d2 < m * m && d2 > 1e-6) { const d = Math.sqrt(d2); const o = (m - d) * 0.3; const nx = dx / d, nz = dz / d; a.x -= nx * o; a.z -= nz * o; b.x += nx * o; b.z += nz * o; } } }
}

// ================= UNIT / BUILDING UPDATE =================
function updUnit(u, dt) {
  const w = u.st.w;
  if (u.target && !u.target.alive) { u.target = null; if (u.state === 'engage' || u.state === 'attack') u.state = u.amove ? 'amove' : 'idle'; }
  u.acq -= dt;
  if (w.dmg > 0 && u.acq <= 0 && u.state !== 'attack') {
    u.acq = 0.35 + Math.random() * 0.15;
    const passive = u.state === 'move'; const vis = u.st.range + (passive ? 0 : 9);
    if (!u.target || !inRange(u, u.target)) {
      const t = nearestEnemy(u.team, u.x, u.z, vis);
      if (t) { u.target = t; if (u.state === 'idle' || u.state === 'amove') { if (u.state === 'idle') { u.lx = u.x; u.lz = u.z; } u.state = 'engage'; } }
      else if (passive && u.target && !inRange(u, u.target, 4)) u.target = null;
    }
  }
  if (u.defending && u.post && Math.hypot(u.x - u.post.x, u.z - u.post.z) > (u.post.citadel ? 60 : 42)) { u.defending = false; u.target = null; u.amove = false; u.state = 'move'; u.tx = u.post.x + rand(-8, 8); u.tz = u.post.z + rand(-8, 8); }
  let mx = null, mz = null, arrive = 0.6;
  switch (u.state) {
    case 'move': case 'amove': mx = u.tx; mz = u.tz; arrive = 0.8; if (Math.hypot(u.tx - u.x, u.tz - u.z) < 1.3) { u.state = 'idle'; u.amove = false; } break;
    case 'engage': case 'attack': {
      const t = u.target; if (!t || !t.alive) { u.state = u.amove ? 'amove' : 'idle'; u.target = null; break; }
      const d = Math.hypot(t.x - u.x, t.z - u.z) - t.r;
      if (u.state === 'engage' && (d > u.st.range + 14 || (!u.amove && Math.hypot(u.x - u.lx, u.z - u.lz) > 24))) { u.target = null; if (u.amove) u.state = 'amove'; else { u.state = 'move'; u.tx = u.lx; u.tz = u.lz; } break; }
      if (d > u.st.range * 0.9) { mx = t.x; mz = t.z; arrive = 0; }
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
  if (t && t.alive && w.dmg > 0) {
    const a = Math.atan2(t.x - u.x, t.z - u.z); const local = angDiff(u.heading, a);
    u.turYaw += clamp(angDiff(u.turYaw, local), -5 * dt, 5 * dt);
    u.cd -= dt;
    if (inRange(u, t, 0.5) && Math.abs(angDiff(u.turYaw, local)) < 0.25 && u.cd <= 0) {
      const wy = u.heading + u.turYaw; const s = CH[u.d.ch].size;
      fireWeapon(u, t, w, u.x + Math.sin(wy) * 1.6 * s, u.y + u.h - 0.3, u.z + Math.cos(wy) * 1.6 * s);
      u.cd = w.rof * rand(0.9, 1.1);
    }
  } else if (!u.isTruck || u.state !== 'build') { u.cd = Math.max(0, u.cd - dt); u.turYaw += clamp(angDiff(u.turYaw, 0), -2 * dt, 2 * dt); }
  u.tur.rotation.y = u.turYaw;

  // visuals
  u.y = heightAt(u.x, u.z); let yy = u.y;
  if (u.d.pr === 'hover') { u.bob += dt * 3; yy += 0.2 + Math.sin(u.bob) * 0.08; }
  const sp = Math.hypot(u.vx, u.vz);
  if (sp > 0.4) { const th = Math.atan2(u.vx, u.vz); u.heading += clamp(angDiff(u.heading, th), -5 * dt, 5 * dt); }
  const sh = Math.sin(u.heading), ch = Math.cos(u.heading);
  const hf = heightAt(u.x + sh, u.z + ch), hb = heightAt(u.x - sh, u.z - ch), hr = heightAt(u.x + ch, u.z - sh), hl = heightAt(u.x - ch, u.z + sh);
  const pitch = u.d.pr === 'hover' ? 0 : -Math.atan2(hf - hb, 2), roll = u.d.pr === 'hover' ? 0 : Math.atan2(hr - hl, 2);
  u.mesh.position.set(u.x, yy, u.z); u.mesh.rotation.set(pitch, u.heading, roll);
  if (sp > 1 && Math.abs(u.x - cam.x) < 60 && Math.abs(u.z - cam.z) < 60 && Math.random() < dt * 4) fx('smoke', u.x - sh * 1.4 * CH[u.d.ch].size, yy + 0.6, u.z - ch * 1.4 * CH[u.d.ch].size, 0.22);
  if (sp > 2 && Math.random() < dt * (u.d.pr === 'hover' ? 8 : 4)) fx('dust', u.x - sh * 1.2, u.y + 0.3, u.z - ch * 1.2, u.d.pr === 'hover' ? 0.9 : 0.6);
  if (u.hp < u.maxHp * 0.5) { u.smokeT -= dt; if (u.smokeT <= 0) { u.smokeT = 0.25; fx('smoke', u.x, yy + 1.2, u.z, 0.5); if (u.hp < u.maxHp * 0.25) fx('fire', u.x, yy + 1, u.z, 0.45); } }
}

function truckAuto(u) {
  let best = null, bd = 30;
  for (const e of ents) if (e.alive && e.kind === 'bld' && e.team === u.team && !e.complete) { const d = Math.hypot(e.x - u.x, e.z - u.z); if (d < bd) { bd = d; best = e; } }
  if (best) { u.state = 'build'; u.buildTarget = best; }
}

function localToWorld(b, lx, lz) { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; }
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
  if (b.type === 'factory') {
    if (b.queue.length) {
      if (Math.random() < dt * 4) { const [wx, wz] = localToWorld(b, -2.6, -1.9); fx('smoke', wx, b.y + 7, wz, 0.9); }
      const d = b.queue[0]; const st = unitStats(d, b.team); b.prod += dt * T.prodMul;
      if (b.prod >= st.time) { if (T.units < CAP) { b.queue.shift(); b.prod = 0; spawnFromFactory(b, d); } else b.prod = st.time; }
    }
  }
  if (b.type === 'lab' && b.res) { b.resProg += dt; if (Math.random() < dt * 2) fx('muzzle', b.x, b.y + 4.3, b.z, 1.5); if (b.resProg >= b.res.time) { const id = b.res.id; b.res = null; b.resProg = 0; finishResearch(b.team, id); if (b.team === 0) { toast(`🔬 Cercetare gata: ${RS.find(r => r.id === id).name}`); sfx('done'); } } }
  if (b.type === 'tower') {
    const wk = b.tier !== undefined ? TIERS[b.tier].tower : (T.tech.has('tower2') ? 'cannon' : 'mg');
    for (const k of ['mg', 'cannon', 'rockets']) b.parts[k].visible = k === wk; const w = WP[wk]; const range = wk === 'rockets' ? 19 : wk === 'cannon' ? 16 : 14;
    b.acq -= dt; if (b.acq <= 0) { b.acq = 0.4; if (!b.target || !b.target.alive || Math.hypot(b.target.x - b.x, b.target.z - b.z) - b.target.r > range) b.target = nearestEnemy(b.team, b.x, b.z, range); }
    b.cd -= dt;
    if (b.target && b.target.alive) {
      const a = Math.atan2(b.target.x - b.x, b.target.z - b.z); const local = angDiff(b.rot, a); b.turYaw += clamp(angDiff(b.turYaw, local), -4 * dt, 4 * dt);
      if (b.cd <= 0 && Math.abs(angDiff(b.turYaw, local)) < 0.2) { const wy = b.rot + b.turYaw; fireWeapon(b, b.target, w, b.x + Math.sin(wy) * 2, b.y + 3.6, b.z + Math.cos(wy) * 2, 1.3); b.cd = w.rof; }
    }
    b.parts.tur.rotation.y = b.turYaw;
  }
  if (b.hp < b.maxHp * 0.5) { b.smokeT -= dt; if (b.smokeT <= 0) { b.smokeT = 0.2; fx('smoke', b.x + rand(-1, 1), b.y + b.h, b.z + rand(-1, 1), 1); if (b.hp < b.maxHp * 0.3) fx('fire', b.x + rand(-1, 1), b.y + b.h * 0.8, b.z + rand(-1, 1), 0.9); } }
}
function spawnFromFactory(b, d) {
  const fxv = Math.sin(b.rot), fz = Math.cos(b.rot);
  const u = createUnit(b.team, d, b.x + fxv * (b.r + 1.6), b.z + fz * (b.r + 1.6)); u.heading = b.rot;
  if (b.team === 0) S.stats.built++;
  if (u.isTruck && b.team === 0) { truckAuto(u); if (u.state === 'build') return; }
  const rx = b.rally ? b.rally.x : b.x + fxv * (b.r + 7) + rand(-3, 3), rz = b.rally ? b.rally.z : b.z + fz * (b.r + 7) + rand(-3, 3);
  orderMove([u], rx + rand(-1.5, 1.5), rz + rand(-1.5, 1.5), false, true);
}
function finishResearch(team, id) {
  const T = TEAMS[team]; if (T.tech.has(id)) return; T.tech.add(id); T.researching.delete(id);
  if (id === 'armor') { T.hpMul = 1.25; for (const e of ents) if (e.alive && e.team === team) { const r = e.hp / e.maxHp; e.maxHp = Math.round(e.maxHp * 1.25); e.hp = e.maxHp * r; } }
  if (id === 'engine') { T.spdMul = 1.2; for (const e of ents) if (e.alive && e.team === team && e.kind === 'unit') e.st.speed *= 1.2; }
  if (id === 'prod') T.prodMul = 1.4;
  panelSig = '';
}

// ================= ORDERS =================
const markerGeo = new THREE.RingGeometry(0.8, 1.1, 24).rotateX(-Math.PI / 2);
const markers = [];
function marker(x, z, color) { const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false })); m.position.set(x, heightAt(x, z) + 0.15, z); scene.add(m); markers.push({ m, t: 0.8 }); }
function orderMove(units, x, z, amove, silent) {
  const n = units.length; const cols = Math.ceil(Math.sqrt(n)); const rows = Math.ceil(n / cols); const sp = 2.8;
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw), fwx = -Math.sin(cam.yaw), fwz = -Math.cos(cam.yaw);
  units.forEach((u, i) => {
    const c = i % cols, r = Math.floor(i / cols); const ox = (c - (cols - 1) / 2) * sp, oz = (r - (rows - 1) / 2) * sp;
    u.tx = clamp(x + rx * ox + fwx * oz, -EDGE, EDGE); u.tz = clamp(z + rz * ox + fwz * oz, -EDGE, EDGE);
    u.state = amove ? 'amove' : 'move'; u.amove = !!amove; if (!amove) u.target = null; u.buildTarget = null;
  });
  if (!silent) { marker(x, z, amove ? 0xff6040 : 0x80ff80); sfx('ack'); }
}
function orderAttack(units, t) { let any = false; for (const u of units) if (u.st.w.dmg > 0) { u.state = 'attack'; u.target = t; u.amove = false; any = true; } if (any) { marker(t.x, t.z, 0xff3020); sfx('ack'); } }
function orderBuild(trucks, b) { for (const u of trucks) { u.state = 'build'; u.buildTarget = b; u.target = null; } if (trucks.length) sfx('ack'); }

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
function tierDesign(t) { const T = TIERS[t]; return { ch: pick(T.ch), pr: pick(T.pr), wp: pick(T.wp) }; }
const AI = { tick: 0 };
const CAP_E = 95;
function aiTick() {
  const t = S.time; const dm = [1.4, 1, 0.75][S.diff];
  const enemyUnits = ents.filter(e => e.alive && e.team === 1 && e.kind === 'unit');
  const playerUnits = ents.filter(e => e.alive && e.team === 0);
  for (const o of OUTPOSTS) {
    if (!o.alive) continue;
    const f = o.factories.find(x => x.alive);
    if (!f && !o.citadel && !o.towers.some(x => x.alive)) { o.alive = false; if (!S.over) { toast(`🏴 ${TIERS[o.tier].name} cucerit!`); sfx('done'); } continue; }
    const garrison = enemyUnits.filter(u => u.post === o);
    const home = garrison.filter(u => u.state === 'idle' && Math.hypot(u.x - o.x, u.z - o.z) < 30);
    // production
    o.prodT -= 1;
    if (f && o.prodT <= 0 && enemyUnits.length < CAP_E) {
      o.prodT = (28 + o.tier * 7) * dm;
      const fxv = Math.sin(f.rot), fz = Math.cos(f.rot);
      const u = createUnit(1, tierDesign(o.tier), f.x + fxv * (f.r + 1.6), f.z + fz * (f.r + 1.6), o.tier); u.post = o; u.heading = f.rot;
      u.state = 'move'; u.tx = o.x + rand(-9, 9); u.tz = o.z + rand(-9, 9);
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
        for (const u of extra) { u.state = 'amove'; u.amove = true; u.tx = tg.x + rand(-6, 6); u.tz = tg.z + rand(-6, 6); u.post = null; u.defending = false; }
        toast(`⚠ Val de atac din ${TIERS[o.tier].name}!`); pings.push({ x: o.x, z: o.z, t: 2 });
      }
      o.nextWave = t + rand(90, 140) * dm;
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
    o.nextWave = (o.citadel ? 900 : [240, 360, 520][o.tier]) * dm + rand(0, 60);
    o.prodT = rand(5, 25);
    if (o.citadel) {
      createBuilding(1, 'citadel', 0, 0, true, 0, 3);
      for (const [fx2, fz2, r] of [[0, 14, 0], [0, -14, Math.PI]]) o.factories.push(createBuilding(1, 'factory', fx2, fz2, true, r, 3));
      createBuilding(1, 'lab', 13, 0, true, -Math.PI / 2, 3); createBuilding(1, 'hq', -13, 0, true, Math.PI / 2, 3);
      // ring wall with four gates
      const WR = 25; const n = 30;
      for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * TAU; const gate = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].some(g => Math.abs(angDiff(a, g)) < 0.16); if (gate) continue; createBuilding(1, 'wall', Math.sin(a) * WR, Math.cos(a) * WR, true, a, 3); }
      for (let i = 0; i < T.towers; i++) { const a = i / T.towers * TAU + 0.2; o.towers.push(createBuilding(1, 'tower', Math.sin(a) * 20, Math.cos(a) * 20, true, a, 3)); }
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; o.towers.push(createBuilding(1, 'tower', Math.sin(a) * 31, Math.cos(a) * 31, true, a, 3)); }
      for (const w of WELLS) if (Math.hypot(w.x, w.z) < 20) createBuilding(1, 'generator', w.x, w.z, true, null, 3);
    } else {
      o.factories.push(createBuilding(1, 'factory', o.x, o.z, true, Math.round(ang / (Math.PI / 2)) * (Math.PI / 2), o.tier));
      for (let i = 0; i < T.towers; i++) { const a = ang + (i - (T.towers - 1) / 2) * 0.9; o.towers.push(createBuilding(1, 'tower', o.x + Math.sin(a) * 11, o.z + Math.cos(a) * 11, true, a, o.tier)); }
      const w = WELLS.find(w => Math.hypot(w.x - o.x, w.z - o.z) < 14); if (w) createBuilding(1, 'generator', w.x, w.z, true, null, o.tier);
    }
    fortDecor(o);
    for (let i = 0; i < T.garrison; i++) { const a = rand(0, TAU), r = rand(5, o.citadel ? 18 : 10); const u = createUnit(1, tierDesign(o.tier), o.x + Math.sin(a) * r, o.z + Math.cos(a) * r, o.tier); u.post = o; }
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

let sel = [], panelSig = '', placing = null, boxMode = false, amoveNext = false;
function setSel(arr) { for (const e of sel) e.selected = false; sel = arr.filter(e => e && e.alive); for (const e of sel) e.selected = true; amoveNext = false; panelSig = ''; }

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
  if (trucks.length) { const w = WELLS.find(w => !w.pump && Math.hypot(w.x - g.x, w.z - g.z) < 4); if (w && TEAMS[0].energy >= BD.generator.cost) { TEAMS[0].energy -= BD.generator.cost; const b = createBuilding(0, 'generator', w.x, w.z, false); orderBuild(trucks, b); marker(w.x, w.z, 0xffd040); return; } }
  if (units.length) { orderMove(units, g.x, g.z, amoveNext); amoveNext = false; panelSig = ''; return; }
  const f = sel.length === 1 && sel[0].kind === 'bld' && sel[0].team === 0 && sel[0].type === 'factory' ? sel[0] : null;
  if (f) { f.rally = { x: g.x, z: g.z }; marker(g.x, g.z, 0x60c0ff); toast('📍 Punct de adunare setat'); return; }
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
  TEAMS[0].energy -= def.cost; const b = createBuilding(0, p.type, p.x, p.z, false); orderBuild(p.trucks.filter(t => t.alive), b);
  cancelPlacing();
}
function cancelPlacing() { if (!placing) return; scene.remove(placing.ghost); placing = null; panelSig = ''; }

// ================= UI =================
const panel = $('panel');
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); toastT = 2.6; }
function fmtTime(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function computeSig() {
  const T = TEAMS[0]; let s = (placing ? 'P' + placing.type + placing.valid : '') + '|' + sel.map(e => e.id).join(',') + '|' + T.tech.size + '|' + amoveNext;
  for (const e of sel) if (e.kind === 'bld') s += `|${e.complete}|${e.queue.length}|${e.res ? e.res.id : ''}|${[...T.researching].join()}`;
  const costs = [35, 50, 65, 75, 100, 120, 150, 200, 250, 300]; s += '|' + costs.map(c => T.energy >= c ? 1 : 0).join('');
  return s;
}
function bdBtn(type) { const d = BD[type]; return `<button data-act="build" data-v="${type}" ${TEAMS[0].energy < d.cost ? 'disabled' : ''}><span class="ic">${d.icon}</span>${d.name}<br><small>${d.cost}⚡</small></button>`; }
let lastDesigns = [];
function renderPanel() {
  const T = TEAMS[0]; let h = '';
  if (placing) {
    const d = BD[placing.type];
    h = `<div class="ph"><span>${d.icon} Plasează: ${d.name}</span><span>${d.cost}⚡</span></div><div class="hint">${placing.type === 'pump' || placing.type === 'generator' ? 'Atinge o sondă de petrol liberă (pată neagră).' : 'Atinge harta pentru a muta clădirea. Verde = loc bun.'}</div>
    <div class="row"><button data-act="place-ok" class="ok" ${placing.valid && T.energy >= d.cost ? '' : 'disabled'}>✔ Construiește</button><button data-act="place-cancel" class="bad">✖ Anulează</button></div>`;
  } else if (!sel.length) {
    h = '';
  } else if (sel[0].team === 1) {
    const e = sel[0]; h = `<div class="ph"><span>☠ Inamic: ${e.kind === 'bld' ? e.def.name : designName(e.d)}</span></div><div class="bar"><i id="pHp"></i></div><div class="hint">Selectează unitățile tale și atinge inamicul pentru atac.</div>`;
  } else if (sel[0].kind === 'unit') {
    const trucks = sel.filter(u => u.isTruck), army = sel.filter(u => !u.isTruck);
    h = `<div class="ph"><span>${army.length ? '🪖 ' + army.length + ' unități ' : ''}${trucks.length ? '🚜 ' + trucks.length + ' constructori' : ''}</span></div>`;
    if (sel.length === 1) h += `<div class="hint">${designName(sel[0].d)}</div><div class="bar"><i id="pHp"></i></div>`;
    if (trucks.length) h += `<div class="lbl">Construiește</div><div class="grid">${bdBtn('generator')}${bdBtn('factory')}${bdBtn('lab')}${bdBtn('tower')}${ents.some(e => e.alive && e.team === 0 && e.type === 'hq') ? '' : bdBtn('hq')}</div><div class="hint">Atinge o sondă de petrol pentru generator rapid. Atinge o clădire avariată pentru reparație.</div>`;
    if (army.length) h += `<div class="row"><button data-act="amove" class="${amoveNext ? 'on' : ''}">⚔ Atac-deplasare</button><button data-act="stop">■ Stop</button></div>`;
  } else {
    const b = sel[0];
    h = `<div class="ph"><span>${b.def.icon} ${b.def.name}</span><span id="pHpT"></span></div><div class="bar"><i id="pHp"></i></div>`;
    if (!b.complete) h += `<div class="hint">În construcție…</div><div class="bar b"><i id="pBuild"></i></div><div class="hint">Selectează constructori și atinge clădirea ca să ajute.</div>`;
    else if (b.type === 'factory') {
      h += `<div class="lbl">Producție</div><div class="queue">${b.queue.map((d, i) => `<button data-act="unq" data-v="${i}">${d.wp === 'truck' ? '🚜' : '🪖'} ${i === 0 ? '<span id="pProdT"></span>' : ''} ✖</button>`).join('') || '<span class="hint">Coada e goală</span>'}</div><div class="bar o"><i id="pProd"></i></div>`;
      const truck = { ch: 'light', pr: 'wheels', wp: 'truck' };
      h += `<div class="grid"><button data-act="produce" data-v='${JSON.stringify(truck)}' ${T.energy < unitStats(truck, 0).cost || b.queue.length >= 8 ? 'disabled' : ''}><span class="ic">🚜</span>Constructor<br><small>${unitStats(truck, 0).cost}⚡</small></button>`;
      const quick = lastDesigns.length ? lastDesigns : [{ ch: 'light', pr: 'wheels', wp: 'mg' }];
      for (const d of quick) { const c = unitStats(d, 0).cost; h += `<button data-act="produce" data-v='${JSON.stringify(d)}' ${T.energy < c || b.queue.length >= 8 ? 'disabled' : ''}><span class="ic">🪖</span>${designName(d)}<br><small>${c}⚡</small></button>`; }
      h += `<button data-act="designer" class="ok"><span class="ic">🛠</span>Proiectant</button></div><div class="hint">Atinge harta pentru punctul de adunare.</div>`;
    } else if (b.type === 'lab') {
      h += `<div class="lbl">Cercetare</div>`;
      if (b.res) h += `<div class="rnow">${RICON[b.res.id]}<div><b>${b.res.name}</b><div class="bar b"><i id="pRes"></i></div></div></div>`;
      h += `<div class="rgrid">`;
      for (const r of RS) {
        const done = T.tech.has(r.id), locked = !done && r.req.some(q => !T.tech.has(q)), busy = !done && T.researching.has(r.id);
        const meta = done ? '✔ Cercetat' : locked ? '🔒 ' + r.req.map(q => RS.find(x => x.id === q).name).join(', ') : busy ? '⏳ În curs' : `${r.cost}⚡ · ${r.time}s`;
        const cls = done ? 'done' : locked ? 'locked' : busy ? 'busy' : '';
        const dis = done || locked || busy || b.res || T.energy < r.cost;
        h += `<button class="rcard ${cls}" data-act="research" data-v="${r.id}" ${dis ? 'disabled' : ''}>${RICON[r.id]}<span class="rn">${r.name}</span><span class="rm">${meta}</span></button>`;
      }
      h += `</div>`;
    } else if (b.type === 'generator') { h += `<div class="hint">Extrage petrol din sondă și produce +4 ⚡/s.</div>`; }
    else if (b.type === 'tower') h += `<div class="hint">Atacă automat inamicii din apropiere. ${TEAMS[0].tech.has('tower2') ? 'Armă: tun.' : 'Armă: mitralieră (cercetează „Turnuri cu tun”).'}</div>`;
    else if (b.type === 'hq') h += `<div class="hint">Centrul de comandă. Dă +1.5 ⚡/s. Nu-l pierde!</div>`;
  }
  panel.innerHTML = h;
}
function updDyn() {
  const e = sel[0]; if (!e) return;
  const hp = $('pHp'); if (hp) { const r = clamp(e.hp / e.maxHp, 0, 1); hp.style.width = (r * 100) + '%'; hp.style.background = r > 0.5 ? '#7fb84a' : r > 0.25 ? '#e0b030' : '#d04020'; }
  const ht = $('pHpT'); if (ht) ht.textContent = Math.ceil(e.hp) + '/' + e.maxHp;
  const pb = $('pBuild'); if (pb) pb.style.width = (e.built * 100) + '%';
  const pp = $('pProd'); if (pp) pp.style.width = e.queue && e.queue.length ? (e.prod / unitStats(e.queue[0], 0).time * 100) + '%' : '0%';
  const pr = $('pRes'); if (pr && e.res) pr.style.width = (e.resProg / e.res.time * 100) + '%';
}
function updatePanel() { const s = computeSig(); if (s !== panelSig) { panelSig = s; renderPanel(); } updDyn(); }
panel.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return; const act = b.dataset.act, v = b.dataset.v; sfx('click');
  const T = TEAMS[0]; const e = sel[0];
  if (act === 'build') startPlacing(v);
  else if (act === 'place-ok') confirmPlacing();
  else if (act === 'place-cancel') cancelPlacing();
  else if (act === 'amove') { amoveNext = !amoveNext; panelSig = ''; if (amoveNext) toast('Atinge harta: unitățile atacă pe drum'); }
  else if (act === 'stop') { for (const u of sel) if (u.kind === 'unit') { u.state = 'idle'; u.target = null; u.amove = false; u.vx = u.vz = 0; } }
  else if (act === 'produce') queueUnit(e, JSON.parse(v), 1);
  else if (act === 'unq') { const i = +v; const d = e.queue[i]; if (d) { T.energy += unitStats(d, 0).cost; e.queue.splice(i, 1); if (i === 0) e.prod = 0; panelSig = ''; } }
  else if (act === 'designer') openDesigner(e);
  else if (act === 'research') { const r = RS.find(x => x.id === v); if (T.energy >= r.cost && !e.res) { T.energy -= r.cost; e.res = r; e.resProg = 0; T.researching.add(r.id); panelSig = ''; } }
});
function queueUnit(f, d, n) {
  const T = TEAMS[0]; let k = 0;
  for (let i = 0; i < n; i++) { const c = unitStats(d, 0).cost; if (T.energy < c || f.queue.length >= 8) break; T.energy -= c; f.queue.push(d); k++; }
  if (!k) toast('Energie insuficientă sau coadă plină'); panelSig = '';
  if (d.wp !== 'truck') { lastDesigns = [d, ...lastDesigns.filter(x => designName(x) !== designName(d))].slice(0, 3); }
}

// designer
let dsg = { ch: 'light', pr: 'wheels', wp: 'mg' }, dsgFactory = null;
function openDesigner(f) { dsgFactory = f; $('designer').classList.remove('hidden'); renderDesigner(); }
function renderDesigner() {
  const T = TEAMS[0];
  const opt = (obj, key, field) => Object.keys(obj).filter(k => k !== 'truck').map(k => `<button data-f="${field}" data-k="${k}" class="${dsg[field] === k ? 'on' : ''}" ${T.tech.has(k) ? '' : 'disabled'}>${T.tech.has(k) ? '' : '🔒 '}${obj[k].name}</button>`).join('');
  $('dCh').innerHTML = opt(CH, 'ch', 'ch'); $('dPr').innerHTML = opt(PR, 'pr', 'pr'); $('dWp').innerHTML = opt(WP, 'wp', 'wp');
  const st = unitStats(dsg, 0); const bar = (n, v, mx, lbl) => `<div class="st"><span>${n}</span><div class="bar"><i style="width:${clamp(v / mx, 0, 1) * 100}%"></i></div><span>${lbl}</span></div>`;
  $('dStats').innerHTML = `<b>${designName(dsg)}</b><br>${bar('Viață', st.hp, 500, st.hp)}${bar('Viteză', st.speed, 10, st.speed.toFixed(1))}${bar('Atac', st.w.dmg / st.w.rof, 35, Math.round(st.w.dmg / st.w.rof))}${bar('Rază', st.range, 20, st.range)}<div>Cost: <b style="color:#f0b44a">${st.cost}⚡</b> · Timp: ${Math.round(st.time)}s</div>`;
  updatePreview();
}
$('designer').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b || b.disabled) return; sfx('click');
  if (b.dataset.f) { dsg[b.dataset.f] = b.dataset.k; renderDesigner(); return; }
  const a = b.dataset.d; if (a === 'close') $('designer').classList.add('hidden');
  if ((a === 'q1' || a === 'q5') && dsgFactory && dsgFactory.alive) { queueUnit(dsgFactory, { ...dsg }, a === 'q1' ? 1 : 5); $('designer').classList.add('hidden'); }
});
let prevR = null, prevScene, prevCam, prevGrp;
function updatePreview() {
  try {
    if (!prevR) { prevR = new THREE.WebGLRenderer({ canvas: $('prev'), antialias: true, alpha: true }); prevR.setPixelRatio(Math.min(devicePixelRatio, 2)); prevR.setSize(260, $('prev').clientHeight || 150, false); prevScene = new THREE.Scene(); prevScene.add(new THREE.HemisphereLight(0xffffff, 0x444033, 2)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 5, 4); prevScene.add(dl); prevCam = new THREE.PerspectiveCamera(35, 260 / 150, 0.1, 50); prevCam.position.set(4.5, 3.2, 5.5); prevCam.lookAt(0, 0.8, 0); }
    if (prevGrp) prevScene.remove(prevGrp); prevGrp = new THREE.Group(); const g = unitGeo(dsg, 0); prevGrp.add(new THREE.Mesh(g.body, matUnit)); const t = new THREE.Mesh(g.tur, matUnit); t.position.y = g.turY; prevGrp.add(t); prevScene.add(prevGrp);
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
  for (const w of WELLS) { mctx.fillStyle = w.pump ? TEAMC[w.pump.team].mini : '#111'; mctx.fillRect(P(w.x) - 2, P(w.z) - 2, 4, 4); }
  for (const e of ents) { if (!e.alive) continue; mctx.fillStyle = e.selected ? '#fff' : TEAMC[e.team].mini; const s = e.kind === 'bld' ? 5 : 3; mctx.fillRect(P(e.x) - s / 2, P(e.z) - s / 2, s, s); }
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
    if (!e.alive) continue; const show = e.selected || e.hp < e.maxHp - 0.5 || (e.kind === 'bld' && !e.complete); if (!show) continue;
    const p = toScreen(e.x, e.y + e.h + 0.7, e.z); if (p.z > 1 || p.x < -50 || p.x > innerWidth + 50 || p.y < -20 || p.y > innerHeight + 20) continue;
    const w = e.kind === 'bld' ? 46 : 28; const r = clamp(e.hp / e.maxHp, 0, 1);
    og.fillStyle = 'rgba(0,0,0,.6)'; og.fillRect(p.x - w / 2 - 1, p.y - 1, w + 2, 6);
    og.fillStyle = e.team === 1 ? (r > 0.5 ? '#e05a3a' : '#a02010') : (r > 0.5 ? '#7fd04a' : r > 0.25 ? '#e0b030' : '#d04020'); og.fillRect(p.x - w / 2, p.y, w * r, 4);
    if (e.kind === 'bld' && !e.complete) { og.fillStyle = '#3f9fe0'; og.fillRect(p.x - w / 2, p.y + 6, w * e.built, 3); }
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
  AU.sfxG = ctx.createGain(); AU.sfxG.gain.value = 0.55; AU.sfxG.connect(AU.master);
  const len = ctx.sampleRate * 3, ir = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  AU.rev = ctx.createConvolver(); AU.rev.buffer = ir; const rg = ctx.createGain(); rg.gain.value = 0.5; AU.rev.connect(rg); rg.connect(AU.mus);
  AU.dly = ctx.createDelay(1); AU.dly.delayTime.value = STEP * 3; const fb = ctx.createGain(); fb.gain.value = 0.38; AU.dly.connect(fb); fb.connect(AU.dly); const dl = ctx.createGain(); dl.gain.value = 0.5; AU.dly.connect(dl); dl.connect(AU.mus);
  AU.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = AU.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const n = ctx.createBufferSource(); n.buffer = AU.noise; n.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.7; const wg = ctx.createGain(); wg.gain.value = 0.05; const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 200; lfo.connect(lg); lg.connect(bp.frequency); n.connect(bp); bp.connect(wg); wg.connect(AU.mus); n.start(); lfo.start();
  AU.nextT = ctx.currentTime + 0.1; setInterval(schedule, 50);
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
const lastS = {};
function sfx(type, x, z) {
  const ctx = AU.ctx; if (!ctx || !AU.sfx || ctx.state !== 'running') return; const t = ctx.currentTime;
  const thr = { mg: 0.07, shell: 0.06, rocket: 0.08, boom: 0.05, hit: 0.05, weld: 0.15, click: 0.03, ack: 0.1 }[type] || 0; if (lastS[type] && t - lastS[type] < thr) return; lastS[type] = t;
  let vol = 1; if (x !== undefined) { const d = Math.hypot(x - cam.x, z - cam.z); vol = clamp(1 - d / (60 + cam.dist), 0, 1) * clamp(70 / (cam.dist + 20), 0.4, 1); if (vol < 0.03) return; }
  const nz = (dur, type2, f1, f2, q, v) => { const s = noiseSrc(t, dur); const f = ctx.createBiquadFilter(); f.type = type2; f.frequency.setValueAtTime(f1, t); if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur); f.Q.value = q; const g = ctx.createGain(); g.gain.setValueAtTime(v * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(f); f.connect(g); g.connect(AU.sfxG); };
  const tn = (type2, f1, f2, dur, v) => { const o = osc(type2, f1, t, dur + 0.05); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur); const g = ctx.createGain(); g.gain.setValueAtTime(v * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(AU.sfxG); };
  switch (type) {
    case 'mg': nz(0.06, 'bandpass', 1600, 0, 0.8, 0.35); break;
    case 'shell': nz(0.3, 'lowpass', 900, 120, 1, 0.6); tn('sine', 110, 40, 0.25, 0.5); break;
    case 'rocket': nz(0.6, 'bandpass', 2400, 500, 1.5, 0.35); break;
    case 'hit': nz(0.25, 'lowpass', 1200, 200, 1, 0.35); break;
    case 'boom': nz(0.8, 'lowpass', 900, 80, 1, 0.8); tn('sine', 70, 30, 0.6, 0.5); break;
    case 'bigboom': nz(1.6, 'lowpass', 700, 50, 1, 1); tn('sine', 55, 25, 1.4, 0.7); break;
    case 'weld': nz(0.08, 'highpass', 3000, 0, 1, 0.12); break;
    case 'click': tn('square', 900, 0, 0.04, 0.06); break;
    case 'ack': tn('triangle', 600, 900, 0.08, 0.1); break;
    case 'done': tn('triangle', 660, 0, 0.12, 0.15); setTimeout(() => sfx('done2'), 120); break;
    case 'done2': tn('triangle', 990, 0, 0.2, 0.15); break;
    case 'alert': tn('square', 520, 380, 0.25, 0.1); setTimeout(() => tn('square', 520, 380, 0.25, 0.1), 300); break;
  }
}

// ================= GAME FLOW =================
function setupGame() {
  scene.add(sky);
  buildTerrain(); buildDecor(); buildMiniBg();
  const B = PLAYER;
  createBuilding(0, 'hq', B.x - 6, B.z + 6, true, Math.PI);
  createBuilding(0, 'factory', B.x + 9, B.z - 2, true, Math.PI);
  createBuilding(0, 'generator', -14, 136, true);
  for (let i = 0; i < 3; i++) createUnit(0, { ch: 'light', pr: 'wheels', wp: 'truck' }, B.x - 4 + i * 3, B.z - 10);
  for (let i = 0; i < 4; i++) createUnit(0, { ch: 'light', pr: 'wheels', wp: 'mg' }, B.x + 6 + i * 3, B.z - 13);
  for (const u of ents) if (u.kind === 'unit') u.heading = Math.PI;
  setupEnemy();
}
let ecoT = 0, aiT = 0, uiT = 0, winT = 0;
function update(dt) {
  S.time += dt;
  for (let i = timers.length - 1; i >= 0; i--) if (S.time >= timers[i].t) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  ecoT += dt; if (ecoT >= 1) { ecoT -= 1; for (const T of TEAMS) { const gens = ents.filter(e => e.alive && e.team === T.i && e.type === 'generator' && e.complete).length; const hq = ents.some(e => e.alive && e.team === T.i && e.type === 'hq'); T.inc = (hq ? 1.5 : 0.5) + 4 * gens; T.energy += T.inc; } }
  aiT += dt; if (aiT >= 1) { aiT = 0; aiTick(); }
  for (const e of ents) if (e.alive) (e.kind === 'unit' ? updUnit : updBld)(e, dt);
  separate();
  for (let i = ents.length - 1; i >= 0; i--) if (!ents[i].alive) ents.splice(i, 1);
  updProjs(dt); updWrecks(dt); updWells(dt);
  for (let i = markers.length - 1; i >= 0; i--) { const m = markers[i]; m.t -= dt; m.m.scale.setScalar(0.4 + m.t); m.m.material.opacity = m.t; if (m.t <= 0) { scene.remove(m.m); markers.splice(i, 1); } }
  heat = Math.max(0, heat - dt * 0.08); AU.heat = lerp(AU.heat, clamp(heat, 0, 1), dt * 0.5);
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
  if (S.running && !S.paused && !S.over) update(dt);
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
document.querySelectorAll('#diff button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#diff button').forEach(x => x.classList.remove('on')); b.classList.add('on'); S.diff = +b.dataset.v; }));
$('bPlay').addEventListener('click', () => { audioInit(); $('intro').classList.add('hidden'); $('hud').classList.remove('hidden'); setupGame(); S.running = true; toast('Construiește generatoare pe sondele de petrol! ⚡'); });
$('bHelp').addEventListener('click', () => $('help').classList.remove('hidden'));
$('pHelp').addEventListener('click', () => $('help').classList.remove('hidden'));
$('hClose').addEventListener('click', () => $('help').classList.add('hidden'));
$('bPause').addEventListener('click', () => { S.paused = true; $('pause').classList.remove('hidden'); sfx('click'); });
$('pResume').addEventListener('click', () => { S.paused = false; $('pause').classList.add('hidden'); });
$('pMusic').addEventListener('click', e => { AU.music = !AU.music; e.target.textContent = '🎵 Muzică: ' + (AU.music ? 'DA' : 'NU'); });
$('pSfx').addEventListener('click', e => { AU.sfx = !AU.sfx; e.target.textContent = '🔊 Sunete: ' + (AU.sfx ? 'DA' : 'NU'); });
$('pRestart').addEventListener('click', () => location.reload());
$('bAgain').addEventListener('click', () => location.reload());
$('bAll').addEventListener('click', () => { setSel(ents.filter(e => e.alive && e.team === 0 && e.kind === 'unit' && !e.isTruck)); sfx('click'); });
$('bTrucks').addEventListener('click', () => { setSel(ents.filter(e => e.alive && e.team === 0 && e.isTruck)); sfx('click'); });
$('bBox').addEventListener('click', () => { boxMode = !boxMode; $('bBox').classList.toggle('on', boxMode); sfx('click'); });
$('bBase').addEventListener('click', () => { const hq = ents.find(e => e.alive && e.team === 0 && e.kind === 'bld') || { x: BASES[0].x, z: BASES[0].z }; cam.x = hq.x; cam.z = hq.z; sfx('click'); });

window.onAppPause = () => { if (S.running && !S.over) { S.paused = true; $('pause').classList.remove('hidden'); } if (AU.ctx) AU.ctx.suspend(); };
window.onAppResume = () => { if (AU.ctx) AU.ctx.resume(); };
window.onBack = () => {
  if (!$('help').classList.contains('hidden')) { $('help').classList.add('hidden'); return true; }
  if (!$('designer').classList.contains('hidden')) { $('designer').classList.add('hidden'); return true; }
  if (placing) { cancelPlacing(); return true; }
  if (!S.running || S.over) return false;
  if (S.paused) return false;
  S.paused = true; $('pause').classList.remove('hidden'); return true;
};
window.__game = { S, TEAMS, ents, cam, setSel, sel: () => sel, createUnit, createBuilding };

resize(); updateCamera(0); requestAnimationFrame(loop);
// background scene behind the intro
buildTerrainPreview();
function buildTerrainPreview() { /* terrain is built on start; show sky meanwhile */ }
})();
