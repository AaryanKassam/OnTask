// What's on screen when someone goes still: how much text, whether it looks
// like a textbook, whether it has exercises, and how long it should take to
// read. Used by the extension (text read straight from the page) and by the
// companion (text read off a screenshot, for PDFs and other apps).

// Words per minute. Adults read non-fiction silently at about 238 wpm
// (Brysbaert, 2019); studying textbook material, with formulas to work
// through, is a good deal slower.
export const WPM = { reading: 230, study: 130 };

// Enough text on screen that sitting still probably means reading.
export const LOTS_OF_TEXT = 150;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const TEXTBOOK_TERMS = /\b(chapter|section|theorem|lemma|definition|proof|corollary|proposition|example \d|figure \d|equation)\b/gi;
const EXERCISE_HEADING = /\b(exercises?|problem sets?|practice problems|review questions|end-of-chapter|homework)\b/i;
// A line that starts like a numbered question: "1.", "2)", "(a)", "Q3", "Problem 4".
const NUMBERED = /^\s*(\d{1,3}[.)]\s|\([a-z]\)\s|q\d+[.:]?\s|(question|problem|exercise)\s+\d+)/i;
const ASKING = /\?|\b(prove|show that|find|determine|compute|calculate|explain|justify|evaluate|solve)\b/i;

export function analyzeText(lines) {
  const clean = lines.map((l) => String(l ?? '')).filter((l) => l.trim());
  const all = clean.join('\n');
  const words = (all.match(WORD) ?? []).length;
  const textbookTerms = (all.match(TEXTBOOK_TERMS) ?? []).length;
  const numbered = clean.filter((l) => NUMBERED.test(l)).length;
  const exerciseHeading = EXERCISE_HEADING.test(all);
  const questions = (exerciseHeading && numbered >= 1) || (numbered >= 3 && ASKING.test(all));
  const textbook = textbookTerms >= 2 || (exerciseHeading && textbookTerms >= 1);
  const wpm = textbook || questions ? WPM.study : WPM.reading;
  return { words, textbook, questions, readMs: Math.round((words / wpm) * 60_000) };
}

// What to ask someone who has gone still on this screen, if anything.
export function studyPrompt(analysis) {
  if (!analysis) return null;
  if (analysis.questions) return 'questions';
  if (analysis.words >= LOTS_OF_TEXT) return 'reading';
  return null;
}

// How long to let them be still before checking in again. Reading: half
// again the estimated time, at least 3 minutes. Questions: until the focus
// block ends, or 25 minutes without a timer, at least 10.
export function studyAllowanceMs(kind, analysis, now, blockEndsAt) {
  if (kind === 'questions') {
    const untilBlockEnd = blockEndsAt ? blockEndsAt - now : 25 * 60_000;
    return Math.max(10 * 60_000, untilBlockEnd);
  }
  return Math.max(3 * 60_000, Math.round((analysis?.readMs ?? 0) * 1.5));
}

// Runs inside the page (via chrome.scripting) to pull out the visible text,
// line by line, plus a word count for the whole page.
export function readVisiblePage() {
  const lines = [];
  let totalWords = 0;
  const seen = new Set();
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
    totalWords += text.split(' ').length;
    if (seen.has(el) || (el.checkVisibility && !el.checkVisibility())) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight || r.width === 0) continue;
    seen.add(el);
    lines.push(el.innerText?.slice(0, 2000) ?? text);
    if (lines.length > 600) break;
  }
  return { lines, totalWords };
}
