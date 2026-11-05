// Stylized people for the stage: the models who hold the cases, and the host.
// Each figure stands with its feet at the group origin and faces +z.
// Arms are two capsules posed with a small two-bone IK solver, so hands can
// follow whatever they hold.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _hand = new THREE.Vector3();

const capsule = (radius, length) => new THREE.CapsuleGeometry(radius, length, 6, 14);
const sphere = (radius) => new THREE.SphereGeometry(radius, 24, 16);
const standard = (color, roughness = 0.5, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Stretch a limb mesh (a capsule along +y) between two points.
function placeLimb(limb, a, b) {
  limb.position.copy(a).add(b).multiplyScalar(0.5);
  _dir.subVectors(b, a).normalize();
  limb.quaternion.setFromUnitVectors(UP, _dir);
}

// Two-bone IK: where the elbow and hand go when reaching for a target.
function solveArm(shoulder, target, upper, lower, hint) {
  _dir.subVectors(target, shoulder);
  const reach = THREE.MathUtils.clamp(_dir.length(), Math.abs(upper - lower) + 1e-3, upper + lower - 1e-3);
  _dir.normalize();
  _hand.copy(shoulder).addScaledVector(_dir, reach);
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  _perp.copy(hint).addScaledVector(_dir, -hint.dot(_dir)).normalize();
  _elbow.copy(shoulder).addScaledVector(_dir, along).addScaledVector(_perp, out);
}

function buildArm(side, shoulder, upperLength, lowerLength, radius, sleeve, skin) {
  const upper = mesh(capsule(radius, upperLength), sleeve);
  const lower = mesh(capsule(radius * 0.86, lowerLength), sleeve);
  const hand = mesh(sphere(radius * 1.05), skin);
  return { side, shoulder, upperLength, lowerLength, upper, lower, hand, meshes: [upper, lower, hand] };
}

function poseArm(arm, target) {
  _hint.set(arm.side * 0.9, -0.5, -0.7);
  solveArm(arm.shoulder, target, arm.upperLength, arm.lowerLength, _hint);
  placeLimb(arm.upper, arm.shoulder, _elbow);
  placeLimb(arm.lower, _elbow, _hand);
  arm.hand.position.copy(_hand);
}

// ------------------------------------------------------------------ models

const SKIN_TONES = [0xf1c7a5, 0xe2ae88, 0xc98d66, 0x9c6646, 0x70472f, 0xf6d6c0, 0xb57a52];
const HAIR_COLORS = [0x1c1512, 0x3a2317, 0x6b4126, 0xc99b5a, 0x101010, 0x7d2a1b, 0x2b1d14];
const HAIR_STYLES = ['long', 'bun', 'bob', 'pony'];

const modelGeometry = {
  leg: capsule(0.05, 0.62),
  shoe: capsule(0.045, 0.1),
  skirt: new THREE.LatheGeometry([
    new THREE.Vector2(0.24, 0.42), new THREE.Vector2(0.215, 0.6), new THREE.Vector2(0.17, 0.84),
    new THREE.Vector2(0.135, 1.0), new THREE.Vector2(0.125, 1.06),
  ], 40),
  torso: capsule(0.12, 0.28),
  belt: new THREE.TorusGeometry(0.127, 0.013, 8, 40),
  neck: new THREE.CylinderGeometry(0.04, 0.045, 0.12, 16),
  head: sphere(0.1),
  hairCap: new THREE.SphereGeometry(0.108, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.58),
  hairLong: capsule(0.1, 0.24),
  bun: sphere(0.055),
  pony: capsule(0.032, 0.24),
};

const dressMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x121521, roughness: 0.32, metalness: 0.15, sheen: 1, sheenColor: 0x4a5a8a, sheenRoughness: 0.4,
  side: THREE.DoubleSide,
});
const beltMaterial = standard(0xd4a94a, 0.3, 1);
const shoeMaterial = standard(0x0b0b0f, 0.3, 0.4);
const skinMaterials = new Map();
const hairMaterials = new Map();
const cached = (map, color, make) => map.get(color) ?? map.set(color, make(color)).get(color);

export function createModel(seed) {
  const random = mulberry(seed);
  const skin = cached(skinMaterials, SKIN_TONES[Math.floor(random() * SKIN_TONES.length)], (c) => standard(c, 0.55));
  const hair = cached(hairMaterials, HAIR_COLORS[Math.floor(random() * HAIR_COLORS.length)], (c) => standard(c, 0.6));
  const style = HAIR_STYLES[Math.floor(random() * HAIR_STYLES.length)];
  const g = modelGeometry;

  const group = new THREE.Group();
  const upper = new THREE.Group(); // Everything above the waist, so it can breathe.
  group.add(upper);

  for (const side of [-1, 1]) {
    group.add(mesh(g.leg, skin, side * 0.07, 0.36, 0));
    const shoe = mesh(g.shoe, shoeMaterial, side * 0.07, 0.035, 0.03);
    shoe.rotation.x = Math.PI / 2;
    group.add(shoe);
  }
  group.add(mesh(g.skirt, dressMaterial));

  const torso = mesh(g.torso, dressMaterial, 0, 1.2, 0);
  torso.scale.set(1.05, 1, 0.72);
  const belt = mesh(g.belt, beltMaterial, 0, 1.04, 0);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.74, 1);
  const neck = mesh(g.neck, skin, 0, 1.49, 0);
  upper.add(torso, belt, neck);

  const head = new THREE.Group();
  head.position.set(0, 1.62, 0);
  const face = mesh(g.head, skin);
  face.scale.set(1, 1.14, 1);
  const cap = mesh(g.hairCap, hair, 0, 0.012, -0.012);
  cap.rotation.x = style === 'bob' ? -0.62 : -0.48;
  if (style === 'bob') cap.scale.set(1.08, 1.12, 1.06);
  head.add(face, cap);
  if (style === 'long') {
    const back = mesh(g.hairLong, hair, 0, -0.12, -0.055);
    back.scale.set(1.08, 1, 0.55);
    head.add(back);
  } else if (style === 'bun') {
    head.add(mesh(g.bun, hair, 0, 0.1, -0.08));
  } else if (style === 'pony') {
    const tail = mesh(g.pony, hair, 0, -0.07, -0.13);
    tail.rotation.x = 0.35;
    head.add(tail);
  }
  upper.add(head);

  const arms = [-1, 1].map((side) =>
    buildArm(side, new THREE.Vector3(side * 0.19, 1.39, 0), 0.29, 0.27, 0.04, skin, skin));
  for (const arm of arms) group.add(...arm.meshes);

  return { group, upper, head, arms, phase: random() * Math.PI * 2, lookYaw: (random() - 0.5) * 0.5 };
}

const _left = new THREE.Vector3();
const _right = new THREE.Vector3();

// held: the case centre in the model's local space, or null for empty hands.
export function updateModel(model, t, held, caseWidth) {
  const breath = Math.sin(t * 1.6 + model.phase);
  model.upper.position.y = breath * 0.004;
  model.head.rotation.y = model.lookYaw + Math.sin(t * 0.45 + model.phase) * 0.12;
  model.head.rotation.z = Math.sin(t * 0.6 + model.phase) * 0.03;
  for (const arm of model.arms) arm.shoulder.y = 1.39 + breath * 0.004;
  if (held) {
    _left.set(held.x - caseWidth / 2 - 0.02, held.y - 0.04, held.z);
    _right.set(held.x + caseWidth / 2 + 0.02, held.y - 0.04, held.z);
  } else {
    _left.set(-0.23, 0.8, 0.04);
    _right.set(0.23, 0.8, 0.04);
  }
  poseArm(model.arms[0], _left);
  poseArm(model.arms[1], _right);
}

// A small seeded random number generator, so each model always looks the same.
function mulberry(seed) {
  let a = seed * 2654435761 >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ host

export function createHost() {
  const suit = standard(0x1b1f2d, 0.42, 0.1);
  const skin = standard(0xe3ae88, 0.5);
  const dark = standard(0x3c3631, 0.7);
  const group = new THREE.Group();
  const upper = new THREE.Group();
  group.add(upper);

  for (const side of [-1, 1]) {
    group.add(mesh(capsule(0.072, 0.74), suit, side * 0.1, 0.45, 0));
    const shoe = mesh(capsule(0.055, 0.12), shoeMaterial, side * 0.1, 0.05, 0.05);
    shoe.rotation.x = Math.PI / 2;
    group.add(shoe);
  }

  const torso = mesh(capsule(0.19, 0.36), suit, 0, 1.26, 0);
  torso.scale.set(1.1, 1, 0.75);
  const shirtShape = new THREE.Shape();
  shirtShape.moveTo(-0.085, 0);
  shirtShape.lineTo(0.085, 0);
  shirtShape.lineTo(0, -0.27);
  const shirt = mesh(new THREE.ShapeGeometry(shirtShape), standard(0xeef1f7, 0.6), 0, 1.6, 0.146);
  const tie = mesh(new THREE.BoxGeometry(0.045, 0.24, 0.01), standard(0xa81f36, 0.4), 0, 1.44, 0.149);
  const neck = mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.12, 16), skin, 0, 1.66, 0);
  upper.add(torso, shirt, tie, neck);

  const head = new THREE.Group();
  head.position.set(0, 1.84, 0);
  const face = mesh(sphere(0.135), skin);
  face.scale.set(1, 1.1, 1);
  const goatee = mesh(sphere(0.045), dark, 0, -0.125, 0.1);
  goatee.scale.set(1, 0.8, 0.6);
  head.add(face, goatee);
  for (const side of [-1, 1]) {
    head.add(mesh(sphere(0.03), skin, side * 0.135, 0, 0));
    head.add(mesh(new THREE.SphereGeometry(0.016, 12, 8), standard(0x1a120c, 0.3), side * 0.046, 0.02, 0.124));
    const brow = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), dark, side * 0.048, 0.058, 0.124);
    brow.rotation.z = side * -0.12;
    head.add(brow);
  }
  upper.add(head);

  const arms = [-1, 1].map((side) =>
    buildArm(side, new THREE.Vector3(side * 0.25, 1.53, 0), 0.32, 0.3, 0.055, suit, skin));
  for (const arm of arms) group.add(...arm.meshes);

  const mic = new THREE.Group();
  mic.add(mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.16, 12), standard(0x15161a, 0.3, 0.6), 0, 0.02, 0));
  mic.add(mesh(sphere(0.032), standard(0x5a5d66, 0.6, 0.8), 0, 0.11, 0));
  group.add(mic);

  return { group, upper, head, arms, mic };
}

const _micTarget = new THREE.Vector3();
const _gesture = new THREE.Vector3();

export function updateHost(host, t, talking) {
  const breath = Math.sin(t * 1.3);
  host.upper.position.y = breath * 0.005;
  host.head.rotation.y = Math.sin(t * 0.5) * 0.18;
  host.head.rotation.x = talking ? Math.sin(t * 9) * 0.05 : 0;
  _micTarget.set(-0.06, 1.5 + (talking ? 0.04 : 0), 0.27);
  poseArm(host.arms[0], _micTarget);
  host.mic.position.copy(host.arms[0].hand.position);
  host.mic.position.y += 0.02;
  host.mic.rotation.z = -0.25;
  if (talking) _gesture.set(0.5, 1.42 + Math.sin(t * 5) * 0.08, 0.32);
  else _gesture.set(0.3, 0.92 + Math.sin(t * 1.1) * 0.02, 0.06);
  host.gesture ??= _gesture.clone();
  host.gesture.lerp(_gesture, 0.1); // Ease between resting and gesturing.
  poseArm(host.arms[1], host.gesture);
}
