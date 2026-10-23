import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { BoxId, Snapshot } from '../types/api';
import { PausableClock } from './demoClock';
import { DemoServer } from './demoServer';
import { DEMO_QUESTIONS } from './questions';

const T0 = Date.UTC(2026, 9, 19, 10, 0, 0);
const at = (ms: number) => new Date(T0 + ms).toISOString();

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
function fakeClock() {
    const clock = {
        t: T0,
        now: () => clock.t,
        advance(ms: number) {
            clock.t += ms;
        },
    };

    return clock;
}

const make = (clock = fakeClock(), seed = 1, rules: ConstructorParameters<typeof DemoServer>[3] = {}) => new DemoServer('competitive', seeded(seed), 1, { clock, ...rules });

function optionFor(snapshot: Snapshot, wantCorrect: boolean): string {
    const issued = snapshot.round!.question!;
    const question = DEMO_QUESTIONS.find((candidate) => candidate.text === issued.text)!;

    return issued.options.find((o) => (o.text === question.correct) === wantCorrect)!.option_id;
}

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

describe('DemoServer timing: choosing', () => {
    it('gives three seconds to choose and the deadline is inclusive', () => {
        const clock = fakeClock();
        const s = make(clock);

        expect(s.openRound(1).phase_deadline).toBe(at(3000));

        clock.advance(3000);
        expect(s.snapshot().phase).toBe('choosing'); // exactly at the deadline is still on time

        clock.advance(1);
        const after = s.snapshot();

        expect(after.phase).toBe('answering');
        expect(after.round).toMatchObject({ selected_box_id: 'quick_win', auto_selected: true });
        expect(after.round!.question!.difficulty).toBe('easy');
    });

    it('an unchosen box becomes Quick Win issued AT the choice deadline, so a late request cannot extend play', () => {
        const clock = fakeClock();
        const s = make(clock);
        s.openRound(1);

        clock.advance(5000); // two seconds late
        const snapshot = s.snapshot();

        expect(snapshot.round!.answer_deadline).toBe(at(3000 + 10000)); // 10 s after the DEADLINE, not after the request
        expect(snapshot.state_version).toBe(3); // opened (2) then auto-issued (3)
    });

    it('a box choice after the deadline is refused because Quick Win was already issued', () => {
        const clock = fakeClock();
        const s = make(clock);
        const opened = s.openRound(1);

        clock.advance(3500);

        expect(code(() => s.selectBox(opened.round!.round_id, 'high_roller', 2))).toBe('phase_expired');
        expect(s.snapshot().round).toMatchObject({ selected_box_id: 'quick_win', auto_selected: true });
    });
});

describe('DemoServer timing: answering', () => {
    it('gives ten seconds to answer, then resolves a timeout that breaks the streak and scores nothing', () => {
        const clock = fakeClock();
        const s = make(clock);
        play(s, 'quick_win', true);
        const opened = s.openRound(s.stateVersion);
        const picked = s.selectBox(opened.round!.round_id, 'high_roller', s.stateVersion);

        expect(picked.phase_deadline).toBe(at(10000));

        clock.advance(10000);
        expect(s.snapshot().phase).toBe('answering'); // inclusive

        clock.advance(1);
        const done = s.snapshot();

        expect(done.phase).toBe('awaiting_round');
        expect(done.last_result).toMatchObject({ outcome: 'timeout', points_awarded: 0, selected_option_id: null, resolved_at: at(10000) });
        expect(done.last_result!.correct_option_id).toMatch(/^demo_opt_/);
        expect(done.streak).toBe(0);
        expect(done.rounds_resolved).toBe(2);
    });

    it('a long delay applies every missed step in order, each at its own logical time', () => {
        const clock = fakeClock();
        const s = make(clock);
        s.openRound(1);

        clock.advance(20000);
        const snapshot = s.snapshot();

        expect(snapshot.phase).toBe('awaiting_round');
        expect(snapshot.last_result).toMatchObject({ outcome: 'timeout', resolved_at: at(13000) });
        expect(snapshot.state_version).toBe(4); // opened, auto-issued, timed out
    });

    it('a new answer that arrives late resolves a timeout and succeeds instead of failing', () => {
        const clock = fakeClock();
        const s = make(clock);
        const opened = s.openRound(1);
        const picked = s.selectBox(opened.round!.round_id, 'steady', 2);
        const option = optionFor(picked, true);

        clock.advance(10001);
        const late = s.answer(picked.round!.round_id, option, 3);

        expect(late.last_result).toMatchObject({ outcome: 'timeout', points_awarded: 0 });
        expect(late.score).toBe(0);
        expect(code(() => s.answer(picked.round!.round_id, option, late.state_version))).toBe('round_not_found'); // already resolved
    });

    it('an answer exactly on the deadline still counts', () => {
        const clock = fakeClock();
        const s = make(clock);
        const opened = s.openRound(1);
        const picked = s.selectBox(opened.round!.round_id, 'steady', 2);

        clock.advance(10000);

        expect(s.answer(picked.round!.round_id, optionFor(picked, true), 3).last_result).toMatchObject({ outcome: 'correct' });
    });

    it('a lifeline after the deadline is refused', () => {
        const clock = fakeClock();
        const s = make(clock);
        const opened = s.openRound(1);
        const picked = s.selectBox(opened.round!.round_id, 'steady', 2);

        clock.advance(10500);

        expect(code(() => s.lifeline(picked.round!.round_id, 3))).toBe('phase_expired');
    });
});

describe('DemoServer timing: session expiry', () => {
    it('ends a game that runs out of time as partial with no reward, and refuses further actions', () => {
        const clock = fakeClock();
        const s = make(clock);
        play(s, 'quick_win', true);
        play(s, 'quick_win', true);

        clock.advance(91000);
        const done = s.snapshot();

        expect(done).toMatchObject({ status: 'completed', phase: 'completed', rounds_resolved: 2, score: 200 });
        expect(done.result).toMatchObject({ completion: 'partial', end_reason: 'session_expired', final_score: 200, completed_at: at(90000) });
        expect(done.result!.rewards).toMatchObject({ qualification: 'not_qualified', participation: 'not_earned', premium: 'not_earned' });
        expect(code(() => s.openRound(s.stateVersion))).toBe('session_completed');
    });

    it('a question still open at expiry resolves as a timeout and counts', () => {
        const clock = fakeClock();
        const s = make(clock);
        const opened = s.openRound(1);
        s.selectBox(opened.round!.round_id, 'steady', 2);

        clock.t = T0 + 95000;

        expect(s.snapshot()).toMatchObject({ status: 'completed', rounds_resolved: 1, last_result: expect.objectContaining({ outcome: 'timeout' }) });
    });

    it('a round still being chosen at expiry is abandoned and does not count', () => {
        const clock = fakeClock();
        const s = make(clock, 2);

        clock.t = T0 + 89000;
        s.openRound(1);
        clock.t = T0 + 95000;

        expect(s.snapshot()).toMatchObject({ status: 'completed', rounds_resolved: 0, last_result: null });
    });

    it('caps deadlines at the end of the session', () => {
        const clock = fakeClock();
        const s = make(clock);

        clock.t = T0 + 86000;
        const opened = s.openRound(1);

        expect(s.selectBox(opened.round!.round_id, 'steady', 2).phase_deadline).toBe(at(90000)); // not 10 s later
    });

    it('six resolved rounds ending exactly at expiry still count as a completed game (D-011)', () => {
        const clock = fakeClock();
        const s = make(clock, 3, { rules: { session_seconds: 20 } });

        for (let i = 0; i < 5; i += 1) play(s, 'quick_win', true);

        clock.t = T0 + 15000;
        const opened = s.openRound(s.stateVersion);
        s.selectBox(opened.round!.round_id, 'steady', s.stateVersion);
        clock.t = T0 + 30000;
        const done = s.snapshot();

        expect(done.result).toMatchObject({ completion: 'completed', end_reason: 'session_expired', rounds_resolved: 6 });
        expect(done.result!.rewards.qualification).toBe('qualified');
    });

    it('honours duration overrides', () => {
        const s = make(fakeClock(), 1, { rules: { choice_seconds: 2, answer_seconds: 4, session_seconds: 30 } });
        const opened = s.openRound(1);

        expect(opened.rules).toMatchObject({ choice_seconds: 2, answer_seconds: 4, session_seconds: 30 });
        expect(opened.phase_deadline).toBe(at(2000));
        expect(opened.session_expires_at).toBe(at(30000));
    });
});

describe('PausableClock', () => {
    afterEach(() => vi.useRealTimers());

    it('stops while paused and continues from where it stopped without jumping', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const clock = new PausableClock();

        vi.setSystemTime(1_005_000);
        expect(clock.now()).toBe(1_005_000);

        clock.setPaused(true);
        vi.setSystemTime(1_060_000);
        expect(clock.paused).toBe(true);
        expect(clock.now()).toBe(1_005_000);

        clock.setPaused(false);
        expect(clock.now()).toBe(1_005_000);
        vi.setSystemTime(1_062_000);
        expect(clock.now()).toBe(1_007_000);
    });

    it('a paused demo server never expires a deadline', () => {
        vi.useFakeTimers();
        vi.setSystemTime(2_000_000);
        const clock = new PausableClock();
        const s = new DemoServer('practice', seeded(1), 1, { clock });
        s.openRound(1);

        clock.setPaused(true);
        vi.setSystemTime(2_500_000); // ten minutes pass in the real world

        expect(s.snapshot().phase).toBe('choosing');
    });
});

describe('DemoServer: practice is gentler than the real game', () => {
    const practice = (clock = fakeClock()) => new DemoServer('practice', seeded(1), 1, { clock });

    it('gives 8 seconds to choose and a 120 second game clock, while competitive keeps 3 and 90', () => {
        const p = practice();
        const c = make();

        expect(p.rules).toMatchObject({ choice_seconds: 8, answer_seconds: 10, session_seconds: 120 });
        expect(c.rules).toMatchObject({ choice_seconds: 3, answer_seconds: 10, session_seconds: 90 });
        expect(p.openRound(1).phase_deadline).toBe(at(8000));
        expect(p.snapshot().session_expires_at).toBe(at(120000));
    });

    it('a practice game is still running after 90 seconds, but a competitive game has ended', () => {
        const clock = fakeClock();
        const p = practice(clock);
        const c = make(clock);

        clock.advance(100000);

        expect(p.snapshot().status).toBe('active');
        expect(c.snapshot().status).toBe('completed');
    });

    it('the Quick Win default waits the full 8 seconds in practice', () => {
        const clock = fakeClock();
        const p = practice(clock);
        p.openRound(1);

        clock.advance(7999);
        expect(p.snapshot().phase).toBe('choosing');

        clock.advance(2);
        expect(p.snapshot().round).toMatchObject({ selected_box_id: 'quick_win', auto_selected: true });
    });

    it('explicit duration overrides still win over the practice defaults', () => {
        const p = new DemoServer('practice', seeded(1), 1, { clock: fakeClock(), rules: { choice_seconds: 2 } });

        expect(p.rules.choice_seconds).toBe(2);
        expect(p.rules.session_seconds).toBe(120);
    });
});

describe('DemoServer: saving and restoring (reload recovery in demo mode)', () => {
    const roundTrip = (s: DemoServer, clock: ReturnType<typeof fakeClock>) => DemoServer.restore(JSON.parse(JSON.stringify(s.toJSON())), { clock }, seeded(9))!;

    it('a restored session continues exactly where it stopped: same snapshot, same deadline, same version', () => {
        const clock = fakeClock();
        const s = make(clock);
        const opened = s.openRound(1);
        s.selectBox(opened.round!.round_id, 'high_roller', 2);
        clock.advance(2500);

        const before = s.snapshot();
        const restored = roundTrip(s, clock);

        expect(restored.snapshot()).toEqual(before);
        expect(restored.stateVersion).toBe(before.state_version);
    });

    it('can finish the round it was restored in, and the answer counts once', () => {
        const clock = fakeClock();
        const s = make(clock);
        const opened = s.openRound(1);
        const picked = s.selectBox(opened.round!.round_id, 'steady', 2);
        const restored = roundTrip(s, clock);
        const done = restored.answer(picked.round!.round_id, optionFor(picked, true), 3);

        expect(done.last_result).toMatchObject({ outcome: 'correct', points_awarded: 200 });
        expect(done.score).toBe(200);
    });

    it('keeps the score, streak, bonuses, lifeline and used questions across a reload', () => {
        const clock = fakeClock();
        const s = make(clock);
        play(s, 'quick_win', true);
        play(s, 'quick_win', true);
        const opened = s.openRound(s.stateVersion);
        const picked = s.selectBox(opened.round!.round_id, 'steady', s.stateVersion);
        s.lifeline(picked.round!.round_id, s.stateVersion);

        const restored = roundTrip(s, clock);
        const snapshot = restored.snapshot();

        expect(snapshot).toMatchObject({ score: 200, streak: 2, lifeline_available: false, rounds_resolved: 2 });
        expect(snapshot.round!.question!.removed_option_ids).toHaveLength(1);
    });

    it('a restored session whose deadline passed while the page was closed catches up on the next read', () => {
        const clock = fakeClock();
        const s = make(clock);
        const opened = s.openRound(1);
        s.selectBox(opened.round!.round_id, 'steady', 2);

        const restored = roundTrip(s, clock);
        clock.advance(11000);

        expect(restored.snapshot().last_result).toMatchObject({ outcome: 'timeout' });
    });

    it('a finished session restores as finished', () => {
        const clock = fakeClock();
        const s = new DemoServer('practice', seeded(2), 1, { clock });

        for (let i = 0; i < 6; i += 1) play(s, 'quick_win', true);

        expect(roundTrip(s, clock).snapshot()).toMatchObject({ status: 'completed', result: expect.objectContaining({ completion: 'completed' }) });
    });

    it('refuses data it cannot read instead of resuming something half-known', () => {
        const state = JSON.parse(JSON.stringify(make().toJSON()));

        expect(DemoServer.restore(null)).toBeNull();
        expect(DemoServer.restore({})).toBeNull();
        expect(DemoServer.restore({ ...state, v: 2 })).toBeNull();
        expect(DemoServer.restore({ ...state, mode: 'bogus' })).toBeNull();

        const clock = fakeClock();
        const s = make(clock);
        const opened = s.openRound(1);
        s.selectBox(opened.round!.round_id, 'steady', 2);
        const saved = JSON.parse(JSON.stringify(s.toJSON()));
        saved.round.questionId = 'a-question-that-no-longer-exists';

        expect(DemoServer.restore(saved, { clock })).toBeNull();
    });
});
