import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundPlayer } from './sounds';

let started = 0;
let created = 0;

class FakeContext {
    state: 'suspended' | 'running' = 'suspended';
    currentTime = 0;
    destination = {};

    constructor() {
        created += 1;
    }

    resume() {
        this.state = 'running';

        return Promise.resolve();
    }

    close() {
        return Promise.resolve();
    }

    createGain() {
        const param = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} };

        return { gain: param, connect() {} };
    }

    createBiquadFilter() {
        return { type: 'lowpass', frequency: { value: 0 }, connect() {} };
    }

    createOscillator() {
        return {
            type: 'sine',
            frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
            connect() {},
            start() {
                started += 1;
            },
            stop() {},
        };
    }

    createBufferSource() {
        return {
            buffer: null,
            connect() {},
            start() {
            },
        };
    }

    decodeAudioData() {
        return Promise.resolve({ decoded: true });
    }
}

const win = window as unknown as { AudioContext?: unknown };
let original: unknown;

beforeEach(() => {
    started = 0;
    created = 0;
    original = win.AudioContext;
    win.AudioContext = FakeContext;
});

afterEach(() => {
    win.AudioContext = original;
    vi.unstubAllGlobals();
});

describe('SoundPlayer', () => {
    it('is silent until it has been unlocked by a user gesture', () => {
        const player = new SoundPlayer();
        player.setEnabled(true);
        player.play('correct');

        expect(created).toBe(0);
        expect(started).toBe(0);
    });

    it('plays a sound once unlocked and enabled, and a richer one layers more voices', () => {
        const player = new SoundPlayer();
        player.setEnabled(true);
        player.unlock();

        player.play('coin'); // two plain notes
        expect(started).toBe(2);

        player.play('correct'); // five notes, most with a bell-like harmonic on top
        expect(started - 2).toBeGreaterThan(5);
    });

    it('plays the wrong-answer sound through a softening filter without error', () => {
        const player = new SoundPlayer();
        player.setEnabled(true);
        player.unlock();

        expect(() => player.play('wrong')).not.toThrow();
        expect(started).toBe(3);
    });

    it('is muted when sound is turned off, even after unlocking', () => {
        const player = new SoundPlayer();
        player.unlock();
        player.setEnabled(false);
        player.play('bonus');

        expect(started).toBe(0);

        player.setEnabled(true);
        player.play('bonus');
        expect(started).toBe(4);
    });

    it('reuses one audio context across unlocks', () => {
        const player = new SoundPlayer();
        player.unlock();
        player.unlock();

        expect(created).toBe(1);
    });

    it('never throws when the browser has no audio support', () => {
        win.AudioContext = undefined;
        const player = new SoundPlayer();
        player.setEnabled(true);

        expect(() => {
            player.unlock();
            player.play('pick');
            player.dispose();
        }).not.toThrow();
    });
});

describe('SoundPlayer with an audio file', () => {
    function fakeClip(options: { blocked?: boolean } = {}) {
        return {
            src: '',
            preload: '',
            volume: 1,
            currentTime: 5,
            load: vi.fn(),
            pause: vi.fn(),
            play: vi.fn(() => (options.blocked ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve())),
        };
    }

    it('plays the file from the start, and not the built-in sound', () => {
        const clip = fakeClip();
        const player = new SoundPlayer({ pick: '/treasure.mp3' }, () => clip as unknown as HTMLAudioElement);
        player.setEnabled(true);
        player.unlock();

        player.play('pick');

        expect(clip.src).toBe('/treasure.mp3');
        expect(clip.load).toHaveBeenCalledTimes(1);
        expect(clip.currentTime).toBe(0);
        expect(clip.play).toHaveBeenCalledTimes(1);
        expect(started).toBe(0);
    });

    it('replays the file on every tap and loads it only once', () => {
        const clip = fakeClip();
        const player = new SoundPlayer({ pick: '/treasure.mp3' }, () => clip as unknown as HTMLAudioElement);
        player.setEnabled(true);
        player.unlock();
        player.unlock();
        player.play('pick');
        player.play('pick');

        expect(clip.load).toHaveBeenCalledTimes(1);
        expect(clip.play).toHaveBeenCalledTimes(2);
    });

    it('is silent when sound is off', () => {
        const clip = fakeClip();
        const player = new SoundPlayer({ pick: '/treasure.mp3' }, () => clip as unknown as HTMLAudioElement);
        player.unlock();
        player.play('pick');

        expect(clip.play).not.toHaveBeenCalled();
    });

    it('falls back to the built-in sound if the browser refuses the file', async () => {
        const clip = fakeClip({ blocked: true });
        const player = new SoundPlayer({ pick: '/treasure.mp3' }, () => clip as unknown as HTMLAudioElement);
        player.setEnabled(true);
        player.unlock();

        player.play('pick');

        await vi.waitFor(() => expect(started).toBeGreaterThan(0));
    });

    it('uses the built-in sound for sounds that have no file', () => {
        const player = new SoundPlayer({ pick: '/treasure.mp3' }, () => fakeClip() as unknown as HTMLAudioElement);
        player.setEnabled(true);
        player.unlock();

        player.play('coin');

        expect(started).toBe(2);
    });
});
