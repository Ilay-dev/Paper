import { Bot, Check, Play, RotateCcw, Trophy } from 'lucide-react';
import { getPlayerColor } from '../../shared/colors.ts';
import type { ClientRoomState } from '../../shared/types.ts';

interface MatchOverModalProps {
  room: ClientRoomState;
  onToggleReady: () => void;
  onRestartMatch: () => void;
  onReturnToLobby: () => void;
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MatchOverModal({
  room,
  onToggleReady,
  onRestartMatch,
  onReturnToLobby,
}: MatchOverModalProps) {
  const summary = room.matchSummary;
  if (!summary) return null;

  const isHost = room.hostId === room.myPlayerId;
  const me = room.humanPlayers.find((p) => p.id === room.myPlayerId);
  const readyCount = room.humanPlayers.filter((p) => p.isReady).length;
  const winnerMeta = getPlayerColor(summary.winnerColorIndex);

  const reasonLabel =
    summary.winReason === 'conquest'
      ? 'Totale Eroberung'
      : summary.winReason === 'eliminated'
        ? 'Ausgeschieden · Runde beendet'
        : summary.winReason === 'last_standing'
          ? 'Letzter Überlebender'
          : 'Zeit abgelaufen';

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#09090B] p-6 space-y-5 animate-pop-in shadow-2xl">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center">
            <Trophy className="w-5 h-5" />
          </div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            {reasonLabel} · {formatDuration(summary.durationMs)}
          </div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full inline-block"
              style={{ backgroundColor: winnerMeta.hex }}
            />
            <span>
              {summary.winReason === 'eliminated'
                ? `Runde vorbei — ${summary.winnerName} führt`
                : `${summary.winnerName} gewinnt!`}
            </span>
          </h2>
        </div>

        <ul className="max-h-72 overflow-y-auto divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-black/60">
          {summary.standings.map((entry, idx) => {
            const colorMeta = getPlayerColor(entry.colorIndex);
            const isMe = entry.id === room.myPlayerId;
            return (
              <li
                key={entry.id}
                className={`px-4 py-2.5 flex items-center justify-between text-xs ${
                  isMe ? 'bg-white/[0.04]' : ''
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono-code text-zinc-500 w-5">{idx + 1}.</span>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: colorMeta.hex }}
                  />
                  <span
                    className={`truncate ${
                      idx === 0 || isMe ? 'font-semibold text-white' : 'text-zinc-300'
                    }`}
                  >
                    {entry.name}
                    {isMe ? ' (Du)' : ''}
                  </span>
                  {entry.isBot && <Bot className="w-3 h-3 text-zinc-500 shrink-0" />}
                </div>

                <div className="flex items-center gap-3 font-mono-code text-[11px] text-zinc-400 shrink-0">
                  <span className="text-white">{entry.finalAreaPct.toFixed(1)}%</span>
                  <span className="hidden sm:inline text-zinc-500">
                    Max {entry.maxAreaPct.toFixed(1)}%
                  </span>
                  <span>{entry.kills} Kills</span>
                </div>
              </li>
            );
          })}
        </ul>

        {room.countdownSeconds !== null ? (
          <div className="rounded-xl bg-white text-black px-4 py-3 flex items-center justify-between text-xs font-semibold">
            <span>Nächste Runde startet in {room.countdownSeconds}…</span>
            <button
              type="button"
              onClick={onToggleReady}
              className="underline underline-offset-4 cursor-pointer"
            >
              Abbrechen
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {isHost ? (
              <button
                type="button"
                onClick={onRestartMatch}
                className="w-full rounded-xl bg-white text-black py-3.5 px-4 text-xs sm:text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Neue Runde starten</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onToggleReady}
                className={`w-full rounded-xl py-3 px-4 text-xs sm:text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2 ${
                  me?.isReady
                    ? 'border border-white/25 bg-white/[0.08] text-white'
                    : 'bg-white text-black hover:bg-zinc-200'
                }`}
              >
                {me?.isReady && <Check className="w-4 h-4" />}
                <span>
                  {me?.isReady
                    ? `Bereit für neue Runde (${readyCount}/${room.humanPlayers.length})`
                    : 'Bereit für neue Runde'}
                </span>
              </button>
            )}

            {isHost && room.humanPlayers.length > 1 && (
              <button
                type="button"
                onClick={onToggleReady}
                className="w-full rounded-xl border border-white/15 bg-white/[0.05] py-2.5 px-4 text-xs text-zinc-200 hover:bg-white/[0.1] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {me?.isReady && <Check className="w-3.5 h-3.5" />}
                <span>
                  {me?.isReady
                    ? `Bereit (${readyCount}/${room.humanPlayers.length})`
                    : 'Countdown-Bereit melden'}
                </span>
              </button>
            )}

            {isHost && (
              <button
                type="button"
                onClick={onReturnToLobby}
                className="w-full rounded-xl border border-white/10 py-2.5 px-4 text-xs text-zinc-400 hover:text-white hover:border-white/25 transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Zurück zur Lobby</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
