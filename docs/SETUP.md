# Setting up the companion

The companion is a small program that runs on your Mac. It does two things:

- **Links your phone and the extension.** Start a session on either one and it starts on both; end it on either and it ends on both. Your computer sees when you pick up your phone.
- **Watches your screen.** While a session is running, it checks which app is in front every 20 seconds. When that changes, it takes a screenshot, a vision model running on your Mac judges it against your task, and the screenshot is deleted straight away. If you stay off task in another app (Discord, a game, Messages) for 2 minutes, you get a notification. In Chrome, its judgment replaces the extension's guess from the tab title.

Nothing leaves your Mac except the link to your phone over your own Wi-Fi.

## What you need

- A Mac with Apple silicon and 16 GB of memory or more (the model uses about 4 GB while running).
- [Node.js](https://nodejs.org) 22 or newer.
- [Ollama](https://ollama.com), which runs the vision model.
- Your phone on the same Wi-Fi as your Mac, for the phone link.

## Steps

1. **Download the vision model** (3.3 GB, once):

   ```sh
   ollama pull qwen3-vl:4b
   ```

2. **Start the companion:**

   ```sh
   cd companion
   npm install
   npm start
   ```

   It prints a pairing code and your Mac's address. Keep this window open while you study.

3. **Allow screen access.** The first time it checks your screen, macOS asks for two permissions for the app you ran `npm start` from (Terminal, iTerm or VS Code). Say yes to both, or turn them on in **System Settings → Privacy & Security**:
   - **Screen & System Audio Recording**: so it can take screenshots. Restart the companion after turning this on.
   - **Automation → System Events**: so it can see which app is in front.

4. **Link the extension.** Click the OnTask icon in Chrome → **Settings** → **Companion app** → enter the pairing code → **Connect**. The line underneath should say *Connected*.

5. **Link the phone.** In the OnTask app → **Settings** → **Connect to your computer** → enter the address and pairing code → **Connect**.

## Options

```sh
npm start -- --no-screen      # link devices only, no screen watching
npm start -- --interval 30    # check the screen every 30 seconds instead of 20
npm start -- --dwell 180      # wait 3 minutes off task before notifying
npm start -- --model gemma3:4b  # use a different Ollama vision model
npm start -- --new-code       # make a new pairing code (re-link both devices)
```

## Troubleshooting

| What you see | What to do |
|---|---|
| Extension says *Not connected* | Make sure `npm start` is still running. |
| Phone says *Can't reach your computer* | Check both are on the same Wi-Fi. Some school and office networks block devices from talking to each other. A phone hotspot works. |
| *Screen watching needs permission* | Turn on Screen Recording for your terminal (step 3), then restart the companion. |
| The companion log keeps saying something like *Viewing the desktop* while you're in an app | macOS is only giving it your wallpaper, which means Screen Recording is off for your terminal. Turn it on (step 3) and restart. |
| *Screen watching needs the model* | Run `ollama pull qwen3-vl:4b`, then restart the companion. |
| The fan spins up | Use `--interval 60` so it checks less often. |
