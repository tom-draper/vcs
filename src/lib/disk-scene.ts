// The WebGL half of <DiskDrive>. A platter spins under an arm that swings
// between tracks. The sectors waiting to be read are marked on the platter,
// so you can watch each one come round to the head.
//
// The model works in 2D with y pointing up the page. A model point (x, y) sits
// at (x, height, -y) in the scene, so turning the scene about its y axis by an
// angle turns the model the same way.
import * as THREE from 'three';
import {
  ARM,
  armAt,
  INNER,
  OUTER,
  phaseAt,
  PIVOT,
  platterAngle,
  SECTOR_ANGLE,
  TRACK_WIDTH,
  TRACKS,
  trackRadius,
  type Op,
  type Phase,
} from './disk';
import { glowTexture, PlateScene, type PlateOptions } from './plate-scene';

interface Options extends Omit<PlateOptions, 'fov' | 'autoRotate'> {
  /** Called every frame with how far into the current run the disk is, in disk milliseconds. */
  onTime?: (ms: number) => void;
}

/** Real milliseconds per disk millisecond. At this speed one revolution takes a second. */
const SLOW = 120;
const PLATTER_Y = 0.12;
const PLATTER_H = 0.03;
const TOP = PLATTER_Y + PLATTER_H / 2;
const ARM_Y = TOP + 0.06;

const to3 = (x: number, y: number, h: number) => new THREE.Vector3(x, h, -y);

const phaseText: Record<Phase, string> = {
  idle: '',
  seek: 'seeking',
  wait: 'waiting for the sector',
  read: 'reading',
};

export class DiskScene extends PlateScene {
  private platter = new THREE.Group();
  private disc: THREE.Mesh;
  private chassis: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private index: THREE.Mesh;
  private arm = new THREE.Group();
  private armParts: THREE.Mesh[] = [];
  private headGlow: THREE.Sprite;
  private blocks: THREE.Mesh[] = [];
  private blockState: ('pending' | 'reading' | 'done')[] = [];
  private ops: Op[] = [];
  /** For each read, which block on the platter it is. */
  private blockOf: number[] = [];
  private runStart = 0;
  /** The disk time being drawn this frame. */
  private t = 0;
  private rest = 2;
  private phaseLabel: HTMLElement;
  private clock: HTMLElement;
  private ticketLabels: HTMLElement[] = [];
  private inks = { pending: new THREE.Color(), reading: new THREE.Color(), done: new THREE.Color() };
  private opts: Options;

  constructor(host: HTMLElement, labelLayer: HTMLElement, options: Options) {
    super(host, labelLayer, { ...options, autoRotate: false, fov: [30, 42] });
    this.opts = options;
    this.camera.position.set(0.55, 3.5, 3.3);
    this.controls.target.set(0.3, 0, 0.2);
    this.controls.minDistance = 2;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = 1.3;
    this.key.position.set(-2, 6, 3);
    const shadow = this.key.shadow.camera;
    shadow.left = shadow.bottom = -2.5;
    shadow.right = shadow.top = 2.5;
    shadow.far = 20;
    shadow.updateProjectionMatrix();

    this.chassis = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.08, 2.7), new THREE.MeshStandardMaterial({ roughness: 0.85 }));
    this.chassis.position.set(0.5, 0.04, -0.2);
    this.chassis.receiveShadow = true;
    this.scene.add(this.chassis);

    this.disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, PLATTER_H, 128),
      new THREE.MeshStandardMaterial({ metalness: 0.85, roughness: 0.28 }),
    );
    this.disc.castShadow = true;
    this.disc.receiveShadow = true;
    this.platter.position.y = PLATTER_Y;
    this.platter.add(this.disc);
    this.scene.add(this.platter);

    // Track boundaries, and a hub. These turn with the platter.
    for (let t = 0; t <= TRACKS; t++) {
      const r = INNER + t * TRACK_WIDTH;
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.0025, r + 0.0025, 160), new THREE.MeshBasicMaterial({ transparent: true }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = PLATTER_H / 2 + 0.001;
      this.platter.add(ring);
      this.rings.push(ring);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 48), new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.2 }));
    hub.position.y = PLATTER_H / 2 + 0.025;
    hub.castShadow = true;
    this.platter.add(hub);
    this.armParts.push(hub);
    // A notch at the rim by sector 0, so the spin is visible even with nothing to read.
    this.index = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.02), new THREE.MeshBasicMaterial({ transparent: true }));
    this.index.rotation.x = -Math.PI / 2;
    this.index.position.set(0.97, PLATTER_H / 2 + 0.0015, 0);
    this.platter.add(this.index);

    this.buildArm();
    this.headGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false }));
    this.headGlow.scale.setScalar(0.28);
    this.headGlow.position.set(ARM, -0.03, 0);
    this.headGlow.visible = false;
    this.arm.add(this.headGlow);

    this.phaseLabel = this.label('disk-phase');
    this.clock = this.label('disk-clock');
    this.ready();
  }

  private label(className: string) {
    const el = document.createElement('span');
    el.className = className;
    this.labelLayer.append(el);
    return el;
  }

  private buildArm() {
    const metal = () => new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.35 });
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.16, 40), metal());
    pivot.position.y = 0.08;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ARM, 0.025, 0.07), metal());
    beam.position.set(ARM / 2, ARM_Y - 0.04, 0);
    const slider = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.06), metal());
    slider.position.set(ARM, TOP + 0.02, 0);
    for (const part of [pivot, beam, slider]) {
      part.castShadow = true;
      this.arm.add(part);
      this.armParts.push(part);
    }
    this.arm.position.copy(to3(PIVOT.x, PIVOT.y, 0));
    this.scene.add(this.arm);
  }

  /** Stand farther back on stages squarer than 16:10, so the chassis stays in view. */
  protected resized(aspect: number) {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    offset.setLength(aspect < 1.4 ? 5.6 : 4.7);
    this.camera.position.copy(target).add(offset);
  }

  protected themed() {
    const dark = this.dark;
    (this.chassis.material as THREE.MeshStandardMaterial).color.copy(this.ink('tray'));
    const disc = this.disc.material as THREE.MeshStandardMaterial;
    disc.color.copy(dark ? new THREE.Color(0x56607a) : this.ink('muted').lerp(new THREE.Color(0xffffff), 0.35));
    const line = this.ink(dark ? 'ink-2' : 'line');
    for (const ring of this.rings) {
      const m = ring.material as THREE.MeshBasicMaterial;
      m.color.copy(line);
      m.opacity = dark ? 0.35 : 0.7;
    }
    (this.index.material as THREE.MeshBasicMaterial).color.copy(this.ink('ink-2'));
    for (const part of this.armParts) (part.material as THREE.MeshStandardMaterial).color.copy(dark ? new THREE.Color(0x9aa6c2) : this.ink('ink-2'));
    this.inks = { pending: this.ink('bit-3'), reading: this.ink('spark'), done: this.ink('good') };
    const glow = this.headGlow.material as THREE.SpriteMaterial;
    glow.color.copy(this.inks.reading);
    glow.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    glow.opacity = dark ? 0.9 : 0.5;
    glow.needsUpdate = true;
    this.blocks.forEach((_, i) => this.paint(i));
  }

  private paint(i: number) {
    const state = this.blockState[i];
    const material = this.blocks[i].material as THREE.MeshBasicMaterial;
    material.color.copy(this.inks[state]);
    material.opacity = state === 'done' ? 0.55 : 1;
  }

  /** The disk's own clock: it never stops spinning, whether or not there is work. */
  now() {
    return performance.now() / SLOW;
  }

  /** Mark the sectors to read and start the arm on them. `ops` must be timed from `now()`. */
  run(ops: Op[], rest: number) {
    for (const block of this.blocks) {
      this.platter.remove(block);
      block.geometry.dispose();
      (block.material as THREE.Material).dispose();
    }
    this.ticketLabels.forEach((el) => el.remove());
    this.ops = ops;
    this.rest = rest;
    this.runStart = ops[0]?.seekStart ?? this.now();
    // A sector is the same patch of platter however many times it is asked for, so draw each once.
    const seen = new Map<string, number>();
    this.blocks = [];
    this.blockState = [];
    this.ticketLabels = [];
    ops.forEach((op) => {
      const key = `${op.track}:${op.sector}`;
      if (seen.has(key)) return;
      seen.set(key, this.blocks.length);
      const r = trackRadius(op.track);
      const block = new THREE.Mesh(
        new THREE.RingGeometry(r - TRACK_WIDTH * 0.42, r + TRACK_WIDTH * 0.42, 6, 1, op.sector * SECTOR_ANGLE + 0.012, SECTOR_ANGLE - 0.024),
        new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
      );
      block.rotation.x = -Math.PI / 2;
      block.position.y = PLATTER_H / 2 + 0.002;
      this.platter.add(block);
      this.blocks.push(block);
      this.blockState.push('pending');
      this.paint(this.blocks.length - 1);
    });
    // Number the reads in the order they will be served, unless there are too many to read.
    if (ops.length <= 10) {
      this.ticketLabels = ops.map((_, i) => {
        const el = this.label('disk-ticket');
        el.textContent = String(i + 1);
        return el;
      });
    }
    this.blockOf = ops.map((op) => seen.get(`${op.track}:${op.sector}`)!);
    this.kick();
  }

  protected frame() {
    const end = this.ops.at(-1)?.readEnd ?? 0;
    // With reduced motion nothing turns: the figure shows the finished run.
    this.t = this.options.reducedMotion ? end : this.now();
    this.platter.rotation.y = platterAngle(this.t);
    this.arm.rotation.y = armAt(this.ops, this.t, this.rest);

    const { index, phase } = phaseAt(this.ops, this.t);
    const states = this.blocks.map(() => 'pending' as 'pending' | 'reading' | 'done');
    this.ops.forEach((op, i) => {
      if (this.t >= op.readEnd) states[this.blockOf[i]] = 'done';
    });
    if (phase === 'read') states[this.blockOf[index]] = 'reading';
    states.forEach((state, b) => {
      if (this.blockState[b] === state) return;
      this.blockState[b] = state;
      this.paint(b);
    });
    this.headGlow.visible = phase === 'read';
    this.phaseLabel.textContent = phaseText[phase];
    this.phaseLabel.dataset.phase = phase;

    const elapsed = this.ops.length ? Math.max(0, Math.min(this.t, end) - this.runStart) : 0;
    this.clock.innerHTML = this.ops.length ? `<b>${elapsed.toFixed(1)} ms</b><small>disk time, slowed ${SLOW}×</small>` : '';
    this.opts.onTime?.(Math.min(this.t, end));
  }

  protected placeLabels() {
    const tip = new THREE.Vector3(ARM, 0, 0);
    this.arm.localToWorld(tip);
    this.pin(this.phaseLabel, tip.setY(TOP + 0.22));
    this.clock.style.transform = '';
    const turn = platterAngle(this.t);
    this.ticketLabels.forEach((el, i) => {
      const op = this.ops[i];
      const angle = (op.sector + 0.5) * SECTOR_ANGLE + turn;
      const r = trackRadius(op.track);
      this.pin(el, to3(r * Math.cos(angle), r * Math.sin(angle), TOP + 0.03));
      el.style.opacity = this.blockState[this.blockOf[i]] === 'done' ? '0.35' : '1';
    });
  }
}
