import type { BoxId, Phase, RoundOutcome, RoundStatus } from '../types/api';

/**
 * Decides what the 3D scene should do so it always matches the server's snapshot. Pure: no
 * Babylon, no React. The snapshot is the single source of truth; the scene only ever acts out
 * what the server has confirmed (plus an instant local reaction to the player's own tap).
 */

export interface SyncTracker {
    /** Round the scene was last prepared for. */
    roundId: string | null;
    /** Round whose chest has already been opened. */
    revealed: string | null;
    /** Round whose confirmed outcome has already been shown. */
    outcome: string | null;
}

export const emptyTracker = (): SyncTracker => ({ roundId: null, revealed: null, outcome: null });

export interface SyncInput {
    phase: Phase;
    round: { id: string; status: RoundStatus; selectedBoxId: BoxId | null; hasQuestion: boolean } | null;
    lastResult: { roundId: string; outcome: RoundOutcome } | null;
    /** 0..1 coin-stack level for the confirmed score. */
    level: number;
    /** A box choice request currently in flight (so the scene should already show it as chosen). */
    pendingBox: BoxId | null;
    scene: { selectedBoxId: BoxId | null; locked: boolean };
    tracker: SyncTracker;
}

export type SyncCommand =
    | { type: 'reset' }
    | { type: 'lock'; boxId: BoxId }
    | { type: 'reveal'; boxId: BoxId }
    | { type: 'outcome'; outcome: RoundOutcome; level: number }
    | { type: 'tower'; level: number };

export function planArenaSync(input: SyncInput): { commands: SyncCommand[]; tracker: SyncTracker } {
    const commands: SyncCommand[] = [];
    const tracker = { ...input.tracker };
    const { round } = input;

    // Local picture of the scene, updated as commands are queued.
    let selected = input.scene.selectedBoxId;
    let locked = input.scene.locked;

    const reset = () => {
        commands.push({ type: 'reset' });
        selected = null;
        locked = false;
    };
    const lock = (boxId: BoxId) => {
        if (locked && selected === boxId) return;

        if (locked) reset();

        commands.push({ type: 'lock', boxId });
        locked = true;
        selected = boxId;
    };

    // A new round clears the previous round's chest.
    if (round && round.id !== tracker.roundId) {
        tracker.roundId = round.id;

        if (locked) reset();
    }

    if (round?.selectedBoxId) {
        // The server has accepted a box (or applied the default). It overrules whatever was tapped.
        lock(round.selectedBoxId);

        if (round.hasQuestion && tracker.revealed !== round.id) {
            commands.push({ type: 'reveal', boxId: round.selectedBoxId });
            tracker.revealed = round.id;
        }
    } else if (round?.status === 'choosing') {
        if (input.pendingBox) {
            lock(input.pendingBox); // the request is in flight: show the choice immediately
        } else if (locked) {
            reset(); // the choice was rejected or lost: let the player pick again
        }
    }

    // Between rounds the server confirms how the last one went.
    if (!round && input.lastResult && tracker.outcome !== input.lastResult.roundId) {
        commands.push({ type: 'outcome', outcome: input.lastResult.outcome, level: input.level });
        tracker.outcome = input.lastResult.roundId;
    } else {
        commands.push({ type: 'tower', level: input.level });
    }

    return { commands, tracker };
}
