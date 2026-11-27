// Renders the app icon at each size with the preinstalled Playwright Chromium.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const html = (s) => `<html><body style="margin:0;background:#000;width:${s}px;height:${s}px;position:relative;overflow:hidden;font-family:-apple-system,Inter,Roboto,sans-serif">
<div style="position:absolute;left:${s*.2}px;top:${s*.2}px;width:${s*.38}px;height:${s*.54}px;background:#fafafa;border-radius:${s*.07}px;transform:rotate(-10deg);color:#141414">
<div style="position:absolute;left:12%;top:6%;font-size:${s*.2}px">A</div><div style="position:absolute;left:14%;bottom:6%;font-size:${s*.16}px">♠</div></div>
<div style="position:absolute;left:${s*.42}px;top:${s*.25}px;width:${s*.38}px;height:${s*.54}px;background:#fafafa;border-radius:${s*.07}px;transform:rotate(8deg);color:#ef3b36;box-shadow:-${s*.02}px 0 ${s*.05}px rgba(0,0,0,.5)">
<div style="position:absolute;left:12%;top:6%;font-size:${s*.2}px">K</div><div style="position:absolute;left:14%;bottom:6%;font-size:${s*.16}px">♥</div></div></body></html>`;
const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
const p = await b.newPage();
for (const s of [180, 192, 512]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(html(s));
  await p.screenshot({ path: `icons/icon-${s}.png` });
}
await b.close();
