import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ArenaScene } from '../arena/ArenaScene';
import { pickQuality, towerLevel } from '../arena/logic';
import { emptyTracker, planArenaSync, type SyncTracker } from '../arena/sync';
import { useArenaScene } from '../arena/useArenaScene';
import type { GameController } from '../state/useGame';
import type { BoxId } from '../types/api';

interface ArenaCanvasProps {
    game: GameController;
    reducedMotion: boolean;
}

/**
 * The 3D arena inside the real game. It is a view of the server snapshot, nothing more:
 * - a tap on a chest becomes exactly one `selectBox` action (one logical action, one key);
 * - everything else (opening the chest, outcomes, the coin stack) is driven from the snapshot;
 * - effects here only move the scene. They never start a session or submit an answer.
 */
export function ArenaCanvas({ game, reducedMotion }: ArenaCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { state } = game;
    const { snapshot, pending, ui } = state;
    const inFlight = pending !== null && state.error === null;

    const latest = useRef({ game, snapshot, inFlight });
    useEffect(() => {
        latest.current = { game, snapshot, inFlight };
    });

    const quality = useMemo(
        () => pickQuality({ cores: navigator.hardwareConcurrency, memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory }),
        [],
    );

    const onBoxSelected = useCallback((boxId: BoxId, scene: ArenaScene) => {
        const { game: controller, snapshot: current, inFlight: busy } = latest.current;
        const round = current?.round;

        // Ignore taps from an old round, or while a request is already running, and unlock the chest again.
        if (!round || round.status !== 'choosing' || busy) {
            scene.resetRound();

            return;
        }

        void controller.selectBox(boxId);
    }, []);

    // A lost graphics context keeps the same session: re-read the snapshot and carry on in 2D. Never a replay.
    const onContextLost = useCallback(() => {
        void latest.current.game.refresh();
    }, []);

    const { sceneRef, status } = useArenaScene({ canvasRef, quality, reducedMotion, onBoxSelected, onContextLost });

    const tracker = useRef<{ scene: ArenaScene | null; value: SyncTracker }>({ scene: null, value: emptyTracker() });

    // Keep the scene matching the snapshot. This only moves 3D objects; it sends nothing to the server.
    useEffect(() => {
        const scene = sceneRef.current;

        if (status !== 'ready' || !scene || !snapshot) return;

        if (tracker.current.scene !== scene) {
            tracker.current = { scene, value: emptyTracker() };
        }

        scene.setReducedMotion(reducedMotion);
        scene.setInputEnabled(ui === 'choosing' && !inFlight);

        const round = snapshot.round;
        const plan = planArenaSync({
            phase: snapshot.phase,
            round: round ? { id: round.round_id, status: round.status, selectedBoxId: round.selected_box_id, hasQuestion: round.question !== null } : null,
            lastResult: snapshot.last_result ? { roundId: snapshot.last_result.round_id, outcome: snapshot.last_result.outcome } : null,
            level: towerLevel(snapshot.score),
            pendingBox: pending?.kind === 'select' ? pending.boxId : null,
            scene: { selectedBoxId: scene.selectedBoxId, locked: scene.isLocked },
            tracker: tracker.current.value,
        });

        tracker.current.value = plan.tracker;

        for (const command of plan.commands) {
            switch (command.type) {
                case 'reset':
                    scene.resetRound();
                    break;
                case 'lock':
                    scene.lockSelection(command.boxId);
                    break;
                case 'reveal':
                    scene.revealBox(command.boxId);
                    break;
                case 'outcome':
                    scene.showConfirmedOutcome(command.outcome, command.level);
                    break;
                case 'tower':
                    scene.setTowerLevel(command.level);
                    break;
            }
        }
    }, [status, snapshot, pending, ui, inFlight, reducedMotion, sceneRef]);

    return (
        <section className="arena-frame arena-frame--game" data-fallback={status === 'fallback'} aria-label="3D arena">
            <canvas ref={canvasRef} className="arena-canvas" data-status={status} aria-hidden="true" />
            {status === 'loading' && <p className="arena-overlay">Loading 3D…</p>}
            {status === 'fallback' && (
                <p className="arena-overlay" role="status">
                    The 3D view is not available on this device. You can still play with the buttons.
                </p>
            )}
        </section>
    );
}
