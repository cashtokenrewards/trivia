import { useEffect, useState } from 'react';
import musicUrl from '../../audio/game-music.mp3';
import { MusicPlayer } from '../audio/music';

/** One music player for the whole app. `playing` is true while a game is in progress and music is on. */
export function useMusic(playing: boolean): MusicPlayer {
    const [player] = useState(() => new MusicPlayer(musicUrl));

    useEffect(() => {
        player.setPlaying(playing);

        if (!playing) return;

        // A start blocked by the browser is retried on the next tap or key press. Music also pauses while the page is hidden.
        const nudge = () => player.nudge();
        const visibility = () => player.refresh();

        window.addEventListener('pointerdown', nudge);
        window.addEventListener('keydown', nudge);
        document.addEventListener('visibilitychange', visibility);

        return () => {
            window.removeEventListener('pointerdown', nudge);
            window.removeEventListener('keydown', nudge);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, [playing, player]);

    useEffect(() => () => player.dispose(), [player]);

    return player;
}
