# OnTask

Notices when you've drifted off task and helps you back, without nagging you for every glance.

- **Chrome extension:** asks what you're working on, runs your focus timer, and speaks up only when you've *stayed* off task.
- **Companion (Mac):** watches your screen with a model running on your Mac, and links your phone.
- **Phone app (iPhone and Android):** follows the session from your computer: same timer, break alerts, and a place to park stray thoughts.

## Demo

https://github.com/user-attachments/assets/be4bcde3-9a71-41a7-8cbc-2895da7ba170

## Chrome extension

1. **Asks what you're working on.** Answer in the card, or just keep working. After 20 seconds it guesses and checks: *Are you working on "CS 246 notes"?*
2. **Ignores quick glances.** A quick look at something unrelated does nothing. It only prompts once you've stayed off task for 2 minutes. Then you can go **Back to task**, say **Yes, this counts**, or snooze.
3. **Every timer lives here.** Pomodoro (25/5), short sprints (15/3), 52/17, deep work (90/20), Flowtime (break when you stop) or your own times. At each break you get links to TikTok, YouTube, Instagram and X, and drift prompts pause until it ends.
4. **Notices when you zone out.** After 5 minutes with no typing or scrolling, a chime and a *Still with it?* card, unless the tab is playing audio, like a lecture.
5. **Summarises each session.** Time on task, drifts, and where the drift went.

**Install:** download this repo (**Code → Download ZIP**) or `git clone` it. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the **`extension`** folder.

## Companion (Mac)

Runs on your Mac and makes the other two smarter:

- **Watches your screen** with a vision model running on your Mac through [Ollama](https://ollama.com). It judges what's actually on screen instead of guessing from tab titles, so a CS course outline counts toward your CS notes. It also covers apps outside Chrome, like Discord or games. Screenshots are deleted as soon as they've been judged.
- **Links your phone.** Pair once by scanning a QR code; your phone shows up by name in Chrome. When Chrome starts a session, your phone offers to follow along.

No online services or APIs: the only model is the one running on your Mac.

**Set up once:** `ollama pull qwen3-vl:4b`, then `cd companion && npm install && npm run setup`. After that, Chrome starts the companion (plus Ollama and the phone app server) on its own. Full steps: [docs/SETUP.md](docs/SETUP.md).

## Phone app (iPhone and Android)

The computer is in charge, so the app is one screen:

- When Chrome starts a session, the app asks **Connect?**, then shows the same task and timer.
- **Park a thought** when something pops into your head; review them on your break.
- At break time it chimes and gives you TikTok, YouTube, Instagram and X. When the break ends, it calls you back.
- Leaving the app mid-block sends a reminder, and your computer sees the pickup.
- To truly lock your phone to OnTask, use **Guided Access** (iPhone) or **app pinning** (Android). The app walks you through it.

**Pair it once:** install **Expo Go**, run `npm install` in `mobile/`, then in the OnTask panel in Chrome click **Pair a phone** and scan the QR code. Name your phone, and from then on they find each other on their own, even when your Mac's IP address changes.
