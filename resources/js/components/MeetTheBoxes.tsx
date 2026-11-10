import { BOX_INFO } from '../game/boxInfo';
import { preGameRules } from '../game/ruleCopy';
import type { SessionMode } from '../types/api';

/** A small flat drawing of the treasure chest, with the gem colour of its box. */
function ChestIcon({ gem }: { gem: string }) {
    return (
        <svg className="chest-icon" viewBox="0 0 56 48" aria-hidden="true">
            <rect x="6" y="22" width="44" height="22" rx="3" fill="#8a5226" />
            <path d="M6 24 V20 a22 14 0 0 1 44 0 V24 z" fill="#a8642f" />
            <rect x="14" y="11" width="6" height="33" fill="#ffc933" />
            <rect x="36" y="11" width="6" height="33" fill="#ffc933" />
            <rect x="24" y="22" width="8" height="10" rx="1.5" fill="#ffc933" />
            <circle cx="28" cy="26.5" r="1.6" fill="#3b2410" />
            <polygon points="28,8 32.5,14 28,20 23.5,14" fill={gem} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1" />
        </svg>
    );
}

/**
 * Shown on the Ready screen, before the game clock starts, so the player can take their time
 * to learn what each box is worth. Reading this costs no game time.
 */
export function MeetTheBoxes({ mode }: { mode: SessionMode }) {
    const rules = preGameRules(mode);

    return (
        <section className="meet-boxes" aria-label="Meet the boxes">
            <h3>Meet the boxes</h3>
            <p className="caption">
                Each round you pick one. More points means a harder question. You will have {rules.choiceSeconds} seconds to pick, and if you wait, Quick Win opens for you.
            </p>
            <ul className="box-cards">
                {BOX_INFO.map((box) => (
                    <li key={box.id} className="box-card" data-box={box.id}>
                        <ChestIcon gem={box.gem} />
                        <div className="box-card-body">
                            <p className="box-card-head">
                                <strong>{box.label}</strong>
                                <span className="points-badge">{box.points} points</span>
                                <span className="chip" data-difficulty={box.difficulty}>
                                    {box.difficultyLabel}
                                </span>
                            </p>
                            <p className="box-card-hint">{box.hint}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}
