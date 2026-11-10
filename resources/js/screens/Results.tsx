import { Screen } from '../components/Common';
import type { RewardStatus, SessionResult } from '../types/api';

const REWARD_TEXT: Record<RewardStatus, string> = {
    not_applicable: 'Not applicable',
    not_earned: 'Not earned this time',
    pending: 'On its way',
    granted: 'Delivered',
    unavailable: 'You qualified, but none are left',
    under_review: 'Being checked by our team',
};

interface ResultsProps {
    result: SessionResult;
    demo: boolean;
    onPracticeAgain: () => void;
    /** After a practice game, invite the player to the real one. */
    onPlayForRewards: () => void;
    onHome: () => void;
}

export function Results({ result, demo, onPracticeAgain, onPlayForRewards, onHome }: ResultsProps) {
    const practice = result.mode === 'practice';
    const partial = result.completion === 'partial';

    return (
        <Screen label="Results">
            <h2>{partial ? 'Time is up' : 'Game complete'}</h2>

            <div className="score-card">
                <span className="hud-label">Final score</span>
                <strong className="score-big" data-testid="final-score">
                    {result.final_score}
                </strong>
                <span>
                    {result.correct_count} correct · {result.rounds_resolved} of 6 questions answered
                </span>
            </div>

            {partial && !practice && (
                <p className="panel">The clock ran out before you finished all six questions, so this game does not qualify for rewards.</p>
            )}

            {practice ? (
                <p className="panel">Practice games do not earn rewards.</p>
            ) : (
                <section className="panel" aria-label="Rewards">
                    <h3>Your rewards</h3>
                    {result.rewards.provider_mode === 'fake' && <p className="badge-demo">Sandbox rewards: test only, not real</p>}
                    <dl className="rewards">
                        <dt>Participation reward</dt>
                        <dd>{REWARD_TEXT[result.rewards.participation]}</dd>
                        <dt>Premium reward</dt>
                        <dd>{REWARD_TEXT[result.rewards.premium]}</dd>
                    </dl>
                    <p className="caption">Rewards are not guaranteed and depend on the campaign rules.</p>
                </section>
            )}

            {demo && <p className="badge-demo">Demo game: practice questions only, nothing is saved or paid out</p>}

            <div className="actions">
                {practice && (
                    <>
                        <p className="caption">Ready for the real thing? You only get one competitive game.</p>
                        <button className="btn btn-primary" onClick={onPlayForRewards}>
                            Play for rewards
                        </button>
                    </>
                )}
                <button className={practice ? 'btn' : 'btn btn-primary'} onClick={onPracticeAgain}>
                    Practise again
                </button>
                <button className="btn" onClick={onHome}>
                    Home
                </button>
            </div>
        </Screen>
    );
}
