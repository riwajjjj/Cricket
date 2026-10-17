/* Crease — offline support and installing as an app.
   Registers the service worker (sw.js), shows an "Install app" button when the browser offers one,
   and tells the scorer when the connection drops. Nothing here is needed for the app to work. */
import { toast } from './ui.js';
import { $ } from './utils.js';

const installBtn = $('#install-btn');
let installEvent = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); // show our own button instead of the browser's mini-bar
  installEvent = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  try { await installEvent.userChoice; } catch { /* dismissed */ }
  installEvent = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; toast('Crease is installed'); });

window.addEventListener('offline', () => toast('You\'re offline. Scoring and saving still work.'));
window.addEventListener('online', () => toast('Back online'));

// Service workers need http(s); opened from a file, or inside a sandboxed frame, this quietly does nothing.
function register() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const first = !navigator.serviceWorker.controller;
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state !== 'activated') return;
        toast(first ? 'Ready to work offline' : 'Crease was updated. Reload to use the new version.');
      });
    });
  }).catch(() => { /* unsupported here */ });
}
if (document.readyState === 'complete') register();
else window.addEventListener('load', register);
