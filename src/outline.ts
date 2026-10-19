// The book's table of contents. This file is the single source of truth for
// the hierarchy, the reading order and every page title.
//
// A page listed here is "planned" until a matching file exists at
// src/content/docs/<part-slug>/<page-slug>.mdx, at which point it becomes a
// link in the sidebar and joins the previous/next chain.

type PageDef = string | { title: string; slug: string };

interface ChapterDef {
  title: string;
  pages: PageDef[];
}

interface PartDef {
  title: string;
  slug: string;
  summary: string;
  chapters: ChapterDef[];
}

const outline: PartDef[] = [
  {
    title: 'Foundations',
    slug: 'foundations',
    summary: 'How we measure cost, represent data and reason precisely.',
    chapters: [
      {
        title: 'Complexity',
        pages: [
          'Big-O Notation',
          'Time and Space Complexity',
          'Best, Average and Worst Case',
          'Amortized Analysis',
        ],
      },
      {
        title: 'Data Representation',
        pages: [
          'Bits and Bytes',
          'Number Systems',
          "Two's Complement",
          'Floating Point',
          'Bitwise Operations',
          'Character Encodings',
          'Endianness',
        ],
      },
      {
        title: 'Memory',
        pages: [
          'Stack and Heap',
          'Pointers and References',
          'Memory Layout and Alignment',
        ],
      },
      {
        title: 'Discrete Mathematics',
        pages: [
          'Boolean Logic',
          'Sets and Relations',
          'Proof Techniques',
          'Combinatorics',
          'Modular Arithmetic',
          'Probability',
          'Graph Theory',
        ],
      },
    ],
  },
  {
    title: 'Data Structures',
    slug: 'data-structures',
    summary: 'Ways of arranging data so the operations you need are cheap.',
    chapters: [
      {
        title: 'Linear Structures',
        pages: [
          'Arrays',
          'Dynamic Arrays',
          'Linked Lists',
          'Stacks',
          'Queues',
          'Deques',
          'Ring Buffers',
        ],
      },
      {
        title: 'Hashing',
        pages: ['Hash Functions', 'Hash Tables', 'Sets', 'Bloom Filters'],
      },
      {
        title: 'Trees',
        pages: [
          'Binary Trees',
          'Binary Search Trees',
          'AVL Trees',
          'Red-Black Trees',
          'B-Trees',
          'B+ Trees',
          'Heaps',
          'Tries',
          'Segment Trees',
          'Fenwick Trees',
        ],
      },
      {
        title: 'Graphs',
        pages: ['Graph Representations', 'Union-Find'],
      },
      {
        title: 'Specialised Structures',
        pages: [
          'Skip Lists',
          'LSM Trees',
          'Merkle Trees',
          'Ropes',
          'HyperLogLog',
          'Count-Min Sketch',
        ],
      },
    ],
  },
  {
    title: 'Algorithms',
    slug: 'algorithms',
    summary: 'Step-by-step recipes, and the patterns behind them.',
    chapters: [
      {
        title: 'Searching',
        pages: ['Linear Search', 'Binary Search'],
      },
      {
        title: 'Sorting',
        pages: [
          'Bubble Sort',
          'Insertion Sort',
          'Selection Sort',
          'Merge Sort',
          'Quicksort',
          'Heapsort',
          'Counting Sort',
          'Radix Sort',
          'Sorting Stability',
        ],
      },
      {
        title: 'Techniques',
        pages: [
          'Recursion',
          'Divide and Conquer',
          'Dynamic Programming',
          'Greedy Algorithms',
          'Backtracking',
          'Two Pointers',
          'Sliding Window',
        ],
      },
      {
        title: 'Graph Algorithms',
        pages: [
          'Breadth-First Search',
          'Depth-First Search',
          'Topological Sort',
          "Dijkstra's Algorithm",
          'Bellman-Ford',
          'A* Search',
          'Minimum Spanning Trees',
          'Strongly Connected Components',
          'Maximum Flow',
        ],
      },
      {
        title: 'Strings',
        pages: [
          'Knuth-Morris-Pratt',
          'Rabin-Karp',
          'Edit Distance',
          'Suffix Arrays',
        ],
      },
    ],
  },
  {
    title: 'Theory of Computation',
    slug: 'theory',
    summary: 'What can be computed at all, and what can be computed efficiently.',
    chapters: [
      {
        title: 'Automata and Languages',
        pages: [
          'Finite Automata',
          'Regular Expressions',
          'Context-Free Grammars',
          'Pushdown Automata',
        ],
      },
      {
        title: 'Computability',
        pages: ['Turing Machines', 'The Halting Problem', 'Lambda Calculus'],
      },
      {
        title: 'Complexity Classes',
        pages: ['P vs NP', 'NP-Completeness', 'Reductions'],
      },
    ],
  },
  {
    title: 'Computer Architecture',
    slug: 'architecture',
    summary: 'How a machine made of switches runs your program.',
    chapters: [
      {
        title: 'Digital Logic',
        pages: ['Logic Gates', 'Adders', 'Flip-Flops and Registers'],
      },
      {
        title: 'The Processor',
        pages: [
          'Fetch-Decode-Execute Cycle',
          'Instruction Sets',
          'Assembly Language',
          'Pipelining',
          'Branch Prediction',
          'SIMD',
          'GPUs',
        ],
      },
      {
        title: 'The Memory Hierarchy',
        pages: ['CPU Caches', 'Cache Locality', 'Storage Devices'],
      },
    ],
  },
  {
    title: 'Operating Systems',
    slug: 'operating-systems',
    summary: 'The layer that shares one machine between many programs.',
    chapters: [
      {
        title: 'Processes',
        pages: [
          'Processes',
          'Threads',
          'Context Switching',
          'CPU Scheduling',
          'System Calls',
          'Interrupts',
        ],
      },
      {
        title: 'Memory Management',
        pages: ['Virtual Memory', 'Paging', 'Memory Allocators'],
      },
      {
        title: 'Storage and I/O',
        pages: [
          'File Systems',
          { title: 'Blocking and Non-Blocking I/O', slug: 'blocking-and-non-blocking-io' },
        ],
      },
    ],
  },
  {
    title: 'Concurrency',
    slug: 'concurrency',
    summary: 'Doing several things at once without corrupting any of them.',
    chapters: [
      {
        title: 'Shared State',
        pages: [
          'Race Conditions',
          'Mutexes',
          'Semaphores',
          'Deadlock',
          'Atomics and Compare-and-Swap',
          'Lock-Free Data Structures',
        ],
      },
      {
        title: 'Models',
        pages: ['Event Loops', 'Async/Await', 'Channels', 'The Actor Model'],
      },
    ],
  },
  {
    title: 'Programming Languages',
    slug: 'languages',
    summary: 'How source code becomes something a machine can execute.',
    chapters: [
      {
        title: 'Implementation',
        pages: [
          'Compilers and Interpreters',
          'Lexing',
          'Parsing',
          'Abstract Syntax Trees',
          'Intermediate Representations',
          'Just-in-Time Compilation',
        ],
      },
      {
        title: 'Language Design',
        pages: [
          'Type Systems',
          'Closures',
          'Garbage Collection',
          'Ownership and Borrowing',
          'Programming Paradigms',
        ],
      },
    ],
  },
  {
    title: 'Software Engineering',
    slug: 'software-engineering',
    summary: 'The tools that let many people change one program without breaking it.',
    chapters: [
      {
        title: 'Tools and Practice',
        pages: ['Version Control', 'Testing', 'Build Systems'],
      },
    ],
  },
  {
    title: 'Networking',
    slug: 'networking',
    summary: 'How bytes find their way between machines.',
    chapters: [
      {
        title: 'The Stack',
        pages: [
          'The Network Layer Model',
          'IP Addressing',
          'Routing',
          'TCP',
          'UDP',
          'DNS',
          'Sockets',
        ],
      },
      {
        title: 'The Web',
        pages: ['HTTP', 'TLS', 'QUIC', 'Load Balancing', 'CDNs'],
      },
    ],
  },
  {
    title: 'Databases',
    slug: 'databases',
    summary: 'Storing data durably and getting it back quickly.',
    chapters: [
      {
        title: 'The Relational Model',
        pages: ['Relational Model', 'SQL', 'Normalisation', 'Joins'],
      },
      {
        title: 'Internals',
        pages: [
          'Indexes',
          'Storage Engines',
          'Write-Ahead Logging',
          'Query Planning',
        ],
      },
      {
        title: 'Transactions',
        pages: ['ACID', 'Isolation Levels', 'MVCC'],
      },
    ],
  },
  {
    title: 'Distributed Systems',
    slug: 'distributed-systems',
    summary: 'Making many unreliable machines behave like one reliable one.',
    chapters: [
      {
        title: 'Fundamentals',
        pages: [
          'The CAP Theorem',
          'Consistency Models',
          'Logical Clocks',
          'Failure Detection',
        ],
      },
      {
        title: 'Building Blocks',
        pages: [
          'Replication',
          'Partitioning',
          'Consistent Hashing',
          'Consensus',
          'Leader Election',
          'Raft',
          'Two-Phase Commit',
          'CRDTs',
          'Gossip Protocols',
        ],
      },
    ],
  },
  {
    title: 'Security and Cryptography',
    slug: 'security',
    summary: 'Keeping secrets, proving identity and resisting attack.',
    chapters: [
      {
        title: 'Cryptography',
        pages: [
          'Cryptographic Hash Functions',
          'Symmetric Encryption',
          'Public-Key Cryptography',
          'Digital Signatures',
          'Key Exchange',
          'Password Hashing',
        ],
      },
      {
        title: 'Software Security',
        pages: ['Buffer Overflows', 'Injection Attacks', 'Authentication'],
      },
    ],
  },
  {
    title: 'Information and Coding',
    slug: 'information',
    summary: 'Measuring information, squeezing it down and protecting it from noise.',
    chapters: [
      {
        title: 'Information Theory',
        pages: ['Entropy', 'Huffman Coding', 'Lempel-Ziv Compression'],
      },
      {
        title: 'Error Handling',
        pages: ['Checksums', 'Error-Correcting Codes'],
      },
    ],
  },
  {
    title: 'Machine Learning',
    slug: 'machine-learning',
    summary: 'Programs that learn their behaviour from examples instead of being told it.',
    chapters: [
      {
        title: 'Learning from Data',
        pages: [
          'Linear Regression',
          'Gradient Descent',
          'Overfitting and Regularisation',
          'Decision Trees',
          'k-Means Clustering',
        ],
      },
      {
        title: 'Neural Networks',
        pages: ['Neural Networks', 'Backpropagation', 'Attention and Transformers'],
      },
    ],
  },
  {
    title: 'Computer Graphics',
    slug: 'graphics',
    summary: 'Turning a description of a 3D scene into the colour of every pixel.',
    chapters: [
      {
        title: 'Rendering',
        pages: ['Transforms', 'Rasterisation', 'Shading', 'Ray Tracing'],
      },
    ],
  },
];

export interface Page {
  title: string;
  /** Matches the content collection id, e.g. "data-structures/b-trees". */
  id: string;
  part: string;
  chapter: string;
}

export interface Chapter {
  title: string;
  pages: Page[];
}

export interface Part {
  title: string;
  slug: string;
  summary: string;
  chapters: Chapter[];
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/\*/g, ' star ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const parts: Part[] = outline.map((part) => ({
  title: part.title,
  slug: part.slug,
  summary: part.summary,
  chapters: part.chapters.map((chapter) => ({
    title: chapter.title,
    pages: chapter.pages.map((def) => {
      const title = typeof def === 'string' ? def : def.title;
      const slug = typeof def === 'string' ? slugify(def) : def.slug;
      return {
        title,
        id: `${part.slug}/${slug}`,
        part: part.title,
        chapter: chapter.title,
      };
    }),
  })),
}));

/** Every page in reading order. */
export const allPages: Page[] = parts.flatMap((part) =>
  part.chapters.flatMap((chapter) => chapter.pages),
);

export const pagesById = new Map(allPages.map((page) => [page.id, page]));

if (pagesById.size !== allPages.length) {
  const seen = new Set<string>();
  const dupes = allPages.filter((p) => seen.size === seen.add(p.id).size);
  throw new Error(
    `Duplicate page ids in src/outline.ts: ${dupes.map((p) => p.id).join(', ')}`,
  );
}
