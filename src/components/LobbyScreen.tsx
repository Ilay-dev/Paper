import { useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Link2,
  LogOut,
  Minus,
  Plus,
  UserMinus,
  Users,
  Wifi,
  Zap,
} from 'lucide-react';
import { getPlayerColor } from '../../shared/colors.ts';
import { MAX_BOTS, MAX_HUMAN_PLAYERS } from '../../shared/gameEngine.ts';
import type { ClientRoomState, GameMode } from '../../shared/types.ts';

interface LobbyScreenProps {
  room: ClientRoomState;
  connected: boolean;
  onToggleReady: () => void;
  onSetGameMode: (mode: GameMode) => void;
  onSetBotCount: (count: number) => void;
  onAddBot: () => void;
  onRemoveBot: () => void;
  onRemovePlayer: (targetPlayerId: string) => void;
  onLeave: () => void;
}

const BOT_PRESETS = [0, 5, 10, 15, 20, 30];

export function LobbyScreen({
  room,
  connected,
  onToggleReady,
  onSetGameMode,
  onSetBotCount,
  onAddBot,
  onRemoveBot,
  onRemovePlayer,
  onLeave,
}: LobbyScreenProps) {
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);

  const me = room.humanPlayers.find((p) => p.id === room.myPlayerId);
  const isHost = room.hostId === room.myPlayerId;
  const humanCount = room.humanPlayers.length;
  const readyCount = room.humanPlayers.filter((p) => p.isReady).length;
  const totalArenaEntities = humanCount + room.botCount;

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?room=${room.roomCode}`
      : room.roomCode;

  const copyText = async (text: string, type: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col px-4 py-6 sm:px-6">
      <header className="max-w-2xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-lg font-bold tracking-[-0.03em]">PAPER</span>
          <span className="text-zinc-700">/</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
            <Wifi className={`w-3.5 h-3.5 ${connected ? 'text-white' : 'text-zinc-600'}`} />
            {connected ? 'Verbunden' : 'Verbinde…'}
          </span>
        </div>

        <button
          type="button"
          onClick={onLeave}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white rounded-lg px-2.5 py-1.5 hover:bg-white/[0.05] transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Verlassen</span>
        </button>
      </header>

      <main className="max-w-2xl w-full mx-auto my-auto py-8 space-y-5">
        {/* Room Code */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#08080A] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-1">
              Room-Code
            </div>
            <div className="font-mono-code text-3xl sm:text-4xl font-bold tracking-[0.22em] text-white">
              {room.roomCode}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyText(room.roomCode, 'code')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.05] px-3.5 py-2 text-xs font-medium text-white hover:bg-white/[0.12] transition-colors cursor-pointer"
            >
              {copiedType === 'code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedType === 'code' ? 'Code kopiert' : 'Code kopieren'}</span>
            </button>

            <button
              type="button"
              onClick={() => void copyText(inviteUrl, 'link')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white text-black px-3.5 py-2 text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              {copiedType === 'link' ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
              <span>{copiedType === 'link' ? 'Link kopiert' : 'Invite-Link kopieren'}</span>
            </button>
          </div>
        </section>

        {/* Game Mode & Bot Settings */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#08080A] p-5 space-y-5">
          {/* Mode selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Zap className="w-3.5 h-3.5 text-white" />
                <span>Spielmodus</span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                {room.gameMode === 'time_3m'
                  ? '3 Minuten Zeitmodus ohne Respawn — stirbst du, startest du eine neue Runde.'
                  : room.gameMode === 'time_5m'
                    ? '5 Minuten Arena-Schlacht ohne Respawn — größte Fläche gewinnt.'
                    : 'Knockout ohne Respawn — der letzte Überlebende gewinnt die Runde.'}
              </p>
            </div>

            <div className="inline-flex rounded-xl border border-white/[0.1] bg-black p-1 shrink-0 self-start sm:self-center">
              {(
                [
                  { id: 'time_3m', label: '3 Min' },
                  { id: 'time_5m', label: '5 Min' },
                  { id: 'survival', label: 'Knockout' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  disabled={!isHost}
                  onClick={() => onSetGameMode(mode.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    room.gameMode === mode.id
                      ? 'bg-white text-black font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  } ${!isHost ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-white/[0.06]" />

          {/* Bot Count Control (0-30) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Bot className="w-3.5 h-3.5 text-white" />
                <span>KI-Bots ({room.botCount}/{MAX_BOTS})</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono-code text-zinc-500">
                  {totalArenaEntities} in Arena
                </span>
                {isHost && (
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      disabled={room.botCount <= 0}
                      onClick={onRemoveBot}
                      title="Bot entfernen"
                      className="w-7 h-7 rounded-lg border border-white/[0.1] bg-white/[0.04] flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={room.botCount >= MAX_BOTS}
                      onClick={onAddBot}
                      title="Bot hinzufügen"
                      className="w-7 h-7 rounded-lg border border-white/[0.1] bg-white/[0.04] flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isHost && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={MAX_BOTS}
                  value={room.botCount}
                  onChange={(e) => onSetBotCount(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, #ffffff ${(room.botCount / MAX_BOTS) * 100}%, rgba(255, 255, 255, 0.12) ${(room.botCount / MAX_BOTS) * 100}%)`,
                  }}
                  className="paper-slider flex-1"
                />
                <div className="flex items-center gap-1 flex-wrap">
                  {BOT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onSetBotCount(preset)}
                      className={`px-2 py-1 rounded-md text-[11px] font-mono-code transition-colors cursor-pointer ${
                        room.botCount === preset
                          ? 'bg-white text-black font-semibold'
                          : 'bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/[0.1]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Human Players List (1-8) */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#08080A] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Users className="w-4 h-4 text-zinc-400" />
              <span>Spieler ({humanCount}/{MAX_HUMAN_PLAYERS})</span>
            </div>

            <span className="text-xs font-mono-code text-zinc-500">
              {readyCount}/{humanCount} bereit
            </span>
          </div>

          <ul className="divide-y divide-white/[0.06]">
            {room.humanPlayers.map((player) => {
              const isMe = player.id === room.myPlayerId;
              const colorMeta = getPlayerColor(player.colorIndex);

              return (
                <li
                  key={player.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full border flex items-center justify-center text-xs font-semibold shrink-0"
                      style={{
                        backgroundColor: colorMeta.softBg,
                        borderColor: colorMeta.border,
                        color: '#ffffff',
                      }}
                    >
                      {player.name.slice(0, 1).toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white truncate">
                          {player.name}
                        </span>
                        {isMe && (
                          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                            (Du)
                          </span>
                        )}
                        {player.isHost && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider bg-white/[0.08] text-zinc-200 px-1.5 py-0.5 rounded">
                            Host
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: colorMeta.hex }}
                        />
                        <span>Farbe: {colorMeta.labelDe}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        player.isReady
                          ? 'bg-white text-black'
                          : 'border border-white/15 text-zinc-400'
                      }`}
                    >
                      {player.isReady && <Check className="w-3 h-3" />}
                      <span>{player.isReady ? 'Bereit' : 'Wartet'}</span>
                    </span>

                    {isHost && !isMe && (
                      <button
                        type="button"
                        onClick={() => onRemovePlayer(player.id)}
                        title="Aus dem Room entfernen"
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}

            {room.botCount > 0 && (
              <li className="px-5 py-3 flex items-center justify-between gap-3 bg-white/[0.015]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-zinc-300" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-200">
                      {room.botCount} KI-Bot{room.botCount === 1 ? '' : 's'} aktiv
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      Automatische Farben &amp; taktische Eroberungs-KI
                    </div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-zinc-300 shrink-0">
                  <Check className="w-3 h-3" />
                  <span>Bereit</span>
                </span>
              </li>
            )}
          </ul>
        </section>

        {/* Ready Bar */}
        <section className="space-y-3">
          {room.countdownSeconds !== null ? (
            <div className="rounded-2xl bg-white text-black px-5 py-4 flex items-center justify-between animate-pop-in">
              <div>
                <div className="text-sm font-bold">Alle Spieler sind bereit!</div>
                <div className="text-xs text-zinc-700">
                  Arena startet in {room.countdownSeconds}…
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleReady}
                className="text-xs font-semibold border border-black/25 rounded-lg px-3 py-1.5 hover:bg-black/10 transition-colors cursor-pointer"
              >
                Abbrechen
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onToggleReady}
              className={`w-full rounded-2xl py-4 px-5 text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                me?.isReady
                  ? 'border border-white/25 bg-white/[0.08] text-white hover:bg-white/[0.14]'
                  : 'bg-white text-black hover:bg-zinc-200'
              }`}
            >
              {me?.isReady ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Du bist bereit ({readyCount}/{humanCount})</span>
                </>
              ) : (
                <span>Bereit melden</span>
              )}
            </button>
          )}

          <p className="text-center text-xs text-zinc-500">
            {totalArenaEntities < 2
              ? 'Mindestens 2 Teilnehmer benötigt — lade Freunde ein oder füge einen Bot hinzu.'
              : `Bereit für ${totalArenaEntities} Teilnehmer (${humanCount} Spieler + ${room.botCount} Bots). Sobald alle bereit sind, startet der 3s-Countdown.`}
          </p>
        </section>
      </main>
    </div>
  );
}

