import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = spawnSync(process.execPath, ['tools/build.js'], { cwd: root, encoding: 'utf8' });
assert.equal(built.status, 0, built.stderr || built.stdout);

function pad(n) { return n < 10 ? '0' + n : String(n); }
function dubai(date) { return new Date(date.getTime() + 4 * 60 * 60 * 1000); }

function makeSheet() {
  var rows = [];
  var sheet = {
    getLastRow: function () { return rows.length; },
    clear: function () { rows = []; },
    setFrozenRows: function () {},
    getRange: function (r, c, nr, nc) {
      var range = {
        setValues: function (vals) {
          for (var i = 0; i < vals.length; i++) {
            if (!rows[r - 1 + i]) rows[r - 1 + i] = [];
            for (var j = 0; j < vals[i].length; j++) rows[r - 1 + i][c - 1 + j] = vals[i][j];
          }
          return range;
        },
        getValues: function () {
          var height = nr || 1, width = nc || 1, out = [];
          for (var i = 0; i < height; i++) {
            var line = [];
            for (var j = 0; j < width; j++) {
              var row = rows[r - 1 + i] || [];
              line.push(row[c - 1 + j] == null ? '' : row[c - 1 + j]);
            }
            out.push(line);
          }
          return out;
        },
        getValue: function () {
          var row = rows[r - 1] || [];
          return row[c - 1] == null ? '' : row[c - 1];
        },
        setNumberFormat: function () { return range; },
        setFontWeight: function () { return range; },
        setBackground: function () { return range; }
      };
      return range;
    }
  };
  sheet.getDataRange = function () {
    var width = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].length > width) width = rows[i].length;
    return sheet.getRange(1, 1, Math.max(rows.length, 1), Math.max(width, 1));
  };
  return sheet;
}

function loadGas() {
  var book = { Sheet1: makeSheet() };
  var triggers = [];
  var props = {};
  var emails = [];
  var context = {
    console: console,
    JSON: JSON,
    Math: Math,
    Date: Date,
    Object: Object,
    Array: Array,
    String: String,
    Number: Number,
    isFinite: isFinite,
    isNaN: isNaN,
    HTML_LITERAL: '<!DOCTYPE html><html><body><div id="app"></div></body></html>'
  };
  context.globalThis = context;
  context.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (name) { return book[name] || null; },
        insertSheet: function (name) { book[name] = makeSheet(); return book[name]; },
        getSheets: function () { return Object.keys(book).map(function (k) { return book[k]; }); },
        deleteSheet: function (sh) {
          Object.keys(book).forEach(function (k) { if (book[k] === sh) delete book[k]; });
        }
      };
    }
  };
  context.Utilities = {
    formatDate: function (date, tz, fmt) {
      var t = dubai(date);
      var y = t.getUTCFullYear(), m = pad(t.getUTCMonth() + 1), d = pad(t.getUTCDate());
      var h = pad(t.getUTCHours()), min = pad(t.getUTCMinutes());
      if (fmt === 'yyyy-MM-dd') return y + '-' + m + '-' + d;
      if (fmt === 'HH:mm') return h + ':' + min;
      if (fmt === 'yyyy-MM-dd HH:mm') return y + '-' + m + '-' + d + ' ' + h + ':' + min;
      throw new Error('format ' + fmt);
    },
    parseDate: function (str) {
      var m = String(str).match(/(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/);
      var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      return new Date(utc - 4 * 60 * 60 * 1000);
    }
  };
  context.Session = {
    getActiveUser: function () { return { getEmail: function () { return ''; } }; },
    getEffectiveUser: function () { return { getEmail: function () { return 'pedrocerdeira81@gmail.com'; } }; }
  };
  context.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return props[k] == null ? null : props[k]; },
        setProperty: function (k, v) { props[k] = String(v); }
      };
    }
  };
  context.LockService = {
    getScriptLock: function () {
      return { tryLock: function () { return true; }, releaseLock: function () {} };
    }
  };
  context.ScriptApp = {
    getProjectTriggers: function () {
      return triggers.map(function (name) { return { getHandlerFunction: function () { return name; } }; });
    },
    newTrigger: function (name) {
      var b = {
        timeBased: function () { return b; },
        atHour: function () { return b; },
        nearMinute: function () { return b; },
        everyDays: function () { return b; },
        inTimezone: function () { return b; },
        create: function () { triggers.push(name); return {}; }
      };
      return b;
    },
    deleteTrigger: function () {},
    getService: function () { return { getUrl: function () { return 'https://script.google.com/macros/s/TEST/exec'; } }; }
  };
  context.MailApp = { sendEmail: function (msg) { emails.push(msg); } };
  context.HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createHtmlOutput: function (html) {
      return {
        setTitle: function () { return this; },
        setFaviconUrl: function () { return this; },
        addMetaTag: function () { return this; },
        setXFrameOptionsMode: function () { return this; },
        getContent: function () { return html; }
      };
    }
  };
  function event(id, title, when) {
    return {
      getId: function () { return id; },
      getTitle: function () { return title; },
      getStartTime: function () { return when; },
      getEndTime: function () { return new Date(when.getTime() + 60 * 60 * 1000); },
      getDescription: function () { return 'Charged'; },
      isAllDayEvent: function () { return false; },
      getMyStatus: function () { return 'YES'; },
      getEventType: function () { return 'DEFAULT'; }
    };
  }
  var queries = [];
  context.eventQueries = queries;
  context.CalendarApp = {
    GuestStatus: { NO: 'NO' },
    getAllCalendars: function () {
      var now = new Date();
      var recent = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
      var ancient = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000);
      var all = [
        event('e1', 'Omar PT', now),
        event('e2', 'Sara PT', recent),
        event('e3', 'Aurelie', now),
        event('e4', 'Resumo', now),
        event('e5', 'Lunch', now),
        event('e6', 'Ancient PT', ancient)
      ];
      return [{
        isOwnedByMe: function () { return true; },
        getId: function () { return 'primary'; },
        getEvents: function (start, end) {
          queries.push({ start: start, end: end });
          return all.filter(function (ev) {
            var t = ev.getStartTime().getTime();
            return t >= start.getTime() && t <= end.getTime();
          });
        }
      }, {
        isOwnedByMe: function () { return false; },
        getId: function () { return 'holidays'; },
        getEvents: function () { throw new Error('should not read'); }
      }];
    }
  };
  context.emails = emails;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8'), context, { filename: 'Code.gs' });
  return context;
}

test('first open works when the active email is blank, and PT titles become clients', () => {
  const gas = loadGas();
  const opened = gas.apiGetState();
  assert.match(opened.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(opened.clients.length, 0);
  assert.equal(opened.triggerReady, false);
  const synced = gas.apiSyncNow();
  const names = synced.clients.map((c) => String(c.name)).sort().join(',');
  assert.equal(names, 'Omar,Sara');
  assert.equal(gas.eventQueries.length > 0, true);
  const asked = (Date.now() - gas.eventQueries[0].start.getTime()) / 86400000;
  assert.equal(asked < 130 && asked > 50, true);
  const sara = synced.clients.find((c) => c.name === 'Sara');
  assert.equal(sara.startDate, synced.today);
  assert.equal(gas.PT.packageUsed(sara, synced.sessions, sara.packages[0], synced.clients), 0);
  const omar = synced.clients.find((c) => c.name === 'Omar');
  assert.equal(omar.startDate, synced.today);
  assert.equal(synced.sessions.filter((s) => s.clientName === 'Aurelie' && s.disposition === 'pending').length, 1);
  assert.equal(gas.emails.length, 0);
  const page = gas.doGet();
  assert.match(page.getContent(), /id="app"/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8'), /\.apply\(runner/);
});

function browser() {
  const req = createRequire(import.meta.url);
  try { return req('puppeteer-core'); }
  catch (e) {
    try { return req('/tmp/pt-shot/node_modules/puppeteer-core'); }
    catch (e2) { return null; }
  }
}

function gasStub() {
  var sample = {
    today: '2026-11-03',
    nowLabel: '2026-11-03 06:00 Asia/Dubai',
    lastSync: '2026-11-03 05:00 Asia/Dubai',
    triggerReady: true,
    triggerError: '',
    webAppUrl: 'https://script.google.com/macros/s/TEST/exec',
    clients: [],
    sessions: [],
    charges: [],
    settings: { quota: '7758', netFactor: '81.63', showCommission: true, includeCharges: false, periods: [] },
    ignored: []
  };
  window.__APPLY_USED__ = false;
  window.__CALLS__ = 0;
  window.PT_CALL_TIMEOUT = 800;
  var search = String(location.search || '');
  window.__MODE__ = /boot=hang/.test(search) ? 'hang' : (/boot=fail/.test(search) ? 'fail' : 'ok');
  var success = null;
  var fail = null;
  var runner = {
    withSuccessHandler: function (fn) { success = fn; return runner; },
    withFailureHandler: function (fn) { fail = fn; return runner; },
    apiGetState: function () {
      window.__CALLS__ += 1;
      var n = window.__CALLS__;
      setTimeout(function () {
        if (window.__MODE__ === 'fail' && n === 1) fail(new Error('Calendar is off'));
        else if (window.__MODE__ === 'hang') return;
        else success(sample);
      }, 30);
    },
    apiSyncNow: function () { setTimeout(function () { success(sample); }, 30); }
  };
  runner.apiGetState.apply = function () { window.__APPLY_USED__ = true; };
  window.google = { script: { run: runner } };
}

test('the splash leaves the screen when the server replies, and a failure can be retried', async (t) => {
  const puppeteer = browser();
  if (!puppeteer) return t.skip('puppeteer-core is not installed');
  const chrome = '/usr/local/bin/google-chrome';
  if (!fs.existsSync(chrome)) return t.skip('chrome is not installed');
  const gas = loadGas();
  const file = '/tmp/pt-app.html';
  fs.writeFileSync(file, gas.appHtml_());
  const browserApp = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  async function open(mode) {
    const page = await browserApp.newPage();
    await page.evaluateOnNewDocument(gasStub);
    await page.goto('file://' + file + '?boot=' + mode, { waitUntil: 'domcontentloaded' });
    return page;
  }
  try {
    const ok = await open('ok');
    await ok.waitForFunction(() => document.body.innerText.includes('Set this pay period'), { timeout: 4000 });
    assert.equal(await ok.evaluate(() => window.__APPLY_USED__), false);
    assert.match(await ok.evaluate(() => document.body.innerText), /Update from Calendar/);

    const fail = await open('fail');
    await fail.waitForFunction(() => document.body.innerText.includes('Calendar is off'), { timeout: 4000 });
    await fail.evaluate(() => { window.__MODE__ = 'ok'; });
    await fail.click('[data-act="retry-boot"]');
    await fail.waitForFunction(() => document.body.innerText.includes('Set this pay period'), { timeout: 4000 });

    const hang = await open('hang');
    await hang.waitForFunction(() => document.body.innerText.includes('Try again') && document.body.innerText.includes('too long'), { timeout: 4000 });
  } finally {
    await browserApp.close();
  }
});
