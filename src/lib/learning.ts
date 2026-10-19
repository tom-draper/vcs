// Small models for the machine learning pages: a least-squares line, gradient
// descent on its error, polynomial fits, k-means and a tiny neural network
// trained by backpropagation.
//
// The drawing functions return SVG markup, so the server renders each
// widget's first frame and the browser redraws it with the same code.

import { seeded } from './distributed';

export interface Point {
  x: number;
  y: number;
}

export interface Labelled extends Point {
  label: 0 | 1;
}

export interface Line {
  /** Slope. */
  w: number;
  /** Intercept. */
  b: number;
}

/** A number for a readout, without a stray minus sign on zero. */
export function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '∞';
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/** A normally distributed number, by the Box-Muller transform. */
function gaussian(random: () => number) {
  const u = 1 - random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const squared = (d: number) => d * d;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const xy = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;

/* ---------- Plotting ---------- */

/** Maps data coordinates onto the inner rectangle of an SVG chart. */
export class Plot {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly x0: number,
    readonly x1: number,
    readonly y0: number,
    readonly y1: number,
    readonly left = 34,
    readonly bottom = 26,
    readonly top = 8,
    readonly right = 8,
  ) {}

  px(x: number) {
    return this.left + ((x - this.x0) / (this.x1 - this.x0)) * (this.width - this.left - this.right);
  }

  py(y: number) {
    return this.height - this.bottom - ((y - this.y0) / (this.y1 - this.y0)) * (this.height - this.bottom - this.top);
  }

  /** The data coordinates under an SVG position. */
  data(px: number, py: number): Point {
    return {
      x: this.x0 + ((px - this.left) / (this.width - this.left - this.right)) * (this.x1 - this.x0),
      y: this.y0 + ((this.height - this.bottom - py) / (this.height - this.bottom - this.top)) * (this.y1 - this.y0),
    };
  }

  inside({ x, y }: Point) {
    return x >= this.x0 && x <= this.x1 && y >= this.y0 && y <= this.y1;
  }

  /** Axis lines with labelled ticks. */
  axes(xTicks: number[], yTicks: number[], xName = '', yName = ''): string {
    const base = this.height - this.bottom;
    const parts = [
      `<line class="ml-axis" x1="${this.left}" y1="${base}" x2="${this.width - this.right}" y2="${base}"/>`,
      `<line class="ml-axis" x1="${this.left}" y1="${this.top}" x2="${this.left}" y2="${base}"/>`,
      ...xTicks.map((t) => `<text class="v-small" x="${this.px(t).toFixed(1)}" y="${base + 10}">${fmt(t, Number.isInteger(t) ? 0 : 1)}</text>`),
      ...yTicks.map((t) => `<text class="v-small" x="${this.left - 14}" y="${this.py(t).toFixed(1)}">${fmt(t, Number.isInteger(t) ? 0 : 1)}</text>`),
    ];
    if (xName) parts.push(`<text class="v-small ml-name" x="${this.width - this.right - 2}" y="${base - 9}" text-anchor="end">${xName}</text>`);
    if (yName) parts.push(`<text class="v-small ml-name" x="${this.left + 6}" y="${this.top + 6}" text-anchor="start">${yName}</text>`);
    return parts.join('');
  }

  /** Clips markup to the inner rectangle, so curves that leave the chart stop at its edge. */
  clip(markup: string): string {
    const w = this.width - this.left - this.right;
    const h = this.height - this.bottom - this.top;
    return `<svg x="${this.left}" y="${this.top}" width="${w}" height="${h}" overflow="hidden"><g transform="translate(${-this.left} ${-this.top})">${markup}</g></svg>`;
  }

  /** A function drawn as a polyline across the whole x range. */
  curve(f: (x: number) => number, className: string, samples = 160): string {
    const span = this.y1 - this.y0;
    const points: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const x = this.x0 + (i / samples) * (this.x1 - this.x0);
      // Keep wild values near the chart so the clipped line still leaves at the right angle.
      const y = Math.max(this.y0 - span, Math.min(this.y1 + span, f(x)));
      points.push(xy(this.px(x), this.py(y)));
    }
    return `<polyline class="${className}" points="${points.join(' ')}"/>`;
  }
}

/* ---------- Linear regression ---------- */

export const regressionPlot = new Plot(600, 340, 0, 10, 0, 10);

/** Hours of practice against a test score out of ten, roughly a straight line. */
export const regressionPoints: Point[] = [
  { x: 1, y: 2.1 },
  { x: 2, y: 2.9 },
  { x: 3, y: 3.2 },
  { x: 4, y: 4.6 },
  { x: 5, y: 4.4 },
  { x: 6, y: 5.9 },
  { x: 7, y: 6.1 },
  { x: 8, y: 7.4 },
  { x: 9, y: 7.6 },
];

/** The line that minimises the mean squared error, in closed form. */
export function leastSquares(points: Point[]): Line {
  if (points.length === 0) return { w: 0, b: 0 };
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  for (const { x, y } of points) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  if (sxx === 0) return { w: 0, b: my };
  const w = sxy / sxx;
  return { w, b: my - w * mx };
}

export const meanSquaredError = (points: Point[], { w, b }: Line) => mean(points.map(({ x, y }) => squared(w * x + b - y)));

/**
 * The points, a candidate line with each error drawn as a square, and the best
 * line dashed for comparison when it is given.
 */
export function regressionSvg(points: Point[], line: Line, best: Line | null, plot = regressionPlot): string {
  const at = ({ w, b }: Line) => (x: number) => w * x + b;
  const squares = points.map(({ x, y }) => {
    const px = plot.px(x);
    const py = plot.py(y);
    const ly = plot.py(at(line)(x));
    const side = Math.abs(ly - py);
    return (
      `<rect class="ml-square" x="${px.toFixed(1)}" y="${Math.min(py, ly).toFixed(1)}" width="${side.toFixed(1)}" height="${side.toFixed(1)}"/>` +
      `<line class="ml-residual" x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${px.toFixed(1)}" y2="${ly.toFixed(1)}"/>`
    );
  });
  const dots = points.map(({ x, y }) => `<circle class="ml-point" cx="${plot.px(x).toFixed(1)}" cy="${plot.py(y).toFixed(1)}" r="5"/>`);
  return (
    plot.axes([0, 2, 4, 6, 8, 10], [0, 2, 4, 6, 8, 10], 'hours', 'score') +
    plot.clip(
      squares.join('') +
        (best ? plot.curve(at(best), 'ml-best', 2) : '') +
        plot.curve(at(line), 'ml-line', 2) +
        dots.join(''),
    )
  );
}

/* ---------- Gradient descent ---------- */

/** A few measurements centred on zero, so the error surface is a gentle bowl. */
export const descentPoints: Point[] = [
  { x: -2, y: -2.6 },
  { x: -1.5, y: -1.1 },
  { x: -1, y: -1.2 },
  { x: -0.5, y: 0.3 },
  { x: 0, y: 0.2 },
  { x: 0.5, y: 1.5 },
  { x: 1, y: 2.3 },
  { x: 1.5, y: 2.4 },
  { x: 2, y: 3.6 },
];

/** The plane of every possible line: slope across, intercept up. */
export const descentPlot = new Plot(600, 340, -1, 4, -2.5, 3.5);

export interface DescentStep extends Line {
  loss: number;
  /** The gradient of the loss at this point. */
  dw: number;
  db: number;
}

/** The mean squared error of a line and its gradient with respect to the slope and intercept. */
export function lossAndGradient(points: Point[], w: number, b: number): DescentStep {
  let loss = 0;
  let dw = 0;
  let db = 0;
  for (const { x, y } of points) {
    const error = w * x + b - y;
    loss += error * error;
    dw += 2 * error * x;
    db += 2 * error;
  }
  const n = points.length;
  return { w, b, loss: loss / n, dw: dw / n, db: db / n };
}

/** Takes up to `steps` steps downhill, stopping early once the walk has clearly blown up. */
export function descend(points: Point[], start: Line, rate: number, steps: number): DescentStep[] {
  const path = [lossAndGradient(points, start.w, start.b)];
  for (let i = 0; i < steps; i++) {
    const here = path.at(-1)!;
    if (here.loss > 1e6) break;
    path.push(lossAndGradient(points, here.w - rate * here.dw, here.b - rate * here.db));
  }
  return path;
}

/** The error surface as shaded bands, with the path walked so far. */
export function descentSvg(points: Point[], path: DescentStep[], plot = descentPlot): string {
  const columns = 50;
  const rows = 34;
  const cw = (plot.width - plot.left - plot.right) / columns;
  const ch = (plot.height - plot.top - plot.bottom) / rows;
  const best = leastSquares(points);
  const floor = meanSquaredError(points, best);
  const cells: string[] = [];
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const { x: w, y: b } = plot.data(plot.left + (i + 0.5) * cw, plot.top + (j + 0.5) * ch);
      // Bands of equal width in the square root of the excess error look like evenly spaced contours.
      const band = Math.min(9, Math.floor(Math.sqrt(meanSquaredError(points, { w, b }) - floor) / 0.33));
      cells.push(
        `<rect class="ml-band" x="${(plot.left + i * cw).toFixed(2)}" y="${(plot.top + j * ch).toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" style="fill-opacity:${(0.62 - band * 0.062).toFixed(3)}"/>`,
      );
    }
  }
  const trail = path.map((step) => xy(plot.px(step.w), plot.py(step.b))).join(' ');
  const here = path.at(-1);
  const marks = path
    .slice(0, -1)
    .map((step) => `<circle class="ml-trail-dot" cx="${plot.px(step.w).toFixed(1)}" cy="${plot.py(step.b).toFixed(1)}" r="2.5"/>`);
  const bx = plot.px(best.w);
  const by = plot.py(best.b);
  return (
    cells.join('') +
    plot.axes([-1, 0, 1, 2, 3, 4], [-2, -1, 0, 1, 2, 3], 'slope w', 'intercept b') +
    plot.clip(
      `<path class="ml-minimum" d="M${bx - 6},${by - 6}L${bx + 6},${by + 6}M${bx - 6},${by + 6}L${bx + 6},${by - 6}"/>` +
        `<polyline class="ml-trail" points="${trail}"/>` +
        marks.join('') +
        (here ? `<circle class="ml-ball" cx="${plot.px(here.w).toFixed(1)}" cy="${plot.py(here.b).toFixed(1)}" r="6"/>` : ''),
    )
  );
}

/* ---------- Overfitting ---------- */

/** The rule the data really follows, before noise is added. */
export const truth = (x: number) => Math.sin(Math.PI * x);

function noisySample(count: number, seed: number): Point[] {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    // Spread the x values out, with some jitter, so no region is empty.
    const x = -1 + ((i + 0.2 + 0.6 * random()) / count) * 2;
    return { x, y: truth(x) + 0.28 * gaussian(random) };
  });
}

export const trainingPoints = noisySample(10, 21);
export const testPoints = noisySample(40, 8);
export const overfitPlot = new Plot(600, 300, -1, 1, -1.8, 1.8);

/**
 * Least squares by Householder QR, which stays accurate on the badly
 * conditioned systems that high-degree polynomials produce.
 */
function solveLeastSquares(rows: number[][], targets: number[]): number[] {
  const m = rows.length;
  const n = rows[0].length;
  const a = rows.map((row) => [...row]);
  const q = [...targets];
  for (let k = 0; k < Math.min(n, m); k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += a[i][k] ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = a[k][k] > 0 ? -norm : norm;
    const v = new Array<number>(m).fill(0);
    for (let i = k; i < m; i++) v[i] = a[i][k];
    v[k] -= alpha;
    let vv = 0;
    for (let i = k; i < m; i++) vv += v[i] ** 2;
    if (vv === 0) continue;
    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = k; i < m; i++) dot += v[i] * a[i][j];
      for (let i = k; i < m; i++) a[i][j] -= (2 * dot * v[i]) / vv;
    }
    let dot = 0;
    for (let i = k; i < m; i++) dot += v[i] * q[i];
    for (let i = k; i < m; i++) q[i] -= (2 * dot * v[i]) / vv;
  }
  const c = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    let s = q[k];
    for (let j = k + 1; j < n; j++) s -= a[k][j] * c[j];
    c[k] = Math.abs(a[k][k]) < 1e-12 ? 0 : s / a[k][k];
  }
  return c;
}

/**
 * Fits a polynomial of the given degree. `penalty` is the ridge strength λ:
 * the fit minimises squared error plus λ times the sum of squared
 * coefficients, leaving the constant term free.
 */
export function polynomialFit(points: Point[], degree: number, penalty = 0): number[] {
  const terms = degree + 1;
  const rows = points.map(({ x }) => Array.from({ length: terms }, (_, k) => x ** k));
  const targets = points.map(({ y }) => y);
  // Ridge regression is ordinary least squares with one extra row per
  // coefficient asking it to be zero, weighted by the square root of λ.
  for (let k = 1; k < terms && penalty > 0; k++) {
    rows.push(Array.from({ length: terms }, (_, j) => (j === k ? Math.sqrt(penalty * points.length) : 0)));
    targets.push(0);
  }
  return solveLeastSquares(rows, targets);
}

export const polynomial = (coefficients: number[]) => (x: number) =>
  coefficients.reduceRight((sum, c) => sum * x + c, 0);

export interface FitReport {
  degree: number;
  coefficients: number[];
  train: number;
  test: number;
}

export function fitReport(degree: number, penalty: number): FitReport {
  const coefficients = polynomialFit(trainingPoints, degree, penalty);
  const f = polynomial(coefficients);
  const error = (points: Point[]) => mean(points.map(({ x, y }) => squared(f(x) - y)));
  return { degree, coefficients, train: error(trainingPoints), test: error(testPoints) };
}

export const maxDegree = trainingPoints.length - 1;

/** The fitted curve against the truth, with training points solid and test points hollow. */
export function overfitSvg(report: FitReport, plot = overfitPlot): string {
  const dot = (className: string, r: number) => ({ x, y }: Point) =>
    `<circle class="${className}" cx="${plot.px(x).toFixed(1)}" cy="${plot.py(y).toFixed(1)}" r="${r}"/>`;
  return (
    plot.axes([-1, -0.5, 0, 0.5, 1], [-1, 0, 1]) +
    plot.clip(
      plot.curve(truth, 'ml-truth') +
        testPoints.map(dot('ml-test', 3.5)).join('') +
        plot.curve(polynomial(report.coefficients), 'ml-line', 300) +
        trainingPoints.map(dot('ml-point', 5)).join(''),
    )
  );
}

export const errorPlot = new Plot(600, 170, -0.5, maxDegree + 0.5, 0, 0.6, 34, 26, 8, 8);

/** Training and test error at every degree, with the chosen degree marked. */
export function errorCurveSvg(penalty: number, degree: number, plot = errorPlot): string {
  const reports = Array.from({ length: maxDegree + 1 }, (_, d) => fitReport(d, penalty));
  const line = (key: 'train' | 'test', className: string) =>
    `<polyline class="${className}" points="${reports.map((r) => xy(plot.px(r.degree), plot.py(Math.min(r[key], plot.y1 * 1.5)))).join(' ')}"/>` +
    reports
      .map((r) => `<circle class="${className}-dot" cx="${plot.px(r.degree).toFixed(1)}" cy="${plot.py(Math.min(r[key], plot.y1 * 1.5)).toFixed(1)}" r="3"/>`)
      .join('');
  const x = plot.px(degree).toFixed(1);
  return (
    `<line class="ml-cursor" x1="${x}" y1="${plot.top}" x2="${x}" y2="${plot.height - plot.bottom}"/>` +
    plot.axes(
      reports.map((r) => r.degree),
      [0, 0.2, 0.4, 0.6],
      'degree',
      'error',
    ) +
    plot.clip(line('train', 'ml-train') + line('test', 'ml-test-line'))
  );
}

/* ---------- k-means ---------- */

/** Four loose blobs of points, so k = 4 is the natural answer but not the only one. */
export const clusterPoints: Point[] = (() => {
  const random = seeded(4);
  const centres = [
    [2.2, 7.2],
    [7.4, 7.8],
    [3.2, 2.6],
    [7.8, 3],
  ];
  return centres.flatMap(([cx, cy], i) =>
    Array.from({ length: [16, 12, 14, 15][i] }, () => ({ x: cx + 0.95 * gaussian(random), y: cy + 0.85 * gaussian(random) })),
  );
})();

export const clusterPlot = new Plot(600, 340, 0, 10, 0, 10);

const distance2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export type Seeding = 'random' | 'plus-plus';

/** Lloyd's algorithm, one half-step at a time: assign every point, then move every centre. */
export class KMeans {
  centres: Point[];
  /** The previous position of each centre, for drawing how far it moved. */
  previous: Point[] = [];
  /** Which centre each point belongs to, or -1 before the first assignment. */
  assignment: number[];
  iteration = 0;
  next: 'assign' | 'update' = 'assign';
  converged = false;

  constructor(readonly points: Point[], readonly k: number, seed: number, seeding: Seeding = 'random') {
    const random = seeded(seed * 7919 + k);
    this.assignment = points.map(() => -1);
    if (seeding === 'random') {
      // k different points, chosen uniformly.
      const pool = [...points.keys()];
      this.centres = Array.from({ length: k }, () => ({ ...points[pool.splice(Math.floor(random() * pool.length), 1)[0]] }));
    } else {
      // k-means++: each new centre is chosen with probability proportional to
      // its squared distance from the nearest centre already chosen.
      this.centres = [{ ...points[Math.floor(random() * points.length)] }];
      while (this.centres.length < k) {
        const weights = points.map((p) => Math.min(...this.centres.map((c) => distance2(p, c))));
        let r = random() * weights.reduce((a, b) => a + b, 0);
        let index = 0;
        while (index < points.length - 1 && r >= weights[index]) r -= weights[index++];
        this.centres.push({ ...points[index] });
      }
    }
  }

  nearest(p: Point) {
    let best = 0;
    for (let c = 1; c < this.centres.length; c++) if (distance2(p, this.centres[c]) < distance2(p, this.centres[best])) best = c;
    return best;
  }

  /** Takes one half-step and says what happened. */
  step(): string {
    if (this.converged) return 'Nothing changed in the last round, so the algorithm has converged.';
    if (this.next === 'assign') {
      const before = this.assignment;
      this.assignment = this.points.map((p) => this.nearest(p));
      this.next = 'update';
      this.previous = [];
      const moved = this.assignment.filter((c, i) => c !== before[i]).length;
      if (this.iteration > 0 && moved === 0) {
        this.converged = true;
        return `Every point is already with its nearest centre. Nothing changed, so k-means has converged after ${this.iteration} rounds.`;
      }
      return this.iteration === 0
        ? 'Assign: each point joins the centre nearest to it.'
        : `Assign: each point joins its nearest centre. ${moved} ${moved === 1 ? 'point' : 'points'} changed cluster.`;
    }
    this.previous = this.centres.map((c) => ({ ...c }));
    this.centres = this.centres.map((centre, c) => {
      const members = this.points.filter((_, i) => this.assignment[i] === c);
      // A centre that lost all its points stays where it is.
      return members.length ? { x: mean(members.map((p) => p.x)), y: mean(members.map((p) => p.y)) } : centre;
    });
    this.next = 'assign';
    this.iteration += 1;
    return 'Update: each centre moves to the mean of the points assigned to it.';
  }

  /** The sum of squared distances from each point to its centre, the quantity k-means reduces. */
  inertia(): number {
    if (this.assignment[0] === -1) return this.points.reduce((sum, p) => sum + distance2(p, this.centres[this.nearest(p)]), 0);
    return this.points.reduce((sum, p, i) => sum + distance2(p, this.centres[this.assignment[i]]), 0);
  }
}

export function kmeansSvg(model: KMeans, plot = clusterPlot): string {
  const dots = model.points.map(
    (p, i) =>
      `<circle class="ml-member" data-cluster="${model.assignment[i]}" cx="${plot.px(p.x).toFixed(1)}" cy="${plot.py(p.y).toFixed(1)}" r="4.5"/>`,
  );
  const moves = model.previous.map(
    (from, c) =>
      `<line class="ml-move" x1="${plot.px(from.x).toFixed(1)}" y1="${plot.py(from.y).toFixed(1)}" x2="${plot.px(model.centres[c].x).toFixed(1)}" y2="${plot.py(model.centres[c].y).toFixed(1)}"/>`,
  );
  const centres = model.centres.map((c, i) => {
    const x = plot.px(c.x);
    const y = plot.py(c.y);
    return `<g class="ml-centre" data-cluster="${i}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"/><path d="M${x - 4},${y}H${x + 4}M${x},${y - 4}V${y + 4}"/></g>`;
  });
  return plot.axes([0, 2, 4, 6, 8, 10], [0, 2, 4, 6, 8, 10]) + plot.clip(dots.join('') + moves.join('') + centres.join(''));
}

/* ---------- Neural networks ---------- */

export type Dataset = 'line' | 'xor' | 'circle';

export function dataset(name: Dataset): Labelled[] {
  const random = seeded({ line: 3, xor: 5, circle: 9 }[name]);
  const uniform = () => random() * 2 - 1;
  if (name === 'xor') {
    return [
      [-0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
      [0.5, -0.5],
    ].flatMap(([cx, cy], i) =>
      Array.from({ length: 18 }, () => ({ x: cx + 0.2 * gaussian(random), y: cy + 0.2 * gaussian(random), label: (i < 2 ? 1 : 0) as 0 | 1 })),
    );
  }
  if (name === 'circle') {
    return Array.from({ length: 80 }, (_, i) => {
      const inner = i % 2 === 0;
      const angle = random() * 2 * Math.PI;
      const radius = inner ? 0.42 * Math.sqrt(random()) : 0.62 + 0.3 * random();
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), label: (inner ? 1 : 0) as 0 | 1 };
    });
  }
  return Array.from({ length: 70 }, () => {
    const x = uniform();
    const y = uniform();
    return { x, y, label: (y > 0.6 * x - 0.15 ? 1 : 0) as 0 | 1 };
  });
}

/**
 * A network with two inputs, one hidden layer of tanh units and one sigmoid
 * output, trained on the cross-entropy loss by full-batch gradient descent.
 * With no hidden units it is logistic regression: a single neuron.
 */
export class Network {
  /** hidden × 2 input weights, or empty. */
  w1: number[][];
  b1: number[];
  /** Output weights, one per hidden unit, or one per input with no hidden layer. */
  w2: number[];
  b2 = 0;
  epoch = 0;

  constructor(readonly hidden: number, seed = 1) {
    const random = seeded(seed * 31 + hidden);
    const init = (fanIn: number) => (random() * 2 - 1) * Math.sqrt(3 / fanIn);
    this.w1 = Array.from({ length: hidden }, () => [init(2) * 2, init(2) * 2]);
    this.b1 = Array.from({ length: hidden }, () => init(2));
    this.w2 = Array.from({ length: hidden || 2 }, () => init(hidden || 2));
  }

  /** The hidden activations and the output probability for one input. */
  forward(x: number, y: number): { h: number[]; p: number } {
    const h = this.hidden ? this.w1.map(([a, b], j) => Math.tanh(a * x + b * y + this.b1[j])) : [x, y];
    return { h, p: sigmoid(h.reduce((sum, value, j) => sum + value * this.w2[j], this.b2)) };
  }

  predict(x: number, y: number) {
    return this.forward(x, y).p;
  }

  loss(points: Labelled[]) {
    return mean(points.map(({ x, y, label }) => {
      const p = Math.min(1 - 1e-9, Math.max(1e-9, this.predict(x, y)));
      return -(label ? Math.log(p) : Math.log(1 - p));
    }));
  }

  accuracy(points: Labelled[]) {
    return mean(points.map(({ x, y, label }) => ((this.predict(x, y) > 0.5 ? 1 : 0) === label ? 1 : 0)));
  }

  /** One step of gradient descent over every point, with the gradient found by backpropagation. */
  train(points: Labelled[], rate: number) {
    const gw1 = this.w1.map(() => [0, 0]);
    const gb1 = this.b1.map(() => 0);
    const gw2 = this.w2.map(() => 0);
    let gb2 = 0;
    for (const { x, y, label } of points) {
      const { h, p } = this.forward(x, y);
      // For a sigmoid output and cross-entropy loss, the gradient at the output's input is just p - label.
      const delta = p - label;
      gb2 += delta;
      h.forEach((value, j) => (gw2[j] += delta * value));
      for (let j = 0; j < this.hidden; j++) {
        // Pass the error back through the output weight, then through tanh, whose slope is 1 - tanh².
        const back = delta * this.w2[j] * (1 - h[j] ** 2);
        gb1[j] += back;
        gw1[j][0] += back * x;
        gw1[j][1] += back * y;
      }
    }
    const step = rate / points.length;
    this.b2 -= step * gb2;
    this.w2 = this.w2.map((w, j) => w - step * gw2[j]);
    this.b1 = this.b1.map((b, j) => b - step * gb1[j]);
    this.w1 = this.w1.map(([a, b], j) => [a - step * gw1[j][0], b - step * gw1[j][1]]);
    this.epoch += 1;
  }
}

export const fieldPlot = new Plot(340, 340, -1.1, 1.1, -1.1, 1.1, 8, 8, 8, 8);

/** The network's answer at every point of the plane, shaded, with the training points on top. */
export function fieldSvg(net: Network, points: Labelled[], plot = fieldPlot): string {
  const cells = 34;
  const cw = (plot.width - plot.left - plot.right) / cells;
  const ch = (plot.height - plot.top - plot.bottom) / cells;
  const out: string[] = [];
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const { x, y } = plot.data(plot.left + (i + 0.5) * cw, plot.top + (j + 0.5) * ch);
      const p = net.predict(x, y);
      out.push(
        `<rect class="ml-cell" data-class="${p > 0.5 ? 1 : 0}" x="${(plot.left + i * cw).toFixed(2)}" y="${(plot.top + j * ch).toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" style="fill-opacity:${(Math.abs(p - 0.5) * 0.9).toFixed(3)}"/>`,
      );
    }
  }
  for (const { x, y, label } of points) {
    out.push(`<circle class="ml-sample" data-class="${label}" cx="${plot.px(x).toFixed(1)}" cy="${plot.py(y).toFixed(1)}" r="4"/>`);
  }
  return out.join('');
}

/** The network itself: inputs, hidden units and output, with each weight as a line whose width is its size. */
export function networkSvg(net: Network, width = 240, height = 340): string {
  const layerX = net.hidden ? [30, width / 2, width - 30] : [40, width - 40];
  const column = (count: number, x: number) =>
    Array.from({ length: count }, (_, i) => ({ x, y: (height * (i + 1)) / (count + 1) }));
  const inputs = column(2, layerX[0]);
  const hidden = column(net.hidden, layerX[1]);
  const output = column(1, layerX.at(-1)!)[0];
  const edge = (a: Point, b: Point, w: number) =>
    `<line class="ml-weight" data-sign="${w >= 0 ? '+' : '-'}" x1="${a.x}" y1="${a.y.toFixed(1)}" x2="${b.x}" y2="${b.y.toFixed(1)}" style="stroke-width:${Math.min(7, 0.6 + Math.abs(w) * 1.3).toFixed(2)}"/>`;
  const node = (p: Point, label: string) =>
    `<g class="ml-unit"><circle cx="${p.x}" cy="${p.y.toFixed(1)}" r="13"/><text x="${p.x}" y="${p.y.toFixed(1)}">${label}</text></g>`;
  const edges = net.hidden
    ? [
        ...hidden.flatMap((h, j) => inputs.map((i, k) => edge(i, h, net.w1[j][k]))),
        ...hidden.map((h, j) => edge(h, output, net.w2[j])),
      ]
    : inputs.map((i, k) => edge(i, output, net.w2[k]));
  return [
    ...edges,
    node(inputs[0], 'x'),
    node(inputs[1], 'y'),
    ...hidden.map((h) => node(h, 'tanh')),
    node(output, 'σ'),
  ].join('');
}

/* ---------- Backpropagation ---------- */

export interface Neuron {
  x1: number;
  x2: number;
  w1: number;
  w2: number;
  b: number;
  /** The answer the neuron should give. */
  t: number;
}

export const startNeuron: Neuron = { x1: 2, x2: -1, w1: 0.5, w2: 1, b: 0, t: 1 };

export type NodeId = 'x1' | 'w1' | 'x2' | 'w2' | 'b' | 't' | 'm1' | 'm2' | 's' | 'a' | 'L';

interface GraphNode {
  id: NodeId;
  label: string;
  x: number;
  y: number;
  inputs: NodeId[];
}

/** The neuron's computation as a graph: L = (σ(w1·x1 + w2·x2 + b) − t)². */
export const graphNodes: GraphNode[] = [
  { id: 'x1', label: 'x₁', x: 60, y: 36, inputs: [] },
  { id: 'w1', label: 'w₁', x: 60, y: 104, inputs: [] },
  { id: 'x2', label: 'x₂', x: 60, y: 172, inputs: [] },
  { id: 'w2', label: 'w₂', x: 60, y: 240, inputs: [] },
  { id: 'b', label: 'b', x: 200, y: 260, inputs: [] },
  { id: 'm1', label: '×', x: 200, y: 70, inputs: ['x1', 'w1'] },
  { id: 'm2', label: '×', x: 200, y: 180, inputs: ['x2', 'w2'] },
  { id: 's', label: '+', x: 330, y: 150, inputs: ['m1', 'm2', 'b'] },
  { id: 'a', label: 'σ', x: 450, y: 150, inputs: ['s'] },
  { id: 't', label: 't', x: 450, y: 250, inputs: [] },
  { id: 'L', label: '(a − t)²', x: 570, y: 150, inputs: ['a', 't'] },
];

export const learnable: NodeId[] = ['w1', 'w2', 'b'];

/** Every value in the forward pass and every gradient in the backward pass. */
export function evaluate(n: Neuron): { value: Record<NodeId, number>; grad: Record<NodeId, number> } {
  const m1 = n.w1 * n.x1;
  const m2 = n.w2 * n.x2;
  const s = m1 + m2 + n.b;
  const a = sigmoid(s);
  const L = (a - n.t) ** 2;
  const dL = 1;
  const da = 2 * (a - n.t) * dL;
  const ds = a * (1 - a) * da;
  return {
    value: { x1: n.x1, w1: n.w1, x2: n.x2, w2: n.w2, b: n.b, t: n.t, m1, m2, s, a, L },
    grad: { L: dL, a: da, t: 0, s: ds, m1: ds, m2: ds, b: ds, w1: ds * n.x1, x1: ds * n.w1, w2: ds * n.x2, x2: ds * n.w2 },
  };
}

export interface BackpropEvent {
  phase: 'forward' | 'backward' | 'update';
  node?: NodeId;
}

/** One full round: compute each value left to right, each gradient right to left, then update the weights. */
export const backpropRound: BackpropEvent[] = [
  ...(['m1', 'm2', 's', 'a', 'L'] as NodeId[]).map((node) => ({ phase: 'forward' as const, node })),
  ...(['L', 'a', 's', 'm1', 'm2', 'b', 'w1', 'x1', 'w2', 'x2'] as NodeId[]).map((node) => ({ phase: 'backward' as const, node })),
  { phase: 'update' },
];

/** What the event at `index` of the round does, in a sentence, using the actual numbers. */
export function explain(n: Neuron, index: number, rate: number): string {
  const event = backpropRound[index];
  const { value: v, grad: g } = evaluate(n);
  const f = (x: number) => fmt(x, 3);
  if (event.phase === 'update') {
    return `Update: move each weight a step against its gradient, with learning rate ${rate}. w₁ becomes ${f(n.w1)} − ${rate} × ${f(g.w1)} = ${f(n.w1 - rate * g.w1)}, w₂ becomes ${f(n.w2 - rate * g.w2)} and b becomes ${f(n.b - rate * g.b)}.`;
  }
  if (event.phase === 'forward') {
    switch (event.node) {
      case 'm1': return `Forward: multiply. w₁ × x₁ = ${f(n.w1)} × ${f(n.x1)} = ${f(v.m1)}.`;
      case 'm2': return `Forward: multiply. w₂ × x₂ = ${f(n.w2)} × ${f(n.x2)} = ${f(v.m2)}.`;
      case 's': return `Forward: add the two products and the bias. ${f(v.m1)} + ${f(v.m2)} + ${f(n.b)} = ${f(v.s)}.`;
      case 'a': return `Forward: squash with the sigmoid. σ(${f(v.s)}) = ${f(v.a)}, the neuron's answer.`;
      default: return `Forward: the loss. (${f(v.a)} − ${f(n.t)})² = ${f(v.L)}. The neuron should have said ${f(n.t)}.`;
    }
  }
  switch (event.node) {
    case 'L': return 'Backward: start at the loss. Its gradient with respect to itself is 1.';
    case 'a': return `Backward through the square: the local slope of (a − t)² is 2(a − t) = ${f(2 * (v.a - n.t))}. Times the incoming 1 gives ${f(g.a)}.`;
    case 's': return `Backward through the sigmoid: its local slope is a(1 − a) = ${f(v.a * (1 - v.a))}. Times the incoming ${f(g.a)} gives ${f(g.s)}.`;
    case 'm1':
    case 'm2':
      return `Backward through +: addition passes the gradient through unchanged, so this input also gets ${f(g.s)}.`;
    case 'b': return `The bias is the third input to +, so it gets ${f(g.b)} too. ${g.b < 0 ? 'Negative, so a larger b would lower the loss.' : 'Positive, so a smaller b would lower the loss.'}`;
    case 'w1': return `Backward through ×: each input's gradient is the incoming gradient times the other input. For w₁ that is ${f(g.m1)} × x₁ = ${f(g.m1)} × ${f(n.x1)} = ${f(g.w1)}.`;
    case 'x1': return `And for x₁ it is ${f(g.m1)} × w₁ = ${f(g.x1)}. An input cannot be changed, but in a deeper network this gradient would carry on backwards into the layer before.`;
    case 'w2': return `The same rule on the other ×: w₂ gets ${f(g.m2)} × x₂ = ${f(g.m2)} × ${f(n.x2)} = ${f(g.w2)}.`;
    default: return `And x₂ gets ${f(g.m2)} × w₂ = ${f(g.x2)}. Every gradient is now known.`;
  }
}

/** Applies the update at the end of a round. */
export function update(n: Neuron, rate: number): Neuron {
  const { grad } = evaluate(n);
  return { ...n, w1: n.w1 - rate * grad.w1, w2: n.w2 - rate * grad.w2, b: n.b - rate * grad.b };
}

/**
 * The graph, showing each value once it has been computed in this round and
 * each gradient once it has been passed back. `index` is the next event to run.
 */
export function backpropSvg(n: Neuron, index: number): string {
  const { value, grad } = evaluate(n);
  const done = backpropRound.slice(0, index);
  const forward = new Set<NodeId>(['x1', 'w1', 'x2', 'w2', 'b', 't']);
  const backward = new Set<NodeId>();
  for (const event of done) {
    if (event.phase === 'forward') forward.add(event.node!);
    if (event.phase === 'backward') backward.add(event.node!);
  }
  const current = backpropRound[index - 1];
  const byId = new Map(graphNodes.map((node) => [node.id, node]));
  const W = 54;
  const H = 21;
  const edges = graphNodes.flatMap((node) =>
    node.inputs.map((from) => {
      const a = byId.get(from)!;
      const x1 = a.x + W;
      const x2 = node.x - W;
      const mid = (x1 + x2) / 2;
      // A value flows into the node being computed; a gradient flows back out of the node receiving it.
      const state = current?.phase === 'forward' && current.node === node.id ? ' on' : current?.phase === 'backward' && current.node === from ? ' back' : '';
      return `<path class="ml-edge${state}" d="M${x1},${a.y}C${mid},${a.y} ${mid},${node.y} ${x2},${node.y}"/>`;
    }),
  );
  const nodes = graphNodes.map((node) => {
    const isCurrent = current?.node === node.id;
    const showValue = forward.has(node.id);
    const showGrad = backward.has(node.id);
    const learn = learnable.includes(node.id);
    return (
      `<g class="ml-gnode${isCurrent ? (current.phase === 'forward' ? ' hl' : ' alt') : ''}${learn ? ' learn' : ''}">` +
      `<rect x="${node.x - W}" y="${node.y - H}" width="${W * 2}" height="${H * 2}" rx="6"/>` +
      `<text class="ml-gname" x="${node.x}" y="${node.y - H - 9}">${node.label}</text>` +
      `<text class="ml-gvalue" x="${node.x}" y="${node.y - 7}">${showValue ? fmt(value[node.id], 3) : ''}</text>` +
      `<text class="ml-ggrad" x="${node.x}" y="${node.y + 9}">${showGrad ? `∂ ${fmt(grad[node.id], 3)}` : ''}</text>` +
      '</g>'
    );
  });
  return edges.join('') + nodes.join('');
}

/* ---------- Decision trees ---------- */

/**
 * Points in two classes, from a rule a tree can learn with a few questions:
 * class 1 in the upper right, and in a smaller patch in the upper left. About
 * one label in eight is flipped, as noise.
 */
function treeSample(count: number, seed: number): Labelled[] {
  const random = seeded(seed);
  return Array.from({ length: count }, () => {
    const x = random() * 10;
    const y = random() * 10;
    const truth = (x > 5.5 && y > 3.5) || (x < 3 && y > 7);
    const noisy = random() < 0.12 ? !truth : truth;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, label: (noisy ? 1 : 0) as 0 | 1 };
  });
}

export const treeTrain = treeSample(90, 12);
export const treeTest = treeSample(300, 77);
export const treePlot = new Plot(600, 340, 0, 10, 0, 10);

export type Impurity = 'entropy' | 'gini';

export function impurity(ones: number, total: number, kind: Impurity): number {
  if (!total) return 0;
  const p = ones / total;
  if (kind === 'gini') return 2 * p * (1 - p);
  const h = (q: number) => (q > 0 ? -q * Math.log2(q) : 0);
  return h(p) + h(1 - p);
}

export interface TreeNode {
  /** Majority label, and how many of each label reached the node. */
  label: 0 | 1;
  counts: [number, number];
  impurity: number;
  /** Set on a split node: points with feature < threshold go left. */
  feature?: 'x' | 'y';
  threshold?: number;
  gain?: number;
  left?: TreeNode;
  right?: TreeNode;
  /** The region of the plane this node covers. */
  box: { x0: number; x1: number; y0: number; y1: number };
}

/** Grows a tree greedily: at each node, the split that lowers impurity the most. */
export function growTree(points: Labelled[], maxDepth: number, kind: Impurity, box = { x0: 0, x1: 10, y0: 0, y1: 10 }, depth = 0): TreeNode {
  const ones = points.filter((p) => p.label === 1).length;
  const node: TreeNode = {
    label: ones * 2 > points.length ? 1 : 0,
    counts: [points.length - ones, ones],
    impurity: impurity(ones, points.length, kind),
    box,
  };
  if (depth >= maxDepth || node.impurity === 0 || points.length < 2) return node;

  let best: { feature: 'x' | 'y'; threshold: number; gain: number } | null = null;
  for (const feature of ['x', 'y'] as const) {
    const sorted = [...points].sort((a, b) => a[feature] - b[feature]);
    let leftOnes = 0;
    for (let i = 1; i < sorted.length; i++) {
      leftOnes += sorted[i - 1].label;
      if (sorted[i][feature] === sorted[i - 1][feature]) continue;
      const n = sorted.length;
      const after = (i / n) * impurity(leftOnes, i, kind) + ((n - i) / n) * impurity(ones - leftOnes, n - i, kind);
      const gain = node.impurity - after;
      if (gain > 1e-9 && (!best || gain > best.gain)) best = { feature, threshold: (sorted[i][feature] + sorted[i - 1][feature]) / 2, gain };
    }
  }
  if (!best) return node;
  const { feature, threshold } = best;
  node.feature = feature;
  node.threshold = Math.round(threshold * 100) / 100;
  node.gain = best.gain;
  const leftBox = feature === 'x' ? { ...box, x1: threshold } : { ...box, y1: threshold };
  const rightBox = feature === 'x' ? { ...box, x0: threshold } : { ...box, y0: threshold };
  node.left = growTree(points.filter((p) => p[feature] < threshold), maxDepth, kind, leftBox, depth + 1);
  node.right = growTree(points.filter((p) => p[feature] >= threshold), maxDepth, kind, rightBox, depth + 1);
  return node;
}

export function predict(node: TreeNode, p: Point): 0 | 1 {
  while (node.feature) node = p[node.feature] < node.threshold! ? node.left! : node.right!;
  return node.label;
}

export function leaves(node: TreeNode): TreeNode[] {
  return node.feature ? [...leaves(node.left!), ...leaves(node.right!)] : [node];
}

export const accuracy = (node: TreeNode, points: Labelled[]) => points.filter((p) => predict(node, p) === p.label).length / Math.max(points.length, 1);

export function treeSvg(root: TreeNode, showTest: boolean, plot = treePlot): string {
  const regions = leaves(root).map((leaf) => {
    const { x0, x1, y0, y1 } = leaf.box;
    return `<rect class="ml-cell dt-region" data-class="${leaf.label}" x="${plot.px(x0).toFixed(1)}" y="${plot.py(y1).toFixed(1)}" width="${(plot.px(x1) - plot.px(x0)).toFixed(1)}" height="${(plot.py(y0) - plot.py(y1)).toFixed(1)}"/>`;
  });
  const cuts: string[] = [];
  const walk = (node: TreeNode, depth: number) => {
    if (!node.feature) return;
    const { x0, x1, y0, y1 } = node.box;
    const t = node.threshold!;
    const [ax, ay, bx, by] = node.feature === 'x' ? [t, y0, t, y1] : [x0, t, x1, t];
    cuts.push(`<line class="dt-cut" data-depth="${Math.min(depth, 3)}" x1="${plot.px(ax).toFixed(1)}" y1="${plot.py(ay).toFixed(1)}" x2="${plot.px(bx).toFixed(1)}" y2="${plot.py(by).toFixed(1)}"/>`);
    walk(node.left!, depth + 1);
    walk(node.right!, depth + 1);
  };
  walk(root, 0);
  const dots = (showTest ? treeTest : treeTrain).map(
    (p) => `<circle class="ml-sample${showTest ? ' dt-test' : ''}" data-class="${p.label}" cx="${plot.px(p.x).toFixed(1)}" cy="${plot.py(p.y).toFixed(1)}" r="${showTest ? 3 : 4.5}"/>`,
  );
  return plot.axes([0, 2, 4, 6, 8, 10], [0, 2, 4, 6, 8, 10], 'x', 'y') + plot.clip(regions.join('') + cuts.join('') + dots.join(''));
}

/** The tree as nested questions, for reading beside the plot. */
export function treeOutline(node: TreeNode, kind: Impurity): string {
  const name = kind === 'entropy' ? 'entropy' : 'Gini';
  const leaf = (n: TreeNode) =>
    `<span class="dt-leaf" data-class="${n.label}">class ${n.label === 1 ? 'blue' : 'orange'}</span> <small>${n.counts[1]} blue, ${n.counts[0]} orange</small>`;
  const render = (n: TreeNode): string => {
    if (!n.feature) return `<li>${leaf(n)}</li>`;
    return (
      `<li><span class="dt-q">${n.feature} &lt; ${n.threshold}?</span> <small>${name} ${fmt(n.impurity)}, gain ${fmt(n.gain!)}</small>` +
      `<ul><li class="dt-branch">yes<ul>${render(n.left!)}</ul></li><li class="dt-branch">no<ul>${render(n.right!)}</ul></li></ul></li>`
    );
  };
  return `<ul class="dt-tree">${render(node)}</ul>`;
}

/* ---------- Attention ---------- */

/**
 * One attention head with hand-set weights, small enough to read. Every token
 * has a key saying what it is and a query saying what it looks for, over seven
 * named features. A real model learns vectors like these, with hundreds of
 * unnamed dimensions.
 */
export const attentionFeatures = ['creature', 'place', 'action', 'pronoun', 'tiredness', 'width', 'filler'];

type Vec = number[];
const feature = (entries: Record<string, number>): Vec => attentionFeatures.map((f) => entries[f] ?? 0);

interface TokenSpec {
  word: string;
  key: Vec;
  query: Vec;
}

export type Ending = 'tired' | 'wide';

export function attentionTokens(ending: Ending): TokenSpec[] {
  const filler = { key: feature({ filler: 1 }), query: feature({ filler: 0.6 }) };
  return [
    { word: 'The', ...filler },
    { word: 'animal', key: feature({ creature: 3 }), query: feature({ filler: 1.4 }) },
    { word: "didn't", key: feature({ action: 1, filler: 0.6 }), query: feature({ action: 2 }) },
    { word: 'cross', key: feature({ action: 2 }), query: feature({ creature: 1.4, place: 1.4 }) },
    { word: 'the', ...filler },
    { word: 'street', key: feature({ place: 3 }), query: feature({ filler: 1.4 }) },
    { word: 'because', key: feature({ filler: 1 }), query: feature({ action: 1.2 }) },
    { word: 'it', key: feature({ pronoun: 2.4 }), query: feature({ creature: 1, place: 1 }) },
    { word: 'was', key: feature({ action: 1 }), query: feature({ pronoun: 1.8 }) },
    { word: 'too', ...filler },
    ending === 'tired'
      ? { word: 'tired', key: feature({ tiredness: 2.5 }), query: feature({ pronoun: 1.2, creature: 1 }) }
      : { word: 'wide', key: feature({ width: 2.5 }), query: feature({ pronoun: 1.2, place: 1 }) },
  ];
}

export interface AttentionOptions {
  ending: Ending;
  causal: boolean;
  scaled: boolean;
}

/**
 * The attention weights: for each token, a softmax over the scores q · k of
 * the tokens it may look at. In this toy, "it" has already absorbed what
 * comes after it (as an earlier layer would have), so its query leans towards
 * creatures when the sentence ends "tired" and places when it ends "wide".
 * Under a causal mask it cannot see the ending, and the hint is lost.
 */
export function attention({ ending, causal, scaled }: AttentionOptions) {
  const tokens = attentionTokens(ending);
  const queries = tokens.map((t) => [...t.query]);
  const it = tokens.findIndex((t) => t.word === 'it');
  if (!causal) {
    const hint = ending === 'tired' ? 'creature' : 'place';
    queries[it][attentionFeatures.indexOf(hint)] += 1.6;
  }
  const d = attentionFeatures.length;
  const scores = queries.map((q, i) =>
    tokens.map((t, j) => (causal && j > i ? -Infinity : q.reduce((sum, qk, f) => sum + qk * t.key[f], 0) / (scaled ? Math.sqrt(d) : 1))),
  );
  const weights = scores.map((row) => {
    const top = Math.max(...row);
    const exps = row.map((s) => (s === -Infinity ? 0 : Math.exp(s - top)));
    const total = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / total);
  });
  return { words: tokens.map((t) => t.word), scores, weights };
}

export const attentionView = { cell: 30, left: 66, top: 62 };

export function attentionSvg(weights: number[][], words: string[], selected: number, view = attentionView): string {
  const { cell, left, top } = view;
  const parts: string[] = [];
  words.forEach((w, j) => {
    const x = left + j * cell + cell / 2;
    parts.push(`<text class="at-word at-col${j === selected ? ' on' : ''}" transform="translate(${x - 2} ${top - 6}) rotate(-55)">${w}</text>`);
  });
  weights.forEach((row, i) => {
    const y = top + i * cell;
    parts.push(`<g class="at-row${i === selected ? ' on' : ''}" data-row="${i}"><rect class="at-hit" x="0" y="${y}" width="${left + words.length * cell}" height="${cell}"/><text class="at-word" x="${left - 8}" y="${y + cell / 2}">${words[i]}</text>`);
    row.forEach((w, j) => {
      parts.push(`<rect class="at-cell${weights[i][j] === 0 && j > i ? ' masked' : ''}" x="${left + j * cell + 1}" y="${y + 1}" width="${cell - 2}" height="${cell - 2}" style="fill-opacity:${Math.max(0.03, Math.sqrt(w)).toFixed(3)}"/>`);
    });
    parts.push('</g>');
  });
  parts.push(`<rect class="at-frame" x="${left}" y="${top + selected * cell}" width="${words.length * cell}" height="${cell}"/>`);
  return parts.join('');
}

export const attentionSize = (n: number, view = attentionView) => ({ width: view.left + n * view.cell + 40, height: view.top + n * view.cell + 4 });
