import { useEffect, useState } from 'react';
import quizFailedUrl from '../../audio/quiz-failed.mp3';
import quizPassedUrl from '../../audio/quiz-passed.mp3';
import treasureOpenUrl from '../../audio/treasure-open.mp3';
import { SoundPlayer } from '../audio/sounds';

/**
 * One sound player for the whole app. Sound only starts after the player taps or presses a key
 * (browsers block audio before a gesture), and the player can turn it off in Settings.
 */
export function useSoundPlayer(enabled: boolean): SoundPlayer {
    const [player] = useState(() => new SoundPlayer({ pick: treasureOpenUrl, correct: quizPassedUrl, wrong: quizFailedUrl, timeout: quizFailedUrl }));

    useEffect(() => {
        player.setEnabled(enabled);

        if (!enabled) return;

        const unlock = () => player.unlock();

        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);

        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
    }, [enabled, player]);

    useEffect(() => () => player.dispose(), [player]);

    return player;
}
