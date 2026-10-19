// The model behind <LossLandscape>: a hilly loss surface over two parameters,
// with one deepest valley and several shallower ones, and balls that walk
// downhill on it by plain gradient descent or with momentum.
import { seeded } from './distributed';

export const EXTENT = 3;

interface Well {
  x: number;
  y: number;
  depth: number;
  width: number;
}

const wells: Well[] = [
  { x: 1.25, y: -0.95, depth: 1.7, width: 0.72 },
  { x: -1.55, y: 1.1, depth: 1.1, width: 0.62 },
  { x: -1.15, y: -1.65, depth: 0.75, width: 0.5 },
  { x: 1.3, y: 1.6, depth: 0.6, width: 0.48 },
];

const BOWL = 0.075;
const RIPPLE = 0.09;

/** The loss at a point. */
export function loss(x: number, y: number): number {
  let h = BOWL * (x * x + y * y) + RIPPLE * Math.sin(2.1 * x) * Math.cos(1.8 * y);
  for (const w of wells) h -= w.depth * Math.exp(-((x - w.x) ** 2 + (y - w.y) ** 2) / (2 * w.width ** 2));
  return h;
}

/** The gradient of the loss, worked out by hand. */
export function gradient(x: number, y: number): [number, number] {
  let gx = 2 * BOWL * x + RIPPLE * 2.1 * Math.cos(2.1 * x) * Math.cos(1.8 * y);
  let gy = 2 * BOWL * y - RIPPLE * 1.8 * Math.sin(2.1 * x) * Math.sin(1.8 * y);
  for (const w of wells) {
    const e = w.depth * Math.exp(-((x - w.x) ** 2 + (y - w.y) ** 2) / (2 * w.width ** 2));
    gx += (e * (x - w.x)) / w.width ** 2;
    gy += (e * (y - w.y)) / w.width ** 2;
  }
  return [gx, gy];
}

export type Method = 'plain' | 'momentum';

export const rates = { small: 0.06, medium: 0.18, large: 0.5 } as const;
export type Rate = keyof typeof rates;

const BETA = 0.88;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Every position so far, oldest first. */
  path: [number, number][];
  /** How many steps in a row it has barely moved. */
  still: number;
  done: boolean;
  /** The index into `minima` it settled in, or -1 if it left the map. */
  basin: number | null;
}

export function ball(x: number, y: number): Ball {
  return { x, y, vx: 0, vy: 0, path: [[x, y]], still: 0, done: false, basin: null };
}

/** Moves a ball one step. Returns false once it has stopped. */
export function step(b: Ball, method: Method, rate: number): boolean {
  if (b.done) return false;
  const [gx, gy] = gradient(b.x, b.y);
  if (method === 'momentum') {
    b.vx = BETA * b.vx - rate * gx;
    b.vy = BETA * b.vy - rate * gy;
  } else {
    b.vx = -rate * gx;
    b.vy = -rate * gy;
  }
  b.x += b.vx;
  b.y += b.vy;
  b.path.push([b.x, b.y]);
  if (Math.abs(b.x) > EXTENT || Math.abs(b.y) > EXTENT) {
    b.x = Math.max(-EXTENT, Math.min(EXTENT, b.x));
    b.y = Math.max(-EXTENT, Math.min(EXTENT, b.y));
    b.done = true;
    b.basin = -1;
    return false;
  }
  const moved = Math.hypot(b.vx, b.vy);
  b.still = moved < 2e-3 && Math.hypot(gx, gy) < 2e-2 ? b.still + 1 : 0;
  if (b.still >= 6 || b.path.length > 600) {
    b.done = true;
    b.basin = nearestMinimum(b.x, b.y);
  }
  return !b.done;
}

export interface Minimum {
  x: number;
  y: number;
  loss: number;
  /** 0 for the lowest point on the map, then in order of depth. */
  rank: number;
}

/** Every valley floor, found by walking downhill from a fine grid of starts. */
export const minima: Minimum[] = (() => {
  const found: { x: number; y: number }[] = [];
  for (let i = 0; i <= 24; i++) {
    for (let j = 0; j <= 24; j++) {
      const b = ball(-EXTENT + (i / 24) * 2 * EXTENT, -EXTENT + (j / 24) * 2 * EXTENT);
      for (let k = 0; k < 4000; k++) {
        const [gx, gy] = gradient(b.x, b.y);
        b.x -= 0.05 * gx;
        b.y -= 0.05 * gy;
        if (Math.hypot(gx, gy) < 1e-6) break;
      }
      if (Math.abs(b.x) >= EXTENT || Math.abs(b.y) >= EXTENT) continue;
      if (!found.some((m) => Math.hypot(m.x - b.x, m.y - b.y) < 0.05)) found.push({ x: b.x, y: b.y });
    }
  }
  return found
    .map((m) => ({ ...m, loss: loss(m.x, m.y) }))
    .sort((a, b) => a.loss - b.loss)
    .map((m, rank) => ({ ...m, rank }));
})();

function nearestMinimum(x: number, y: number): number {
  let best = 0;
  minima.forEach((m, i) => {
    if (Math.hypot(m.x - x, m.y - y) < Math.hypot(minima[best].x - x, minima[best].y - y)) best = i;
  });
  return best;
}

/** A jittered grid of starting points spread over the whole map. */
export function scatter(count: number, seed: number): Ball[] {
  const random = seeded(seed);
  const side = Math.ceil(Math.sqrt(count));
  const cell = (2 * EXTENT * 0.86) / side;
  return Array.from({ length: count }, (_, i) => {
    const x = -EXTENT * 0.86 + ((i % side) + 0.15 + 0.7 * random()) * cell;
    const y = -EXTENT * 0.86 + (Math.floor(i / side) + 0.15 + 0.7 * random()) * cell;
    return ball(x, y);
  });
}

/** A sentence about where a set of finished balls ended up. */
export function summarise(balls: Ball[], method: Method): string {
  const done = balls.filter((b) => b.done);
  if (!done.length) return '';
  const best = done.filter((b) => b.basin === 0).length;
  const lost = done.filter((b) => b.basin === -1).length;
  const name = method === 'momentum' ? 'With momentum' : 'With plain gradient descent';
  const parts = [`${name}, ${best} of ${done.length} ${done.length === 1 ? 'ball' : 'balls'} reached the lowest valley.`];
  const stuck = done.length - best - lost;
  if (stuck) parts.push(`${stuck} stopped in a shallower dip, where the ground is flat but not lowest.`);
  if (lost) parts.push(`${lost} overshot and left the map.`);
  return parts.join(' ');
}
