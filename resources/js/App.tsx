import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LazyDemoGameApi } from './api/lazyDemo';
import { HttpGameApi } from './api/client';
import { Loading } from './components/Common';
import { StatusStrip } from './components/ConnectionBanner';
import { demoRuleOverrides, isDemoQuiet, isDemoRequested } from './config';
import { Arena } from './screens/Arena';
import { ErrorView } from './screens/ErrorView';
import { Identity, Instructions, Landing, PracticeAdvice, Readiness } from './screens/PreGame';
import { Results } from './screens/Results';
import { SettingsPage } from './screens/Settings';
import { useGame } from './state/useGame';
import { hasPractised, markPractised } from './state/practiceHistory';
import { usePreferences, type Preferences } from './state/usePreferences';
import { useOnlineStatus } from './state/useOnlineStatus';
import { useMusic } from './state/useMusic';
import { useSoundPlayer } from './state/useSound';
import type { SessionMode } from './types/api';

type PreGameScreen = 'landing' | 'identity' | 'advice' | 'instructions' | 'readiness';

export default function App() {
    const demo = useMemo(() => isDemoRequested(), []);
    // Labels are hidden only on the hosted demo site. The game itself is the same.
    const quiet = demo && isDemoQuiet();
    const api = useMemo(() => (demo ? new LazyDemoGameApi(demoRuleOverrides()) : new HttpGameApi()), [demo]);
    const game = useGame(api);
    const { preferences, toggle } = usePreferences();
    const player = useSoundPlayer(preferences.sound);
    const online = useOnlineStatus();

    const [screen, setScreen] = useState<PreGameScreen>('landing');
    const [mode, setMode] = useState<SessionMode>('practice');
    const [settingsOpen, setSettingsOpen] = useState(false);

    const { state } = game;

    // Music plays while a game is in progress (from the Start tap until the results), if it is switched on.
    const inGame = state.ui === 'starting' || (state.snapshot !== null && state.ui !== 'completed' && state.error === null);
    const music = useMusic(preferences.music && inGame);

    // Turning sound or music on is a tap, which is the gesture browsers require before any audio may start.
    const onToggle = (key: keyof Preferences) => {
        if (key === 'sound') player.unlock();
        if (key === 'music' && !preferences.music && inGame) music.prime();

        toggle(key);
    };

    const openSettings = () => setSettingsOpen(true);
    const start = () => {
        if (preferences.music) music.prime();

        void game.start(mode);
    };

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

    const render = (): ReactNode => {
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
                demo={demo && !quiet}
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
        return <Arena game={game} demo={demo && !quiet}reducedMotion={preferences.reducedMotion} player={player} onOpenSettings={openSettings} />;
    }

    // Before a game there is no clock, so the only thing worth saying is whether a connection is available.
    const strip = <StatusStrip online={online} checking={state.connection === 'unconfirmed' && !state.snapshot} />;

    switch (screen) {
        case 'identity':
            return (
                <>
                    {strip}
                    <Identity demo={demo} quiet={quiet}onContinue={() => setScreen(hasPractised() ? 'instructions' : 'advice')} onBack={() => setScreen('landing')} />
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
                        onOpenSettings={openSettings}
                        onStart={start}
                        onBack={() => setScreen('instructions')}
                    />
                </>
            );
        default:
            return (
                <>
                    {strip}
                    <Landing demo={demo} quiet={quiet}onOpenSettings={openSettings} onPlay={choose} />
                </>
            );
    }
    };

    return (
        <>
            {render()}
            {settingsOpen && <SettingsPage preferences={preferences} onToggle={onToggle} onClose={() => setSettingsOpen(false)} inGame={inGame} />}
        </>
    );
}
