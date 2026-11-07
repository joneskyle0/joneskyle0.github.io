'use strict';
/** Chromium (Playwright) backend: HTML -> PDF bytes, PDF -> PNG pages. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let browserPromise = null;

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    throw new Error('playwright is not installed. Run `npm install` (and `npx playwright install chromium` on a fresh machine).');
  }
}

async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = loadPlaywright();
    const launchOpts = { headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] };
    const exe = process.env.NSV_CHROMIUM_PATH || process.env.CHROME_PATH;
    if (exe) launchOpts.executablePath = exe;
    browserPromise = chromium.launch(launchOpts).then((browser) => {
      // If Chromium dies (OOM, killed, crash) relaunch it on the next request.
      browser.on('disconnected', () => { browserPromise = null; });
      return browser;
    }).catch((err) => {
      browserPromise = null;
      throw new Error(`Could not launch Chromium: ${err.message}\nOn a new machine run: npx playwright install chromium`);
    });
  }
  return browserPromise;
}

/**
 * @param {{html:string, pdfOptions:object}} doc  output of bfo.convert(..., {mode:'print'})
 * @returns {Promise<Buffer>}
 */
async function htmlToPdf(doc, attempt = 0) {
  const browser = await getBrowser();
  let context;
  try {
    context = await browser.newContext();
  } catch (err) {
    if (attempt === 0 && /closed/i.test(err.message)) { browserPromise = null; return htmlToPdf(doc, 1); }
    throw err;
  }
  const page = await context.newPage();
  try {
    await page.emulateMedia({ media: 'print' });
    await page.setContent(doc.html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf(doc.pdfOptions);
  } finally {
    await context.close();
  }
}

/**
 * Render each page of a PDF to PNG using Chromium's PDF viewer is not possible headlessly,
 * so we draw the PDF with pdf.js inside a page instead.
 * @returns {Promise<Buffer[]>} one PNG per page
 */
async function pdfToPngs(pdfBuffer, { scale = 2, maxPages = 20 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const pdfMjs = fs.readFileSync(path.join(pdfjsDir, 'build', 'pdf.mjs'), 'utf8');
  const workerMjs = fs.readFileSync(path.join(pdfjsDir, 'build', 'pdf.worker.mjs'), 'utf8');
  try {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.endsWith('/pdf.mjs')) return route.fulfill({ body: pdfMjs, contentType: 'text/javascript' });
      if (url.endsWith('/pdf.worker.mjs')) return route.fulfill({ body: workerMjs, contentType: 'text/javascript' });
      if (url.endsWith('/index.html')) return route.fulfill({ body: '<!doctype html><html><body></body></html>', contentType: 'text/html' });
      return route.abort();
    });
    await page.goto('http://nsv.local/index.html');
    const pngs = await page.evaluate(async ({ b64, scale, maxPages }) => {
      const pdfjs = await import('/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const pdf = await pdfjs.getDocument({ data: bytes }).promise;
      const out = [];
      for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
        const p = await pdf.getPage(i);
        const viewport = p.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        out.push(canvas.toDataURL('image/png').split(',')[1]);
      }
      return out;
    }, { b64: pdfBuffer.toString('base64'), scale, maxPages });
    return pngs.map((b) => Buffer.from(b, 'base64'));
  } finally {
    await context.close();
  }
}

async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close();
  }
}

module.exports = { htmlToPdf, pdfToPngs, closeBrowser, getBrowser };
