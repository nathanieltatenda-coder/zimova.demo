// Native bridge for the ZIMOVA phone apps (Android/iPhone). Bundled by build-web.js into www/js/native.bundle.js.
// The website never loads this file, so the plain web app is unaffected.
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App } from '@capacitor/app';
import { BackgroundGeolocation } from '@capgo/background-geolocation';

const api = () => window.ZIMOVA_API || '';
const call = (path, method, body, token) => fetch(api() + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
const platform = Capacitor.getPlatform();
let registeredFor = null, deviceToken = null, trackingOn = false;
const Z = (window.ZNative = { isNative: true, tracking: true, pushOk: false, platform });

// ---- push notifications
PushNotifications.addListener('registration', async t => { deviceToken = t.value; if (!registeredFor) return; try { Z.pushOk = (await call('/devices', 'POST', { token: t.value, platform }, registeredFor)).ok; } catch {} });
PushNotifications.addListener('registrationError', e => console.warn('Push registration failed (is google-services.json in place?)', e));
// While the app is open the system hides push banners, so show them ourselves.
PushNotifications.addListener('pushNotificationReceived', n => { LocalNotifications.schedule({ notifications: [{ id: Date.now() % 2147483647, title: n.title || 'ZIMOVA', body: n.body || '', channelId: 'zimova' }] }).catch(() => {}); });
PushNotifications.addListener('pushNotificationActionPerformed', a => { const k = a.notification && a.notification.data && a.notification.data.kind; if (window.zOpen) window.zOpen(k); });
Z.onLogin = async token => {
  if (registeredFor === token) return; registeredFor = token;
  try {
    if (platform === 'android') await PushNotifications.createChannel({ id: 'zimova', name: 'ZIMOVA trips and payments', description: 'Ride requests, trip updates and payments', importance: 5, visibility: 1, vibration: true }).catch(() => {});
    let p = await PushNotifications.checkPermissions(); if (p.receive === 'prompt') p = await PushNotifications.requestPermissions();
    if (p.receive === 'granted') await PushNotifications.register(); else registeredFor = token;   // stay signed in; bell + local alerts still work
  } catch (e) { console.warn('Push setup failed', e); registeredFor = null; }
};
Z.onLogout = async token => { try { if (deviceToken && token) await fetch(api() + '/api/devices', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ token: deviceToken }) }); } catch {} registeredFor = null; Z.pushOk = false; };
Z.localNotify = async (title, body) => { try { const p = await LocalNotifications.requestPermissions(); if (p.display === 'granted') await LocalNotifications.schedule({ notifications: [{ id: Date.now() % 2147483647, title, body, channelId: 'zimova' }] }); } catch {} };

// ---- driver tracking that keeps working with the screen off. The plugin POSTs each position to the server from native code.
Z.startTracking = async token => {
  if (trackingOn) return; trackingOn = true;
  try { await BackgroundGeolocation.start({ backgroundTitle: 'ZIMOVA trip in progress', backgroundMessage: 'Sharing your live location with your passenger.', requestPermissions: true, distanceFilter: 10, minIntervalMs: 4000, url: api() + '/api/driver/location', headers: { Authorization: 'Bearer ' + token } },
    (pos, err) => { if (err && typeof toast === 'function') toast(err.code === 'NOT_AUTHORIZED' ? 'Allow location access ("Always" if offered) so your passenger can see you.' : 'Location problem: ' + err.message); }); }
  catch (e) { trackingOn = false; console.warn('Tracking failed to start', e); }
};
Z.stopTracking = async () => { if (!trackingOn) return; trackingOn = false; try { await BackgroundGeolocation.stop(); } catch {} };

// ---- look and feel
try { StatusBar.setStyle({ style: Style.Dark }); if (platform === 'android') StatusBar.setBackgroundColor({ color: '#0a0a0a' }); } catch {}
App.addListener('backButton', () => { const m = document.querySelector('.modal.in'); if (m) m.click(); else if (window.curView && !['passenger', 'driver', 'admin', 'welcome'].includes(window.curView)) window.zHome && window.zHome(); else App.exitApp(); });
