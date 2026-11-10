import { describe, expect, it } from 'vitest';
import { fixtures } from './index';
import { ERROR_CODES, type ApiErrorBody, type Snapshot } from '../types/api';

const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TIME_KEYS = /(^server_now$|_at$|_deadline$)/;

const entries = Object.entries(fixtures);
const snapshots = entries.filter(([, f]) => (f.response as Snapshot).session_id !== undefined && 'phase' in (f.response as object));
const errors = entries.filter(([name]) => name.startsWith('error_'));

function walk(value: unknown, visit: (key: string, value: unknown, path: string) => void, path = ''): void {
    if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, visit, `${path}[${i}]`));
    } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            visit(key, child, `${path}.${key}`);
            walk(child, visit, `${path}.${key}`);
        }
    }
}

describe('demo fixtures', () => {
    it('loads the expected set', () => {
        expect(entries.length).toBeGreaterThanOrEqual(20);
        expect(snapshots.length).toBeGreaterThanOrEqual(8);
    });

    it.each(entries)('%s is labelled as demo data', (_name, fixture) => {
        expect(fixture._demo).toBe(true);
        expect(fixture.description.startsWith('DEMO DATA')).toBe(true);
        expect(Number.isInteger(fixture.http_status)).toBe(true);
    });

    it.each(entries)('%s uses UTC millisecond timestamps', (_name, fixture) => {
        walk(fixture.response, (key, value, path) => {
            if (TIME_KEYS.test(key) && value !== null) {
                expect(value, path).toMatch(ISO_UTC_MS);
            }
        });
    });

    it.each(entries)('%s contains no real-looking identifiers', (name, fixture) => {
        const text = JSON.stringify(fixture.response);
        expect(text, name).not.toMatch(/\+?\d{10,}/); // phone numbers
        expect(text, name).not.toMatch(/@/); // emails
    });
});

describe('snapshot fixtures follow the contract', () => {
    it.each(snapshots)('%s', (_name, fixture) => {
        const s = fixture.response as Snapshot;

        expect(Number.isInteger(s.state_version) && s.state_version >= 1).toBe(true);

        // Deadline present only in timed phases.
        if (s.phase === 'choosing' || s.phase === 'answering') {
            expect(s.phase_deadline).not.toBeNull();
            expect(Date.parse(s.phase_deadline!)).toBeLessThanOrEqual(Date.parse(s.session_expires_at));
        } else {
            expect(s.phase_deadline).toBeNull();
        }

        // 90 s session.
        expect(Date.parse(s.session_expires_at) - Date.parse(s.session_started_at)).toBe(s.rules.session_seconds * 1000);

        // Terminal state carries a result; active state does not.
        expect(s.status === 'completed').toBe(s.result !== null);
        expect(s.status === 'completed').toBe(s.phase === 'completed');

        // Scores are consistent with the last resolved round.
        if (s.last_result) {
            expect(s.last_result.score_after).toBe(s.score);
            expect(s.last_result.streak_after).toBe(s.streak);
        }
        expect(s.score).toBeLessThanOrEqual(2000);
        expect(s.rounds_resolved).toBeLessThanOrEqual(s.rounds_total);

        // Answering rounds expose a question and deadline; choosing rounds expose boxes.
        if (s.round?.status === 'answering') {
            expect(s.round.question).not.toBeNull();
            expect(s.round.answer_deadline).toBe(s.phase_deadline);
            expect(s.round.question!.options).toHaveLength(4);
        }
        if (s.round?.status === 'choosing') {
            expect(s.round.boxes).toHaveLength(3);
            expect(s.round.question).toBeNull();
        }
    });

    it.each(snapshots)('%s never leaks the answer in an active round', (name, fixture) => {
        const s = fixture.response as Snapshot;

        walk(s.round, (key) => {
            expect(['correct_option_id', 'is_correct', 'explanation'], `${name}: ${key}`).not.toContain(key);
        });
    });

    it('correct_option_id appears only inside last_result', () => {
        for (const [name, fixture] of snapshots) {
            const s = fixture.response as Snapshot;
            walk({ ...s, last_result: null }, (key, _value, path) => {
                expect(key, `${name}${path}`).not.toBe('correct_option_id');
            });
        }
    });

    it('lifeline fixture removes exactly one option that is not the answer', () => {
        const s = fixtures['question_hard_lifeline_used']!.response as Snapshot;

        expect(s.lifeline_available).toBe(false);
        expect(s.round!.question!.removed_option_ids).toHaveLength(1);
    });

    it('auto-selected round deadline is 10 s after the logical issue time, not the late request', () => {
        const s = fixtures['question_auto_selected']!.response as Snapshot;

        expect(s.round!.auto_selected).toBe(true);
        expect(s.round!.selected_box_id).toBe('quick_win');
        expect(Date.parse(s.phase_deadline!)).toBeLessThan(Date.parse(s.server_now) + s.rules.answer_seconds * 1000);
    });

    it('qualified and partial results match the demo reward policy', () => {
        const qualified = fixtures['snapshot_completed_qualified']!.response as Snapshot;
        const partial = fixtures['snapshot_completed_partial']!.response as Snapshot;

        expect(qualified.result!.completion).toBe('completed');
        expect(qualified.result!.final_score).toBeGreaterThanOrEqual(1200);
        expect(qualified.result!.correct_count).toBeGreaterThanOrEqual(4);
        expect(qualified.result!.rewards.qualification).toBe('qualified');

        expect(partial.result!.completion).toBe('partial');
        expect(partial.result!.rewards.qualification).toBe('not_qualified');
    });

    it('practice never earns rewards', () => {
        const r = fixtures['result_practice']!.response as { rewards: Record<string, string> };

        expect(r.rewards.qualification).toBe('not_applicable');
        expect(r.rewards.provider_mode).toBe('none');
    });
});

describe('error fixtures', () => {
    it.each(errors)('%s has the standard envelope and a known code', (name, fixture) => {
        const body = fixture.response as ApiErrorBody;

        expect(fixture.http_status).toBeGreaterThanOrEqual(400);
        expect(name).toBe(`error_${body.error.code}`);
        expect(ERROR_CODES).toContain(body.error.code);
        expect(typeof body.error.message).toBe('string');
        expect(typeof body.error.retryable).toBe('boolean');
        expect(body.error.correlation_id).toBeTruthy();
        expect(body.server_now).toMatch(ISO_UTC_MS);
    });
});

