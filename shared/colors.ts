export interface PlayerColorMeta {
  index: number;
  labelDe: string;
  hex: string;
  territoryHex: string;
  territoryBorderHex: string;
  trailHex: string;
  softBg: string;
  border: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHex(hexA: string, hexB: string, weightA: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const w = Math.max(0, Math.min(1, weightA));
  return rgbToHex(
    r1 * w + r2 * (1 - w),
    g1 * w + g2 * (1 - w),
    b1 * w + b2 * (1 - w)
  );
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function createColorMeta(index: number, hex: string, labelDe: string): PlayerColorMeta {
  const [r, g, b] = hexToRgb(hex);
  return {
    index,
    labelDe,
    hex,
    territoryHex: mixHex(hex, '#070709', 0.44),
    territoryBorderHex: mixHex(hex, '#070709', 0.72),
    trailHex: `rgba(${r}, ${g}, ${b}, 0.52)`,
    softBg: `rgba(${r}, ${g}, ${b}, 0.14)`,
    border: `rgba(${r}, ${g}, ${b}, 0.45)`,
  };
}

const PRIMARY_HUMAN_PALETTE: Array<{ hex: string; labelDe: string }> = [
  { hex: '#ef4444', labelDe: 'Rot' },
  { hex: '#3b82f6', labelDe: 'Blau' },
  { hex: '#f59e0b', labelDe: 'Gold' },
  { hex: '#10b981', labelDe: 'Smaragd' },
  { hex: '#a855f7', labelDe: 'Violett' },
  { hex: '#06b6d4', labelDe: 'Cyan' },
  { hex: '#ec4899', labelDe: 'Pink' },
  { hex: '#84cc16', labelDe: 'Limette' },
];

const BOT_PALETTE: Array<{ hex: string; labelDe: string }> = Array.from(
  { length: 30 },
  (_, idx) => {
    const hue = Math.round((idx * 137.508 + 18) % 360);
    const sat = idx % 2 === 0 ? 78 : 68;
    const light = idx % 3 === 0 ? 58 : idx % 3 === 1 ? 52 : 63;
    return {
      hex: hslToHex(hue, sat, light),
      labelDe: `Arena #${idx + 9}`,
    };
  }
);

export const PLAYER_COLORS: PlayerColorMeta[] = [
  ...PRIMARY_HUMAN_PALETTE,
  ...BOT_PALETTE,
].map((entry, index) => createColorMeta(index, entry.hex, entry.labelDe));

export function getPlayerColor(colorIndex: number): PlayerColorMeta {
  if (colorIndex >= 0 && colorIndex < PLAYER_COLORS.length) {
    return PLAYER_COLORS[colorIndex];
  }
  return PLAYER_COLORS[Math.abs(colorIndex) % PLAYER_COLORS.length];
}

