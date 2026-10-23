import { useEffect, useState } from 'react';
import { SoundPlayer } from '../audio/sounds';

/**
 * One sound player for the whole app. Sound is off by default and only starts after the player
 * taps or presses a key (browsers block audio before a gesture).
 */
export function useSoundPlayer(enabled: boolean): SoundPlayer {
    const [player] = useState(() => new SoundPlayer());

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
