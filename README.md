# Visual Computer Science

A complete guide for Computer Science concepts: one page per concept, read front to back like a book.

Built with [Astro](https://astro.build) and served from GitHub Pages at <https://tom-draper.github.io/vcs/>.

## Develop

```sh
pnpm install
pnpm dev        # http://localhost:4321/vcs/
pnpm build      # static site + search index in dist/
pnpm preview    # serve dist/ (search only works here, not in dev)
```

## How the book is organised

| Path | What it is |
| --- | --- |
| `src/outline.ts` | The table of contents: parts, chapters, page titles and reading order. |
| `src/content/docs/<part>/<page>.mdx` | One file per concept. |
| `src/components/viz/` | Diagram components, rendered to inline SVG at build time. |
| `src/components/mdx.ts` | The components every page can use without importing. |
| `src/lib/*-scene.ts` | three.js scenes for 3D figures, loaded only when the figure nears the screen. |

The outline lists every page the book intends to have. A page is **planned**
(greyed out in the sidebar) until its `.mdx` file exists; then it becomes a link
and joins the previous/next chain automatically.

## Adding a concept

1. Find the page in `src/outline.ts`, or add it. Its id is `<part-slug>/<slugified-title>`,
   for example `data-structures/b-trees`.
2. Create `src/content/docs/<id>.mdx`:

   ```mdx
   ---
   description: One sentence that says what it is and why it matters.
   difficulty: beginner # or intermediate, advanced
   ---

   Opening paragraph: the problem this concept solves.

   ## The picture
   ```

The title comes from the outline, and the description is shown under it, so start
the body with prose rather than a heading.

Link to other concepts with site-absolute paths: `[arrays](/data-structures/arrays/)`.
A link to a planned page renders as plain dotted text until that page is written.
A link to a page that is not in the outline fails the build.

### Page shape

The existing pages follow roughly this order, which is worth keeping:

1. The problem the concept solves, in a paragraph.
2. A picture of the structure.
3. Each operation as a worked example, step by step.
4. The costs (`<Ops>`).
5. A short implementation.
6. Trade-offs and where it is used in real systems.
7. Key takeaways.

### Components

```mdx
<ArrayViz values={[2, 5, 8, null]} highlight={[1]} alt={[2]} dim={[0]}
  pointers={{ lo: 0, hi: 2 }} addr={{ base: 0x1000, size: 4 }} caption="..." />

<LinkedList values={[12, 99, 37]} labels={{ head: 0 }} highlight={[1]} doubly />

<Tree root={{ k: 8, c: [{ k: 3, c: [1, 6] }, { k: 10, c: [null, 14] }] }}
  highlight={[8, 3]} alt={[6]} />

<Tree btree root={{ k: [10, 20], c: [[3, 7], [12, 15, 18], [25, 30]] }} />

<Tree root={{ k: 10, c: [5, 15] }} red={[5, 15]} black={[10]} notes={{ 10: '+1' }} />

<Tree btree linkLeaves leafOnly root={{ k: [10], c: [[3, 7], [10, 12]] }} alt={[12]} />

<Tree roots={[{ k: 0, c: [1, 2] }, 3]} />                      {/* a forest */}

<Tree show="last" terminal={['do']} root={{ k: '', c: [{ k: 'd', c: ['do'] }] }} />   {/* a trie */}

<Graph directed nodes={{ A: [0, 0], B: [1, 0], C: [1, 1] }}
  edges={[['A', 'B', 4], ['A', 'C']]} highlight={['A']} path={[['A', 'B']]} />

<FenwickViz values={[4, 9, 6, 8]} highlight={[4]} alt={[3]} />

<HashTable buckets={[['cat', 'act'], [], ['dog']]} highlight={0} alt={['act']}
  input={{ key: 'act', note: '312 % 8 = 0' }} />

<Ops items={[['Search', 'O(log n)'], ['Insert', 'O(1)', 'amortized']]} />

<Steps>
<Step title="First, ...">

Markdown and diagrams go here.

</Step>
</Steps>

<Aside type="tip" title="Rule of thumb">

Also `note` (the default) and `warning`.

</Aside>
```

### Interactive diagrams

`<Player>` turns a sequence of frames into a step-through with play, previous/next
and a scrubber. Each frame is ordinary static markup, so without JavaScript the
frames simply appear one after another.

```mdx
<Player>
<Frame caption="Start with an empty array.">
<ArrayViz values={[null, null]} />
</Frame>
<Frame caption="Write <code>A</code>.">
<ArrayViz values={['A', null]} highlight={[0]} />
</Frame>
</Player>
```

Frames can be generated: `export const order = [1, 2, 3]` and then
`{order.map((key) => <Frame>...</Frame>)}` inside the `<Player>`.

Use `<Steps>` when each step needs a paragraph of explanation, and `<Player>` when
the motion is the point and a one-line caption is enough.

`<SortDemo algorithm="quick" />` animates a sorting algorithm as bars, with
comparison and write counters and buttons to re-run it on shuffled, sorted or
reversed input. Algorithms: `bubble`, `insertion`, `selection`, `merge`, `quick`,
`heap`. The traces live in `src/lib/sort-traces.ts`; add a function there to
support another algorithm.

`<GraphDemo algorithm="bfs" nodes={...} edges={...} />` runs a graph algorithm
step by step on a graph you describe, and lets the reader restart it from any
vertex. Algorithms: `bfs`, `dfs`, `dijkstra`, `topo` (pass `directed` for a DAG).
The traces live in `src/lib/graph-traces.ts`.

`<GraphDemo>` also runs `bellman-ford`, `kruskal` and `prim`. Other algorithm
demos: `<GridSearch />` (draw walls, compare Dijkstra with A*),
`<MatchDemo algorithm="kmp" text="..." pattern="..." />` (also `naive` and
`rabin-karp`), `<EditDistanceDemo />`, `<QueensPlayer n={4} />` and the static
`<Intervals items={[['A', 1, 4]]} chosen={['A']} />`. Their logic is in
`src/lib/grid-search.ts` and `src/lib/string-traces.ts`.

The probabilistic structures have `<BloomDemo />`, `<CountMinDemo />` and
`<HllDemo />`, sharing the hashing in `src/lib/sketches.ts`, and skip lists have
the static `<SkipList nodes={[[3, 1], [9, 3]]} path={[[-1, 2], [9, 2]]} target={9} />`.

The computer architecture pages use `<GateDemo />`, `<AdderDemo />`,
`<RegisterDemo />`, `<CpuDemo />`, `<BranchDemo />` and `<CacheDemo />`, with the
static `<Gates only={['xor', 'and']} />` and
`<Pipeline instructions={['add', 'load']} cycle={3} />`. Their simulations are in
`src/lib/hardware.ts`.

The operating systems pages use `<SchedulerDemo />`, `<PagingDemo />`,
`<PageReplacementDemo />` and `<AllocatorDemo />`, backed by `src/lib/os.ts`.

The concurrency pages use `<InterleaveDemo scenario="race" />` (also `mutex`,
`cas`, `deadlock` and `ordered`), `<SemaphoreDemo />`, `<ChannelDemo />` and
`<EventLoopDemo />`, backed by `src/lib/concurrency.ts`.

The theory of computation pages use `<AutomatonDemo machine="even-zeros" input="1001" />`
(also `divisible-by-3`, `ends-01` and `ends-01-dfa`), `<RegexDemo />`, `<PdaDemo />`,
`<TuringDemo machine="increment" />` (also `equal` and `bounce`), `<LambdaDemo />`,
`<SubsetSumDemo />` and `<SatDemo />`, backed by `src/lib/theory.ts`. The static
`<Automaton machine="ends-01" active={['q0']} />` draws a state diagram, and also
takes a machine written out in full: `{ states: { s: [0, 0], f: [1, 0] }, start: 's',
accept: ['f'], edges: [['s', 'f', 'a'], ['f', 'f', 'a,b']] }`.

The programming languages pages share one small expression language in
`src/lib/languages.ts`. `<CompilerDemo show="tokens" />` runs what the reader types
through a stage of a compiler (also `tree`, `types`, `optimise`, `stack` and `all`;
pass `source` and `tries` to change the examples), and `<VmDemo />` steps the
resulting stack code. The other widgets are `<GcDemo />`, `<ClosureDemo />`,
`<JitDemo />` and `<OwnershipDemo script="move" />` (also `shared`, `mutable` and
`dangling`).

The networking pages use `<SequenceDemo scenario="tcp-handshake" />` for anything that
is a conversation between machines (also `tcp-loss`, `tcp-close`, `udp`, `dns`,
`dns-cached`, `sockets`, `tls`, `tcp-tls`, `quic` and `quic-0rtt`; add a scenario to
`sequences` in `src/lib/networking.ts` for another). The rest are `<SubnetDemo />`,
`<LayersDemo />`, `<CongestionDemo />`, `<HttpDemo />`, `<LoadBalancerDemo />` and
`<CdnDemo />`.

The database pages use `<SqlDemo showTables />`, a SQL prompt over two sample tables
(pass `query` and `tries={[['label', 'SELECT ...']]}` to set the examples). The engine
in `src/lib/databases.ts` handles `SELECT`, `JOIN`, `LEFT JOIN`, `WHERE`, `GROUP BY`,
`ORDER BY` and `LIMIT`. The other widgets are `<JoinDemo />`, `<IndexDemo />`,
`<LsmDemo />`, `<WalDemo />`, `<PlanDemo />`, `<MvccDemo />` and
`<IsolationDemo anomaly="dirty read" />` (also `non-repeatable read`, `phantom`,
`lost update` and `write skew`).

The distributed systems pages use `<CapDemo />`, `<QuorumDemo />`, `<ClockDemo />`,
`<HeartbeatDemo />`, `<ReplicationDemo />`, `<PartitionDemo />`, `<HashRingDemo />`,
`<RaftDemo />`, `<CrdtDemo />` and `<GossipDemo />`, backed by `src/lib/distributed.ts`.
That file also adds the `2pc-commit`, `2pc-abort`, `2pc-stuck` and `paxos` scenarios
to `<SequenceDemo>`.

The security pages use `<HashDemo />`, `<BlockModeDemo />`, `<RsaDemo />` (and
`<RsaDemo mode="sign" />`), `<DiffieHellmanDemo />`, `<PasswordDemo />`,
`<OverflowDemo />`, `<InjectionDemo />` and `<TokenDemo />`, backed by
`src/lib/security.ts`. The ciphers there are toys sized for reading, not for use.

The information and coding pages use `<EntropyDemo />`, `<HuffmanDemo />`, `<LzDemo />`,
`<ChecksumDemo />` and `<HammingDemo />`, backed by `src/lib/information.ts`. The first
four take a `text` prop for their starting input.

The machine learning pages use `<RegressionDemo />` (steer a line, errors drawn as
squares), `<DescentDemo />` (gradient descent on the error surface, with a choice of
learning rates), `<OverfitDemo />` (polynomial degree and ridge penalty against
training and test error), `<KMeansDemo />`, `<NetworkDemo />` (a tiny network trained
live on `line`, `xor` and `circle` data) and `<BackpropDemo />` (one neuron's forward
and backward pass, node by node). They are backed by `src/lib/learning.ts`, which also
draws each widget's SVG so the first frame renders without JavaScript.

3D figures are drawn with three.js. Each has a model in `src/lib/<name>.ts` and a scene
in `src/lib/<name>-scene.ts` that extends `PlateScene` from `src/lib/plate-scene.ts`,
which handles the renderer, bloom, orbit controls, HTML labels and pausing off screen.
They sit in a `.plate` and share the `.plate-*` panel classes.

- `<CodeCube />` draws short codes on a cube, where each edge is one bit flip, and
  unfolds it into a tesseract for 4-bit codes. It takes `code="none|parity|repeat"` and
  `bits={3|4}`, and the home page uses `variant="hero"`, which plays a short loop
  without controls.
- `<CacheHierarchy />` stands the core, L1, L2, L3 and RAM in a row, farther for slower,
  and plays access patterns through them a line at a time. "Draw to scale" moves each
  level to a distance proportional to its latency. Its `variant="hero"` plays each
  access pattern in turn, without controls.

The home page shows one of these figures beside the title, picked at random on each
visit (never the same one twice in a row), and its link goes to the page the figure
comes from. To add a figure to the rotation, give it a `hero` variant and add it to
`heroes` in `src/pages/index.astro`. Only the chosen figure loads three.js.

Plates have no box: the canvas is painted in the page colour with feathered edges, and
scenes read their colours from the `--plate-*` tokens through `ink()`, so they follow the
light and dark themes. Bloom is used only on dark pages; light pages get shadows instead.

The data-representation pages have four small widgets, all backed by
`src/lib/bits.ts`: `<BitsDemo value={65} signed step />` (flip bits, read the
value), `<BitwiseDemo />`, `<FloatDemo />` and `<Utf8Demo />`.

The discrete maths pages use `<LogicDemo />`, `<ModClock value={17} modulus={12} />`,
`<CountingDemo />`, `<BirthdayDemo />` and the static `<Venn />`, with their maths
in `src/lib/discrete.ts`.

In page prose, wrap anything containing curly braces (such as set notation) in
backticks. MDX treats a bare `{` as the start of a JavaScript expression.

`<HashPlayground />` is a live widget for the Hash Functions page. Widgets like
it are custom elements with a script that only ships on pages that use them.

`highlight` is the blue emphasis and `alt` the orange one. In a tree node, a
number is a leaf, an array is one multi-key node, `null` is an empty child slot
and `{ k, c }` is a node with children.

## Deploying

`.github/workflows/deploy.yml` builds and publishes on every push to `main`. In
the repository settings, set **Pages → Build and deployment → Source** to
**GitHub Actions**.
