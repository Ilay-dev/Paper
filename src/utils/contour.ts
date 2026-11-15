/**
 * Extracts smooth, organic Paper.io-2 style vector contours from a discrete
 * grid of territory owners using directed boundary-edge tracing, left-turn saddle
 * resolution, collinear segment merging, Chaikin corner-cutting, and quadratic Bezier curves.
 */

const DIR_RIGHT = 0;
const DIR_DOWN = 1;
const DIR_LEFT = 2;
const DIR_UP = 3;

const BIT_BY_DIR = [1, 2, 4, 8];
const DX_BY_DIR = [1, 0, -1, 0];
const DY_BY_DIR = [0, 1, 0, -1];

export interface ContourPoint {
  x: number;
  y: number;
}

function simplifyCollinearWithMaxSpan(pts: ContourPoint[], maxSpan = 2.5): ContourPoint[] {
  const n = pts.length;
  if (n <= 4) return pts;

  const out: ContourPoint[] = [];
  for (let i = 0; i < n; i++) {
    const prev = out.length > 0 ? out[out.length - 1] : pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    const collinear = dx1 * dy2 === dy1 * dx2;
    const span = Math.hypot(next.x - prev.x, next.y - prev.y);

    if (collinear && span <= maxSpan) {
      continue;
    }
    out.push(curr);
  }
  return out.length >= 3 ? out : pts;
}

function chaikinSmoothClosed(pts: ContourPoint[], passes: number): ContourPoint[] {
  let current = pts;
  for (let pass = 0; pass < passes; pass++) {
    const n = current.length;
    if (n < 3) return current;
    const nextPts: ContourPoint[] = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = current[i];
      const b = current[(i + 1) % n];
      nextPts[i * 2] = {
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25,
      };
      nextPts[i * 2 + 1] = {
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75,
      };
    }
    current = nextPts;
  }
  return current;
}

function tracePlayerLoops(
  vertexEdges: Map<number, number>,
  stride: number
): ContourPoint[][] {
  const loops: ContourPoint[][] = [];

  while (vertexEdges.size > 0) {
    const nextEntry = vertexEdges.entries().next();
    if (nextEntry.done) break;
    const [startVertex, initialMask] = nextEntry.value;

    let dir = 0;
    while (dir < 4 && (initialMask & BIT_BY_DIR[dir]) === 0) {
      dir += 1;
    }
    if (dir >= 4) {
      vertexEdges.delete(startVertex);
      continue;
    }

    const loop: ContourPoint[] = [];
    let v = startVertex;
    let currDir = dir;
    let guard = 0;
    const maxSteps = vertexEdges.size * 3 + 32;

    while (guard++ < maxSteps) {
      const currMask = vertexEdges.get(v) ?? 0;
      if ((currMask & BIT_BY_DIR[currDir]) === 0) break;

      const nextMask = currMask & ~BIT_BY_DIR[currDir];
      if (nextMask === 0) {
        vertexEdges.delete(v);
      } else {
        vertexEdges.set(v, nextMask);
      }

      const vx = v % stride;
      const vy = (v / stride) | 0;
      loop.push({ x: vx, y: vy });

      const nx = vx + DX_BY_DIR[currDir];
      const ny = vy + DY_BY_DIR[currDir];
      v = ny * stride + nx;

      const outMask = vertexEdges.get(v) ?? 0;
      if (outMask === 0) {
        break;
      }

      // Hug interior on left to resolve checkerboard saddles without self-intersection
      const leftDir = (currDir + 3) & 3;
      const straightDir = currDir;
      const rightDir = (currDir + 1) & 3;

      if (outMask & BIT_BY_DIR[leftDir]) {
        currDir = leftDir;
      } else if (outMask & BIT_BY_DIR[straightDir]) {
        currDir = straightDir;
      } else if (outMask & BIT_BY_DIR[rightDir]) {
        currDir = rightDir;
      } else {
        break;
      }
    }

    if (loop.length >= 3) {
      const simplified = simplifyCollinearWithMaxSpan(loop, 2.5);
      const smoothed = chaikinSmoothClosed(simplified, 3);
      loops.push(smoothed);
    }
  }

  return loops;
}

export function extractSmoothPlayerLoops(
  ownerGrid: Uint8Array,
  width: number,
  height: number
): Map<number, ContourPoint[][]> {
  const stride = width + 1;
  const edgesByPlayer = new Map<number, Map<number, number>>();

  const addEdge = (owner: number, vx: number, vy: number, dir: number) => {
    let map = edgesByPlayer.get(owner);
    if (!map) {
      map = new Map();
      edgesByPlayer.set(owner, map);
    }
    const vIdx = vy * stride + vx;
    map.set(vIdx, (map.get(vIdx) ?? 0) | BIT_BY_DIR[dir]);
  };

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const owner = ownerGrid[row + x];
      if (owner === 0) continue;

      if (y === 0 || ownerGrid[(y - 1) * width + x] !== owner) {
        addEdge(owner, x + 1, y, DIR_LEFT);
      }
      if (x === 0 || ownerGrid[row + (x - 1)] !== owner) {
        addEdge(owner, x, y, DIR_DOWN);
      }
      if (y === height - 1 || ownerGrid[(y + 1) * width + x] !== owner) {
        addEdge(owner, x, y + 1, DIR_RIGHT);
      }
      if (x === width - 1 || ownerGrid[row + (x + 1)] !== owner) {
        addEdge(owner, x + 1, y + 1, DIR_UP);
      }
    }
  }

  const result = new Map<number, ContourPoint[][]>();
  for (const [owner, vertexEdges] of edgesByPlayer.entries()) {
    const loops = tracePlayerLoops(vertexEdges, stride);
    if (loops.length > 0) {
      result.set(owner, loops);
    }
  }
  return result;
}

export function extractSmoothPlayerPaths(
  ownerGrid: Uint8Array,
  width: number,
  height: number,
  cellPx: number
): Map<number, Path2D> {
  const loopsByPlayer = extractSmoothPlayerLoops(ownerGrid, width, height);
  const paths = new Map<number, Path2D>();

  for (const [owner, loops] of loopsByPlayer.entries()) {
    const path = new Path2D();
    for (const pts of loops) {
      const n = pts.length;
      if (n < 3) continue;
      const firstMidX = ((pts[n - 1].x + pts[0].x) * 0.5) * cellPx;
      const firstMidY = ((pts[n - 1].y + pts[0].y) * 0.5) * cellPx;
      path.moveTo(firstMidX, firstMidY);
      for (let i = 0; i < n; i++) {
        const curr = pts[i];
        const next = pts[(i + 1) % n];
        const midX = ((curr.x + next.x) * 0.5) * cellPx;
        const midY = ((curr.y + next.y) * 0.5) * cellPx;
        path.quadraticCurveTo(curr.x * cellPx, curr.y * cellPx, midX, midY);
      }
      path.closePath();
    }
    paths.set(owner, path);
  }

  return paths;
}
