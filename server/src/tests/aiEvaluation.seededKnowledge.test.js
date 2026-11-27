import { test, expect } from '@jest/globals';
import { extractSeededKnowledge, SEED_SCRIPT_PATH } from '../services/aiEvaluation/seededKnowledge.js';

test('turns FAQ seed rows into Markdown and ignores seeds without knowledge', () => {
    const faq = `export const faqs = [
  { question: 'How long does delivery take?', answer: 'Delivery takes three to five business days inside the country, longer for islands and remote mountain areas served by partner carriers.' },
  { question: 'Can I pay cash?', answer: 'Cash on delivery is available for orders under ' + '200 dollars in supported cities only.' },
];`;
    const text = extractSeededKnowledge(faq, 'seeds/faq.seed.ts');
    expect(text).toContain('## How long does delivery take?');
    expect(text).toContain('Cash on delivery is available for orders under 200 dollars');
    expect(extractSeededKnowledge("await prisma.user.create({ data: { email: 'a@b.c', name: 'Admin' } });", 'prisma/seed.js')).toBeNull();
    expect(SEED_SCRIPT_PATH.test('backend/prisma/seed.js')).toBe(true);
    expect(SEED_SCRIPT_PATH.test('src/routes/chat.js')).toBe(false);
});
