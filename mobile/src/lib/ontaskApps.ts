// "OnTask Apps": the apps you're allowed to use during a session, like Notes
// or GoodNotes on an iPad. OnTask opens them by their link (URL scheme), so
// it can also send you back to the last one you were using.
//
// Only Apple's Screen Time framework can see which app is actually in front;
// that needs a native build. Until then, OnTask knows when you opened one of
// these from OnTask, and sends you back to it from the reminder notification.

import * as Linking from 'expo-linking';

export interface OnTaskApp {
  id: string;
  name: string;
  url: string;
}

// Link schemes are set by each app's developer and can change.
export const ONTASK_APPS: OnTaskApp[] = [
  { id: 'notes', name: 'Notes', url: 'mobilenotes://' },
  { id: 'goodnotes', name: 'GoodNotes', url: 'goodnotes://' },
  { id: 'notability', name: 'Notability', url: 'notability://' },
  { id: 'onenote', name: 'OneNote', url: 'onenote:' },
  { id: 'files', name: 'Files', url: 'shareddocuments://' },
  { id: 'books', name: 'Books', url: 'ibooks://' },
  { id: 'kindle', name: 'Kindle', url: 'kindle://' },
  { id: 'word', name: 'Word', url: 'ms-word:' },
  { id: 'googledocs', name: 'Google Docs', url: 'googledocs://' },
];

export const appById = (id: string | null | undefined) => ONTASK_APPS.find((a) => a.id === id) ?? null;

export async function openApp(app: OnTaskApp): Promise<boolean> {
  try {
    await Linking.openURL(app.url);
    return true;
  } catch {
    return false; // not installed, or it uses a different link
  }
}
