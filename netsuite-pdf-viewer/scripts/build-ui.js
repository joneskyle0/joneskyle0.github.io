'use strict';
/**
 * Bundles the browser UI (CodeMirror + pdf.js) into public/vendor/ with esbuild so the
 * app runs without a CDN. Run via `npm run build:ui` (also on postinstall).
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'public', 'vendor');
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, 'ui', 'editor.js')],
    bundle: true,
    format: 'esm',
    minify: true,
    sourcemap: false,
    target: ['es2020'],
    outfile: path.join(outDir, 'editor.js'),
    logLevel: 'warning'
  });

  const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  for (const f of ['pdf.mjs', 'pdf.worker.mjs']) {
    fs.copyFileSync(path.join(pdfjsDir, 'build', f), path.join(outDir, f));
  }
  console.log('UI bundle written to public/vendor/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
