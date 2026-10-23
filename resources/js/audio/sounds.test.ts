import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
        const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };

        return { gain: param, connect() {} };
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
});

describe('SoundPlayer', () => {
    it('is silent until it has been unlocked by a user gesture', () => {
        const player = new SoundPlayer();
        player.setEnabled(true);
        player.play('correct');

        expect(created).toBe(0);
        expect(started).toBe(0);
    });

    it('plays every note of a sound once unlocked and enabled', () => {
        const player = new SoundPlayer();
        player.setEnabled(true);
        player.unlock();
        player.play('correct'); // three notes

        expect(started).toBe(3);

        player.play('tap'); // one note
        expect(started).toBe(4);
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
            player.play('open');
            player.dispose();
        }).not.toThrow();
    });
});
