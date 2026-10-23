import { describe, expect, it } from 'vitest';
import { snapshotFixture } from '../fixtures';
import { planSounds } from './plan';

describe('planSounds', () => {
    it('plays nothing for the first snapshot or a different session', () => {
        expect(planSounds(null, snapshotFixture('question_medium_issued'))).toEqual([]);
        expect(planSounds({ ...snapshotFixture('round_choosing'), session_id: 'other' }, snapshotFixture('question_medium_issued'))).toEqual([]);
    });

    it('plays the chest-opening sound once, when the question first arrives', () => {
        const choosing = snapshotFixture('round_choosing');
        const answering = snapshotFixture('question_medium_issued');

        expect(planSounds(choosing, answering)).toEqual(['open']);
        expect(planSounds(answering, { ...answering, state_version: answering.state_version + 1 })).toEqual([]); // the lifeline changes nothing audible
    });

    it('plays the outcome sound once for a newly resolved round', () => {
        const before = snapshotFixture('question_medium_issued');

        expect(planSounds(before, snapshotFixture('answer_correct'))).toEqual(['correct', 'coin']);
        expect(planSounds(snapshotFixture('question_hard_lifeline_used'), snapshotFixture('answer_wrong'))).toEqual(['wrong']);
        expect(planSounds(snapshotFixture('question_auto_selected'), snapshotFixture('answer_timeout'))).toEqual(['timeout']);

        const resolved = snapshotFixture('answer_correct');

        expect(planSounds(resolved, { ...resolved, state_version: resolved.state_version + 1 })).toEqual([]); // same result again
    });

    it('adds the bonus sound instead of the coin when a streak bonus was earned', () => {
        const before = snapshotFixture('question_medium_issued');
        const after = snapshotFixture('answer_correct');
        const bonus = { ...after, last_result: { ...after.last_result!, streak_bonus: 100, points_awarded: 300 } };

        expect(planSounds(before, bonus)).toEqual(['correct', 'bonus']);
    });
});
