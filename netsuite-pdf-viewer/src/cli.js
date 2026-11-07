#!/usr/bin/env node
'use strict';
/**
 * Render a NetSuite template from the command line.
 *
 *   npm run render -- templates/invoice.ftl samples/invoice.json -o out/invoice.pdf [--png] [--html] [--lenient]
 *
 * Exit codes: 0 ok, 2 template error (message printed with line/column), 1 other failure.
 */
const fs = require('node:fs');
const path = require('node:path');
const { renderDocument, RenderError, ROOT } = require('./render');
const pdf = require('./pdf');
const { getEngine } = require('./ftl');

function usage() {
  console.error(`Usage: npm run render -- <template.ftl> [sample.json] [-o out.pdf] [--png] [--html] [--lenient] [--locale en_US]

  -o, --out <file>   Output PDF path (default: out/<template-name>.pdf)
  --png              Also write one PNG per page next to the PDF (<name>-1.png, ...)
  --html             Also write the converted print HTML (<name>.html)
  --lenient          Keep rendering on missing values (FreeMarker HTML debug handler)
  --locale <tag>     FreeMarker locale (default en_US)
`);
}

function parseArgs(argv) {
  const args = { positional: [], png: false, html: false, lenient: false, locale: undefined, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a === '--png') args.png = true;
    else if (a === '--html') args.html = true;
    else if (a === '--lenient') args.lenient = true;
    else if (a === '--locale') args.locale = argv[++i];
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a.startsWith('-')) { console.error(`Unknown option ${a}`); usage(); process.exit(1); }
    else args.positional.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [templatePath, samplePath] = args.positional;
  if (!templatePath) { usage(); process.exit(1); }

  const template = fs.readFileSync(templatePath, 'utf8');
  let sample = {};
  if (samplePath) {
    try {
      sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    } catch (err) {
      console.error(`Could not read sample JSON ${samplePath}: ${err.message}`);
      process.exit(1);
    }
  }
  const base = path.basename(templatePath).replace(/\.(ftl|xml|html?)$/i, '');
  const outPdf = args.out || path.join(ROOT, 'out', `${base}.pdf`);
  fs.mkdirSync(path.dirname(outPdf), { recursive: true });

  const started = Date.now();
  let result;
  try {
    result = await renderDocument({
      template,
      name: path.basename(templatePath),
      sample,
      mode: 'print',
      lenient: args.lenient,
      locale: args.locale
    });
  } catch (err) {
    if (err instanceof RenderError) {
      const { type, line, col, message } = err.detail;
      console.error(`Template ${type} error in ${templatePath}${line ? ` at line ${line}, column ${col}` : ''}:\n${message}`);
      process.exit(2);
    }
    throw err;
  }

  const pdfBuffer = await pdf.htmlToPdf(result.doc);
  fs.writeFileSync(outPdf, pdfBuffer);
  const written = [outPdf];
  if (args.html) {
    const htmlPath = outPdf.replace(/\.pdf$/i, '') + '.html';
    fs.writeFileSync(htmlPath, result.doc.html);
    written.push(htmlPath);
  }
  if (args.png) {
    const pngs = await pdf.pdfToPngs(pdfBuffer);
    pngs.forEach((buf, i) => {
      const p = outPdf.replace(/\.pdf$/i, '') + `-${i + 1}.png`;
      fs.writeFileSync(p, buf);
      written.push(p);
    });
  }
  for (const w of result.warnings) console.error(`warning: ${w}`);
  console.log(`Rendered ${templatePath} in ${Date.now() - started}ms (FreeMarker ${getEngine().version}):`);
  for (const w of written) console.log(`  ${path.relative(process.cwd(), w)}`);
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pdf.closeBrowser();
    getEngine().stop();
  });
