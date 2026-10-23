import { useEffect, useMemo, useState } from 'react';
import { LazyDemoGameApi } from './api/lazyDemo';
import { HttpGameApi } from './api/client';
import { Loading } from './components/Common';
import { StatusStrip } from './components/ConnectionBanner';
import { demoRuleOverrides, isDemoRequested } from './config';
import { Arena } from './screens/Arena';
import { ErrorView } from './screens/ErrorView';
import { Identity, Instructions, Landing, PracticeAdvice, Readiness } from './screens/PreGame';
import { Results } from './screens/Results';
import { useGame } from './state/useGame';
import { hasPractised, markPractised } from './state/practiceHistory';
import { usePreferences, type Preferences } from './state/usePreferences';
import { useOnlineStatus } from './state/useOnlineStatus';
import { useSoundPlayer } from './state/useSound';
import type { SessionMode } from './types/api';

type PreGameScreen = 'landing' | 'identity' | 'advice' | 'instructions' | 'readiness';

export default function App() {
    const demo = useMemo(() => isDemoRequested(), []);
    const api = useMemo(() => (demo ? new LazyDemoGameApi(demoRuleOverrides()) : new HttpGameApi()), [demo]);
    const game = useGame(api);
    const { preferences, toggle } = usePreferences();
    const player = useSoundPlayer(preferences.sound);
    const online = useOnlineStatus();

    // Turning sound on is a tap, which is the gesture browsers require before any audio may start.
    const onToggle = (key: keyof Preferences) => {
        if (key === 'sound') player.unlock();

        toggle(key);
    };

    const [screen, setScreen] = useState<PreGameScreen>('landing');
    const [mode, setMode] = useState<SessionMode>('practice');

    const { state } = game;

    // Remember a finished practice game so the "practise first?" advice is not repeated (advice only; the server enforces the real limit).
    const finishedPractice = state.ui === 'completed' && state.snapshot?.mode === 'practice';
    useEffect(() => {
        if (finishedPractice) markPractised();
    }, [finishedPractice]);

    const goHome = () => {
        game.reset();
        setScreen('landing');
    };

    const choose = (next: SessionMode) => {
        setMode(next);
        setScreen(next === 'competitive' ? 'identity' : 'instructions');
    };

    if (state.error) {
        return (
            <ErrorView
                error={state.error}
                onRetry={() => void game.retry()}
                onRefresh={() => void game.refresh()}
                onHome={goHome}
                onSignIn={() => {
                    game.reset();
                    setScreen('identity');
                }}
                onPracticeOnly={() => {
                    game.reset();
                    choose('practice');
                }}
            />
        );
    }

    if (state.ui === 'idle' || state.ui === 'loading') {
        return <Loading message="Loading…" />;
    }

    if (state.ui === 'starting' && !state.snapshot) {
        return <Loading message="Starting your game…" />;
    }

    if (state.ui === 'completed' && state.snapshot?.result) {
        return (
            <Results
                result={state.snapshot.result}
                demo={demo}
                onPracticeAgain={() => {
                    game.reset();
                    choose('practice');
                }}
                onPlayForRewards={() => {
                    game.reset();
                    choose('competitive');
                }}
                onHome={goHome}
            />
        );
    }

    if (state.snapshot) {
        return <Arena game={game} demo={demo} reducedMotion={preferences.reducedMotion} player={player} soundOn={preferences.sound} onToggleSound={() => onToggle('sound')} />;
    }

    // Before a game there is no clock, so the only thing worth saying is whether a connection is available.
    const strip = <StatusStrip online={online} checking={state.connection === 'unconfirmed' && !state.snapshot} />;

    switch (screen) {
        case 'identity':
            return (
                <>
                    {strip}
                    <Identity demo={demo} onContinue={() => setScreen(hasPractised() ? 'instructions' : 'advice')} onBack={() => setScreen('landing')} />
                </>
            );
        case 'advice':
            return (
                <>
                    {strip}
                    <PracticeAdvice onPractise={() => choose('practice')} onContinue={() => setScreen('instructions')} onBack={() => setScreen('identity')} />
                </>
            );
        case 'instructions':
            return (
                <>
                    {strip}
                    <Instructions mode={mode} onContinue={() => setScreen('readiness')} onBack={() => setScreen(mode === 'competitive' ? 'identity' : 'landing')} />
                </>
            );
        case 'readiness':
            return (
                <>
                    {strip}
                    <Readiness
                        mode={mode}
                        preferences={preferences}
                        onToggle={onToggle}
                        onStart={() => void game.start(mode)}
                        onBack={() => setScreen('instructions')}
                    />
                </>
            );
        default:
            return (
                <>
                    {strip}
                    <Landing demo={demo} preferences={preferences} onToggle={onToggle} onPlay={choose} />
                </>
            );
    }
}
