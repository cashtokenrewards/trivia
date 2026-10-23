import type { Snapshot } from '../types/api';

export type SoundName = 'tap' | 'open' | 'correct' | 'wrong' | 'timeout' | 'coin' | 'bonus' | 'tick';

/**
 * Which sounds a change of snapshot should trigger. Driven by the server's confirmed state, so
 * a sound never plays for something the server has not accepted. The player's own tap is
 * handled separately because it happens before the server answers.
 */
export function planSounds(previous: Snapshot | null, next: Snapshot): SoundName[] {
    if (!previous || previous.session_id !== next.session_id) {
        return [];
    }

    const sounds: SoundName[] = [];
    const opened = next.round?.question && !(previous.round?.question && previous.round.round_id === next.round.round_id);

    if (opened) {
        sounds.push('open');
    }

    const result = next.last_result;

    if (result && result.round_id !== previous.last_result?.round_id) {
        if (result.outcome === 'correct') {
            sounds.push('correct');

            if (result.streak_bonus > 0) {
                sounds.push('bonus');
            } else if (result.points_awarded > 0) {
                sounds.push('coin');
            }
        } else if (result.outcome === 'wrong') {
            sounds.push('wrong');
        } else {
            sounds.push('timeout');
        }
    }

    return sounds;
}
