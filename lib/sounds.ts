'use client';

/**
 * Tiny Web Audio synthesiser for celebration sound effects.
 *
 * No audio files — we generate everything on the fly with oscillators so the
 * sounds ship inside the JS bundle with zero network cost and no CORS grief.
 *
 * Browser autoplay policies block audio until the user has interacted with
 * the page. On a TV kiosk left running, that means the first couple of
 * celebrations may be silent until someone presses a key or clicks — after
 * that, everything works. Pressing "c" to trigger manually also unlocks it.
 */

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

/** Best-effort unlock — call on user gesture. */
export function unlockAudio() {
  const ac = ctx();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume().catch(() => {});
}

interface ToneOpts {
  freq:      number;
  duration:  number;
  startAt?:  number;                // seconds from "now"
  volume?:   number;                // 0..1
  type?:     OscillatorType;        // sine / triangle / square / sawtooth
}

function tone({ freq, duration, startAt = 0, volume = 0.25, type = 'sine' }: ToneOpts) {
  const ac = ctx();
  if (!ac) return;
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.type            = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ac.destination);
  const t0 = ac.currentTime + startAt;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);                      // quick attack
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);              // decay
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Big ascending fanfare — played when the takeover opens. */
export function playFanfare() {
  unlockAudio();
  // Major triad arpeggio up into C6 — classic "tada!"
  tone({ freq: 523,  duration: 0.18, startAt: 0.00, volume: 0.25, type: 'triangle' }); // C5
  tone({ freq: 659,  duration: 0.18, startAt: 0.09, volume: 0.25, type: 'triangle' }); // E5
  tone({ freq: 784,  duration: 0.18, startAt: 0.18, volume: 0.25, type: 'triangle' }); // G5
  tone({ freq: 1047, duration: 0.55, startAt: 0.27, volume: 0.30, type: 'triangle' }); // C6 held
  // Sparkle on top
  tone({ freq: 1568, duration: 0.30, startAt: 0.35, volume: 0.15, type: 'sine'    }); // G6
  tone({ freq: 2093, duration: 0.25, startAt: 0.45, volume: 0.12, type: 'sine'    }); // C7
}

/** Short bell chime — played when a new agent slide appears. */
export function playSlideChime() {
  unlockAudio();
  tone({ freq: 1047, duration: 0.30, volume: 0.22, type: 'sine' });          // C6 bell
  tone({ freq: 1319, duration: 0.25, startAt: 0.03, volume: 0.18, type: 'sine' }); // E6
}

/** Comedy trombone "womp womp" — played for joke slides (e.g. Hugo). */
export function playWompWomp() {
  unlockAudio();
  // Four descending notes
  tone({ freq: 392, duration: 0.22, startAt: 0.00, volume: 0.30, type: 'sawtooth' }); // G4
  tone({ freq: 370, duration: 0.22, startAt: 0.22, volume: 0.30, type: 'sawtooth' }); // F#4
  tone({ freq: 349, duration: 0.22, startAt: 0.44, volume: 0.30, type: 'sawtooth' }); // F4
  tone({ freq: 330, duration: 0.55, startAt: 0.66, volume: 0.35, type: 'sawtooth' }); // E4 drop
}
