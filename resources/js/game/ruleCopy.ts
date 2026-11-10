import type { SessionMode } from '../types/api';

/**
 * The timings quoted on the screens BEFORE a game starts, when no server snapshot exists yet.
 * Once a game is running, the countdowns always use `snapshot.rules` from the server (D-016).
 * A test keeps these numbers equal to the demo server so they cannot quietly drift apart.
 *
 * Competitive timings are the official playbook rules. Practice is gentler on purpose: more
 * time to pick and a longer game clock so a new player can finish all six rounds (D-018).
 */
export interface PreGameRules {
    choiceSeconds: number;
    answerSeconds: number;
    sessionSeconds: number;
    rounds: number;
}

export const PRE_GAME_RULES: Record<SessionMode, PreGameRules> = {
    competitive: { choiceSeconds: 3, answerSeconds: 10, sessionSeconds: 90, rounds: 6 },
    practice: { choiceSeconds: 8, answerSeconds: 10, sessionSeconds: 120, rounds: 6 },
};

export const preGameRules = (mode: SessionMode): PreGameRules => PRE_GAME_RULES[mode];
