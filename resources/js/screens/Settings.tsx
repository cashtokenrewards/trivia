import { useEffect, useRef } from 'react';
import type { Preferences } from '../state/usePreferences';

interface SettingRow {
    key: keyof Preferences;
    label: string;
    hint: string;
}

const ROWS: SettingRow[] = [
    { key: 'music', label: 'Music', hint: 'Background music while you play. It starts when your game starts.' },
    { key: 'sound', label: 'Sound effects', hint: 'Short sounds for taps, answers and the timer.' },
    { key: 'reducedMotion', label: 'Reduce motion', hint: 'Calmer animations. Until you change it, this follows your device setting.' },
];

interface SettingsPageProps {
    preferences: Preferences;
    onToggle: (key: keyof Preferences) => void;
    onClose: () => void;
    /** True while a game is running, so the page can say the clock does not stop. */
    inGame?: boolean;
    /** Settings that do not apply on this screen. */
    hide?: Array<keyof Preferences>;
}

/** A full-screen page over whatever is open. Closing it returns to the same place: nothing is reset or paused. */
export function SettingsPage({ preferences, onToggle, onClose, inGame = false, hide = [] }: SettingsPageProps) {
    const doneRef = useRef<HTMLButtonElement>(null);
    const closeRef = useRef(onClose);

    useEffect(() => {
        closeRef.current = onClose;
    });

    // Runs once: focus moves in on open and back to the opener on close, whatever the parent re-renders.
    useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeRef.current();
        };

        doneRef.current?.focus();
        window.addEventListener('keydown', onKey);

        return () => {
            window.removeEventListener('keydown', onKey);
            opener?.focus();
        };
    }, []);

    return (
        <div className="settings-page" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="settings-inner">
                <h2 id="settings-title">Settings</h2>
                {inGame && <p className="panel panel-warn">Your game keeps running while Settings is open. Close it as soon as you can.</p>}
                <ul className="settings-list">
                    {ROWS.filter((row) => !hide.includes(row.key)).map((row) => (
                        <li key={row.key}>
                            <label className="setting-row">
                                <span className="setting-text">
                                    <strong>{row.label}</strong>
                                    <span>{row.hint}</span>
                                </span>
                                <input type="checkbox" role="switch" checked={preferences[row.key]} onChange={() => onToggle(row.key)} />
                            </label>
                        </li>
                    ))}
                </ul>
                <div className="actions">
                    <button ref={doneRef} className="btn btn-primary btn-big" onClick={onClose}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}

/** Gear icon only. The label is for screen readers and the hover tooltip. */
export function SettingsButton({ onClick }: { onClick: () => void }) {
    return (
        <button className="icon-btn" onClick={onClick} aria-label="Settings" title="Settings">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
        </button>
    );
}
