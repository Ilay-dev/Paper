import { describe, expect, it } from 'vitest';
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_MASK,
  ARENA_RADIUS,
  GRID_HEIGHT,
  GRID_WIDTH,
  type InternalLobbyHuman,
  type InternalPaperGame,
  MAX_BOTS,
  MAX_HUMAN_PLAYERS,
  MAX_TURN_STEP_PER_TICK,
  createPaperGame,
  decodeRle,
  encodeRle,
  isPointInArena,
  recountAllAreas,
  setPlayerTargetAngle,
  shortestAngleDiff,
  stepGameTick,
} from '../shared/gameEngine.ts';

function makeHuman(idx: number): InternalLobbyHuman {
  return {
    id: `human-${idx}`,
    name: `Spieler ${idx}`,
    isHost: idx === 1,
    isReady: true,
    connected: true,
    reconnectToken: `tok-${idx}`,
    socketId: idx === 1 ? 'HOST_LOCAL' : `peer-${idx}`,
    colorIndex: idx - 1,
  };
}

function resetPlayerDisk(
  game: InternalPaperGame,
  numId: number,
  cx: number,
  cy: number,
  angle: number
): void {
  const player = game.playerByNumId.get(numId)!;
  for (let i = 0; i < game.totalCells; i++) {
    if (game.ownerGrid[i] === numId) game.ownerGrid[i] = 0;
    if (game.trailGrid[i] === numId) game.trailGrid[i] = 0;
  }
  player.trailCells.length = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy <= 5.8) {
        const idx = (cy + dy) * game.width + (cx + dx);
        if (ARENA_MASK[idx] === 1) {
          game.ownerGrid[idx] = numId;
        }
      }
    }
  }
  player.cellX = cx;
  player.cellY = cy;
  player.x = cx + 0.5;
  player.y = cy + 0.5;
  player.angle = angle;
  player.targetAngle = angle;
  player.alive = true;
  player.shieldTicks = 0;
  recountAllAreas(game);
}

describe('Paper.io Circular 360° Game Engine', () => {
  it('uses a circular arena mask and spawns 8 humans + 30 bots (38 entities)', () => {
    expect(isPointInArena(ARENA_CENTER_X, ARENA_CENTER_Y)).toBe(true);
    expect(isPointInArena(2, 2)).toBe(false);
    expect(ARENA_MASK[0]).toBe(0);
    expect(ARENA_MASK[ARENA_CENTER_Y * GRID_WIDTH + ARENA_CENTER_X]).toBe(1);

    const humans = Array.from({ length: MAX_HUMAN_PLAYERS }, (_, i) => makeHuman(i + 1));
    const game = createPaperGame(humans, MAX_BOTS, 'time_3m');

    expect(game.players).toHaveLength(38);
    expect(game.width).toBe(GRID_WIDTH);
    expect(game.height).toBe(GRID_HEIGHT);
    expect(game.arenaRadius).toBe(ARENA_RADIUS);

    for (const p of game.players) {
      expect(p.alive).toBe(true);
      expect(isPointInArena(p.x, p.y)).toBe(true);
      expect(p.areaCells).toBeGreaterThanOrEqual(9);
      expect(game.ownerGrid[p.cellY * game.width + p.cellX]).toBe(p.numId);
    }
  });

  it('steers smoothly toward mouse targetAngle with turn rate limit', () => {
    const game = createPaperGame([makeHuman(1)], 1, 'time_3m');
    const p1 = game.players[0];
    resetPlayerDisk(game, p1.numId, 80, 80, 0);

    // Target 90° downward (Math.PI / 2)
    expect(setPlayerTargetAngle(game, p1.id, Math.PI / 2)).toBe(true);
    stepGameTick(game);

    // Angle should advance by exactly MAX_TURN_STEP_PER_TICK toward Math.PI / 2
    expect(p1.angle).toBeCloseTo(MAX_TURN_STEP_PER_TICK, 5);
    expect(Math.abs(shortestAngleDiff(p1.angle, Math.PI / 2))).toBeLessThan(Math.PI / 2);

    // After enough ticks it aligns exactly with Math.PI / 2
    for (let i = 0; i < 15; i++) {
      stepGameTick(game);
    }
    expect(p1.angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('eliminates a player hitting the circular arena wall', () => {
    const game = createPaperGame([makeHuman(1), makeHuman(2)], 0, 'survival');
    const p1 = game.players[0];
    const p2 = game.players[1];

    // Place p1 right near the right circular boundary heading outward (angle = 0)
    resetPlayerDisk(game, p1.numId, ARENA_CENTER_X + ARENA_RADIUS - 3, ARENA_CENTER_Y, 0);
    resetPlayerDisk(game, p2.numId, 50, 80, 0);

    let wallDeath = false;
    for (let t = 0; t < 20; t++) {
      const pkt = stepGameTick(game);
      if (pkt.events.some((e) => e.reason === 'wall' && e.victimNumId === p1.numId)) {
        wallDeath = true;
        break;
      }
    }

    expect(wallDeath).toBe(true);
    expect(p1.alive).toBe(false);
    expect(game.ended).toBe(true);
    expect(game.winReason).toBe('last_standing');
    expect(game.winnerNumId).toBe(p2.numId);
  });

  it('maintains watertight curved trail and flood-fills enclosed interior on return', () => {
    const game = createPaperGame([makeHuman(1)], 1, 'time_3m');
    const p1 = game.players[0];
    const bot = game.players[1];
    resetPlayerDisk(game, p1.numId, 80, 80, 0);
    resetPlayerDisk(game, bot.numId, 40, 40, 0);

    const initialArea = p1.areaCells; // 21 cells

    // Move out right 4.5 cells (~14 ticks)
    for (let i = 0; i < 14; i++) stepGameTick(game);
    expect(p1.trailCells.length).toBeGreaterThan(1);

    // Steer down (angle = PI/2) for 18 ticks, then left (angle = PI) for 18 ticks, then up (-PI/2) back home
    setPlayerTargetAngle(game, p1.id, Math.PI / 2);
    for (let i = 0; i < 18; i++) stepGameTick(game);

    setPlayerTargetAngle(game, p1.id, Math.PI);
    for (let i = 0; i < 18; i++) stepGameTick(game);

    setPlayerTargetAngle(game, p1.id, -Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      stepGameTick(game);
      if (p1.trailCells.length === 0 && p1.areaCells > initialArea) break;
    }

    expect(p1.alive).toBe(true);
    expect(p1.trailCells.length).toBe(0);
    expect(p1.areaCells).toBeGreaterThan(initialArea + 12);
  });

  it('eliminates an opponent when cutting their trail and triggers survival victory', () => {
    const humans = [makeHuman(1), makeHuman(2)];
    const game = createPaperGame(humans, 0, 'survival');
    const p1 = game.players[0];
    const p2 = game.players[1];

    resetPlayerDisk(game, p1.numId, 80, 80, 0); // moving right along y = 80.5
    resetPlayerDisk(game, p2.numId, 85, 72, Math.PI / 2); // moving down along x = 85.5

    let sawCutEvent = false;
    for (let step = 0; step < 36; step++) {
      const pkt = stepGameTick(game);
      if (pkt.events.some((e) => e.reason === 'cut')) {
        sawCutEvent = true;
      }
      if (game.ended) break;
    }

    expect(sawCutEvent).toBe(true);
    expect(p1.alive).toBe(false);
    expect(p2.alive).toBe(true);
    expect(p2.kills).toBe(1);
    expect(game.ended).toBe(true);
    expect(game.winReason).toBe('last_standing');
    expect(game.winnerNumId).toBe(p2.numId);
  });

  it('round-trips grid arrays accurately through RLE and simulates 300 ticks with 38 entities', () => {
    const humans = Array.from({ length: MAX_HUMAN_PLAYERS }, (_, i) => makeHuman(i + 1));
    const game = createPaperGame(humans, MAX_BOTS, 'time_3m');

    for (let i = 0; i < 300; i++) {
      const pkt = stepGameTick(game);
      expect(pkt.players).toHaveLength(38);
    }

    const ownerRle = encodeRle(game.ownerGrid);
    const decodedOwner = new Uint8Array(game.totalCells);
    decodeRle(ownerRle, decodedOwner);
    expect(decodedOwner).toEqual(game.ownerGrid);

    const actualCounts = new Map<number, number>();
    for (let i = 0; i < game.totalCells; i++) {
      const owner = game.ownerGrid[i];
      if (owner > 0) {
        expect(ARENA_MASK[i]).toBe(1);
        actualCounts.set(owner, (actualCounts.get(owner) ?? 0) + 1);
      }
    }
    for (const p of game.players) {
      expect(p.areaCells).toBe(actualCounts.get(p.numId) ?? 0);
    }
  });
});
