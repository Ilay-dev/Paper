import { useEffect, useRef } from 'react';
import { getPlayerColor } from '../../shared/colors.ts';
import {
  MAX_TURN_RATE_RAD_PER_SEC,
  MOVE_SPEED_CELLS_PER_SEC,
  shortestAngleDiff,
  stepAngleToward,
} from '../../shared/gameEngine.ts';
import type { LiveArenaState } from '../hooks/useSocket.ts';

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
    let lastGridVersion = -1;

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
        const targetX = p.x + Math.cos(predictedAngle) * MOVE_SPEED_CELLS_PER_SEC * dtSincePacket;
        const targetY = p.y + Math.sin(predictedAngle) * MOVE_SPEED_CELLS_PER_SEC * dtSincePacket;

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

      // Clear background (#000000 void outside circular arena)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, viewW, viewH);

      ctx.save();
      ctx.translate(-Math.round(camPixelX), -Math.round(camPixelY));

      const arenaCenterPxX = (arena.width / 2) * cellPx;
      const arenaCenterPxY = (arena.height / 2) * cellPx;
      const arenaRadiusPx = arena.arenaRadius * cellPx;

      // Clip interior to the circular arena
      ctx.save();
      ctx.beginPath();
      ctx.arc(arenaCenterPxX, arenaCenterPxY, arenaRadiusPx, 0, Math.PI * 2);
      ctx.clip();

      // Arena interior background
      ctx.fillStyle = '#07070A';
      ctx.fillRect(
        arenaCenterPxX - arenaRadiusPx,
        arenaCenterPxY - arenaRadiusPx,
        arenaRadiusPx * 2,
        arenaRadiusPx * 2
      );

      const startCol = Math.max(0, Math.floor(camPixelX / cellPx) - 1);
      const endCol = Math.min(arena.width - 1, Math.ceil((camPixelX + viewW) / cellPx) + 1);
      const startRow = Math.max(0, Math.floor(camPixelY / cellPx) - 1);
      const endRow = Math.min(arena.height - 1, Math.ceil((camPixelY + viewH) / cellPx) + 1);

      // Subtle architectural dark grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = startCol; c <= endCol + 1; c++) {
        const px = c * cellPx + 0.5;
        ctx.moveTo(px, startRow * cellPx);
        ctx.lineTo(px, (endRow + 1) * cellPx);
      }
      for (let r = startRow; r <= endRow + 1; r++) {
        const py = r * cellPx + 0.5;
        ctx.moveTo(startCol * cellPx, py);
        ctx.lineTo((endCol + 1) * cellPx, py);
      }
      ctx.stroke();

      // 1. Owned territory cells
      const ownerGrid = arena.ownerGrid;
      const trailGrid = arena.trailGrid;
      const lipH = Math.max(2, Math.round(cellPx * 0.16));

      for (let r = startRow; r <= endRow; r++) {
        const rowOffset = r * arena.width;
        const py = r * cellPx;
        for (let c = startCol; c <= endCol; c++) {
          const ownerNum = ownerGrid[rowOffset + c];
          if (ownerNum === 0) continue;
          const ownerPlayer = arena.players.get(ownerNum);
          const colorMeta = getPlayerColor(ownerPlayer?.colorIndex ?? ownerNum - 1);
          const px = c * cellPx;

          ctx.fillStyle = colorMeta.territoryHex;
          ctx.fillRect(px, py, cellPx + 0.4, cellPx + 0.4);

          const belowOwner =
            r + 1 < arena.height ? ownerGrid[(r + 1) * arena.width + c] : 0;
          if (belowOwner !== ownerNum) {
            ctx.fillStyle = colorMeta.territoryBorderHex;
            ctx.fillRect(px, py + cellPx - lipH, cellPx + 0.4, lipH + 0.4);
          }

          const aboveOwner = r > 0 ? ownerGrid[(r - 1) * arena.width + c] : 0;
          if (aboveOwner !== ownerNum) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(px, py, cellPx + 0.4, 1.5);
          }
        }
      }

      // 2. Trail cells
      const trailPad = Math.max(2, Math.round(cellPx * 0.14));
      const trailSize = cellPx - trailPad * 2;
      for (let r = startRow; r <= endRow; r++) {
        const rowOffset = r * arena.width;
        const py = r * cellPx;
        for (let c = startCol; c <= endCol; c++) {
          const trailNum = trailGrid[rowOffset + c];
          if (trailNum === 0) continue;
          const trailPlayer = arena.players.get(trailNum);
          const colorMeta = getPlayerColor(trailPlayer?.colorIndex ?? trailNum - 1);
          ctx.fillStyle = colorMeta.trailHex;
          ctx.fillRect(c * cellPx + trailPad, py + trailPad, trailSize, trailSize);
        }
      }

      // Continuous trail connector up to smooth head position
      for (const p of arena.players.values()) {
        if (!p.alive) continue;
        const smooth = smoothPosRef.current.get(p.numId);
        if (!smooth) continue;
        const cx = Math.floor(p.x);
        const cy = Math.floor(p.y);
        const cellIdx = cy * arena.width + cx;
        const onOwn =
          cx >= 0 &&
          cx < arena.width &&
          cy >= 0 &&
          cy < arena.height &&
          ownerGrid[cellIdx] === p.numId;
        if (!onOwn) {
          const colorMeta = getPlayerColor(p.colorIndex);
          ctx.strokeStyle = colorMeta.trailHex;
          ctx.lineWidth = trailSize;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x * cellPx, p.y * cellPx);
          ctx.lineTo(smooth.rx * cellPx, smooth.ry * cellPx);
          ctx.stroke();
        }
      }

      ctx.restore(); // End circular arena clip

      // Crisp glowing circular arena border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(arenaCenterPxX, arenaCenterPxY, arenaRadiusPx + 3, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(arenaCenterPxX, arenaCenterPxY, arenaRadiusPx, 0, Math.PI * 2);
      ctx.stroke();

      // 3. Death bursts
      for (const burst of arena.bursts) {
        const age = (now - burst.createdAt) / 750;
        if (age < 0 || age > 1) continue;
        const colorMeta = getPlayerColor(burst.colorIndex);
        const bx = burst.x * cellPx;
        const by = burst.y * cellPx;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.fillStyle = colorMeta.hex;
        for (let k = 0; k < 8; k++) {
          const angle = (k / 8) * Math.PI * 2;
          const dist = age * cellPx * 2.4;
          const sz = Math.max(2, (1 - age) * (cellPx * 0.4));
          ctx.fillRect(
            bx + Math.cos(angle) * dist - sz / 2,
            by + Math.sin(angle) * dist - sz / 2,
            sz,
            sz
          );
        }
        ctx.restore();
      }

      // 4. Player heads, mouse steering guide & labels
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
        const headSize = cellPx + 3;
        const halfHead = headSize / 2;

        // Subtle mouse-target directional guide for local player
        if (isMe && pointerRef.current.active) {
          const targetAng = p.targetAngle;
          const guideDist = headSize * 0.95;
          const gx = cxPx + Math.cos(targetAng) * guideDist;
          const gy = cyPx + Math.sin(targetAng) * guideDist;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
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

        // Rotated block head aligned to movement angle
        ctx.save();
        ctx.translate(cxPx, cyPx);
        ctx.rotate(smooth.rAngle);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        drawRoundedRect(ctx, -halfHead + 1, -halfHead + 3, headSize, headSize, 5);
        ctx.fill();

        ctx.fillStyle = colorMeta.hex;
        drawRoundedRect(ctx, -halfHead, -halfHead, headSize, headSize, 5);
        ctx.fill();

        ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = isMe ? 2 : 1.25;
        drawRoundedRect(ctx, -halfHead, -halfHead, headSize, headSize, 5);
        ctx.stroke();

        // Forward direction nose dot
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(halfHead * 0.45, 0, Math.max(2, cellPx * 0.11), 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Crown for #1 leader
        if (isLeader) {
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          const crownY = cyPx - halfHead - 18;
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

        // Name tag
        const pct = ((p.areaCells / Math.max(1, arena.validCells)) * 100).toFixed(1);
        const labelText = `${p.name} · ${pct}%`;
        ctx.font = '600 11px Inter, sans-serif';
        const textW = ctx.measureText(labelText).width;
        const pillW = textW + 12;
        const pillH = 17;
        const pillX = cxPx - pillW / 2;
        const pillY = cyPx - halfHead - (isLeader ? 39 : 25);

        ctx.fillStyle = isMe ? 'rgba(255, 255, 255, 0.92)' : 'rgba(9, 9, 11, 0.85)';
        drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 5);
        ctx.fill();

        if (!isMe) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.lineWidth = 1;
          drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 5);
          ctx.stroke();
        }

        ctx.fillStyle = isMe ? '#000000' : '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, cxPx, pillY + pillH / 2 + 0.5);
      }

      ctx.restore();

      // 5. Circular Minimap (Bottom-Right Corner)
      if (minimapCtx && minimapImageData) {
        if (minimapCanvas.width !== arena.width || minimapCanvas.height !== arena.height) {
          minimapCanvas.width = arena.width;
          minimapCanvas.height = arena.height;
          minimapImageData = minimapCtx.createImageData(arena.width, arena.height);
          lastGridVersion = -1;
        }

        if (arena.gridVersion !== lastGridVersion) {
          lastGridVersion = arena.gridVersion;
          const pixels = minimapImageData.data;
          const total = arena.width * arena.height;
          for (let i = 0; i < total; i++) {
            const pOffset = i * 4;
            const trailOwner = arena.trailGrid[i];
            const terrOwner = arena.ownerGrid[i];
            if (trailOwner !== 0) {
              const rgb = colorRgbCache.get(trailOwner)?.hexRgb ?? [200, 200, 200];
              pixels[pOffset] = rgb[0];
              pixels[pOffset + 1] = rgb[1];
              pixels[pOffset + 2] = rgb[2];
              pixels[pOffset + 3] = 255;
            } else if (terrOwner !== 0) {
              const rgb = colorRgbCache.get(terrOwner)?.terrRgb ?? [110, 110, 120];
              pixels[pOffset] = rgb[0];
              pixels[pOffset + 1] = rgb[1];
              pixels[pOffset + 2] = rgb[2];
              pixels[pOffset + 3] = 255;
            } else {
              pixels[pOffset] = 9;
              pixels[pOffset + 1] = 9;
              pixels[pOffset + 2] = 12;
              pixels[pOffset + 3] = 255;
            }
          }
          minimapCtx.putImageData(minimapImageData, 0, 0);
        }

        const mapSize = viewW < 640 ? 98 : 134;
        const mapRadius = mapSize / 2;
        const margin = 14;
        const mapCenterX = viewW - mapRadius - margin;
        const mapCenterY = viewH - mapRadius - margin;
        const mapLeft = mapCenterX - mapRadius;
        const mapTop = mapCenterY - mapRadius;

        ctx.save();
        ctx.fillStyle = 'rgba(8, 8, 10, 0.92)';
        ctx.beginPath();
        ctx.arc(mapCenterX, mapCenterY, mapRadius + 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(mapCenterX, mapCenterY, mapRadius, 0, Math.PI * 2);
        ctx.clip();

        ctx.imageSmoothingEnabled = false;
        // Scale minimap so the arena circle (radius 76 out of 80) fills the circular minimap cleanly
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
            ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
          }
        }
        ctx.restore();

        // Circular minimap border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mapCenterX, mapCenterY, mapRadius, 0, Math.PI * 2);
        ctx.stroke();
        void mapLeft;
        void mapTop;
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
