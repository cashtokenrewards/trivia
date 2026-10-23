import type { SoundName } from './plan';

/**
 * Short effects synthesised with the Web Audio API, so there are no audio files to license or
 * download. Browsers only allow sound after a user gesture, so the context is created and
 * resumed from a tap or key press (`unlock`), and `play` stays silent until it is running.
 */
interface Note {
    /** Start frequency in Hz. */
    f: number;
    /** Seconds after the sound starts. */
    at: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    /** Slide to this frequency by the end of the note. */
    to?: number;
}

const SOUNDS: Record<SoundName, Note[]> = {
    tap: [{ f: 520, at: 0, dur: 0.07, type: 'triangle', gain: 0.18 }],
    open: [
        { f: 392, at: 0, dur: 0.12, type: 'triangle', gain: 0.2 },
        { f: 523, at: 0.08, dur: 0.12, type: 'triangle', gain: 0.2 },
        { f: 659, at: 0.16, dur: 0.22, type: 'triangle', gain: 0.22 },
    ],
    correct: [
        { f: 523, at: 0, dur: 0.12, type: 'triangle', gain: 0.22 },
        { f: 659, at: 0.1, dur: 0.12, type: 'triangle', gain: 0.22 },
        { f: 784, at: 0.2, dur: 0.28, type: 'triangle', gain: 0.24 },
    ],
    wrong: [{ f: 220, at: 0, dur: 0.32, type: 'sawtooth', gain: 0.14, to: 150 }],
    timeout: [
        { f: 330, at: 0, dur: 0.14, type: 'square', gain: 0.1 },
        { f: 262, at: 0.14, dur: 0.14, type: 'square', gain: 0.1 },
        { f: 196, at: 0.28, dur: 0.24, type: 'square', gain: 0.1 },
    ],
    coin: [
        { f: 988, at: 0, dur: 0.07, type: 'square', gain: 0.1 },
        { f: 1319, at: 0.07, dur: 0.18, type: 'square', gain: 0.1 },
    ],
    bonus: [
        { f: 784, at: 0, dur: 0.1, type: 'triangle', gain: 0.2 },
        { f: 988, at: 0.09, dur: 0.1, type: 'triangle', gain: 0.2 },
        { f: 1175, at: 0.18, dur: 0.1, type: 'triangle', gain: 0.2 },
        { f: 1568, at: 0.27, dur: 0.3, type: 'triangle', gain: 0.22 },
    ],
    tick: [{ f: 880, at: 0, dur: 0.04, type: 'square', gain: 0.07 }],
};

type AudioContextLike = typeof AudioContext;

export class SoundPlayer {
    private enabled = false;
    private context: AudioContext | null = null;

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    /** Create or resume the audio context. Must be called from a user gesture (tap or key press). */
    unlock(): void {
        try {
            if (!this.context) {
                const Context: AudioContextLike | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextLike }).webkitAudioContext;

                if (!Context) return;

                this.context = new Context();
            }

            if (this.context.state === 'suspended') {
                void this.context.resume();
            }
        } catch {
            // No audio on this device: the game is fully playable without it.
        }
    }

    play(name: SoundName): void {
        const context = this.context;

        if (!this.enabled || !context || context.state !== 'running') {
            return;
        }

        try {
            const start = context.currentTime;

            for (const note of SOUNDS[name]) {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                const from = start + note.at;
                const to = from + note.dur;

                oscillator.type = note.type ?? 'sine';
                oscillator.frequency.setValueAtTime(note.f, from);

                if (note.to) {
                    oscillator.frequency.exponentialRampToValueAtTime(note.to, to);
                }

                gain.gain.setValueAtTime(0.0001, from);
                gain.gain.exponentialRampToValueAtTime(note.gain ?? 0.15, from + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, to);

                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.start(from);
                oscillator.stop(to + 0.02);
            }
        } catch {
            // Ignore audio failures; they must never break the game.
        }
    }

    dispose(): void {
        try {
            void this.context?.close();
        } catch {
            // Already closed.
        }

        this.context = null;
    }
}
