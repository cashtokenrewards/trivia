/** Background music sits well below the effects so the correct, wrong and tick sounds stay clear. */
export const MUSIC_VOLUME = 0.3;

/**
 * Loops one music file while a game is in progress. The file is only requested the first time it
 * is wanted. Browsers block audio before a tap, so a blocked `play()` is not an error: `nudge`
 * (called on the next tap or key press) tries again. Music is never needed to play the game.
 */
export class MusicPlayer {
    private audio: HTMLAudioElement | null = null;
    private wanted = false;

    constructor(
        private readonly url: string,
        private readonly create: () => HTMLAudioElement = () => new Audio(),
    ) {}

    get isWanted(): boolean {
        return this.wanted;
    }

    setPlaying(wanted: boolean): void {
        this.wanted = wanted;
        this.refresh();
    }

    /** Start straight away. Call it from the tap handler itself: iOS only accepts audio started there. */
    prime(): void {
        this.setPlaying(true);
    }

    /** Retry after a blocked start, from a later tap or key press. Does nothing if already playing. */
    nudge(): void {
        if (this.wanted && (this.audio === null || this.audio.paused)) {
            this.refresh();
        }
    }

    /** Apply the current wish: play when wanted and the page is visible, otherwise pause. */
    refresh(): void {
        const hidden = typeof document !== 'undefined' && document.hidden;

        if (!this.wanted || hidden) {
            this.audio?.pause();

            return;
        }

        try {
            const audio = this.ensure();

            if (!audio.paused) return;

            void audio.play()?.catch(() => {
                // Blocked until the player taps; nudge() tries again.
            });
        } catch {
            // No audio on this device: the game is fully playable without it.
        }
    }

    dispose(): void {
        try {
            this.audio?.pause();
        } catch {
            // Already gone.
        }

        this.audio = null;
    }

    private ensure(): HTMLAudioElement {
        if (!this.audio) {
            const audio = this.create();

            audio.src = this.url;
            audio.loop = true;
            audio.volume = MUSIC_VOLUME;
            audio.preload = 'auto';
            this.audio = audio;
        }

        return this.audio;
    }
}
