import type { Difficulty } from '../types/api';

/**
 * DEMO CONTENT ONLY. Made-up practice questions so demo mode can run a whole game.
 * They are not approved campaign content and not MTN facts. The real bank lives on the server.
 */
export interface DemoQuestion {
    id: string;
    category: string;
    difficulty: Difficulty;
    text: string;
    correct: string;
    wrong: [string, string, string];
    explanation: string;
}

const q = (
    id: string,
    difficulty: Difficulty,
    category: string,
    text: string,
    correct: string,
    wrong: [string, string, string],
    explanation: string,
): DemoQuestion => ({ id, difficulty, category, text: `DEMO: ${text}`, correct, wrong, explanation: `${explanation} (Demo content.)` });

export const DEMO_QUESTIONS: readonly DemoQuestion[] = [
    q('e1', 'easy', 'Everyday', 'How many days are in a week?', '7', ['5', '6', '8'], 'A week has seven days.'),
    q('e2', 'easy', 'Nature', 'What colour is the sky on a clear day?', 'Blue', ['Green', 'Red', 'Yellow'], 'Air scatters blue light the most.'),
    q('e3', 'easy', 'Animals', 'How many legs does a spider have?', '8', ['6', '10', '4'], 'Spiders are arachnids with eight legs.'),
    q('e4', 'easy', 'Animals', 'Which animal says "meow"?', 'Cat', ['Dog', 'Cow', 'Duck'], 'Cats meow.'),
    q('e5', 'easy', 'Maths', 'What is 2 + 2?', '4', ['3', '5', '6'], 'Two plus two makes four.'),
    q('e6', 'easy', 'Science', 'At what temperature does water freeze, in Celsius?', '0', ['10', '100', '-10'], 'Water freezes at 0 degrees Celsius.'),

    q('m1', 'medium', 'Science', 'Which planet is known as the Red Planet?', 'Mars', ['Venus', 'Jupiter', 'Mercury'], 'Mars looks red because of iron oxide on its surface.'),
    q('m2', 'medium', 'Geography', 'What is the capital of France?', 'Paris', ['Lyon', 'Rome', 'Madrid'], 'Paris is the capital of France.'),
    q('m3', 'medium', 'Geography', 'Which is the largest ocean?', 'Pacific', ['Atlantic', 'Indian', 'Arctic'], 'The Pacific covers about a third of the planet.'),
    q('m4', 'medium', 'Science', 'What is the chemical symbol for gold?', 'Au', ['Ag', 'Gd', 'Go'], 'Au comes from the Latin word aurum.'),
    q('m5', 'medium', 'Geography', 'How many continents are there?', '7', ['5', '6', '8'], 'By the common convention there are seven.'),
    q('m6', 'medium', 'Literature', 'Who wrote Romeo and Juliet?', 'William Shakespeare', ['Charles Dickens', 'Mark Twain', 'Jane Austen'], 'Shakespeare wrote it in the 1590s.'),

    q('h1', 'hard', 'Science', 'Which element has the atomic number 74?', 'Tungsten', ['Osmium', 'Titanium', 'Tantalum'], 'Tungsten (W) has atomic number 74.'),
    q('h2', 'hard', 'Maths', 'What is the smallest prime number greater than 10?', '11', ['12', '13', '15'], '11 is prime; 12 and 15 are not, and 13 is larger.'),
    q('h3', 'hard', 'Science', 'Roughly how fast is light, in kilometres per second?', '300,000', ['30,000', '150,000', '3,000,000'], 'Light travels about 300,000 km every second.'),
    q('h4', 'hard', 'Science', 'Which planet has the shortest day?', 'Jupiter', ['Mars', 'Earth', 'Venus'], 'Jupiter spins once in about ten hours.'),
    q('h5', 'hard', 'History', 'In which year did the first crewed Moon landing happen?', '1969', ['1961', '1965', '1972'], 'Apollo 11 landed in July 1969.'),
    q('h6', 'hard', 'Biology', 'How many bones does an adult human body have?', '206', ['198', '212', '300'], 'An adult skeleton has 206 bones.'),
];
