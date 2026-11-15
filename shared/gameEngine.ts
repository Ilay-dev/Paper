import type {
  FastTickPacket,
  FastTickPlayerState,
  GameMode,
  KillFeedEvent,
  KillReason,
  MatchStanding,
  MatchSummary,
  PublicPlayerMeta,
} from './types.ts';

export const MAX_HUMAN_PLAYERS = 8;
export const MAX_BOTS = 30;
export const MAX_ARENA_ENTITIES = MAX_HUMAN_PLAYERS + MAX_BOTS; // 38

export const GRID_WIDTH = 160;
export const GRID_HEIGHT = 160;
export const TOTAL_CELLS = GRID_WIDTH * GRID_HEIGHT;
export const ARENA_CENTER_X = GRID_WIDTH / 2;
export const ARENA_CENTER_Y = GRID_HEIGHT / 2;
export const ARENA_RADIUS = 76;

export const TICKS_PER_SECOND = 30;
export const MOVE_SPEED_CELLS_PER_SEC = 10;
export const MOVE_STEP_PER_TICK = MOVE_SPEED_CELLS_PER_SEC / TICKS_PER_SECOND; // 1/3 cell per tick
export const MAX_TURN_RATE_RAD_PER_SEC = 5.4;
export const MAX_TURN_STEP_PER_TICK = MAX_TURN_RATE_RAD_PER_SEC / TICKS_PER_SECOND; // 0.18 rad/tick

export const RESPAWN_TICKS = 0; // No respawn — elimination requires a new round
export const SPAWN_SHIELD_TICKS = 45; // 1.5 seconds
export const CONQUEST_WIN_PCT = 99.5;
export const MAX_CELL_DIFF_TRIPLETS = 1400;

export const ARENA_MASK = new Uint8Array(TOTAL_CELLS);
let validArenaCount = 0;
for (let y = 0; y < GRID_HEIGHT; y++) {
  for (let x = 0; x < GRID_WIDTH; x++) {
    const dx = x + 0.5 - ARENA_CENTER_X;
    const dy = y + 0.5 - ARENA_CENTER_Y;
    if (dx * dx + dy * dy <= ARENA_RADIUS * ARENA_RADIUS) {
      ARENA_MASK[y * GRID_WIDTH + x] = 1;
      validArenaCount += 1;
    }
  }
}
export const VALID_ARENA_CELLS = validArenaCount;

export const BOT_NAMES: string[] = [
  'Nova (Bot)',
  'Kairo (Bot)',
  'Vega (Bot)',
  'Echo (Bot)',
  'Lynx (Bot)',
  'Orion (Bot)',
  'Zeta (Bot)',
  'Flux (Bot)',
  'Apex (Bot)',
  'Vortex (Bot)',
  'Nyx (Bot)',
  'Pulse (Bot)',
  'Drift (Bot)',
  'Atlas (Bot)',
  'Sol (Bot)',
  'Iris (Bot)',
  'Rift (Bot)',
  'Byte (Bot)',
  'Koda (Bot)',
  'Sora (Bot)',
  'Milo (Bot)',
  'Juno (Bot)',
  'Aero (Bot)',
  'Taro (Bot)',
  'Rex (Bot)',
  'Zed (Bot)',
  'Lumen (Bot)',
  'Axel (Bot)',
  'Onyx (Bot)',
  'Qubit (Bot)',
];

export function getModeDurationMs(mode: GameMode): number {
  switch (mode) {
    case 'time_3m':
      return 180_000;
    case 'time_5m':
      return 300_000;
    case 'survival':
      return 0;
  }
}

export function safeRandomUUID(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export function secureRandomInt(minInclusive: number, maxExclusive: number): number {
  if (maxExclusive <= minInclusive) return minInclusive;
  const span = maxExclusive - minInclusive;
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / span) * span;
    let rand = 0;
    do {
      globalThis.crypto.getRandomValues(arr);
      rand = arr[0];
    } while (rand >= limit);
    return minInclusive + (rand % span);
  }
  return minInclusive + Math.floor(Math.random() * span);
}

export function normalizeAngle(rad: number): number {
  let a = rad % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

export function shortestAngleDiff(from: number, to: number): number {
  return normalizeAngle(to - from);
}

export function stepAngleToward(current: number, target: number, maxStep: number): number {
  const diff = shortestAngleDiff(current, target);
  if (Math.abs(diff) <= maxStep) {
    return normalizeAngle(target);
  }
  return normalizeAngle(current + Math.sign(diff) * maxStep);
}

export function isPointInArena(x: number, y: number): boolean {
  const dx = x - ARENA_CENTER_X;
  const dy = y - ARENA_CENTER_Y;
  const limit = ARENA_RADIUS - 0.35;
  return dx * dx + dy * dy <= limit * limit;
}

export function encodeRle(data: Uint8Array): number[] {
  if (data.length === 0) return [];
  const out: number[] = [];
  let current = data[0];
  let count = 1;
  for (let i = 1; i < data.length; i++) {
    const val = data[i];
    if (val === current) {
      count += 1;
    } else {
      out.push(current, count);
      current = val;
      count = 1;
    }
  }
  out.push(current, count);
  return out;
}

export function decodeRle(rle: number[], target: Uint8Array): void {
  let offset = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const val = rle[i];
    const count = rle[i + 1];
    const end = Math.min(target.length, offset + count);
    target.fill(val, offset, end);
    offset = end;
    if (offset >= target.length) break;
  }
}

export interface BotPlan {
  phase: 'roam' | 'curve' | 'retreat';
  ticksLeft: number;
  turnSign: 1 | -1;
  curveRate: number;
  maxLoopLen: number;
}

export interface InternalArenaPlayer {
  id: string;
  numId: number; // 1..38
  name: string;
  isHost: boolean;
  isBot: boolean;
  isReady: boolean;
  connected: boolean;
  reconnectToken: string;
  socketId: string | null;
  colorIndex: number;

  cellX: number;
  cellY: number;
  x: number;
  y: number;
  angle: number;
  targetAngle: number;

  alive: boolean;
  respawnTicks: number;
  shieldTicks: number;
  trailCells: number[];
  areaCells: number;
  maxAreaCells: number;
  kills: number;
  deaths: number;

  anchorCellX: number;
  anchorCellY: number;
  botPlan: BotPlan;
}

export interface InternalLobbyHuman {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  reconnectToken: string;
  socketId: string | null;
  colorIndex: number;
}

export interface InternalPaperGame {
  mode: GameMode;
  durationMs: number;
  width: number;
  height: number;
  arenaRadius: number;
  totalCells: number;
  validCells: number;
  tick: number;
  elapsedMs: number;
  remainingMs: number;

  ownerGrid: Uint8Array;
  trailGrid: Uint8Array;
  dirtyFlags: Uint8Array;
  dirtyList: number[];

  bfsVisited: Uint8Array;
  bfsQueue: Int32Array;
  areaScratch: Int32Array;

  players: InternalArenaPlayer[];
  playerById: Map<string, InternalArenaPlayer>;
  playerByNumId: Map<number, InternalArenaPlayer>;

  eventSeq: number;
  pendingEvents: KillFeedEvent[];
  recentEvents: KillFeedEvent[];

  ended: boolean;
  winReason: 'time' | 'conquest' | 'last_standing' | 'eliminated' | null;
  winnerNumId: number | null;
}

function markDirty(game: InternalPaperGame, idx: number): void {
  if (game.dirtyFlags[idx] === 0) {
    game.dirtyFlags[idx] = 1;
    game.dirtyList.push(idx);
  }
}

function setOwnerCell(game: InternalPaperGame, idx: number, numId: number): void {
  if (ARENA_MASK[idx] === 0 && numId !== 0) return;
  if (game.ownerGrid[idx] !== numId) {
    game.ownerGrid[idx] = numId;
    markDirty(game, idx);
  }
}

function setTrailCell(game: InternalPaperGame, idx: number, numId: number): void {
  if (ARENA_MASK[idx] === 0 && numId !== 0) return;
  if (game.trailGrid[idx] !== numId) {
    game.trailGrid[idx] = numId;
    markDirty(game, idx);
  }
}

function findBestSpawnSpot(game: InternalPaperGame): { cx: number; cy: number } {
  const maxSpawnR = game.arenaRadius - 10;
  let bestX = Math.floor(ARENA_CENTER_X);
  let bestY = Math.floor(ARENA_CENTER_Y);
  let bestScore = -1;

  for (let c = 0; c < 56; c++) {
    const r = Math.sqrt(Math.random()) * maxSpawnR;
    const theta = Math.random() * Math.PI * 2;
    const cx = Math.max(8, Math.min(game.width - 9, Math.round(ARENA_CENTER_X + Math.cos(theta) * r)));
    const cy = Math.max(8, Math.min(game.height - 9, Math.round(ARENA_CENTER_Y + Math.sin(theta) * r)));

    const centerIdx = cy * game.width + cx;
    if (ARENA_MASK[centerIdx] === 0) continue;

    let minDistSq = Infinity;
    for (const other of game.players) {
      if (!other.alive) continue;
      const dx = other.x - (cx + 0.5);
      const dy = other.y - (cy + 0.5);
      const distSq = dx * dx + dy * dy;
      if (distSq < minDistSq) {
        minDistSq = distSq;
      }
    }

    let occupiedCount = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gx >= game.width || gy < 0 || gy >= game.height) continue;
        const idx = gy * game.width + gx;
        if (game.trailGrid[idx] !== 0) occupiedCount += 5;
        else if (game.ownerGrid[idx] !== 0) occupiedCount += 1;
      }
    }

    const score =
      (Number.isFinite(minDistSq) ? Math.min(minDistSq, 1600) : 1600) - occupiedCount * 60;
    if (score > bestScore) {
      bestScore = score;
      bestX = cx;
      bestY = cy;
    }
  }

  return { cx: bestX, cy: bestY };
}

export function spawnPlayer(game: InternalPaperGame, player: InternalArenaPlayer): boolean {
  const { cx, cy } = findBestSpawnSpot(game);

  player.trailCells.length = 0;
  // Claim plump circular starting base (r <= 3.24 cells -> ~37 cells smooth disk)
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 10.5) continue;
      const gx = cx + dx;
      const gy = cy + dy;
      if (gx < 0 || gx >= game.width || gy < 0 || gy >= game.height) continue;
      const idx = gy * game.width + gx;
      if (ARENA_MASK[idx] === 1) {
        setOwnerCell(game, idx, player.numId);
        setTrailCell(game, idx, 0);
      }
    }
  }

  const startX = cx + 0.5;
  const startY = cy + 0.5;
  const startAngle = normalizeAngle(Math.atan2(ARENA_CENTER_Y - startY, ARENA_CENTER_X - startX));

  player.cellX = cx;
  player.cellY = cy;
  player.x = startX;
  player.y = startY;
  player.angle = startAngle;
  player.targetAngle = startAngle;
  player.alive = true;
  player.respawnTicks = 0;
  player.shieldTicks = SPAWN_SHIELD_TICKS;
  player.anchorCellX = cx;
  player.anchorCellY = cy;
  player.botPlan = {
    phase: 'roam',
    ticksLeft: secureRandomInt(10, 22),
    turnSign: secureRandomInt(0, 2) === 0 ? 1 : -1,
    curveRate: 0.045 + Math.random() * 0.04,
    maxLoopLen: secureRandomInt(14, 28),
  };

  return true;
}

export function createPaperGame(
  humans: InternalLobbyHuman[],
  botCount: number,
  mode: GameMode
): InternalPaperGame {
  const clampedBots = Math.max(0, Math.min(MAX_BOTS, botCount));
  const width = GRID_WIDTH;
  const height = GRID_HEIGHT;
  const totalCells = TOTAL_CELLS;
  const durationMs = getModeDurationMs(mode);

  const game: InternalPaperGame = {
    mode,
    durationMs,
    width,
    height,
    arenaRadius: ARENA_RADIUS,
    totalCells,
    validCells: VALID_ARENA_CELLS,
    tick: 0,
    elapsedMs: 0,
    remainingMs: durationMs,

    ownerGrid: new Uint8Array(totalCells),
    trailGrid: new Uint8Array(totalCells),
    dirtyFlags: new Uint8Array(totalCells),
    dirtyList: [],

    bfsVisited: new Uint8Array((width + 2) * (height + 2)),
    bfsQueue: new Int32Array((width + 2) * (height + 2)),
    areaScratch: new Int32Array(MAX_ARENA_ENTITIES + 2),

    players: [],
    playerById: new Map(),
    playerByNumId: new Map(),

    eventSeq: 0,
    pendingEvents: [],
    recentEvents: [],

    ended: false,
    winReason: null,
    winnerNumId: null,
  };

  const usedNames = new Set(humans.map((h) => h.name.toLowerCase()));
  let nextNumId = 1;

  for (const human of humans) {
    const numId = nextNumId++;
    const p: InternalArenaPlayer = {
      id: human.id,
      numId,
      name: human.name,
      isHost: human.isHost,
      isBot: false,
      isReady: human.isReady,
      connected: human.connected,
      reconnectToken: human.reconnectToken,
      socketId: human.socketId,
      colorIndex: human.colorIndex,
      cellX: 0,
      cellY: 0,
      x: 0,
      y: 0,
      angle: 0,
      targetAngle: 0,
      alive: false,
      respawnTicks: 0,
      shieldTicks: 0,
      trailCells: [],
      areaCells: 0,
      maxAreaCells: 0,
      kills: 0,
      deaths: 0,
      anchorCellX: 0,
      anchorCellY: 0,
      botPlan: {
        phase: 'roam',
        ticksLeft: 15,
        turnSign: 1,
        curveRate: 0.06,
        maxLoopLen: 18,
      },
    };
    game.players.push(p);
    game.playerById.set(p.id, p);
    game.playerByNumId.set(p.numId, p);
  }

  for (let b = 0; b < clampedBots; b++) {
    const numId = nextNumId++;
    let botName = BOT_NAMES[b] ?? `Bot ${b + 1}`;
    if (usedNames.has(botName.toLowerCase())) {
      botName = `${botName} #${b + 1}`;
    }
    usedNames.add(botName.toLowerCase());

    const botColorIndex = 8 + (b % MAX_BOTS);
    const bot: InternalArenaPlayer = {
      id: `bot-${b + 1}-${safeRandomUUID().slice(0, 6)}`,
      numId,
      name: botName,
      isHost: false,
      isBot: true,
      isReady: true,
      connected: true,
      reconnectToken: '',
      socketId: null,
      colorIndex: botColorIndex,
      cellX: 0,
      cellY: 0,
      x: 0,
      y: 0,
      angle: 0,
      targetAngle: 0,
      alive: false,
      respawnTicks: 0,
      shieldTicks: 0,
      trailCells: [],
      areaCells: 0,
      maxAreaCells: 0,
      kills: 0,
      deaths: 0,
      anchorCellX: 0,
      anchorCellY: 0,
      botPlan: {
        phase: 'roam',
        ticksLeft: 15,
        turnSign: 1,
        curveRate: 0.06,
        maxLoopLen: 18,
      },
    };
    game.players.push(bot);
    game.playerById.set(bot.id, bot);
    game.playerByNumId.set(bot.numId, bot);
  }

  for (const player of game.players) {
    spawnPlayer(game, player);
  }

  recountAllAreas(game);
  for (const idx of game.dirtyList) {
    game.dirtyFlags[idx] = 0;
  }
  game.dirtyList.length = 0;

  return game;
}

export function setPlayerTargetAngle(
  game: InternalPaperGame,
  playerId: string,
  targetAngle: number
): boolean {
  if (!Number.isFinite(targetAngle) || game.ended) return false;
  const player = game.playerById.get(playerId);
  if (!player || !player.alive) return false;
  player.targetAngle = normalizeAngle(targetAngle);
  return true;
}

function pushKillEvent(
  game: InternalPaperGame,
  killer: InternalArenaPlayer | null,
  victim: InternalArenaPlayer,
  reason: KillReason
): void {
  game.eventSeq += 1;
  const evt: KillFeedEvent = {
    id: `${game.tick}-${game.eventSeq}`,
    timestamp: Date.now(),
    killerNumId: killer ? killer.numId : null,
    killerName: killer ? killer.name : null,
    killerColorIndex: killer ? killer.colorIndex : null,
    victimNumId: victim.numId,
    victimName: victim.name,
    victimColorIndex: victim.colorIndex,
    reason,
  };
  game.pendingEvents.push(evt);
  game.recentEvents.unshift(evt);
  if (game.recentEvents.length > 12) {
    game.recentEvents.length = 12;
  }
}

function eliminatePlayer(
  game: InternalPaperGame,
  victim: InternalArenaPlayer,
  killer: InternalArenaPlayer | null,
  reason: KillReason
): void {
  if (!victim.alive) return;

  victim.alive = false;
  victim.deaths += 1;
  victim.respawnTicks = 0;
  victim.shieldTicks = 0;
  victim.areaCells = 0;

  if (killer && killer.numId !== victim.numId) {
    killer.kills += 1;
  }

  for (const idx of victim.trailCells) {
    if (game.trailGrid[idx] === victim.numId) {
      setTrailCell(game, idx, 0);
    }
  }
  victim.trailCells.length = 0;

  for (let i = 0; i < game.totalCells; i++) {
    if (game.ownerGrid[i] === victim.numId) {
      setOwnerCell(game, i, 0);
    }
    if (game.trailGrid[i] === victim.numId) {
      setTrailCell(game, i, 0);
    }
  }

  pushKillEvent(game, killer, victim, reason);
}

function closeLoopAndCapture(game: InternalPaperGame, player: InternalArenaPlayer): number[] {
  const stolenFromNumIds = new Set<number>();

  // Stamp trail cells + 4-neighbors for smooth, organic rounded ribbon captures
  for (const idx of player.trailCells) {
    const cx = idx % game.width;
    const cy = (idx / game.width) | 0;
    const offsets = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [ox, oy] of offsets) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || nx >= game.width || ny < 0 || ny >= game.height) continue;
      const nIdx = ny * game.width + nx;
      if (ARENA_MASK[nIdx] === 0) continue;
      const prevOwner = game.ownerGrid[nIdx];
      if (prevOwner !== 0 && prevOwner !== player.numId) {
        stolenFromNumIds.add(prevOwner);
      }
      setOwnerCell(game, nIdx, player.numId);
    }
    if (game.trailGrid[idx] === player.numId) {
      setTrailCell(game, idx, 0);
    }
  }
  player.trailCells.length = 0;

  let minX = game.width;
  let maxX = -1;
  let minY = game.height;
  let maxY = -1;

  for (let y = 0; y < game.height; y++) {
    const rowStart = y * game.width;
    for (let x = 0; x < game.width; x++) {
      if (game.ownerGrid[rowStart + x] === player.numId) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX) return [];

  const x0 = minX - 1;
  const x1 = maxX + 1;
  const y0 = minY - 1;
  const y1 = maxY + 1;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const bSize = bw * bh;

  const visited = game.bfsVisited;
  visited.fill(0, 0, bSize);
  const queue = game.bfsQueue;
  let qHead = 0;
  let qTail = 0;

  visited[0] = 1;
  queue[qTail++] = 0;

  while (qHead < qTail) {
    const localIdx = queue[qHead++];
    const lx = localIdx % bw;
    const ly = (localIdx / bw) | 0;

    if (lx > 0) {
      const nLocal = localIdx - 1;
      if (visited[nLocal] === 0) {
        const gx = x0 + lx - 1;
        const gy = y0 + ly;
        const owned =
          gx >= 0 &&
          gx < game.width &&
          gy >= 0 &&
          gy < game.height &&
          game.ownerGrid[gy * game.width + gx] === player.numId;
        if (!owned) {
          visited[nLocal] = 1;
          queue[qTail++] = nLocal;
        }
      }
    }
    if (lx + 1 < bw) {
      const nLocal = localIdx + 1;
      if (visited[nLocal] === 0) {
        const gx = x0 + lx + 1;
        const gy = y0 + ly;
        const owned =
          gx >= 0 &&
          gx < game.width &&
          gy >= 0 &&
          gy < game.height &&
          game.ownerGrid[gy * game.width + gx] === player.numId;
        if (!owned) {
          visited[nLocal] = 1;
          queue[qTail++] = nLocal;
        }
      }
    }
    if (ly > 0) {
      const nLocal = localIdx - bw;
      if (visited[nLocal] === 0) {
        const gx = x0 + lx;
        const gy = y0 + ly - 1;
        const owned =
          gx >= 0 &&
          gx < game.width &&
          gy >= 0 &&
          gy < game.height &&
          game.ownerGrid[gy * game.width + gx] === player.numId;
        if (!owned) {
          visited[nLocal] = 1;
          queue[qTail++] = nLocal;
        }
      }
    }
    if (ly + 1 < bh) {
      const nLocal = localIdx + bw;
      if (visited[nLocal] === 0) {
        const gx = x0 + lx;
        const gy = y0 + ly + 1;
        const owned =
          gx >= 0 &&
          gx < game.width &&
          gy >= 0 &&
          gy < game.height &&
          game.ownerGrid[gy * game.width + gx] === player.numId;
        if (!owned) {
          visited[nLocal] = 1;
          queue[qTail++] = nLocal;
        }
      }
    }
  }

  for (let gy = minY; gy <= maxY; gy++) {
    const ly = gy - y0;
    const localRow = ly * bw;
    const gridRow = gy * game.width;
    for (let gx = minX; gx <= maxX; gx++) {
      const lx = gx - x0;
      if (visited[localRow + lx] === 0) {
        const gIdx = gridRow + gx;
        if (ARENA_MASK[gIdx] === 0) continue;
        const prevOwner = game.ownerGrid[gIdx];
        if (prevOwner !== player.numId) {
          if (prevOwner !== 0) {
            stolenFromNumIds.add(prevOwner);
          }
          setOwnerCell(game, gIdx, player.numId);
        }
      }
    }
  }

  return Array.from(stolenFromNumIds);
}

export function recountAllAreas(game: InternalPaperGame): void {
  const counts = game.areaScratch;
  counts.fill(0);
  const ownerGrid = game.ownerGrid;
  for (let i = 0; i < game.totalCells; i++) {
    const owner = ownerGrid[i];
    if (owner > 0 && owner < counts.length) {
      counts[owner] += 1;
    }
  }
  for (const player of game.players) {
    player.areaCells = counts[player.numId];
    if (player.areaCells > player.maxAreaCells) {
      player.maxAreaCells = player.areaCells;
    }
  }
}

function isAngleSafeForBot(
  game: InternalPaperGame,
  bot: InternalArenaPlayer,
  angle: number,
  lookCells = 3.2
): boolean {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let step = 1; step <= lookCells; step += 0.8) {
    const px = bot.x + cos * step;
    const py = bot.y + sin * step;
    if (!isPointInArena(px, py)) return false;
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    const idx = cy * game.width + cx;
    if (game.trailGrid[idx] === bot.numId) {
      const trailPos = bot.trailCells.lastIndexOf(idx);
      if (trailPos !== -1 && trailPos < bot.trailCells.length - 5) {
        return false;
      }
    }
  }
  return true;
}

function updateBotDecision(game: InternalPaperGame, bot: InternalArenaPlayer): void {
  const distFromCenter = Math.hypot(bot.x - ARENA_CENTER_X, bot.y - ARENA_CENTER_Y);

  // 1. Hard boundary avoidance near circular wall
  if (distFromCenter > game.arenaRadius - 7.5) {
    const inward = Math.atan2(ARENA_CENTER_Y - bot.y, ARENA_CENTER_X - bot.x);
    bot.targetAngle = inward;
    return;
  }

  const candidateOffsets = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35];
  const safeAngles = candidateOffsets
    .map((off) => normalizeAngle(bot.angle + off))
    .filter((ang) => isAngleSafeForBot(game, bot, ang, 3.2));

  if (safeAngles.length === 0) {
    // Emergency turn toward center
    bot.targetAngle = Math.atan2(ARENA_CENTER_Y - bot.y, ARENA_CENTER_X - bot.x);
    return;
  }

  // 2. Opportunistic kill if an enemy trail is within 5 cells along a safe angle
  for (const ang of safeAngles) {
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    for (let s = 1; s <= 5; s += 1) {
      const px = bot.x + cos * s;
      const py = bot.y + sin * s;
      if (!isPointInArena(px, py)) break;
      const idx = Math.floor(py) * game.width + Math.floor(px);
      const tOwner = game.trailGrid[idx];
      if (tOwner !== 0 && tOwner !== bot.numId) {
        bot.targetAngle = ang;
        return;
      }
    }
  }

  const currentIdx = bot.cellY * game.width + bot.cellX;
  const onOwnTerritory = game.ownerGrid[currentIdx] === bot.numId;
  if (onOwnTerritory) {
    bot.anchorCellX = bot.cellX;
    bot.anchorCellY = bot.cellY;
    if (bot.botPlan.phase === 'retreat') {
      bot.botPlan.phase = 'roam';
      bot.botPlan.ticksLeft = secureRandomInt(10, 24);
      bot.botPlan.turnSign = secureRandomInt(0, 2) === 0 ? 1 : -1;
      bot.botPlan.curveRate = 0.045 + Math.random() * 0.045;
      bot.botPlan.maxLoopLen = secureRandomInt(14, 28);
    }
  }

  // 3. Check enemy threat near bot while trailing
  let enemyThreat = false;
  if (!onOwnTerritory && bot.trailCells.length > 0) {
    for (const other of game.players) {
      if (!other.alive || other.numId === bot.numId) continue;
      const d = Math.hypot(other.x - bot.x, other.y - bot.y);
      if (d <= 8) {
        enemyThreat = true;
        break;
      }
    }
  }

  // 4. Retreat to own territory when loop is long enough or threatened
  if (
    !onOwnTerritory &&
    (bot.trailCells.length >= bot.botPlan.maxLoopLen || enemyThreat || bot.botPlan.phase === 'retreat')
  ) {
    bot.botPlan.phase = 'retreat';
    const homeAngle = Math.atan2(bot.anchorCellY + 0.5 - bot.y, bot.anchorCellX + 0.5 - bot.x);
    let bestAngle = safeAngles[0];
    let bestDiff = Infinity;
    for (const ang of safeAngles) {
      const diff = Math.abs(shortestAngleDiff(ang, homeAngle));
      if (diff < bestDiff) {
        bestDiff = diff;
        bestAngle = ang;
      }
    }
    bot.targetAngle = bestAngle;
    return;
  }

  // 5. Smooth organic looping excursion
  bot.botPlan.ticksLeft -= 1;
  if (bot.botPlan.ticksLeft <= 0) {
    if (bot.botPlan.phase === 'roam') {
      bot.botPlan.phase = 'curve';
      bot.botPlan.ticksLeft = secureRandomInt(16, 32);
    } else {
      bot.botPlan.phase = 'retreat';
      bot.botPlan.ticksLeft = 10;
    }
  }

  let desired = bot.angle;
  if (bot.botPlan.phase === 'curve') {
    desired = normalizeAngle(bot.angle + bot.botPlan.turnSign * bot.botPlan.curveRate);
  }

  if (!isAngleSafeForBot(game, bot, desired, 3.2)) {
    desired = safeAngles[0];
  }
  bot.targetAngle = desired;
}

function getVisitedCellsForStep(
  prevX: number,
  prevY: number,
  nextX: number,
  nextY: number
): Array<{ cx: number; cy: number }> {
  const prevCx = Math.floor(prevX);
  const prevCy = Math.floor(prevY);
  const nextCx = Math.floor(nextX);
  const nextCy = Math.floor(nextY);

  if (prevCx === nextCx && prevCy === nextCy) {
    return [];
  }

  if (prevCx !== nextCx && prevCy !== nextCy) {
    // Diagonal crossing: insert orthogonal bridge cell so trail is strictly 4-connected
    const bxEdge = nextCx > prevCx ? nextCx : prevCx;
    const byEdge = nextCy > prevCy ? nextCy : prevCy;
    const dx = nextX - prevX;
    const dy = nextY - prevY;
    const tx = dx !== 0 ? (bxEdge - prevX) / dx : Infinity;
    const ty = dy !== 0 ? (byEdge - prevY) / dy : Infinity;

    if (tx <= ty) {
      return [
        { cx: nextCx, cy: prevCy },
        { cx: nextCx, cy: nextCy },
      ];
    }
    return [
      { cx: prevCx, cy: nextCy },
      { cx: nextCx, cy: nextCy },
    ];
  }

  return [{ cx: nextCx, cy: nextCy }];
}

export function stepGameTick(game: InternalPaperGame): FastTickPacket {
  if (game.ended) {
    return buildFastTickPacket(game);
  }

  game.tick += 1;
  game.elapsedMs = Math.round((game.tick * 1000) / TICKS_PER_SECOND);
  game.remainingMs =
    game.durationMs > 0 ? Math.max(0, game.durationMs - game.elapsedMs) : 0;

  let territoryChanged = false;

  // 1. Bot steering, smooth angle interpolation & continuous movement (no respawns)
  interface StepResult {
    player: InternalArenaPlayer;
    visitedCells: Array<{ cx: number; cy: number }>;
  }

  const stepResults: StepResult[] = [];

  for (const player of game.players) {
    if (!player.alive) continue;

    if (player.shieldTicks > 0) {
      player.shieldTicks -= 1;
    }

    if (player.isBot) {
      updateBotDecision(game, player);
    }

    player.angle = stepAngleToward(player.angle, player.targetAngle, MAX_TURN_STEP_PER_TICK);
    const prevX = player.x;
    const prevY = player.y;
    const nextX = prevX + Math.cos(player.angle) * MOVE_STEP_PER_TICK;
    const nextY = prevY + Math.sin(player.angle) * MOVE_STEP_PER_TICK;

    if (
      nextX < 0 ||
      nextX >= game.width ||
      nextY < 0 ||
      nextY >= game.height ||
      !isPointInArena(nextX, nextY)
    ) {
      eliminatePlayer(game, player, null, 'wall');
      territoryChanged = true;
      continue;
    }

    player.x = nextX;
    player.y = nextY;
    player.cellX = Math.floor(nextX);
    player.cellY = Math.floor(nextY);

    const visitedCells = getVisitedCellsForStep(prevX, prevY, nextX, nextY);
    if (visitedCells.length > 0) {
      stepResults.push({ player, visitedCells });
    }
  }

  // 3. Head-to-head continuous distance collisions
  const alivePlayers = game.players.filter((p) => p.alive);
  for (let i = 0; i < alivePlayers.length; i++) {
    const a = alivePlayers[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < alivePlayers.length; j++) {
      const b = alivePlayers[j];
      if (!b.alive) continue;
      const distSq = (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
      if (distSq < 0.72) {
        const aIdx = a.cellY * game.width + a.cellX;
        const bIdx = b.cellY * game.width + b.cellX;
        const aOnOwn = game.ownerGrid[aIdx] === a.numId;
        const bOnOwn = game.ownerGrid[bIdx] === b.numId;

        if (aOnOwn && !bOnOwn) {
          eliminatePlayer(game, b, a, 'head');
        } else if (bOnOwn && !aOnOwn) {
          eliminatePlayer(game, a, b, 'head');
        } else if (a.areaCells > b.areaCells) {
          eliminatePlayer(game, b, a, 'head');
        } else if (b.areaCells > a.areaCells) {
          eliminatePlayer(game, a, b, 'head');
        } else {
          eliminatePlayer(game, a, b, 'head');
          eliminatePlayer(game, b, a, 'head');
        }
        territoryChanged = true;
      }
    }
  }

  // 4. Trail-cut collisions along visited cells
  for (const res of stepResults) {
    const p = res.player;
    if (!p.alive) continue;
    for (const cell of res.visitedCells) {
      if (!p.alive) break;
      if (cell.cx < 0 || cell.cx >= game.width || cell.cy < 0 || cell.cy >= game.height) continue;
      const vIdx = cell.cy * game.width + cell.cx;
      const trailOwnerNum = game.trailGrid[vIdx];
      if (trailOwnerNum !== 0) {
        if (trailOwnerNum === p.numId) {
          const lastIdx = p.trailCells.lastIndexOf(vIdx);
          if (lastIdx !== -1 && lastIdx < p.trailCells.length - 6) {
            eliminatePlayer(game, p, null, 'self');
            territoryChanged = true;
          }
        } else {
          const victim = game.playerByNumId.get(trailOwnerNum);
          if (victim && victim.alive) {
            eliminatePlayer(game, victim, p, 'cut');
            territoryChanged = true;
          }
        }
      }
    }
  }

  // 5. Close loops & extend watertight trails
  const wipeoutCheck: Array<{ victimNumId: number; capturer: InternalArenaPlayer }> = [];

  for (const res of stepResults) {
    const p = res.player;
    if (!p.alive) continue;

    for (const cell of res.visitedCells) {
      if (cell.cx < 0 || cell.cx >= game.width || cell.cy < 0 || cell.cy >= game.height) continue;
      const vIdx = cell.cy * game.width + cell.cx;
      if (ARENA_MASK[vIdx] === 0) continue;

      if (game.ownerGrid[vIdx] === p.numId) {
        p.anchorCellX = cell.cx;
        p.anchorCellY = cell.cy;
        if (p.trailCells.length > 0) {
          const affectedNumIds = closeLoopAndCapture(game, p);
          for (const victimNumId of affectedNumIds) {
            wipeoutCheck.push({ victimNumId, capturer: p });
          }
          territoryChanged = true;
        }
      } else {
        setTrailCell(game, vIdx, p.numId);
        if (p.trailCells[p.trailCells.length - 1] !== vIdx) {
          p.trailCells.push(vIdx);
        }
      }
    }
  }

  // 6. Recount territories & eliminate wiped-out players
  if (territoryChanged) {
    recountAllAreas(game);
    for (const { victimNumId, capturer } of wipeoutCheck) {
      const victim = game.playerByNumId.get(victimNumId);
      if (victim && victim.alive && victim.areaCells === 0) {
        eliminatePlayer(game, victim, capturer.alive ? capturer : null, 'wipeout');
      }
    }
    if (wipeoutCheck.length > 0) {
      recountAllAreas(game);
    }
  }

  // 7. Check win conditions
  checkWinConditions(game);

  return buildFastTickPacket(game);
}

function checkWinConditions(game: InternalPaperGame): void {
  if (game.ended) return;

  const conquestThreshold = Math.ceil((CONQUEST_WIN_PCT / 100) * game.validCells);
  for (const p of game.players) {
    if (p.alive && p.areaCells >= conquestThreshold) {
      game.ended = true;
      game.winReason = 'conquest';
      game.winnerNumId = p.numId;
      return;
    }
  }

  // If all human players are eliminated (no respawn), end the round immediately
  const humanPlayers = game.players.filter((p) => !p.isBot);
  if (humanPlayers.length > 0 && humanPlayers.every((p) => !p.alive)) {
    game.ended = true;
    game.winReason = 'eliminated';
    const sorted = [...game.players].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return (
        b.areaCells - a.areaCells ||
        b.maxAreaCells - a.maxAreaCells ||
        b.kills - a.kills
      );
    });
    game.winnerNumId = sorted[0]?.numId ?? null;
    return;
  }

  if (game.players.length >= 2) {
    const alivePlayers = game.players.filter((p) => p.alive);
    if (alivePlayers.length <= 1) {
      game.ended = true;
      game.winReason = 'last_standing';
      if (alivePlayers.length === 1) {
        game.winnerNumId = alivePlayers[0].numId;
      } else {
        const sorted = [...game.players].sort((a, b) => b.maxAreaCells - a.maxAreaCells || b.kills - a.kills);
        game.winnerNumId = sorted[0]?.numId ?? null;
      }
      return;
    }
  }

  if (game.durationMs > 0 && game.elapsedMs >= game.durationMs) {
    game.ended = true;
    game.winReason = 'time';
    const sorted = [...game.players].sort(
      (a, b) =>
        b.areaCells - a.areaCells ||
        b.maxAreaCells - a.maxAreaCells ||
        b.kills - a.kills
    );
    game.winnerNumId = sorted[0]?.numId ?? null;
  }
}

export function buildFastTickPacket(game: InternalPaperGame): FastTickPacket {
  const players: FastTickPlayerState[] = game.players.map((p) => [
    p.numId,
    Number(p.x.toFixed(3)),
    Number(p.y.toFixed(3)),
    Number(p.angle.toFixed(3)),
    Number(p.targetAngle.toFixed(3)),
    p.alive ? 1 : 0,
    p.respawnTicks,
    p.areaCells,
    p.maxAreaCells,
    p.kills,
    p.deaths,
    p.shieldTicks,
  ]);

  let cellDiffs: number[] = [];
  let fullOwnerRle: number[] | undefined;
  let fullTrailRle: number[] | undefined;

  if (game.dirtyList.length > MAX_CELL_DIFF_TRIPLETS) {
    fullOwnerRle = encodeRle(game.ownerGrid);
    fullTrailRle = encodeRle(game.trailGrid);
    for (const idx of game.dirtyList) {
      game.dirtyFlags[idx] = 0;
    }
    game.dirtyList.length = 0;
  } else if (game.dirtyList.length > 0) {
    cellDiffs = new Array<number>(game.dirtyList.length * 3);
    let ptr = 0;
    for (const idx of game.dirtyList) {
      cellDiffs[ptr++] = idx;
      cellDiffs[ptr++] = game.ownerGrid[idx];
      cellDiffs[ptr++] = game.trailGrid[idx];
      game.dirtyFlags[idx] = 0;
    }
    game.dirtyList.length = 0;
  }

  const events = game.pendingEvents.splice(0, game.pendingEvents.length);

  return {
    tick: game.tick,
    elapsedMs: game.elapsedMs,
    remainingMs: game.remainingMs,
    players,
    cellDiffs,
    fullOwnerRle,
    fullTrailRle,
    events,
  };
}

export function serializeArenaPlayers(game: InternalPaperGame): PublicPlayerMeta[] {
  return game.players.map((p) => ({
    id: p.id,
    numId: p.numId,
    name: p.name,
    isHost: p.isHost,
    isBot: p.isBot,
    isReady: p.isReady,
    connected: p.connected,
    colorIndex: p.colorIndex,
    kills: p.kills,
    deaths: p.deaths,
    areaCells: p.areaCells,
    maxAreaCells: p.maxAreaCells,
    areaPct: Number(((p.areaCells / game.validCells) * 100).toFixed(2)),
    maxAreaPct: Number(((p.maxAreaCells / game.validCells) * 100).toFixed(2)),
    alive: p.alive,
  }));
}

export function buildMatchSummary(game: InternalPaperGame): MatchSummary {
  const standings: MatchStanding[] = [...game.players]
    .sort((a, b) => {
      if (game.mode === 'survival') {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
      }
      return (
        b.areaCells - a.areaCells ||
        b.maxAreaCells - a.maxAreaCells ||
        b.kills - a.kills
      );
    })
    .map((p) => ({
      id: p.id,
      numId: p.numId,
      name: p.name,
      isBot: p.isBot,
      colorIndex: p.colorIndex,
      finalAreaCells: p.areaCells,
      finalAreaPct: Number(((p.areaCells / game.validCells) * 100).toFixed(2)),
      maxAreaPct: Number(((p.maxAreaCells / game.validCells) * 100).toFixed(2)),
      kills: p.kills,
      deaths: p.deaths,
      alive: p.alive,
    }));

  const winner =
    (game.winnerNumId !== null ? game.playerByNumId.get(game.winnerNumId) : null) ??
    game.players.find((p) => p.numId === standings[0]?.numId) ??
    game.players[0];

  return {
    mode: game.mode,
    durationMs: game.elapsedMs,
    winReason: game.winReason ?? 'time',
    winnerId: winner?.id ?? null,
    winnerName: winner?.name ?? 'Niemand',
    winnerColorIndex: winner?.colorIndex ?? 0,
    standings,
  };
}
