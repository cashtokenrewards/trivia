import { afterEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_VOLUME, MusicPlayer } from './music';

function fakeAudio(options: { blocked?: boolean } = {}) {
    const audio = {
        src: '',
        loop: false,
        volume: 1,
        preload: '',
        paused: true,
        blocked: options.blocked ?? false,
        play: vi.fn(function (this: typeof audio) {
            if (this.blocked) return Promise.reject(new Error('NotAllowedError'));
            this.paused = false;

            return Promise.resolve();
        }),
        pause: vi.fn(function (this: typeof audio) {
            this.paused = true;
        }),
    };

    return audio;
}

function setHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

afterEach(() => setHidden(false));

describe('MusicPlayer', () => {
    it('does not request the file until music is wanted', () => {
        const create = vi.fn(() => fakeAudio() as unknown as HTMLAudioElement);
        const player = new MusicPlayer('/music.mp3', create);

        player.setPlaying(false);

        expect(create).not.toHaveBeenCalled();
    });

    it('plays the file on a loop at the music volume once wanted', () => {
        const audio = fakeAudio();
        const player = new MusicPlayer('/music.mp3', () => audio as unknown as HTMLAudioElement);

        player.setPlaying(true);

        expect(audio.src).toBe('/music.mp3');
        expect(audio.loop).toBe(true);
        expect(audio.volume).toBe(MUSIC_VOLUME);
        expect(audio.play).toHaveBeenCalledTimes(1);
    });

    it('pauses when no longer wanted and resumes when wanted again', () => {
        const audio = fakeAudio();
        const player = new MusicPlayer('/music.mp3', () => audio as unknown as HTMLAudioElement);

        player.setPlaying(true);
        player.setPlaying(false);
        expect(audio.paused).toBe(true);

        player.setPlaying(true);
        expect(audio.paused).toBe(false);
    });

    it('does not start a second play while already playing', () => {
        const audio = fakeAudio();
        const player = new MusicPlayer('/music.mp3', () => audio as unknown as HTMLAudioElement);

        player.setPlaying(true);
        player.nudge();
        player.refresh();

        expect(audio.play).toHaveBeenCalledTimes(1);
    });

    it('pauses while the page is hidden and resumes when it is visible again', () => {
        const audio = fakeAudio();
        const player = new MusicPlayer('/music.mp3', () => audio as unknown as HTMLAudioElement);

        player.setPlaying(true);
        setHidden(true);
        player.refresh();
        expect(audio.paused).toBe(true);

        setHidden(false);
        player.refresh();
        expect(audio.paused).toBe(false);
    });

    it('treats a blocked start as normal and retries on nudge', async () => {
        const audio = fakeAudio({ blocked: true });
        const player = new MusicPlayer('/music.mp3', () => audio as unknown as HTMLAudioElement);

        player.setPlaying(true);
        await Promise.resolve();
        expect(audio.paused).toBe(true);

        audio.blocked = false;
        player.nudge();
        expect(audio.paused).toBe(false);
        expect(audio.play).toHaveBeenCalledTimes(2);
    });

    it('never throws when audio cannot be created', () => {
        const player = new MusicPlayer('/music.mp3', () => {
            throw new Error('no audio');
        });

        expect(() => player.setPlaying(true)).not.toThrow();
        expect(() => player.dispose()).not.toThrow();
    });

    it('does nothing on nudge when music is not wanted', () => {
        const audio = fakeAudio();
        const player = new MusicPlayer('/music.mp3', () => audio as unknown as HTMLAudioElement);

        player.nudge();

        expect(audio.play).not.toHaveBeenCalled();
    });
});
