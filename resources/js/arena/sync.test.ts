import { describe, expect, it } from 'vitest';
import { emptyTracker, planArenaSync, type SyncInput } from './sync';

const base = (over: Partial<SyncInput> = {}): SyncInput => ({
    phase: 'awaiting_round',
    round: null,
    lastResult: null,
    level: 0,
    pendingBox: null,
    scene: { selectedBoxId: null, locked: false },
    tracker: emptyTracker(),
    ...over,
});

const choosing = (id = 'r1') => ({ id, status: 'choosing' as const, selectedBoxId: null, hasQuestion: false });
const answering = (id = 'r1', box: 'quick_win' | 'steady' | 'high_roller' = 'steady') => ({ id, status: 'answering' as const, selectedBoxId: box, hasQuestion: true });
const types = (input: SyncInput) => planArenaSync(input).commands.map((c) => c.type);

describe('planArenaSync', () => {
    it('only keeps the tower level when nothing else changed', () => {
        expect(planArenaSync(base({ level: 0.3 })).commands).toEqual([{ type: 'tower', level: 0.3 }]);
    });

    it('prepares a fresh round without extra work when the scene is already idle', () => {
        expect(types(base({ phase: 'choosing', round: choosing() }))).toEqual(['tower']);
    });

    it('shows the choice immediately while the request is in flight', () => {
        const seen = { roundId: 'r1', revealed: null, outcome: null };
        const plan = planArenaSync(base({ phase: 'choosing', round: choosing(), pendingBox: 'steady', scene: { selectedBoxId: 'steady', locked: true }, tracker: seen }));

        expect(plan.commands.map((c) => c.type)).toEqual(['tower']); // already locked on the same chest by the tap
        expect(planArenaSync(base({ phase: 'choosing', round: choosing(), pendingBox: 'steady' })).commands[0]).toEqual({ type: 'lock', boxId: 'steady' });
    });

    it('lets the player choose again when the request was rejected (no pending, scene locked)', () => {
        const input = base({ phase: 'choosing', round: choosing(), scene: { selectedBoxId: 'steady', locked: true }, tracker: { roundId: 'r1', revealed: null, outcome: null } });

        expect(types(input)).toEqual(['reset', 'tower']);
    });

    it('opens the chest once the server issued the question, and only once', () => {
        const seen = { roundId: 'r1', revealed: null, outcome: null };
        const first = planArenaSync(base({ phase: 'answering', round: answering(), scene: { selectedBoxId: 'steady', locked: true }, tracker: seen }));

        expect(first.commands.map((c) => c.type)).toEqual(['reveal', 'tower']);
        expect(first.tracker.revealed).toBe('r1');

        const second = planArenaSync(base({ phase: 'answering', round: answering(), scene: { selectedBoxId: 'steady', locked: true }, tracker: first.tracker }));
        expect(second.commands.map((c) => c.type)).toEqual(['tower']);
    });

    it('server overrules the tap: the default Quick Win replaces a late or different choice', () => {
        const plan = planArenaSync(base({ phase: 'answering', round: answering('r1', 'quick_win'), scene: { selectedBoxId: 'high_roller', locked: true }, tracker: { roundId: 'r1', revealed: null, outcome: null } }));

        expect(plan.commands.slice(0, 3)).toEqual([{ type: 'reset' }, { type: 'lock', boxId: 'quick_win' }, { type: 'reveal', boxId: 'quick_win' }]);
    });

    it('rebuilds the chest state after a reload in the middle of a question', () => {
        const plan = planArenaSync(base({ phase: 'answering', round: answering('r2', 'high_roller'), level: 0.1 }));

        expect(plan.commands).toEqual([
            { type: 'lock', boxId: 'high_roller' },
            { type: 'reveal', boxId: 'high_roller' },
            { type: 'tower', level: 0.1 },
        ]);
    });

    it('acts out the confirmed outcome once between rounds and moves the stack', () => {
        const input = base({
            lastResult: { roundId: 'r1', outcome: 'correct' },
            level: 0.15,
            scene: { selectedBoxId: 'steady', locked: true },
            tracker: { roundId: 'r1', revealed: 'r1', outcome: null },
        });
        const plan = planArenaSync(input);

        expect(plan.commands).toEqual([{ type: 'outcome', outcome: 'correct', level: 0.15 }]);
        expect(planArenaSync({ ...input, tracker: plan.tracker }).commands).toEqual([{ type: 'tower', level: 0.15 }]);
    });

    it('closes the previous chest when the next round opens', () => {
        const plan = planArenaSync(
            base({ phase: 'choosing', round: choosing('r2'), scene: { selectedBoxId: 'steady', locked: true }, tracker: { roundId: 'r1', revealed: 'r1', outcome: 'r1' } }),
        );

        expect(plan.commands.map((c) => c.type)).toEqual(['reset', 'tower']);
        expect(plan.tracker.roundId).toBe('r2');
    });

    it('shows the final round outcome on a completed session', () => {
        const plan = planArenaSync(base({ phase: 'completed', lastResult: { roundId: 'r6', outcome: 'timeout' }, level: 0.5 }));

        expect(plan.commands).toEqual([{ type: 'outcome', outcome: 'timeout', level: 0.5 }]);
    });

    it('never mutates the tracker it was given', () => {
        const tracker = emptyTracker();
        planArenaSync(base({ phase: 'answering', round: answering(), tracker }));

        expect(tracker).toEqual(emptyTracker());
    });
});
