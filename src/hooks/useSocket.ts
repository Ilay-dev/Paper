import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import {
  ARENA_RADIUS,
  GRID_HEIGHT,
  GRID_WIDTH,
  TOTAL_CELLS,
  VALID_ARENA_CELLS,
  decodeRle,
  normalizeAngle,
  safeRandomUUID,
} from '../../shared/gameEngine.ts';
import type {
  ClientRoomState,
  FastTickPacket,
  GameMode,
  GridSyncPacket,
  KillFeedEvent,
  PublicPlayerMeta,
  RoomActionResponse,
  SessionCredentials,
} from '../../shared/types.ts';
import { BrowserHostManager, generateBrowserRoomCode } from '../p2p/hostManager.ts';

const SESSION_KEY = 'paper_p2p_session';

const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    iceCandidatePoolSize: 10,
  },
};

type PeerReqPayload =
  | { type: 'join'; playerName: string }
  | { type: 'rejoin'; credentials: SessionCredentials }
  | {
      type: 'action';
      action: string;
      payload?: Record<string, unknown>;
    };

type PeerMsgToHost =
  | { type: 'ping' }
  | { type: 'input'; angle: number }
  | (PeerReqPayload & { requestId: string });

type PeerMsgToGuest =
  | { type: 'res'; requestId: string; response: RoomActionResponse }
  | { type: 'state'; state: ClientRoomState }
  | { type: 'grid_sync'; sync: GridSyncPacket }
  | { type: 'tick'; tick: FastTickPacket }
  | { type: 'kicked'; reason: string };

interface StoredGuestSession {
  role: 'guest';
  credentials: SessionCredentials;
}

export interface LiveArenaPlayer {
  id: string;
  numId: number;
  name: string;
  isBot: boolean;
  colorIndex: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  angle: number;
  targetAngle: number;
  alive: boolean;
  respawnTicks: number;
  shieldTicks: number;
  areaCells: number;
  maxAreaCells: number;
  kills: number;
  deaths: number;
}

export interface DeathBurst {
  x: number;
  y: number;
  colorIndex: number;
  createdAt: number;
}

export interface LiveArenaState {
  width: number;
  height: number;
  arenaRadius: number;
  validCells: number;
  tick: number;
  lastPacketAt: number;
  elapsedMs: number;
  remainingMs: number;
  ownerGrid: Uint8Array;
  trailGrid: Uint8Array;
  gridVersion: number;
  players: Map<number, LiveArenaPlayer>;
  events: KillFeedEvent[];
  bursts: DeathBurst[];
}

export interface HudSnapshot {
  tick: number;
  elapsedMs: number;
  remainingMs: number;
  leaderboard: Array<{
    id: string;
    numId: number;
    name: string;
    isBot: boolean;
    colorIndex: number;
    areaPct: number;
    maxAreaPct: number;
    kills: number;
    alive: boolean;
  }>;
  myPlayer: {
    numId: number;
    alive: boolean;
    respawnSeconds: number;
    areaPct: number;
    maxAreaPct: number;
    kills: number;
    deaths: number;
    rank: number;
  } | null;
  events: KillFeedEvent[];
}

export interface SoundCueCallbacks {
  onCapture?: () => void;
  onKill?: () => void;
  onDeath?: () => void;
  onRespawn?: () => void;
}

function saveGuestSession(creds: SessionCredentials | null): void {
  try {
    if (creds) {
      const payload: StoredGuestSession = { role: 'guest', credentials: creds };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function loadGuestSession(): StoredGuestSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGuestSession;
    if (
      parsed?.role === 'guest' &&
      parsed.credentials?.roomCode &&
      parsed.credentials?.playerId &&
      parsed.credentials?.reconnectToken
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function createEmptyLiveArena(): LiveArenaState {
  return {
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    arenaRadius: ARENA_RADIUS,
    validCells: VALID_ARENA_CELLS,
    tick: 0,
    lastPacketAt: performance.now(),
    elapsedMs: 0,
    remainingMs: 0,
    ownerGrid: new Uint8Array(TOTAL_CELLS),
    trailGrid: new Uint8Array(TOTAL_CELLS),
    gridVersion: 0,
    players: new Map(),
    events: [],
    bursts: [],
  };
}

export function usePaperSocket(soundCues?: SoundCueCallbacks) {
  const peerRef = useRef<Peer | null>(null);
  const hostManagerRef = useRef<BrowserHostManager | null>(null);
  const guestConnectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const guestConnRef = useRef<DataConnection | null>(null);
  const pendingRequestsRef = useRef<
    Map<string, { resolve: (res: RoomActionResponse) => void; timer: ReturnType<typeof setTimeout> }>
  >(new Map());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptIdRef = useRef(0);

  const liveArenaRef = useRef<LiveArenaState>(createEmptyLiveArena());
  const roomStateRef = useRef<ClientRoomState | null>(null);
  const lastHudFlushRef = useRef<number>(0);
  const soundCuesRef = useRef<SoundCueCallbacks | undefined>(soundCues);
  soundCuesRef.current = soundCues;

  const [connected, setConnected] = useState(true);
  const [roomState, setRoomState] = useState<ClientRoomState | null>(null);
  const [hudSnapshot, setHudSnapshot] = useState<HudSnapshot | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const showError = useCallback((msg: string) => {
    setErrorBanner(msg);
  }, []);

  const clearError = useCallback(() => {
    setErrorBanner(null);
  }, []);

  const syncArenaMetaFromRoom = useCallback((state: ClientRoomState) => {
    roomStateRef.current = state;
    const arena = liveArenaRef.current;

    if (state.phase === 'lobby') {
      arena.ownerGrid.fill(0);
      arena.trailGrid.fill(0);
      arena.players.clear();
      arena.events = [];
      arena.bursts = [];
      arena.tick = 0;
      arena.gridVersion += 1;
      setHudSnapshot(null);
      return;
    }

    arena.arenaRadius = state.arenaRadius;
    arena.validCells = state.totalCells;

    if (arena.width !== state.gridWidth || arena.height !== state.gridHeight) {
      arena.width = state.gridWidth;
      arena.height = state.gridHeight;
      arena.ownerGrid = new Uint8Array(state.gridWidth * state.gridHeight);
      arena.trailGrid = new Uint8Array(state.gridWidth * state.gridHeight);
    }

    for (const meta of state.arenaPlayers as PublicPlayerMeta[]) {
      const existing = arena.players.get(meta.numId);
      if (existing) {
        existing.id = meta.id;
        existing.name = meta.name;
        existing.isBot = meta.isBot;
        existing.colorIndex = meta.colorIndex;
      } else {
        arena.players.set(meta.numId, {
          id: meta.id,
          numId: meta.numId,
          name: meta.name,
          isBot: meta.isBot,
          colorIndex: meta.colorIndex,
          x: state.gridWidth / 2,
          y: state.gridHeight / 2,
          prevX: state.gridWidth / 2,
          prevY: state.gridHeight / 2,
          angle: 0,
          targetAngle: 0,
          alive: meta.alive,
          respawnTicks: 0,
          shieldTicks: 0,
          areaCells: meta.areaCells,
          maxAreaCells: meta.maxAreaCells,
          kills: meta.kills,
          deaths: meta.deaths,
        });
      }
    }
  }, []);

  const flushHudSnapshot = useCallback((force = false) => {
    const now = performance.now();
    if (!force && now - lastHudFlushRef.current < 90) return;
    lastHudFlushRef.current = now;

    const state = roomStateRef.current;
    const arena = liveArenaRef.current;
    if (!state || state.phase === 'lobby') return;

    const total = Math.max(1, arena.validCells);
    const list = Array.from(arena.players.values())
      .map((p) => ({
        id: p.id,
        numId: p.numId,
        name: p.name,
        isBot: p.isBot,
        colorIndex: p.colorIndex,
        areaPct: Number(((p.areaCells / total) * 100).toFixed(2)),
        maxAreaPct: Number(((p.maxAreaCells / total) * 100).toFixed(2)),
        kills: p.kills,
        alive: p.alive,
      }))
      .sort((a, b) => {
        if (state.gameMode === 'survival' && a.alive !== b.alive) {
          return a.alive ? -1 : 1;
        }
        return b.areaPct - a.areaPct || b.kills - a.kills;
      });

    const myNumId = state.myNumId;
    let myPlayer: HudSnapshot['myPlayer'] = null;
    if (myNumId !== null) {
      const liveMe = arena.players.get(myNumId);
      const rankIdx = list.findIndex((entry) => entry.numId === myNumId);
      if (liveMe) {
        myPlayer = {
          numId: liveMe.numId,
          alive: liveMe.alive,
          respawnSeconds: Number((liveMe.respawnTicks / 30).toFixed(1)),
          areaPct: Number(((liveMe.areaCells / total) * 100).toFixed(2)),
          maxAreaPct: Number(((liveMe.maxAreaCells / total) * 100).toFixed(2)),
          kills: liveMe.kills,
          deaths: liveMe.deaths,
          rank: rankIdx >= 0 ? rankIdx + 1 : list.length,
        };
      }
    }

    setHudSnapshot({
      tick: arena.tick,
      elapsedMs: arena.elapsedMs,
      remainingMs: arena.remainingMs,
      leaderboard: list.slice(0, 8),
      myPlayer,
      events: arena.events.slice(0, 5),
    });
  }, []);

  const applyGridSync = useCallback(
    (sync: GridSyncPacket) => {
      const arena = liveArenaRef.current;
      arena.arenaRadius = sync.arenaRadius;
      if (arena.width !== sync.width || arena.height !== sync.height) {
        arena.width = sync.width;
        arena.height = sync.height;
        arena.ownerGrid = new Uint8Array(sync.width * sync.height);
        arena.trailGrid = new Uint8Array(sync.width * sync.height);
      }
      decodeRle(sync.ownerRle, arena.ownerGrid);
      decodeRle(sync.trailRle, arena.trailGrid);
      arena.tick = sync.tick;
      arena.lastPacketAt = performance.now();
      arena.gridVersion += 1;
      flushHudSnapshot(true);
    },
    [flushHudSnapshot]
  );

  const applyFastTick = useCallback(
    (pkt: FastTickPacket) => {
      const arena = liveArenaRef.current;
      const state = roomStateRef.current;
      const myNumId = state?.myNumId ?? null;
      const now = performance.now();

      arena.tick = pkt.tick;
      arena.lastPacketAt = now;
      arena.elapsedMs = pkt.elapsedMs;
      arena.remainingMs = pkt.remainingMs;

      if (pkt.fullOwnerRle && pkt.fullTrailRle) {
        decodeRle(pkt.fullOwnerRle, arena.ownerGrid);
        decodeRle(pkt.fullTrailRle, arena.trailGrid);
        arena.gridVersion += 1;
      } else if (pkt.cellDiffs.length > 0) {
        const diffs = pkt.cellDiffs;
        for (let i = 0; i < diffs.length; i += 3) {
          const idx = diffs[i];
          arena.ownerGrid[idx] = diffs[i + 1];
          arena.trailGrid[idx] = diffs[i + 2];
        }
        arena.gridVersion += 1;
      }

      for (const tuple of pkt.players) {
        const [
          numId,
          x,
          y,
          angle,
          targetAngle,
          aliveFlag,
          respawnTicks,
          areaCells,
          maxAreaCells,
          kills,
          deaths,
          shieldTicks,
        ] = tuple;

        const alive = aliveFlag === 1;
        const existing = arena.players.get(numId);
        if (existing) {
          const wasAlive = existing.alive;
          const prevArea = existing.areaCells;
          const prevKills = existing.kills;

          if (wasAlive && !alive) {
            arena.bursts.push({
              x: existing.x,
              y: existing.y,
              colorIndex: existing.colorIndex,
              createdAt: now,
            });
            if (numId === myNumId) {
              soundCuesRef.current?.onDeath?.();
            }
          } else if (!wasAlive && alive && numId === myNumId) {
            soundCuesRef.current?.onRespawn?.();
          }

          if (numId === myNumId && alive) {
            if (kills > prevKills) {
              soundCuesRef.current?.onKill?.();
            } else if (areaCells > prevArea + 2) {
              soundCuesRef.current?.onCapture?.();
            }
          }

          existing.prevX = existing.x;
          existing.prevY = existing.y;
          existing.x = x;
          existing.y = y;
          existing.angle = angle;
          existing.targetAngle = targetAngle;
          existing.alive = alive;
          existing.respawnTicks = respawnTicks;
          existing.areaCells = areaCells;
          existing.maxAreaCells = maxAreaCells;
          existing.kills = kills;
          existing.deaths = deaths;
          existing.shieldTicks = shieldTicks;
        } else {
          arena.players.set(numId, {
            id: `p-${numId}`,
            numId,
            name: `Spieler ${numId}`,
            isBot: numId > 8,
            colorIndex: Math.max(0, numId - 1),
            x,
            y,
            prevX: x,
            prevY: y,
            angle,
            targetAngle,
            alive,
            respawnTicks,
            shieldTicks,
            areaCells,
            maxAreaCells,
            kills,
            deaths,
          });
        }
      }

      if (pkt.events.length > 0) {
        arena.events = [...pkt.events, ...arena.events].slice(0, 10);
      }

      if (arena.bursts.length > 0) {
        arena.bursts = arena.bursts.filter((b) => now - b.createdAt < 750);
      }

      flushHudSnapshot(pkt.events.length > 0);
    },
    [flushHudSnapshot]
  );

  const cleanupPeerResources = useCallback(() => {
    attemptIdRef.current += 1;
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    for (const pending of pendingRequestsRef.current.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: 'Verbindung geschlossen.' });
    }
    pendingRequestsRef.current.clear();

    if (hostManagerRef.current) {
      hostManagerRef.current.destroy();
      hostManagerRef.current = null;
    }
    for (const conn of guestConnectionsRef.current.values()) {
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
    guestConnectionsRef.current.clear();

    if (guestConnRef.current) {
      try {
        guestConnRef.current.close();
      } catch {
        // ignore
      }
      guestConnRef.current = null;
    }
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch {
        // ignore
      }
      peerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupPeerResources();
    };
  }, [cleanupPeerResources]);

  const sendRequestToHost = useCallback(
    (msg: PeerReqPayload): Promise<RoomActionResponse> => {
      return new Promise((resolve) => {
        const conn = guestConnRef.current;
        if (!conn || !conn.open) {
          resolve({ ok: false, error: 'Keine Verbindung zum Host.' });
          return;
        }
        const requestId = safeRandomUUID();
        const timer = setTimeout(() => {
          pendingRequestsRef.current.delete(requestId);
          resolve({ ok: false, error: 'Zeitüberschreitung beim Host.' });
        }, 10_000);

        pendingRequestsRef.current.set(requestId, { resolve, timer });
        conn.send({ ...msg, requestId });
      });
    },
    []
  );

  const connectAsGuest = useCallback(
    (
      roomCode: string,
      onOpened: (conn: DataConnection) => Promise<RoomActionResponse>
    ): Promise<RoomActionResponse> => {
      cleanupPeerResources();
      saveGuestSession(null);

      const attemptId = ++attemptIdRef.current;
      const cleanCode = roomCode.trim().toUpperCase();
      const targetHostPeerId = `paper-room-${cleanCode}`;

      return new Promise((resolve) => {
        let peer: Peer;
        try {
          peer = new Peer(PEER_OPTIONS);
        } catch {
          const msg = 'WebRTC P2P konnte nicht initialisiert werden.';
          setErrorBanner(msg);
          resolve({ ok: false, error: msg });
          return;
        }

        peerRef.current = peer;
        let settled = false;

        const fail = (message: string) => {
          if (settled || attemptId !== attemptIdRef.current) return;
          settled = true;
          setConnected(true);
          setErrorBanner(message);
          cleanupPeerResources();
          resolve({ ok: false, error: message });
        };

        connectTimeoutRef.current = setTimeout(() => {
          fail('Host nicht erreichbar oder Room existiert nicht.');
        }, 14_000);

        peer.on('open', () => {
          if (attemptId !== attemptIdRef.current) return;
          const conn = peer.connect(targetHostPeerId, { reliable: true });
          guestConnRef.current = conn;

          conn.on('data', (raw) => {
            if (attemptId !== attemptIdRef.current) return;
            const data = raw as PeerMsgToGuest;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'res') {
              const pending = pendingRequestsRef.current.get(data.requestId);
              if (pending) {
                clearTimeout(pending.timer);
                pendingRequestsRef.current.delete(data.requestId);
                pending.resolve(data.response);
              }
            } else if (data.type === 'state') {
              syncArenaMetaFromRoom(data.state);
              setRoomState(data.state);
            } else if (data.type === 'grid_sync') {
              applyGridSync(data.sync);
            } else if (data.type === 'tick') {
              applyFastTick(data.tick);
            } else if (data.type === 'kicked') {
              saveGuestSession(null);
              cleanupPeerResources();
              roomStateRef.current = null;
              setRoomState(null);
              setHudSnapshot(null);
              setErrorBanner(data.reason);
            }
          });

          conn.on('open', async () => {
            if (attemptId !== attemptIdRef.current) return;
            setConnected(true);
            heartbeatRef.current = setInterval(() => {
              if (conn.open) {
                conn.send({ type: 'ping' } satisfies PeerMsgToHost);
              }
            }, 15_000);

            const res = await onOpened(conn);
            if (attemptId !== attemptIdRef.current) return;
            if (connectTimeoutRef.current) {
              clearTimeout(connectTimeoutRef.current);
              connectTimeoutRef.current = null;
            }
            if (!settled) {
              settled = true;
              if (!res.ok) {
                if (res.error) setErrorBanner(res.error);
                cleanupPeerResources();
              } else if (res.credentials) {
                saveGuestSession(res.credentials);
                setErrorBanner(null);
              }
              resolve(res);
            }
          });

          conn.on('close', () => {
            if (attemptId !== attemptIdRef.current) return;
            if (connectTimeoutRef.current) {
              clearTimeout(connectTimeoutRef.current);
              connectTimeoutRef.current = null;
            }
            if (!settled) {
              fail('Verbindung zum Host fehlgeschlagen.');
            } else {
              setConnected(false);
              setErrorBanner('Der Host hat die Verbindung beendet.');
              saveGuestSession(null);
              cleanupPeerResources();
              roomStateRef.current = null;
              setRoomState(null);
              setHudSnapshot(null);
            }
          });

          conn.on('error', () => {
            if (attemptId !== attemptIdRef.current) return;
            if (connectTimeoutRef.current) {
              clearTimeout(connectTimeoutRef.current);
              connectTimeoutRef.current = null;
            }
            fail('WebRTC-Verbindungsfehler zum Host.');
          });
        });

        peer.on('error', (err) => {
          if (attemptId !== attemptIdRef.current) return;
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          const msg =
            err.type === 'peer-unavailable'
              ? 'Room nicht gefunden. Prüfe den Room-Code oder ob der Host noch online ist.'
              : 'Verbindung zum Signaling-Dienst fehlgeschlagen.';
          fail(msg);
        });
      });
    },
    [applyFastTick, applyGridSync, cleanupPeerResources, syncArenaMetaFromRoom]
  );

  // Auto-rejoin guest session on reload
  useEffect(() => {
    const saved = loadGuestSession();
    if (!saved) return;
    void connectAsGuest(saved.credentials.roomCode, () =>
      sendRequestToHost({ type: 'rejoin', credentials: saved.credentials })
    );
  }, [connectAsGuest, sendRequestToHost]);

  const createRoom = useCallback(
    (playerName: string): Promise<RoomActionResponse> => {
      cleanupPeerResources();
      saveGuestSession(null);

      const attemptId = ++attemptIdRef.current;

      return new Promise((resolve) => {
        let attempts = 0;

        const tryCreate = () => {
          if (attemptId !== attemptIdRef.current) return;
          attempts += 1;
          const roomCode = generateBrowserRoomCode();
          const hostPeerId = `paper-room-${roomCode}`;

          let peer: Peer;
          try {
            peer = new Peer(hostPeerId, PEER_OPTIONS);
          } catch {
            const msg = 'WebRTC P2P konnte im Browser nicht gestartet werden.';
            setErrorBanner(msg);
            resolve({ ok: false, error: msg });
            return;
          }

          peerRef.current = peer;
          let opened = false;

          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
          }
          connectTimeoutRef.current = setTimeout(() => {
            if (!opened && attemptId === attemptIdRef.current) {
              cleanupPeerResources();
              const msg = 'Konnte P2P-Host nicht starten. Bitte erneut versuchen.';
              setErrorBanner(msg);
              resolve({ ok: false, error: msg });
            }
          }, 15_000);

          peer.on('open', () => {
            if (attemptId !== attemptIdRef.current) return;
            opened = true;
            if (connectTimeoutRef.current) {
              clearTimeout(connectTimeoutRef.current);
              connectTimeoutRef.current = null;
            }
            setConnected(true);
            setErrorBanner(null);

            const manager = new BrowserHostManager(
              roomCode,
              playerName,
              (targetPeerId, state) => {
                if (attemptId !== attemptIdRef.current) return;
                if (targetPeerId === 'HOST_LOCAL') {
                  syncArenaMetaFromRoom(state);
                  setRoomState(state);
                  return;
                }
                const conn = guestConnectionsRef.current.get(targetPeerId);
                if (conn?.open) {
                  conn.send({ type: 'state', state } satisfies PeerMsgToGuest);
                }
              },
              (targetPeerId, sync) => {
                if (attemptId !== attemptIdRef.current) return;
                if (targetPeerId === 'HOST_LOCAL') {
                  applyGridSync(sync);
                  return;
                }
                const conn = guestConnectionsRef.current.get(targetPeerId);
                if (conn?.open) {
                  conn.send({ type: 'grid_sync', sync } satisfies PeerMsgToGuest);
                }
              },
              (targetPeerId, tick) => {
                if (attemptId !== attemptIdRef.current) return;
                if (targetPeerId === 'HOST_LOCAL') {
                  applyFastTick(tick);
                  return;
                }
                const conn = guestConnectionsRef.current.get(targetPeerId);
                if (conn?.open) {
                  conn.send({ type: 'tick', tick } satisfies PeerMsgToGuest);
                }
              },
              (targetPeerId, reason) => {
                const conn = guestConnectionsRef.current.get(targetPeerId);
                if (conn?.open) {
                  conn.send({ type: 'kicked', reason } satisfies PeerMsgToGuest);
                  setTimeout(() => conn.close(), 100);
                }
                guestConnectionsRef.current.delete(targetPeerId);
              }
            );
            hostManagerRef.current = manager;
            manager.broadcast();

            resolve({
              ok: true,
              credentials: {
                roomCode,
                playerId: manager.getHostPlayerId(),
                reconnectToken: 'host',
              },
            });
          });

          peer.on('connection', (conn) => {
            if (attemptId !== attemptIdRef.current) return;
            guestConnectionsRef.current.set(conn.peer, conn);

            conn.on('data', (raw) => {
              const msg = raw as PeerMsgToHost;
              const manager = hostManagerRef.current;
              if (!manager || !msg || typeof msg !== 'object') return;
              if (msg.type === 'ping') return;

              if (msg.type === 'input') {
                manager.handleFastInput(conn.peer, msg.angle);
                return;
              }

              let response: RoomActionResponse = { ok: false, error: 'Ungültige Anfrage.' };
              if (msg.type === 'join') {
                response = manager.joinGuest(conn.peer, msg.playerName);
              } else if (msg.type === 'rejoin') {
                response = manager.rejoinGuest(conn.peer, msg.credentials);
              } else if (msg.type === 'action') {
                response = manager.handleAction(conn.peer, msg.action, msg.payload);
              }

              if (conn.open && 'requestId' in msg) {
                conn.send({
                  type: 'res',
                  requestId: msg.requestId,
                  response,
                } satisfies PeerMsgToGuest);
              }
            });

            conn.on('close', () => {
              guestConnectionsRef.current.delete(conn.peer);
              hostManagerRef.current?.handlePeerDisconnect(conn.peer);
            });

            conn.on('error', () => {
              guestConnectionsRef.current.delete(conn.peer);
              hostManagerRef.current?.handlePeerDisconnect(conn.peer);
            });
          });

          peer.on('disconnected', () => {
            if (attemptId !== attemptIdRef.current) return;
            try {
              if (!peer.destroyed) peer.reconnect();
            } catch {
              // ignore
            }
          });

          peer.on('error', (err) => {
            if (attemptId !== attemptIdRef.current) return;
            if (connectTimeoutRef.current) {
              clearTimeout(connectTimeoutRef.current);
              connectTimeoutRef.current = null;
            }
            if (!opened && err.type === 'unavailable-id' && attempts < 3) {
              peer.destroy();
              tryCreate();
              return;
            }
            if (!opened) {
              cleanupPeerResources();
              const msg = 'Verbindung zum P2P-Signaling fehlgeschlagen.';
              setErrorBanner(msg);
              resolve({ ok: false, error: msg });
            }
          });
        };

        tryCreate();
      });
    },
    [applyFastTick, applyGridSync, cleanupPeerResources, syncArenaMetaFromRoom]
  );

  const joinRoom = useCallback(
    (roomCode: string, playerName: string): Promise<RoomActionResponse> => {
      return connectAsGuest(roomCode, () =>
        sendRequestToHost({ type: 'join', playerName })
      );
    },
    [connectAsGuest, sendRequestToHost]
  );

  const leaveRoom = useCallback(async (): Promise<void> => {
    saveGuestSession(null);
    if (guestConnRef.current?.open) {
      await sendRequestToHost({ type: 'action', action: 'room:leave' });
    }
    cleanupPeerResources();
    roomStateRef.current = null;
    setRoomState(null);
    setHudSnapshot(null);
    setErrorBanner(null);
    setConnected(true);
  }, [cleanupPeerResources, sendRequestToHost]);

  const dispatchAction = useCallback(
    async (
      action: string,
      payload?: Record<string, unknown>,
      options?: { silentError?: boolean }
    ): Promise<RoomActionResponse> => {
      if (hostManagerRef.current) {
        const res = hostManagerRef.current.handleAction('HOST_LOCAL', action, payload);
        if (!res.ok && res.error && !options?.silentError) {
          setErrorBanner(res.error);
        }
        return res;
      }

      if (guestConnRef.current?.open) {
        const res = await sendRequestToHost({ type: 'action', action, payload });
        if (!res.ok && res.error && !options?.silentError) {
          setErrorBanner(res.error);
        }
        return res;
      }

      const msg = 'Keine aktive Verbindung zum Host.';
      if (!options?.silentError) setErrorBanner(msg);
      return { ok: false, error: msg };
    },
    [sendRequestToHost]
  );

  /** Fire-and-forget ultra-responsive mouse angle input (zero ACK wait) */
  const sendAngleInput = useCallback((rawAngle: number) => {
    const angle = Number(normalizeAngle(rawAngle).toFixed(3));
    const myNumId = roomStateRef.current?.myNumId;
    if (myNumId !== null && myNumId !== undefined) {
      const localMe = liveArenaRef.current.players.get(myNumId);
      if (localMe) {
        localMe.targetAngle = angle;
      }
    }

    if (hostManagerRef.current) {
      hostManagerRef.current.handleFastInput('HOST_LOCAL', angle);
      return;
    }
    const conn = guestConnRef.current;
    if (conn?.open) {
      conn.send({ type: 'input', angle } satisfies PeerMsgToHost);
    }
  }, []);

  const toggleReady = useCallback(() => {
    void dispatchAction('room:toggle_ready');
  }, [dispatchAction]);

  const setGameMode = useCallback(
    (mode: GameMode) => {
      void dispatchAction('room:set_game_mode', { mode });
    },
    [dispatchAction]
  );

  const setBotCount = useCallback(
    (count: number) => {
      void dispatchAction('room:set_bot_count', { count });
    },
    [dispatchAction]
  );

  const addBot = useCallback(() => {
    void dispatchAction('room:add_bot');
  }, [dispatchAction]);

  const removeBot = useCallback(() => {
    void dispatchAction('room:remove_bot');
  }, [dispatchAction]);

  const removePlayer = useCallback(
    (targetPlayerId: string) => {
      void dispatchAction('room:remove_player', { targetPlayerId });
    },
    [dispatchAction]
  );

  const returnToLobby = useCallback(() => {
    void dispatchAction('room:next_round');
  }, [dispatchAction]);

  return {
    connected,
    roomState,
    hudSnapshot,
    liveArenaRef,
    errorBanner,
    showError,
    clearError,
    createRoom,
    joinRoom,
    leaveRoom,
    toggleReady,
    setGameMode,
    setBotCount,
    addBot,
    removeBot,
    removePlayer,
    returnToLobby,
    sendAngleInput,
  };
}
