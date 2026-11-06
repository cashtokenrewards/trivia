import type { Snapshot } from '../types/api';

export type SoundName = 'pick' | 'correct' | 'wrong' | 'timeout' | 'coin' | 'bonus' | 'tick';

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

    // A box the player picked already played its sound on the tap. Only a box the game picked for them (time ran out) is heard here.
    if (opened && next.round?.auto_selected) {
        sounds.push('pick');
    }

    const result = next.last_result;

    if (result && result.round_id !== previous.last_result?.round_id) {
        if (result.outcome === 'correct') {
            sounds.push('correct');

            // The pass sound is a full file; only a streak bonus adds a flourish on top (no extra coin chime over it).
            if (result.streak_bonus > 0) {
                sounds.push('bonus');
            }
        } else if (result.outcome === 'wrong') {
            sounds.push('wrong');
        } else {
            sounds.push('timeout');
        }
    }

    return sounds;
}
