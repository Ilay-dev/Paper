export type GameMode = 'time_3m' | 'time_5m' | 'survival';
export type RoomPhase = 'lobby' | 'playing' | 'match_over';
export type KillReason = 'cut' | 'head' | 'wall' | 'self' | 'wipeout';

export interface LobbyHumanPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  colorIndex: number;
}

export interface PublicPlayerMeta {
  id: string;
  numId: number;
  name: string;
  isHost: boolean;
  isBot: boolean;
  isReady: boolean;
  connected: boolean;
  colorIndex: number;
  kills: number;
  deaths: number;
  areaCells: number;
  maxAreaCells: number;
  areaPct: number;
  maxAreaPct: number;
  alive: boolean;
}

/**
 * Compact 12-element tuple sent at 30 Hz per player/bot:
 * [0: numId, 1: x, 2: y, 3: angle (rad), 4: targetAngle (rad), 5: aliveFlag(0|1),
 *  6: respawnTicks, 7: areaCells, 8: maxAreaCells, 9: kills, 10: deaths, 11: shieldTicks]
 */
export type FastTickPlayerState = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface KillFeedEvent {
  id: string;
  timestamp: number;
  killerNumId: number | null;
  killerName: string | null;
  killerColorIndex: number | null;
  victimNumId: number;
  victimName: string;
  victimColorIndex: number;
  reason: KillReason;
  bonusPct?: number;
}

export interface GridSyncPacket {
  tick: number;
  width: number;
  height: number;
  arenaRadius: number;
  ownerRle: number[];
  trailRle: number[];
}

export interface FastTickPacket {
  tick: number;
  elapsedMs: number;
  remainingMs: number;
  players: FastTickPlayerState[];
  /** Flat triplets: [cellIndex, ownerNumId, trailNumId, ...] */
  cellDiffs: number[];
  fullOwnerRle?: number[];
  fullTrailRle?: number[];
  events: KillFeedEvent[];
}

export interface MatchStanding {
  id: string;
  numId: number;
  name: string;
  isBot: boolean;
  colorIndex: number;
  finalAreaCells: number;
  finalAreaPct: number;
  maxAreaPct: number;
  kills: number;
  deaths: number;
  alive: boolean;
}

export interface MatchSummary {
  mode: GameMode;
  durationMs: number;
  winReason: 'time' | 'conquest' | 'last_standing';
  winnerId: string | null;
  winnerName: string;
  winnerColorIndex: number;
  standings: MatchStanding[];
}

export interface ClientRoomState {
  roomCode: string;
  phase: RoomPhase;
  myPlayerId: string;
  myNumId: number | null;
  hostId: string;
  gameMode: GameMode;
  botCount: number;
  humanPlayers: LobbyHumanPlayer[];
  arenaPlayers: PublicPlayerMeta[];
  countdownSeconds: number | null;
  matchSummary: MatchSummary | null;
  gridWidth: number;
  gridHeight: number;
  arenaRadius: number;
  totalCells: number;
}

export interface SessionCredentials {
  roomCode: string;
  playerId: string;
  reconnectToken: string;
}

export interface RoomActionResponse {
  ok: boolean;
  error?: string;
  credentials?: SessionCredentials;
}
