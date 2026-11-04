// Copies the website into www/, points it at your hosted server, and bundles the native bridge.
//   ZIMOVA_API_URL=https://your-server.example.com npm run sync
const fs = require('fs'), path = require('path'), esbuild = require('esbuild');
const api = (process.env.ZIMOVA_API_URL || '').replace(/\/+$/, ''), web = (process.env.ZIMOVA_WEB_URL || api).replace(/\/+$/, '');
if (!/^https:\/\//.test(api)) { console.error('Set ZIMOVA_API_URL to your server\'s HTTPS address, e.g.\n  ZIMOVA_API_URL=https://zimova.example.com npm run sync\n(Phones refuse plain http, and "localhost" means the phone itself. Use a hosted server or an https tunnel.)'); process.exit(1); }
const out = path.join(__dirname, 'www'); fs.rmSync(out, { recursive: true, force: true }); fs.cpSync(path.join(__dirname, '..', 'public'), out, { recursive: true });
fs.writeFileSync(path.join(out, 'js', 'config.js'), `window.ZIMOVA_API=${JSON.stringify(api)};window.ZIMOVA_WEB=${JSON.stringify(web)};\n`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src', 'native.js')], bundle: true, minify: true, format: 'iife', target: 'es2020', outfile: path.join(out, 'js', 'native.bundle.js') });
const f = path.join(out, 'index.html'); let h = fs.readFileSync(f, 'utf8'); if (!h.includes('<script src="js/maps.js">')) throw new Error('index.html changed: cannot inject native bridge');
fs.writeFileSync(f, h.replace('<script src="js/maps.js">', '<script src="js/native.bundle.js"></script><script src="js/maps.js">')); console.log('Built mobile/www for', api);
