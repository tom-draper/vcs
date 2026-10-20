// The WebGL half of <CacheHierarchy>. The levels stand in a row leading away
// from the core, farther for slower, and each read is drawn as a request
// travelling out and a whole line travelling back.
//
// There are two layouts. The compact one fits every level on screen. The scaled
// one puts each level at a distance proportional to its latency, so RAM ends up
// sixty times farther than L1, seen side on so the distances stay true.
import * as THREE from 'three';
import { levels, RAM, RAM_LINES, WORDS_PER_LINE, type Read } from './cache-hierarchy';
import { ease, glowTexture, PlateScene, Trail, type PlateOptions } from './plate-scene';

interface Options extends Omit<PlateOptions, 'fov' | 'autoRotate'> {
  onPick?: (word: number) => void;
}

const CORE_X = -5.8;
// Compact positions, and units of distance per cycle when drawn to scale.
const stations = [
  { x: -3.9, cols: 1 },
  { x: -2.1, cols: 1 },
  { x: 0.3, cols: 2 },
  { x: 4.6, cols: 4 },
];
const UNITS_PER_CYCLE = 1;
// Drawn to scale, every object grows by this much so it stays legible.
const SCALED_SIZE = 6;
const CORE_HALF = 0.45;
const CELL = { w: 0.17, h: 0.11, d: 0.24, gap: 0.035 };
const BAR_W = WORDS_PER_LINE * (CELL.w + CELL.gap);
const COL_W = BAR_W + 0.18;
const ROW_D = 0.36;
const FLY_Y = 0.75;
const LAYOUT_MS = 1800;
const DIAL_TICKS = 48;
// The direction the camera looks from, relative to the middle of the row.
const VIEW = new THREE.Vector3(-0.25, 0.5, 0.83).normalize();

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

interface Station {
  group: THREE.Group;
  compactX: number;
  scaledX: number;
  halfWidth: number;
  label: HTMLElement;
  labelZ: number;
}

interface Slot {
  /** Relative to its station. */
  origin: THREE.Vector3;
  station: number;
  cells: THREE.Mesh[];
  line: number | null;
}

interface Flight {
  read: Read;
  start: number;
  out: number;
  back: number;
  filled: Set<number>;
  done: () => void;
}

interface Pose {
  target: THREE.Vector3;
  position: THREE.Vector3;
  fov: number;
}

export class CacheScene extends PlateScene {
  private stations: Station[] = [];
  private slots: Slot[][] = [];
  private cells: THREE.Mesh[] = [];
  private glow = glowTexture();
  private packet = new THREE.Group();
  private packetCore: THREE.Mesh;
  private packetHalo: THREE.Sprite;
  private bar = new THREE.Group();
  private trail: Trail;
  private flight?: Flight;
  private speed = 1;
  private hover: number | null = null;
  private hoverLabel: HTMLElement;
  private status: HTMLElement;
  private clock: HTMLElement;
  private clockShownUntil = 0;
  private coreGroup = new THREE.Group();
  private core: THREE.Mesh;
  private coreEdges: THREE.LineSegments;
  private coreLabel: HTMLElement;
  private bus: THREE.Mesh;
  private trays: THREE.Mesh[] = [];
  private trayEdges: THREE.LineSegments[] = [];
  private dial: THREE.Mesh[] = [];
  private lineInks: THREE.Color[] = [];
  private levelInks: THREE.Color[] = [];
  private empty = new THREE.Color();

  /** 0 is the compact row, 1 is drawn to scale. */
  private layout = 0;
  private scaled = false;
  private layoutFrom = 0;
  private layoutStart = -1e9;
  private poseFrom?: Pose;
  private aspect = 2;
  /** How much objects are magnified, following the layout. */
  private size = 1;

  constructor(host: HTMLElement, labelLayer: HTMLElement, options: Options) {
    super(host, labelLayer, { ...options, autoRotate: false, fov: [34, 40] });

    this.camera.far = 400;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = 1.4;
    this.key.position.set(-6, 10, 6);
    this.key.target.position.set(-1, 0, 0);
    const shadow = this.key.shadow.camera;
    shadow.left = -10;
    shadow.right = 10;
    shadow.top = 6;
    shadow.bottom = -6;
    shadow.updateProjectionMatrix();

    this.bus = new THREE.Mesh(new THREE.BoxGeometry(1, 0.012, 0.05), new THREE.MeshBasicMaterial());
    this.coreGroup.position.x = CORE_X;
    this.scene.add(this.bus, this.coreGroup);
    ({ core: this.core, edges: this.coreEdges } = this.buildCore());
    this.coreLabel = this.label('cache-level', '<b>Core</b>');
    this.buildDial();
    stations.forEach((station, level) => this.buildStation(station, level));

    this.packetCore = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 12), new THREE.MeshBasicMaterial());
    this.packetHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, depthWrite: false }));
    this.packetHalo.scale.setScalar(0.8);
    this.packet.add(this.packetCore, this.packetHalo);
    this.packet.visible = false;

    const cellGeometry = new THREE.BoxGeometry(CELL.w, CELL.h, CELL.d);
    for (let i = 0; i < WORDS_PER_LINE; i++) {
      const cell = new THREE.Mesh(cellGeometry, new THREE.MeshStandardMaterial({ roughness: 0.4 }));
      cell.position.x = (i - (WORDS_PER_LINE - 1) / 2) * (CELL.w + CELL.gap);
      cell.castShadow = true;
      this.bar.add(cell);
    }
    this.bar.visible = false;
    this.scene.add(this.packet, this.bar);
    this.trail = new Trail(this.scene, this.glow, 0.34, 18);

    // The status line sits in a corner of the stage rather than in the scene.
    this.status = this.label('cache-status', '');
    this.hoverLabel = this.label('cache-hover', '');
    this.hoverLabel.hidden = true;
    this.clock = this.label('cache-clock idle', '');

    if (options.interactive) {
      this.listenForPicks<number>(
        () => this.cells,
        (word) => options.onPick?.(word),
        (word) => (this.hover = word),
      );
    }
    this.ready();
  }

  private label(className: string, html: string) {
    const el = document.createElement('span');
    el.className = className;
    el.innerHTML = html;
    this.labelLayer.append(el);
    return el;
  }

  private buildCore() {
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.22, 0.9),
      new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.3 }),
    );
    core.position.y = 0.11;
    core.castShadow = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(core.geometry), new THREE.LineBasicMaterial());
    core.add(edges);
    this.coreGroup.add(core);
    return { core, edges };
  }

  /** A ring of ticks round the core that fills while it waits for data. */
  private buildDial() {
    const geometry = new THREE.BoxGeometry(0.035, 0.02, 0.12);
    for (let i = 0; i < DIAL_TICKS; i++) {
      const angle = (i / DIAL_TICKS) * Math.PI * 2 - Math.PI / 2;
      const tick = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true }));
      tick.position.set(Math.cos(angle) * 0.85, 0.01, Math.sin(angle) * 0.85);
      tick.rotation.y = -angle + Math.PI / 2;
      this.coreGroup.add(tick);
      this.dial.push(tick);
    }
  }

  private buildStation({ x, cols }: (typeof stations)[number], level: number) {
    const count = levels[level].lines;
    const rows = Math.ceil(count / cols);
    const width = cols * COL_W + 0.2;
    const depth = rows * ROW_D + 0.25;
    const group = new THREE.Group();
    group.position.x = x;
    this.scene.add(group);

    const tray = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), new THREE.MeshStandardMaterial({ roughness: 0.85 }));
    tray.receiveShadow = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tray.geometry), new THREE.LineBasicMaterial());
    tray.add(edges);
    group.add(tray);
    this.trays.push(tray);
    this.trayEdges.push(edges);

    const geometry = new THREE.BoxGeometry(CELL.w, CELL.h, CELL.d);
    const slots: Slot[] = [];
    for (let slot = 0; slot < count; slot++) {
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const origin = new THREE.Vector3((col - (cols - 1) / 2) * COL_W, 0.03 + CELL.h / 2, (row - (rows - 1) / 2) * ROW_D);
      const cells = Array.from({ length: WORDS_PER_LINE }, (_, i) => {
        const cell = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.4, transparent: true }));
        cell.position.copy(origin).setX(origin.x + (i - (WORDS_PER_LINE - 1) / 2) * (CELL.w + CELL.gap));
        cell.userData.flash = -1e9;
        cell.castShadow = true;
        group.add(cell);
        this.cells.push(cell);
        return cell;
      });
      slots.push({ origin, station: level, cells, line: level === RAM ? slot : null });
    }
    this.slots.push(slots);

    const { name, cycles } = levels[level];
    this.stations.push({
      group,
      compactX: x,
      // Measured from the edge of the core, so the magnified near levels clear it.
      scaledX: CORE_X + CORE_HALF * SCALED_SIZE + cycles * UNITS_PER_CYCLE,
      halfWidth: width / 2,
      label: this.label('cache-level', `<b>${name}</b><small>${cycles} cycles</small>`),
      labelZ: depth / 2 + 0.4,
    });
  }

  protected themed() {
    const dark = this.dark;
    this.lineInks = [1, 2, 3].map((i) => this.ink(`bit-${i}`));
    this.levelInks = [0, 1, 2, 3].map((i) => this.ink(`lvl-${i}`));
    this.empty = this.ink('muted');
    const line = this.ink('line');
    const ink = this.ink('ink');
    (this.bus.material as THREE.MeshBasicMaterial).color.copy(dark ? line.clone().lerp(ink, 0.25) : line);
    for (const tray of this.trays) {
      (tray.material as THREE.MeshStandardMaterial).color.copy(this.ink('tray'));
    }
    for (const edges of this.trayEdges) (edges.material as THREE.LineBasicMaterial).color.copy(line);
    const core = this.core.material as THREE.MeshStandardMaterial;
    core.color.copy(dark ? new THREE.Color(0x2b3657) : ink);
    core.emissive.set(dark ? 0x9fb4ff : 0x000000);
    (this.coreEdges.material as THREE.LineBasicMaterial).color.copy(dark ? ink : line);

    const spark = this.ink('spark');
    (this.packetCore.material as THREE.MeshBasicMaterial).color.copy(dark ? new THREE.Color(3, 3, 3) : spark);
    const halo = this.packetHalo.material as THREE.SpriteMaterial;
    halo.color.copy(spark);
    halo.opacity = dark ? 0.8 : 0.3;
    halo.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    halo.needsUpdate = true;
    this.trail.paint(spark, dark);

    for (const slots of this.slots) for (const slot of slots) this.paint(slot, slot.line);
  }

  private lineInk(line: number) {
    const t = (line / (RAM_LINES - 1)) * (this.lineInks.length - 1);
    const i = Math.min(Math.floor(t), this.lineInks.length - 2);
    return this.lineInks[i].clone().lerp(this.lineInks[i + 1], t - i);
  }

  private paint(slot: Slot, line: number | null) {
    slot.line = line;
    const ink = line === null ? this.empty : this.lineInk(line);
    slot.cells.forEach((cell, i) => {
      const material = cell.material as THREE.MeshStandardMaterial;
      material.color.copy(ink);
      material.emissive.copy(ink);
      material.opacity = line === null ? 0.35 : 1;
      cell.userData.pick = line === null ? undefined : line * WORDS_PER_LINE + i;
      cell.userData.base = line === null ? 0 : this.dark ? 0.3 : 0.05;
    });
  }

  private flash(slot: Slot, word: number, now: number) {
    for (const cell of slot.cells) cell.userData.flash = cell.userData.pick === word ? now : now - 250;
  }

  private world(slot: Slot) {
    return slot.origin.clone().multiplyScalar(this.size).add(this.stations[slot.station].group.position);
  }

  private corePoint() {
    return new THREE.Vector3(CORE_X, FLY_Y * this.size, 0);
  }

  /** Finish any read still in the air, so the picture never falls behind the model. */
  private settle() {
    const f = this.flight;
    if (!f) return;
    this.land(f.read, performance.now());
    f.done();
  }

  /** Empty every cache, keeping RAM as it is. */
  clear() {
    this.settle();
    this.packet.visible = this.bar.visible = false;
    this.slots.slice(0, RAM).forEach((slots) => slots.forEach((slot) => this.paint(slot, null)));
    this.status.textContent = '';
    this.kick();
  }

  /** Switch between the compact row and the row drawn to scale. */
  setScaled(scaled: boolean) {
    if (scaled === this.scaled) return;
    this.scaled = scaled;
    this.layoutFrom = this.layout;
    this.layoutStart = this.options.reducedMotion ? -1e9 : performance.now();
    this.poseFrom = {
      target: this.controls.target.clone(),
      position: this.camera.position.clone(),
      fov: this.camera.fov,
    };
    this.kick();
  }

  /** Animate one read. Resolves when the line has reached the core. */
  play(read: Read, instant: boolean, fast: boolean): Promise<void> {
    this.settle();
    this.speed = fast ? 4 : 1;
    this.status.innerHTML = `Reading word <b>${read.word}</b>`;
    if (instant || this.options.reducedMotion) {
      this.land(read, performance.now());
      this.kick();
      return Promise.resolve();
    }
    // Compact, time follows latency. To scale, distance already does, so the
    // request flies at a steady speed.
    const time = this.scaled
      ? Math.max(160, (Math.abs(this.world(this.slots[read.servedBy][read.slot]).x - CORE_X) / 48) * 1000)
      : 120 + read.cycles * 1.6;
    return new Promise((done) => {
      this.flight = {
        read,
        start: performance.now(),
        out: time / this.speed,
        back: time / this.speed,
        filled: new Set(),
        done: () => {
          this.flight = undefined;
          done();
        },
      };
      this.kick();
    });
  }

  /** Apply a read's copies all at once. */
  private land(read: Read, now: number) {
    this.flash(this.slots[read.servedBy][read.slot], read.word, now);
    for (const fill of read.fills) {
      const slot = this.slots[fill.level][fill.slot];
      this.paint(slot, read.line);
      this.flash(slot, read.word, now);
    }
    this.finish(read, now);
  }

  private finish(read: Read, now: number) {
    this.core.userData.flash = now;
    this.status.innerHTML = `Word <b>${read.word}</b> from ${levels[read.servedBy].name}, ${read.cycles} cycles`;
    this.packet.visible = this.bar.visible = false;
    this.showClock(read, 1);
    this.clockShownUntil = now + 1400;
  }

  private showClock(read: Read, done: number) {
    const cycles = Math.round(read.cycles * done);
    this.clock.innerHTML = `<b>${cycles}</b><small>cycles waiting</small>`;
    this.clock.classList.remove('idle');
    const lit = Math.round(DIAL_TICKS * Math.min(1, read.cycles / levels[RAM].cycles) * done);
    const ink = this.levelInks[read.servedBy];
    this.dial.forEach((tick, i) => {
      const material = tick.material as THREE.MeshBasicMaterial;
      material.color.copy(i < lit ? ink : this.empty);
      material.opacity = i < lit ? 1 : 0.35;
    });
  }

  private compactPose(): Pose {
    const target = new THREE.Vector3(-0.4, 0, -1);
    const fov = this.aspect < 1 ? this.options.fov[1] : this.options.fov[0];
    const row = stations[RAM].x - CORE_X + 8;
    const distance = Math.max(11, row / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * this.aspect));
    return { target, position: target.clone().addScaledVector(VIEW, distance), fov };
  }

  /**
   * From above, far enough back to take in the whole row. Looking along it
   * would foreshorten the distances, which are the point, and looking from the
   * side would show the trays edge on.
   */
  private scaledPose(): Pose {
    const fov = this.aspect < 1 ? this.options.fov[1] : this.options.fov[0];
    const ram = this.stations[RAM];
    const left = CORE_X - (CORE_HALF + 2.4) * SCALED_SIZE;
    const right = ram.scaledX + (ram.halfWidth + 0.3) * SCALED_SIZE;
    const target = new THREE.Vector3((left + right) / 2, 0, 0.8 * SCALED_SIZE);
    const distance = (right - left) / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * this.aspect);
    const view = new THREE.Vector3(0, 1, 0.42).normalize();
    return { target, position: target.clone().addScaledVector(view, distance), fov };
  }

  protected resized(aspect: number) {
    this.aspect = aspect;
    const pose = this.scaled ? this.scaledPose() : this.compactPose();
    this.controls.target.copy(pose.target);
    this.camera.position.copy(pose.position);
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
  }

  protected frame(now: number) {
    this.moveLayout(now);
    const f = this.flight;
    let moving: THREE.Vector3 | null = null;
    if (f) {
      const t = now - f.start;
      const { read } = f;
      const from = this.corePoint();
      const to = this.world(this.slots[read.servedBy][read.slot]).setY(FLY_Y * this.size);
      const total = f.out + f.back;
      if (this.isRunning) this.showClock(read, Math.min(1, t / total));
      if (t < f.out) {
        this.packet.visible = true;
        this.packet.position.lerpVectors(from, to, ease(t / f.out));
        moving = this.packet.position;
      } else {
        if (!f.filled.has(-1)) {
          // The request arrives: the level that holds the line lights up.
          f.filled.add(-1);
          this.flash(this.slots[read.servedBy][read.slot], read.word, now);
          this.packet.visible = false;
          this.bar.visible = true;
          const ink = this.lineInk(read.line);
          const spark = this.dark ? new THREE.Color(0xffffff) : this.ink('spark');
          this.bar.children.forEach((child, i) => {
            const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
            const wanted = read.line * WORDS_PER_LINE + i === read.word;
            material.color.copy(wanted ? spark : ink);
            material.emissive.copy(wanted ? spark : ink);
            material.emissiveIntensity = this.dark ? (wanted ? 1.6 : 0.5) : wanted ? 0.4 : 0.05;
          });
        }
        const u = Math.min(1, (t - f.out) / f.back);
        this.bar.position.lerpVectors(to, from, ease(u));
        moving = this.bar.position;
        // Drop a copy into each faster level as the line passes over it.
        for (const fill of read.fills) {
          if (f.filled.has(fill.level)) continue;
          if (this.bar.position.x <= this.stations[fill.level].group.position.x + 0.2 * this.size) {
            f.filled.add(fill.level);
            const slot = this.slots[fill.level][fill.slot];
            this.paint(slot, read.line);
            this.flash(slot, read.word, now);
          }
        }
        if (u === 1) {
          this.finish(read, now);
          f.done();
        }
      }
    }
    this.trail.follow(moving ? moving.clone() : null);
    if (!f && now > this.clockShownUntil) {
      this.clock.classList.add('idle');
      for (const tick of this.dial) {
        const material = tick.material as THREE.MeshBasicMaterial;
        material.opacity += (0.35 - material.opacity) * 0.08;
        material.color.lerp(this.empty, 0.08);
      }
    }

    for (const cell of this.cells) {
      const material = cell.material as THREE.MeshStandardMaterial;
      const glow = Math.max(0, 1 - (now - cell.userData.flash) / 600);
      material.emissiveIntensity = cell.userData.base + glow * (this.dark ? 1.8 : 0.5);
      const lift = cell.userData.pick !== undefined && cell.userData.pick === this.hover ? 1.4 : 1;
      cell.scale.set(lift, lift + glow * 0.8, lift);
    }
    const coreGlow = Math.max(0, 1 - (now - (this.core.userData.flash ?? -1e9)) / 700);
    (this.core.material as THREE.MeshStandardMaterial).emissiveIntensity = this.dark ? 0.15 + coreGlow * 1.2 : 0;
    this.core.scale.y = 1 + coreGlow * 0.4;
    this.trail.size = 0.34 * this.size;
  }

  private moveLayout(now: number) {
    const target = this.scaled ? 1 : 0;
    const t = smooth((now - this.layoutStart) / LAYOUT_MS);
    this.layout = this.layoutFrom + (target - this.layoutFrom) * t;
    this.size = 1 + (SCALED_SIZE - 1) * this.layout;
    this.stations.forEach((station) => {
      station.group.position.x = station.compactX + (station.scaledX - station.compactX) * this.layout;
      station.group.scale.setScalar(this.size);
    });
    this.coreGroup.scale.setScalar(this.size);
    this.packet.scale.setScalar(this.size);
    this.bar.scale.setScalar(this.size);
    const end = this.stations[RAM].group.position.x;
    this.bus.scale.set(end - CORE_X, this.size, this.size);
    this.bus.position.set((end + CORE_X) / 2, 0, 0);

    // Fly the camera between the two views while the levels move.
    if (this.poseFrom && t < 1) {
      const to = this.scaled ? this.scaledPose() : this.compactPose();
      const k = smooth(t * 1.1);
      this.controls.target.lerpVectors(this.poseFrom.target, to.target, k);
      this.camera.position.lerpVectors(this.poseFrom.position, to.position, k);
      this.camera.fov = this.poseFrom.fov + (to.fov - this.poseFrom.fov) * k;
      this.camera.updateProjectionMatrix();
      this.controls.enabled = false;
    } else if (this.poseFrom) {
      this.poseFrom = undefined;
      this.controls.enabled = true;
    }
  }

  protected placeLabels() {
    this.pin(this.coreLabel, new THREE.Vector3(CORE_X, 0, 1.15 * this.size));
    this.pin(this.clock, new THREE.Vector3(CORE_X, 1.25 * this.size, 0));
    // Drawn to scale, the core and the first two levels crowd together, so
    // alternate labels move above the row.
    this.stations.forEach((station, i) => {
      const z = this.pin(station.label, station.group.position.clone().setZ(station.labelZ * this.size));
      station.label.style.visibility = z < 1 ? '' : 'hidden';
      station.label.classList.toggle('raised', this.layout > 0.5 && i % 2 === 0);
    });
    const hovered = this.cells.find((c) => c.userData.pick === this.hover);
    this.hoverLabel.hidden = !hovered;
    if (hovered) {
      const word = this.hover!;
      this.hoverLabel.textContent = `Read word ${word}, line ${Math.floor(word / WORDS_PER_LINE)}`;
      this.pin(this.hoverLabel, hovered.getWorldPosition(new THREE.Vector3()).setY(0.55 * this.size));
    }
  }
}
