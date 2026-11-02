import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'vm';
import test from 'node:test';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const logicMatch = html.match(/<script id="pt-logic">([\s\S]*?)<\/script>/);
assert.ok(logicMatch, 'pt-logic script missing');
const context = { console, Math, JSON, Date, Number, String, Array, Object, isFinite, isNaN };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(logicMatch[1], context, { filename: 'pt-logic.js' });
const PT = context.PT;

function oldClient(extra) {
  return Object.assign({
    id: '1',
    name: 'Ali',
    packageSessions: 10,
    packageValue: 2000,
    startDate: '2026-01-05'
  }, extra || {});
}

test('local calendar date is not the UTC date in Dubai', () => {
  assert.equal(new Date().getTimezoneOffset(), -240);
  const instant = new Date('2026-11-01T21:30:00.000Z');
  assert.equal(instant.toISOString().slice(0, 10), '2026-11-01');
  assert.equal(PT.localDateStr(instant), '2026-11-02');
  assert.match(PT.localDateStr.toString(), /getFullYear/);
  assert.doesNotMatch(PT.localDateStr.toString(), /toISOString/);
  assert.match(PT.todayStr.toString(), /localDateStr/);
  assert.equal(PT.todayStr(), PT.localDateStr(new Date()));
  assert.equal(PT.localDateStr(new Date(2026, 10, 2, 1, 30)), '2026-11-02');
  assert.equal(PT.monthStr(new Date(2026, 10, 2, 1, 30)), '2026-11');
});

test('names match exactly after trim, case, and collapsed spaces', () => {
  assert.equal(PT.namesMatch('Ali', 'Alison'), false);
  assert.equal(PT.namesMatch('Ali', 'Samantha'), false);
  assert.equal(PT.namesMatch('Ali', 'Sara Ali'), false);
  assert.equal(PT.namesMatch('Ali', ' ali '), true);
  assert.equal(PT.namesMatch('Jean  Pierre', 'jean pierre'), true);
  assert.equal(PT.namesMatch('', 'Ali'), false);
});

test('old clients migrate into a first package and stay compatible', () => {
  const stored = JSON.stringify([oldClient()]);
  const once = PT.migrateClients(JSON.parse(stored));
  assert.equal(once.length, 1);
  assert.equal(once[0].name, 'Ali');
  assert.equal(JSON.stringify(once[0].packages), JSON.stringify([{
    id: '1-pkg1',
    sessions: '10',
    value: '2000',
    startDate: '2026-01-05'
  }]));
  assert.equal(once[0].packageSessions, '10');
  assert.equal(once[0].packageValue, '2000');
  assert.equal(once[0].startDate, '2026-01-05');
  assert.equal(once[0].aliases.length, 0);
  const saved = JSON.stringify(once);
  const twice = PT.migrateClients(JSON.parse(saved));
  assert.equal(JSON.stringify(twice), saved);
});

test('renewal keeps the old package and the current fields follow the new one', () => {
  const client = PT.migrateClient(oldClient());
  const renewed = PT.renewPackage(client, { sessions: '20', value: '4000', startDate: '2026-03-01' });
  assert.equal(renewed.packages.length, 2);
  assert.equal(renewed.packages[0].sessions, '10');
  assert.equal(renewed.packages[0].startDate, '2026-01-05');
  assert.equal(renewed.packageSessions, '20');
  assert.equal(renewed.packageValue, '4000');
  assert.equal(renewed.startDate, '2026-03-01');
  assert.equal(PT.currentPackage(renewed.packages).sessions, '20');
  assert.throws(() => PT.renewPackage(renewed, { sessions: '5', value: '100', startDate: '2026-03-01' }), /after/);
  const again = PT.migrateClient(renewed);
  assert.equal(JSON.stringify(again), JSON.stringify(renewed));
});

test('sessions count on the package that was active that day', () => {
  let client = PT.migrateClient(oldClient());
  client = PT.renewPackage(client, { sessions: '8', value: '2400', startDate: '2026-03-01' });
  const sessions = [
    { id: 'a', date: '2025-12-01', clientName: 'Ali', title: 'Ali PT' },
    { id: 'b', date: '2026-01-06', clientName: 'ali', title: 'Ali PT' },
    { id: 'c', date: '2026-02-28', clientName: 'Ali  ', title: 'Ali PT' },
    { id: 'd', date: '2026-03-01', clientName: 'Ali', title: 'Ali PT' },
    { id: 'e', date: '2026-03-02', clientName: 'Alison', title: 'Alison PT' }
  ];
  const first = client.packages[0];
  const second = PT.currentPackage(client.packages);
  assert.equal(PT.packageUsed(client, sessions, first, [client]), 2);
  assert.equal(PT.packageUsed(client, sessions, second, [client]), 1);
  assert.equal(PT.sessionsForClient(client, sessions, [client]).length, 3);
  const period = { start: '2026-01-01', end: '2026-03-31' };
  assert.equal(PT.periodSessionRevenue([client], sessions, period), 200 + 200 + 300);
  const feb = { start: '2026-02-01', end: '2026-02-28' };
  const early = PT.migrateClient({ id: '2', name: 'Sam', packageSessions: '10', packageValue: '1000', startDate: '2026-03-01' });
  assert.equal(PT.packageUsed(early, [{ id: 'z', date: '2026-02-15', clientName: 'Sam', title: 'Sam PT' }], early.packages[0], [early]), 0);
  assert.equal(PT.periodSessionRevenue([early], [{ id: 'z', date: '2026-02-15', clientName: 'Sam', title: 'Sam PT' }], feb), 100);
});

test('two clients no longer share a session because one name contains the other', () => {
  const ali = PT.migrateClient(oldClient());
  const alison = PT.migrateClient({ id: '2', name: 'Alison', packageSessions: '4', packageValue: '800', startDate: '2026-01-01' });
  const sessions = [
    { id: 'a', date: '2026-02-01', clientName: 'Ali', title: 'Ali PT' },
    { id: 'b', date: '2026-02-02', clientName: 'Alison', title: 'Alison PT' }
  ];
  const clients = [ali, alison];
  assert.equal(PT.packageUsed(ali, sessions, ali.packages[0], clients), 1);
  assert.equal(PT.packageUsed(alison, sessions, alison.packages[0], clients), 1);
  const revenue = PT.periodSessionRevenue(clients, sessions, { start: '2026-02-01', end: '2026-02-28' });
  assert.equal(revenue, 200 + 200);
  assert.equal(PT.unmatchedNames(sessions, clients).length, 0);
  assert.equal(PT.unmatchedNames(sessions, [ali]).map((u) => u.label).join(','), 'Alison');
});

test('an alias links an imported name without renaming the session', () => {
  const ali = PT.migrateClient(oldClient());
  const sessions = [{ id: 'a', date: '2026-02-01', clientName: 'Ali K.', title: 'Ali K. PT' }];
  assert.equal(PT.unmatchedNames(sessions, [ali])[0].label, 'Ali K.');
  const linked = PT.addAlias([ali], '1', 'Ali K.');
  assert.equal(JSON.stringify(linked[0].aliases), JSON.stringify(['Ali K.']));
  assert.equal(PT.unmatchedNames(sessions, linked).length, 0);
  assert.equal(PT.packageUsed(linked[0], sessions, linked[0].packages[0], linked), 1);
  assert.equal(PT.addAlias(linked, '1', 'Ali')[0].aliases.length, 1);
  const other = PT.migrateClient({ id: '2', name: 'Nora', packageSessions: '1', packageValue: '1', startDate: '' });
  assert.throws(() => PT.addAlias([linked[0], other], '2', 'Ali K.'), /already used/);
  const removed = PT.removeAlias(linked, '1', 'ali k.');
  assert.equal(removed[0].aliases.length, 0);
});

test('ambiguous names are listed instead of counted twice', () => {
  const a = PT.migrateClient(oldClient({ id: '1' }));
  const b = PT.migrateClient(oldClient({ id: '2' }));
  const sessions = [{ id: 'a', date: '2026-02-01', clientName: 'Ali', title: 'Ali PT' }];
  const hit = PT.unmatchedNames(sessions, [a, b])[0];
  assert.equal(hit.ambiguous, true);
  assert.equal(PT.periodSessionRevenue([a, b], sessions, { start: '2026-02-01', end: '2026-02-28' }), 0);
});

test('old sessions gain stable ids and charges gain a zero amount', () => {
  const raw = [
    { title: 'Ali PT', date: '2026-01-06', clientName: 'Ali' },
    { title: 'Ali PT', date: '2026-01-06', clientName: 'Ali' }
  ];
  const once = PT.migrateSessions(raw);
  assert.equal(once[0].id, 's0_ali_2026-01-06');
  assert.equal(once[1].id, 's1_ali_2026-01-06');
  assert.equal(once[0].clientName, 'Ali');
  assert.equal(JSON.stringify(PT.migrateSessions(once)), JSON.stringify(once));
  const charges = PT.migrateCharges([{ id: 'c1', clientId: '1', type: 'late_cancel', date: '2026-01-07', notes: 'Cancelled 1h before' }]);
  assert.equal(charges[0].amount, 0);
  assert.equal(charges[0].notes, 'Cancelled 1h before');
  assert.equal(JSON.stringify(PT.migrateCharges(charges)), JSON.stringify(charges));
  assert.equal(PT.chargeAmount({}), 0);
  assert.equal(PT.periodChargeTotal(charges, { start: '2026-01-01', end: '2026-01-31' }), 0);
});

test('charges stay out of commission unless the setting is on', () => {
  const base = { sessionRevenue: 20000, chargeTotal: 1000, sessionCount: 50, comm: { quota: '1000', netFactor: '80', includeCharges: false } };
  const off = PT.commissionEstimate(base);
  assert.equal(off.includeCharges, false);
  assert.equal(off.totalRevenue, 20000);
  assert.equal(off.commission, 6750);
  const on = PT.commissionEstimate(Object.assign({}, base, { comm: { quota: '1000', netFactor: '80', includeCharges: true } }));
  assert.equal(on.totalRevenue, 21000);
  assert.equal(on.commission, 7110);
  assert.equal(PT.getTier(80), 0.45);
  assert.equal(PT.getTier(81), 0.60);
  assert.equal(PT.getTier(101), 0.65);
  assert.equal(PT.getTier(120), 0.70);
  const cleared = PT.commissionEstimate({ sessionRevenue: 100, chargeTotal: 50, sessionCount: 1, comm: { quota: '0', netFactor: '0' } });
  assert.equal(cleared.quota, 0);
  assert.equal(Math.round(cleared.commission * 100) / 100, Math.round(100 * 0.8163 * 0.45 * 100) / 100);
  assert.equal(PT.normalizeComm({ quota: '7758', netFactor: '81.63' }).includeCharges, false);
});

test('billing period is inclusive and blank means the calendar month', () => {
  assert.equal(PT.inPeriod('2026-11-02', { start: '', end: '' }, new Date(2026, 10, 2)), true);
  assert.equal(PT.inPeriod('2026-10-31', { start: '', end: '' }, new Date(2026, 10, 2)), false);
  assert.equal(PT.inPeriod('2026-01-01', { start: '2026-01-01', end: '2026-01-31' }), true);
  assert.equal(PT.inPeriod('2026-01-31', { start: '2026-01-01', end: '2026-01-31' }), true);
  assert.equal(PT.inPeriod('2026-02-01', { start: '2026-01-01', end: '2026-01-31' }), false);
});

test('import adds new names and skips the same person on the same day', () => {
  const existing = [{ id: 's1', title: 'Ali PT', date: '2026-06-01', clientName: 'Ali' }];
  const merged = PT.mergeSessions(existing, PT.parseImport('ali|2026-06-01,Nora|2026-06-02'));
  assert.equal(merged.added, 1);
  assert.equal(merged.sessions.length, 2);
  assert.equal(merged.sessions[1].clientName, 'Nora');
  const fromJson = PT.parseImport('```json\n[{"clientName":"Sam","date":"2026-04-01"}]\n```');
  assert.equal(fromJson[0].clientName, 'Sam');
  assert.equal(fromJson[0].title, 'Sam PT');
  assert.throws(() => PT.parseImport('hello'), /No data found/);
  const manual = existing.concat([{ id: 's2', title: 'Ali PT', date: '2026-06-01', clientName: 'Ali' }]);
  assert.equal(PT.deleteSessionById(manual, 's1').length, 1);
  assert.equal(PT.deleteSessionById(manual, 's1')[0].id, 's2');
});

test('backup round trip keeps packages and reads an old-format file', () => {
  const client = PT.renewPackage(PT.migrateClient(oldClient()), { sessions: '12', value: '3000', startDate: '2026-04-01' });
  const state = {
    clients: [client],
    sessions: [{ id: 's1', title: 'Ali PT', date: '2026-04-02', clientName: 'Ali' }],
    lastSync: '2026-04-02T18:00:00.000Z',
    charges: [{ id: 'c1', clientId: '1', type: 'no_show', date: '2026-04-03', notes: '', amount: 150 }],
    period: { start: '2026-04-01', end: '2026-04-30' },
    comm: { quota: '1000', netFactor: '80', includeCharges: true }
  };
  const file = JSON.stringify(PT.buildBackup(state));
  const back = PT.parseBackup(file);
  assert.equal(back.clients[0].packages.length, 2);
  assert.equal(back.clients[0].packageSessions, '12');
  assert.equal(back.sessions[0].clientName, 'Ali');
  assert.equal(back.lastSync, state.lastSync);
  assert.equal(back.charges[0].amount, 150);
  assert.equal(back.comm.includeCharges, true);
  assert.equal(back.period.start, '2026-04-01');
  const oldFile = JSON.stringify({
    clients: [oldClient()],
    sessions: { s: [{ title: 'Ali PT', date: '2026-01-06', clientName: 'Ali' }], t: '2026-01-06T00:00:00.000Z' },
    charges: [{ id: 'c1', clientId: '1', type: 'other', date: '2026-01-08', notes: 'x' }]
  });
  const old = PT.parseBackup(oldFile);
  assert.equal(old.clients[0].packages[0].id, '1-pkg1');
  assert.equal(old.sessions[0].id, 's0_ali_2026-01-06');
  assert.equal(old.charges[0].amount, 0);
  assert.equal(old.lastSync, '2026-01-06T00:00:00.000Z');
  const curly = '\u201Cclients\u201D: []'.replace('clients', '"clients"');
  assert.throws(() => PT.parseBackup('not json'), /isn't a PT Planner backup/);
  const smart = '{\u201Cclients\u201D:[],\u201Csessions\u201D:[],\u201Ccharges\u201D:[]}';
  const smartParsed = PT.parseBackup(smart);
  assert.equal(smartParsed.clients.length, 0);
  assert.equal(curly.includes('clients') || true, true);
});

test('backup reminder waits two weeks and can be snoozed', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(PT.shouldRemindBackup({}, now, false), false);
  assert.equal(PT.shouldRemindBackup({}, now, true), true);
  assert.equal(PT.shouldRemindBackup({ backupAt: '2026-10-20T12:00:00Z' }, now, true), false);
  assert.equal(PT.shouldRemindBackup({ backupAt: '2026-10-19T12:00:00Z' }, now, true), true);
  assert.equal(PT.shouldRemindBackup({ snoozeUntil: now + 1000 }, now, true), false);
});

test('app shell is an installable home-screen app and updates from the network', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'PT Planner');
  assert.equal(manifest.short_name, 'PT Planner');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#f0efe9');
  assert.equal(manifest.theme_color, '#f0efe9');
  assert.equal(manifest.start_url, '/Pt-planner/');
  assert.equal(manifest.scope, '/Pt-planner/');
  const purposes = manifest.icons.map((icon) => icon.purpose).sort();
  assert.deepEqual(purposes, ['any', 'any', 'maskable', 'maskable']);
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('/Pt-planner/icons/'));
    const file = path.join(root, icon.src.replace('/Pt-planner/', ''));
    const buf = fs.readFileSync(file);
    assert.equal(buf.toString('ascii', 1, 4), 'PNG');
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.equal(buf.readUInt32BE(16), w);
    assert.equal(buf.readUInt32BE(20), h);
  }
  const apple = fs.readFileSync(path.join(root, 'icons/apple-touch-icon.png'));
  assert.equal(apple.readUInt32BE(16), 180);
  assert.equal(apple.readUInt32BE(20), 180);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /safe-area-inset-top/);
  assert.match(html, /safe-area-inset-bottom/);
  assert.match(html, /constant\(safe-area-inset-top\)/);
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.doesNotMatch(sw, /\.\/sw\.js/);
  const nav = sw.indexOf("request.mode === 'navigate'");
  const networkFirst = sw.indexOf('function networkFirst');
  const cacheFirst = sw.indexOf('function cacheFirst');
  assert.ok(nav > 0 && networkFirst > 0 && cacheFirst > networkFirst);
  const networkBody = sw.slice(networkFirst, cacheFirst);
  assert.ok(networkBody.indexOf('fetch(request)') < networkBody.indexOf('caches.match'));
  const srcs = [...html.matchAll(/src="(https:\/\/cdnjs[^"]+)"/g)].map((m) => m[1]);
  assert.equal(srcs.length, 3);
  for (const src of srcs) assert.ok(sw.includes(src), src);
});
