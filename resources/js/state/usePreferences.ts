import { useCallback, useEffect, useState } from 'react';

export interface Preferences {
    /** Background music while a game is in progress. On by default. */
    music: boolean;
    /** Short sound effects. On by default. */
    sound: boolean;
    reducedMotion: boolean;
}

// v2: sound effects became on by default. Settings saved under v1 stored "off" for players who never chose it, so they are not carried over.
const KEY = 'ct.preferences.v2';

function systemPrefersReducedMotion(): boolean {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

/** Reads the stored preferences. Storage may be blocked, so every access is guarded. */
export function loadPreferences(): Preferences {
    const defaults: Preferences = { music: true, sound: true, reducedMotion: systemPrefersReducedMotion() };

    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return defaults;

        const parsed = JSON.parse(raw) as Partial<Preferences>;

        return {
            music: typeof parsed.music === 'boolean' ? parsed.music : defaults.music,
            sound: typeof parsed.sound === 'boolean' ? parsed.sound : defaults.sound,
            reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : defaults.reducedMotion,
        };
    } catch {
        return defaults;
    }
}

/** Only non-secret display preferences are stored. Never put tokens or session data here. */
export function usePreferences() {
    const [preferences, setPreferences] = useState<Preferences>(loadPreferences);

    useEffect(() => {
        document.documentElement.dataset.reducedMotion = String(preferences.reducedMotion);

        try {
            window.localStorage.setItem(KEY, JSON.stringify(preferences));
        } catch {
            // Storage unavailable: the preference simply lasts for this visit.
        }
    }, [preferences]);

    const toggle = useCallback((key: keyof Preferences) => {
        setPreferences((current) => ({ ...current, [key]: !current[key] }));
    }, []);

    return { preferences, toggle };
}
