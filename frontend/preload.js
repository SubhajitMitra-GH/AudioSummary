// Runs before the web page in the desktop app. Exposes a tiny marker so the UI can tell it is
// inside the Mac app (start at sign-in, skip the marketing page), plus one narrow channel for
// password-reset links (tellme://reset-password?code=…) that macOS hands to the app.
// No Node or Electron APIs are exposed to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tellme', {
  isDesktop: true,
  platform: process.platform,
  /** Next tellme:// link received by the app, or null. */
  takeAuthLink: () => ipcRenderer.invoke('tellme:take-auth-link'),
  /** Calls back (with no data) when a new link is waiting; returns an unsubscribe function. */
  onAuthLink: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('tellme:auth-link', listener);
    return () => ipcRenderer.removeListener('tellme:auth-link', listener);
  },
});
