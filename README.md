# OnTask

Notices when you've drifted off task and helps you back, without nagging you for every glance.

- **Chrome extension:** asks what you're working on, runs your focus timer, and speaks up only when you've *stayed* off task.
- **Companion (Mac):** watches your screen with an AI model running on your own Mac, and links your phone or iPad.
- **Phone app (iPhone, iPad, Android):** follows the session from your computer: the same timer, break alerts, and a place to park stray thoughts.

No online services or AI APIs. The only model is the one running on your Mac.

## Demo

Demo of the first version (the extension on its own):

https://github.com/user-attachments/assets/be4bcde3-9a71-41a7-8cbc-2895da7ba170

## Get started

**You need:** a Mac with Apple silicon (16 GB of memory for screen watching), Google Chrome, [Node.js](https://nodejs.org) 22 or newer, [Ollama](https://ollama.com) for screen watching, and **Expo Go** on your phone.

1. Download this repo (**Code → Download ZIP**) or `git clone` it.
2. In Finder, double-click **Set Up OnTask.command** in the OnTask folder. It downloads the screen model (3.3 GB), installs everything and lets Chrome start the companion. If macOS says it's from an unidentified developer, right-click it → **Open**.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the **`extension`** folder.
4. Click the OnTask icon. A **Devices** tab opens: click **Pair a phone** and scan the QR code with your phone (iPhone Camera, or Expo Go on Android). Name the phone and tap **Pair**.

From then on, opening Chrome starts everything, and your phone finds your Mac on its own. Full steps and troubleshooting: [docs/SETUP.md](docs/SETUP.md).

The extension also works on its own (step 3 only). It then judges tabs by their titles instead of looking at the screen.

## Chrome extension

1. **Asks what you're working on.** Answer in the card, or just keep working. After 20 seconds it guesses and checks: *Are you working on "CS 246 notes"?*
2. **Ignores quick glances.** A quick look at something unrelated does nothing. It only prompts once you've stayed off task for 2 minutes (4 if it's unsure). Then you can go **Back to task**, say **Yes, this counts** (that site stops being flagged for the session), or snooze. At most 6 prompts an hour.
3. **Every timer lives here.** Pomodoro (25/5), short sprints (15/3), 52/17, deep work (90/20), Flowtime (break when you stop) or your own times. At each break you get links to TikTok, YouTube, Instagram and X, and drift prompts pause until it ends.
4. **Knows reading from zoning out.** After a minute without typing or scrolling, it counts the text on screen and estimates the reading time. On a text-heavy page it quietly asks *Reading?*; on a textbook page with exercises it asks *Working through the questions?*. Neither makes a sound. Say yes and the clock keeps running for that long. Otherwise, after 5 minutes with no input: a chime and *Still with it?*, unless a tab is playing audio, like a lecture.
5. **Paired devices.** The dropdown lists your paired phones by name. **Manage** opens the Devices tab, where you switch each one on or off, rename it, forget it, or pair a new one.
6. **Summarises each session.** Time on task, drifts, and where the drift went.

## Companion (Mac)

Chrome starts it in the background once it's set up. It:

- **Watches your screen** with a vision model (`qwen3-vl:4b` through Ollama). Each time you switch tabs it looks at what's actually on screen, so a CS course outline counts toward your CS notes even when its title doesn't say so. Screenshots are judged on your Mac and deleted straight away.
- **Reads text off the screen** with Apple's built-in text recognition, for PDFs and other pages the extension can't read itself.
- **Covers apps outside Chrome,** like Discord or games, with a macOS notification after the same 2-minute wait.
- **Makes the 20-second guess** at what you're working on, from your recent tabs and the screen.
- **Links your phone** over your Wi-Fi, and serves the phone app to Expo Go.

## Phone app

The computer is in charge, so the app is one screen:

- When Chrome starts a session, the app asks **Connect?**, then shows the same task and timer.
- **Park a thought** when something pops into your head; review them on your break.
- At break time it chimes and gives you TikTok, YouTube, Instagram and X. When the break ends, it calls you back.
- **OnTask Apps** (iPhone and iPad): choose the apps you use for the work, like Notes or GoodNotes, and open them from the timer screen without it counting as leaving. Useful for doing questions on an iPad while your textbook is on the computer.
- Leaving the app mid-block sends a reminder. Tapping it takes you back to the last OnTask App you used, and your computer sees the pickup.
- To lock your phone to OnTask, use **Guided Access** (iPhone, iPad) or **app pinning** (Android). The app walks you through it.

## Privacy

- The extension reads each tab's address and title, and the text on screen when you go still.
- Screenshots, screen text and model judgments stay on your Mac. Screenshots are deleted as soon as they're judged.
- Your phone and Mac talk directly over your own Wi-Fi. Nothing is sent to any online service.

## Status

OnTask is a working prototype, not a published product.

- The phone app runs in Expo Go. Seeing which app you switch to on a phone or iPad, and blocking the others, needs Apple's Screen Time access, which requires a full app build.
- The companion is macOS only.
- The link between phone and Mac is unencrypted and meant for your own home network.
- The thresholds (2 minutes, 6 prompts an hour, reading speeds) are reasonable starting points, not yet tested with real users.

## Project layout

| Folder | What's in it |
|---|---|
| `extension/` | The Chrome extension (Manifest V3, plain JavaScript, no build step) |
| `companion/` | The Mac companion (Node.js): device hub, screen watcher, Chrome launcher setup |
| `mobile/` | The phone app (Expo / React Native, TypeScript) |
| `docs/` | [Setup guide](docs/SETUP.md) and [the research behind the design](docs/RESEARCH.md) |

**Tests and checks:**

```sh
node --test extension/test/          # extension: sessions, timers, reading prompts
cd companion && npm test             # companion: pairing, hub, native messaging, end to end
cd mobile && npx tsc --noEmit && npx expo lint
```
