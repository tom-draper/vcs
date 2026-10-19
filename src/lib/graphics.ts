// Models for the computer graphics pages: 2D transforms as 3×3 matrices, the
// 4×4 matrices that carry a scene from model space to the screen, a triangle
// rasteriser, a lit sphere and a small ray tracer.
//
// The SVG drawing functions return markup, so the server renders each
// widget's first frame and the browser redraws it with the same code. The
// sphere and the ray tracer write pixels into a buffer for a canvas.

/* ---------- Vectors ---------- */

export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3) => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));
/** A direction mirrored about a surface normal, as light bounces off a mirror. */
export const reflect = (d: Vec3, n: Vec3): Vec3 => sub(d, scale(n, 2 * dot(d, n)));

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const deg = (d: number) => (d * Math.PI) / 180;

/** A number for a matrix cell or readout, without a stray minus sign on zero. */
export function num(value: number, digits = 2): string {
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/* ---------- 2D transforms ---------- */

/** A 3×3 matrix in row-major order, acting on [x, y, 1]. */
export type Mat3 = number[];

export const identity3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  }
  return out;
}

export const apply3 = (m: Mat3, [x, y]: [number, number]): [number, number] => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

export type Op2 = 'scale' | 'rotate' | 'translate';

export interface Transform2 {
  angle: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export function matrixOf(op: Op2, t: Transform2): Mat3 {
  if (op === 'translate') return [1, 0, t.tx, 0, 1, t.ty, 0, 0, 1];
  if (op === 'scale') return [t.sx, 0, 0, 0, t.sy, 0, 0, 0, 1];
  const c = Math.cos(deg(t.angle));
  const s = Math.sin(deg(t.angle));
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** The matrix that applies `order[0]` first. Later steps multiply on the left. */
export const compose2 = (order: Op2[], t: Transform2) => order.reduce((m, op) => mul3(matrixOf(op, t), m), identity3);

/** A capital F: it has no symmetry, so every flip and turn shows. */
export const letterF: [number, number][] = [
  [0, 0], [0, 3], [2, 3], [2, 2.4], [0.6, 2.4], [0.6, 1.8], [1.5, 1.8], [1.5, 1.2], [0.6, 1.2], [0.6, 0],
];

export const transformView = { width: 600, height: 400, unit: 32 };

export function transformSvg(order: Op2[], t: Transform2, view = transformView): string {
  const { width, height, unit } = view;
  const px = (x: number) => width / 2 + x * unit;
  const py = (y: number) => height / 2 - y * unit;
  const parts: string[] = [];
  for (let x = -9; x <= 9; x++) parts.push(`<line class="gx-grid${x === 0 ? ' axis' : ''}" x1="${px(x)}" y1="0" x2="${px(x)}" y2="${height}"/>`);
  for (let y = -6; y <= 6; y++) parts.push(`<line class="gx-grid${y === 0 ? ' axis' : ''}" x1="0" y1="${py(y)}" x2="${width}" y2="${py(y)}"/>`);
  parts.push(`<text class="v-small" x="${width - 10}" y="${py(0) - 9}">x</text>`, `<text class="v-small" x="${px(0) + 10}" y="10">y</text>`);

  const shape = (m: Mat3, className: string) =>
    `<polygon class="${className}" points="${letterF.map((p) => apply3(m, p)).map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ')}"/>`;
  parts.push(shape(identity3, 'gx-shape start'));
  // Number each stage at the corner that started at the origin. Stages that share a corner share a label.
  const labels: { x: number; y: number; text: string[]; last: boolean }[] = [];
  let m = identity3;
  order.forEach((op, i) => {
    m = mul3(matrixOf(op, t), m);
    const last = i === order.length - 1;
    parts.push(shape(m, last ? 'gx-shape end' : 'gx-shape mid'));
    const [x, y] = apply3(m, [0, 0]);
    const same = labels.find((l) => Math.hypot(l.x - x, l.y - y) < 0.3);
    if (same) {
      same.text.push(String(i + 1));
      same.last ||= last;
    } else labels.push({ x, y, text: [String(i + 1)], last });
  });
  for (const l of labels) {
    parts.push(`<text class="gx-step${l.last ? ' end' : ''}" x="${(px(l.x) - 6).toFixed(1)}" y="${(py(l.y) + 10).toFixed(1)}" text-anchor="end">${l.text.join(', ')}</text>`);
  }
  return parts.join('');
}

/* ---------- 3D transforms ---------- */

/** A 4×4 matrix in row-major order, acting on [x, y, z, 1]. */
export type Mat4 = number[];

export const identity4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul4(a: Mat4, b: Mat4): Mat4 {
  const out: Mat4 = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out.push(sum);
    }
  }
  return out;
}

export const translate4 = (x: number, y: number, z: number): Mat4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
export const scale4 = (s: number): Mat4 => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
export function rotateY4(degrees: number): Mat4 {
  const c = Math.cos(deg(degrees));
  const s = Math.sin(deg(degrees));
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

/** The view matrix: moves and turns the world so the camera sits at the origin looking down −z. */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return [x[0], x[1], x[2], -dot(x, eye), y[0], y[1], y[2], -dot(y, eye), z[0], z[1], z[2], -dot(z, eye), 0, 0, 0, 1];
}

/** The OpenGL perspective matrix. Points in view are carried into the cube from −1 to 1 after the divide by w. */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(deg(fovY) / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), (2 * far * near) / (near - far), 0, 0, -1, 0];
}

export function apply4(m: Mat4, [x, y, z]: Vec3, w = 1): [number, number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3] * w,
    m[4] * x + m[5] * y + m[6] * z + m[7] * w,
    m[8] * x + m[9] * y + m[10] * z + m[11] * w,
    m[12] * x + m[13] * y + m[14] * z + m[15] * w,
  ];
}

/* The scene behind <CoordinateSpaces>: three houses and a camera. */

export const SPACES = ['model', 'world', 'view', 'clip', 'screen'] as const;
export type Space = (typeof SPACES)[number];

/** A house: a box with a pitched roof and a chimney, so up, front and side all read. */
export function house(): { positions: Vec3[]; triangles: [number, number, number][] } {
  const positions: Vec3[] = [
    // Box corners, then the two roof ridge ends.
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5],
    [-0.5, 0.7, -0.5], [0.5, 0.7, -0.5], [0.5, 0.7, 0.5], [-0.5, 0.7, 0.5],
    [0, 1.15, -0.5], [0, 1.15, 0.5],
  ];
  const triangles: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2], // floor
    [3, 7, 6], [3, 6, 2], // front
    [1, 5, 4], [1, 4, 0], // back
    [0, 4, 7], [0, 7, 3], // left
    [2, 6, 5], [2, 5, 1], // right
    [7, 9, 6], [4, 5, 8], // gables
    [4, 8, 9], [4, 9, 7], // left roof
    [6, 9, 8], [6, 8, 5], // right roof
  ];
  return { positions, triangles };
}

/** Where each house is put in the world: position, turn and size. */
export const placements: { at: Vec3; turn: number; size: number }[] = [
  { at: [-0.6, 0, -0.2], turn: 30, size: 1 },
  { at: [1.1, 0, -1.4], turn: -20, size: 0.9 },
  { at: [-1.2, 0, -2.9], turn: 60, size: 1 },
];

export const camera = { eye: [0.5, 1.5, 2.6] as Vec3, target: [-0.2, 0.4, -1.4] as Vec3, fov: 46, aspect: 1.5, near: 1.6, far: 6.6 };

export const modelMatrix = (i: number) => {
  const { at, turn, size } = placements[i];
  return mul4(translate4(...at), mul4(rotateY4(turn), scale4(size)));
};
export const viewMatrix = lookAt(camera.eye, camera.target);
export const projectionMatrix = perspective(camera.fov, camera.aspect, camera.near, camera.far);

/** The near and far rectangles of the camera's view, in world space: near first, then far, each counter-clockwise. */
export function frustumCorners(): Vec3[] {
  const inverseView = (p: Vec3): Vec3 => {
    // The view matrix is a rotation then a translation, so its inverse is the transpose applied after undoing the shift.
    const m = viewMatrix;
    const q: Vec3 = [p[0] - m[3], p[1] - m[7], p[2] - m[11]];
    return [m[0] * q[0] + m[4] * q[1] + m[8] * q[2], m[1] * q[0] + m[5] * q[1] + m[9] * q[2], m[2] * q[0] + m[6] * q[1] + m[10] * q[2]];
  };
  const corners: Vec3[] = [];
  for (const d of [camera.near, camera.far]) {
    const h = d * Math.tan(deg(camera.fov) / 2);
    const w = h * camera.aspect;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) corners.push(inverseView([sx * w, sy * h, -d]));
  }
  return corners;
}

/**
 * Where a model-space point of house `i` is drawn in each space. The view and
 * clip spaces are shifted and scaled for display so each stage sits in the
 * same part of the figure; the readouts give the true coordinates.
 */
export function place(space: Space, p: Vec3, i: number | null): Vec3 {
  if (space === 'model') return p;
  const world = i === null ? p : (apply4(modelMatrix(i), p).slice(0, 3) as Vec3);
  if (space === 'world') return world;
  const [vx, vy, vz] = apply4(viewMatrix, world);
  if (space === 'view') return [vx * 0.7, vy * 0.7, vz * 0.7 + 3];
  const [cx, cy, cz, cw] = apply4(projectionMatrix, [vx, vy, vz]);
  const ndc: Vec3 = [cx / cw, cy / cw, cz / cw];
  if (space === 'clip') return [ndc[0] * 1.6 * camera.aspect, ndc[1] * 1.6 + 1, -ndc[2] * 1.6];
  // The screen keeps x and y and squashes depth almost flat, keeping its order so nearer faces still win.
  return [ndc[0] * 1.6 * camera.aspect, ndc[1] * 1.6 + 1, -ndc[2] * 0.04];
}

/** The true coordinates of a model-space point of house `i` in each space, as text for a readout. */
export function coordinates(space: Space, p: Vec3, i: number): string {
  const v3 = (q: number[], digits = 2) => `(${q.map((x) => num(x, digits)).join(', ')})`;
  if (space === 'model') return v3(p);
  const world = apply4(modelMatrix(i), p).slice(0, 3) as Vec3;
  if (space === 'world') return v3(world);
  const view = apply4(viewMatrix, world).slice(0, 3) as Vec3;
  if (space === 'view') return v3(view);
  const [cx, cy, cz, cw] = apply4(projectionMatrix, view);
  if (space === 'clip') return `${v3([cx, cy, cz, cw])} ÷ w = ${v3([cx / cw, cy / cw, cz / cw])}`;
  const [x, y, z] = [cx / cw, cy / cw, cz / cw];
  return `pixel (${Math.round(((x + 1) / 2) * 1500)}, ${Math.round(((1 - y) / 2) * 1000)}) of 1500 × 1000, depth ${num((z + 1) / 2)}`;
}

/** The point the readout follows: the front end of the first house's roof ridge. */
export const tracked: Vec3 = [0, 1.15, 0.5];

export const spaceNotes: Record<Space, { title: string; matrix: string; note: string }> = {
  model: {
    title: 'Model space',
    matrix: 'none yet',
    note: 'The house as its modeller built it, centred on its own origin with its floor at y = 0. Every copy of it in the scene shares these same vertices.',
  },
  world: {
    title: 'World space',
    matrix: 'model matrix, one per house',
    note: 'Each house has its own model matrix that scales it, turns it and moves it into place. The camera is just another object in this world, with the box of space it can see drawn as a frustum.',
  },
  view: {
    title: 'View space',
    matrix: 'view matrix, one for the camera',
    note: 'The view matrix moves the whole world the opposite way to the camera, so the camera ends up at the origin looking straight down the −z axis. Nothing has changed shape.',
  },
  clip: {
    title: 'Clip space, after the divide',
    matrix: 'projection matrix, then ÷ w',
    note: 'The projection matrix and the divide by w squeeze the frustum into a cube from −1 to 1 on every axis. The far end shrinks the most, so the farther houses come out smaller. Anything outside the cube is clipped.',
  },
  screen: {
    title: 'Screen space',
    matrix: 'viewport transform',
    note: 'Flatten the cube along z and stretch x and y to pixels. Depth is kept per pixel, only to decide which surface is in front. This flat picture is what the rasteriser fills in.',
  },
};

/* ---------- Rasterisation ---------- */

export interface P2 {
  x: number;
  y: number;
}

/**
 * Twice the signed area of the triangle a, b, p. Its sign says which side of
 * the edge from a to b the point p is on.
 */
export const edge = (a: P2, b: P2, p: P2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

/** The barycentric weights of p in a triangle: how much of each corner p is made of. They sum to 1. */
export function barycentric([a, b, c]: P2[], p: P2): [number, number, number] {
  const area = edge(a, b, c);
  if (Math.abs(area) < 1e-9) return [-1, -1, -1];
  return [edge(b, c, p) / area, edge(c, a, p) / area, edge(a, b, p) / area];
}

export const inside = (weights: number[]) => weights.every((w) => w >= 0);

export const raster = { cols: 20, rows: 13, cell: 28 };

export type RasterMode = 'coverage' | 'colour' | 'samples' | 'depth';

/** The second triangle in depth mode, with a depth at each corner, tilted so it cuts through the first. */
export const otherTriangle: P2[] = [
  { x: 3, y: 10.5 },
  { x: 18.5, y: 3 },
  { x: 17, y: 12 },
];
export const depthsA = [0.2, 0.8, 0.5];
export const depthsB = [0.9, 0.1, 0.6];

/** Four sample points in a rotated grid, as most hardware uses for 4× multisampling. */
export const sampleOffsets: P2[] = [
  { x: 0.375, y: 0.125 },
  { x: 0.875, y: 0.375 },
  { x: 0.125, y: 0.625 },
  { x: 0.625, y: 0.875 },
];

const corner = ['#e0524f', '#2fa66a', '#3b7ddd'];
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function blend(weights: number[]): string {
  const channels = [0, 1, 2].map((ch) => Math.round(weights.reduce((sum, w, i) => sum + w * rgb(corner[i])[ch], 0)));
  return `rgb(${channels.join(',')})`;
}

export interface PixelReport {
  x: number;
  y: number;
  weights: [number, number, number];
  covered: boolean;
  samples: number;
  depthA: number | null;
  depthB: number | null;
}

export function inspectPixel(tri: P2[], x: number, y: number): PixelReport {
  const centre = { x: x + 0.5, y: y + 0.5 };
  const weights = barycentric(tri, centre);
  const covered = inside(weights);
  const samples = sampleOffsets.filter((o) => inside(barycentric(tri, { x: x + o.x, y: y + o.y }))).length;
  const other = barycentric(otherTriangle, centre);
  return {
    x,
    y,
    weights,
    covered,
    samples,
    depthA: covered ? weights.reduce((sum, w, i) => sum + w * depthsA[i], 0) : null,
    depthB: inside(other) ? other.reduce((sum, w, i) => sum + w * depthsB[i], 0) : null,
  };
}

/** The pixels a triangle's bounding box spans, the only ones worth testing. */
export function boundingBox(tri: P2[]) {
  const { cols, rows } = raster;
  return {
    x0: Math.max(0, Math.floor(Math.min(...tri.map((p) => p.x)))),
    y0: Math.max(0, Math.floor(Math.min(...tri.map((p) => p.y)))),
    x1: Math.min(cols - 1, Math.floor(Math.max(...tri.map((p) => p.x)))),
    y1: Math.min(rows - 1, Math.floor(Math.max(...tri.map((p) => p.y)))),
  };
}

/**
 * The pixel grid with one triangle drawn over it. `upTo` limits the pixels
 * filled to the first so many in the bounding box, for a scan in progress.
 */
export function rasterSvg(tri: P2[], mode: RasterMode, options: { upTo?: number; hover?: [number, number] | null; box?: boolean } = {}): string {
  const { cols, rows, cell } = raster;
  const parts: string[] = [];
  const box = boundingBox(tri);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const inBox = x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
      const order = inBox ? (y - box.y0) * (box.x1 - box.x0 + 1) + (x - box.x0) : -1;
      const reached = options.upTo === undefined || (order >= 0 && order < options.upTo);
      const r = inspectPixel(tri, x, y);
      let fill = '';
      let className = 'rs-pixel';
      if (reached) {
        if (mode === 'coverage' && r.covered) className += ' on';
        if (mode === 'colour' && r.covered) fill = blend(r.weights);
        if (mode === 'samples' && r.samples) {
          className += ' on';
          fill = `color-mix(in srgb, var(--series-1) ${r.samples * 25}%, var(--surface))`;
        }
        if (mode === 'depth') {
          const a = r.depthA;
          const b = r.depthB;
          if (a !== null && (b === null || a < b)) className += ' near-a';
          else if (b !== null) className += ' near-b';
        }
      }
      if (options.upTo !== undefined && order === options.upTo - 1) className += ' scan';
      if (options.hover && options.hover[0] === x && options.hover[1] === y) className += ' hover';
      parts.push(`<rect class="${className}" x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"${fill ? ` style="fill:${fill}"` : ''}/>`);
    }
  }
  if (options.box) {
    parts.push(`<rect class="rs-box" x="${box.x0 * cell}" y="${box.y0 * cell}" width="${(box.x1 - box.x0 + 1) * cell}" height="${(box.y1 - box.y0 + 1) * cell}"/>`);
  }
  // Pixel centres, or the four sample points when multisampling.
  const dots: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const points = mode === 'samples' ? sampleOffsets.map((o) => ({ x: x + o.x, y: y + o.y })) : [{ x: x + 0.5, y: y + 0.5 }];
      for (const p of points) {
        const hit = inside(barycentric(tri, p));
        dots.push(`<circle class="rs-centre${hit ? ' in' : ''}" cx="${(p.x * cell).toFixed(1)}" cy="${(p.y * cell).toFixed(1)}" r="${mode === 'samples' ? 1.6 : 2}"/>`);
      }
    }
  }
  parts.push(dots.join(''));
  const outline = (t: P2[], className: string) => `<polygon class="${className}" points="${t.map((p) => `${(p.x * cell).toFixed(1)},${(p.y * cell).toFixed(1)}`).join(' ')}"/>`;
  if (mode === 'depth') parts.push(outline(otherTriangle, 'rs-tri b'));
  parts.push(outline(tri, mode === 'depth' ? 'rs-tri a' : 'rs-tri'));
  tri.forEach((p, i) => {
    parts.push(
      `<g class="rs-handle" data-vertex="${i}"><circle cx="${(p.x * cell).toFixed(1)}" cy="${(p.y * cell).toFixed(1)}" r="11"/><text x="${(p.x * cell).toFixed(1)}" y="${(p.y * cell).toFixed(1)}">${'ABC'[i]}</text></g>`,
    );
  });
  return parts.join('');
}

export function coverageCounts(tri: P2[]) {
  const box = boundingBox(tri);
  let covered = 0;
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (inspectPixel(tri, x, y).covered) covered++;
  return { tested: Math.max(0, box.x1 - box.x0 + 1) * Math.max(0, box.y1 - box.y0 + 1), covered, area: Math.abs(edge(tri[0], tri[1], tri[2])) / 2 };
}

/* ---------- Shading ---------- */

export type ShadingModel = 'flat' | 'gouraud' | 'phong';

export interface Lighting {
  model: ShadingModel;
  ambient: boolean;
  diffuse: boolean;
  specular: boolean;
  shininess: number;
  /** Direction towards the light, in view space. */
  light: Vec3;
}

/** The sphere is cut into this many facets around and from pole to pole for flat and Gouraud shading. */
export const FACETS = { around: 14, down: 9 };

/** Where on a unit sphere a pair of facet coordinates lands. The sphere is tipped towards the viewer so its pole shows. */
const TILT = deg(25);
function onSphere(u: number, v: number): Vec3 {
  const theta = u * 2 * Math.PI;
  const phi = v * Math.PI;
  const p: Vec3 = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
  return [p[0], p[1] * Math.cos(TILT) - p[2] * Math.sin(TILT), p[1] * Math.sin(TILT) + p[2] * Math.cos(TILT)];
}

function facetCoords(n: Vec3): [number, number] {
  // Undo the tilt, then read off the angles.
  const y = n[1] * Math.cos(TILT) + n[2] * Math.sin(TILT);
  const z = -n[1] * Math.sin(TILT) + n[2] * Math.cos(TILT);
  const u = (Math.atan2(z, n[0]) / (2 * Math.PI) + 1) % 1;
  const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
  return [u, v];
}

export interface LightTerms {
  ambient: number;
  diffuse: number;
  specular: number;
  nDotL: number;
  rDotV: number;
}

/** The Phong reflection model at one point with normal n, seen from straight in front. */
export function phong(n: Vec3, lighting: Lighting): LightTerms {
  const l = normalize(lighting.light);
  const v: Vec3 = [0, 0, 1];
  const nDotL = dot(n, l);
  const r = reflect(scale(l, -1), n);
  const rDotV = Math.max(0, dot(r, v));
  return {
    ambient: lighting.ambient ? 0.12 : 0,
    diffuse: lighting.diffuse ? Math.max(0, nDotL) * 0.75 : 0,
    specular: lighting.specular && nDotL > 0 ? Math.pow(rDotV, lighting.shininess) * 0.7 : 0,
    nDotL,
    rDotV,
  };
}

/** The surface normal the chosen model uses at a point of the sphere whose true normal is n. */
function shadeAt(n: Vec3, lighting: Lighting): LightTerms {
  if (lighting.model === 'phong') return phong(n, lighting);
  const [u, v] = facetCoords(n);
  const fu = u * FACETS.around;
  const fv = v * FACETS.down;
  const i = Math.floor(fu);
  const j = Math.min(FACETS.down - 1, Math.floor(fv));
  if (lighting.model === 'flat') return phong(onSphere((i + 0.5) / FACETS.around, (j + 0.5) / FACETS.down), lighting);
  // Gouraud: light the four corners of the facet, then blend the results across it.
  const s = fu - i;
  const t = fv - j;
  const at = (a: number, b: number) => phong(onSphere((i + a) / FACETS.around, (j + b) / FACETS.down), lighting);
  const c00 = at(0, 0), c10 = at(1, 0), c01 = at(0, 1), c11 = at(1, 1);
  const mix = (k: keyof LightTerms) => (c00[k] * (1 - s) + c10[k] * s) * (1 - t) + (c01[k] * (1 - s) + c11[k] * s) * t;
  return { ambient: mix('ambient'), diffuse: mix('diffuse'), specular: mix('specular'), nDotL: mix('nDotL'), rDotV: mix('rDotV') };
}

/** The normal at a pixel of a sphere drawn filling a square image, or null off the sphere. */
export function sphereNormal(x: number, y: number, size: number): Vec3 | null {
  const r = size * 0.46;
  const dx = (x + 0.5 - size / 2) / r;
  const dy = -(y + 0.5 - size / 2) / r;
  const d2 = dx * dx + dy * dy;
  return d2 > 1 ? null : [dx, dy, Math.sqrt(1 - d2)];
}

/** Writes the lit sphere into an RGBA buffer, leaving the background transparent. */
export function shadeSphere(buffer: Uint8ClampedArray, size: number, lighting: Lighting, base: [number, number, number]) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = sphereNormal(x, y, size);
      if (!n) {
        buffer[i + 3] = 0;
        continue;
      }
      const t = shadeAt(n, lighting);
      const tint = t.ambient + t.diffuse;
      for (let c = 0; c < 3; c++) buffer[i + c] = Math.min(255, base[c] * tint + 255 * t.specular);
      buffer[i + 3] = 255;
    }
  }
}

export function lightingAt(x: number, y: number, size: number, lighting: Lighting): LightTerms | null {
  const n = sphereNormal(x, y, size);
  return n ? shadeAt(n, lighting) : null;
}

/* ---------- Ray tracing ---------- */

export interface Sphere {
  name: string;
  centre: Vec3;
  radius: number;
  colour: Vec3;
  mirror: number;
}

export const spheres: Sphere[] = [
  { name: 'red ball', centre: [-1.3, 1, -5.2], radius: 1, colour: [0.86, 0.28, 0.26], mirror: 0.05 },
  { name: 'mirror ball', centre: [1.15, 0.85, -4.4], radius: 0.85, colour: [0.9, 0.92, 0.95], mirror: 0.85 },
  { name: 'blue ball', centre: [0.05, 0.4, -3], radius: 0.4, colour: [0.24, 0.48, 0.9], mirror: 0.1 },
];

export const lightAt: Vec3 = [-3.5, 5, -1.5];
export const eye: Vec3 = [0, 1.25, 0];
const FOV = 52;
const SKY_TOP: Vec3 = [0.33, 0.5, 0.82];
const SKY_LOW: Vec3 = [0.8, 0.86, 0.94];

export interface TraceOptions {
  shading: boolean;
  shadows: boolean;
  reflections: boolean;
  /** How many times a ray may bounce off mirrors. */
  depth: number;
}

export interface TraceStats {
  primary: number;
  shadow: number;
  reflection: number;
}

export interface Segment {
  from: Vec3;
  to: Vec3;
  kind: 'primary' | 'reflection' | 'shadow' | 'escape';
  /** A shadow ray that hit something on its way to the light. */
  blocked?: boolean;
}

interface Hit {
  t: number;
  point: Vec3;
  normal: Vec3;
  colour: Vec3;
  mirror: number;
  name: string;
}

function hitSphere(origin: Vec3, dir: Vec3, s: Sphere): number {
  // Solve |origin + t·dir − centre|² = r², a quadratic in t.
  const oc = sub(origin, s.centre);
  const b = dot(oc, dir);
  const c = dot(oc, oc) - s.radius * s.radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  const t = -b - root > 1e-4 ? -b - root : -b + root;
  return t > 1e-4 ? t : Infinity;
}

function nearest(origin: Vec3, dir: Vec3): Hit | null {
  let best: Hit | null = null;
  for (const s of spheres) {
    const t = hitSphere(origin, dir, s);
    if (t < (best?.t ?? Infinity)) {
      const point = add(origin, scale(dir, t));
      best = { t, point, normal: normalize(sub(point, s.centre)), colour: s.colour, mirror: s.mirror, name: s.name };
    }
  }
  // The floor is the plane y = 0, a checkerboard that fades into the distance.
  if (dir[1] < -1e-6) {
    const t = -origin[1] / dir[1];
    if (t > 1e-4 && t < (best?.t ?? Infinity) && t < 60) {
      const point = add(origin, scale(dir, t));
      const check = (Math.floor(point[0]) + Math.floor(point[2])) & 1;
      best = { t, point, normal: [0, 1, 0], colour: check ? [0.82, 0.82, 0.8] : [0.3, 0.32, 0.36], mirror: 0.12, name: 'floor' };
    }
  }
  return best;
}

const sky = (dir: Vec3): Vec3 => {
  const t = clamp01(dir[1] * 1.6 + 0.2);
  return add(scale(SKY_LOW, 1 - t), scale(SKY_TOP, t));
};

function trace(origin: Vec3, dir: Vec3, options: TraceOptions, stats: TraceStats, bounce: number, path?: Segment[]): Vec3 {
  if (bounce === 0) stats.primary++;
  else stats.reflection++;
  const hit = nearest(origin, dir);
  const kind = bounce === 0 ? 'primary' : 'reflection';
  if (!hit) {
    path?.push({ from: origin, to: add(origin, scale(dir, 8)), kind: 'escape' });
    return sky(dir);
  }
  path?.push({ from: origin, to: hit.point, kind });
  if (!options.shading) return hit.colour;

  const toLight = sub(lightAt, hit.point);
  const lightDistance = length(toLight);
  const l = scale(toLight, 1 / lightDistance);
  let lit = Math.max(0, dot(hit.normal, l));
  if (options.shadows && lit > 0) {
    stats.shadow++;
    const blocker = nearest(add(hit.point, scale(hit.normal, 1e-3)), l);
    const blocked = !!blocker && blocker.t < lightDistance;
    path?.push({ from: hit.point, to: blocked ? blocker.point : lightAt, kind: 'shadow', blocked });
    if (blocked) lit = 0;
  }
  const v = scale(dir, -1);
  const r = reflect(scale(l, -1), hit.normal);
  const spec = lit > 0 ? Math.pow(Math.max(0, dot(r, v)), 40) * 0.6 : 0;
  let colour = add(scale(hit.colour, 0.14 + 0.86 * lit), [spec, spec, spec]);

  if (options.reflections && hit.mirror > 0 && bounce < options.depth) {
    const bounced = trace(add(hit.point, scale(hit.normal, 1e-3)), reflect(dir, hit.normal), options, stats, bounce + 1, path);
    colour = add(scale(colour, 1 - hit.mirror), scale(bounced, hit.mirror));
  }
  return colour;
}

/** The ray from the eye through the centre of pixel (x, y) of a w × h image. */
export function primaryRay(x: number, y: number, w: number, h: number): Vec3 {
  const half = Math.tan(deg(FOV) / 2);
  const aspect = w / h;
  const px = ((x + 0.5) / w) * 2 - 1;
  const py = 1 - ((y + 0.5) / h) * 2;
  // Tip the camera down a little so the floor fills the bottom of the picture.
  const [dx, dy, dz]: Vec3 = [px * half * aspect, py * half, -1];
  const a = -deg(8);
  return normalize([dx, dy * Math.cos(a) - dz * Math.sin(a), dy * Math.sin(a) + dz * Math.cos(a)]);
}

/** Traces one row of the image into an RGBA buffer. */
export function traceRow(buffer: Uint8ClampedArray, y: number, w: number, h: number, options: TraceOptions, stats: TraceStats) {
  for (let x = 0; x < w; x++) {
    const c = trace(eye, primaryRay(x, y, w, h), options, stats, 0);
    const i = (y * w + x) * 4;
    // A gentle gamma, so the dark side of each ball is not crushed to black.
    for (let k = 0; k < 3; k++) buffer[i + k] = Math.round(255 * Math.pow(clamp01(c[k]), 1 / 1.6));
    buffer[i + 3] = 255;
  }
}

/** The path of every ray traced for one pixel, and what its first ray hit. */
export function tracePixel(x: number, y: number, w: number, h: number, options: TraceOptions) {
  const path: Segment[] = [];
  const stats: TraceStats = { primary: 0, shadow: 0, reflection: 0 };
  const dir = primaryRay(x, y, w, h);
  trace(eye, dir, options, stats, 0, path);
  return { path, stats, hit: nearest(eye, dir)?.name ?? 'sky' };
}

/** The scene from above, with one pixel's rays drawn over it. */
export const topView = { width: 300, height: 300, x0: -4, x1: 3.5, z0: 0.6, z1: -6.9 };

export function topViewSvg(path: Segment[], view = topView): string {
  const sx = (x: number) => ((x - view.x0) / (view.x1 - view.x0)) * view.width;
  const sz = (z: number) => ((z - view.z1) / (view.z0 - view.z1)) * view.height;
  const k = view.width / (view.x1 - view.x0);
  const parts: string[] = [];
  for (let x = Math.ceil(view.x0); x <= view.x1; x++) parts.push(`<line class="gx-grid" x1="${sx(x).toFixed(1)}" y1="0" x2="${sx(x).toFixed(1)}" y2="${view.height}"/>`);
  for (let z = Math.ceil(view.z1); z <= view.z0; z++) parts.push(`<line class="gx-grid" x1="0" y1="${sz(z).toFixed(1)}" x2="${view.width}" y2="${sz(z).toFixed(1)}"/>`);
  for (const s of spheres) {
    parts.push(`<circle class="rt-ball" cx="${sx(s.centre[0]).toFixed(1)}" cy="${sz(s.centre[2]).toFixed(1)}" r="${(s.radius * k).toFixed(1)}" style="fill:rgb(${s.colour.map((c) => Math.round(c * 255)).join(',')})"/>`);
  }
  // The camera's field of view, as two lines from the eye.
  const half = Math.tan(deg(FOV) / 2) * 1.5;
  for (const side of [-1, 1]) parts.push(`<line class="rt-fov" x1="${sx(eye[0])}" y1="${sz(eye[2])}" x2="${sx(eye[0] + side * half * 7).toFixed(1)}" y2="${sz(eye[2] - 7).toFixed(1)}"/>`);
  for (const seg of path) {
    const cls = seg.kind === 'shadow' ? `rt-ray shadow${seg.blocked ? ' blocked' : ''}` : `rt-ray ${seg.kind}`;
    parts.push(`<line class="${cls}" x1="${sx(seg.from[0]).toFixed(1)}" y1="${sz(seg.from[2]).toFixed(1)}" x2="${sx(seg.to[0]).toFixed(1)}" y2="${sz(seg.to[2]).toFixed(1)}"/>`);
    if (seg.kind !== 'escape' && seg.kind !== 'shadow') parts.push(`<circle class="rt-hit" cx="${sx(seg.to[0]).toFixed(1)}" cy="${sz(seg.to[2]).toFixed(1)}" r="3"/>`);
  }
  parts.push(`<circle class="rt-light" cx="${sx(lightAt[0]).toFixed(1)}" cy="${sz(lightAt[2]).toFixed(1)}" r="6"/>`, `<text class="v-small" x="${sx(lightAt[0]).toFixed(1)}" y="${(sz(lightAt[2]) - 13).toFixed(1)}">light</text>`);
  parts.push(`<path class="rt-eye" d="M${sx(eye[0]) - 7},${sz(eye[2]) + 6} L${sx(eye[0])},${sz(eye[2]) - 6} L${sx(eye[0]) + 7},${sz(eye[2]) + 6}Z"/>`, `<text class="v-small" x="${sx(eye[0])}" y="${(sz(eye[2]) + 15).toFixed(1)}">eye</text>`);
  return parts.join('');
}
