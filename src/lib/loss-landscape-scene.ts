// The WebGL half of <LossLandscape>. The loss is a surface, banded by height
// like a contour map, and each ball rolls downhill on it, leaving a trail.
import * as THREE from 'three';
import { EXTENT, loss, minima, step, type Ball, type Method } from './loss-landscape';
import { PlateScene, type PlateOptions } from './plate-scene';

interface Options extends Omit<PlateOptions, 'fov'> {
  /** A click on the surface, in model coordinates. */
  onPick?: (x: number, y: number) => void;
  /** Called after every step while balls are moving, and once more when all have stopped. */
  onProgress?: (moving: boolean) => void;
}

const SEGMENTS = 150;
const LIFT = 0.6;
const BANDS = 14;
const STEP_MS = 35;
const RADIUS = 0.075;
const MAX_PATH = 700;

const world = (x: number, y: number, above = 0) => new THREE.Vector3(x, loss(x, y) * LIFT + above, y);

interface Runner {
  ball: Ball;
  mesh: THREE.Mesh;
  line: THREE.Line;
}

export class LossLandscapeScene extends PlateScene {
  private surface: THREE.Mesh;
  private grid: THREE.LineSegments;
  private marks: THREE.Mesh[] = [];
  private labels: HTMLElement[] = [];
  private runners: Runner[] = [];
  private method: Method = 'plain';
  private rate = 0.18;
  private lastStep = 0;
  private moving = false;
  private ballGeometry = new THREE.SphereGeometry(RADIUS, 24, 14);
  private low = new THREE.Color();
  private high = new THREE.Color();
  private inks = { ball: new THREE.Color(), good: new THREE.Color(), warn: new THREE.Color(), bad: new THREE.Color() };
  private pointer = new THREE.Raycaster();
  private opts: Options;

  constructor(host: HTMLElement, labelLayer: HTMLElement, options: Options) {
    super(host, labelLayer, { ...options, fov: [30, 40] });
    this.opts = options;
    this.camera.position.set(5.6, 5.4, 6.4);
    this.controls.target.set(0, -0.25, 0);
    this.controls.minDistance = 4;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = 1.35;
    this.key.position.set(-4, 9, 3);
    const shadow = this.key.shadow.camera;
    shadow.left = shadow.bottom = -4.5;
    shadow.right = shadow.top = 4.5;
    shadow.far = 30;
    shadow.updateProjectionMatrix();

    this.surface = this.buildSurface();
    this.grid = this.buildGrid();
    this.scene.add(this.surface, this.grid);

    minima.forEach((m) => {
      const mark = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.15, 32), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      mark.rotation.x = -Math.PI / 2;
      mark.position.copy(world(m.x, m.y, 0.012));
      this.scene.add(mark);
      this.marks.push(mark);
      const label = document.createElement('span');
      label.className = `ll-label${m.rank === 0 ? ' best' : ''}`;
      label.textContent = m.rank === 0 ? 'lowest point' : 'local minimum';
      labelLayer.append(label);
      this.labels.push(label);
    });

    if (options.interactive) this.listenForSurfaceClicks();
    this.ready();
  }

  private buildSurface() {
    const geometry = new THREE.PlaneGeometry(2 * EXTENT, 2 * EXTENT, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      position.setY(i, loss(position.getX(i), position.getZ(i)) * LIFT);
    }
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(position.count * 3), 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }));
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Grid lines draped over the surface, so its shape reads from any angle. */
  private buildGrid() {
    const points: THREE.Vector3[] = [];
    const lines = 12;
    const samples = 90;
    for (let l = 0; l <= lines; l++) {
      const fixed = -EXTENT + (l / lines) * 2 * EXTENT;
      for (let s = 0; s < samples; s++) {
        const a = -EXTENT + (s / samples) * 2 * EXTENT;
        const b = -EXTENT + ((s + 1) / samples) * 2 * EXTENT;
        points.push(world(a, fixed, 0.006), world(b, fixed, 0.006));
        points.push(world(fixed, a, 0.006), world(fixed, b, 0.006));
      }
    }
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }),
    );
  }

  protected themed() {
    const dark = this.dark;
    this.low = this.ink('bit-1');
    this.high = this.dark ? this.ink('tray') : this.ink('muted');
    this.inks = { ball: this.ink('spark'), good: this.ink('good'), warn: this.ink('warn'), bad: this.ink('bad') };

    // Colour by height in flat bands, so equal heights read as contour lines.
    const geometry = this.surface.geometry;
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const color = geometry.attributes.color as THREE.BufferAttribute;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < position.count; i++) {
      lo = Math.min(lo, position.getY(i));
      hi = Math.max(hi, position.getY(i));
    }
    const c = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const t = (position.getY(i) - lo) / (hi - lo);
      const band = Math.min(BANDS - 1, Math.floor(t * BANDS));
      c.copy(this.low).lerp(this.high, Math.pow(band / (BANDS - 1), 0.8));
      if (band % 2) c.multiplyScalar(dark ? 1.15 : 0.9);
      if (dark) c.multiplyScalar(0.8);
      color.setXYZ(i, c.r, c.g, c.b);
    }
    color.needsUpdate = true;

    (this.grid.material as THREE.LineBasicMaterial).color.copy(this.ink(dark ? 'ink-2' : 'line'));
    (this.grid.material as THREE.LineBasicMaterial).opacity = dark ? 0.22 : 0.5;
    minima.forEach((m, i) => (this.marks[i].material as THREE.MeshBasicMaterial).color.copy(m.rank === 0 ? this.inks.good : this.ink('ink-2')));
    for (const runner of this.runners) this.paint(runner);
  }

  private paint({ ball, mesh, line }: Runner) {
    const ink = !ball.done ? this.inks.ball : ball.basin === 0 ? this.inks.good : ball.basin === -1 ? this.inks.bad : this.inks.warn;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.copy(ink);
    material.emissive.copy(ink).multiplyScalar(this.dark ? 0.6 : 0);
    (line.material as THREE.LineBasicMaterial).color.copy(ink);
  }

  private listenForSurfaceClicks() {
    const canvas = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (event) => (down = { x: event.clientX, y: event.clientY }));
    canvas.addEventListener('pointerup', (event) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.setFromCamera(
        new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1),
        this.camera,
      );
      const hit = this.pointer.intersectObject(this.surface)[0];
      if (hit) this.opts.onPick?.(hit.point.x, hit.point.z);
    });
  }

  /** Replace the balls on the surface, and how they move. */
  set(balls: Ball[], method: Method, rate: number) {
    this.method = method;
    this.rate = rate;
    for (const runner of this.runners) {
      this.scene.remove(runner.mesh, runner.line);
      (runner.mesh.material as THREE.Material).dispose();
      runner.line.geometry.dispose();
      (runner.line.material as THREE.Material).dispose();
    }
    this.runners = balls.map((ball) => {
      const mesh = new THREE.Mesh(this.ballGeometry, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1 }));
      mesh.castShadow = true;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PATH * 3), 3));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8 }));
      const runner = { ball, mesh, line };
      this.scene.add(mesh, line);
      this.paint(runner);
      this.trace(runner);
      return runner;
    });
    this.moving = balls.some((b) => !b.done);
    this.lastStep = performance.now();
    // Without motion, show where every ball ends up straight away.
    if (this.options.reducedMotion) {
      while (this.advance());
      this.opts.onProgress?.(false);
    }
    this.kick();
  }

  /** Adds one more ball without disturbing the others. */
  add(ball: Ball) {
    this.set([...this.runners.map((r) => r.ball), ball], this.method, this.rate);
  }

  /** Steps every moving ball once. Returns whether any are still moving. */
  private advance() {
    let any = false;
    for (const runner of this.runners) {
      if (runner.ball.done) continue;
      step(runner.ball, this.method, this.rate);
      this.trace(runner);
      if (runner.ball.done) this.paint(runner);
      else any = true;
    }
    this.moving = any;
    return any;
  }

  /** Copy the ball's path onto its line. */
  private trace({ ball, line }: Runner) {
    const position = line.geometry.attributes.position as THREE.BufferAttribute;
    const count = Math.min(ball.path.length, MAX_PATH);
    for (let i = 0; i < count; i++) {
      const [x, y] = ball.path[ball.path.length - count + i];
      const p = world(x, y, 0.02);
      position.setXYZ(i, p.x, p.y, p.z);
    }
    position.needsUpdate = true;
    line.geometry.setDrawRange(0, count);
  }

  protected frame(now: number) {
    if (this.moving && now - this.lastStep >= STEP_MS) {
      // Catch up on slow frames, so the balls keep time even when drawing doesn't.
      const due = Math.min(8, Math.floor((now - this.lastStep) / STEP_MS));
      this.lastStep = due === 8 ? now : this.lastStep + due * STEP_MS;
      let still = true;
      for (let i = 0; i < due && still; i++) still = this.advance();
      this.opts.onProgress?.(still);
    }
    // Ease each ball from its last position to its newest, so the motion is smooth.
    const t = this.moving ? Math.min(1, (now - this.lastStep) / STEP_MS) : 1;
    for (const { ball, mesh } of this.runners) {
      const [x1, y1] = ball.path.at(-1)!;
      const [x0, y0] = ball.done ? [x1, y1] : (ball.path.at(-2) ?? [x1, y1]);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      mesh.position.copy(world(x, y, RADIUS));
    }
  }

  /** Stand farther back on square or tall stages, keeping whatever angle the reader has turned to. */
  protected resized(aspect: number) {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    offset.setLength(aspect < 1.3 ? 12.5 : 10);
    this.camera.position.copy(target).add(offset);
  }

  protected placeLabels() {
    minima.forEach((m, i) => {
      const z = this.pin(this.labels[i], world(m.x, m.y, 0.35));
      this.labels[i].style.opacity = z > 1 ? '0' : '1';
    });
  }

  dispose() {
    super.dispose();
    this.surface.geometry.dispose();
    this.grid.geometry.dispose();
    this.ballGeometry.dispose();
  }
}
