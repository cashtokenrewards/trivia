import { describe, expect, it } from 'vitest';
import { snapshotFixture } from '../fixtures';
import { planSounds } from './plan';

describe('planSounds', () => {
    it('plays nothing for the first snapshot or a different session', () => {
        expect(planSounds(null, snapshotFixture('question_medium_issued'))).toEqual([]);
        expect(planSounds({ ...snapshotFixture('round_choosing'), session_id: 'other' }, snapshotFixture('question_medium_issued'))).toEqual([]);
    });

    it('plays nothing when the question arrives for a box the player picked (their tap already made the sound)', () => {
        const choosing = snapshotFixture('round_choosing');
        const answering = snapshotFixture('question_medium_issued');

        expect(planSounds(choosing, answering)).toEqual([]);
        expect(planSounds(answering, { ...answering, state_version: answering.state_version + 1 })).toEqual([]); // the lifeline changes nothing audible
    });

    it('plays the pick sound once when the game picked the box because time ran out', () => {
        const auto = snapshotFixture('question_auto_selected');
        const choosing = { ...snapshotFixture('round_choosing'), last_result: auto.last_result }; // same earlier result, so only the new question is "new"

        expect(planSounds(choosing, auto)).toEqual(['pick']);
        expect(planSounds(auto, { ...auto, state_version: auto.state_version + 1 })).toEqual([]);
    });

    it('plays the outcome sound once for a newly resolved round', () => {
        const before = snapshotFixture('question_medium_issued');

        expect(planSounds(before, snapshotFixture('answer_correct'))).toEqual(['correct']);
        expect(planSounds(snapshotFixture('question_hard_lifeline_used'), snapshotFixture('answer_wrong'))).toEqual(['wrong']);
        expect(planSounds(snapshotFixture('question_auto_selected'), snapshotFixture('answer_timeout'))).toEqual(['timeout']);

        const resolved = snapshotFixture('answer_correct');

        expect(planSounds(resolved, { ...resolved, state_version: resolved.state_version + 1 })).toEqual([]); // same result again
    });

    it('adds the bonus sound on top when a streak bonus was earned', () => {
        const before = snapshotFixture('question_medium_issued');
        const after = snapshotFixture('answer_correct');
        const bonus = { ...after, last_result: { ...after.last_result!, streak_bonus: 100, points_awarded: 300 } };

        expect(planSounds(before, bonus)).toEqual(['correct', 'bonus']);
    });
});
