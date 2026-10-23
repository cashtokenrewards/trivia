import { useCallback, useEffect, useState } from 'react';

export interface Preferences {
    sound: boolean;
    reducedMotion: boolean;
}

const KEY = 'ct.preferences.v1';

function systemPrefersReducedMotion(): boolean {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

/** Reads the stored preferences. Storage may be blocked, so every access is guarded. */
export function loadPreferences(): Preferences {
    const defaults: Preferences = { sound: false, reducedMotion: systemPrefersReducedMotion() };

    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return defaults;

        const parsed = JSON.parse(raw) as Partial<Preferences>;

        return {
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
