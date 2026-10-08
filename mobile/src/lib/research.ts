// The research behind each feature, shown in Settings → Why it works.

export interface ResearchFeature {
  title: string;
  what: string;
  how: string;
  source: { label: string; url: string };
}

export const RESEARCH: ResearchFeature[] = [
  {
    title: 'Phone out of sight',
    what: 'People did measurably worse on working-memory tests with their phone on the desk than with it in another room, even when it was face down and switched off.',
    how: 'Start a session, then put the phone out of reach. OnTask keeps time and chimes at each break, so you never need to look at it.',
    source: { label: 'Ward et al., 2017, “Brain Drain”', url: 'https://doi.org/10.1086/691462' },
  },
  {
    title: 'If-then plans',
    what: 'Deciding in advance how you will respond to a distraction had a medium-to-large effect on reaching goals across 94 studies.',
    how: 'Fill in “If I get distracted, I will…” before you start. OnTask shows your plan when you come back from your phone.',
    source: { label: 'Gollwitzer & Sheeran, 2006', url: 'https://doi.org/10.1016/S0065-2601(06)38002-1' },
  },
  {
    title: 'Random check-ins',
    what: 'Students with ADHD who regularly recorded whether they were paying attention showed less off-task behaviour in class.',
    how: 'Turn on check-ins in Settings. A chime asks “Were you on task?” at unpredictable times, and your answers feed the Insights tab.',
    source: { label: 'Mirnasab & Ghobari Bonab, 2011', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3395940/' },
  },
  {
    title: 'Park a thought',
    what: 'Unfinished goals keep interrupting your thinking until you make a plan for them, even when you don’t act on that plan yet.',
    how: 'When something pops into your head mid-block, tap Park a thought and write it down. Review the list on your break.',
    source: { label: 'Masicampo & Baumeister, 2011', url: 'https://doi.org/10.1037/a0024192' },
  },
  {
    title: 'Where you left off',
    what: 'Part of your attention stays on an unfinished task after you switch away, which hurts whatever you do next.',
    how: 'At the start of each break, jot down your exact next step. OnTask shows it when the break ends, so you can let go during the break and restart quickly.',
    source: { label: 'Leroy, 2009, “attention residue”', url: 'https://doi.org/10.1016/j.obhdp.2009.04.002' },
  },
  {
    title: 'Regular short breaks',
    what: 'Focus on a long task fades over time, and brief, planned breaks in the task largely prevented that drop.',
    how: 'Pick a study method. The Insights tab suggests shorter or longer blocks based on when you actually tend to drift.',
    source: { label: 'Ariga & Lleras, 2011', url: 'https://pubmed.ncbi.nlm.nih.gov/21211793/' },
  },
  {
    title: 'Movement breaks',
    what: 'Across studies of children and teens with ADHD, exercise improved executive function, with moderate-to-large effects on impulse control and mental flexibility.',
    how: 'Every break suggests something active to do. A few minutes of movement before the next block beats scrolling.',
    source: { label: 'Liang et al., 2021', url: 'https://doi.org/10.1186/s12966-021-01135-6' },
  },
  {
    title: 'Time you can see',
    what: 'Adults with ADHD often perceive time differently, and researchers argue this is a core part of the condition rather than a side effect.',
    how: 'The ring shrinks as the block runs out, and your first tiny step is shown at the start, so “later” stays visible as “now”.',
    source: { label: 'Weissenberger et al., 2021', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8293837/' },
  },
];
