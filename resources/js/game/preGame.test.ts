import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_BOXES, DEMO_RULES, DemoServer, PRACTICE_RULES } from '../demo/demoServer';
import { hasPractised, markPractised } from '../state/practiceHistory';
import { BOX_INFO } from './boxInfo';
import { PRE_GAME_RULES, preGameRules } from './ruleCopy';
import { BOX_LAYOUT } from '../arena/logic';

describe('pre-game rule copy', () => {
    it('competitive keeps the official playbook timings (3 s choice, 10 s answer, 90 s game, 6 rounds)', () => {
        expect(preGameRules('competitive')).toEqual({ choiceSeconds: 3, answerSeconds: 10, sessionSeconds: 90, rounds: 6 });
    });

    it('practice is gentler: 8 s to choose and a longer game clock', () => {
        expect(preGameRules('practice')).toEqual({ choiceSeconds: 8, answerSeconds: 10, sessionSeconds: 120, rounds: 6 });
    });

    it.each(['competitive', 'practice'] as const)('%s copy equals what the demo server really uses, so the screens never tell a different story', (mode) => {
        const rules = new DemoServer(mode).rules;
        const copy = PRE_GAME_RULES[mode];

        expect(copy).toEqual({ choiceSeconds: rules.choice_seconds, answerSeconds: rules.answer_seconds, sessionSeconds: rules.session_seconds, rounds: rules.rounds_total });
    });

    it('a slow practice player can still finish all six rounds in the longer clock, but not in the competitive one', () => {
        const worstCase = (mode: 'competitive' | 'practice') => preGameRules(mode).rounds * (preGameRules(mode).choiceSeconds + preGameRules(mode).answerSeconds);

        expect(worstCase('practice')).toBeLessThanOrEqual(preGameRules('practice').sessionSeconds);
        expect(worstCase('competitive')).toBeLessThanOrEqual(preGameRules('competitive').sessionSeconds);
    });

    it('does not change the competitive defaults', () => {
        expect({ ...DEMO_RULES, ...{} }).toMatchObject({ choice_seconds: 3, answer_seconds: 10, session_seconds: 90 });
        expect(PRACTICE_RULES).toMatchObject({ choice_seconds: 8, session_seconds: 120 });
    });
});

describe('box information shown before the game', () => {
    it('matches the contract boxes: same ids, names, difficulty and points', () => {
        expect(BOX_INFO.map((b) => b.id)).toEqual(DEMO_BOXES.map((b) => b.box_id));

        BOX_INFO.forEach((info, i) => {
            const box = DEMO_BOXES[i]!;

            expect(info.label).toBe(box.label);
            expect(info.difficulty).toBe(box.difficulty);
            expect(info.points).toBe(box.base_points);
        });
    });

    it('is in the same order as the 3D chests', () => {
        expect(BOX_INFO.map((b) => b.id)).toEqual(BOX_LAYOUT.map((b) => b.id));
    });

    it('states 100, 200 and 300 points with a plain difficulty and a hint for each box', () => {
        expect(BOX_INFO.map((b) => b.points)).toEqual([100, 200, 300]);
        expect(BOX_INFO.map((b) => b.difficultyLabel)).toEqual(['Easy', 'Medium', 'Hard']);
        expect(BOX_INFO.every((b) => b.hint.length > 20)).toBe(true);
        expect(BOX_INFO[0]!.hint.toLowerCase()).toContain('wait');
    });
});

describe('practice history', () => {
    afterEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it('starts as not practised, then remembers a finished practice game', () => {
        expect(hasPractised()).toBe(false);

        markPractised();

        expect(hasPractised()).toBe(true);
    });

    it('survives blocked storage without throwing', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });

        expect(hasPractised()).toBe(false);
        expect(() => markPractised()).not.toThrow();
    });
});
