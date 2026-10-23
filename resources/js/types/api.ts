/**
 * TypeScript mirror of docs/API_CONTRACT.md and docs/openapi.yaml (v1).
 * Maintained by hand: change the contract, the OpenAPI file, these types and the
 * fixtures together. Timestamps are UTC ISO 8601 strings with millisecond precision
 * and a trailing "Z" (for example "2026-10-19T10:00:00.000Z").
 */

export type IsoTimestamp = string;

export type SessionMode = 'practice' | 'competitive';
export type SessionStatus = 'active' | 'completed';
export type Phase = 'awaiting_round' | 'choosing' | 'answering' | 'completed';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type BoxId = 'quick_win' | 'steady' | 'high_roller';
export type RoundStatus = 'choosing' | 'answering';
export type RoundOutcome = 'correct' | 'wrong' | 'timeout';
export type Completion = 'completed' | 'partial';
export type EndReason = 'six_rounds' | 'session_expired';

export interface Rules {
    version: string;
    session_seconds: number;
    choice_seconds: number;
    answer_seconds: number;
    rounds_total: number;
    points: Record<Difficulty, number>;
    streak_every: number;
    streak_bonus: number;
    max_streak_bonuses: number;
}

export interface Box {
    box_id: BoxId;
    label: string;
    difficulty: Difficulty;
    base_points: number;
}

export interface QuestionOption {
    option_id: string;
    text: string;
}

/** Active question. Deliberately has no correct_option_id, is_correct or explanation. */
export interface ActiveQuestion {
    question_id: string;
    category: string;
    difficulty: Difficulty;
    text: string;
    options: QuestionOption[];
    removed_option_ids: string[];
}

export interface Round {
    round_id: string;
    ordinal: number;
    status: RoundStatus;
    /** Present while choosing; null once a box is selected. */
    boxes: Box[] | null;
    selected_box_id: BoxId | null;
    /** True when the choice deadline passed and the default box was applied. */
    auto_selected: boolean;
    question: ActiveQuestion | null;
    answer_deadline: IsoTimestamp | null;
}

/** Only for an already resolved round. */
export interface RoundResult {
    round_id: string;
    ordinal: number;
    outcome: RoundOutcome;
    difficulty: Difficulty;
    selected_option_id: string | null;
    correct_option_id: string;
    explanation: string;
    points_awarded: number;
    streak_bonus: number;
    score_after: number;
    streak_after: number;
    resolved_at: IsoTimestamp;
}

export type RewardStatus =
    | 'not_applicable'
    | 'not_earned'
    | 'pending'
    | 'granted'
    | 'unavailable'
    | 'under_review';

export type Qualification = 'qualified' | 'not_qualified' | 'not_applicable';
export type ProviderMode = 'none' | 'fake' | 'live';

export interface RewardsSummary {
    qualification: Qualification;
    participation: RewardStatus;
    premium: RewardStatus;
    provider_mode: ProviderMode;
}

export interface SessionResult {
    session_id: string;
    mode: SessionMode;
    completion: Completion;
    end_reason: EndReason;
    final_score: number;
    correct_count: number;
    rounds_resolved: number;
    bonuses_awarded: number;
    completed_at: IsoTimestamp;
    rewards: RewardsSummary;
}

export interface Snapshot {
    session_id: string;
    mode: SessionMode;
    status: SessionStatus;
    phase: Phase;
    state_version: number;
    server_now: IsoTimestamp;
    session_started_at: IsoTimestamp;
    session_expires_at: IsoTimestamp;
    phase_deadline: IsoTimestamp | null;
    rules: Rules;
    rounds_total: number;
    rounds_resolved: number;
    score: number;
    correct_count: number;
    /** Consecutive-correct counter toward the next bonus (0 to streak_every - 1). */
    streak: number;
    bonuses_awarded: number;
    lifeline_available: boolean;
    round: Round | null;
    last_result: RoundResult | null;
    /** Non-null only when status is "completed". */
    result: SessionResult | null;
}

// ---- Requests -------------------------------------------------------------

export interface StartSessionRequest {
    mode: SessionMode;
    client_ready: true;
}

export interface VersionedRequest {
    expected_state_version: number;
}

export type OpenRoundRequest = VersionedRequest;
export type UseLifelineRequest = VersionedRequest;

export interface SelectBoxRequest extends VersionedRequest {
    box_id: BoxId;
}

export interface SubmitAnswerRequest extends VersionedRequest {
    option_id: string;
}

// ---- Errors ---------------------------------------------------------------

export const ERROR_CODES = [
    'unauthenticated',
    'forbidden',
    'session_not_found',
    'round_not_found',
    'no_active_session',
    'stale_state_version',
    'invalid_phase',
    'phase_expired',
    'session_not_finished',
    'session_completed',
    'idempotency_conflict',
    'idempotency_in_progress',
    'active_session_exists',
    'already_participated',
    'campaign_not_open',
    'campaign_closed',
    'sessions_paused',
    'csrf_mismatch',
    'validation_failed',
    'idempotency_key_required',
    'box_invalid',
    'option_not_in_round',
    'rate_limited',
    'content_unavailable',
    'server_error',
    'service_unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
    error: {
        code: ErrorCode;
        message: string;
        retryable: boolean;
        correlation_id: string;
        details?: Record<string, unknown>;
    };
    server_now: IsoTimestamp;
}

/** Fixture file wrapper. Fixtures are DEMO DATA only. */
export interface DemoFixture<T> {
    _demo: true;
    description: string;
    http_status: number;
    response: T;
}
