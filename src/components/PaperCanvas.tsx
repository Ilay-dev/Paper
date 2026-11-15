import { useEffect, useRef } from 'react';
import { getPlayerColor } from '../../shared/colors.ts';
import {
  MAX_TURN_RATE_RAD_PER_SEC,
  MOVE_SPEED_CELLS_PER_SEC,
  clampPointToArena,
  shortestAngleDiff,
  stepAngleToward,
} from '../../shared/gameEngine.ts';
import type { LiveArenaState } from '../hooks/useSocket.ts';
import { extractSmoothPlayerPaths } from '../utils/contour.ts';

interface PaperCanvasProps {
  liveArenaRef: React.MutableRefObject<LiveArenaState>;
  myNumId: number | null;
  spectateTargetNumId: number | null;
  onAngleInput: (angle: number) => void;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function PaperCanvas({
  liveArenaRef,
  myNumId,
  spectateTargetNumId,
  onAngleInput,
}: PaperCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothPosRef = useRef<Map<number, { rx: number; ry: number; rAngle: number }>>(
    new Map()
  );
  const cameraRef = useRef<{ x: number; y: number; initialized: boolean }>({
    x: 80,
    y: 80,
    initialized: false,
  });
  const pointerRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  const lastInputSentRef = useRef<{ angle: number; at: number }>({
    angle: NaN,
    at: 0,
  });

  const myNumIdRef = useRef<number | null>(myNumId);
  const spectateRef = useRef<number | null>(spectateTargetNumId);
  const onAngleInputRef = useRef(onAngleInput);
  myNumIdRef.current = myNumId;
  spectateRef.current = spectateTargetNumId;
  onAngleInputRef.current = onAngleInput;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const minimapCanvas = document.createElement('canvas');
    minimapCanvas.width = 160;
    minimapCanvas.height = 160;
    const minimapCtx = minimapCanvas.getContext('2d');
    let minimapImageData = minimapCtx ? minimapCtx.createImageData(160, 160) : null;
    let lastMinimapGridVersion = -1;

    // Cached smooth vector Path2D contours per player
    let cachedPaths = new Map<number, Path2D>();
    let lastContourGridVersion = -1;
    let lastContourCellPx = -1;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(300, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let rafId = 0;
    let lastFrameAt = performance.now();

    const renderFrame = (now: number) => {
      const frameDt = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
      lastFrameAt = now;

      const arena = liveArenaRef.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewW = canvas.width / dpr;
      const viewH = canvas.height / dpr;
      const cellPx = Math.max(15, Math.min(23, Math.floor(Math.min(viewW, viewH) / 28)));

      const dtSincePacket = Math.min(0.055, Math.max(0, (now - arena.lastPacketAt) / 1000));
      const posBlend = 1 - Math.exp(-32 * frameDt);

      let leaderNumId: number | null = null;
      let maxArea = -1;
      const colorRgbCache = new Map<
        number,
        {
          hexRgb: [number, number, number];
          terrRgb: [number, number, number];
        }
      >();

      for (const p of arena.players.values()) {
        if (p.areaCells > maxArea) {
          maxArea = p.areaCells;
          leaderNumId = p.numId;
        }

        if (!colorRgbCache.has(p.numId)) {
          const meta = getPlayerColor(p.colorIndex);
          colorRgbCache.set(p.numId, {
            hexRgb: hexToRgbTuple(meta.hex),
            terrRgb: hexToRgbTuple(meta.territoryHex),
          });
        }

        if (!p.alive) {
          smoothPosRef.current.delete(p.numId);
          continue;
        }

        const predictedAngle = stepAngleToward(
          p.angle,
          p.targetAngle,
          MAX_TURN_RATE_RAD_PER_SEC * dtSincePacket
        );
        const rawTargetX = p.x + Math.cos(predictedAngle) * MOVE_SPEED_CELLS_PER_SEC * dtSincePacket;
        const rawTargetY = p.y + Math.sin(predictedAngle) * MOVE_SPEED_CELLS_PER_SEC * dtSincePacket;
        const { x: targetX, y: targetY } = clampPointToArena(rawTargetX, rawTargetY);

        const prevSmooth = smoothPosRef.current.get(p.numId);
        if (!prevSmooth || Math.hypot(targetX - prevSmooth.rx, targetY - prevSmooth.ry) > 2.5) {
          smoothPosRef.current.set(p.numId, {
            rx: targetX,
            ry: targetY,
            rAngle: predictedAngle,
          });
        } else {
          prevSmooth.rx += (targetX - prevSmooth.rx) * posBlend;
          prevSmooth.ry += (targetY - prevSmooth.ry) * posBlend;
          prevSmooth.rAngle = stepAngleToward(
            prevSmooth.rAngle,
            predictedAngle,
            Math.max(0.25, MAX_TURN_RATE_RAD_PER_SEC * frameDt * 1.8)
          );
        }
      }

      // Rebuild smooth organic vector contours only when grid or cellPx changes
      if (arena.gridVersion !== lastContourGridVersion || cellPx !== lastContourCellPx) {
        lastContourGridVersion = arena.gridVersion;
        lastContourCellPx = cellPx;
        cachedPaths = extractSmoothPlayerPaths(
          arena.ownerGrid,
          arena.width,
          arena.height,
          cellPx
        );
      }

      // Camera target
      const localPlayer =
        myNumIdRef.current !== null ? arena.players.get(myNumIdRef.current) : undefined;
      let trackNumId: number | null = null;
      if (localPlayer?.alive) {
        trackNumId = localPlayer.numId;
      } else if (spectateRef.current !== null && arena.players.get(spectateRef.current)?.alive) {
        trackNumId = spectateRef.current;
      } else if (leaderNumId !== null && arena.players.get(leaderNumId)?.alive) {
        trackNumId = leaderNumId;
      } else {
        for (const p of arena.players.values()) {
          if (p.alive) {
            trackNumId = p.numId;
            break;
          }
        }
      }

      const trackedPos = trackNumId !== null ? smoothPosRef.current.get(trackNumId) : undefined;
      if (trackedPos) {
        if (!cameraRef.current.initialized) {
          cameraRef.current.x = trackedPos.rx;
          cameraRef.current.y = trackedPos.ry;
          cameraRef.current.initialized = true;
        } else {
          const camBlend = 1 - Math.exp(-13 * frameDt);
          cameraRef.current.x += (trackedPos.rx - cameraRef.current.x) * camBlend;
          cameraRef.current.y += (trackedPos.ry - cameraRef.current.y) * camBlend;
        }
      } else if (!cameraRef.current.initialized) {
        cameraRef.current.x = arena.width / 2;
        cameraRef.current.y = arena.height / 2;
      }

      const camPixelX = cameraRef.current.x * cellPx - viewW / 2;
      const camPixelY = cameraRef.current.y * cellPx - viewH / 2;

      // Continuous mouse-following angle update for local player
      if (localPlayer?.alive && pointerRef.current.active) {
        const mySmooth = smoothPosRef.current.get(localPlayer.numId);
        const myScreenX = (mySmooth?.rx ?? localPlayer.x) * cellPx - camPixelX;
        const myScreenY = (mySmooth?.ry ?? localPlayer.y) * cellPx - camPixelY;
        const dxMouse = pointerRef.current.x - myScreenX;
        const dyMouse = pointerRef.current.y - myScreenY;
        if (dxMouse * dxMouse + dyMouse * dyMouse >= 36) {
          const desiredAngle = Math.atan2(dyMouse, dxMouse);
          const last = lastInputSentRef.current;
          if (
            Number.isNaN(last.angle) ||
            Math.abs(shortestAngleDiff(last.angle, desiredAngle)) > 0.025 ||
            now - last.at >= 45
          ) {
            last.angle = desiredAngle;
            last.at = now;
            onAngleInputRef.current(desiredAngle);
          }
        }
      }

      // Clear full void outside circle (#000000)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, viewW, viewH);

      ctx.save();
      ctx.translate(-Math.round(camPixelX), -Math.round(camPixelY));

      const arenaCenterPxX = (arena.width / 2) * cellPx;
      const arenaCenterPxY = (arena.height / 2) * cellPx;
      const arenaRadiusPx = arena.arenaRadius * cellPx;

      // Clip interior to circular arena (no square grids, pure smooth dark surface)
      ctx.save();
      ctx.beginPath();
      ctx.arc(arenaCenterPxX, arenaCenterPxY, arenaRadiusPx, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = '#0A0A0E';
      ctx.fillRect(
        arenaCenterPxX - arenaRadiusPx,
        arenaCenterPxY - arenaRadiusPx,
        arenaRadiusPx * 2,
        arenaRadiusPx * 2
      );

      // 1. Smooth organic 3D-extruded territories
      const lipOffsetPx = Math.max(5, Math.round(cellPx * 0.28));
      for (const [ownerNum, path] of cachedPaths.entries()) {
        const ownerPlayer = arena.players.get(ownerNum);
        const colorMeta = getPlayerColor(ownerPlayer?.colorIndex ?? ownerNum - 1);

        // 3D bottom extrusion shadow lip
        ctx.save();
        ctx.translate(0, lipOffsetPx);
        ctx.fillStyle = colorMeta.extrudeHex;
        ctx.fill(path, 'nonzero');
        ctx.restore();

        // Main smooth organic territory surface
        ctx.fillStyle = colorMeta.territoryHex;
        ctx.fill(path, 'nonzero');

        // Crisp subtle modern border
        ctx.strokeStyle = colorMeta.border;
        ctx.lineWidth = 1.5;
        ctx.stroke(path);
      }

      // 2. Smooth continuous curved trails (no squares)
      const trailWidth = Math.max(10, cellPx * 0.72);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = trailWidth;

      for (const p of arena.players.values()) {
        if (!p.alive || p.trailPoints.length === 0) continue;
        const smooth = smoothPosRef.current.get(p.numId);
        const headX = (smooth?.rx ?? p.x) * cellPx;
        const headY = (smooth?.ry ?? p.y) * cellPx;
        const pts = p.trailPoints;
        const colorMeta = getPlayerColor(p.colorIndex);

        ctx.strokeStyle = colorMeta.trailHex;
        ctx.beginPath();
        ctx.moveTo(pts[0].x * cellPx, pts[0].y * cellPx);

        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const curr = pts[i];
          const midX = ((prev.x + curr.x) * 0.5) * cellPx;
          const midY = ((prev.y + curr.y) * 0.5) * cellPx;
          ctx.quadraticCurveTo(prev.x * cellPx, prev.y * cellPx, midX, midY);
        }

        const lastPt = pts[pts.length - 1];
        ctx.quadraticCurveTo(lastPt.x * cellPx, lastPt.y * cellPx, headX, headY);
        ctx.stroke();
      }

      ctx.restore(); // End circular arena clip

      // Crisp glowing circular arena border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(arenaCenterPxX, arenaCenterPxY, arenaRadiusPx + 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(arenaCenterPxX, arenaCenterPxY, arenaRadiusPx, 0, Math.PI * 2);
      ctx.stroke();

      // 3. Death bursts (smooth round particles)
      for (const burst of arena.bursts) {
        const age = (now - burst.createdAt) / 750;
        if (age < 0 || age > 1) continue;
        const colorMeta = getPlayerColor(burst.colorIndex);
        const bx = burst.x * cellPx;
        const by = burst.y * cellPx;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.fillStyle = colorMeta.hex;
        for (let k = 0; k < 10; k++) {
          const angle = (k / 10) * Math.PI * 2;
          const dist = age * cellPx * 2.6;
          const r = Math.max(2, (1 - age) * (cellPx * 0.25));
          ctx.beginPath();
          ctx.arc(bx + Math.cos(angle) * dist, by + Math.sin(angle) * dist, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 4. 3D-extruded player heads & crisp floating labels
      for (const p of arena.players.values()) {
        if (!p.alive) continue;
        const smooth = smoothPosRef.current.get(p.numId);
        if (!smooth) continue;

        const cxPx = smooth.rx * cellPx;
        const cyPx = smooth.ry * cellPx;
        if (
          cxPx < camPixelX - 80 ||
          cxPx > camPixelX + viewW + 80 ||
          cyPx < camPixelY - 80 ||
          cyPx > camPixelY + viewH + 80
        ) {
          continue;
        }

        const colorMeta = getPlayerColor(p.colorIndex);
        const isMe = p.numId === myNumIdRef.current;
        const isLeader = p.numId === leaderNumId;
        const headSize = cellPx * 1.15;
        const halfHead = headSize / 2;

        // Subtle mouse-target directional guide dot for local player
        if (isMe && pointerRef.current.active) {
          const targetAng = p.targetAngle;
          const guideDist = headSize * 0.95;
          const gx = cxPx + Math.cos(targetAng) * guideDist;
          const gy = cyPx + Math.sin(targetAng) * guideDist;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
          ctx.beginPath();
          ctx.arc(gx, gy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Spawn shield ring
        if (p.shieldTicks > 0) {
          const pulse = 0.45 + 0.35 * Math.sin(now * 0.015);
          ctx.save();
          ctx.strokeStyle = `rgba(255, 255, 255, ${pulse})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cxPx, cyPx, halfHead + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // 3D bottom extrusion of rotated cube (shifted down in screen Y, just like Paper.io 2)
        ctx.save();
        ctx.translate(cxPx, cyPx + 4);
        ctx.rotate(smooth.rAngle);
        ctx.fillStyle = colorMeta.extrudeHex;
        drawRoundedRect(ctx, -halfHead, -halfHead, headSize, headSize, 4);
        ctx.fill();
        ctx.restore();

        // Top face of rotated cube
        ctx.save();
        ctx.translate(cxPx, cyPx);
        ctx.rotate(smooth.rAngle);

        ctx.fillStyle = colorMeta.hex;
        drawRoundedRect(ctx, -halfHead, -halfHead, headSize, headSize, 4);
        ctx.fill();

        ctx.strokeStyle = isMe ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = isMe ? 1.75 : 1.25;
        drawRoundedRect(ctx, -halfHead, -halfHead, headSize, headSize, 4);
        ctx.stroke();

        // Subtle inner square highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        drawRoundedRect(ctx, -halfHead * 0.55, -halfHead * 0.55, headSize * 0.55, headSize * 0.55, 2);
        ctx.fill();

        ctx.restore();

        // Crown for #1 leader
        if (isLeader) {
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          const crownY = cyPx - halfHead - 22;
          ctx.moveTo(cxPx - 7, crownY + 5);
          ctx.lineTo(cxPx - 8, crownY - 3);
          ctx.lineTo(cxPx - 3, crownY + 1);
          ctx.lineTo(cxPx, crownY - 5);
          ctx.lineTo(cxPx + 3, crownY + 1);
          ctx.lineTo(cxPx + 8, crownY - 3);
          ctx.lineTo(cxPx + 7, crownY + 5);
          ctx.closePath();
          ctx.fill();
        }

        // Clean crisp outlined floating player name
        ctx.font = '700 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelY = cyPx - halfHead - 12;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.strokeText(p.name, cxPx, labelY);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.name, cxPx, labelY);
      }

      ctx.restore();

      // 5. Smooth Circular Radar Minimap (Bottom-Right Corner)
      if (minimapCtx && minimapImageData) {
        if (minimapCanvas.width !== arena.width || minimapCanvas.height !== arena.height) {
          minimapCanvas.width = arena.width;
          minimapCanvas.height = arena.height;
          minimapImageData = minimapCtx.createImageData(arena.width, arena.height);
          lastMinimapGridVersion = -1;
        }

        if (arena.gridVersion !== lastMinimapGridVersion) {
          lastMinimapGridVersion = arena.gridVersion;
          const pixels = minimapImageData.data;
          const total = arena.width * arena.height;
          for (let i = 0; i < total; i++) {
            const pOffset = i * 4;
            const terrOwner = arena.ownerGrid[i];
            if (terrOwner !== 0) {
              const rgb = colorRgbCache.get(terrOwner)?.terrRgb ?? [110, 110, 120];
              pixels[pOffset] = rgb[0];
              pixels[pOffset + 1] = rgb[1];
              pixels[pOffset + 2] = rgb[2];
              pixels[pOffset + 3] = 255;
            } else {
              pixels[pOffset] = 10;
              pixels[pOffset + 1] = 10;
              pixels[pOffset + 2] = 14;
              pixels[pOffset + 3] = 255;
            }
          }
          minimapCtx.putImageData(minimapImageData, 0, 0);
        }

        const mapSize = viewW < 640 ? 96 : 128;
        const mapRadius = mapSize / 2;
        const margin = 16;
        const mapCenterX = viewW - mapRadius - margin;
        const mapCenterY = viewH - mapRadius - margin;

        ctx.save();
        ctx.fillStyle = 'rgba(8, 8, 12, 0.92)';
        ctx.beginPath();
        ctx.arc(mapCenterX, mapCenterY, mapRadius + 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(mapCenterX, mapCenterY, mapRadius, 0, Math.PI * 2);
        ctx.clip();

        ctx.imageSmoothingEnabled = true;
        const padRatio = arena.width / (arena.arenaRadius * 2);
        const drawSize = mapSize * padRatio;
        const drawLeft = mapCenterX - drawSize / 2;
        const drawTop = mapCenterY - drawSize / 2;
        ctx.drawImage(minimapCanvas, drawLeft, drawTop, drawSize, drawSize);

        for (const p of arena.players.values()) {
          if (!p.alive) continue;
          const smooth = smoothPosRef.current.get(p.numId);
          const mx = drawLeft + ((smooth?.rx ?? p.x) / arena.width) * drawSize;
          const my = drawTop + ((smooth?.ry ?? p.y) / arena.height) * drawSize;
          const isTracked = p.numId === myNumIdRef.current || p.numId === trackNumId;

          if (p.numId === myNumIdRef.current) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(mx, my, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.arc(mx, my, 5.5 + Math.sin(now * 0.01) * 1.2, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.fillStyle = isTracked ? '#ffffff' : getPlayerColor(p.colorIndex).hex;
            ctx.beginPath();
            ctx.arc(mx, my, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mapCenterX, mapCenterY, mapRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [liveArenaRef]);

  const updatePointer = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    pointerRef.current = {
      x: clientX - rect.left,
      y: clientY - rect.top,
      active: true,
    };
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex-1 overflow-hidden touch-none select-none bg-black cursor-crosshair"
      onPointerMove={(e) => {
        updatePointer(e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        updatePointer(e.clientX, e.clientY);
      }}
      onTouchStart={(e) => {
        if (e.touches.length > 0) {
          updatePointer(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchMove={(e) => {
        if (e.touches.length > 0) {
          updatePointer(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
