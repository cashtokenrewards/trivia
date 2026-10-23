import { useEffect, useState, type ReactNode } from 'react';
import { fetchHealth, type BackendState } from '../lib/health';
import type { Preferences } from '../state/usePreferences';

export function DemoBanner({ paused, onTogglePause }: { paused: boolean; onTogglePause: () => void }) {
    return (
        <div className="demo-banner">
            <span>
                <strong>DEMO MODE</strong> Made-up questions played in your browser. Nothing is saved, secure or rewarded.
            </span>
            <label className="pause-toggle">
                <input type="checkbox" checked={paused} onChange={onTogglePause} /> Pause timers
            </label>
        </div>
    );
}

export function Screen({ children, label }: { children: ReactNode; label: string }) {
    return (
        <main className="screen" aria-label={label}>
            {children}
        </main>
    );
}

export function Loading({ message }: { message: string }) {
    return (
        <Screen label="Loading">
            <div className="center-stack" role="status" aria-live="polite">
                <div className="spinner" aria-hidden="true" />
                <p>{message}</p>
            </div>
        </Screen>
    );
}

export function ServerStatus() {
    const [backend, setBackend] = useState<BackendState>('checking');

    useEffect(() => {
        const controller = new AbortController();

        fetchHealth(controller.signal)
            .then(() => setBackend('online'))
            .catch((error: unknown) => {
                if ((error as Error).name !== 'AbortError') setBackend('offline');
            });

        return () => controller.abort();
    }, []);

    return (
        <span className="status" data-state={backend}>
            {backend === 'checking' && 'Checking server…'}
            {backend === 'online' && 'Server online'}
            {backend === 'offline' && 'Server unreachable'}
        </span>
    );
}

export function PreferenceToggles({ preferences, onToggle }: { preferences: Preferences; onToggle: (key: keyof Preferences) => void }) {
    return (
        <div className="prefs" role="group" aria-label="Display preferences">
            <label>
                <input type="checkbox" checked={preferences.sound} onChange={() => onToggle('sound')} /> Sound
            </label>
            <label>
                <input type="checkbox" checked={preferences.reducedMotion} onChange={() => onToggle('reducedMotion')} /> Reduce motion
            </label>
        </div>
    );
}
