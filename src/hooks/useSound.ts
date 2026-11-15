import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'paper_sound_enabled';

export function useSound() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // ignore storage errors
    }
  }, [enabled]);

  const getContext = useCallback((): AudioContext | null => {
    if (!enabled || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctxRef.current) {
      ctxRef.current = new AudioCtx();
    }
    if (ctxRef.current.state === 'suspended') {
      void ctxRef.current.resume();
    }
    return ctxRef.current;
  }, [enabled]);

  const playTone = useCallback(
    (freq: number, duration: number, type: OscillatorType = 'sine', gainVal = 0.04) => {
      const ctx = getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    },
    [getContext]
  );

  const playTurnSound = useCallback(() => {
    playTone(320, 0.025, 'sine', 0.018);
  }, [playTone]);

  const playCaptureSound = useCallback(() => {
    playTone(440, 0.055, 'sine', 0.036);
    setTimeout(() => playTone(620, 0.085, 'sine', 0.04), 45);
  }, [playTone]);

  const playKillSound = useCallback(() => {
    playTone(540, 0.06, 'triangle', 0.045);
    setTimeout(() => playTone(810, 0.11, 'sine', 0.05), 55);
  }, [playTone]);

  const playDeathSound = useCallback(() => {
    playTone(210, 0.08, 'triangle', 0.05);
    setTimeout(() => playTone(135, 0.15, 'triangle', 0.05), 70);
  }, [playTone]);

  const playRespawnSound = useCallback(() => {
    playTone(460, 0.06, 'sine', 0.03);
    setTimeout(() => playTone(580, 0.08, 'sine', 0.032), 60);
  }, [playTone]);

  const playWinSound = useCallback(() => {
    playTone(523.25, 0.11, 'sine', 0.05);
    setTimeout(() => playTone(659.25, 0.11, 'sine', 0.05), 100);
    setTimeout(() => playTone(783.99, 0.2, 'sine', 0.06), 200);
  }, [playTone]);

  const toggleSound = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return {
    soundEnabled: enabled,
    toggleSound,
    playTurnSound,
    playCaptureSound,
    playKillSound,
    playDeathSound,
    playRespawnSound,
    playWinSound,
  };
}

