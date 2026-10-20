// The WebGL half of <CoordinateSpaces>. Three houses and a camera move through
// model, world, view, clip and screen space. Every vertex is placed by the
// matrices in graphics.ts, and a change of space slides each vertex from where
// it was to where it now goes.
import * as THREE from 'three';
import { ease, PlateScene, type PlateOptions } from './plate-scene';
import { camera, frustumCorners, house, place, placements, tracked, type Space, type Vec3 } from './graphics';

const MOVE_MS = 1400;

/** Where each space's origin is drawn, after the display shift in `place`. */
const origins: Record<Space, Vec3> = {
  model: [0, 0, 0],
  world: [0, 0, 0],
  view: [0, 0, 3],
  clip: [0, 1, 0],
  screen: [0, 1, 0],
};

interface Shape {
  /** Model-space points, one per drawn vertex. */
  source: Vec3[];
  /** Which house the points belong to, or null for points already in world space. */
  owner: number | null;
  attribute: THREE.BufferAttribute;
  object: THREE.Mesh | THREE.LineSegments;
  /** Whether the shape shows in a space. */
  shows: (space: Space) => boolean;
}

export class SpacesScene extends PlateScene {
  private shapes: Shape[] = [];
  private from: Space = 'model';
  private to: Space = 'model';
  private started = 0;
  private axes: THREE.LineSegments;
  private axisLabels: HTMLElement[] = [];
  private originLabel: HTMLElement;
  private eyeLabel: HTMLElement;
  private dot: THREE.Mesh;

  constructor(host: HTMLElement, labelLayer: HTMLElement, options: Omit<PlateOptions, 'fov'>) {
    super(host, labelLayer, { ...options, fov: [34, 46] });
    this.camera.position.set(5.5, 4.2, 9);
    this.controls.target.set(-0.2, 0.4, -0.6);
    this.controls.minDistance = 5;
    this.controls.maxDistance = 22;
    this.key.position.set(-4, 9, 6);

    const { positions, triangles } = house();
    placements.forEach((_, i) => {
      const source = triangles.flat().map((k) => positions[k]);
      const geometry = new THREE.BufferGeometry();
      const attribute = new THREE.BufferAttribute(new Float32Array(source.length * 3), 3);
      geometry.setAttribute('position', attribute);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.shapes.push({ source, owner: i, attribute, object: mesh, shows: (space) => space !== 'model' || i === 0 });
    });

    // The frustum: near rectangle, far rectangle and the four edges joining them.
    const c = frustumCorners();
    const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    this.addLines(pairs.flatMap(([a, b]) => [c[a], c[b]]), (space) => space !== 'model');
    // The camera itself: lines from the eye to the near corners. The eye goes to infinity in clip space.
    const eye = (at: Vec3) => [0, 1, 2, 3].flatMap((k) => [at, c[k]]);
    this.addLines(eye(camera.eye), (space) => space === 'world' || space === 'view');

    const axisPoints = new Float32Array(18);
    this.axes = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
    this.axes.geometry.setAttribute('position', new THREE.BufferAttribute(axisPoints, 3));
    this.axes.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(18), 3));
    this.scene.add(this.axes);
    ['x', 'y', 'z'].forEach((name, i) => {
      const label = document.createElement('span');
      label.className = `cc-axis b${i + 1}`;
      label.textContent = name;
      labelLayer.append(label);
      this.axisLabels.push(label);
    });
    this.originLabel = this.makeLabel('origin');
    this.eyeLabel = this.makeLabel('camera');

    // A marker on the point the readout follows.
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), new THREE.MeshBasicMaterial());
    this.scene.add(this.dot);

    this.layout(1);
    this.ready();
  }

  private makeLabel(text: string) {
    const label = document.createElement('span');
    label.className = 'sp-label';
    label.textContent = text;
    this.labelLayer.append(label);
    return label;
  }

  private addLines(points: Vec3[], shows: (space: Space) => boolean) {
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(new Float32Array(points.length * 3), 3);
    geometry.setAttribute('position', attribute);
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ transparent: true }));
    this.scene.add(lines);
    this.shapes.push({ source: points, owner: null, attribute, object: lines, shows });
  }

  protected themed() {
    const inks = [this.ink('bit-1'), this.ink('bit-2'), this.ink('bit-3')];
    this.shapes.forEach((shape) => {
      const material = shape.object.material as THREE.MeshStandardMaterial | THREE.LineBasicMaterial;
      if (shape.owner !== null) {
        const m = material as THREE.MeshStandardMaterial;
        m.color.copy(inks[shape.owner]);
        m.emissive.copy(inks[shape.owner]).multiplyScalar(this.dark ? 0.25 : 0);
      } else material.color.copy(this.ink('ink-2'));
    });
    const colours = this.axes.geometry.attributes.color as THREE.BufferAttribute;
    inks.forEach((ink, i) => {
      colours.setXYZ(i * 2, ink.r, ink.g, ink.b);
      colours.setXYZ(i * 2 + 1, ink.r, ink.g, ink.b);
    });
    colours.needsUpdate = true;
    (this.dot.material as THREE.MeshBasicMaterial).color.copy(this.ink('spark'));
  }

  /** Slide everything into another space. */
  go(space: Space) {
    if (space === this.to) return;
    this.from = this.options.reducedMotion ? space : this.to;
    this.to = space;
    this.started = performance.now();
    this.kick();
  }

  get space() {
    return this.to;
  }

  private layout(t: number) {
    const k = ease(Math.min(1, t));
    const lerp = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    for (const shape of this.shapes) {
      shape.source.forEach((p, v) => {
        const [x, y, z] = lerp(place(this.from, p, shape.owner), place(this.to, p, shape.owner));
        shape.attribute.setXYZ(v, x, y, z);
      });
      shape.attribute.needsUpdate = true;
      if (shape.object instanceof THREE.Mesh) shape.object.geometry.computeVertexNormals();
      shape.object.geometry.computeBoundingSphere();
      const a = shape.shows(this.from) ? 1 : 0;
      const b = shape.shows(this.to) ? 1 : 0;
      const opacity = a + (b - a) * k;
      const material = shape.object.material as THREE.Material;
      material.opacity = opacity * (shape.owner === null ? 0.8 : 1);
      // Solid houses only turn transparent while fading, so their back faces never show through.
      const fading = shape.owner === null || opacity < 0.999;
      if (material.transparent !== fading) {
        material.transparent = fading;
        material.needsUpdate = true;
      }
      shape.object.visible = opacity > 0.01;
    }

    const origin = lerp(origins[this.from], origins[this.to]);
    const size = 0.9;
    const axes = this.axes.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 3; i++) {
      axes.setXYZ(i * 2, ...origin);
      const tip: Vec3 = [...origin];
      tip[i] += size;
      axes.setXYZ(i * 2 + 1, ...tip);
    }
    axes.needsUpdate = true;
    this.axes.geometry.computeBoundingSphere();
    this.dot.position.set(...lerp(place(this.from, tracked, 0), place(this.to, tracked, 0)));
  }

  protected frame(now: number) {
    const t = (now - this.started) / MOVE_MS;
    if (t <= 1.05) this.layout(t);
  }

  protected resized(aspect: number) {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    offset.setLength(aspect < 1.4 ? 15 : 11.5);
    this.camera.position.copy(target).add(offset);
  }

  protected placeLabels() {
    const origin = new THREE.Vector3().fromBufferAttribute(this.axes.geometry.attributes.position as THREE.BufferAttribute, 0);
    for (let i = 0; i < 3; i++) {
      const tip = new THREE.Vector3().fromBufferAttribute(this.axes.geometry.attributes.position as THREE.BufferAttribute, i * 2 + 1);
      this.pin(this.axisLabels[i], tip.add(tip.clone().sub(origin).multiplyScalar(0.18)));
    }
    this.pin(this.originLabel, origin.clone().add(new THREE.Vector3(-0.25, -0.25, 0)));
    const showsEye = this.to === 'world' || this.to === 'view';
    const eyeAt = new THREE.Vector3().fromBufferAttribute(this.shapes.at(-1)!.attribute, 0);
    this.pin(this.eyeLabel, eyeAt.add(new THREE.Vector3(0, 0.3, 0)));
    this.eyeLabel.style.opacity = showsEye && performance.now() - this.started > MOVE_MS ? '1' : '0';
    this.originLabel.textContent = this.to === 'view' ? 'origin, at the camera' : this.to === 'clip' || this.to === 'screen' ? 'centre of the view' : 'origin';
  }
}
