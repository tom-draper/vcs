// Models behind the software engineering widgets: a tiny Git with commits,
// branches, merges and rebases over content-addressed objects; line coverage
// and mutation testing on a small function; and an incremental build over a
// dependency graph, scheduled across workers.
import { hash } from './distributed';

/* ---------- Version control ---------- */

/** A short hex name for some content, as Git shows the first 7 characters of a SHA-1. */
export const objectId = (content: string) => hash(content).toString(16).padStart(8, '0').slice(0, 7);

export interface Commit {
  id: string;
  parents: string[];
  message: string;
  /** The snapshot: every file's full content. */
  files: Record<string, string>;
  tree: string;
  /** Where to draw it: creation order across, branch row down. */
  x: number;
  row: number;
  /** Left behind by a rebase, and no longer reachable from any branch. */
  orphan?: boolean;
}

const blobId = (content: string) => objectId(`blob ${content}`);
const treeId = (files: Record<string, string>) =>
  objectId(`tree ${Object.keys(files).sort().map((name) => `${name} ${blobId(files[name])}`).join('\n')}`);

const edits: Record<string, string[]> = {
  'app.py': ['print("hello")', 'print("hello, world")', 'name = input()\nprint("hello,", name)', 'main()'],
  'README.md': ['# App', '# App\nSays hello.', '# App\nSays hello, politely.'],
  'util.py': ['def greet(): ...', 'def greet(name): ...', 'def greet(name, loud=False): ...'],
};

export class Repo {
  commits = new Map<string, Commit>();
  branches: Record<string, string> = {};
  rows: Record<string, number> = { main: 0 };
  head = 'main';
  private clock = 0;
  private editCount = 0;

  constructor() {
    this.write([], 'Initial commit', { 'README.md': edits['README.md'][0], 'app.py': edits['app.py'][0] }, 0);
    this.branches.main = [...this.commits.keys()][0];
    this.commit();
  }

  private write(parents: string[], message: string, files: Record<string, string>, row: number): Commit {
    const tree = treeId(files);
    const id = objectId(`commit ${tree} ${parents.join(' ')} ${message} ${this.clock}`);
    const commit: Commit = { id, parents, message, files, tree, x: this.clock++, row };
    this.commits.set(id, commit);
    return commit;
  }

  get current() {
    return this.commits.get(this.branches[this.head])!;
  }

  /** Change one file on the current branch, choosing a different file each time. */
  commit(): Commit {
    const names = Object.keys(edits);
    const name = names[this.editCount % names.length];
    const versions = edits[name];
    const files = { ...this.current.files };
    const now = files[name];
    const next = versions[(versions.indexOf(now) + 1) % versions.length] ?? versions[0];
    files[name] = now === next ? `${next}\n# edit ${this.editCount}` : next;
    this.editCount++;
    const verb = now === undefined ? 'Add' : 'Edit';
    const commit = this.write([this.current.id], `${verb} ${name}`, files, this.rows[this.head]);
    this.branches[this.head] = commit.id;
    return commit;
  }

  branch(name: string) {
    if (this.branches[name]) return false;
    this.branches[name] = this.current.id;
    this.rows[name] = Math.max(...Object.values(this.rows)) + 1;
    this.head = name;
    return true;
  }

  switchTo(name: string) {
    this.head = name;
  }

  ancestors(id: string): Set<string> {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c)) continue;
      seen.add(c);
      stack.push(...this.commits.get(c)!.parents);
    }
    return seen;
  }

  /** The nearest commit both branches have in their history. */
  mergeBase(a: string, b: string): string {
    const theirs = this.ancestors(b);
    const queue = [a];
    const seen = new Set<string>();
    while (queue.length) {
      const c = queue.shift()!;
      if (theirs.has(c)) return c;
      if (seen.has(c)) continue;
      seen.add(c);
      queue.push(...this.commits.get(c)!.parents);
    }
    return a;
  }

  /** Merge another branch into the current one. Returns what kind of merge it was. */
  merge(other: string): { kind: 'up to date' | 'fast-forward' | 'merge'; conflicts: string[] } {
    const ours = this.current;
    const theirs = this.commits.get(this.branches[other])!;
    if (this.ancestors(ours.id).has(theirs.id)) return { kind: 'up to date', conflicts: [] };
    if (this.ancestors(theirs.id).has(ours.id)) {
      this.branches[this.head] = theirs.id;
      return { kind: 'fast-forward', conflicts: [] };
    }
    const base = this.commits.get(this.mergeBase(ours.id, theirs.id))!;
    const files: Record<string, string> = {};
    const conflicts: string[] = [];
    for (const name of new Set([...Object.keys(ours.files), ...Object.keys(theirs.files)])) {
      const [b, o, t] = [base.files[name], ours.files[name], theirs.files[name]];
      // A three-way merge: take whichever side changed the file. If both did, differently, it conflicts.
      if (o === t || t === b) files[name] = o;
      else if (o === b) files[name] = t;
      else {
        conflicts.push(name);
        files[name] = `${o}\n${t}`;
      }
    }
    const commit = this.write([ours.id, theirs.id], `Merge ${other} into ${this.head}`, files, this.rows[this.head]);
    this.branches[this.head] = commit.id;
    return { kind: 'merge', conflicts };
  }

  /** Replay the current branch's own commits on top of another branch. Returns how many were copied. */
  rebase(onto: string): number {
    const ours = this.current;
    const target = this.commits.get(this.branches[onto])!;
    const base = this.mergeBase(ours.id, target.id);
    const mine: Commit[] = [];
    for (let c = ours; c.id !== base; c = this.commits.get(c.parents[0])!) {
      if (c.parents.length > 1) break;
      mine.unshift(c);
    }
    if (!mine.length || base === target.id) return 0;
    let tip = target;
    for (const old of mine) {
      const parent = this.commits.get(old.parents[0])!;
      const files = { ...tip.files };
      // Apply the same change the old commit made to its parent.
      for (const name of Object.keys(old.files)) if (old.files[name] !== parent.files[name]) files[name] = old.files[name];
      tip = this.write([tip.id], old.message, files, this.rows[this.head]);
      old.orphan = true;
    }
    this.branches[this.head] = tip.id;
    return mine.length;
  }

  reachable(): Set<string> {
    const all = new Set<string>();
    for (const id of Object.values(this.branches)) for (const c of this.ancestors(id)) all.add(c);
    return all;
  }
}

export const gitView = { step: 62, row: 58, left: 40, top: 46 };

export function gitSvg(repo: Repo, selected: string | null, view = gitView) {
  const reachable = repo.reachable();
  const commits = [...repo.commits.values()];
  const at = (c: Commit) => ({ x: view.left + c.x * view.step, y: view.top + c.row * view.row });
  const width = view.left * 2 + Math.max(...commits.map((c) => c.x)) * view.step + 60;
  const height = view.top + Math.max(...Object.values(repo.rows)) * view.row + 40;
  const parts: string[] = [];
  for (const c of commits) {
    for (const p of c.parents) {
      const a = at(repo.commits.get(p)!);
      const b = at(c);
      const faded = !reachable.has(c.id);
      const path = a.y === b.y ? `M${a.x},${a.y} L${b.x},${b.y}` : `M${a.x},${a.y} C${a.x + view.step * 0.6},${a.y} ${b.x - view.step * 0.6},${b.y} ${b.x},${b.y}`;
      parts.push(`<path class="git-edge${faded ? ' orphan' : ''}" d="${path}"/>`);
    }
  }
  for (const c of commits) {
    const { x, y } = at(c);
    const cls = !reachable.has(c.id) ? ' orphan' : c.id === selected ? ' on' : '';
    parts.push(`<g class="git-commit${cls}" data-commit="${c.id}"><circle cx="${x}" cy="${y}" r="13"/><text class="git-id" x="${x}" y="${y + 24}">${c.id.slice(0, 4)}</text></g>`);
  }
  // Branch labels above their commits, stacked when several point at one commit.
  const stacks = new Map<string, number>();
  for (const [name, id] of Object.entries(repo.branches)) {
    const { x, y } = at(repo.commits.get(id)!);
    const k = stacks.get(id) ?? 0;
    stacks.set(id, k + 1);
    const label = name === repo.head ? `HEAD → ${name}` : name;
    const w = label.length * 7 + 14;
    const ly = y - 24 - k * 20;
    parts.push(
      `<g class="git-ref${name === repo.head ? ' head' : ''}" data-branch="${name}"><rect x="${x - w / 2}" y="${ly - 9}" width="${w}" height="18" rx="9"/><text x="${x}" y="${ly}">${label}</text></g>`,
    );
  }
  return { markup: parts.join(''), width, height: height + Math.max(0, ...[...stacks.values()].map((k) => (k - 1) * 20)) };
}

/** The objects behind one commit, as Git stores them. */
export function objectsOf(repo: Repo, id: string) {
  const c = repo.commits.get(id)!;
  const parent = c.parents[0] ? repo.commits.get(c.parents[0])! : null;
  return {
    commit: c,
    files: Object.keys(c.files)
      .sort()
      .map((name) => ({ name, blob: blobId(c.files[name]), shared: !!parent && parent.files[name] === c.files[name] })),
  };
}

/* ---------- Testing ---------- */

/** The function under test, one line per entry. */
export const shippingSource = [
  'def shipping(total, member):',
  '    if member:',
  '        return 0',
  '    if total >= 50:',
  '        return 0',
  '    if total >= 20:',
  '        return 5',
  '    return 8',
];

type Shipping = (total: number, member: boolean) => { result: number; lines: number[] };

/** Runs the function, recording which lines executed. `change` swaps in a mutant. */
function run(change: Partial<{ member: (m: boolean) => boolean; high: (t: number) => boolean; low: (t: number) => boolean; r0: number; r5: number; r8: number; skipMember: boolean }> = {}): Shipping {
  return (total, member) => {
    const lines = [0, 1];
    if (!change.skipMember && (change.member ?? ((m) => m))(member)) return { result: change.r0 ?? 0, lines: [...lines, 2] };
    lines.push(3);
    if ((change.high ?? ((t) => t >= 50))(total)) return { result: 0, lines: [...lines, 4] };
    lines.push(5);
    if ((change.low ?? ((t) => t >= 20))(total)) return { result: change.r5 ?? 5, lines: [...lines, 6] };
    return { result: change.r8 ?? 8, lines: [...lines, 7] };
  };
}

export const original = run();

export const mutants: { line: number; change: string; f: Shipping }[] = [
  { line: 3, change: 'total >= 50  →  total > 50', f: run({ high: (t) => t > 50 }) },
  { line: 5, change: 'total >= 20  →  total > 20', f: run({ low: (t) => t > 20 }) },
  { line: 5, change: 'total >= 20  →  total >= 2', f: run({ low: (t) => t >= 2 }) },
  { line: 1, change: 'if member  →  if not member', f: run({ member: (m) => !m }) },
  { line: 1, change: 'delete the member check', f: run({ skipMember: true }) },
  { line: 6, change: 'return 5  →  return 0', f: run({ r5: 0 }) },
  { line: 7, change: 'return 8  →  return 5', f: run({ r8: 5 }) },
];

export const testCases: { name: string; total: number; member: boolean; expect: number }[] = [
  { name: 'small order', total: 10, member: false, expect: 8 },
  { name: 'medium order', total: 30, member: false, expect: 5 },
  { name: 'large order', total: 80, member: false, expect: 0 },
  { name: 'member', total: 10, member: true, expect: 0 },
  { name: 'exactly 50', total: 50, member: false, expect: 0 },
  { name: 'exactly 20', total: 20, member: false, expect: 5 },
];

export function testReport(selected: number[]) {
  const tests = selected.map((i) => testCases[i]);
  const covered = new Set<number>();
  for (const t of tests) for (const line of original(t.total, t.member).lines) covered.add(line);
  const results = mutants.map((m) => {
    const killer = tests.find((t) => m.f(t.total, t.member).result !== t.expect);
    return { ...m, killedBy: killer?.name ?? null };
  });
  return {
    covered,
    coverage: covered.size / shippingSource.length,
    results,
    score: results.filter((r) => r.killedBy).length / mutants.length,
  };
}

/* ---------- Build systems ---------- */

export interface Target {
  name: string;
  inputs: string[];
  /** Time to build it, in seconds. Sources take none. */
  cost: number;
  column: number;
}

export const targets: Target[] = [
  { name: 'util.h', inputs: [], cost: 0, column: 0 },
  { name: 'parse.h', inputs: [], cost: 0, column: 0 },
  { name: 'util.c', inputs: [], cost: 0, column: 0 },
  { name: 'parse.c', inputs: [], cost: 0, column: 0 },
  { name: 'main.c', inputs: [], cost: 0, column: 0 },
  { name: 'util.o', inputs: ['util.c', 'util.h'], cost: 2, column: 1 },
  { name: 'parse.o', inputs: ['parse.c', 'parse.h', 'util.h'], cost: 4, column: 1 },
  { name: 'main.o', inputs: ['main.c', 'parse.h', 'util.h'], cost: 3, column: 1 },
  { name: 'test.o', inputs: ['parse.h'], cost: 2, column: 1 },
  { name: 'app', inputs: ['main.o', 'parse.o', 'util.o'], cost: 2, column: 2 },
  { name: 'tests', inputs: ['test.o', 'parse.o', 'util.o'], cost: 2, column: 2 },
];

export const sources = targets.filter((t) => !t.inputs.length).map((t) => t.name);

export type Check = 'timestamps' | 'hashes';

export interface BuildState {
  /** A version number per file, standing in for its contents. */
  content: Record<string, number>;
  /** For outputs: the contents of each input when it was last built, or null if never built. */
  builtFrom: Record<string, Record<string, number> | null>;
  /** Modification times, for timestamp checks. */
  mtime: Record<string, number>;
  clock: number;
}

export function freshState(): BuildState {
  const state: BuildState = { content: {}, builtFrom: {}, mtime: {}, clock: 1 };
  for (const t of targets) {
    state.content[t.name] = t.inputs.length ? 0 : 1;
    state.builtFrom[t.name] = t.inputs.length ? null : {};
    state.mtime[t.name] = t.inputs.length ? 0 : 1;
  }
  return state;
}

/**
 * Edit a source. A real change alters what compiling it produces; a change
 * to a comment alters the source but not the object file built from it.
 */
export function edit(state: BuildState, name: string, kind: 'code' | 'comment') {
  state.content[name] += 1;
  state.mtime[name] = ++state.clock;
  if (kind === 'comment') state.content[`${name}#comment`] = (state.content[`${name}#comment`] ?? 0) + 1;
}

export interface Job {
  name: string;
  start: number;
  end: number;
  worker: number;
  /** With hashing, the output came out byte-for-byte the same, so dependents can stop here. */
  unchanged: boolean;
}

/** What compiling or linking produces, from the meaningful content of its inputs. */
function outputOf(state: BuildState, t: Target): number {
  return hash(t.inputs.map((i) => `${i}:${state.content[i] - (state.content[`${i}#comment`] ?? 0)}`).join(',')) % 100000;
}

/** Run a build: decide what is stale, rebuild it in dependency order on `workers` workers. */
export function build(state: BuildState, check: Check, workers: number) {
  const jobs: Job[] = [];
  const finish: Record<string, number> = {};
  const free = Array(workers).fill(0);
  for (const t of targets) {
    if (!t.inputs.length) {
      finish[t.name] = 0;
      continue;
    }
    const never = state.builtFrom[t.name] === null;
    const stale =
      never ||
      (check === 'timestamps'
        ? t.inputs.some((i) => state.mtime[i] > state.mtime[t.name])
        : t.inputs.some((i) => state.builtFrom[t.name]![i] !== state.content[i]));
    if (!stale) {
      finish[t.name] = 0;
      continue;
    }
    const ready = Math.max(0, ...t.inputs.map((i) => finish[i]));
    const worker = free.indexOf(Math.min(...free));
    const start = Math.max(ready, free[worker]);
    const end = start + t.cost;
    free[worker] = end;
    finish[t.name] = end;
    const before = state.content[t.name];
    const after = outputOf(state, t);
    // Timestamp builds always write a new file. Hash-based builds keep the old one if it is identical.
    const unchanged = !never && after === before;
    state.content[t.name] = after;
    state.builtFrom[t.name] = Object.fromEntries(t.inputs.map((i) => [i, state.content[i]]));
    if (check === 'timestamps' || !unchanged) state.mtime[t.name] = ++state.clock;
    jobs.push({ name: t.name, start, end, worker, unchanged: check === 'hashes' && unchanged });
  }
  const serial = jobs.reduce((sum, j) => sum + (j.end - j.start), 0);
  return { jobs, time: Math.max(0, ...jobs.map((j) => j.end)), serial };
}

export const buildView = { width: 560, height: 300 };

export function buildGraphSvg(state: BuildState, jobs: Job[], edited: Set<string>, view = buildView): string {
  const columns = [0, 1, 2].map((c) => targets.filter((t) => t.column === c));
  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((col, c) => {
    col.forEach((t, i) => pos.set(t.name, { x: 70 + c * 200, y: ((i + 0.5) / col.length) * (view.height - 20) + 10 }));
  });
  const ran = new Map(jobs.map((j) => [j.name, j]));
  const parts: string[] = [];
  for (const t of targets) {
    for (const i of t.inputs) {
      const a = pos.get(i)!;
      const b = pos.get(t.name)!;
      parts.push(`<path class="bd-edge${ran.has(t.name) && (edited.has(i) || ran.has(i)) ? ' hot' : ''}" d="M${a.x + 44},${a.y} C${a.x + 110},${a.y} ${b.x - 110},${b.y} ${b.x - 44},${b.y}"/>`);
    }
  }
  for (const t of targets) {
    const { x, y } = pos.get(t.name)!;
    const job = ran.get(t.name);
    const cls = edited.has(t.name) ? ' edited' : job ? (job.unchanged ? ' same' : ' rebuilt') : t.inputs.length ? '' : ' source';
    parts.push(`<g class="bd-node${cls}" data-target="${t.name}"><rect x="${x - 44}" y="${y - 14}" width="88" height="28" rx="6"/><text x="${x}" y="${y}">${t.name}</text></g>`);
  }
  return parts.join('');
}

export function scheduleSvg(jobs: Job[], workers: number, total: number): { markup: string; height: number } {
  const unit = Math.min(40, 470 / Math.max(total, 1));
  const parts: string[] = [];
  for (let w = 0; w < workers; w++) parts.push(`<text class="v-small" x="34" y="${14 + w * 26}">worker ${w + 1}</text>`);
  for (const j of jobs) {
    const x = 74 + j.start * unit;
    const y = 4 + j.worker * 26;
    parts.push(
      `<g class="bd-job${j.unchanged ? ' same' : ''}"><rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(2, (j.end - j.start) * unit - 2).toFixed(1)}" height="20" rx="3"/><text x="${(x + ((j.end - j.start) * unit) / 2).toFixed(1)}" y="${y + 10}">${j.name}</text></g>`,
    );
  }
  const base = workers * 26 + 6;
  parts.push(`<line class="ml-axis" x1="74" y1="${base}" x2="${74 + total * unit}" y2="${base}"/>`);
  if (total) parts.push(`<text class="v-small" x="${74 + total * unit}" y="${base + 10}">${total} s</text>`);
  return { markup: parts.join(''), height: base + 20 };
}

