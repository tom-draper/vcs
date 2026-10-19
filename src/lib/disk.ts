// The model behind <DiskDrive>: a hard disk platter with tracks and sectors,
// a swinging arm, and the timing of each read. Every read is a seek (the arm
// moves to the track), a wait (the platter turns until the sector reaches the
// head), and the transfer (the sector passes under the head).
import { seeded } from './distributed';

export const TRACKS = 10;
export const SECTORS = 24;
export const RPM = 7200;
/** One revolution, in milliseconds. */
export const REV_MS = 60000 / RPM;
export const SECTOR_ANGLE = (2 * Math.PI) / SECTORS;
const OMEGA = (2 * Math.PI) / REV_MS;

/** The platter's radius is 1. Data lives between these radii. */
export const INNER = 0.36;
export const OUTER = 0.94;
export const TRACK_WIDTH = (OUTER - INNER) / TRACKS;
export const trackRadius = (track: number) => INNER + (track + 0.5) * TRACK_WIDTH;

/** The arm turns about a pivot beside the platter, so the head sweeps an arc. */
export const PIVOT = { x: 1.45, y: -0.95 };
export const ARM = 1.5;

const tau = 2 * Math.PI;
const wrap = (angle: number) => ((angle % tau) + tau) % tau;

/** The arm angle that puts the head over a radius, and where the head then is. */
export function head(radius: number) {
  const p = Math.hypot(PIVOT.x, PIVOT.y);
  const c = (radius * radius - p * p - ARM * ARM) / (2 * ARM * p);
  const arm = Math.atan2(PIVOT.y, PIVOT.x) + Math.acos(Math.max(-1, Math.min(1, c)));
  const x = PIVOT.x + ARM * Math.cos(arm);
  const y = PIVOT.y + ARM * Math.sin(arm);
  return { arm, x, y, angle: Math.atan2(y, x) };
}

/** How the platter has turned by a given time. It spins clockwise seen from above. */
export const platterAngle = (ms: number) => -OMEGA * ms;

/**
 * Moving the arm takes a fixed settling time plus a time that grows with the
 * square root of the distance, since the arm speeds up and then slows down.
 */
export const seekMs = (from: number, to: number) => (from === to ? 0 : 0.8 + 2.4 * Math.sqrt(Math.abs(to - from)));

export interface Request {
  track: number;
  sector: number;
}

export interface Op extends Request {
  from: number;
  seekStart: number;
  seekEnd: number;
  readStart: number;
  readEnd: number;
}

/** When each read happens, done in the order given, starting with the head over `track` at time `start`. */
export function schedule(requests: Request[], track: number, start: number): Op[] {
  let t = start;
  let at = track;
  return requests.map((r) => {
    const seekEnd = t + seekMs(at, r.track);
    // The sector under the head is the head's angle minus the platter's turn.
    const under = wrap(head(trackRadius(r.track)).angle - platterAngle(seekEnd));
    let turn = wrap(r.sector * SECTOR_ANGLE - under);
    // A sector that starts exactly now must not wait a whole revolution for rounding.
    if (turn > tau - 1e-6) turn = 0;
    const readStart = seekEnd + turn / OMEGA;
    const op = { ...r, from: at, seekStart: t, seekEnd, readStart, readEnd: readStart + SECTOR_ANGLE / OMEGA };
    t = op.readEnd;
    at = r.track;
    return op;
  });
}

export type Phase = 'idle' | 'seek' | 'wait' | 'read';

/** Which read is in progress at a time, and what it is doing. */
export function phaseAt(ops: Op[], ms: number): { index: number; phase: Phase } {
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (ms < op.seekStart) break;
    if (ms < op.seekEnd) return { index: i, phase: 'seek' };
    if (ms < op.readStart) return { index: i, phase: 'wait' };
    if (ms < op.readEnd) return { index: i, phase: 'read' };
  }
  return { index: -1, phase: 'idle' };
}

/** Where the arm points at a time, easing between tracks during each seek. */
export function armAt(ops: Op[], ms: number, rest: number): number {
  let track = rest;
  for (const op of ops) {
    if (ms < op.seekStart) break;
    if (ms < op.seekEnd) {
      const t = (ms - op.seekStart) / (op.seekEnd - op.seekStart);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      return head(trackRadius(op.from + (op.track - op.from) * e)).arm;
    }
    track = op.track;
  }
  return head(trackRadius(track)).arm;
}

export interface Totals {
  done: number;
  seek: number;
  wait: number;
  read: number;
  elapsed: number;
}

/** Time spent so far in each part of the work, up to `ms`. */
export function totals(ops: Op[], ms: number): Totals {
  const part = (from: number, to: number) => Math.max(0, Math.min(ms, to) - from);
  const sum = { done: 0, seek: 0, wait: 0, read: 0, elapsed: 0 };
  for (const op of ops) {
    sum.seek += part(op.seekStart, op.seekEnd);
    sum.wait += part(op.seekEnd, op.readStart);
    sum.read += part(op.readStart, op.readEnd);
    if (ms >= op.readEnd) sum.done += 1;
  }
  sum.elapsed = sum.seek + sum.wait + sum.read;
  return sum;
}

export type Workload = 'sequential' | 'random' | 'reordered';

export const START_TRACK = 2;

const randomReads: Request[] = (() => {
  const random = seeded(17);
  return Array.from({ length: 8 }, () => ({ track: Math.floor(random() * TRACKS), sector: Math.floor(random() * SECTORS) }));
})();

/**
 * The order a drive with a request queue would choose: always the read that
 * can start soonest, counting both the seek and the wait for the platter.
 */
function soonestFirst(requests: Request[], track: number, start: number): Request[] {
  const left = [...requests];
  const order: Request[] = [];
  let t = start;
  let at = track;
  while (left.length) {
    const options = left.map((r) => schedule([r], at, t)[0]);
    const best = options.reduce((a, b) => (b.readStart < a.readStart ? b : a));
    left.splice(options.indexOf(best), 1);
    order.push({ track: best.track, sector: best.sector });
    t = best.readEnd;
    at = best.track;
  }
  return order;
}

export const workloads: Record<Workload, { name: string; requests: Request[]; summary: string }> = {
  sequential: {
    name: 'Read a file in order',
    requests: Array.from({ length: SECTORS }, (_, sector) => ({ track: 6, sector })),
    summary: 'One file stored in consecutive sectors of one track. After one seek and one wait, the sectors stream past the head with no gaps.',
  },
  random: {
    name: '8 scattered reads',
    requests: randomReads,
    summary: 'Eight small reads at random places, served in the order they were asked for. Every one needs its own seek and its own wait.',
  },
  reordered: {
    name: 'Same 8, reordered',
    requests: randomReads,
    summary: 'The same eight reads, but the drive picks the order. Each time, it serves whichever read can start soonest, counting both the seek and the wait for the platter.',
  },
};

/** The reads for a workload, timed from `start`. Only the reordered workload depends on when it starts. */
export function plan(workload: Workload, start: number): Op[] {
  const { requests } = workloads[workload];
  const order = workload === 'reordered' ? soonestFirst(requests, START_TRACK, start) : requests;
  return schedule(order, START_TRACK, start);
}

/** One SSD read of a small block, in milliseconds. */
export const SSD_MS = 0.1;

const ms = (value: number) => `${value.toFixed(1)} ms`;

export function verdict(workload: Workload, sum: Totals): string {
  const { done, seek, wait, read, elapsed } = sum;
  const reads = `${done} ${done === 1 ? 'read' : 'reads'}`;
  const split = `${ms(seek)} moving the arm, ${ms(wait)} waiting for the platter to turn and ${ms(read)} actually reading`;
  if (workload === 'sequential') {
    return `${done} sectors in ${ms(elapsed)}: ${split}. Once the head is in place, data arrives as fast as the platter turns.`;
  }
  const ssd = `An SSD would answer the same ${done} in about ${ms(done * SSD_MS)}.`;
  return `${reads} in ${ms(elapsed)}: ${split}. ${ssd}`;
}
