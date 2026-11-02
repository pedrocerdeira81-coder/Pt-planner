import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(pathToFileURL('/tmp/pt-test/package.json'));
const puppeteer = require('puppeteer-core');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let base;
let docHits = 0;

function contentType(file) {
  const ext = path.extname(file);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.webmanifest') return 'application/manifest+json';
  if (ext === '.png') return 'image/png';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
}

async function waitForApp(page) {
  await page.waitForFunction(() => document.body && document.body.textContent.includes('Dashboard'), { timeout: 90000 });
}

async function setReactValue(page, selector, value) {
  await page.evaluate((selector, value) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error('missing ' + selector);
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (!setter) throw new Error('no value setter for ' + selector);
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}

async function closeModal(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-ui="modal-overlay"]');
    if (el) el.click();
  });
  await page.waitForFunction(() => !document.querySelector('[data-ui="modal-overlay"]'));
}

const seed = {
  'pt-clients': JSON.stringify([{
    id: '1', name: 'Ali', packageSessions: 10, packageValue: 2000, startDate: '2026-01-05'
  }]),
  'pt-sessions': JSON.stringify({
    s: [
      { title: 'Ali PT', date: '2026-06-15', clientName: 'Ali' },
      { title: 'Alison PT', date: '2026-06-15', clientName: 'Alison' },
      { title: 'Ali PT', date: '2026-01-06', clientName: 'ali' }
    ],
    t: '2026-06-16T20:30:00.000Z'
  }),
  'pt-charges': JSON.stringify([{
    id: 'ch1', clientId: '1', type: 'late_cancel', date: '2026-06-16', notes: 'Cancelled 1h before'
  }]),
  'pt-period': JSON.stringify({ start: '2026-06-01', end: '2026-06-30' }),
  'pt-comm': JSON.stringify({ quota: '7758', netFactor: '81.63' })
};

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const rel = pathname.replace(/^\/+/, '');
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (file === path.join(root, 'index.html')) docHits += 1;
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await puppeteer.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('old saved data, editing, and backup restore', { timeout: 240000 }, async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.emulateTimezone('Asia/Dubai');
  let dialogMode = 'dismiss';
  page.on('dialog', async (dialog) => {
    const mode = dialogMode;
    dialogMode = 'dismiss';
    if (mode === 'accept') await dialog.accept();
    else await dialog.dismiss();
  });
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    const tz = await page.evaluate(() => {
      const d = new Date('2026-11-01T21:30:00.000Z');
      return {
        offset: d.getTimezoneOffset(),
        local: window.PT.localDateStr(d),
        utc: d.toISOString().slice(0, 10)
      };
    });
    assert.equal(tz.offset, -240);
    assert.equal(tz.utc, '2026-11-01');
    assert.equal(tz.local, '2026-11-02');

    await page.evaluate((data) => {
      localStorage.clear();
      Object.keys(data).forEach((key) => localStorage.setItem(key, data[key]));
    }, seed);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);

    const stored = await page.evaluate(() => ({
      clients: JSON.parse(localStorage.getItem('pt-clients')),
      sessions: JSON.parse(localStorage.getItem('pt-sessions')),
      charges: JSON.parse(localStorage.getItem('pt-charges')),
      comm: JSON.parse(localStorage.getItem('pt-comm'))
    }));
    assert.equal(stored.clients[0].name, 'Ali');
    assert.equal(stored.clients[0].packages[0].id, '1-pkg1');
    assert.equal(stored.clients[0].packages[0].sessions, '10');
    assert.equal(stored.clients[0].packageSessions, '10');
    assert.equal(stored.clients[0].packageValue, '2000');
    assert.equal(stored.clients[0].startDate, '2026-01-05');
    assert.equal(stored.sessions.t, '2026-06-16T20:30:00.000Z');
    assert.equal(stored.sessions.s[1].clientName, 'Alison');
    assert.ok(stored.sessions.s.every((s) => s.id));
    assert.equal(stored.charges[0].amount, 0);
    assert.equal(stored.charges[0].notes, 'Cancelled 1h before');
    assert.equal(stored.comm.includeCharges, false);

    const text = await page.evaluate(() => document.body.innerText);
    assert.match(text, /Last sync Jun 17/);
    assert.match(text, /2\/10 sessions/);
    assert.match(text, /1 this period/);
    assert.match(text, /1 name not linked to a client/);
    assert.match(text, /Jun 1 - Jun 30/);

    const snap = await page.evaluate(() => ({
      clients: localStorage.getItem('pt-clients'),
      sessions: localStorage.getItem('pt-sessions'),
      charges: localStorage.getItem('pt-charges')
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    const snap2 = await page.evaluate(() => ({
      clients: localStorage.getItem('pt-clients'),
      sessions: localStorage.getItem('pt-sessions'),
      charges: localStorage.getItem('pt-charges')
    }));
    assert.equal(snap2.clients, snap.clients);
    assert.equal(snap2.sessions, snap.sessions);
    assert.equal(snap2.charges, snap.charges);

    await page.click('[data-ui="period-label"]');
    await page.waitForSelector('[data-ui="period-start"]');
    await setReactValue(page, '[data-ui="period-start"]', '2020-01-01');
    await closeModal(page);
    assert.equal(await page.$eval('[data-ui="period-label"]', (el) => el.textContent), 'Jun 1 - Jun 30');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pt-period')).start), '2026-06-01');
    await page.click('[data-ui="period-label"]');
    assert.equal(await page.$eval('[data-ui="period-start"]', (el) => el.value), '2026-06-01');
    await closeModal(page);

    await page.click('[data-ui="tab-report"]');
    await page.waitForSelector('[data-ui="commission-figure"]');
    const figure = await page.$eval('[data-ui="commission-figure"]', (el) => el.textContent.trim());
    await page.click('[data-ui="commission-open"]');
    await setReactValue(page, '[data-ui="commission-quota"]', '0');
    assert.equal(await page.$eval('[data-ui="commission-figure"]', (el) => el.textContent.trim()), figure);
    await closeModal(page);
    assert.equal(await page.$eval('[data-ui="commission-figure"]', (el) => el.textContent.trim()), figure);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pt-comm')).quota), '7758');
    await page.click('[data-ui="commission-open"]');
    assert.equal(await page.$eval('[data-ui="commission-quota"]', (el) => el.value), '7758');
    await setReactValue(page, '[data-ui="commission-quota"]', '1000');
    await page.click('[data-ui="commission-save"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pt-comm')).quota), '1000');
    await page.click('[data-ui="commission-open"]');
    await setReactValue(page, '[data-ui="commission-quota"]', '7758');
    await page.click('[data-ui="commission-save"]');

    await page.click('[data-ui="tab-charges"]');
    await page.waitForFunction(() => document.body.innerText.includes('Add amount'));
    await page.click('[data-ui="edit-charge"]');
    await setReactValue(page, '[data-ui="charge-amount"]', '150');
    await page.click('[data-ui="save-charge"]');
    await page.waitForFunction(() => document.body.innerText.includes('AED 150'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pt-charges'))[0].amount), 150);
    await page.click('[data-ui="tab-report"]');
    await page.waitForFunction(() => /Charges this period AED 150/.test(document.body.innerText) && document.body.innerText.includes('not in your commission'));
    await page.click('[data-ui="commission-open"]');
    await page.click('[data-ui="commission-charges"]');
    await closeModal(page);
    assert.match(await page.evaluate(() => document.body.innerText), /not in your commission/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pt-comm')).includeCharges), false);
    await page.click('[data-ui="commission-open"]');
    await page.click('[data-ui="commission-charges"]');
    await page.click('[data-ui="commission-save"]');
    await page.waitForFunction(() => document.body.innerText.includes('included in commission'));

    await page.click('[data-ui="tab-clients"]');
    await setReactValue(page, '[data-ui="alias-alison"]', '1');
    await page.click('[data-ui="link-alison"]');
    await page.waitForFunction(() => !document.body.innerText.includes('not linked to a client'));
    await page.click('[data-ui="tab-dashboard"]');
    await page.waitForFunction(() => document.body.innerText.includes('3/10 sessions'));
    assert.match(await page.evaluate(() => document.body.innerText), /2 this period/);

    await page.click('[data-ui="tab-clients"]');
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((n) => n.textContent === 'Ali' && (n.getAttribute('style') || '').includes('font-size: 17px'));
      if (!el) throw new Error('Ali card not found');
      el.click();
    });
    await page.waitForSelector('[data-ui="delete-client-session"]');
    const beforeDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('pt-sessions')).s.length);
    dialogMode = 'dismiss';
    await page.click('[data-ui="delete-client-session"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pt-sessions')).s.length), beforeDelete);
    dialogMode = 'accept';
    await page.click('[data-ui="delete-client-session"]');
    await page.waitForFunction((n) => JSON.parse(localStorage.getItem('pt-sessions')).s.length === n - 1, {}, beforeDelete);

    await page.click('[data-ui="edit-client-session"]');
    await setReactValue(page, '[data-ui="session-date"]', '2026-01-08');
    await page.click('[data-ui="session-save"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('pt-sessions')).s.some((s) => s.date === '2026-01-08'));

    await page.click('[data-ui="tab-dashboard"]');
    await page.click('[data-ui="add-session"]');
    await setReactValue(page, '[data-ui="session-client"]', '1');
    await setReactValue(page, '[data-ui="session-date"]', '2026-06-20');
    await page.click('[data-ui="session-save"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('pt-sessions')).s.some((s) => s.date === '2026-06-20' && s.clientName === 'Ali'));

    await page.click('[data-ui="backup-open"]');
    await page.click('[data-ui="show-backup-text"]');
    const exported = JSON.parse(await page.$eval('[data-ui="backup-text"]', (el) => el.value));
    assert.equal(exported.app, 'pt-planner');
    assert.equal(exported.version, 2);
    assert.ok(exported.clients.some((c) => c.name === 'Ali' && c.packages.length === 1));
    const replacement = JSON.stringify({
      app: 'pt-planner',
      version: 2,
      clients: [{ id: '9', name: 'Nora', packageSessions: '4', packageValue: '800', startDate: '2026-02-01' }],
      sessions: [{ title: 'Nora PT', date: '2026-02-02', clientName: 'Nora' }],
      charges: [{ id: 'n1', clientId: '9', type: 'no_show', date: '2026-02-03', notes: '', amount: 75 }],
      period: { start: '', end: '' },
      comm: { quota: '500', netFactor: '80', includeCharges: false }
    });
    await setReactValue(page, '[data-ui="restore-text"]', replacement);
    await page.click('[data-ui="restore-check"]');
    await page.waitForSelector('[data-ui="restore-preview"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pt-clients'))[0].name), 'Ali');
    await page.click('[data-ui="restore-replace"]');
    await page.waitForFunction(() => {
      const clients = JSON.parse(localStorage.getItem('pt-clients') || '[]');
      return clients.length === 1 && clients[0].name === 'Nora' && clients[0].packages && clients[0].packages[0].value === '800';
    });
    const nora = await page.evaluate(() => ({
      client: JSON.parse(localStorage.getItem('pt-clients'))[0],
      sessions: JSON.parse(localStorage.getItem('pt-sessions'))
    }));
    assert.equal(nora.client.packageSessions, '4');
    assert.equal(nora.client.startDate, '2026-02-01');
    assert.equal(nora.sessions.s[0].clientName, 'Nora');
    assert.ok(nora.sessions.s[0].id);
  } catch (err) {
    try { await page.screenshot({ path: '/tmp/pt-planner-fail.png', fullPage: true }); } catch (e) {}
    try {
      const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 2500) : '');
      console.error('PAGE TEXT:\n' + body);
    } catch (e) {}
    throw err;
  } finally {
    await page.close();
  }
});

test('service worker serves a fresh page online and the saved page offline', { timeout: 180000 }, async () => {
  const page = await browser.newPage();
  await page.emulateTimezone('Asia/Dubai');
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !reg.active) return false;
      const keys = await caches.keys();
      if (!keys.length) return false;
      const cache = await caches.open(keys[0]);
      const react = await cache.match('https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js');
      const babel = await cache.match('https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js');
      const shell = await cache.match('./index.html');
      return !!(react && babel && shell);
    }, { timeout: 40000 });
    const mid = docHits;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    assert.ok(docHits > mid, 'an online reload still requests the page');
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    assert.match((await page.evaluate(() => document.body.innerText)).toLowerCase(), /dashboard/);
  } catch (err) {
    try { await page.screenshot({ path: '/tmp/pt-planner-offline-fail.png', fullPage: true }); } catch (e) {}
    try {
      const info = await page.evaluate(async () => {
        const keys = await caches.keys();
        return { keys, text: document.body ? document.body.innerText.slice(0, 800) : '' };
      });
      console.error(JSON.stringify(info));
    } catch (e) {}
    throw err;
  } finally {
    await page.setOfflineMode(false);
    await page.close();
  }
});
