import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Crown,
  Eye,
  HelpCircle,
  LogOut,
  MousePointer2,
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

  const myStats = hud?.myPlayer ?? null;
  const totalEntities = room.arenaPlayers.length;
  const aliveCount = Array.from(liveArenaRef.current.players.values()).filter((p) => p.alive).length;

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
              <strong className="text-white">Steuerung:</strong> Bewege deinen Mauszeiger (oder Finger) in die gewünschte Richtung — dein Block folgt dem Cursor in der runden Arena · Verlasse dein Gebiet und kehre zurück, um Fläche zu erobern · Schneide gegnerische Spuren durch.
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

        {/* Top-Left: Kill Feed */}
        {hud && hud.events.length > 0 && (
          <div className="pointer-events-none absolute top-3 left-3 z-10 space-y-1.5 max-w-[260px] sm:max-w-xs">
            {hud.events.slice(0, 4).map((evt) => {
              const victimColor = getPlayerColor(evt.victimColorIndex);
              const killerColor =
                evt.killerColorIndex !== null ? getPlayerColor(evt.killerColorIndex) : null;
              return (
                <div
                  key={evt.id}
                  className="animate-feed-in rounded-lg border border-white/[0.08] bg-[#08080A]/88 backdrop-blur-sm px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 shadow-lg"
                >
                  {evt.killerName && killerColor ? (
                    <>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: killerColor.hex }}
                      />
                      <span className="font-medium text-white truncate max-w-[85px]">
                        {evt.killerName}
                      </span>
                      <span className="text-zinc-500">
                        {evt.reason === 'wipeout' ? 'eroberte' : 'schnitt'}
                      </span>
                    </>
                  ) : (
                    <Skull className="w-3 h-3 text-zinc-500 shrink-0" />
                  )}
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: victimColor.hex }}
                  />
                  <span className="text-zinc-300 truncate max-w-[95px]">{evt.victimName}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Top-Right: Live Leaderboard */}
        {hud && hud.leaderboard.length > 0 && (
          <aside className="pointer-events-none absolute top-3 right-3 z-10 w-44 sm:w-56 rounded-xl border border-white/[0.08] bg-[#08080A]/88 backdrop-blur-sm p-2.5 shadow-2xl">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 px-1">
              <span>Rangliste</span>
              <span className="font-mono-code">Fläche</span>
            </div>
            <ul className="space-y-1">
              {hud.leaderboard.map((entry, idx) => {
                const colorMeta = getPlayerColor(entry.colorIndex);
                const isMe = entry.numId === room.myNumId;
                return (
                  <li
                    key={entry.id}
                    className={`flex items-center justify-between gap-1.5 rounded-md px-1.5 py-1 text-[11px] ${
                      isMe ? 'bg-white/[0.1] text-white font-semibold' : 'text-zinc-300'
                    } ${!entry.alive ? 'opacity-45' : ''}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono-code text-[10px] text-zinc-500 w-3 shrink-0">
                        {idx === 0 ? (
                          <Crown className="w-3 h-3 text-amber-400" />
                        ) : (
                          `${idx + 1}`
                        )}
                      </span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: colorMeta.hex }}
                      />
                      <span className="truncate">{entry.name}</span>
                      {entry.isBot && <Bot className="w-2.5 h-2.5 text-zinc-500 shrink-0" />}
                    </div>
                    <span className="font-mono-code text-[10px] text-zinc-200 shrink-0">
                      {entry.areaPct.toFixed(1)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}

        {/* Bottom-Left: Player Live Stats Pill */}
        {myStats && (
          <div className="pointer-events-none absolute bottom-3.5 left-3.5 z-10 rounded-xl border border-white/[0.09] bg-[#08080A]/90 backdrop-blur-sm px-3.5 py-2.5 flex items-center gap-4 shadow-2xl">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Fläche</div>
              <div className="font-mono-code text-sm sm:text-base font-bold text-white">
                {myStats.areaPct.toFixed(1)}%
              </div>
            </div>
            <div className="h-6 w-px bg-white/[0.08]" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Kills</div>
              <div className="font-mono-code text-sm sm:text-base font-bold text-white">
                {myStats.kills}
              </div>
            </div>
            <div className="hidden sm:block h-6 w-px bg-white/[0.08]" />
            <div className="hidden sm:block">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Rang</div>
              <div className="font-mono-code text-sm sm:text-base font-bold text-zinc-200">
                #{myStats.rank}/{totalEntities}
              </div>
            </div>
            <div className="hidden sm:block h-6 w-px bg-white/[0.08]" />
            <div className="hidden sm:block">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Best</div>
              <div className="font-mono-code text-sm sm:text-base font-bold text-zinc-300">
                {myStats.maxAreaPct.toFixed(1)}%
              </div>
            </div>
          </div>
        )}

        {/* Center/Bottom Respawn or Spectator Overlay when dead */}
        {room.phase === 'playing' && myStats && !myStats.alive && (
          <div className="pointer-events-auto absolute bottom-20 left-1/2 -translate-x-1/2 z-10 rounded-2xl border border-white/15 bg-[#09090B]/92 backdrop-blur-md px-5 py-3 flex items-center gap-4 shadow-2xl animate-pop-in">
            {room.gameMode === 'survival' ? (
              <>
                <div className="flex items-center gap-2 text-xs">
                  <Eye className="w-4 h-4 text-zinc-400" />
                  <div>
                    <div className="font-semibold text-white">Ausgeschieden</div>
                    <div className="text-[11px] text-zinc-400">Spectator-Modus aktiv</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={cycleSpectateTarget}
                  className="rounded-lg bg-white text-black px-3 py-1.5 text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
                >
                  Nächster Spieler
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2.5 text-xs">
                <Skull className="w-4 h-4 text-zinc-400" />
                <div>
                  <div className="font-semibold text-white">Eliminiert!</div>
                  <div className="text-[11px] font-mono-code text-zinc-400">
                    Respawn in {myStats.respawnSeconds.toFixed(1)}s…
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {room.phase === 'match_over' && (
        <MatchOverModal
          room={room}
          onToggleReady={onToggleReady}
          onReturnToLobby={onReturnToLobby}
        />
      )}
    </div>
  );
}
