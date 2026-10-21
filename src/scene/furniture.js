import * as THREE from 'three';
import { decorateTable } from './tabledecor.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { woodPlanks, roofTiles, kilim, stripes, paperLantern } from './tex.js';
import { LAYOUT as L } from '../layout.js';

// Bar, seating, lights and props. Returns colliders for the walking code and an update() for flicker/sway.

const std = (o) => new THREE.MeshStandardMaterial(o);
const sh = (m, c = true, r = true) => { m.castShadow = c; m.receiveShadow = r; return m; };
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k); // >1 so bloom picks it up
const O = new THREE.Object3D();

function catenary(a, b, sag, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); pts.push(p); }
  return pts;
}

export function buildFurniture(scene, { menuTex }) {
  const G = new THREE.Group(); G.name = 'furniture'; scene.add(G);
  const colliders = { circles: [], rects: [] };
  const flames = []; const swing = [];

  const oak = woodPlanks({ planks: 5, tone: [150, 96, 56] });
  const walnut = woodPlanks({ planks: 4, tone: [96, 58, 34] });
  const slats = woodPlanks({ planks: 10, tone: [128, 78, 44], vertical: true });
  const roof = roofTiles();
  const M = {
    oak: std({ map: oak.map, normalMap: oak.normalMap, roughness: 0.62 }),
    walnut: std({ map: walnut.map, normalMap: walnut.normalMap, roughness: 0.4 }),
    slats: std({ map: slats.map, normalMap: slats.normalMap, roughness: 0.7 }),
    darkWood: std({ color: 0x3e2717, roughness: 0.7 }),
    brass: std({ color: 0xc89b4c, metalness: 0.9, roughness: 0.28 }),
    iron: std({ color: 0x23211f, metalness: 0.7, roughness: 0.45 }),
    red: new THREE.MeshPhysicalMaterial({ color: 0x8f2418, roughness: 0.38, clearcoat: 0.6 }),
    teal: std({ color: 0x235e66, roughness: 0.55 }),
    orangePaint: std({ color: 0xd9772a, roughness: 0.6 }),
    roof: std({ map: roof.map, normalMap: roof.normalMap, roughness: 0.85, color: 0x8a8d93 }),
    ridge: std({ color: 0x45484d, roughness: 0.8 }),
    enamel: std({ color: 0x2c6a6f, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }),
    bulb: new THREE.MeshBasicMaterial({ color: hdr(0xffd9a0, 3.2) }),
    bulbWarm: new THREE.MeshBasicMaterial({ color: hdr(0xffb45a, 5) }),
    flame: new THREE.MeshBasicMaterial({ color: hdr(0xffb347, 8) }),
    glass: new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.32 }),
    paper: new THREE.MeshStandardMaterial({ map: paperLantern(), emissive: 0xffa040, emissiveIntensity: 2.2, roughness: 0.9 }),
    redLantern: new THREE.MeshStandardMaterial({ color: 0xc8261a, emissive: 0xff3a1a, emissiveIntensity: 1.6, roughness: 0.7 }),
    cushion: std({ color: 0xb4572d, roughness: 0.95 }),
    cushion2: std({ color: 0x3d6b4f, roughness: 0.95 }),
  };

  // ================= BAR =================
  const B = L.bar, W = L.walls;
  const bar = new THREE.Group(); G.add(bar);
  const cx = (B.x0 + B.x1) / 2, cw = B.x1 - B.x0, cz = (B.z0 + B.z1) / 2, front = B.z1;
  const body = sh(new THREE.Mesh(new THREE.BoxGeometry(cw, 1.02, B.z1 - B.z0), M.slats)); body.position.set(cx, 0.51, cz); bar.add(body);
  const kick = sh(new THREE.Mesh(new THREE.BoxGeometry(cw - 0.1, 0.12, B.z1 - B.z0 - 0.15), M.darkWood)); kick.position.set(cx, 0.06, cz - 0.04); bar.add(kick);
  const top = sh(new THREE.Mesh(new RoundedBoxGeometry(cw + 0.25, 0.09, B.z1 - B.z0 + 0.25, 2, 0.03), M.walnut)); top.position.set(cx, 1.08, cz + 0.02); bar.add(top);
  const rail = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, cw - 0.4, 12), M.brass)); rail.rotation.z = Math.PI / 2; rail.position.set(cx, 0.24, front + 0.15); bar.add(rail);
  for (let x = B.x0 + 0.3; x <= B.x1 - 0.2; x += 2.1) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.18), M.brass); br.position.set(x, 0.2, front + 0.06); bar.add(br); }
  colliders.rects.push({ x0: B.x0 - 0.15, x1: B.x1 + 0.15, z0: W.northZ, z1: front + 0.05 });
  const tapBar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.12), M.brass); tapBar.position.set(cx + 0.8, 1.5, cz - 0.3); bar.add(tapBar);
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 8), M.brass); t.position.set(cx + 0.3 + i * 0.33, 1.3, cz - 0.3); bar.add(t);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.2, 8), [M.teal, M.orangePaint, M.red, M.walnut][i]); h.position.set(cx + 0.3 + i * 0.33, 1.66, cz - 0.26); bar.add(h);
  }
  const glassGeo = new THREE.CylinderGeometry(0.045, 0.038, 0.14, 14, 1, true);
  const beerMat = std({ color: 0xe0a030, roughness: 0.2, transparent: true, opacity: 0.85 });
  for (const [x, z] of [[B.x0 + 0.7, cz + 0.2], [B.x0 + 0.95, cz + 0.1], [cx - 1.2, cz + 0.18], [cx + 1.9, cz + 0.25], [B.x1 - 0.9, cz + 0.15]]) {
    const gl = new THREE.Mesh(glassGeo, M.glass); gl.position.set(x, 1.2, z); bar.add(gl);
    const beer = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 12), beerMat); beer.position.set(x, 1.18, z); bar.add(beer);
  }
  // back cabinet with shelves and bottles
  const cab = sh(new THREE.Mesh(new THREE.BoxGeometry(cw - 0.4, 2.6, 0.5), M.darkWood)); cab.position.set(cx, 1.3, B.cabinetZ); bar.add(cab);
  const shelfGeo = new THREE.BoxGeometry(cw - 0.6, 0.05, 0.42);
  for (const y of [0.95, 1.65, 2.35]) { const s = sh(new THREE.Mesh(shelfGeo, M.oak)); s.position.set(cx, y, B.cabinetZ + 0.2); bar.add(s); }
  const bottleProfile = (neck, h) => { const p = [new THREE.Vector2(0, 0), new THREE.Vector2(0.06, 0), new THREE.Vector2(0.065, 0.02), new THREE.Vector2(0.065, h * 0.62), new THREE.Vector2(0.05, h * 0.72), new THREE.Vector2(neck, h * 0.82), new THREE.Vector2(neck, h), new THREE.Vector2(0, h)]; return new THREE.LatheGeometry(p, 12); };
  const variants = [bottleProfile(0.018, 0.42), bottleProfile(0.024, 0.32), bottleProfile(0.03, 0.26)];
  const bottleColors = [0x2f6b3c, 0x7a3d1d, 0xc0902f, 0x3a5f8f, 0xd8d0c0, 0x8a2a2a];
  const perRow = Math.floor((cw - 0.8) / 0.33);
  variants.forEach((geo, vi) => {
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.88 }), perRow * 3); let k = 0;
    for (const y of [0.98, 1.68, 2.38]) for (let i = vi; i < perRow; i += 3) {
      const x = B.x0 + 0.5 + i * 0.33 + ((i * 7) % 3) * 0.03;
      O.position.set(x, y, B.cabinetZ + 0.2 + ((i + vi) % 2) * 0.12 - 0.06); O.rotation.set(0, i, 0); O.scale.setScalar(0.9 + ((i * 7 + vi) % 5) * 0.05); O.updateMatrix(); im.setMatrixAt(k, O.matrix); im.setColorAt(k, new THREE.Color(bottleColors[(i + vi * 2 + Math.floor(y * 3)) % 6])); k++;
    }
    im.count = k; bar.add(im); // bottles sit in the cabinet's shadow anyway: no shadow pass
  });
  // roof over the bar: tiled single slope from the north wall to the front beam, red columns, rafter ends
  const roofLen = cw + 1.6, roofDepth = B.roofFrontZ - W.northZ, rise = 0.65, eaveY = 3.35;
  const slope = Math.hypot(roofDepth, rise), ang = Math.atan2(rise, roofDepth), rcz = (B.roofFrontZ + W.northZ) / 2;
  const rg = new THREE.PlaneGeometry(roofLen, slope); const uv = rg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * roofLen / 1.3, uv.getY(i) * slope / 1.3);
  const rf = sh(new THREE.Mesh(rg, M.roof)); rf.rotation.x = -Math.PI / 2 + ang; rf.position.set(cx, eaveY + rise / 2 + 0.05, rcz); bar.add(rf);
  const soffit = new THREE.Mesh(new THREE.PlaneGeometry(roofLen, slope), M.darkWood); soffit.rotation.x = Math.PI / 2 + ang; soffit.position.set(cx, eaveY + rise / 2, rcz); bar.add(soffit);
  const beam = sh(new THREE.Mesh(new THREE.BoxGeometry(roofLen - 0.2, 0.3, 0.22), M.teal)); beam.position.set(cx, eaveY - 0.18, B.roofFrontZ - 0.08); bar.add(beam);
  for (let i = 0; i < Math.floor(roofLen / 2); i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.225), M.orangePaint); st.position.set(cx - roofLen / 2 + 1.1 + i * 2, eaveY - 0.18, B.roofFrontZ - 0.08); bar.add(st); }
  const nRaf = Math.round(roofLen / 0.3); const rafters = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 10), M.red, nRaf);
  for (let i = 0; i < nRaf; i++) { O.position.set(cx - roofLen / 2 + 0.15 + i * (roofLen - 0.3) / (nRaf - 1), eaveY + 0.02, B.roofFrontZ + 0.08); O.rotation.set(Math.PI / 2 - ang, 0, 0); O.scale.setScalar(1); O.updateMatrix(); rafters.setMatrixAt(i, O.matrix); }
  bar.add(rafters);
  // 瓦当 tile ends along the eave and a ridge where the slope meets the wall: a finished edge instead of a sheet
  const nTile = Math.round(roofLen / 0.19), tileEnds = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), M.ridge, nTile);
  for (let i = 0; i < nTile; i++) { O.position.set(cx - roofLen / 2 + (i + 0.5) * roofLen / nTile, eaveY + 0.07, B.roofFrontZ + 0.03); O.rotation.set(Math.PI / 2, 0, 0); O.scale.setScalar(1); O.updateMatrix(); tileEnds.setMatrixAt(i, O.matrix); }
  bar.add(tileEnds);
  const barRidge = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, roofLen + 0.1, 12), M.ridge)); barRidge.rotation.z = Math.PI / 2; barRidge.position.set(cx, eaveY + rise + 0.1, W.northZ + 0.08); bar.add(barRidge);
  for (const x of [B.x0 - 0.75, B.x1 + 0.3]) {
    const col = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, eaveY - 0.3, 16), M.red)); col.position.set(x, (eaveY - 0.3) / 2, B.roofFrontZ - 0.08); bar.add(col);
    const base = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.16, 16), std({ color: 0x8f8a82, roughness: 0.9 }))); base.position.set(x, 0.08, B.roofFrontZ - 0.08); bar.add(base);
    colliders.circles.push({ x, z: B.roofFrontZ - 0.08, r: 0.3 });
  }
  // six graffiti menu boards under the beam: slices of the bar's own photo strip (menu_01-06_strip.png)
  if (menuTex) {
    const step = (cw - 0.6) / 6;
    for (let i = 0; i < 6; i++) {
      const t = menuTex.clone(); t.needsUpdate = true; t.repeat.set(1 / 6, 1); t.offset.set(i / 6, 0); t.colorSpace = THREE.SRGBColorSpace;
      const w = 0.66, h = 1.38, x = B.x0 + 0.3 + step * (i + 0.5), y = eaveY - 0.33 - h / 2 - 0.12, z = B.roofFrontZ - 0.1;
      const frame = sh(new THREE.Mesh(new RoundedBoxGeometry(w + 0.12, h + 0.12, 0.06, 2, 0.02), M.darkWood)); frame.position.set(x, y, z - 0.03); bar.add(frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.18 }));
      face.position.set(x, y, z + 0.005); bar.add(face);
      for (const s of [-1, 1]) { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 4), M.iron); ch.position.set(x + s * 0.26, y + h / 2 + 0.13, z - 0.03); bar.add(ch); }
    }
  }
  for (const x of [cx - 3.3, cx - 1.1, cx + 1.1, cx + 3.3]) { // enamel pendant lamps over the counter
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4), M.iron); cord.position.set(x, 3.0, cz - 0.15); bar.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.18, 20, 1, true), M.enamel); shade.position.set(x, 2.6, cz - 0.15); bar.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), M.bulb); bulb.position.set(x, 2.53, cz - 0.15); bar.add(bulb);
  }
  const barLight = new THREE.PointLight(0xffb066, 26, 9, 1.7); barLight.position.set(cx, 2.4, cz + 0.6); bar.add(barLight);
  const shelfLight = new THREE.PointLight(0xffa860, 8, 5, 2); shelfLight.position.set(cx, 2.0, B.cabinetZ + 0.9); bar.add(shelfLight);

  // ================= STOOLS & TABLES =================
  const stoolGeo = (() => {
    const parts = [];
    const seat = new THREE.CylinderGeometry(0.22, 0.2, 0.07, 18); seat.translate(0, 0.72, 0); parts.push(seat);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const leg = new THREE.CylinderGeometry(0.022, 0.028, 0.72, 6); leg.rotateZ(0.08 * Math.cos(a)); leg.rotateX(-0.08 * Math.sin(a)); leg.translate(Math.cos(a) * 0.15, 0.36, Math.sin(a) * 0.15); parts.push(leg); }
    const ring = new THREE.TorusGeometry(0.16, 0.012, 6, 20); ring.rotateX(Math.PI / 2); ring.translate(0, 0.28, 0); parts.push(ring);
    return mergeGeometries(parts.map((p) => p.toNonIndexed()));
  })();
  const stools = L.barStools.map((x) => [x, L.barStoolZ, 1]);
  const tables = L.tables;
  for (const [tx, tz] of tables) for (const a of [0.35, 1.9, 3.45, 5.0]) {
    const sx = tx + Math.cos(a) * L.stoolRing, sz = tz + Math.sin(a) * L.stoolRing; if (sx < L.lounge.x + 1.0) continue; // the lounge bench replaces wall-side stools
    stools.push([sx, sz, 0.82]);
  }
  const seats = [];
  const stoolMesh = sh(new THREE.InstancedMesh(stoolGeo, M.oak, stools.length));
  stools.forEach(([x, z, s], i) => {
    O.position.set(x, 0, z); O.rotation.set(0, i * 1.3, 0); O.scale.set(1, s, 1); O.updateMatrix(); stoolMesh.setMatrixAt(i, O.matrix);
    const tbl = tables.find(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.5);
    seats.push({ x, z, y: 0.755 * s, ry: tbl ? Math.atan2(tbl[0] - x, tbl[1] - z) : Math.PI, kind: s === 1 ? 'bar' : 'stool', group: tbl ? 't' + tables.indexOf(tbl) : 'bar' });
    colliders.circles.push({ x, z, r: 0.18 });
  });
  G.add(stoolMesh);
  const R = L.tableR;
  for (const [tx, tz] of tables) {
    const tg = new THREE.Group(); tg.position.set(tx, 0, tz); G.add(tg);
    const top2 = sh(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.08, 40), M.walnut)); top2.position.y = 0.86; tg.add(top2);
    const edge = sh(new THREE.Mesh(new THREE.TorusGeometry(R, 0.035, 8, 40), M.walnut)); edge.rotation.x = Math.PI / 2; edge.position.y = 0.86; tg.add(edge);
    const ped = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.8, 12), M.darkWood)); ped.position.y = 0.42; tg.add(ped);
    const foot = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.05, 24), M.darkWood)); foot.position.y = 0.03; tg.add(foot);
    // a flower arrangement (a different style per table) and a dice cup with dice
    const decor = decorateTable(['garden', 'ikebana', 'harvest'][tables.findIndex(([x, z]) => x === tx && z === tz) % 3]);
    decor.position.y = 0.9; decor.rotation.y = Math.atan2(-tx, 1.5 - tz); tg.add(decor); // flowers face the middle of the yard
    colliders.circles.push({ x: tx, z: tz, r: R + 0.12 });
  }
  const loungeLight = new THREE.PointLight(0xffa850, 12, 8, 1.8); loungeLight.position.set(-6.2, 2.1, -1.0); G.add(loungeLight);
  const yardLight = new THREE.PointLight(0xffa850, 9, 8, 1.8); yardLight.position.set(5.0, 2.1, 1.7); G.add(yardLight);

  // ================= LOUNGE: bench along the west wall + kilim =================
  const Lg = L.lounge, lLen = Lg.z1 - Lg.z0, lMid = (Lg.z0 + Lg.z1) / 2;
  const benchSeat = sh(new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.42, lLen, 2, 0.04), M.darkWood)); benchSeat.position.set(Lg.x, 0.21, lMid); G.add(benchSeat);
  const cushionGeo = new RoundedBoxGeometry(0.58, 0.14, lLen / 3 - 0.06, 4, 0.06);
  for (let i = 0; i < 3; i++) { const c = sh(new THREE.Mesh(cushionGeo, i === 1 ? M.cushion2 : M.cushion)); c.position.set(Lg.x, 0.49, Lg.z0 + lLen / 6 + i * lLen / 3); G.add(c); }
  const pillowTex = [stripes(['#e9c27a', '#b4572d', '#f3e3c2'], 9), stripes(['#2f4f6a', '#e9c27a'], 6)];
  for (let i = 0; i < 4; i++) {
    const p = sh(new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.46, 0.52, 4, 0.08), std({ map: pillowTex[i % 2], roughness: 0.95 })));
    p.position.set(Lg.x - 0.24, 0.76, Lg.z0 + 0.55 + i * (lLen - 1.1) / 3); p.rotation.set(0, 0, -0.18); G.add(p);
  }
  const kil = kilim();
  const rug = sh(new THREE.Mesh(new THREE.PlaneGeometry(2.6, lLen + 0.4), std({ map: kil.map, normalMap: kil.normalMap, roughness: 1 })), false); rug.rotation.x = -Math.PI / 2; rug.position.set(Lg.x + 2.0, 0.012, lMid); G.add(rug);
  colliders.rects.push({ x0: W.westX, x1: Lg.x + 0.32, z0: Lg.z0, z1: Lg.z1 });
  for (let i = 0; i < 4; i++) {
    const z = Lg.z0 + 0.6 + i * (lLen - 1.2) / 3; let gi = -1, gd = 2.8; // bench seats belong to the table in front of them
    tables.forEach(([tx, tz], k) => { const d = Math.hypot(tx - Lg.x, tz - z); if (d < gd) { gd = d; gi = k; } });
    seats.push({ x: Lg.x, z, y: 0.56, ry: Math.PI / 2, kind: 'bench', group: gi >= 0 ? 't' + gi : 'lounge' });
  }
  // round rug where the cat stands
  const rc = document.createElement('canvas'); rc.width = rc.height = 512; const g2 = rc.getContext('2d');
  for (let r = 256; r > 0; r -= 22) { g2.fillStyle = ['#8f2f22', '#d9772a', '#f1d9a6', '#2f4f6a'][(r / 22 | 0) % 4]; g2.beginPath(); g2.arc(256, 256, r, 0, 7); g2.fill(); }
  const rt = new THREE.CanvasTexture(rc); rt.colorSpace = THREE.SRGBColorSpace;
  const round = sh(new THREE.Mesh(new THREE.CircleGeometry(1.25, 48), std({ map: rt, roughness: 1 })), false); round.rotation.x = -Math.PI / 2; round.position.set(L.spots.cat[0], 0.012, L.spots.cat[1]); G.add(round);

  // (the bicycle is rideable now: see scene/bike.js)
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

  // ================= LANTERN POSTS (deck + island) and STRING LIGHTS =================
  const D = L.deck, postZ = D.z1 - 0.06, postXs = [-6.6, -3.9, 0, 3.0];
  const lanternGeo = new RoundedBoxGeometry(0.26, 0.34, 0.26, 2, 0.02);
  const lanternPost = (x, z, y0, h) => {
    const post = sh(new THREE.Mesh(new RoundedBoxGeometry(0.16, h, 0.16, 2, 0.02), M.darkWood)); post.position.set(x, y0 + h / 2, z); G.add(post);
    const lan = new THREE.Mesh(lanternGeo, M.paper); lan.position.set(x, y0 + h + 0.2, z); G.add(lan);
    const cap = sh(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.12, 4), M.darkWood)); cap.position.set(x, y0 + h + 0.43, z); cap.rotation.y = Math.PI / 4; G.add(cap);
    return V(x, y0 + h + 0.38, z);
  };
  // thin posts: small collider so a shove off the deck edge only bounces on a dead-centre hit
  const deckTops = postXs.map((x) => { colliders.circles.push({ x, z: postZ, r: 0.02 }); return lanternPost(x, postZ, 0, 1.4); });
  const isl = L.sea.island; const islandTop = lanternPost(isl.x + 1.0, isl.z - 1.0, 0.5, 2.8);
  const strands = [
    [V(W.westX + 0.3, 3.3, W.northZ + 0.5), V(W.eastX - 0.3, 3.3, -1.6), 0.75],
    [V(W.westX + 0.3, 3.25, -1.2), V(W.eastX - 0.3, 3.25, 1.4), 0.8],
    [V(W.westX + 0.3, 3.15, 2.6), deckTops[1], 0.3],
    [V(W.eastX - 0.3, 3.15, 2.4), deckTops[3], 0.3],
    [deckTops[0], deckTops[1], 0.12], [deckTops[1], deckTops[2], 0.12], [deckTops[2], deckTops[3], 0.12],
    [deckTops[1], islandTop, 0.7], [deckTops[3], islandTop, 0.7], // across the water: they reflect in the lagoon
  ];
  const bulbPts = []; const wireGeos = [];
  for (const [a, b, sag] of strands) {
    const pts = catenary(a, b, sag, 40);
    wireGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.007, 4, false));
    const n = Math.max(2, Math.floor(a.distanceTo(b) / 0.55));
    for (let i = 1; i < n; i++) { const p = pts[Math.round(i / n * 40)]; bulbPts.push(p.clone().add(V(0, -0.06, 0))); }
  }
  G.add(new THREE.Mesh(mergeGeometries(wireGeos), M.iron));
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 10, 8), M.bulb, bulbPts.length);
  bulbPts.forEach((p, i) => { O.position.copy(p); O.rotation.set(0, 0, 0); O.scale.set(1, 1.25, 1); O.updateMatrix(); bulbs.setMatrixAt(i, O.matrix); bulbs.setColorAt(i, new THREE.Color(1, 0.92 + (i % 3) * 0.04, 0.8 + (i % 5) * 0.04)); });
  G.add(bulbs);
  // warm lights the water should reflect: lanterns + every 3rd bulb on the strands over the water
  const glints = [...deckTops, islandTop].map((p) => ({ x: p.x, y: p.y - 0.2, z: p.z, intensity: 1.2 }));
  bulbPts.forEach((p, i) => { if (p.z > D.z0 && i % 3 === 0 && glints.length < 10) glints.push({ x: p.x, y: p.y, z: p.z, intensity: 0.6 }); });
  const deckLight = new THREE.PointLight(0xffa850, 12, 9, 1.8); deckLight.position.set(-1.5, 1.9, D.z0 + 1.0); G.add(deckLight);

  // red lanterns flanking the door
  for (const z of [L.door.z - L.door.halfWidth - 0.15, L.door.z + L.door.halfWidth + 0.15]) {
    const lg = new THREE.Group(); lg.position.set(W.westX + 0.6, 2.45, z); G.add(lg); swing.push(lg);
    const body2 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), M.redLantern); body2.scale.set(1, 0.85, 1); lg.add(body2);
    for (const y of [0.18, -0.18]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), M.brass); c.position.y = y; lg.add(c); }
    const tas = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.01, 0.26, 6), std({ color: 0xd8a33a })); tas.position.y = -0.34; lg.add(tas);
  }
  const doorLight = new THREE.PointLight(0xff6a3a, 5, 4.5, 2); doorLight.position.set(W.westX + 0.9, 2.3, L.door.z); G.add(doorLight);

  // towel bench on the deck, under the ginkgo
  const tbx = -5.2, tbz = D.z0 + 0.35; // against the yard side of the deck so the deck's west corner leads onto the bank
  const tb = sh(new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.42, 0.42, 2, 0.03), M.oak)); tb.position.set(tbx, 0.21, tbz); G.add(tb);
  const towel = sh(new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.08, 0.4, 2, 0.03), std({ map: stripes(['#f4efe6', '#5b86b3'], 10), roughness: 1 }))); towel.position.set(tbx - 0.25, 0.46, tbz); G.add(towel);
  colliders.circles.push({ x: tbx - 0.3, z: tbz, r: 0.32 }, { x: tbx + 0.3, z: tbz, r: 0.32 });

  const update = (t) => {
    flames.forEach((f, i) => { const k = 1 + Math.sin(t * 13 + i * 2) * 0.12 + Math.sin(t * 29 + i) * 0.06; f.scale.set(1, k, 1); });
    swing.forEach((l, i) => { l.rotation.z = Math.sin(t * 1.3 + i) * 0.04; });
  };
  seats.forEach((st, i) => { st.id = i; }); // stable across clients (same deterministic build)
  return { group: G, colliders, seats, glints, bulbs, update };
}
