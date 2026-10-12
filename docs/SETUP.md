# Setting up OnTask

You do this once. After that, opening Chrome starts everything, and your phone and Mac find each other on their own.

## What you need

- A Mac with Apple silicon and 16 GB of memory or more.
- [Node.js](https://nodejs.org) 22 or newer, and [Ollama](https://ollama.com).
- Google Chrome (Brave, Edge and Arc work too).
- **Expo Go** on your phone, from the App Store or Google Play.

## One-time setup (Terminal, about 5 minutes)

```sh
ollama pull qwen3-vl:4b                 # the screen model, 3.3 GB

cd ~/Documents/OnTask/companion
npm install
npm run setup                           # lets Chrome start the companion

cd ../mobile
npm install                             # the phone app
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. If OnTask is already there, click **Remove**. Its ID changed so Chrome can start the companion, so it has to be loaded again.
3. Click **Load unpacked** and pick the `OnTask/extension` folder.
4. Click the OnTask icon. Under **Settings**, the companion line should say *Running on (your Mac's name)*.
5. The first time it looks at your screen, macOS asks to let **Google Chrome** record the screen and control **System Events**. Allow both, then quit and reopen Chrome. (Chrome starts the companion, so macOS asks on Chrome's behalf.)

## Pair your phone (once)

1. In the OnTask panel → **Settings** → **Pair a phone**. A QR code appears.
2. On iPhone, scan it with the **Camera** app. On Android, scan it from **Expo Go**. OnTask opens in Expo Go.
3. Name your phone (for example "Aaryan's iPhone") and tap **Pair**.

That's it. Your phone shows up by name in Chrome, and the phone shows *Connected to (your Mac)*. From then on the phone finds your Mac by its network name, which doesn't change when the Wi-Fi gives your Mac a new IP address.

## Every day after that

1. Open Chrome. The companion, Ollama and the phone app server start on their own.
2. Open OnTask on your phone: Expo Go → **Recently opened** → OnTask. If that entry stops working (it remembers your Mac's old IP address), click **Phone QR code** in the OnTask panel and scan it again. It opens the app without pairing again.
3. Start a session in Chrome. Your phone asks **Connect?**

## Managing phones

- **See paired phones:** OnTask panel → Settings. Each phone is listed by name with when it was last seen.
- **Unpair from the computer:** click **Forget** next to it.
- **Unpair from the phone:** gear icon → **Unpair this phone**.

## Running it yourself instead

You can still start the companion from Terminal, for example to watch its log:

```sh
cd ~/Documents/OnTask/companion
npm start                       # or: npm start -- --no-screen, --no-app, --interval 30, --dwell 180
```

If Chrome tries to start it while that's running, Chrome connects to yours instead.

## Troubleshooting

| What you see | What to do |
|---|---|
| Companion says *Not set up yet* | Run `npm run setup` in `companion/`, then remove and re-load the extension. |
| Phone says *Looking for (your Mac)* | Make sure Chrome is open on the Mac and both are on the same Wi-Fi. Some school networks block devices from seeing each other; a phone hotspot works. |
| *Screen watching needs permission* | Turn on Screen Recording for Google Chrome in **System Settings → Privacy & Security**, then quit and reopen Chrome. |
| *Screen watching needs the model* | Run `ollama pull qwen3-vl:4b`. |
| Anything else | The companion's log is at `~/.ontask/companion.log`. |

To undo the Chrome setup: `cd companion && npm run setup -- --remove`.
