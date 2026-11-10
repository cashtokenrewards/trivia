import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import type { BoxId, Snapshot } from '../types/api';
import { DemoServer } from './demoServer';
import { DEMO_QUESTIONS } from './questions';

/** Small seeded generator so every test is repeatable. */
function seeded(seed: number) {
    let a = seed >>> 0;

    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A clock the test moves by hand, so deadlines are exact and nothing depends on real time. */
function fakeClock(start = Date.UTC(2026, 9, 19, 10, 0, 0)) {
    const clock = {
        t: start,
        now: () => clock.t,
        advance(ms: number) {
            clock.t += ms;
        },
    };

    return clock;
}

const server = (mode: 'practice' | 'competitive' = 'competitive', seed = 1, clock = fakeClock()) => new DemoServer(mode, seeded(seed), 1, { clock });

/** Finds the demo question for the snapshot's active question so a test can pick the right or a wrong option. */
function optionFor(snapshot: Snapshot, wantCorrect: boolean): string {
    const issued = snapshot.round!.question!;
    const question = DEMO_QUESTIONS.find((candidate) => candidate.text === issued.text)!;
    const removed = new Set(issued.removed_option_ids);
    const option = issued.options.find((o) => !removed.has(o.option_id) && (o.text === question.correct) === wantCorrect)!;

    return option.option_id;
}

/** Plays one whole round and returns the resulting snapshot. */
function play(s: DemoServer, box: BoxId, correct: boolean): Snapshot {
    const opened = s.openRound(s.stateVersion);
    const picked = s.selectBox(opened.round!.round_id, box, s.stateVersion);

    return s.answer(picked.round!.round_id, optionFor(picked, correct), s.stateVersion);
}

const code = (fn: () => unknown) => {
    try {
        fn();
    } catch (error) {
        return error instanceof ApiError ? error.code : 'not-an-api-error';
    }

    return 'no-error';
};

describe('DemoServer: the choice is honoured', () => {
    it.each([
        ['quick_win', 'easy'],
        ['steady', 'medium'],
        ['high_roller', 'hard'],
    ] as const)('picking %s issues an %s question', (box, difficulty) => {
        const s = server();
        const opened = s.openRound(1);
        const picked = s.selectBox(opened.round!.round_id, box, 2);

        expect(picked.phase).toBe('answering');
        expect(picked.round!.selected_box_id).toBe(box);
        expect(picked.round!.question!.difficulty).toBe(difficulty);
        expect(picked.round!.question!.options).toHaveLength(4);
    });

    it('starts awaiting a round with the lifeline available', () => {
        const snapshot = server().snapshot();

        expect(snapshot).toMatchObject({ status: 'active', phase: 'awaiting_round', state_version: 1, lifeline_available: true, score: 0, round: null });
    });

    it('opens a round with three boxes and a choice deadline', () => {
        const snapshot = server().openRound(1);

        expect(snapshot.phase).toBe('choosing');
        expect(snapshot.round!.boxes!.map((b) => b.box_id)).toEqual(['quick_win', 'steady', 'high_roller']);
        expect(snapshot.phase_deadline).not.toBeNull();
    });

    it('never puts the answer, a correctness flag or an explanation in an active payload', () => {
        const s = server();
        const opened = s.openRound(1);
        const picked = s.selectBox(opened.round!.round_id, 'steady', 2);
        const text = JSON.stringify(picked.round);

        expect(text).not.toContain('correct');
        expect(text).not.toContain('explanation');
        expect(picked.last_result).toBeNull();
    });

    it('option ids reveal nothing: the right answer lands in different positions across games', () => {
        const positions = new Set<number>();

        for (let seed = 1; seed <= 30; seed += 1) {
            const s = server('practice', seed);
            const opened = s.openRound(1);
            const picked = s.selectBox(opened.round!.round_id, 'steady', 2);
            const correctId = optionFor(picked, true);
            positions.add(picked.round!.question!.options.findIndex((o) => o.option_id === correctId));
        }

        expect(positions.size).toBeGreaterThan(1);
    });
});

describe('DemoServer: scoring', () => {
    it('awards 100, 200 and 300 for correct easy, medium and hard answers and 0 for a wrong one', () => {
        expect(play(server('competitive', 1), 'quick_win', true).last_result).toMatchObject({ outcome: 'correct', points_awarded: 100 });
        expect(play(server('competitive', 2), 'steady', true).last_result).toMatchObject({ outcome: 'correct', points_awarded: 200 });
        expect(play(server('competitive', 3), 'high_roller', true).last_result).toMatchObject({ outcome: 'correct', points_awarded: 300 });

        const wrong = play(server('competitive', 4), 'high_roller', false);
        expect(wrong.last_result).toMatchObject({ outcome: 'wrong', points_awarded: 0, score_after: 0 });
        expect(wrong.score).toBe(0);
    });

    it('reveals the correct option and explanation only after the round resolved', () => {
        const done = play(server(), 'steady', false);

        expect(done.round).toBeNull();
        expect(done.last_result!.correct_option_id).toMatch(/^demo_opt_/);
        expect(done.last_result!.explanation.length).toBeGreaterThan(5);
    });

    it('gives +100 on every third consecutive correct answer', () => {
        const s = server();
        const results = [play(s, 'quick_win', true), play(s, 'quick_win', true), play(s, 'quick_win', true)];

        expect(results.map((r) => r.last_result!.streak_bonus)).toEqual([0, 0, 100]);
        expect(results[2]!.last_result!.points_awarded).toBe(200);
        expect(results[2]!.score).toBe(400);
        expect(results[2]!.streak).toBe(0); // the counter resets after a bonus
        expect(results[2]!.bonuses_awarded).toBe(1);
    });

    it('a wrong answer resets the streak', () => {
        const s = server();
        play(s, 'quick_win', true);
        play(s, 'quick_win', true);
        const afterWrong = play(s, 'quick_win', false);

        expect(afterWrong.streak).toBe(0);
        expect(play(s, 'quick_win', true).last_result!.streak_bonus).toBe(0);
    });

    it('six correct hard answers score the 2,000 maximum with exactly two bonuses', () => {
        const s = server();
        let last!: Snapshot;

        for (let i = 0; i < 6; i += 1) last = play(s, 'high_roller', true);

        expect(last.score).toBe(2000);
        expect(last.bonuses_awarded).toBe(2);
        expect(last.result!.final_score).toBe(2000);
        expect(last.result!.rewards).toMatchObject({ qualification: 'qualified', participation: 'pending', premium: 'pending' });
    });

    it('never repeats a question within a session', () => {
        const s = server();
        const seen = new Set<string>();

        for (let i = 0; i < 6; i += 1) {
            const opened = s.openRound(s.stateVersion);
            const picked = s.selectBox(opened.round!.round_id, 'high_roller', s.stateVersion);
            seen.add(picked.round!.question!.question_id);
            s.answer(picked.round!.round_id, optionFor(picked, true), s.stateVersion);
        }

        expect(seen.size).toBe(6);
    });
});

describe('DemoServer: lifeline', () => {
    it('removes exactly one wrong option, once, and the clock is not touched', () => {
        const s = server();
        const opened = s.openRound(1);
        const picked = s.selectBox(opened.round!.round_id, 'high_roller', 2);
        const used = s.lifeline(picked.round!.round_id, 3);

        expect(used.lifeline_available).toBe(false);
        expect(used.round!.question!.removed_option_ids).toHaveLength(1);
        expect(used.round!.question!.removed_option_ids[0]).not.toBe(optionFor(picked, true));
        expect(used.phase_deadline).toBe(used.round!.answer_deadline);
        expect(code(() => s.lifeline(picked.round!.round_id, 4))).toBe('invalid_phase');
    });

    it('a removed option can no longer be answered', () => {
        const s = server();
        const opened = s.openRound(1);
        const picked = s.selectBox(opened.round!.round_id, 'steady', 2);
        const used = s.lifeline(picked.round!.round_id, 3);
        const removed = used.round!.question!.removed_option_ids[0]!;

        expect(code(() => s.answer(picked.round!.round_id, removed, 4))).toBe('option_not_in_round');
    });

    it('stays used for the rest of the session', () => {
        const s = server();
        const opened = s.openRound(1);
        const picked = s.selectBox(opened.round!.round_id, 'steady', 2);
        s.lifeline(picked.round!.round_id, 3);
        s.answer(picked.round!.round_id, optionFor(s.snapshot(), true), 4);
        const next = s.openRound(s.stateVersion);
        const second = s.selectBox(next.round!.round_id, 'steady', s.stateVersion);

        expect(second.lifeline_available).toBe(false);
        expect(code(() => s.lifeline(second.round!.round_id, s.stateVersion))).toBe('invalid_phase');
    });
});

describe('DemoServer: state rules', () => {
    it('increments state_version by exactly one per change, and once more when the session is finalised', () => {
        const s = server();
        const versions = [s.stateVersion];

        for (let i = 0; i < 6; i += 1) {
            const opened = s.openRound(s.stateVersion);
            versions.push(s.stateVersion);
            const picked = s.selectBox(opened.round!.round_id, 'quick_win', s.stateVersion);
            versions.push(s.stateVersion);
            s.answer(picked.round!.round_id, optionFor(picked, true), s.stateVersion);
            versions.push(s.stateVersion);
        }

        const steps = versions.slice(1).map((v, i) => v - versions[i]!);

        expect(steps.slice(0, -1).every((step) => step === 1)).toBe(true);
        expect(steps.at(-1)).toBe(2); // the sixth answer resolves the round and finalises the session
    });

    it('rejects a stale version with the current one, and changes nothing', () => {
        const s = server();
        const opened = s.openRound(1);

        try {
            s.selectBox(opened.round!.round_id, 'steady', 1);
            expect.unreachable();
        } catch (error) {
            expect((error as ApiError).code).toBe('stale_state_version');
            expect((error as ApiError).details).toEqual({ current_state_version: 2 });
        }

        expect(s.stateVersion).toBe(2);
    });

    it('rejects actions in the wrong phase', () => {
        const s = server();

        expect(code(() => s.answer('demo_rnd_01', 'demo_opt_1_1', 1))).toBe('round_not_found');

        const opened = s.openRound(1);
        expect(code(() => s.answer(opened.round!.round_id, 'demo_opt_1_1', 2))).toBe('invalid_phase'); // no box yet
        expect(code(() => s.openRound(2))).toBe('invalid_phase'); // a round is already open
        expect(code(() => s.selectBox(opened.round!.round_id, 'nope' as BoxId, 2))).toBe('box_invalid');

        s.selectBox(opened.round!.round_id, 'steady', 2);
        expect(code(() => s.selectBox(opened.round!.round_id, 'quick_win', 3))).toBe('invalid_phase'); // already chose
    });

    it('finishes after six rounds, refuses further actions and exposes the result', () => {
        const s = server('practice');

        expect(code(() => s.result())).toBe('session_not_finished');

        for (let i = 0; i < 6; i += 1) play(s, 'quick_win', i % 2 === 0);

        const done = s.snapshot();
        expect(done).toMatchObject({ status: 'completed', phase: 'completed', rounds_resolved: 6 });
        expect(done.result).toEqual(s.result());
        expect(code(() => s.openRound(s.stateVersion))).toBe('session_completed');
    });

    it('practice never earns rewards; a competitive game below the premium threshold gets participation only', () => {
        const practice = server('practice');
        for (let i = 0; i < 6; i += 1) play(practice, 'high_roller', true);
        expect(practice.result().rewards).toEqual({ qualification: 'not_applicable', participation: 'not_applicable', premium: 'not_applicable', provider_mode: 'none' });

        const weak = server('competitive');
        for (let i = 0; i < 6; i += 1) play(weak, 'quick_win', false);
        expect(weak.result().rewards).toMatchObject({ qualification: 'qualified', participation: 'pending', premium: 'not_earned', provider_mode: 'fake' });
    });
});
