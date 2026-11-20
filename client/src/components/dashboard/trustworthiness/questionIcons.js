import { BookOpen, CircleSlash, MessageCircle, MessagesSquare, ShieldAlert, Wrench } from 'lucide-react';

// One icon per question group so lists can be scanned without reading labels.
export const groupIcons = {
  HAPPY_PATH: MessageCircle,
  MULTI_TURN: MessagesSquare,
  OUT_OF_SCOPE: CircleSlash,
  ADVERSARIAL: ShieldAlert,
  KNOWLEDGE_QA: BookOpen,
  USAGE_GUIDANCE: BookOpen,
  ACTION_TOOL: Wrench,
};
export const groupIcon = key => groupIcons[key] || MessageCircle;

// A fact with a number (price, days, %, hotline) is checked by rules instead of AI.
export const isExactFact = fact => /\d/.test(String(fact || ''));

export const firstUserMessage = item =>
  item.turns?.find(turn => !turn.role || turn.role === 'user')?.content || item.turns?.[0]?.content || '';
