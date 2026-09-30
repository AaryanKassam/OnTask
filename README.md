# OnTask

A Chrome extension that works out what you're working on from your tabs, checks its guess with you, and tells you when you've drifted off task for long enough to matter.

## Demo





## What it does

1. **Guesses your task.** For the first minute it watches which tabs you spend time on, then asks: *Are you working on "Linear Algebra Lecture 4"?* Answer **Yes** or **No**. If you pick No, type what you're actually doing.
2. **Ignores quick glances.** Each tab you switch to is marked on task, off task or unclear. A quick look at something unrelated does nothing. It only speaks up once you've *stayed* off task for 2 minutes.
3. **Nudges you back.** *You're off task*, with three buttons:
   - **Back to task** returns you to your last on-task tab.
   - **Yes, this counts** stops flagging that site for the rest of the session.
   - **Give me 5 more minutes** snoozes the reminder.
4. **Summarises the session.** When you end a session, the toolbar panel shows your time on task, how many times you drifted, and where the drift went.

It never blocks anything. It also stays quiet on new-tab pages, pauses while you're idle or Chrome isn't the front app, and prompts at most 6 times an hour.

## Get it

1. Download this repo (**Code → Download ZIP**, then unzip it) or run `git clone https://github.com/AaryanKassam/OnTask.git`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `OnTask` folder.

It starts watching immediately, and again every time Chrome starts.

**Quick demo:** in the toolbar panel's Settings, set the prompt delay to **15 seconds** and the watch time to **20 seconds**. Open a lecture video, click **Guess now**, answer **Yes**, then open something unrelated and wait.

## Privacy

It only reads each tab's domain and page title, never page content or screenshots.

By default it judges tabs locally by matching keywords, and nothing leaves your machine. If you add a Claude API key in Settings, Claude makes the guesses and judgments instead, and only each tab's domain and title are sent.
