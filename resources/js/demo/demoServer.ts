import { ApiError } from '../api/errors';
import type { Box, BoxId, EndReason, RoundOutcome, RoundResult, Rules, SessionMode, SessionResult, Snapshot } from '../types/api';
import { demoClock, type Clock } from './demoClock';
import { DEMO_QUESTIONS, type DemoQuestion } from './questions';

/**
 * DEMO ONLY. A tiny in-browser stand-in for the Laravel game server, so the screens can be
 * played end to end before the backend exists. It follows docs/API_CONTRACT.md, but it is NOT
 * the real rule engine: nothing here is secure, saved or rewarded, and it is only ever loaded
 * (lazily) in demo mode. The real clock, scoring and rewards belong to Laravel (Prompts 07-10).
 *
 * Like the contract, every request first applies any deadline that has already passed, using the
 * LOGICAL time of that deadline (not the time the request arrived), so a late request can never
 * extend play: an unchosen box becomes Quick Win, an unanswered question becomes a timeout and
 * the session ends when its 90 seconds are up.
 */

export const DEMO_RULES: Rules = {
    version: 'demo-rules-v1',
    session_seconds: 90,
    choice_seconds: 3,
    answer_seconds: 10,
    rounds_total: 6,
    points: { easy: 100, medium: 200, hard: 300 },
    streak_every: 3,
    streak_bonus: 100,
    max_streak_bonuses: 2,
};

/**
 * Practice is gentler than the real game (D-018): more time to pick a box and a longer game
 * clock, so a new player can read the boxes and still finish all six rounds. Competitive keeps
 * the official playbook timings.
 */
export const PRACTICE_RULES: Partial<Rules> = { version: 'demo-rules-v1-practice', choice_seconds: 8, session_seconds: 120 };

export const DEMO_BOXES: readonly Box[] = [
    { box_id: 'quick_win', label: 'Quick Win', difficulty: 'easy', base_points: 100 },
    { box_id: 'steady', label: 'Steady', difficulty: 'medium', base_points: 200 },
    { box_id: 'high_roller', label: 'High Roller', difficulty: 'hard', base_points: 300 },
];

export interface DemoOptions {
    /** Override the durations, for example to test expiry quickly. */
    rules?: Partial<Rules>;
    clock?: Clock;
}

type Rng = () => number;

/** What a saved session looks like. */
export interface DemoServerState {
    v: 1;
    mode: SessionMode;
    sessionNumber: number;
    rules: Rules;
    startedAt: number;
    expiresAt: number;
    version: number;
    resolved: number;
    score: number;
    correct: number;
    streak: number;
    bonuses: number;
    lifelineUsed: boolean;
    used: string[];
    round: (Omit<RoundState, 'question'> & { questionId: string | null; question?: undefined }) | null;
    lastResult: RoundResult | null;
    finalResult: SessionResult | null;
}

interface IssuedOption {
    id: string;
    text: string;
    correct: boolean;
}

interface RoundState {
    id: string;
    ordinal: number;
    status: 'choosing' | 'answering';
    boxId: BoxId | null;
    autoSelected: boolean;
    question: DemoQuestion | null;
    options: IssuedOption[];
    removed: string[];
    choiceDeadline: number;
    answerDeadline: number | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

const fail = (status: number, code: ConstructorParameters<typeof ApiError>[1], message: string, retryable = false, details?: Record<string, unknown>) =>
    new ApiError(status, code, message, retryable, details, 'demo-corr-0001');

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
    const copy = [...items];

    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }

    return copy;
}

export class DemoServer {
    readonly sessionId: string;
    readonly rules: Rules;

    private readonly clock: Clock;
    private startedAt: number;
    private expiresAt: number;
    private version = 1;
    private round: RoundState | null = null;
    private lastResult: RoundResult | null = null;
    private finalResult: SessionResult | null = null;
    private resolved = 0;
    private score = 0;
    private correct = 0;
    private streak = 0;
    private bonuses = 0;
    private lifelineUsed = false;
    private readonly usedQuestions = new Set<string>();

    constructor(
        private readonly mode: SessionMode,
        private readonly rng: Rng = Math.random,
        sessionNumber = 1,
        options: DemoOptions = {},
    ) {
        this.sessionId = `demo_sess_${String(sessionNumber).padStart(4, '0')}`;
        this.rules = { ...DEMO_RULES, ...(mode === 'practice' ? PRACTICE_RULES : {}), ...options.rules };
        this.clock = options.clock ?? demoClock;
        this.startedAt = this.clock.now(); // the clock starts when the start request arrives
        this.expiresAt = this.startedAt + this.rules.session_seconds * 1000;
    }

    get stateVersion(): number {
        return this.version;
    }

    /** True once the session has ended (after applying any deadline that has passed). */
    get completed(): boolean {
        this.reconcile();

        return this.finalResult !== null;
    }

    // ---- Saving and restoring (so a page reload can resume the game in demo mode) ----------------------

    /** Everything needed to rebuild this session later. Plain data: safe to JSON.stringify. */
    toJSON(): DemoServerState {
        const round = this.round;

        return {
            v: 1,
            mode: this.mode,
            sessionNumber: Number(this.sessionId.replace(/D/g, '')) || 1,
            rules: this.rules,
            startedAt: this.startedAt,
            expiresAt: this.expiresAt,
            version: this.version,
            resolved: this.resolved,
            score: this.score,
            correct: this.correct,
            streak: this.streak,
            bonuses: this.bonuses,
            lifelineUsed: this.lifelineUsed,
            used: [...this.usedQuestions],
            round: round ? { ...round, questionId: round.question?.id ?? null, question: undefined, options: round.options.map((o) => ({ ...o })), removed: [...round.removed] } : null,
            lastResult: this.lastResult,
            finalResult: this.finalResult,
        };
    }

    /** Rebuilds a saved session. Returns null if the data is not something this version can read. */
    static restore(data: unknown, options: DemoOptions = {}, rng: Rng = Math.random): DemoServer | null {
        const d = data as Partial<DemoServerState> | null;

        if (!d || d.v !== 1 || !d.rules || typeof d.sessionNumber !== 'number' || (d.mode !== 'practice' && d.mode !== 'competitive')) return null;

        const server = new DemoServer(d.mode, rng, d.sessionNumber, { ...options, rules: d.rules });

        server.startedAt = Number(d.startedAt);
        server.expiresAt = Number(d.expiresAt);
        server.version = Number(d.version);
        server.resolved = Number(d.resolved);
        server.score = Number(d.score);
        server.correct = Number(d.correct);
        server.streak = Number(d.streak);
        server.bonuses = Number(d.bonuses);
        server.lifelineUsed = Boolean(d.lifelineUsed);
        server.lastResult = d.lastResult ?? null;
        server.finalResult = d.finalResult ?? null;
        (d.used ?? []).forEach((id) => server.usedQuestions.add(id));

        const saved = d.round;

        if (saved) {
            const question = saved.questionId ? (DEMO_QUESTIONS.find((candidate) => candidate.id === saved.questionId) ?? null) : null;

            if (saved.questionId && !question) return null; // the question bank changed: do not resume a half-known question

            server.round = { ...saved, question, options: saved.options.map((o) => ({ ...o })), removed: [...saved.removed] };
        }

        return server;
    }

    // ---- Actions (each persisted change bumps state_version by exactly one) ----------------------

    openRound(expectedVersion: number): Snapshot {
        this.reconcile();
        this.assertActive();

        if (this.round) throw fail(409, 'invalid_phase', 'A round is already open.');

        this.assertVersion(expectedVersion);

        const now = this.clock.now();
        const ordinal = this.resolved + 1;

        this.round = {
            id: `demo_rnd_${String(ordinal).padStart(2, '0')}`,
            ordinal,
            status: 'choosing',
            boxId: null,
            autoSelected: false,
            question: null,
            options: [],
            removed: [],
            choiceDeadline: Math.min(now + this.rules.choice_seconds * 1000, this.expiresAt),
            answerDeadline: null,
        };
        this.version += 1;

        return this.build();
    }

    selectBox(roundId: string, boxId: BoxId, expectedVersion: number): Snapshot {
        const late = this.round?.status === 'choosing' && this.clock.now() > this.round.choiceDeadline;

        this.reconcile(); // a late choice finds the default Quick Win already issued
        this.assertActive();

        if (late) throw fail(409, 'phase_expired', 'Time ran out for that step.');

        const round = this.requireRound(roundId);

        if (round.status !== 'choosing') throw fail(409, 'invalid_phase', 'You already picked a box.');

        if (!DEMO_BOXES.some((candidate) => candidate.box_id === boxId)) throw fail(422, 'box_invalid', 'Unknown box.');

        this.assertVersion(expectedVersion);
        this.issue(round, boxId, this.clock.now(), false);

        return this.build();
    }

    lifeline(roundId: string, expectedVersion: number): Snapshot {
        const late = this.round?.status === 'answering' && this.clock.now() > (this.round.answerDeadline ?? Infinity);

        this.reconcile();
        this.assertActive();

        if (late) throw fail(409, 'phase_expired', 'Time ran out for that step.');

        const round = this.requireRound(roundId);

        if (round.status !== 'answering' || this.lifelineUsed) throw fail(409, 'invalid_phase', 'The lifeline is not available.');

        this.assertVersion(expectedVersion);

        const wrong = round.options.filter((option) => !option.correct && !round.removed.includes(option.id));
        round.removed.push(shuffle(wrong, this.rng)[0]!.id);
        this.lifelineUsed = true;
        this.version += 1;

        return this.build();
    }

    answer(roundId: string, optionId: string, expectedVersion: number): Snapshot {
        const open = this.round;

        // A new answer that arrives after the deadline is the request that discovers the expiry:
        // it resolves a timeout and succeeds (contract decision D-013), it is not an error.
        if (open && open.id === roundId && open.status === 'answering' && this.clock.now() > (open.answerDeadline ?? Infinity)) {
            this.reconcile();

            return this.build();
        }

        this.reconcile();
        this.assertActive();

        const round = this.requireRound(roundId);

        if (round.status !== 'answering' || !round.question) throw fail(409, 'invalid_phase', 'Pick a box first.');

        const picked = round.options.find((option) => option.id === optionId);

        if (!picked || round.removed.includes(optionId)) throw fail(422, 'option_not_in_round', 'That answer is not available.');

        this.assertVersion(expectedVersion);
        this.finishRound(round, picked, this.clock.now());

        return this.build();
    }

    // ---- Reads --------------------------------------------------------------------------------------

    result(): SessionResult {
        this.reconcile();

        if (!this.finalResult) throw fail(409, 'session_not_finished', 'The game is still in progress.');

        return this.finalResult;
    }

    snapshot(): Snapshot {
        this.reconcile();

        return this.build();
    }

    // ---- Internals ----------------------------------------------------------------------------------

    /**
     * Applies every deadline that has passed, oldest first, using each deadline's own logical
     * time. Called at the start of every read and write.
     */
    private reconcile(): void {
        const now = this.clock.now();

        for (;;) {
            if (this.finalResult) return;

            const round = this.round;

            if (round?.status === 'choosing' && now > round.choiceDeadline && round.choiceDeadline < this.expiresAt) {
                this.issue(round, 'quick_win', round.choiceDeadline, true); // default box, issued at the deadline

                continue;
            }

            if (round?.status === 'answering' && round.answerDeadline !== null && now > round.answerDeadline) {
                this.finishRound(round, null, round.answerDeadline); // unanswered: a timeout

                continue;
            }

            if (now > this.expiresAt) {
                this.round = null; // a round still choosing at expiry is abandoned and does not count
                this.finalize('session_expired', this.expiresAt);
            }

            return;
        }
    }

    private issue(round: RoundState, boxId: BoxId, issuedAt: number, auto: boolean): void {
        const box = DEMO_BOXES.find((candidate) => candidate.box_id === boxId)!;
        const pool = DEMO_QUESTIONS.filter((question) => question.difficulty === box.difficulty);
        const fresh = pool.filter((question) => !this.usedQuestions.has(question.id));
        const question = shuffle(fresh.length > 0 ? fresh : pool, this.rng)[0]!;

        this.usedQuestions.add(question.id);

        // Option ids are positional and random in order, so they say nothing about which one is right.
        const texts = shuffle([{ text: question.correct, correct: true }, ...question.wrong.map((text) => ({ text, correct: false }))], this.rng);

        round.status = 'answering';
        round.boxId = boxId;
        round.autoSelected = auto;
        round.question = question;
        round.options = texts.map((option, index) => ({ id: `demo_opt_${round.ordinal}_${index + 1}`, ...option }));
        round.answerDeadline = Math.min(issuedAt + this.rules.answer_seconds * 1000, this.expiresAt);
        this.version += 1;
    }

    /** Resolves the open round. `picked === null` means it timed out. */
    private finishRound(round: RoundState, picked: IssuedOption | null, resolvedAt: number): void {
        const question = round.question!;
        const correctOption = round.options.find((option) => option.correct)!;
        const isCorrect = picked?.correct === true;
        let bonus = 0;
        let points = 0;

        if (isCorrect) {
            points = this.rules.points[question.difficulty];
            this.correct += 1;
            this.streak += 1;

            if (this.streak >= this.rules.streak_every) {
                if (this.bonuses < this.rules.max_streak_bonuses) {
                    bonus = this.rules.streak_bonus;
                    this.bonuses += 1;
                }

                this.streak = 0;
            }
        } else {
            this.streak = 0; // wrong answers and timeouts both break the streak
        }

        const outcome: RoundOutcome = picked === null ? 'timeout' : isCorrect ? 'correct' : 'wrong';

        this.score += points + bonus;
        this.resolved += 1;
        this.lastResult = {
            round_id: round.id,
            ordinal: round.ordinal,
            outcome,
            difficulty: question.difficulty,
            selected_option_id: picked?.id ?? null,
            correct_option_id: correctOption.id,
            explanation: question.explanation,
            points_awarded: points + bonus,
            streak_bonus: bonus,
            score_after: this.score,
            streak_after: this.streak,
            resolved_at: iso(resolvedAt),
        };
        this.round = null;
        this.version += 1;

        if (this.resolved >= this.rules.rounds_total) {
            // The sixth question can time out exactly at expiry: that still counts as six resolved rounds (D-011).
            this.finalize(resolvedAt >= this.expiresAt ? 'session_expired' : 'six_rounds', resolvedAt);
        }
    }

    private finalize(reason: EndReason, at: number): void {
        this.finalResult = this.buildResult(reason, at);
        this.version += 1; // finalising the session is its own persisted change
    }

    private build(): Snapshot {
        const now = this.clock.now();
        const round = this.round;
        const completed = this.finalResult !== null;
        let deadline: number | null = null;

        if (round?.status === 'choosing') deadline = round.choiceDeadline;
        if (round?.status === 'answering') deadline = round.answerDeadline;

        return {
            session_id: this.sessionId,
            mode: this.mode,
            status: completed ? 'completed' : 'active',
            phase: completed ? 'completed' : !round ? 'awaiting_round' : round.status,
            state_version: this.version,
            server_now: iso(now),
            session_started_at: iso(this.startedAt),
            session_expires_at: iso(this.expiresAt),
            phase_deadline: deadline === null ? null : iso(deadline),
            rules: this.rules,
            rounds_total: this.rules.rounds_total,
            rounds_resolved: this.resolved,
            score: this.score,
            correct_count: this.correct,
            streak: this.streak,
            bonuses_awarded: this.bonuses,
            lifeline_available: !this.lifelineUsed,
            round: round
                ? {
                      round_id: round.id,
                      ordinal: round.ordinal,
                      status: round.status,
                      boxes: round.status === 'choosing' ? [...DEMO_BOXES] : null,
                      selected_box_id: round.boxId,
                      auto_selected: round.autoSelected,
                      // The correct answer is never part of an active payload.
                      question: round.question
                          ? {
                                question_id: `demo_q_${round.question.id}`,
                                category: round.question.category,
                                difficulty: round.question.difficulty,
                                text: round.question.text,
                                options: round.options.map(({ id, text }) => ({ option_id: id, text })),
                                removed_option_ids: [...round.removed],
                            }
                          : null,
                      answer_deadline: round.status === 'answering' && round.answerDeadline !== null ? iso(round.answerDeadline) : null,
                  }
                : null,
            last_result: this.lastResult,
            result: this.finalResult,
        };
    }

    private assertActive(): void {
        if (this.finalResult) throw fail(409, 'session_completed', 'This game has finished.');
    }

    private assertVersion(expected: number): void {
        if (expected !== this.version) {
            throw fail(409, 'stale_state_version', 'Your screen is out of date.', false, { current_state_version: this.version });
        }
    }

    private requireRound(roundId: string): RoundState {
        if (!this.round || this.round.id !== roundId) throw fail(404, 'round_not_found', 'That round is not open.');

        return this.round;
    }

    private buildResult(reason: EndReason, at: number): SessionResult {
        const competitive = this.mode === 'competitive';
        const complete = this.resolved >= this.rules.rounds_total;
        const premium = this.score >= 1200 && this.correct >= 4;

        return {
            session_id: this.sessionId,
            mode: this.mode,
            completion: complete ? 'completed' : 'partial',
            end_reason: reason,
            final_score: this.score,
            correct_count: this.correct,
            rounds_resolved: this.resolved,
            bonuses_awarded: this.bonuses,
            completed_at: iso(at),
            rewards: !competitive
                ? { qualification: 'not_applicable', participation: 'not_applicable', premium: 'not_applicable', provider_mode: 'none' }
                : complete
                  ? { qualification: 'qualified', participation: 'pending', premium: premium ? 'pending' : 'not_earned', provider_mode: 'fake' }
                  : { qualification: 'not_qualified', participation: 'not_earned', premium: 'not_earned', provider_mode: 'fake' },
        };
    }
}
