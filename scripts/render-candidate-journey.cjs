/* eslint-disable @typescript-eslint/no-require-imports */
/* Render candidate-journey.html -> PNG (Playwright, deviceScaleFactor 2, fullPage) */
const path = require('path');

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    ({ chromium } = require('/home/z/my-project/node_modules/playwright'));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1460, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto('file://' + path.resolve('/home/z/my-project/docs/candidate-journey.html'));
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    h: document.documentElement.scrollHeight,
  }));
  if (m.sw > m.cw + 2) {
    console.log('WARN horizontal overflow: scrollWidth=' + m.sw + ' clientWidth=' + m.cw);
  } else {
    console.log('overflow-check OK (no horizontal overflow)');
  }
  await page.screenshot({
    path: '/home/z/my-project/docs/candidate-journey.png',
    fullPage: true,
  });
  console.log('render-ok height=' + m.h);
  await browser.close();
}

main().catch((e) => {
  console.error('render-failed:', e.message);
  process.exit(1);
});
