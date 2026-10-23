import type { BoxId, Difficulty } from '../types/api';

/**
 * What the player is told about each box before the game starts ("How to play" and "Meet the
 * boxes"). In the game itself the labels and points come from the server snapshot; this is the
 * pre-game copy, and a test keeps it equal to the contract's boxes.
 */
export interface BoxInfo {
    id: BoxId;
    label: string;
    difficulty: Difficulty;
    difficultyLabel: string;
    points: number;
    hint: string;
    /** Gem colour on the chest, matching the 3D chests. */
    gem: string;
}

export const BOX_INFO: readonly BoxInfo[] = [
    {
        id: 'quick_win',
        label: 'Quick Win',
        difficulty: 'easy',
        difficultyLabel: 'Easy',
        points: 100,
        hint: 'Easy question. The safe pick, and the one that opens for you if you wait.',
        gem: '#3ddc97',
    },
    {
        id: 'steady',
        label: 'Steady',
        difficulty: 'medium',
        difficultyLabel: 'Medium',
        points: 200,
        hint: 'Medium question. A fair challenge for double the points.',
        gem: '#4099ff',
    },
    {
        id: 'high_roller',
        label: 'High Roller',
        difficulty: 'hard',
        difficultyLabel: 'Hard',
        points: 300,
        hint: 'Hard question. The biggest reward, but the toughest to get right.',
        gem: '#ff6b6b',
    },
];
