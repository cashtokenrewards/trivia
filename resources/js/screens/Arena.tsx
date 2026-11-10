import { useEffect, useRef, useState } from 'react';
import { planSounds } from '../audio/plan';
import type { SoundPlayer } from '../audio/sounds';
import { ArenaCanvas } from '../components/ArenaCanvas';
import { CircleTimer } from '../components/CircleTimer';
import { DemoBanner } from '../components/Common';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { demoClock } from '../demo/demoClock';
import { connectionNotice } from '../game/connectionNotice';
import { keyAction } from '../game/keys';
import { crossedThreshold, gameClockTone, spokenWarning } from '../game/timerVisuals';
import { useCountdown } from '../state/useCountdown';
import { useOnlineStatus } from '../state/useOnlineStatus';
import type { GameController } from '../state/useGame';
import type { Box, Snapshot } from '../types/api';
import { SettingsButton } from './Settings';

const seconds = (ms: number | null) => (ms === null ? '–' : String(Math.ceil(ms / 1000)));

function Hud({ snapshot, sessionLeft }: { snapshot: Snapshot; sessionLeft: number | null }) {
    const { rules } = snapshot;
    // While a round is open show it; between rounds keep showing the round whose result is on screen.
    const round = Math.min(snapshot.round?.ordinal ?? snapshot.last_result?.ordinal ?? 1, snapshot.rounds_total);

    return (
        <header className="hud" aria-label="Game status">
            <div>
                <span className="hud-label">Round</span>
                <strong>
                    {round}/{snapshot.rounds_total}
                </strong>
            </div>
            <div>
                <span className="hud-label">Score</span>
                <strong data-testid="score">{snapshot.score}</strong>
            </div>
            <div>
                <span className="hud-label">Streak</span>
                <span className="pips" aria-label={`Streak ${snapshot.streak} of ${rules.streak_every}`}>
                    {Array.from({ length: rules.streak_every }, (_, i) => (
                        <i key={i} className={i < snapshot.streak ? 'on' : ''} />
                    ))}
                </span>
            </div>
            <div>
                <span className="hud-label">Game</span>
                <strong data-tone={gameClockTone(sessionLeft)}>{seconds(sessionLeft)}s</strong>
            </div>
        </header>
    );
}

/** Plain buttons for the same choice as tapping a chest: keyboard, screen readers and the no-3D fallback. */
function BoxButtons({ boxes, selected, busy, onPick }: { boxes: Box[]; selected: string | null; busy: boolean; onPick: (box: Box) => void }) {
    return (
        <div className="box-buttons" role="group" aria-label="Choose a box">
            {boxes.map((box, index) => (
                <button key={box.box_id} className="btn box-btn" data-box={box.box_id} data-selected={selected === box.box_id} disabled={busy} onClick={() => onPick(box)}>
                    <kbd className="keyhint" aria-hidden="true">
                        {index + 1}
                    </kbd>
                    <span>{box.label}</span>
                    <small>{box.base_points} pts</small>
                </button>
            ))}
        </div>
    );
}

interface ArenaProps {
    game: GameController;
    demo: boolean;
    reducedMotion: boolean;
    player: SoundPlayer;
    onOpenSettings: () => void;
}

export function Arena({ game, demo, reducedMotion, player, onOpenSettings }: ArenaProps) {
    const { state } = game;
    const snapshot = state.snapshot;
    const ui = state.ui;
    const pending = state.pending;
    const inFlight = pending !== null && state.error === null;

    const online = useOnlineStatus();
    const regionRef = useRef<HTMLDivElement>(null);
    const nextRef = useRef<HTMLButtonElement>(null);
    const [paused, setPaused] = useState(() => demoClock.paused);

    const phaseLeft = useCountdown(snapshot?.phase_deadline ?? null, state.clock);
    const sessionLeft = useCountdown(snapshot?.session_expires_at ?? null, state.clock);

    // When a server deadline appears to have passed, stop trusting the display: disable input and ask the
    // server what really happened. Repeat every two seconds until the snapshot moves on (a lost reply must not strand the player).
    const expiryDeadline = !snapshot
        ? null
        : snapshot.status === 'active' && sessionLeft === 0
          ? snapshot.session_expires_at
          : phaseLeft === 0
            ? snapshot.phase_deadline
            : null;
    const timesUp = expiryDeadline !== null;
    const refresh = game.refresh;

    useEffect(() => {
        if (!expiryDeadline) return;

        void refresh();
        const id = window.setInterval(() => void refresh(), 2000);

        return () => window.clearInterval(id);
    }, [expiryDeadline, refresh]);

    // Move keyboard focus to the new step so screen readers announce it. After a result, land on "Next round".
    useEffect(() => {
        const target = ui === 'feedback' ? nextRef.current : regionRef.current;

        target?.focus();
    }, [ui]);

    // Sounds follow the server's confirmed changes; the player's own tap sounds immediately.
    const previousSnapshot = useRef<Snapshot | null>(null);
    useEffect(() => {
        if (!snapshot) return;

        for (const sound of planSounds(previousSnapshot.current, snapshot)) {
            player.play(sound);
        }

        previousSnapshot.current = snapshot;
    }, [snapshot, player]);

    const tapKey = pending?.kind === 'select' ? pending.key : null;
    const lastTapKey = useRef<string | null>(null);
    useEffect(() => {
        if (tapKey && tapKey !== lastTapKey.current) player.play('pick');

        lastTapKey.current = tapKey;
    }, [tapKey, player]);

    const previousLeft = useRef<number | null>(null);
    useEffect(() => {
        const before = previousLeft.current;
        previousLeft.current = phaseLeft;

        if (ui === 'answering' && crossedThreshold(before, phaseLeft, [3, 2, 1]) !== null) player.play('tick');
    }, [phaseLeft, ui, player]);

    // Keyboard shortcuts read the latest state from a ref, so the listener is attached once.
    const latest = useRef({ game, snapshot, ui, busy: inFlight || timesUp });
    useEffect(() => {
        latest.current = { game, snapshot, ui, busy: inFlight || timesUp };
    });

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;

            const target = event.target as HTMLElement | null;

            if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;

            const { game: controller, snapshot: current, ui: step, busy } = latest.current;

            if (!current) return;

            const question = current.round?.question ?? null;
            const boxes = current.round?.boxes ?? [];
            const action = keyAction(event.key, {
                ui: step,
                boxCount: boxes.length,
                optionCount: question?.options.length ?? 0,
                lifelineAvailable: current.lifeline_available,
                busy,
                targetIsButton: target?.tagName === 'BUTTON',
            });

            if (!action) return;

            event.preventDefault();

            switch (action.type) {
                case 'box': {
                    const box = boxes[action.index];

                    if (box) void controller.selectBox(box.box_id);
                    break;
                }
                case 'option': {
                    const option = question?.options[action.index];

                    if (option && !question.removed_option_ids.includes(option.option_id)) void controller.answer(option.option_id);
                    break;
                }
                case 'lifeline':
                    void controller.lifeline();
                    break;
                case 'next':
                    void controller.openRound();
                    break;
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, []);

    if (!snapshot) {
        return null;
    }

    const busy = inFlight || timesUp;
    const notice = connectionNotice({ online, connection: state.connection, retryAttempt: state.retryAttempt, answerStatus: state.answerStatus, hasPending: pending !== null });
    const hasBanner = Boolean(state.notice) || ui === 'recovering' || notice !== null;
    const round = snapshot.round;
    const question = round?.question ?? null;
    const timedPhase = ui === 'choosing' || ui === 'answering' || ui === 'submitting';
    const phaseTotal = (ui === 'choosing' ? snapshot.rules.choice_seconds : snapshot.rules.answer_seconds) * 1000;
    const ringLabel = ui === 'choosing' ? 'Pick' : 'Answer';
    const spoken = ui === 'answering' ? spokenWarning(phaseLeft) : '';
    const result = snapshot.last_result;
    const remembered = state.lastQuestion && result && state.lastQuestion.roundId === result.round_id ? state.lastQuestion.question : null;
    const textOf = (id: string | null) => remembered?.options.find((o) => o.option_id === id)?.text ?? null;
    const pickedOption = pending?.kind === 'answer' ? pending.optionId : null;
    const pickedBox = pending?.kind === 'select' ? pending.boxId : (round?.selected_box_id ?? null);

    const togglePause = () => {
        demoClock.setPaused(!paused);
        setPaused(!paused);
        void game.refresh(); // re-read the snapshot so the countdown freezes or resumes in step with the clock
    };

    return (
        <main className={hasBanner ? 'screen arena with-banner' : 'screen arena'} aria-label="Game">
            {demo && <DemoBanner paused={paused} onTogglePause={togglePause} />}
            <div className="banner-stack">
                {state.notice && (
                    <div className="notice" role="status">
                        {state.notice}
                        <button className="link" onClick={game.dismissNotice}>
                            Dismiss
                        </button>
                    </div>
                )}
                {ui === 'recovering' && (
                    <div className="notice" role="status">
                        Re-syncing with the server…
                    </div>
                )}
                {notice && <ConnectionBanner notice={notice} onRetry={() => void game.retry()} onRefresh={() => void game.refresh()} onDismiss={game.dismissAnswerStatus} />}
            </div>

            <div className="topbar">
                <SettingsButton onClick={onOpenSettings} />
                <Hud snapshot={snapshot} sessionLeft={sessionLeft} />
                {timedPhase && <CircleTimer remainingMs={phaseLeft} totalMs={phaseTotal} label={ringLabel} paused={demo && paused} />}
            </div>

            <div className="arena-wrap">
                <ArenaCanvas game={game} reducedMotion={reducedMotion} />
            </div>

            <p className="sr-only" role="status" aria-live="polite">
                {spoken}
            </p>

            <div className="region" ref={regionRef} tabIndex={-1}>
                {ui === 'ready' && (
                    <div className="center-stack">
                        <h2>Game started</h2>
                        <button className="btn btn-primary btn-big" disabled={busy} onClick={() => void game.openRound()}>
                            {inFlight ? 'Opening…' : 'Start first round'}
                        </button>
                    </div>
                )}

                {ui === 'choosing' && round && (
                    <>
                        <h2>Pick a box</h2>
                        <p className="caption">Tap a chest above, press 1 to 3, or use these buttons. If you wait, Quick Win opens for you.</p>
                        <BoxButtons boxes={round.boxes ?? []} selected={pickedBox} busy={busy} onPick={(box) => void game.selectBox(box.box_id)} />
                    </>
                )}

                {(ui === 'answering' || ui === 'submitting') && round && question && (
                    <section className="question" aria-label="Question">
                        <p className="chips">
                            <span className="chip">{question.category}</span>
                            <span className="chip" data-difficulty={question.difficulty}>
                                {question.difficulty}
                            </span>
                            {round.auto_selected && <span className="chip">Quick Win opened for you</span>}
                        </p>
                        <h2 className="question-text">{question.text}</h2>
                        <div className="options">
                            {question.options.map((option, index) => {
                                const removed = question.removed_option_ids.includes(option.option_id);

                                return (
                                    <button
                                        key={option.option_id}
                                        className="option"
                                        data-picked={pickedOption === option.option_id}
                                        disabled={removed || busy}
                                        aria-disabled={removed || busy}
                                        onClick={() => void game.answer(option.option_id)}
                                    >
                                        <kbd className="keyhint" aria-hidden="true">
                                            {index + 1}
                                        </kbd>
                                        {option.text}
                                        {removed && <span className="sr-only"> (removed by lifeline)</span>}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="actions">
                            <button
                                className="btn"
                                disabled={!snapshot.lifeline_available || busy}
                                onClick={() => void game.lifeline()}
                                aria-label={snapshot.lifeline_available ? 'Use lifeline: remove one wrong answer' : undefined}
                            >
                                {snapshot.lifeline_available ? 'Lifeline: remove one wrong answer (L)' : 'Lifeline used'}
                            </button>
                        </div>
                        {ui === 'submitting' && <p className="caption">Checking your answer…</p>}
                    </section>
                )}

                {timesUp && timedPhase && (
                    <p className="caption" role="status">
                        Time is up. Checking with the server…
                    </p>
                )}

                {ui === 'feedback' && result && (
                    <section className="feedback" data-outcome={result.outcome} aria-label="Result of this round">
                        <h2>{result.outcome === 'correct' ? 'Correct!' : result.outcome === 'wrong' ? 'Not quite' : 'Time ran out'}</h2>
                        {result.outcome === 'timeout' && <p>You did not answer in time, so this round scores nothing and your streak starts again.</p>}
                        <p className="points" aria-live="polite">
                            {result.points_awarded > 0 ? `+${result.points_awarded} points` : 'No points this round'}
                            {result.streak_bonus > 0 && ` (includes +${result.streak_bonus} streak bonus)`}
                        </p>
                        {textOf(result.correct_option_id) && (
                            <p>
                                Answer: <strong>{textOf(result.correct_option_id)}</strong>
                            </p>
                        )}
                        {result.outcome === 'wrong' && textOf(result.selected_option_id) && <p>You chose: {textOf(result.selected_option_id)}</p>}
                        <p className="explanation">{result.explanation}</p>
                        <button ref={nextRef} className="btn btn-primary btn-big" disabled={busy} onClick={() => void game.openRound()}>
                            {inFlight ? 'Opening…' : 'Next round (N)'}
                        </button>
                    </section>
                )}
            </div>
        </main>
    );
}
