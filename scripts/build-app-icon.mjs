// Package the unmodified NofyAI mark on a desktop icon plate.
// This script is only needed when regenerating the checked-in icon assets.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const folder = new URL('../assets/branding/', import.meta.url);
const mark = await readFile(new URL('nofyai-icon-1024.png', folder));
const src = `data:image/png;base64,${mark.toString('base64')}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  // Measure transparent padding so the original artwork can stay untouched.
  const bounds = await page.evaluate(async src => {
    const img = new Image(); img.src = src; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 0, img.width, img.height).data;
    let left = img.width, top = img.height, right = -1, bottom = -1;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      if (pixels[(y * img.width + x) * 4 + 3] > 16) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right < left) throw new Error('Brand mark has no visible pixels');
    return { left, top, width: right - left + 1, height: bottom - top + 1, sourceWidth: img.width, sourceHeight: img.height };
  }, src);
  const scale = 608 / bounds.width;
  const x = (1024 - bounds.width * scale) / 2 - bounds.left * scale;
  const y = (1024 - bounds.height * scale) / 2 - bounds.top * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>nofy-helper application icon</title>
  <rect x="72" y="72" width="880" height="880" rx="196" fill="#faf9f7" stroke="#e5e2df" stroke-width="2"/>
  <image href="${src}" x="${x}" y="${y}" width="${bounds.sourceWidth * scale}" height="${bounds.sourceHeight * scale}"/>
</svg>\n`;
  await writeFile(new URL('nofy-helper-app.svg', folder), svg);
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
  await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('image')].map(image => new Promise((resolve, reject) => { const img = new Image(); img.onload = resolve; img.onerror = reject; img.src = image.getAttribute('href'); }))); });
  await page.screenshot({ path: new URL('nofy-helper-app.png', folder).pathname, omitBackground: true });
  console.log(JSON.stringify({ originalBounds: bounds, output: '1024×1024', visibleMarkWidth: 608, plateWidth: 880 }));
} finally { await browser.close(); }
