// Tab classification and task inference, entirely local: keyword matching
// against page titles. Nothing is sent anywhere.

// Words that say nothing about which task this is: filler, site chrome, and
// generic study/work nouns that would otherwise match unrelated pages.
const STOP = new Set(`
  a an the and or but of for to in on at by with from as is are was be it its this that these those
  my your our their me you we how what why when where who which vs via about into over new
  working work doing studying study reading writing watching learning finishing
  home page tab inbox search results watch video videos official full live free online best top
  youtube google reddit twitter facebook instagram tiktok netflix twitch
  lecture lectures notes note assignment assignments homework course class chapter part episode
  tutorial guide review intro introduction untitled document doc docs sheet sheets slides
  com org net edu www http https html`.trim().split(/\s+/));

// Sites that are almost always drift unless the title says otherwise.
const DISTRACTIONS = [
  'youtube.com', 'reddit.com', 'twitter.com', 'x.com', 'instagram.com', 'facebook.com', 'tiktok.com',
  'netflix.com', 'twitch.tv', 'hulu.com', 'disneyplus.com', 'primevideo.com', 'max.com', 'crunchyroll.com',
  'espn.com', 'nba.com', 'nfl.com', 'bleacherreport.com', 'theathletic.com',
  '9gag.com', 'buzzfeed.com', 'pinterest.com', 'tumblr.com', 'snapchat.com', 'threads.net', 'bsky.app',
  'discord.com', 'messenger.com', 'web.whatsapp.com',
  'amazon.com', 'amazon.ca', 'ebay.com', 'etsy.com', 'aliexpress.com', 'temu.com', 'shein.com',
  'store.steampowered.com', 'roblox.com', 'chess.com', 'lichess.org', 'miniclip.com', 'poki.com',
];

const NEUTRAL_PREFIXES = ['chrome://', 'chrome-extension://', 'chrome-search://', 'edge://', 'about:', 'devtools://', 'view-source:'];

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Browser pages (new tab, settings, extensions) are neither on nor off task.
export function isNeutralUrl(url) {
  return !url || NEUTRAL_PREFIXES.some((p) => url.startsWith(p));
}

// Strip unread counts like "(3) " so a new notification isn't a new page.
export function cleanTitle(title) {
  return (title || '').replace(/^\(\d+\+?\)\s*/, '').trim();
}

export function tokenize(text) {
  const lower = (text || '').toLowerCase();
  const out = [];
  // Course codes: "CS 246" and "cs246" both become "cs246".
  for (const m of lower.matchAll(/\b([a-z]{2,4})\s?(\d{3,4}[a-z]?)\b/g)) out.push(m[1] + m[2]);
  for (const w of lower.split(/[^a-z0-9]+/)) {
    if (!w || STOP.has(w)) continue;
    if (w.length < 3) continue;
    out.push(w);
  }
  return out;
}

// Loose match so "algebra" meets "algebraic" and "lecture" meets "lectures".
function similar(a, b) {
  return a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
}

function overlap(needles, hay) {
  return [...new Set(needles)].filter((n) => hay.some((h) => similar(n, h)));
}

function isDistraction(domain) {
  return DISTRACTIONS.some((d) => domain === d || domain.endsWith('.' + d));
}

export function classifyPage({ task, contextTokens = [], domain, title }) {
  const page = tokenize(`${title} ${domain.replace(/\./g, ' ')}`);
  const hits = overlap(tokenize(task), page);
  if (hits.length) return { verdict: 'on', reason: `Mentions “${hits[0]}”` };
  const related = overlap(contextTokens, page);
  if (related.length >= 2) {
    return { verdict: 'on', reason: `Related to what you were doing (${related.slice(0, 2).join(', ')})` };
  }
  if (isDistraction(domain)) return { verdict: 'off', reason: `Nothing about your task on ${domain}` };
  // Ambiguous is a real answer: the dwell timer waits twice as long before asking.
  return { verdict: 'ambiguous', reason: 'Can’t tell from the title alone' };
}

// Guess the task from time-weighted titles, phrased with the user's own words:
// the title segment that covers the most heavily weighted terms.
export function inferTask(observations) {
  const weights = new Map();
  let total = 0;
  const pages = observations.map((o) => {
    const domainWords = new Set(tokenize(o.domain.replace(/\./g, ' ')));
    const words = new Set(tokenize(o.title).filter((t) => !domainWords.has(t)));
    for (const w of words) weights.set(w, (weights.get(w) || 0) + o.ms);
    total += o.ms;
    return { ...o, words };
  });
  const ranked = [...weights].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || !total) return null;

  const topWeight = ranked[0][1];
  const core = ranked.filter(([, w]) => w >= topWeight * 0.35).slice(0, 4).map(([t]) => t);

  let best = null;
  for (const o of pages) {
    for (const raw of o.title.split(/\s+[-–—|·•]\s+|\s*\|\s*/)) {
      const seg = raw.trim();
      const words = new Set(tokenize(seg));
      const covered = core.filter((t) => words.has(t)).length;
      if (!covered) continue;
      if (!best || covered > best.covered || (covered === best.covered && o.ms > best.ms)) best = { seg, covered, ms: o.ms };
    }
  }
  if (!best) return null;

  const task = best.seg.length > 60 ? best.seg.slice(0, 60).replace(/\s+\S*$/, '') + '…' : best.seg;
  // Vocabulary from pages that share the core terms, so later tabs about the
  // same topic count as on-task even when they don't repeat the guess verbatim.
  const related = new Map();
  for (const o of pages) {
    if (!core.some((t) => o.words.has(t))) continue;
    for (const w of o.words) related.set(w, (related.get(w) || 0) + o.ms);
  }
  const contextTokens = [...related].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  const share = topWeight / total;
  return {
    task,
    contextTokens,
    confidence: share > 0.6 ? 'high' : share > 0.3 ? 'medium' : 'low',
  };
}
