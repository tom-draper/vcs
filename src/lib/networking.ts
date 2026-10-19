// Models behind the networking widgets: IPv4 subnet arithmetic, message
// sequences, packet encapsulation, TCP congestion control, load balancing,
// a content delivery network and a toy HTTP server.

/* ---------- IPv4 addressing ---------- */

export const dotted = (address: number) =>
  [24, 16, 8, 0].map((shift) => (address >>> shift) & 255).join('.');

export function parseAddress(text: string): number | null {
  const parts = text.trim().split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((sum, part) => sum * 256 + Number(part), 0);
}

const ranges: [cidr: string, name: string][] = [
  ['10.0.0.0/8', 'private'],
  ['172.16.0.0/12', 'private'],
  ['192.168.0.0/16', 'private'],
  ['127.0.0.0/8', 'loopback, this machine'],
  ['169.254.0.0/16', 'link-local, self-assigned'],
  ['100.64.0.0/10', 'shared, carrier NAT'],
  ['224.0.0.0/4', 'multicast'],
  ['192.0.2.0/24', 'reserved for documentation'],
  ['198.51.100.0/24', 'reserved for documentation'],
  ['203.0.113.0/24', 'reserved for documentation'],
];

const maskOf = (prefix: number) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

export function inBlock(address: number, cidr: string): boolean {
  const [base, prefix] = cidr.split('/');
  const mask = maskOf(Number(prefix));
  return ((address & mask) >>> 0) === ((parseAddress(base)! & mask) >>> 0);
}

/** Everything that follows from an address and a prefix length, such as `192.168.1.130/26`. */
export function subnet(text: string) {
  const [addressText, prefixText = '', extra] = text.trim().split('/');
  const address = parseAddress(addressText);
  if (address === null) throw new Error('An IPv4 address is four numbers from 0 to 255, separated by dots.');
  if (extra !== undefined || !/^\d{1,2}$/.test(prefixText) || Number(prefixText) > 32) {
    throw new Error('Add a prefix length from 0 to 32 after a slash, as in /24.');
  }
  const prefix = Number(prefixText);
  const mask = maskOf(prefix);
  const network = (address & mask) >>> 0;
  const broadcast = (network | ~mask) >>> 0;
  const size = 2 ** (32 - prefix);
  // A /31 joins two routers and a /32 is one machine: neither loses addresses.
  const usable = prefix >= 31;
  return {
    address,
    prefix,
    mask,
    network,
    broadcast,
    size,
    hosts: usable ? size : size - 2,
    first: usable ? network : network + 1,
    last: usable ? broadcast : broadcast - 1,
    bits: address.toString(2).padStart(32, '0'),
    kind: ranges.find(([cidr]) => inBlock(address, cidr))?.[1] ?? 'public',
  };
}

/* ---------- Message sequences ---------- */

export interface SequenceStep {
  from: number;
  /** Same as `from` for something that happens on one machine. */
  to: number;
  label: string;
  note: string;
  /** The message never arrives. */
  lost?: boolean;
}

export interface Sequence {
  actors: string[];
  steps: SequenceStep[];
}

export const sequences = {
  'tcp-handshake': {
    actors: ['client', 'server'],
    steps: [
      { from: 0, to: 1, label: 'SYN seq=100', note: 'The client asks to open a connection and announces its starting sequence number, 100.' },
      { from: 1, to: 0, label: 'SYN-ACK seq=300 ack=101', note: 'The server agrees, announces its own starting number, 300, and acknowledges the client: "I expect your byte 101 next".' },
      { from: 0, to: 1, label: 'ACK ack=301', note: 'The client acknowledges the server. Both sides now know the other can send and receive. The connection is open.' },
      { from: 0, to: 1, label: 'DATA seq=101, 50 bytes', note: 'The client sends 50 bytes, numbered 101 to 150.' },
      { from: 1, to: 0, label: 'ACK ack=151', note: 'The server has everything up to byte 150 and expects 151 next.' },
    ],
  },
  'tcp-loss': {
    actors: ['client', 'server'],
    steps: [
      { from: 0, to: 1, label: 'DATA seq=101, 50 bytes', note: 'The first segment, bytes 101 to 150, arrives.' },
      { from: 1, to: 0, label: 'ACK ack=151', note: 'The server expects byte 151 next.' },
      { from: 0, to: 1, label: 'DATA seq=151, 50 bytes', note: 'The second segment is dropped by a congested router. Neither end is told.', lost: true },
      { from: 0, to: 1, label: 'DATA seq=201, 50 bytes', note: 'The third segment arrives. The server now has a gap: bytes 151 to 200 are missing.' },
      { from: 1, to: 0, label: 'ACK ack=151', note: 'The server holds on to the third segment and repeats its last acknowledgement: "I am still waiting for 151".' },
      { from: 0, to: 0, label: 'no ACK for 151', note: 'The client sees the repeated acknowledgement, or its timer for byte 151 runs out. Either way it concludes the segment was lost.' },
      { from: 0, to: 1, label: 'DATA seq=151, 50 bytes', note: 'The client sends the missing segment again.' },
      { from: 1, to: 0, label: 'ACK ack=251', note: 'The gap is filled. One acknowledgement covers everything up to byte 250, and the application receives the bytes in order.' },
    ],
  },
  'tcp-close': {
    actors: ['client', 'server'],
    steps: [
      { from: 0, to: 1, label: 'FIN', note: 'The client has nothing more to send. It can still receive.' },
      { from: 1, to: 0, label: 'ACK', note: 'The server acknowledges. It may keep sending if it has data left.' },
      { from: 1, to: 0, label: 'FIN', note: 'The server has finished too.' },
      { from: 0, to: 1, label: 'ACK', note: 'The client acknowledges. Each direction has been closed separately, so nothing in flight is lost.' },
    ],
  },
  udp: {
    actors: ['client', 'server'],
    steps: [
      { from: 0, to: 1, label: 'datagram 1', note: 'No handshake. The first packet carries data.' },
      { from: 0, to: 1, label: 'datagram 2', note: 'This one is dropped on the way. UDP does not notice, and nothing is sent again.', lost: true },
      { from: 0, to: 1, label: 'datagram 3', note: 'The next one arrives. The server has datagrams 1 and 3, and UDP will not tell it that 2 ever existed.' },
      { from: 1, to: 0, label: 'datagram', note: 'A reply is just another independent datagram. There is no connection to close.' },
    ],
  },
  dns: {
    actors: ['laptop', 'resolver', 'root', '.org', 'example.org'],
    steps: [
      { from: 0, to: 1, label: 'www.example.org?', note: 'The laptop asks its resolver, usually run by the internet provider or a public service, and waits for a final answer.' },
      { from: 1, to: 2, label: 'www.example.org?', note: 'The resolver knows nothing yet, so it starts at the top: a root server.' },
      { from: 2, to: 1, label: 'ask the .org servers', note: 'The root does not know the answer, but it knows who runs .org and replies with a referral.' },
      { from: 1, to: 3, label: 'www.example.org?', note: 'The same question goes to a .org server.' },
      { from: 3, to: 1, label: 'ask ns1.example.org', note: 'Another referral, to the name servers that example.org registered.' },
      { from: 1, to: 4, label: 'www.example.org?', note: 'The resolver asks the authoritative server for the domain.' },
      { from: 4, to: 1, label: 'A 203.0.113.10', note: 'The authoritative server holds the record and answers: the address, and permission to remember it for 3600 seconds.' },
      { from: 1, to: 1, label: 'cache for 1 hour', note: 'The resolver stores the answer, and the referrals it collected on the way.' },
      { from: 1, to: 0, label: '203.0.113.10', note: 'The laptop gets its answer. Eight messages, typically in well under a tenth of a second.' },
    ],
  },
  'dns-cached': {
    actors: ['laptop', 'resolver', 'root', '.org', 'example.org'],
    steps: [
      { from: 0, to: 1, label: 'www.example.org?', note: 'A minute later, another device on the network asks the same question.' },
      { from: 1, to: 1, label: 'found in cache', note: 'The answer is in the cache and has 59 minutes of its lifetime left.' },
      { from: 1, to: 0, label: '203.0.113.10', note: 'The resolver answers at once. Nobody else was contacted.' },
    ],
  },
  sockets: {
    actors: ['client', 'server'],
    steps: [
      { from: 1, to: 1, label: 'socket, bind, listen', note: 'The server creates a socket, binds it to port 8080 and starts listening. Nothing has gone over the network yet.' },
      { from: 0, to: 0, label: 'socket', note: 'The client creates a socket. The operating system will give it a spare port when it connects.' },
      { from: 0, to: 1, label: 'connect: SYN', note: 'connect() makes the kernel start the TCP handshake.' },
      { from: 1, to: 0, label: 'SYN-ACK', note: 'The server kernel replies on its own. The server program has not been involved yet.' },
      { from: 0, to: 1, label: 'ACK', note: 'connect() returns in the client. The finished connection waits in the server kernel accept queue.' },
      { from: 1, to: 1, label: 'accept', note: 'accept() takes the connection from the queue and returns a new socket for this one client. The listening socket carries on listening.' },
      { from: 0, to: 1, label: 'send: "hello"', note: 'send() copies bytes into a kernel buffer. TCP delivers them when it can.' },
      { from: 1, to: 1, label: 'recv', note: 'recv() returns whatever bytes have arrived so far, which may be part of a message or several at once.' },
      { from: 1, to: 0, label: 'send: "hi"', note: 'The connection works in both directions.' },
      { from: 0, to: 1, label: 'close: FIN', note: 'close() ends the client side. The server next recv() returns zero bytes, which means end of stream.' },
    ],
  },
  tls: {
    actors: ['client', 'server'],
    steps: [
      { from: 0, to: 1, label: 'ClientHello, key share', note: 'The client lists the cipher suites it supports and sends its half of a key exchange. Sent in the clear.' },
      { from: 1, to: 0, label: 'ServerHello, key share', note: 'The server picks a cipher suite and sends its half. Both sides can now compute the same secret keys, and an eavesdropper cannot.' },
      { from: 1, to: 0, label: 'Certificate, signature, Finished', note: 'Encrypted from here on. The server sends its certificate and signs the handshake so far, proving it holds the private key that matches.' },
      { from: 0, to: 0, label: 'check certificate', note: 'The client checks the certificate: the right name, in date, and signed by an authority it trusts. Then it checks the signature.' },
      { from: 0, to: 1, label: 'Finished, GET /', note: 'The client confirms the handshake and can send its first request in the same flight.' },
      { from: 1, to: 0, label: '200 OK', note: 'Application data flows, encrypted and authenticated. The handshake cost one round trip.' },
    ],
  },
  'tcp-tls': {
    actors: ['client', 'server'],
    steps: [
      { from: 0, to: 1, label: 'TCP SYN', note: 'First the TCP handshake.' },
      { from: 1, to: 0, label: 'TCP SYN-ACK', note: 'One round trip gone, and nothing about encryption has been said yet.' },
      { from: 0, to: 1, label: 'ACK, TLS ClientHello', note: 'Now the TLS handshake can start, inside the TCP connection.' },
      { from: 1, to: 0, label: 'ServerHello, certificate, Finished', note: 'Two round trips gone.' },
      { from: 0, to: 1, label: 'Finished, GET /', note: 'Only now can the request be sent.' },
      { from: 1, to: 0, label: '200 OK', note: 'The first byte of the response arrives after three round trips.' },
    ],
  },
  quic: {
    actors: ['client', 'server'],
    steps: [
      { from: 0, to: 1, label: 'Initial: ClientHello', note: 'The first packet opens the connection and starts the TLS 1.3 handshake together.' },
      { from: 1, to: 0, label: 'ServerHello, certificate, Finished', note: 'One round trip gone, and the keys are agreed.' },
      { from: 0, to: 1, label: 'Finished, GET /', note: 'The request goes out.' },
      { from: 1, to: 0, label: '200 OK', note: 'The first byte of the response arrives after two round trips, one fewer than TCP with TLS.' },
    ],
  },
  'quic-0rtt': {
    actors: ['client', 'server'],
    steps: [
      { from: 0, to: 1, label: 'ClientHello, GET /', note: 'The client has talked to this server before and kept a key from last time. It sends the request, encrypted, in its very first packet.' },
      { from: 1, to: 0, label: 'ServerHello, Finished, 200 OK', note: 'The response arrives after a single round trip. This early data can be replayed by an attacker, so it is only used for requests that are safe to repeat.' },
    ],
  },
} satisfies Record<string, Sequence>;

export type SequenceName = keyof typeof sequences;

/* ---------- Encapsulation ---------- */

export const layers = ['Application', 'Transport', 'Network', 'Link', 'Physical'];

export type Header = 'eth' | 'ip' | 'tcp' | 'data' | 'check';

export const headerText: Record<Header, string> = {
  eth: 'Ethernet',
  ip: 'IP',
  tcp: 'TCP',
  data: 'GET / HTTP/1.1',
  check: 'checksum',
};

export interface LayerFrame {
  where: 'your computer' | 'the router' | 'the server';
  /** Index into `layers`. */
  layer: number;
  parts: Header[];
  /** The part added or removed at this step. */
  fresh?: Header;
  note: string;
}

export const journey: LayerFrame[] = [
  { where: 'your computer', layer: 0, parts: ['data'], note: 'The browser produces an HTTP request. It is just text, and the browser hands it to the operating system.' },
  { where: 'your computer', layer: 1, parts: ['tcp', 'data'], fresh: 'tcp', note: 'TCP adds a header: source port 51234, destination port 80, a sequence number. The result is a segment.' },
  { where: 'your computer', layer: 2, parts: ['ip', 'tcp', 'data'], fresh: 'ip', note: 'IP adds a header: from 192.168.1.20, to 203.0.113.10. The result is a packet. IP does not look inside the TCP segment.' },
  { where: 'your computer', layer: 3, parts: ['eth', 'ip', 'tcp', 'data', 'check'], fresh: 'eth', note: 'Ethernet adds a header with the hardware address of the next hop, the home router, and a checksum on the end. The result is a frame.' },
  { where: 'your computer', layer: 4, parts: ['eth', 'ip', 'tcp', 'data', 'check'], note: 'The frame leaves as electrical signals, light or radio waves.' },
  { where: 'the router', layer: 3, parts: ['ip', 'tcp', 'data'], fresh: 'eth', note: 'The router checks the frame and strips the Ethernet header. That header was only for this one hop.' },
  { where: 'the router', layer: 2, parts: ['ip', 'tcp', 'data'], note: 'It reads the destination in the IP header, consults its routing table and picks the next hop. It never looks at the TCP header or the data.' },
  { where: 'the router', layer: 3, parts: ['eth', 'ip', 'tcp', 'data', 'check'], fresh: 'eth', note: 'A new link header is added for the next hop, and the packet goes on. This repeats at every router on the path.' },
  { where: 'the server', layer: 3, parts: ['ip', 'tcp', 'data'], fresh: 'eth', note: 'The frame arrives at the server, which removes the link header.' },
  { where: 'the server', layer: 2, parts: ['tcp', 'data'], fresh: 'ip', note: 'The IP header says the packet is for this machine and contains TCP. It is removed.' },
  { where: 'the server', layer: 1, parts: ['data'], fresh: 'tcp', note: 'TCP uses the port number to find the right program, checks the sequence number and removes its header.' },
  { where: 'the server', layer: 0, parts: ['data'], note: 'The web server receives exactly the text the browser wrote. Neither program knows anything about the layers beneath.' },
];

/* ---------- TCP congestion control ---------- */

export interface CongestionPoint {
  /** Window size in segments after this round. */
  window: number;
  threshold: number;
  event: 'start' | 'slow start' | 'avoidance' | 'loss' | 'timeout';
}

/** A simplified TCP Reno sender, measured in whole segments per round trip. */
export class Congestion {
  window = 1;
  threshold = 32;
  history: CongestionPoint[] = [{ window: 1, threshold: 32, event: 'start' }];

  private record(event: CongestionPoint['event']) {
    this.history.push({ window: this.window, threshold: this.threshold, event });
  }

  /** One round trip in which every segment is acknowledged. */
  round() {
    if (this.window < this.threshold) {
      this.window = Math.min(this.window * 2, this.threshold);
      this.record('slow start');
    } else {
      this.window += 1;
      this.record('avoidance');
    }
  }

  /** Three duplicate acknowledgements: one segment was lost but others are arriving. */
  loss() {
    this.threshold = Math.max(2, Math.floor(this.window / 2));
    this.window = this.threshold;
    this.record('loss');
  }

  /** Nothing came back at all. */
  timeout() {
    this.threshold = Math.max(2, Math.floor(this.window / 2));
    this.window = 1;
    this.record('timeout');
  }
}

/* ---------- Load balancing ---------- */

export type Policy = 'round robin' | 'least connections' | 'random' | 'client hash';

export const policies: Policy[] = ['round robin', 'least connections', 'random', 'client hash'];

export interface Backend {
  name: string;
  /** Ticks each request takes on this server. */
  speed: number;
  up: boolean;
  /** Ticks left on each request in progress. */
  active: number[];
  handled: number;
}

export class LoadBalancer {
  servers: Backend[] = [
    { name: 'A', speed: 3, up: true, active: [], handled: 0 },
    { name: 'B', speed: 3, up: true, active: [], handled: 0 },
    { name: 'C', speed: 9, up: true, active: [], handled: 0 },
  ];
  private next = 0;
  private seed = 7;
  private clients = 0;

  /** Sends one request. Time moves on by one tick first. Returns the chosen server, or null if none is up. */
  send(policy: Policy): { server: Backend; client: number } | null {
    for (const server of this.servers) server.active = server.active.map((left) => left - 1).filter((left) => left > 0);
    const up = this.servers.filter((server) => server.up);
    // Requests arrive from five clients in turn.
    const client = (this.clients++ % 5) + 1;
    if (!up.length) return null;
    let server: Backend;
    if (policy === 'round robin') {
      server = up[this.next++ % up.length];
    } else if (policy === 'least connections') {
      server = up.reduce((best, each) => (each.active.length < best.active.length ? each : best));
    } else if (policy === 'random') {
      this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
      server = up[Math.floor((this.seed / 2147483648) * up.length)];
    } else {
      server = up[(client * 7) % up.length];
    }
    server.active.push(server.speed);
    server.handled++;
    return { server, client };
  }
}

/* ---------- Content delivery ---------- */

/** Round-trip time in milliseconds from each city to an origin server in Virginia. */
export const cities: Record<string, number> = {
  'New York': 10,
  London: 75,
  'São Paulo': 120,
  Tokyo: 150,
  Sydney: 200,
};

/** Round trip to an edge server in the same city. */
export const EDGE_RTT = 5;
/** Round trips to fetch one file on a new connection: TCP, TLS, then the request. */
export const ROUND_TRIPS = 3;

export function fetchTimes(city: string) {
  const origin = cities[city];
  return {
    direct: ROUND_TRIPS * origin,
    // On a miss the edge fetches from the origin over a connection it keeps open.
    miss: ROUND_TRIPS * EDGE_RTT + origin,
    hit: ROUND_TRIPS * EDGE_RTT,
  };
}

/* ---------- HTTP ---------- */

export const httpMethods = ['GET', 'POST', 'DELETE'];
export const httpPaths = ['/', '/logo.png', '/old-page', '/orders', '/orders/42', '/admin', '/nothing'];

interface Reply {
  status: string;
  headers: string[];
  body?: string;
  why: string;
}

/** A canned web server, enough to show the common status codes. */
export function httpExchange(method: string, path: string, conditional: boolean) {
  const etag = '"v7"';
  const route = (): Reply => {
    if (path === '/admin') {
      return { status: '401 Unauthorized', headers: ['WWW-Authenticate: Bearer'], why: 'The request carried no credentials. 401 means "tell me who you are". 403 would mean "I know who you are, and no".' };
    }
    if (path === '/nothing') return { status: '404 Not Found', headers: ['Content-Type: text/plain'], body: 'No such page.', why: 'Nothing lives at this path. The 4xx codes mean the client got something wrong.' };
    if (path === '/old-page') {
      return { status: '301 Moved Permanently', headers: ['Location: /'], why: 'The page has moved for good. The browser will request the address in Location, and remember to go there directly next time.' };
    }
    if (path === '/orders' && method === 'POST') {
      return { status: '201 Created', headers: ['Location: /orders/42', 'Content-Type: application/json'], body: '{"id": 42, "item": "tea"}', why: 'The server made a new resource and says where it lives. POST is not idempotent: sending this twice would create two orders.' };
    }
    if (path === '/orders/42' && method === 'DELETE') {
      return { status: '204 No Content', headers: [], why: 'Done, and there is nothing to send back. DELETE is idempotent: deleting twice leaves the same result as deleting once.' };
    }
    if (method !== 'GET') {
      return { status: '405 Method Not Allowed', headers: [`Allow: ${path === '/orders' ? 'GET, POST' : path === '/orders/42' ? 'GET, DELETE' : 'GET'}`], why: 'The path exists but does not support this method. The Allow header lists the ones it does.' };
    }
    if (conditional && (path === '/' || path === '/logo.png')) {
      return { status: '304 Not Modified', headers: [`ETag: ${etag}`], why: 'The copy the browser already has is still current, so the server sends headers only and no body. The browser uses its cache.' };
    }
    if (path === '/') {
      return { status: '200 OK', headers: ['Content-Type: text/html; charset=utf-8', 'Cache-Control: no-cache', `ETag: ${etag}`], body: '<!doctype html><h1>Hello</h1>', why: 'Success. no-cache means "keep a copy, but check with me before reusing it", and the ETag is what the browser will quote when it checks.' };
    }
    if (path === '/logo.png') {
      return { status: '200 OK', headers: ['Content-Type: image/png', 'Cache-Control: max-age=31536000', `ETag: ${etag}`], body: '(1,204 bytes of image data)', why: 'Success. max-age tells the browser it may reuse this file for a year without asking again.' };
    }
    if (path === '/orders') return { status: '200 OK', headers: ['Content-Type: application/json'], body: '[{"id": 42, "item": "tea"}]', why: 'Success. GET is safe: it reads and changes nothing, so it can be repeated or cached freely.' };
    return { status: '200 OK', headers: ['Content-Type: application/json'], body: '{"id": 42, "item": "tea"}', why: 'Success. The body is JSON, as Content-Type says.' };
  };
  const reply = route();
  const sending = method === 'POST' ? '{"item": "tea"}' : '';
  const request = [
    `${method} ${path} HTTP/1.1`,
    'Host: shop.example',
    'Accept: */*',
    ...(conditional ? [`If-None-Match: ${etag}`] : []),
    ...(sending ? ['Content-Type: application/json', `Content-Length: ${sending.length}`] : []),
    '',
    sending,
  ];
  const response = [
    `HTTP/1.1 ${reply.status}`,
    ...reply.headers,
    ...(reply.body ? [`Content-Length: ${reply.body.startsWith('(') ? 1204 : reply.body.length}`] : []),
    '',
    reply.body ?? '',
  ];
  return { request: request.join('\n').trimEnd(), response: response.join('\n').trimEnd(), why: reply.why };
}

/* ---------- Routing ---------- */

export const routers: Record<string, [number, number]> = {
  A: [0, 0],
  B: [1, 0],
  C: [2, 0],
  D: [0, 1],
  E: [1, 1],
  F: [2, 1],
  G: [3, 0.5],
};

/** Links with their costs. G hangs off C alone, so cutting C–G strands it. */
export const routerLinks: [string, string, number][] = [
  ['A', 'B', 1],
  ['B', 'C', 1],
  ['A', 'D', 1],
  ['B', 'E', 2],
  ['C', 'F', 1],
  ['D', 'E', 1],
  ['E', 'F', 3],
  ['C', 'G', 1],
];

/** RIP's "infinity": a route this long is treated as no route at all. */
export const UNREACHABLE = 16;

export const linkKey = (a: string, b: string) => [a, b].sort().join('-');

/**
 * Distance-vector routing, run in synchronous rounds. In each round every
 * router hears its neighbours' tables from the round before and keeps, for
 * each destination, the neighbour that offers the cheapest total.
 */
export class DistanceVector {
  readonly names = Object.keys(routers);
  /** dist[r][d]: how far r believes d is. */
  dist: Record<string, Record<string, number>> = {};
  /** next[r][d]: the neighbour r forwards to for d, or null. */
  next: Record<string, Record<string, string | null>> = {};
  cut = new Set<string>();
  round = 0;
  splitHorizon = false;

  constructor() {
    for (const r of this.names) {
      this.dist[r] = {};
      this.next[r] = {};
      for (const d of this.names) {
        this.dist[r][d] = r === d ? 0 : UNREACHABLE;
        this.next[r][d] = null;
      }
    }
  }

  neighbours(r: string): [string, number][] {
    return routerLinks
      .filter(([a, b]) => (a === r || b === r) && !this.cut.has(linkKey(a, b)))
      .map(([a, b, cost]) => [a === r ? b : a, cost]);
  }

  /** One round of everyone sending everyone else their table. Returns whether anything changed. */
  step(): boolean {
    const dist: typeof this.dist = {};
    const next: typeof this.next = {};
    let changed = false;
    for (const r of this.names) {
      dist[r] = {};
      next[r] = {};
      for (const d of this.names) {
        if (r === d) {
          dist[r][d] = 0;
          next[r][d] = null;
          continue;
        }
        let best = UNREACHABLE;
        let via: string | null = null;
        for (const [n, cost] of this.neighbours(r)) {
          // With split horizon (poisoned reverse), n tells r "unreachable" for routes that go through r.
          const offer = this.splitHorizon && this.next[n][d] === r ? UNREACHABLE : this.dist[n][d];
          const total = Math.min(UNREACHABLE, cost + offer);
          if (total < best || (total === best && via !== null && n < via && total < UNREACHABLE)) {
            best = total;
            via = n;
          }
        }
        dist[r][d] = best;
        next[r][d] = best < UNREACHABLE ? via : null;
        if (dist[r][d] !== this.dist[r][d] || next[r][d] !== this.next[r][d]) changed = true;
      }
    }
    this.dist = dist;
    this.next = next;
    this.round++;
    return changed;
  }

  toggle(a: string, b: string) {
    const key = linkKey(a, b);
    if (this.cut.has(key)) this.cut.delete(key);
    else this.cut.add(key);
  }

  /** The true shortest distances to d, by Dijkstra's algorithm, for comparison. */
  truth(d: string): Record<string, number> {
    const best: Record<string, number> = Object.fromEntries(this.names.map((n) => [n, Infinity]));
    best[d] = 0;
    const done = new Set<string>();
    while (done.size < this.names.length) {
      const u = this.names.filter((n) => !done.has(n)).sort((a, b) => best[a] - best[b])[0];
      if (best[u] === Infinity) break;
      done.add(u);
      for (const [n, cost] of this.neighbours(u)) best[n] = Math.min(best[n], best[u] + cost);
    }
    return best;
  }
}

const routerAt = (name: string) => ({ x: 70 + routers[name][0] * 170, y: 60 + routers[name][1] * 170 });
export const routingView = { width: 650, height: 290 };

export function routingSvg(dv: DistanceVector, destination: string): string {
  const parts: string[] = [];
  for (const [a, b, cost] of routerLinks) {
    const p = routerAt(a);
    const q = routerAt(b);
    const cut = dv.cut.has(linkKey(a, b));
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    parts.push(
      `<g class="ro-link${cut ? ' cut' : ''}" data-link="${a},${b}"><line class="hit" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/><line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/><rect x="${mx - 11}" y="${my - 10}" width="22" height="20" rx="4"/><text x="${mx}" y="${my}">${cut ? '×' : cost}</text></g>`,
    );
  }
  // Each router's next hop towards the destination, as an arrow along the link.
  for (const r of dv.names) {
    const via = dv.next[r][destination];
    if (!via) continue;
    const p = routerAt(r);
    const q = routerAt(via);
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const ux = (q.x - p.x) / len;
    const uy = (q.y - p.y) / len;
    const x1 = p.x + ux * 26;
    const y1 = p.y + uy * 26;
    const x2 = q.x - ux * 28;
    const y2 = q.y - uy * 28;
    const a = Math.atan2(uy, ux);
    const head = [0.45, -0.45].map((o) => `${(x2 - 9 * Math.cos(a + o)).toFixed(1)},${(y2 - 9 * Math.sin(a + o)).toFixed(1)}`).join(' ');
    // Offset the arrow to one side of the link so arrows in both directions stay visible.
    const ox = -uy * 7;
    const oy = ux * 7;
    parts.push(
      `<g class="ro-hop" transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)})"><line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/><polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${head}"/></g>`,
    );
  }
  const truth = dv.truth(destination);
  for (const r of dv.names) {
    const p = routerAt(r);
    const d = dv.dist[r][destination];
    const wrong = r !== destination && d !== Math.min(truth[r], UNREACHABLE);
    const cls = r === destination ? ' dest' : d >= UNREACHABLE ? ' none' : wrong ? ' wrong' : '';
    parts.push(
      `<g class="ro-node${cls}" data-router="${r}"><circle cx="${p.x}" cy="${p.y}" r="20"/><text x="${p.x}" y="${p.y}">${r}</text><text class="ro-dist" x="${p.x}" y="${p.y + (routers[r][1] === 0 ? -33 : 33)}">${r === destination ? 'destination' : d >= UNREACHABLE ? '∞' : d}</text></g>`,
    );
  }
  return parts.join('');
}
