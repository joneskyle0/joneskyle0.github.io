'use strict';
/**
 * Client for the FreeMarker sidecar (engine/FtlServer.java).
 * Keeps one long-lived JVM, multiplexes requests by id, restarts on crash.
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ENGINE_DIR = path.join(__dirname, '..', 'engine');
const BUILD_DIR = path.join(ENGINE_DIR, 'build');
const LIB_DIR = path.join(ENGINE_DIR, 'lib');
const REQUEST_TIMEOUT_MS = 20_000;

function findJar() {
  if (!fs.existsSync(LIB_DIR)) return null;
  const jar = fs.readdirSync(LIB_DIR).find((f) => /^freemarker-.*\.jar$/.test(f));
  return jar ? path.join(LIB_DIR, jar) : null;
}

function ensureBuilt() {
  const classFile = path.join(BUILD_DIR, 'FtlServer.class');
  if (findJar() && fs.existsSync(classFile)) return;
  const res = spawnSync('bash', [path.join(ENGINE_DIR, 'build.sh')], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('FreeMarker engine build failed (see output above).');
}

class FtlEngine {
  constructor() {
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.readyPromise = null;
    this.version = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;
    ensureBuilt();
    const jar = findJar();
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
    const cp = [jar, BUILD_DIR].join(path.delimiter);
    const proc = spawn(java, ['-Xss4m', '-cp', cp, 'FtlServer'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stderr.on('data', (d) => {
      const text = d.toString();
      if (!/JAVA_TOOL_OPTIONS/.test(text)) process.stderr.write(`[ftl-engine] ${text}`);
    });
    const rl = readline.createInterface({ input: proc.stdout });

    this.readyPromise = new Promise((resolve, reject) => {
      let ready = false;
      rl.on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (!ready && msg.ready) {
          ready = true;
          this.version = msg.freemarker;
          resolve(this);
          return;
        }
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        entry.resolve(msg);
      });
      proc.on('error', (err) => {
        if (!ready) reject(new Error(`Could not start java: ${err.message}. Is a JDK (17+) installed?`));
        this.failAll(err);
      });
      proc.on('exit', (code) => {
        if (!ready) reject(new Error(`FreeMarker engine exited early with code ${code}`));
        this.failAll(new Error(`FreeMarker engine exited with code ${code}`));
        this.proc = null;
        this.readyPromise = null;
      });
    });
    return this.readyPromise;
  }

  failAll(err) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  /**
   * @param {object} req {name, template, data, locale, lenient, numberFormat, dateFormat}
   * @returns {Promise<{html?: string, error?: {type, message, line, col}}>}
   */
  async render(req) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`FreeMarker render timed out after ${REQUEST_TIMEOUT_MS / 1000}s (infinite loop in template?)`));
        this.stop();
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, ...req }) + '\n');
    });
  }

  stop() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
      this.readyPromise = null;
    }
  }
}

let shared = null;
function getEngine() {
  if (!shared) shared = new FtlEngine();
  return shared;
}

module.exports = { FtlEngine, getEngine, ensureBuilt };
