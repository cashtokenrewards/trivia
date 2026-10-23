import type { SessionMode } from '../types/api';
import { PreferenceToggles, Screen, ServerStatus } from '../components/Common';
import { MeetTheBoxes } from '../components/MeetTheBoxes';
import { BOX_INFO } from '../game/boxInfo';
import { preGameRules } from '../game/ruleCopy';
import type { Preferences } from '../state/usePreferences';

interface LandingProps {
    demo: boolean;
    preferences: Preferences;
    onToggle: (key: keyof Preferences) => void;
    onPlay: (mode: SessionMode) => void;
}

export function Landing({ demo, preferences, onToggle, onPlay }: LandingProps) {
    return (
        <Screen label="Home">
            <header className="hero">
                <h1>
                    Cash<span>Token</span> Trivia
                </h1>
                <p>Pick a box, answer fast, beat the clock.</p>
            </header>

            <div className="card-stack">
                <button className="card card-primary" onClick={() => onPlay('practice')}>
                    <span className="badge-reco">Recommended first</span>
                    <span className="card-title">Practice</span>
                    <span className="card-sub">New here? Play a practice game first. You get extra time, it is free to repeat, and it does not use up your competitive game.</span>
                </button>
                <button className="card" onClick={() => onPlay('competitive')}>
                    <span className="card-title">Play for rewards</span>
                    <span className="card-sub">One competitive game per player. Rewards depend on the campaign.</span>
                </button>
            </div>

            <footer className="footer-row">
                {demo ? <span className="badge-demo">Demo mode</span> : <ServerStatus />}
                <PreferenceToggles preferences={preferences} onToggle={onToggle} />
            </footer>
        </Screen>
    );
}

export function Identity({ demo, onContinue, onBack }: { demo: boolean; onContinue: () => void; onBack: () => void }) {
    return (
        <Screen label="Sign in">
            <h2>Who is playing?</h2>
            {demo ? (
                <p className="panel">
                    You are signed in as <strong>Demo Player</strong> (a made-up player used only in demo mode).
                </p>
            ) : (
                <p className="panel">
                    Sign-in with your verified number is not connected in this build yet. You can still continue; the server will tell us whether you are allowed to play.
                </p>
            )}
            <div className="actions">
                <button className="btn btn-primary" onClick={onContinue}>
                    Continue
                </button>
                <button className="btn" onClick={onBack}>
                    Back
                </button>
            </div>
        </Screen>
    );
}

interface PracticeAdviceProps {
    onPractise: () => void;
    onContinue: () => void;
    onBack: () => void;
}

/** Advice only: the player may always carry on to the competitive game. */
export function PracticeAdvice({ onPractise, onContinue, onBack }: PracticeAdviceProps) {
    const practice = preGameRules('practice');
    const real = preGameRules('competitive');

    return (
        <Screen label="Practise first?">
            <h2>Practise first?</h2>
            <p className="panel">
                You only get <strong>one</strong> competitive game, so we recommend a practice game first. It is the best way to learn the boxes and the timing.
            </p>
            <ul className="steps">
                <li>
                    Practice is <strong>free to repeat</strong> and does not use up your competitive game.
                </li>
                <li>
                    You get <strong>more time</strong>: {practice.choiceSeconds} seconds to pick a box and a {practice.sessionSeconds}-second game clock. The real game gives {real.choiceSeconds} seconds and {real.sessionSeconds}{' '}
                    seconds.
                </li>
                <li>Practice has no rewards.</li>
            </ul>
            <div className="actions">
                <button className="btn btn-primary btn-big" onClick={onPractise}>
                    Practise first (recommended)
                </button>
                <button className="btn" onClick={onContinue}>
                    Play for rewards now
                </button>
                <button className="btn" onClick={onBack}>
                    Back
                </button>
            </div>
        </Screen>
    );
}

export function Instructions({ mode, onContinue, onBack }: { mode: SessionMode; onContinue: () => void; onBack: () => void }) {
    const rules = preGameRules(mode);

    return (
        <Screen label="How to play">
            <h2>How to play</h2>
            <ol className="steps">
                <li>
                    <strong>Pick a box.</strong> You have {rules.choiceSeconds} seconds. Each box has a different difficulty and is worth different points. The harder it is, the more it is worth:
                    <ul className="box-points">
                        {BOX_INFO.map((box) => (
                            <li key={box.id}>
                                <strong>{box.label}</strong>: {box.difficultyLabel} question, <strong>{box.points} points</strong>
                            </li>
                        ))}
                    </ul>
                    If you do not pick in time, Quick Win opens for you.
                </li>
                <li>
                    <strong>Answer the question.</strong> You have {rules.answerSeconds} seconds. Four choices, one is right. A wrong answer or running out of time scores nothing.
                </li>
                <li>
                    <strong>Build a streak.</strong> Three correct answers in a row earns a 100 point bonus.
                </li>
                <li>
                    <strong>Use your lifeline once.</strong> It removes one wrong answer. The clock keeps running.
                </li>
                <li>
                    <strong>Finish {rules.rounds} questions</strong> before the {rules.sessionSeconds}-second game clock ends.
                </li>
            </ol>
            <p className="panel">
                {mode === 'practice'
                    ? 'This is practice. It earns no rewards and does not use your competitive game.'
                    : 'This is your one competitive game. Rewards are not guaranteed and depend on the campaign.'}
            </p>
            <div className="actions">
                <button className="btn btn-primary" onClick={onContinue}>
                    I understand
                </button>
                <button className="btn" onClick={onBack}>
                    Back
                </button>
            </div>
        </Screen>
    );
}

interface ReadinessProps {
    mode: SessionMode;
    preferences: Preferences;
    onToggle: (key: keyof Preferences) => void;
    onStart: () => void;
    onBack: () => void;
}

export function Readiness({ mode, preferences, onToggle, onStart, onBack }: ReadinessProps) {
    const rules = preGameRules(mode);

    return (
        <Screen label="Ready to start">
            <h2>Ready?</h2>
            <p className="panel">
                Take your time to look at the boxes. The {rules.sessionSeconds}-second game clock starts only when you press <strong>Start</strong>.
            </p>
            <MeetTheBoxes mode={mode} />
            {mode === 'competitive' && <p className="panel panel-warn">This counts as your one competitive game.</p>}
            <PreferenceToggles preferences={preferences} onToggle={onToggle} />
            <div className="actions">
                <button className="btn btn-primary btn-big" onClick={onStart}>
                    Start
                </button>
                <button className="btn" onClick={onBack}>
                    Back
                </button>
            </div>
        </Screen>
    );
}
