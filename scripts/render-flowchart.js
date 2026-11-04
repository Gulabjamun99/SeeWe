/* eslint-disable @typescript-eslint/no-require-imports -- standalone node script (not part of the Next build) */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
  await page.goto('file://' + path.resolve('/home/z/my-project/flowchart-seewee.html'));
  await page.waitForTimeout(600);

  // Auto-resize viewport to fit content
  const size = await page.evaluate(() => {
    const root = document.getElementById('root');
    const r = root.getBoundingClientRect();
    return { w: Math.max(r.width, document.body.scrollWidth), h: document.body.scrollHeight };
  });
  await page.setViewportSize({ width: Math.ceil(size.w + 40), height: Math.ceil(size.h + 40) });
  await page.waitForTimeout(300);

  await page.screenshot({ path: '/home/z/my-project/seewee-flow-chart.png', fullPage: true });

  // Overlap check: verify no step text is clipped
  const check = await page.evaluate(() => {
    let issues = 0;
    document.querySelectorAll('.phase-step, .flow-arrow .label, .rules-box').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 2) issues++;
    });
    return { issues, phases: document.querySelectorAll('.phase-group').length, steps: document.querySelectorAll('.phase-step').length };
  });
  console.log('render-ok', JSON.stringify(check));
  await browser.close();
})();
