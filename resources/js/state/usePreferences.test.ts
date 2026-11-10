import { afterEach, describe, expect, it } from 'vitest';
import { loadPreferences } from './usePreferences';

const KEY = 'ct.preferences.v2';

afterEach(() => window.localStorage.clear());

describe('loadPreferences', () => {
    it('has music and sound effects on by default', () => {
        const preferences = loadPreferences();

        expect(preferences.music).toBe(true);
        expect(preferences.sound).toBe(true);
    });

    it('does not carry over an old "sound off" that the player never chose', () => {
        window.localStorage.setItem('ct.preferences.v1', JSON.stringify({ sound: false, reducedMotion: false }));

        expect(loadPreferences().sound).toBe(true);
    });

    it('keeps music on for a player whose saved settings pre-date the music option', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ sound: false, reducedMotion: true }));

        expect(loadPreferences()).toEqual({ music: true, sound: false, reducedMotion: true });
    });

    it('respects a saved choice to turn music or sound off', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ music: false, sound: false }));

        expect(loadPreferences()).toMatchObject({ music: false, sound: false });
    });

    it('ignores wrong types and broken storage', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ music: 'no', sound: 1 }));
        expect(loadPreferences()).toMatchObject({ music: true, sound: true });

        window.localStorage.setItem(KEY, '{not json');
        expect(loadPreferences()).toMatchObject({ music: true, sound: true });
    });
});
