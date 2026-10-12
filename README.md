# OnTask

Tools that notice when you've drifted off task and help you back, without nagging you for every glance.

- **Chrome extension:** works out what you're working on from your tabs, checks its guess with you, and speaks up when you've *stayed* off task.
- **Phone app (iPhone and Android):** a study timer that keeps your phone out of the way and notices when you pick it up mid-block.

## Demo

https://github.com/user-attachments/assets/be4bcde3-9a71-41a7-8cbc-2895da7ba170

## Chrome extension

1. **Guesses your task.** After a minute of watching your tabs it asks: *Are you working on "Linear Algebra Lecture 4"?* Answer **Yes**, or **No** and type what you're really doing.
2. **Ignores quick glances.** A quick look at something unrelated does nothing. It only prompts once you've stayed off task for 2 minutes. Then you can go **Back to task**, say **Yes, this counts**, or snooze for 5 minutes.
3. **Optional focus timer.** Pomodoro (25/5), short sprints (15/3) or 52/17. Drift prompts are paused during breaks, and the toolbar badge counts down the minutes.
4. **Notices when you zone out.** After 5 minutes with no typing or scrolling, a chime and a *Still with it?* card. It stays quiet if the tab is playing audio, like a lecture video.
5. **Summarises each session.** Time on task, number of drifts, and where the drift went.

Everything runs on your machine. It reads only each tab's domain and title, and nothing is sent anywhere.

**Install:** download this repo (**Code → Download ZIP**) or `git clone` it. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the **`extension`** folder.

## Phone app

- **Study methods:** Pomodoro, short sprints, 52/17, deep work (90/20), Flowtime, or your own times.
- **Notices when you leave:** going to another app mid-block counts after a 15-second grace period. A notification with sound calls you back, and when you return OnTask asks whether you were on your phone.
- **Commitment lock:** until you've focused for the time you chose, ending early or opening Instagram, YouTube or TikTok from your break needs an override code that only appears after a short wait.
- **Breaks that help:** a movement suggestion, a "where you left off" note, and shortcuts to your apps once you've earned them.
- **Insights:** focus time, phone checks per hour, how far into a block you usually drift, and a suggested study method based on that.
- **Research-based extras:** if-then plans, random check-ins, and a place to park stray thoughts. See [docs/RESEARCH.md](docs/RESEARCH.md).

**Run it:**

1. Install [Node.js](https://nodejs.org) and the free **Expo Go** app on your phone.
2. In this repo: `cd mobile && npm install && npx expo start`.
3. Scan the QR code with your phone's camera (iPhone) or the Expo Go app (Android).

The lock is a soft lock for now: the app can't stop other apps from opening. Blocking apps at the system level needs a native build with Apple's Screen Time tools on iPhone and special permissions on Android.

## Companion (Mac)

An optional program that runs on your Mac and ties everything together:

- **Links your phone and the extension** over your Wi-Fi. A session started on one starts on the other, ending it on either ends both, and your computer sees when you pick up your phone.
- **Watches your screen** with a vision model running on your Mac through [Ollama](https://ollama.com). It judges what's actually on screen, not just tab titles, and covers apps outside the browser like Discord or games. Screenshots are deleted as soon as they've been judged, and nothing is sent anywhere.

**Run it:** `ollama pull qwen3-vl:4b`, then `cd companion && npm install && npm start`. Full steps, permissions and options: [docs/SETUP.md](docs/SETUP.md).
