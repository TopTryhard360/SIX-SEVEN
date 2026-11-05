// Deal or No Deal 3D front end. The rules run in Python; this file draws the
// stage with Three.js and drives the HTML overlay.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createHost, createModel, updateHost, updateModel } from './people.js';

// ---------------------------------------------------------------- settings

const GRID_ROWS = [6, 7, 7, 6];
const CASE_W = 0.82, CASE_H = 0.58, CASE_D = 0.2;
const SPACING = 1.08, ROW_LIFT = 0.95, ROW_DEPTH = 1.15;
const HOLD = new THREE.Vector3(0, 0.95, 0.27); // Where a model holds her case, from her feet.
const LID_ANGLE = 1.95;
const PEDESTAL = new THREE.Vector3(0, 0, 2.85);
const HOST_POS = new THREE.Vector3(-2.45, 0, 2.9);
const PEDESTAL_H = 0.3;
const REVEAL_MS = 1600;
const CALLING_MS = 1500;
const CAPTION_MS = 4800;
const FLY_SECONDS = 1.1;

const METAL = new THREE.Color(0x9ea4b0);
const METAL_DONE = new THREE.Color(0x2b2e36);
const GOLD = new THREE.Color(0xe3bd63);
const SPAM_COLORS = ['#ff3b6b', '#ffd60a', '#2ee6a6', '#3fa9ff', '#c77dff', '#ff8c1a', '#ffffff'];

const HOST_LINES = {
  pick: ['Welcome to the show! Pick the case you think holds the million.'],
  picked: ['Case {n}, great choice. Now start opening the others!'],
  big: ['Ooh, that one hurt.', 'There goes a big one!', 'The banker is smiling now.'],
  small: ['Yes! Keep hitting those small ones!', 'Beautiful! The big money is still out there.'],
  mid: ["Not bad at all.", "That's okay, you're still in this."],
  offer: ["The banker's on the phone. Here's the offer."],
  no_deal: ["Gutsy! Let's keep going.", 'No deal it is. Open more cases!'],
  final: ['Last decision of the night. Keep it, or swap it?'],
  over: ['What a game! Thanks for playing.'],
};

// ---------------------------------------------------------------- helpers

const $ = (id) => document.getElementById(id);
const choose = (list) => list[Math.floor(Math.random() * list.length)];
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const ease = (t) => t * t * (3 - 2 * t);

function money(v) {
  if (v === Math.floor(v)) return '$' + v.toLocaleString('en-US');
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function api(action, caseNumber) {
  const response = await fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, case: caseNumber }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// A pause that a click or key press can cut short.
let skipWait = null;
function wait(ms, skippable = false) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      if (skipWait === done) skipWait = null;
      resolve();
    }
    if (skippable) skipWait = done;
  });
}

// ---------------------------------------------------------------- renderer

const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080c);
scene.fog = new THREE.Fog(0x07080c, 15, 32);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.55, 0.97);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const glowMaterial = (color, strength) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) });

// ---------------------------------------------------------------- lights

scene.add(new THREE.HemisphereLight(0x8a96b8, 0x08080c, 0.5));

const key = new THREE.SpotLight(0xfff0dc, 1.9, 0, Math.PI / 5, 0.65, 0);
key.position.set(-3.5, 11, 8);
key.target.position.set(0, 1, -1);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0003;
key.shadow.radius = 4;
scene.add(key, key.target);

const fill = new THREE.DirectionalLight(0x9fb4ff, 0.35);
fill.position.set(6, 4, 6);
scene.add(fill);

const rimWarm = new THREE.PointLight(0xffb347, 1.4, 14, 0);
rimWarm.position.set(-6, 6.5, -6);
const rimCool = new THREE.PointLight(0x4f7dff, 1.3, 14, 0);
rimCool.position.set(6, 6.5, -6);
scene.add(rimWarm, rimCool);

const pedestalSpot = new THREE.SpotLight(0xffe2a8, 0, 0, 0.32, 0.55, 0);
pedestalSpot.position.set(0, 8, 7);
pedestalSpot.target.position.copy(PEDESTAL);
scene.add(pedestalSpot, pedestalSpot.target);

// ---------------------------------------------------------------- stage

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.42, metalness: 0.55 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 18),
  new THREE.MeshStandardMaterial({ color: 0x0a0c13, roughness: 0.9 }),
);
wall.position.set(0, 9, -9);
scene.add(wall);

const strips = [];
for (let i = -5; i <= 5; i++) {
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 14, 0.05), glowMaterial(i % 2 ? 0x4f7dff : 0xe3bd63, 1));
  strip.position.set(i * 2.6, 7, -8.9);
  strip.userData.phase = i * 0.7;
  strips.push(strip);
  scene.add(strip);
}

const riserMaterial = new THREE.MeshStandardMaterial({ color: 0x10131c, roughness: 0.55, metalness: 0.35 });
const edgeMaterial = glowMaterial(0xe3bd63, 1.6);
for (let level = 1; level <= 3; level++) {
  const front = -level * ROW_DEPTH + 0.62;
  const depth = front + 9;
  const height = level * ROW_LIFT;
  const riser = new THREE.Mesh(new THREE.BoxGeometry(9.6, height, depth), riserMaterial);
  riser.position.set(0, height / 2, front - depth / 2);
  riser.receiveShadow = true;
  riser.castShadow = true;
  scene.add(riser);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.018, 0.018), edgeMaterial);
  edge.position.set(0, height, front);
  scene.add(edge);
}

// The pedestal for the player's case.
const pedestal = new THREE.Group();
pedestal.position.copy(PEDESTAL);
const pedestalBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.95, 1.02, PEDESTAL_H, 64),
  new THREE.MeshStandardMaterial({ color: 0x151822, roughness: 0.35, metalness: 0.8 }),
);
pedestalBody.position.y = PEDESTAL_H / 2;
pedestalBody.castShadow = pedestalBody.receiveShadow = true;
const pedestalRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.012, 8, 128), glowMaterial(0xe3bd63, 2.2));
pedestalRing.rotation.x = Math.PI / 2;
pedestalRing.position.y = PEDESTAL_H;
const floorRing = new THREE.Mesh(new THREE.RingGeometry(1.28, 1.31, 128), glowMaterial(0xe3bd63, 0.9));
floorRing.rotation.x = -Math.PI / 2;
floorRing.position.y = 0.004;
pedestal.add(pedestalBody, pedestalRing, floorRing);
scene.add(pedestal);

// Floating dust in the light.
const dustCount = 260;
const dustPositions = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  dustPositions[i * 3] = (Math.random() - 0.5) * 18;
  dustPositions[i * 3 + 1] = Math.random() * 7;
  dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 12;
}
const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
  color: 0xffe7b8, size: 0.03, transparent: true, opacity: 0.45, depthWrite: false,
  blending: THREE.AdditiveBlending,
}));
scene.add(dust);

// ---------------------------------------------------------------- cases

function plateTexture(text, color, width, height, fontSize) {
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = width * scale;
  c.height = height * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#0c0e14';
  g.beginPath();
  g.roundRect(0, 0, width, height, 14);
  g.fill();
  g.strokeStyle = 'rgba(227, 189, 99, 0.85)';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(5, 5, width - 10, height - 10, 10);
  g.stroke();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = fontSize;
  do {
    g.font = `700 ${size}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
    size -= 2;
  } while (g.measureText(text).width > width - 28 && size > 10);
  g.fillText(text, width / 2, height / 2 + 2);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

// A case is a back shell plus a front lid hinged at the bottom. The value
// plate sits on the shell's face, hidden until the lid swings down.
const SHELL_D = CASE_D * 0.6, LID_D = CASE_D - SHELL_D;
const shellGeometry = new RoundedBoxGeometry(CASE_W, CASE_H, SHELL_D, 4, 0.04);
const lidGeometry = new RoundedBoxGeometry(CASE_W, CASE_H, LID_D, 4, 0.04);
const handleGeometry = new THREE.TorusGeometry(0.1, 0.018, 10, 28, Math.PI);
const latchGeometry = new RoundedBoxGeometry(0.07, 0.04, 0.02, 2, 0.008);
const frontPlateGeometry = new THREE.PlaneGeometry(0.46, 0.26);
const valuePlateGeometry = new THREE.PlaneGeometry(0.7, 0.32);
const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xd4a94a, metalness: 1, roughness: 0.3 });
const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.6, roughness: 0.4 });

const cases = new Map();
const pickables = [];

// Where a model stands: feet on her row's riser.
function standFor(row, col, count) {
  const level = GRID_ROWS.length - 1 - row;
  return new THREE.Vector3((col - (count - 1) / 2) * SPACING, level * ROW_LIFT, -level * ROW_DEPTH);
}

function shadowed(mesh) {
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function buildCase(number) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const material = new THREE.MeshStandardMaterial({ color: METAL.clone(), metalness: 0.92, roughness: 0.3 });
  const shell = shadowed(new THREE.Mesh(shellGeometry, material));
  shell.position.z = -CASE_D / 2 + SHELL_D / 2;
  const shellFront = -CASE_D / 2 + SHELL_D;
  const valuePlate = new THREE.Mesh(valuePlateGeometry, new THREE.MeshBasicMaterial({ color: 0x0c0e14 }));
  valuePlate.position.z = shellFront + 0.002;
  const handle = shadowed(new THREE.Mesh(handleGeometry, handleMaterial));
  handle.position.y = CASE_H / 2;

  const hinge = new THREE.Group();
  hinge.position.set(0, -CASE_H / 2, shellFront);
  const lid = shadowed(new THREE.Mesh(lidGeometry, material));
  lid.position.set(0, CASE_H / 2, LID_D / 2);
  const plate = new THREE.Mesh(frontPlateGeometry, new THREE.MeshBasicMaterial({
    map: plateTexture(String(number), '#ffffff', 180, 102, 64),
  }));
  plate.position.set(0, CASE_H / 2, LID_D + 0.003);
  hinge.add(lid, plate);
  for (const side of [-1, 1]) {
    const latch = new THREE.Mesh(latchGeometry, trimMaterial);
    latch.position.set(side * 0.27, CASE_H - 0.05, LID_D + 0.006);
    hinge.add(latch);
  }
  inner.add(shell, valuePlate, handle, hinge);
  for (const mesh of [shell, lid, plate]) mesh.userData.number = number;
  pickables.push(shell, lid, plate);
  return { group, inner, hinge, material, valuePlate };
}

function buildCast() {
  let number = 0;
  GRID_ROWS.forEach((count, row) => {
    for (let col = 0; col < count; col++) {
      number += 1;
      const stand = standFor(row, col, count);
      const model = createModel(number);
      model.group.position.copy(stand);
      model.group.traverse((mesh) => {
        if (mesh.isMesh) {
          mesh.userData.number = number;
          pickables.push(mesh);
        }
      });
      scene.add(model.group);
      const parts = buildCase(number);
      parts.group.position.copy(stand).add(HOLD);
      scene.add(parts.group);
      cases.set(number, {
        number, model, stand, ...parts,
        hover: 0, open: 0, openTarget: 0, dim: 0, dimTarget: 0, glow: 0, glowTarget: 0,
        fly: null, home: new THREE.Vector3(),
      });
    }
  });
}
buildCast();

const host = createHost();
host.group.position.copy(HOST_POS);
host.group.rotation.y = 0.5;
scene.add(host.group);
let talkUntil = 0;

function setValue(c, value) {
  const color = value >= 1000 ? '#e3bd63' : '#d6e2ff';
  c.valuePlate.material.map?.dispose();
  c.valuePlate.material.map = plateTexture(money(value), color, 280, 125, 62);
  c.valuePlate.material.color.set(0xffffff);
  c.valuePlate.material.needsUpdate = true;
}

function clearValue(c) {
  c.valuePlate.material.map?.dispose();
  c.valuePlate.material.map = null;
  c.valuePlate.material.color.set(0x0c0e14);
  c.valuePlate.material.needsUpdate = true;
}

function flyTo(c, target, seconds = FLY_SECONDS) {
  c.fly = { from: c.group.position.clone(), to: target.clone(), t: 0, seconds };
}

const pedestalTop = () => new THREE.Vector3(PEDESTAL.x, PEDESTAL_H + CASE_H / 2 + 0.02, PEDESTAL.z);

// ---------------------------------------------------------------- camera and input

const pointer = new THREE.Vector2(10, 10);
const parallax = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let hovered = null;
let focus = 0;

function resize() {
  const width = window.innerWidth, height = window.innerHeight;
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();

// Move in on the player's case while a decision is on screen.
function wantsFocus() {
  return Boolean(state) && (state.phase === 'over' || $('modal').classList.contains('show')
    || $('calling').classList.contains('show'));
}

function updateCamera(t, dt) {
  const fit = Math.max(1, 1.62 / camera.aspect);
  focus = damp(focus, wantsFocus() ? 1 : 0, 2.2, dt);
  const wide = new THREE.Vector3(Math.sin(t * 0.22) * 0.45 + parallax.x * 0.7,
    5.0 + Math.sin(t * 0.17) * 0.12 - parallax.y * 0.3, 12.6 * fit);
  const close = new THREE.Vector3(-0.8 + Math.sin(t * 0.3) * 0.5 + parallax.x * 0.3, 2.6, PEDESTAL.z + 6.0 * fit);
  camPos.lerpVectors(wide, close, ease(focus));
  camLook.lerpVectors(new THREE.Vector3(0, 1.95, -1.1), new THREE.Vector3(-0.7, 1.15, PEDESTAL.z - 1.2), ease(focus));
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

const setPointer = (event) =>
  pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
window.addEventListener('pointermove', setPointer);
document.addEventListener('pointerleave', () => pointer.set(10, 10));

// A click on a case during a reveal skips the reveal and opens that case next.
let queued = null;
canvas.addEventListener('click', (event) => {
  setPointer(event);
  if (skipWait) {
    queued = caseUnderPointer();
    skipWait();
    return;
  }
  pickHover();
  if (hovered !== null) handleCase(hovered);
});

function caseUnderPointer() {
  raycaster.setFromCamera(pointer, camera);
  const number = raycaster.intersectObjects(pickables, false)[0]?.object.userData.number;
  if (!number || number === state.playerCase || String(number) in state.opened) return null;
  return number;
}

function canPickCases() {
  return !busy && state && (state.phase === 'pick' || state.phase === 'open');
}

function pickHover() {
  hovered = canPickCases() && Math.abs(pointer.x) <= 1 ? caseUnderPointer() : null;
  canvas.style.cursor = hovered !== null ? 'pointer' : '';
}

// ---------------------------------------------------------------- frame loop

const clock = new THREE.Clock();
const heldAt = new THREE.Vector3();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  parallax.x = damp(parallax.x, Math.abs(pointer.x) <= 1 ? pointer.x : 0, 2, dt);
  parallax.y = damp(parallax.y, Math.abs(pointer.y) <= 1 ? pointer.y : 0, 2, dt);
  updateCamera(t, dt);
  pickHover();

  for (const strip of strips) {
    const pulse = 0.55 + 0.45 * Math.sin(t * 0.9 + strip.userData.phase);
    strip.material.color.setRGB(...(strip.userData.base ??= strip.material.color.toArray()).map((v) => v * pulse));
  }
  pedestalSpot.intensity = damp(pedestalSpot.intensity, state?.playerCase ? 3.2 : 0.6, 2, dt);
  dust.rotation.y = t * 0.01;
  dust.position.y = Math.sin(t * 0.2) * 0.15;

  const finalPulse = 0.5 + 0.5 * Math.sin(t * 3);
  for (const c of cases.values()) {
    c.hover = damp(c.hover, hovered === c.number ? 1 : 0, 12, dt);
    c.open = damp(c.open, c.openTarget, 5, dt);
    c.dim = damp(c.dim, c.dimTarget, 3, dt);
    c.glow = damp(c.glow, c.glowTarget, 4, dt);

    const mine = c.number === state?.playerCase;
    c.model.group.position.set(c.stand.x + Math.sin(t * 0.8 + c.model.phase) * 0.012, c.stand.y, c.stand.z);
    c.home.copy(c.model.group.position).add(HOLD);
    c.home.y += c.hover * 0.12 - c.dim * 0.05;

    if (c.fly) {
      c.fly.t = Math.min(1, c.fly.t + dt / c.fly.seconds);
      const e = ease(c.fly.t);
      c.group.position.lerpVectors(c.fly.from, c.fly.to, e);
      c.group.position.y += Math.sin(Math.PI * e) * 1.2;
      c.inner.rotation.z = Math.sin(Math.PI * e) * 0.25;
      if (c.fly.t >= 1) {
        c.fly = null;
        c.inner.rotation.z = 0;
      }
    } else if (mine) {
      c.group.position.copy(pedestalTop());
      c.group.position.y += Math.sin(t * 1.6) * 0.03;
    } else {
      c.group.position.copy(c.home);
    }
    c.group.rotation.y = mine && !c.fly && !c.openTarget ? Math.sin(t * 0.7) * 0.12 : 0;
    c.hinge.rotation.x = c.open * LID_ANGLE;
    c.inner.rotation.x = -c.hover * 0.06;
    c.material.color.copy(METAL).lerp(METAL_DONE, c.dim);
    c.material.roughness = 0.34 + c.dim * 0.3;
    c.material.emissive.copy(GOLD).multiplyScalar(c.hover * 0.18 + c.glow * (0.12 + 0.2 * finalPulse));

    // The model holds her case unless it has left for the pedestal.
    const holding = !c.fly && !mine;
    updateModel(c.model, t, holding ? heldAt.subVectors(c.group.position, c.model.group.position) : null, CASE_W);
  }
  updateHost(host, t, t < talkUntil);

  composer.render();
  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------- overlay

let state = null;
let busy = false;
let captionTimer = null;

function say(kind, values = {}) {
  const line = choose(HOST_LINES[kind]).replace(/\{(\w+)\}/g, (_, k) => values[k]);
  $('line').textContent = line;
  $('caption').classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => $('caption').classList.remove('show'), CAPTION_MS);
  talkUntil = clock.elapsedTime + Math.min(4, 1 + line.length * 0.045);
}

function buildLadders(values) {
  const fillLadder = (el, list) => {
    el.innerHTML = '';
    for (const value of list) {
      const row = document.createElement('div');
      row.className = 'v';
      row.dataset.value = value;
      row.textContent = money(value);
      el.append(row);
    }
  };
  fillLadder($('ladderLow'), values.slice(0, 13));
  fillLadder($('ladderHigh'), values.slice(13));
}

function updateLadders(flashValue = null) {
  const alive = new Set(state.remaining);
  document.querySelectorAll('.ladder .v').forEach((row) => {
    const value = Number(row.dataset.value);
    row.classList.toggle('gone', !alive.has(value));
    if (value === flashValue) {
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
    }
  });
}

function statusHtml() {
  switch (state.phase) {
    case 'pick': return 'Choose your case <em>· it stays sealed until the end</em>';
    case 'open': return `Round ${state.round} <em>· open ${state.toOpen} more ${state.toOpen === 1 ? 'case' : 'cases'}</em>`;
    case 'offer': return `Round ${state.round} <em>· the banker is on the line</em>`;
    case 'final': return 'Final decision <em>· keep or swap</em>';
    default: return 'Game over';
  }
}

// The newest offer stays hidden until the banker's card is on screen.
function updateOverlay(flashValue = null, hideNewOffer = false) {
  $('status').innerHTML = statusHtml();
  $('yourCase').textContent = state.playerCase ?? '–';
  const offers = (hideNewOffer ? state.offers.slice(0, -1) : state.offers).slice(-5);
  $('offers').innerHTML = offers.length
    ? '<span>Offers</span>' + offers.map((o, i) =>
      `<span class="chip${i === offers.length - 1 ? ' latest' : ''}">${money(o)}</span>`).join('')
    : '';
  updateLadders(flashValue);
  for (const c of cases.values()) {
    c.glowTarget = state.phase === 'final' && !(String(c.number) in state.opened) ? 1 : 0;
  }
}

function showReveal(number, value) {
  $('revealLabel').textContent = `Case ${number} held`;
  const amount = $('revealAmount');
  amount.textContent = money(value);
  amount.className = 'reveal-amount' + (value >= 100000 ? ' big' : value <= 1000 ? ' small' : '');
  $('reveal').classList.add('show');
}

function countUp(el, value, ms = 900) {
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    const shown = value * (1 - Math.pow(1 - k, 3));
    el.textContent = k < 1 ? money(value >= 100 ? Math.round(shown) : Math.round(shown * 100) / 100) : money(value);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let modalKeys = {};

function openModal(html, keys, amount) {
  $('card').innerHTML = html;
  modalKeys = keys;
  for (const [action, , id] of Object.values(keys)) $(id)?.addEventListener('click', action);
  if (amount !== undefined) countUp($('cardAmount'), amount);
  $('modal').classList.add('show');
}

function closeModal() {
  $('modal').classList.remove('show');
  modalKeys = {};
}

function showOffer() {
  updateOverlay();
  const next = state.lastOffer
    ? 'This is the last offer. After this you keep or swap.'
    : `Say no and you open ${state.nextToOpen} more ${state.nextToOpen === 1 ? 'case' : 'cases'}.`;
  openModal(`
    <div class="eyebrow">Round ${state.round} · the banker offers</div>
    <div class="amount green" id="cardAmount">$0</div>
    <p>${next}</p>
    <div class="question">Deal or no deal?</div>
    <div class="buttons">
      <button class="btn deal" id="btnDeal">DEAL</button>
      <button class="btn nodeal" id="btnNoDeal">NO DEAL</button>
    </div>
    <div class="hint"><kbd>D</kbd> deal &nbsp; <kbd>N</kbd> no deal</div>`,
  { d: [() => act('deal'), 'deal', 'btnDeal'], n: [() => act('no_deal'), 'no_deal', 'btnNoDeal'] },
  state.offers[state.offers.length - 1]);
}

function showFinal() {
  const [low, high] = state.remaining;
  openModal(`
    <div class="eyebrow">Final decision</div>
    <div class="pair">${money(low)}<i>or</i>${money(high)}</div>
    <p>One is in your case ${state.playerCase}. The other is in case ${state.otherCase}.</p>
    <div class="buttons">
      <button class="btn gold" id="btnKeep">KEEP ${state.playerCase}</button>
      <button class="btn ghost" id="btnSwap">SWAP FOR ${state.otherCase}</button>
    </div>
    <div class="hint"><kbd>K</kbd> keep &nbsp; <kbd>S</kbd> swap</div>`,
  { k: [() => act('keep'), 'keep', 'btnKeep'], s: [() => act('swap'), 'swap', 'btnSwap'] });
}

function showOver() {
  openModal(`
    <div class="eyebrow">You win</div>
    <div class="amount gold" id="cardAmount">$0</div>
    <p>${state.verdict}</p>
    <div class="buttons">
      <button class="btn gold" id="btnAgain">PLAY AGAIN</button>
      <button class="btn ghost" id="btnQuit">QUIT</button>
    </div>
    <div class="hint"><kbd>R</kbd> play again</div>`,
  { r: [newGame, 'again', 'btnAgain'], q: [quit, 'quit', 'btnQuit'] },
  state.winnings);
}

function showError(error) {
  $('line').textContent = `Something went wrong: ${error.message}`;
  $('caption').classList.add('show');
}

// ---------------------------------------------------------------- game flow

async function handleCase(number) {
  if (!canPickCases()) return;
  busy = true;
  hovered = null;
  try {
    if (state.phase === 'pick') {
      state = await api('pick', number);
      const c = cases.get(number);
      flyTo(c, pedestalTop());
      say('picked', { n: number });
      updateOverlay();
      await wait(FLY_SECONDS * 1000 * 0.8);
    } else {
      const next = await api('open', number);
      const value = next.opened[String(number)];
      const c = cases.get(number);
      setValue(c, value);
      c.openTarget = 1;
      c.dimTarget = 1;
      state = next;
      updateOverlay(value, state.phase === 'offer');
      showReveal(number, value);
      say(value >= 100000 ? 'big' : value <= 1000 ? 'small' : 'mid');
      await wait(REVEAL_MS, true);
      $('reveal').classList.remove('show');
      if (state.phase === 'offer') {
        $('calling').classList.add('show');
        say('offer');
        await wait(CALLING_MS);
        $('calling').classList.remove('show');
        showOffer();
      }
    }
  } catch (error) {
    showError(error);
  }
  busy = false;
  const next = queued;
  queued = null;
  if (next !== null && canPickCases() && !(String(next) in state.opened)) handleCase(next);
}

async function act(action) {
  if (busy) return;
  busy = true;
  closeModal();
  try {
    state = await api(action);
    updateOverlay();
    if (state.phase === 'over') {
      say('over');
      await revealEnding();
      showOver();
    } else if (state.phase === 'final') {
      say('final');
      await wait(700);
      showFinal();
    } else {
      say('no_deal');
    }
  } catch (error) {
    showError(error);
  }
  busy = false;
}

async function revealEnding() {
  await wait(500);
  const mine = cases.get(state.playerCase);
  setValue(mine, state.playerValue);
  mine.openTarget = 1;
  if (state.otherCase) {
    const other = cases.get(state.otherCase);
    setValue(other, state.otherValue);
    other.openTarget = 1;
  }
  for (const c of cases.values()) c.glowTarget = 0;
  await wait(1700, true);
}

async function newGame() {
  closeModal();
  busy = true;
  try {
    const previous = state?.playerCase;
    state = await api('new');
    for (const c of cases.values()) {
      c.openTarget = 0;
      c.dimTarget = 0;
      c.glowTarget = 0;
      if (c.number === previous) flyTo(c, c.home, 0.9);
    }
    setTimeout(() => {
      for (const c of cases.values()) clearValue(c);
    }, 600);
    buildLadders(state.values);
    updateOverlay();
    say('pick');
  } catch (error) {
    showError(error);
  }
  busy = false;
}

async function quit() {
  closeModal();
  try {
    await fetch('/api/quit', { method: 'POST' });
  } catch { /* The window may already be closing. */ }
  setTimeout(() => {
    window.close();
    $('status').textContent = 'Thanks for playing. You can close this tab.';
  }, 300);
}

// ---------------------------------------------------------------- 6 7

let burstTimer = null;

function burst() {
  clearInterval(burstTimer);
  let ticks = 0;
  burstTimer = setInterval(() => {
    for (let i = 0; i < 3; i++) {
      const span = document.createElement('span');
      span.textContent = '6 7';
      span.style.left = `${Math.random() * 100}%`;
      span.style.top = `${Math.random() * 100}%`;
      span.style.fontSize = `${28 + Math.random() * 90}px`;
      span.style.color = choose(SPAM_COLORS);
      span.style.setProperty('--r', `${Math.round(Math.random() * 50 - 25)}deg`);
      span.addEventListener('animationend', () => span.remove());
      $('spam').append(span);
    }
    if (++ticks >= 16) clearInterval(burstTimer);
  }, 90);
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (event.repeat) return;
  if (key === '6' || key === '7') {
    burst();
    return;
  }
  if (skipWait) {
    skipWait();
    return;
  }
  if (key === 'enter' && modalKeys.r) {
    modalKeys.r[0]();
  } else if (modalKeys[key] && key !== 'q') {
    event.preventDefault();
    modalKeys[key][0]();
  }
});

// ---------------------------------------------------------------- start

requestAnimationFrame(animate);
newGame();
