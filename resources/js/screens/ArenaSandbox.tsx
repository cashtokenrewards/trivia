import { useCallback, useEffect, useRef, useState } from 'react';
import type { Outcome, QualityProfile } from '../arena/ArenaScene';
import { BOX_LAYOUT, MAX_SCORE, towerLevel } from '../arena/logic';
import { useArenaScene } from '../arena/useArenaScene';
import { isDemoQuiet } from '../config';
import { usePreferences } from '../state/usePreferences';
import type { BoxId } from '../types/api';
import { SettingsButton, SettingsPage } from './Settings';

/**
 * Developer sandbox for the 3D arena (Prompt 12). Reachable only in demo-allowed builds with
 * ?arena=1. It drives the scene with SYNTHETIC events: it never creates a session, calls the
 * API or touches rewards. The real game wiring lives in components/ArenaCanvas.tsx (Prompt 13).
 */
export default function ArenaSandbox() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { preferences, toggle } = usePreferences();

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [simulateFailure, setSimulateFailure] = useState(false);
    const [quality, setQuality] = useState<QualityProfile>('medium');
    const [selected, setSelected] = useState<BoxId | null>(null);
    const [score, setScore] = useState(0);
    const [log, setLog] = useState<string[]>(['Waiting for the 3D scene…']);

    const addLog = useCallback((line: string) => setLog((lines) => [line, ...lines].slice(0, 6)), []);

    const recordSelect = useCallback(
        (id: BoxId, source: 'scene' | 'html') => {
            setSelected(id);
            addLog(`${source === 'scene' ? '3D tap' : 'HTML button'}: ${id} (synthetic, no session created)`);
        },
        [addLog],
    );

    const reducedMotion = preferences.reducedMotion;
    const { sceneRef, status, failReason } = useArenaScene({
        canvasRef,
        quality,
        reducedMotion,
        forceFailure: simulateFailure,
        onBoxSelected: (id) => recordSelect(id, 'scene'),
    });

    // The 3D tap already locked the scene. The 2D buttons must respect the same one-choice rule.
    const handleSelect = (id: BoxId, source: 'scene' | 'html') => {
        if (source === 'html' && sceneRef.current && !sceneRef.current.lockSelection(id)) return;

        recordSelect(id, source);
    };

    useEffect(() => sceneRef.current?.setQuality(quality), [quality, status, sceneRef]);
    useEffect(() => sceneRef.current?.setReducedMotion(reducedMotion), [reducedMotion, status, sceneRef]);

    const outcome = (kind: Outcome) => {
        const next = kind === 'correct' ? Math.min(MAX_SCORE, score + 300) : score;
        setScore(next);
        sceneRef.current?.showConfirmedOutcome(kind, towerLevel(next));
        addLog(`Confirmed outcome shown: ${kind} (synthetic). Score ${next}`);
    };

    return (
        <main className="screen arena" aria-label="Arena sandbox">
            {!isDemoQuiet() && (
                <div className="demo-banner" role="status">
                    <strong>ARENA SANDBOX</strong> Synthetic events only. No session is created and nothing is sent to the server.
                </div>
            )}

            <section className="arena-frame" aria-label="3D arena">
                <canvas key={String(simulateFailure)} ref={canvasRef} className="arena-canvas" data-status={status} aria-hidden="true" />
                {status === 'loading' && <p className="arena-overlay">Loading 3D…</p>}
                {status === 'fallback' && (
                    <p className="arena-overlay" role="status">
                        3D view unavailable{failReason ? ` (${failReason})` : ''}. The 2D boxes below still work.
                    </p>
                )}
            </section>

            <p className="selected-line" role="status" aria-live="polite">
                {selected ? (
                    <>
                        Selected: <strong>{BOX_LAYOUT.find((box) => box.id === selected)?.label}</strong>. Choice locked: press Reset round to choose again.
                    </>
                ) : (
                    'Tap a box in the 3D view (or use the buttons below).'
                )}
            </p>

            <div className="boxes-2d" role="group" aria-label="Choose a box (same as tapping a 3D box)">
                {BOX_LAYOUT.map((box) => (
                    <button
                        key={box.id}
                        className="btn"
                        data-selected={selected === box.id}
                        disabled={selected !== null}
                        onClick={() => handleSelect(box.id, 'html')}
                    >
                        {box.label}
                    </button>
                ))}
            </div>

            <div className="sandbox-controls">
                <button className="btn" disabled={!selected} onClick={() => selected && sceneRef.current?.revealBox(selected)}>
                    Reveal selected
                </button>
                <button className="btn" onClick={() => outcome('correct')}>
                    Correct (+300)
                </button>
                <button className="btn" onClick={() => outcome('wrong')}>
                    Wrong
                </button>
                <button className="btn" onClick={() => outcome('timeout')}>
                    Timeout
                </button>
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        sceneRef.current?.resetRound();
                        setSelected(null);
                        addLog('Round reset. Tap again.');
                    }}
                >
                    Reset round
                </button>
            </div>

            <div className="panel sandbox-settings">
                <label>
                    Quality{' '}
                    <select value={quality} onChange={(event) => setQuality(event.target.value as QualityProfile)}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                    </select>
                </label>
                <SettingsButton onClick={() => setSettingsOpen(true)} />
                {!isDemoQuiet() && (
                    <label>
                        <input type="checkbox" checked={simulateFailure} onChange={() => setSimulateFailure((value) => !value)} /> Simulate WebGL failure
                    </label>
                )}
            </div>

            <ul className="event-log" aria-live="polite" aria-label="Scene events">
                {log.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                ))}
            </ul>

            {settingsOpen && <SettingsPage preferences={preferences} onToggle={toggle} onClose={() => setSettingsOpen(false)} hide={['music', 'sound']} />}
        </main>
    );
}
