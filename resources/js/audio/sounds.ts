import type { SoundName } from './plan';

/**
 * Sound effects. Most are synthesised with the Web Audio API (no files to license or download);
 * a sound can also be backed by a short audio file (`samples`), which is decoded once and used
 * instead, with the synthesised version as the fallback until it is ready. Browsers only allow
 * sound after a user gesture, so the context is created and resumed from a tap or key press
 * (`unlock`), and `play` stays silent until it is running.
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
    /** Extra sine partials as [frequency multiple, relative gain]. They make a plain tone sound like a bell. */
    harmonics?: Array<[number, number]>;
    /** Low-pass cutoff in Hz, to soften a harsh waveform. */
    lowpass?: number;
}

const SOUNDS: Record<SoundName, Note[]> = {
    // Stand-in for the treasure sample until it has loaded (or if it cannot).
    pick: [
        { f: 392, at: 0, dur: 0.12, type: 'triangle', gain: 0.2 },
        { f: 523, at: 0.08, dur: 0.18, type: 'triangle', gain: 0.22 },
    ],
    // Bright rising chime with a sparkle on top.
    correct: [
        { f: 523, at: 0, dur: 0.16, type: 'triangle', gain: 0.2, harmonics: [[2, 0.3]] },
        { f: 659, at: 0.09, dur: 0.16, type: 'triangle', gain: 0.2, harmonics: [[2, 0.3]] },
        { f: 784, at: 0.18, dur: 0.18, type: 'triangle', gain: 0.22, harmonics: [[2, 0.3]] },
        { f: 1047, at: 0.27, dur: 0.5, type: 'triangle', gain: 0.26, harmonics: [[2, 0.35], [3, 0.15]] },
        { f: 2093, at: 0.3, dur: 0.3, type: 'sine', gain: 0.06 },
    ],
    // A soft downward "bwomp": clearly a miss, but not harsh.
    wrong: [
        { f: 233, at: 0, dur: 0.2, type: 'sawtooth', gain: 0.15, lowpass: 700 },
        { f: 196, at: 0.17, dur: 0.45, type: 'sawtooth', gain: 0.17, to: 131, lowpass: 600 },
        { f: 98, at: 0.17, dur: 0.45, type: 'sine', gain: 0.2, to: 65 },
    ],
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

/** Volume of a sound that comes from a file. */
const SAMPLE_GAIN = 0.9;

type AudioContextLike = typeof AudioContext;

export type SoundSamples = Partial<Record<SoundName, string>>;

export class SoundPlayer {
    private enabled = false;
    private context: AudioContext | null = null;
    private readonly clips = new Map<SoundName, HTMLAudioElement>();

    constructor(
        private readonly samples: SoundSamples = {},
        private readonly createAudio: () => HTMLAudioElement = () => new Audio(),
    ) {}

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    /** Create or resume the audio context. Must be called from a user gesture (tap or key press). */
    unlock(): void {
        this.prepareClips();

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

    /**
     * Sound files are plain audio elements: the browser downloads them on its own (no decoding or
     * cross-origin fetch of ours that could fail unseen). Done once, at the first tap.
     */
    private prepareClips(): void {
        if (this.clips.size > 0) return;

        for (const [name, url] of Object.entries(this.samples) as Array<[SoundName, string]>) {
            try {
                const clip = this.createAudio();

                clip.src = url;
                clip.preload = 'auto';
                clip.volume = SAMPLE_GAIN;
                clip.load();
                this.clips.set(name, clip);
            } catch {
                // No file sound: the built-in one is used.
            }
        }
    }

    /** Play the file for this sound. Returns false when there is none, or the browser refused it. */
    private playClip(name: SoundName): boolean {
        const clip = this.clips.get(name);

        if (!clip) return false;

        try {
            clip.currentTime = 0;
            void clip.play()?.catch(() => this.playSynth(name));

            return true;
        } catch {
            return false;
        }
    }

    play(name: SoundName): void {
        if (!this.enabled) return;

        if (this.playClip(name)) return;

        this.playSynth(name);
    }

    private playSynth(name: SoundName): void {
        const context = this.context;

        if (!this.enabled || !context || context.state !== 'running') {
            return;
        }

        try {
            const start = context.currentTime;

            for (const note of SOUNDS[name]) {
                const from = start + note.at;
                const to = from + note.dur;
                const voices: Array<[number, number]> = [[1, 1], ...(note.harmonics ?? [])];

                for (const [multiple, relative] of voices) {
                    const oscillator = context.createOscillator();
                    const gain = context.createGain();
                    const peak = (note.gain ?? 0.15) * relative;

                    oscillator.type = multiple === 1 ? (note.type ?? 'sine') : 'sine';
                    oscillator.frequency.setValueAtTime(note.f * multiple, from);

                    if (note.to) {
                        oscillator.frequency.exponentialRampToValueAtTime(note.to * multiple, to);
                    }

                    gain.gain.setValueAtTime(0.0001, from);
                    gain.gain.exponentialRampToValueAtTime(peak, from + 0.01);
                    gain.gain.exponentialRampToValueAtTime(0.0001, to);

                    if (note.lowpass) {
                        const filter = context.createBiquadFilter();

                        filter.type = 'lowpass';
                        filter.frequency.value = note.lowpass;
                        oscillator.connect(filter);
                        filter.connect(gain);
                    } else {
                        oscillator.connect(gain);
                    }

                    gain.connect(context.destination);
                    oscillator.start(from);
                    oscillator.stop(to + 0.02);
                }
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
        for (const clip of this.clips.values()) clip.pause();

        this.clips.clear();
    }
}
