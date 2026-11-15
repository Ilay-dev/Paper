import {
  ARENA_RADIUS,
  GRID_HEIGHT,
  GRID_WIDTH,
  type InternalLobbyHuman,
  type InternalPaperGame,
  MAX_BOTS,
  MAX_HUMAN_PLAYERS,
  TICKS_PER_SECOND,
  VALID_ARENA_CELLS,
  buildMatchSummary,
  createPaperGame,
  encodeRle,
  safeRandomUUID,
  secureRandomInt,
  serializeArenaPlayers,
  setPlayerTargetAngle,
  stepGameTick,
} from '../../shared/gameEngine.ts';
import type {
  ClientRoomState,
  FastTickPacket,
  GameMode,
  GridSyncPacket,
  LobbyHumanPlayer,
  MatchSummary,
  RoomActionResponse,
  RoomPhase,
  SessionCredentials,
} from '../../shared/types.ts';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TICK_INTERVAL_MS = 1000 / TICKS_PER_SECOND;

export interface BrowserPaperRoom {
  code: string;
  phase: RoomPhase;
  hostId: string;
  gameMode: GameMode;
  botCount: number;
  humanPlayers: InternalLobbyHuman[];
  countdownSeconds: number | null;
  countdownTimer: ReturnType<typeof setInterval> | null;
  tickTimer: ReturnType<typeof setTimeout> | null;
  nextTickAt: number;
  game: InternalPaperGame | null;
  matchSummary: MatchSummary | null;
}

export type PeerStateSendFn = (peerId: string, state: ClientRoomState) => void;
export type PeerGridSyncFn = (peerId: string, sync: GridSyncPacket) => void;
export type PeerTickSendFn = (peerId: string, tick: FastTickPacket) => void;
export type PeerKickFn = (peerId: string, reason: string) => void;

export function generateBrowserRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_ALPHABET[secureRandomInt(0, ROOM_ALPHABET.length)];
  }
  return code;
}

export class BrowserHostManager {
  public readonly room: BrowserPaperRoom;
  private onBroadcastState: PeerStateSendFn;
  private onSendGridSync: PeerGridSyncFn;
  private onBroadcastTick: PeerTickSendFn;
  private onKicked: PeerKickFn;

  constructor(
    roomCode: string,
    hostName: string,
    onBroadcastState: PeerStateSendFn,
    onSendGridSync: PeerGridSyncFn,
    onBroadcastTick: PeerTickSendFn,
    onKicked: PeerKickFn
  ) {
    this.onBroadcastState = onBroadcastState;
    this.onSendGridSync = onSendGridSync;
    this.onBroadcastTick = onBroadcastTick;
    this.onKicked = onKicked;

    const hostId = safeRandomUUID();
    const host: InternalLobbyHuman = {
      id: hostId,
      name: this.sanitizeName(hostName),
      isHost: true,
      isReady: false,
      connected: true,
      reconnectToken: safeRandomUUID(),
      socketId: 'HOST_LOCAL',
      colorIndex: 0,
    };

    this.room = {
      code: roomCode,
      phase: 'lobby',
      hostId,
      gameMode: 'time_3m',
      botCount: 10,
      humanPlayers: [host],
      countdownSeconds: null,
      countdownTimer: null,
      tickTimer: null,
      nextTickAt: 0,
      game: null,
      matchSummary: null,
    };
  }

  public getHostPlayerId(): string {
    return this.room.hostId;
  }

  public destroy(): void {
    this.clearCountdown();
    this.stopGameLoop();
  }

  private sanitizeName(rawName: string): string {
    const cleaned = rawName.trim().replace(/\s+/g, ' ').slice(0, 18);
    return cleaned || 'Spieler';
  }

  private uniqueName(baseName: string): string {
    const existing = new Set(this.room.humanPlayers.map((p) => p.name.toLowerCase()));
    if (!existing.has(baseName.toLowerCase())) return baseName;
    for (let i = 2; i <= 20; i++) {
      const candidate = `${baseName.slice(0, 14)} (${i})`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${baseName.slice(0, 12)}-${secureRandomInt(10, 99)}`;
  }

  private nextAvailableHumanColorIndex(): number {
    const used = new Set(this.room.humanPlayers.map((p) => p.colorIndex));
    for (let i = 0; i < MAX_HUMAN_PLAYERS; i++) {
      if (!used.has(i)) return i;
    }
    return this.room.humanPlayers.length % MAX_HUMAN_PLAYERS;
  }

  private clearCountdown(): void {
    if (this.room.countdownTimer) {
      clearInterval(this.room.countdownTimer);
      this.room.countdownTimer = null;
    }
    this.room.countdownSeconds = null;
  }

  private stopGameLoop(): void {
    if (this.room.tickTimer) {
      clearTimeout(this.room.tickTimer);
      this.room.tickTimer = null;
    }
  }

  public broadcast(): void {
    for (const player of this.room.humanPlayers) {
      if (player.socketId && player.connected) {
        this.onBroadcastState(player.socketId, this.serializeForPlayer(player.id));
      }
    }
  }

  private sendGridSyncToAll(game: InternalPaperGame): void {
    const packet: GridSyncPacket = {
      tick: game.tick,
      width: game.width,
      height: game.height,
      arenaRadius: game.arenaRadius,
      ownerRle: encodeRle(game.ownerGrid),
      trailRle: encodeRle(game.trailGrid),
    };
    for (const player of this.room.humanPlayers) {
      if (player.socketId && player.connected) {
        this.onSendGridSync(player.socketId, packet);
      }
    }
  }

  public serializeForPlayer(playerId: string): ClientRoomState {
    const game = this.room.game;
    const myArenaPlayer = game ? game.playerById.get(playerId) : undefined;

    const lobbyHumans: LobbyHumanPlayer[] = this.room.humanPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      isReady: p.isReady,
      connected: p.connected,
      colorIndex: p.colorIndex,
    }));

    return {
      roomCode: this.room.code,
      phase: this.room.phase,
      myPlayerId: playerId,
      myNumId: myArenaPlayer?.numId ?? null,
      hostId: this.room.hostId,
      gameMode: this.room.gameMode,
      botCount: this.room.botCount,
      humanPlayers: lobbyHumans,
      arenaPlayers: game ? serializeArenaPlayers(game) : [],
      countdownSeconds: this.room.countdownSeconds,
      matchSummary: this.room.matchSummary,
      gridWidth: game?.width ?? GRID_WIDTH,
      gridHeight: game?.height ?? GRID_HEIGHT,
      arenaRadius: game?.arenaRadius ?? ARENA_RADIUS,
      totalCells: game?.validCells ?? VALID_ARENA_CELLS,
    };
  }

  private findPlayerByPeer(peerId: string): InternalLobbyHuman | undefined {
    return this.room.humanPlayers.find((p) => p.socketId === peerId);
  }

  public joinGuest(peerId: string, rawName: string): RoomActionResponse {
    if (this.room.phase !== 'lobby') {
      return { ok: false, error: 'In diesem Room läuft bereits eine Partie.' };
    }
    if (this.room.humanPlayers.length >= MAX_HUMAN_PLAYERS) {
      return {
        ok: false,
        error: `Der Room ist bereits voll (max. ${MAX_HUMAN_PLAYERS} Spieler).`,
      };
    }

    const playerId = safeRandomUUID();
    const reconnectToken = safeRandomUUID();
    const name = this.uniqueName(this.sanitizeName(rawName));
    const colorIndex = this.nextAvailableHumanColorIndex();

    const player: InternalLobbyHuman = {
      id: playerId,
      name,
      isHost: false,
      isReady: false,
      connected: true,
      reconnectToken,
      socketId: peerId,
      colorIndex,
    };

    this.room.humanPlayers.push(player);
    this.clearCountdown();
    this.broadcast();

    return {
      ok: true,
      credentials: { roomCode: this.room.code, playerId, reconnectToken },
    };
  }

  public rejoinGuest(peerId: string, creds: SessionCredentials): RoomActionResponse {
    if (creds.roomCode.trim().toUpperCase() !== this.room.code) {
      return { ok: false, error: 'Falscher Room-Code.' };
    }
    const player = this.room.humanPlayers.find(
      (p) => p.id === creds.playerId && p.reconnectToken === creds.reconnectToken
    );
    if (!player) {
      return { ok: false, error: 'Sitzung abgelaufen.' };
    }
    player.socketId = peerId;
    player.connected = true;

    const arenaP = this.room.game?.playerById.get(player.id);
    if (arenaP) {
      arenaP.connected = true;
      arenaP.socketId = peerId;
    }

    this.broadcast();
    if (this.room.phase === 'playing' && this.room.game) {
      this.onSendGridSync(peerId, {
        tick: this.room.game.tick,
        width: this.room.game.width,
        height: this.room.game.height,
        arenaRadius: this.room.game.arenaRadius,
        ownerRle: encodeRle(this.room.game.ownerGrid),
        trailRle: encodeRle(this.room.game.trailGrid),
      });
    }

    return { ok: true, credentials: creds };
  }

  public handlePeerDisconnect(peerId: string): void {
    const player = this.findPlayerByPeer(peerId);
    if (!player) return;

    if (this.room.phase === 'lobby') {
      this.removePlayerInternal(player.id);
      return;
    }

    player.connected = false;
    const arenaP = this.room.game?.playerById.get(player.id);
    if (arenaP) {
      arenaP.connected = false;
    }
    this.broadcast();
  }

  public leaveGuest(peerId: string): RoomActionResponse {
    const player = this.findPlayerByPeer(peerId);
    if (!player) return { ok: true };
    this.removePlayerInternal(player.id);
    return { ok: true };
  }

  private removePlayerInternal(playerId: string): void {
    const idx = this.room.humanPlayers.findIndex((p) => p.id === playerId);
    if (idx === -1) return;

    this.room.humanPlayers.splice(idx, 1);

    if (this.room.phase === 'lobby') {
      this.clearCountdown();
      this.evaluateAutoStart();
      this.broadcast();
      return;
    }

    if (this.room.phase === 'match_over') {
      if (this.room.humanPlayers.length === 0) {
        this.resetToLobbyState();
      } else {
        this.evaluateAutoStart();
      }
      this.broadcast();
      return;
    }

    const arenaP = this.room.game?.playerById.get(playerId);
    if (arenaP) {
      arenaP.connected = false;
    }
    this.broadcast();
  }

  public handleFastInput(peerId: string, angle: number): void {
    if (this.room.phase !== 'playing' || !this.room.game) return;
    const player = this.findPlayerByPeer(peerId);
    if (!player) return;
    setPlayerTargetAngle(this.room.game, player.id, angle);
  }

  public handleAction(
    peerId: string,
    action: string,
    payload: Record<string, unknown> = {}
  ): RoomActionResponse {
    const player = this.findPlayerByPeer(peerId);
    if (!player) {
      return { ok: false, error: 'Spieler nicht im Room gefunden.' };
    }

    switch (action) {
      case 'room:leave':
        return this.leaveGuest(peerId);

      case 'room:toggle_ready': {
        if (this.room.phase !== 'lobby' && this.room.phase !== 'match_over') {
          return { ok: false, error: 'Während des Spiels nicht möglich.' };
        }
        player.isReady = !player.isReady;
        this.evaluateAutoStart();
        this.broadcast();
        return { ok: true };
      }

      case 'room:set_game_mode': {
        if (player.id !== this.room.hostId) {
          return { ok: false, error: 'Nur der Host kann den Spielmodus ändern.' };
        }
        if (this.room.phase !== 'lobby') {
          return { ok: false, error: 'Nur in der Lobby möglich.' };
        }
        const mode = payload.mode;
        if (mode !== 'time_3m' && mode !== 'time_5m' && mode !== 'survival') {
          return { ok: false, error: 'Ungültiger Spielmodus.' };
        }
        this.room.gameMode = mode;
        this.broadcast();
        return { ok: true };
      }

      case 'room:set_bot_count': {
        if (player.id !== this.room.hostId) {
          return { ok: false, error: 'Nur der Host kann Bots anpassen.' };
        }
        if (this.room.phase !== 'lobby') {
          return { ok: false, error: 'Nur in der Lobby möglich.' };
        }
        const rawCount = payload.count;
        if (typeof rawCount !== 'number' || !Number.isFinite(rawCount)) {
          return { ok: false, error: 'Ungültige Bot-Anzahl.' };
        }
        this.room.botCount = Math.max(0, Math.min(MAX_BOTS, Math.round(rawCount)));
        this.clearCountdown();
        this.evaluateAutoStart();
        this.broadcast();
        return { ok: true };
      }

      case 'room:add_bot': {
        if (player.id !== this.room.hostId) {
          return { ok: false, error: 'Nur der Host kann Bots hinzufügen.' };
        }
        if (this.room.phase !== 'lobby') {
          return { ok: false, error: 'Nur in der Lobby möglich.' };
        }
        if (this.room.botCount >= MAX_BOTS) {
          return { ok: false, error: `Maximal ${MAX_BOTS} Bots möglich.` };
        }
        this.room.botCount += 1;
        this.clearCountdown();
        this.evaluateAutoStart();
        this.broadcast();
        return { ok: true };
      }

      case 'room:remove_bot': {
        if (player.id !== this.room.hostId) {
          return { ok: false, error: 'Nur der Host kann Bots entfernen.' };
        }
        if (this.room.phase !== 'lobby') {
          return { ok: false, error: 'Nur in der Lobby möglich.' };
        }
        this.room.botCount = Math.max(0, this.room.botCount - 1);
        this.clearCountdown();
        this.evaluateAutoStart();
        this.broadcast();
        return { ok: true };
      }

      case 'room:remove_player': {
        if (player.id !== this.room.hostId) {
          return { ok: false, error: 'Nur der Host kann Spieler entfernen.' };
        }
        if (this.room.phase !== 'lobby') {
          return { ok: false, error: 'Spieler können nur in der Lobby entfernt werden.' };
        }
        const targetId =
          typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '';
        if (!targetId || targetId === this.room.hostId) {
          return { ok: false, error: 'Ungültiger Spieler.' };
        }
        const target = this.room.humanPlayers.find((p) => p.id === targetId);
        if (!target) {
          return { ok: false, error: 'Spieler nicht gefunden.' };
        }
        const targetPeerId = target.socketId;
        this.removePlayerInternal(targetId);
        if (targetPeerId) {
          this.onKicked(targetPeerId, 'Du wurdest vom Host aus dem Room entfernt.');
        }
        return { ok: true };
      }

      case 'room:next_round': {
        if (player.id !== this.room.hostId) {
          return { ok: false, error: 'Nur der Host kann zurück in die Lobby wechseln.' };
        }
        this.resetToLobbyState();
        this.broadcast();
        return { ok: true };
      }

      default:
        return { ok: false, error: 'Unbekannte Aktion.' };
    }
  }

  private evaluateAutoStart(): void {
    const totalEntities = this.room.humanPlayers.length + this.room.botCount;
    const canStart =
      this.room.humanPlayers.length >= 1 &&
      this.room.humanPlayers.length <= MAX_HUMAN_PLAYERS &&
      totalEntities >= 2 &&
      this.room.humanPlayers.every((p) => p.isReady) &&
      (this.room.phase === 'lobby' || this.room.phase === 'match_over');

    if (!canStart) {
      this.clearCountdown();
      return;
    }
    if (this.room.countdownTimer) return;

    this.room.countdownSeconds = 3;
    this.room.countdownTimer = setInterval(() => {
      if (this.room.countdownSeconds === null) {
        this.clearCountdown();
        return;
      }
      this.room.countdownSeconds -= 1;
      if (this.room.countdownSeconds <= 0) {
        this.clearCountdown();
        this.startNewMatch();
      } else {
        this.broadcast();
      }
    }, 1000);
  }

  public startNewMatch(): void {
    this.clearCountdown();
    this.stopGameLoop();

    this.room.phase = 'playing';
    this.room.matchSummary = null;
    const game = createPaperGame(
      this.room.humanPlayers,
      this.room.botCount,
      this.room.gameMode
    );
    this.room.game = game;

    for (const p of this.room.humanPlayers) {
      p.isReady = false;
    }

    this.broadcast();
    this.sendGridSyncToAll(game);
    this.startGameLoop();
  }

  private startGameLoop(): void {
    this.stopGameLoop();
    this.room.nextTickAt = performance.now() + TICK_INTERVAL_MS;

    const runTick = () => {
      if (this.room.phase !== 'playing' || !this.room.game) return;
      const game = this.room.game;
      const packet = stepGameTick(game);

      for (const p of this.room.humanPlayers) {
        if (p.socketId && p.connected) {
          this.onBroadcastTick(p.socketId, packet);
        }
      }

      if (game.ended) {
        this.finishMatch();
        return;
      }

      const now = performance.now();
      this.room.nextTickAt += TICK_INTERVAL_MS;
      if (this.room.nextTickAt < now - TICK_INTERVAL_MS * 3) {
        this.room.nextTickAt = now + TICK_INTERVAL_MS;
      }
      const delay = Math.max(4, this.room.nextTickAt - now);
      this.room.tickTimer = setTimeout(runTick, delay);
    };

    this.room.tickTimer = setTimeout(runTick, TICK_INTERVAL_MS);
  }

  private finishMatch(): void {
    this.stopGameLoop();
    const game = this.room.game;
    if (!game) return;
    this.room.phase = 'match_over';
    this.room.matchSummary = buildMatchSummary(game);
    for (const p of this.room.humanPlayers) {
      p.isReady = false;
    }
    this.broadcast();
  }

  private resetToLobbyState(): void {
    this.clearCountdown();
    this.stopGameLoop();
    this.room.phase = 'lobby';
    this.room.game = null;
    this.room.matchSummary = null;
    for (const p of this.room.humanPlayers) {
      p.isReady = false;
    }
  }
}
