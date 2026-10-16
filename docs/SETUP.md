# Setting up OnTask

You do this once. After that, opening Chrome starts everything, and your phone and Mac find each other on their own.

## What you need

- A Mac with Apple silicon and 16 GB of memory or more.
- [Node.js](https://nodejs.org) 22 or newer, and [Ollama](https://ollama.com).
- Google Chrome (Brave, Edge and Arc work too).
- **Expo Go** on your phone, from the App Store or Google Play.

## One-time setup (no typing)

1. In Finder, open the **OnTask** folder and double-click **Set Up OnTask.command**. (If macOS says it's from an unidentified developer, right-click it → **Open** → **Open**.) It checks for Node.js and Ollama, downloads the screen model (3.3 GB), installs everything, and lets Chrome start the companion. If something's missing it opens the download page and tells you to run it again.
2. In Chrome, open `chrome://extensions`. If OnTask is already there, click its reload icon. If not, turn on **Developer mode**, click **Load unpacked** and pick the `OnTask/extension` folder.
3. Click the OnTask icon. The companion starts, and a **Devices** tab opens so you can pair your phone.
4. The first time it looks at your screen, macOS asks to let **Google Chrome** record the screen and control **System Events**. Allow both, then quit and reopen Chrome. (Chrome starts the companion, so macOS asks on Chrome's behalf.)

## Pair your phone (once)

1. In the **Devices** tab (or OnTask icon → **Paired devices** → **Manage**), click **Pair a phone**. A QR code appears.
2. On iPhone, scan it with the **Camera** app. On Android, scan it from **Expo Go**. OnTask opens in Expo Go.
3. Name your phone (for example "Aaryan's iPhone") and tap **Pair**.

Your phone appears in the Devices tab and in the OnTask dropdown under **Paired devices**, and the phone shows *Connected to (your Mac)*. From then on it finds your Mac by its network name, which doesn't change when the Wi-Fi gives your Mac a new IP address.

## Every day after that

1. Open Chrome. The companion, Ollama and the phone app server start on their own.
2. Open OnTask on your phone: Expo Go → **Recently opened** → OnTask. If that entry stops working (it remembers your Mac's old IP address), open the **Devices** tab, click **Pair a phone** and scan the code again. An already-paired phone just reopens the app without pairing twice.
3. Start a session in Chrome. Your phone asks **Connect?**

## Managing devices

Open the **Devices** tab: OnTask icon → **Paired devices** → **Manage**.

- **Active switch:** active devices follow your sessions (timer, break alerts, the *Connect?* prompt). Switch one off to keep it paired but quiet.
- **Rename:** click a device's name and type.
- **Forget:** unpairs it. You can also unpair from the phone: gear icon → **Unpair this phone**.

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
| Companion says *Not set up yet* | Double-click **Set Up OnTask.command** again, then reload OnTask in chrome://extensions. |
| Phone says *Looking for (your Mac)* | Make sure Chrome is open on the Mac and both are on the same Wi-Fi. Some school networks block devices from seeing each other; a phone hotspot works. |
| *Screen watching needs permission* | Turn on Screen Recording for Google Chrome in **System Settings → Privacy & Security**, then quit and reopen Chrome. |
| *Screen watching needs the model* | Double-click **Set Up OnTask.command** again; it downloads the model. |
| Anything else | The companion's log is at `~/.ontask/companion.log`. |

To undo the Chrome setup: `cd companion && npm run setup -- --remove`.
