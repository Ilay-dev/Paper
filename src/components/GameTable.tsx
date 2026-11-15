import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Crown,
  Eye,
  HelpCircle,
  LogOut,
  MousePointer2,
  RotateCcw,
  Skull,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { getPlayerColor } from '../../shared/colors.ts';
import type { ClientRoomState } from '../../shared/types.ts';
import type { HudSnapshot, LiveArenaState } from '../hooks/useSocket.ts';
import { MatchOverModal } from './MatchOverModal.tsx';
import { PaperCanvas } from './PaperCanvas.tsx';

interface GameTableProps {
  room: ClientRoomState;
  hud: HudSnapshot | null;
  liveArenaRef: React.MutableRefObject<LiveArenaState>;
  connected: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onSendAngle: (angle: number) => void;
  onToggleReady: () => void;
  onRestartMatch: () => void;
  onReturnToLobby: () => void;
  onLeave: () => void;
  onPlayWinSound: () => void;
}

function formatTimer(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function GameTable({
  room,
  hud,
  liveArenaRef,
  connected,
  soundEnabled,
  onToggleSound,
  onSendAngle,
  onToggleReady,
  onRestartMatch,
  onReturnToLobby,
  onLeave,
  onPlayWinSound,
}: GameTableProps) {
  const [showRules, setShowRules] = useState(false);
  const [spectateTargetNumId, setSpectateTargetNumId] = useState<number | null>(null);

  useEffect(() => {
    if (room.phase === 'match_over') {
      onPlayWinSound();
    }
  }, [room.phase, onPlayWinSound]);

  const handleAngle = useCallback(
    (angle: number) => {
      if (room.phase !== 'playing') return;
      onSendAngle(angle);
    },
    [room.phase, onSendAngle]
  );

  const cycleSpectateTarget = () => {
    const aliveList = Array.from(liveArenaRef.current.players.values()).filter((p) => p.alive);
    if (aliveList.length === 0) return;
    const idx = aliveList.findIndex((p) => p.numId === spectateTargetNumId);
    const next = aliveList[(idx + 1) % aliveList.length];
    setSpectateTargetNumId(next.numId);
  };

  const modeLabel =
    room.gameMode === 'time_3m'
      ? '3 Min'
      : room.gameMode === 'time_5m'
        ? '5 Min'
        : 'Knockout';

  const isHost = room.hostId === room.myPlayerId;
  const myStats = hud?.myPlayer ?? null;
  const myColorMeta = myStats ? getPlayerColor(myStats.colorIndex) : getPlayerColor(0);
  const totalEntities = room.arenaPlayers.length;
  const aliveCount = Array.from(liveArenaRef.current.players.values()).filter((p) => p.alive).length;
  const topFive = hud?.leaderboard.slice(0, 5) ?? [];

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden select-none">
      {/* Minimal Top Bar */}
      <header className="border-b border-white/[0.06] bg-black px-4 py-2.5 sm:px-6 z-20 shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <span className="font-bold tracking-[-0.03em] text-sm sm:text-base">PAPER</span>
            <span className="text-zinc-700">/</span>
            <span className="font-mono-code text-xs text-zinc-500">{room.roomCode}</span>
            <span className="hidden sm:inline text-zinc-800">·</span>
            <span className="hidden sm:inline text-xs text-zinc-400">{modeLabel}</span>
            <span className="text-zinc-800">·</span>
            <span className="font-mono-code text-xs font-semibold text-white">
              {room.gameMode === 'survival'
                ? `${aliveCount}/${totalEntities} aktiv`
                : formatTimer(hud?.remainingMs ?? 0)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span
              className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-zinc-500 px-2 py-1"
              title="Mauszeiger steuert deinen Block"
            >
              <MousePointer2 className="w-3 h-3 text-zinc-400" />
              <span>Maus-Steuerung</span>
            </span>

            <span
              className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 px-2 py-1"
              title={connected ? 'Verbunden (30 Hz Sync)' : 'Verbindung unterbrochen'}
            >
              {connected ? (
                <Wifi className="w-3.5 h-3.5 text-zinc-400" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-zinc-600" />
              )}
              <span className="hidden sm:inline font-mono-code">
                {connected ? '30 Hz Live' : 'Offline'}
              </span>
            </span>

            <button
              type="button"
              onClick={onToggleSound}
              title={soundEnabled ? 'Ton aus' : 'Ton an'}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.05] transition-colors cursor-pointer"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setShowRules((v) => !v)}
              title="Steuerung & Regeln"
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.05] transition-colors cursor-pointer"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onLeave}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white rounded-lg px-2 py-1.5 hover:bg-white/[0.05] transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Verlassen</span>
            </button>
          </div>
        </div>
      </header>

      {/* Rules Drawer */}
      {showRules && (
        <div className="border-b border-white/[0.06] bg-[#070709] px-4 py-2.5 text-xs text-zinc-400 z-20 shrink-0">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              <strong className="text-white">Steuerung:</strong> Bewege deinen Mauszeiger (oder Finger) in die gewünschte Richtung — dein Block folgt dem Cursor in der runden Arena · Kein Respawn: Stirbst du, startet eine neue Runde.
            </span>
            <button
              type="button"
              onClick={() => setShowRules(false)}
              className="text-zinc-300 hover:text-white shrink-0 self-end sm:self-center cursor-pointer"
            >
              Schließen
            </button>
          </div>
        </div>
      )}

      {/* Arena Stage */}
      <main className="relative flex-1 flex flex-col overflow-hidden">
        <PaperCanvas
          liveArenaRef={liveArenaRef}
          myNumId={room.myNumId}
          spectateTargetNumId={spectateTargetNumId}
          onAngleInput={handleAngle}
        />

        {/* Top-Left: Paper.io 2 Style Progress Pill + Best + Kills + Kill Feed */}
        {myStats && (
          <div className="pointer-events-none absolute top-3.5 left-3.5 z-10 space-y-1.5">
            <div
              style={{
                backgroundColor: myColorMeta.territoryHex,
                borderColor: myColorMeta.hex,
              }}
              className="rounded-full border px-4 py-1 min-w-[155px] sm:min-w-[195px] shadow-[0_6px_20px_rgba(0,0,0,0.65)] flex items-center justify-between gap-3"
            >
              <span className="font-mono-code text-sm font-bold text-white drop-shadow">
                {myStats.areaPct.toFixed(2)}%
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/75">
                #{myStats.rank}
              </span>
            </div>

            <div className="pl-1 space-y-1">
              <div className="text-[11px] font-bold tracking-wide text-zinc-400">
                BESTE {myStats.maxAreaPct.toFixed(2)}%
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#09090C]/90 px-2.5 py-0.5 text-[11px] font-bold text-white shadow">
                <Skull className="w-3 h-3 text-zinc-300" />
                <span className="font-mono-code">x{myStats.kills}</span>
              </div>
            </div>

            {hud && hud.events.length > 0 && (
              <div className="pt-2 space-y-1 max-w-[250px]">
                {hud.events.slice(0, 3).map((evt) => {
                  const victimColor = getPlayerColor(evt.victimColorIndex);
                  const killerColor =
                    evt.killerColorIndex !== null ? getPlayerColor(evt.killerColorIndex) : null;
                  return (
                    <div
                      key={evt.id}
                      className="animate-feed-in rounded-full border border-white/[0.08] bg-[#08080A]/85 backdrop-blur-sm px-2.5 py-1 text-[10px] flex items-center gap-1.5 shadow-lg"
                    >
                      {evt.killerName && killerColor ? (
                        <>
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: killerColor.hex }}
                          />
                          <span className="font-medium text-white truncate max-w-[75px]">
                            {evt.killerName}
                          </span>
                          <span className="text-zinc-500">
                            {evt.reason === 'wipeout' ? 'eroberte' : 'schnitt'}
                          </span>
                        </>
                      ) : (
                        <Skull className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
                      )}
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: victimColor.hex }}
                      />
                      <span className="text-zinc-300 truncate max-w-[85px]">{evt.victimName}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Top-Right: Modern Dark Paper.io 2 Colored Pill Leaderboard */}
        {topFive.length > 0 && (
          <aside className="pointer-events-none absolute top-3.5 right-0 z-10 flex flex-col items-end gap-1.5">
            {topFive.map((entry, idx) => {
              const colorMeta = getPlayerColor(entry.colorIndex);
              const isMe = entry.numId === room.myNumId;
              return (
                <div
                  key={entry.id}
                  style={{
                    backgroundColor: colorMeta.territoryHex,
                    borderColor: isMe ? '#ffffff' : colorMeta.border,
                  }}
                  className={`rounded-l-full border border-r-0 pl-3.5 pr-4 py-1 text-xs flex items-center gap-2 shadow-[0_4px_14px_rgba(0,0,0,0.6)] min-w-[165px] sm:min-w-[215px] ${
                    !entry.alive ? 'opacity-45' : ''
                  }`}
                >
                  <span className="font-mono-code font-bold text-white/90 shrink-0">
                    {idx === 0 ? (
                      <Crown className="w-3.5 h-3.5 text-amber-300 inline mr-0.5" />
                    ) : (
                      `${idx + 1}`
                    )}
                  </span>
                  <span className="text-white/50">–</span>
                  <span className="font-mono-code font-semibold text-white shrink-0">
                    {entry.areaPct.toFixed(2)}%
                  </span>
                  <span className="truncate font-medium text-white/95 max-w-[95px]">
                    {entry.name}
                  </span>
                  {entry.isBot && <Bot className="w-3 h-3 text-white/60 shrink-0 ml-auto" />}
                </div>
              );
            })}

            {myStats && myStats.rank > 5 && (
              <div
                style={{
                  backgroundColor: myColorMeta.territoryHex,
                  borderColor: myColorMeta.hex,
                }}
                className={`mt-2 rounded-l-full border border-r-0 pl-3.5 pr-4 py-1 text-xs flex items-center gap-2 shadow-[0_4px_14px_rgba(0,0,0,0.6)] min-w-[165px] sm:min-w-[215px] ${
                  !myStats.alive ? 'opacity-60' : ''
                }`}
              >
                <span className="font-mono-code font-bold text-white shrink-0">
                  {myStats.rank}
                </span>
                <span className="text-white/50">–</span>
                <span className="font-mono-code font-semibold text-white shrink-0">
                  {myStats.areaPct.toFixed(2)}%
                </span>
                <span className="truncate font-semibold text-white max-w-[95px]">
                  {myStats.name}
                </span>
              </div>
            )}
          </aside>
        )}

        {/* Spectator Overlay when dead while another human player is still alive */}
        {room.phase === 'playing' && myStats && !myStats.alive && (
          <div className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 z-10 rounded-2xl border border-white/15 bg-[#09090B]/92 backdrop-blur-md px-5 py-3 flex items-center gap-3 shadow-2xl animate-pop-in">
            <div className="flex items-center gap-2 text-xs">
              <Eye className="w-4 h-4 text-zinc-400" />
              <div>
                <div className="font-semibold text-white">Ausgeschieden</div>
                <div className="text-[11px] text-zinc-400">Kein Respawn · Spectator aktiv</div>
              </div>
            </div>
            <button
              type="button"
              onClick={cycleSpectateTarget}
              className="rounded-lg border border-white/15 bg-white/[0.06] text-white px-3 py-1.5 text-xs font-medium hover:bg-white/[0.14] transition-colors cursor-pointer"
            >
              Nächster Spieler
            </button>
            {isHost && (
              <button
                type="button"
                onClick={onRestartMatch}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white text-black px-3 py-1.5 text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Neue Runde</span>
              </button>
            )}
          </div>
        )}
      </main>

      {room.phase === 'match_over' && (
        <MatchOverModal
          room={room}
          onToggleReady={onToggleReady}
          onRestartMatch={onRestartMatch}
          onReturnToLobby={onReturnToLobby}
        />
      )}
    </div>
  );
}
