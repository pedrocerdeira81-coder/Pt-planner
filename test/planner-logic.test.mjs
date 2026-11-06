import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import PT from '../src/logic.js';

const TODAY = '2026-11-02';
const WINDOW = { windowStart: '2025-09-28', windowEnd: '2026-12-31', nowStamp: TODAY + ' 05:07' };

function client(extra) {
  return PT.migrateClient(Object.assign({
    id: 'larissa',
    name: 'Larissa',
    packageSessions: '20',
    packageValue: '7000',
    startDate: '2026-09-01'
  }, extra || {}));
}

function ev(id, title, date, note, start) {
  return {
    eventId: id,
    calendarId: 'primary',
    title: title,
    date: date,
    start: start || '07:00',
    end: '08:00',
    allDay: false,
    note: note || ''
  };
}

test('calendar titles keep the client and drop a trailing PT', () => {
  assert.deepEqual(PT.parseTitle('Larissa PT'), { display: 'Larissa', key: 'larissa', explicit: true, free: false });
  assert.deepEqual(PT.parseTitle('Jeremy Pt '), { display: 'Jeremy', key: 'jeremy', explicit: true, free: false });
  assert.deepEqual(PT.parseTitle('Jeremy Pt.'), { display: 'Jeremy', key: 'jeremy', explicit: true, free: false });
  assert.deepEqual(PT.parseTitle('Mohammad family PT'), { display: 'Mohammad family', key: 'mohammad family', explicit: true, free: false });
  assert.equal(PT.parseTitle('  aurelie ').explicit, false);
  assert.equal(PT.parseTitle('O pai morreu').explicit, false);
  assert.equal(PT.parseTitle('PT Omar').explicit, false);
  assert.equal(PT.parseTitle('script').explicit, false);
  assert.equal(PT.parseTitle('Larissa - PT').explicit, true);
  assert.equal(PT.parseTitle('Larissa - PT').display, 'Larissa');
  assert.equal(PT.parseTitle('Freedom PT').free, false);
  assert.equal(PT.parseTitle('Freedom PT').display, 'Freedom');
  assert.equal(PT.parseTitle('Larissa free PT').free, true);
  assert.equal(PT.parseTitle('Larissa free PT').display, 'Larissa free');
});

test('only a title that ends in PT is kept, and stored non-PT rows are cleared', () => {
  const clients = [client()];
  const stored = [{
    eventId: 'old',
    title: 'O pai morreu',
    clientName: 'O pai morreu',
    date: '2026-08-01',
    start: '09:00',
    status: 'normal',
    disposition: 'pending',
    hidden: false,
    removed: false
  }];
  const result = PT.applySync(stored, [
    ev('1', 'Resumo', TODAY),
    ev('2', 'New month', TODAY),
    ev('3', 'O pai morreu', TODAY),
    ev('4', 'Larissa PT', TODAY),
    ev('5', 'Aurelie ', TODAY, 'Nao tem sessoes'),
    ev('6', 'Lunch', TODAY),
    ev('7', 'PT Omar', TODAY),
    ev('8', 'Jeremy Pt.', '2026-11-03')
  ], Object.assign({ clients: clients, ignored: [] }, WINDOW));
  const names = result.sessions.filter((s) => !s.removed).map((s) => s.clientName).sort();
  assert.deepEqual(names, ['Jeremy', 'Larissa']);
  assert.equal(result.sessions.some((s) => s.eventId === 'old' || s.title === 'O pai morreu'), false);
  assert.equal(result.added.length, 2);
  assert.equal(result.clients.map((c) => c.name).sort().join(','), 'Jeremy,Larissa');
});

test('the same calendar event is never added twice', () => {
  const clients = [client()];
  const first = PT.applySync([], [ev('abc', 'Larissa PT', TODAY)], Object.assign({ clients: clients, ignored: [] }, WINDOW));
  const second = PT.applySync(first.sessions, [ev('abc', 'Larissa PT', TODAY)], Object.assign({ clients: clients, ignored: [] }, WINDOW));
  assert.equal(second.sessions.filter((s) => s.eventId === 'abc' && !s.removed).length, 1);
  assert.equal(second.added.length, 0);
  assert.equal(PT.currentRemaining(clients[0], second.sessions, clients).used, 1);
});

test('a cancelled event inside the window stops counting', () => {
  const clients = [client()];
  const first = PT.applySync([], [ev('abc', 'Larissa PT', TODAY)], Object.assign({ clients: clients, ignored: [] }, WINDOW));
  const second = PT.applySync(first.sessions, [], Object.assign({ clients: clients, ignored: [] }, WINDOW));
  assert.equal(second.sessions.find((s) => s.eventId === 'abc').removed, true);
  assert.equal(PT.currentRemaining(clients[0], second.sessions, clients).used, 0);
});

test('free sessions do not use the package and charged sessions do', () => {
  const jeremy = client({ id: 'jeremy', name: 'Jeremy', packageSessions: '10', packageValue: '4000', startDate: '2026-10-01' });
  const synced = PT.applySync([], [
    ev('f', 'Jeremy Pt', TODAY, 'Free pra compensar outras sessoes', '09:00'),
    ev('c', 'Jeremy Pt', '2026-11-03', 'Charged, give back friday', '18:00')
  ], Object.assign({ clients: [jeremy], ignored: [] }, WINDOW));
  assert.equal(synced.sessions.find((s) => s.eventId === 'f').status, 'free');
  assert.equal(synced.sessions.find((s) => s.eventId === 'c').status, 'charged');
  assert.equal(PT.isFlaggedNote('Nao tem sessoes'), true);
  assert.equal(PT.guessStatus('Nao tem sessoes'), 'normal');
  assert.equal(PT.currentRemaining(jeremy, synced.sessions, [jeremy]).used, 1);
  const locked = PT.setStatus(synced.sessions, 'f', 'normal');
  const again = PT.applySync(locked, [
    ev('f', 'Jeremy Pt', TODAY, 'Free pra compensar outras sessoes', '09:00'),
    ev('c', 'Jeremy Pt', '2026-11-03', 'Charged, give back friday', '18:00')
  ], Object.assign({ clients: [jeremy], ignored: [] }, WINDOW));
  assert.equal(again.sessions.find((s) => s.eventId === 'f').status, 'normal');
});

test('a name that does not end in PT is never stored', () => {
  const sofia = client({ id: 'sofia', name: 'Sofia', packageSessions: '8', packageValue: '3200', startDate: '2026-11-01' });
  const synced = PT.applySync([], [ev('a', 'Aurelie ', TODAY)], Object.assign({ clients: [sofia], ignored: [] }, WINDOW));
  assert.equal(synced.sessions.length, 0);
  assert.equal(PT.unmatchedFromSessions(synced.sessions, [sofia]).length, 0);
});

test('a deleted client name stays ignored when the title still ends in PT', () => {
  const named = PT.applySync([], [ev('a', 'Samir PT', TODAY)], Object.assign({ clients: [], ignored: [] }, WINDOW));
  assert.equal(named.clients[0].name, 'Samir');
  const ignored = PT.ignoreName([], named.sessions, 'Samir');
  const again = PT.applySync(ignored.sessions, [ev('a', 'Samir PT', TODAY), ev('b', 'Samir PT', '2026-11-05')], Object.assign({ clients: [], ignored: ignored.ignored }, WINDOW));
  assert.equal(again.sessions.filter((s) => s.disposition === 'kept').length, 0);
  assert.equal(again.clients.length, 0);
});

test('two clients with the same name are not both charged for one session', () => {
  const a = client({ id: '1', name: 'Ali' });
  const b = client({ id: '2', name: 'Ali' });
  const synced = PT.applySync([], [ev('a', 'Ali PT', TODAY)], Object.assign({ clients: [a, b], ignored: [] }, WINDOW));
  assert.equal(synced.sessions[0].disposition, 'pending');
  assert.equal(PT.packageUsed(a, synced.sessions, a.packages[0], [a, b]), 0);
  assert.equal(PT.periodBillable([a, b], synced.sessions, { start: '2026-11-01', end: '2026-11-30' }, TODAY).length, 0);
});

test('renewal keeps the old package and new sessions start after it', () => {
  let person = client({ id: '1', name: 'Ali', packageSessions: '10', packageValue: '2000', startDate: '2026-01-05' });
  const oldSessions = [
    { eventId: 'b', clientName: 'Ali', date: '2026-01-06', status: 'normal', disposition: 'kept', createdAt: '2026-01-06' },
    { eventId: 'c', clientName: 'Ali', date: '2026-02-28', status: 'normal', disposition: 'kept', createdAt: '2026-02-28' }
  ];
  assert.equal(PT.packageUsed(person, oldSessions, person.packages[0], [person]), 2);
  person = PT.renewPackage(person, { sessions: '8', value: '2400', startDate: '2026-03-01' });
  const more = oldSessions.concat([
    { eventId: 'd', clientName: 'Ali', date: '2026-03-01', status: 'normal', disposition: 'kept', createdAt: '2026-03-01' }
  ]);
  assert.equal(person.packages.length, 2);
  assert.equal(PT.packageUsed(person, more, person.packages[0], [person]), 2);
  assert.equal(PT.currentRemaining(person, more, [person]).used, 1);
  assert.equal(PT.currentRemaining(person, more, [person]).remaining, 7);
  assert.throws(() => PT.renewPackage(person, { sessions: '5', value: '100', startDate: '2026-03-01' }), /after/);
});

test('commission uses the saved tiers and leaves charges out unless asked', () => {
  const ali = client({ id: '1', name: 'Ali', packageSessions: '10', packageValue: '2000', startDate: '2026-01-01' });
  const sessions = [
    { eventId: 'a', clientName: 'Ali', date: '2026-02-01', status: 'normal', disposition: 'kept' },
    { eventId: 'b', clientName: 'Ali', date: '2026-02-02', status: 'free', disposition: 'kept' }
  ];
  const period = { start: '2026-02-01', end: '2026-02-28' };
  assert.equal(PT.periodSessionRevenue([ali], sessions, period, '2026-02-15'), 200);
  assert.equal(PT.periodBillable([ali], sessions, period, '2026-02-15').length, 1);
  const off = PT.commissionEstimate({
    sessionRevenue: 20000, chargeTotal: 1000, sessionCount: 50,
    comm: { quota: '1000', netFactor: '80', includeCharges: false }
  });
  assert.equal(off.commission, 6750);
  const on = PT.commissionEstimate({
    sessionRevenue: 20000, chargeTotal: 1000, sessionCount: 50,
    comm: { quota: '1000', netFactor: '80', includeCharges: true }
  });
  assert.equal(on.totalRevenue, 21000);
  assert.equal(on.commission, 7110);
  assert.equal(PT.getTier(80), 0.45);
  assert.equal(PT.getTier(81), 0.60);
  assert.equal(PT.getTier(100), 0.60);
  assert.equal(PT.getTier(101), 0.65);
  assert.equal(PT.getTier(119), 0.65);
  assert.equal(PT.getTier(120), 0.70);
  assert.equal(PT.sessionsToNextTier(80), 1);
  assert.equal(PT.sessionsToNextTier(109), 11);
  assert.equal(PT.sessionsToNextTier(120), 0);
  assert.equal(PT.getTierLabel(109), '101-119 · 65%');
});

test('September 2026 J Club commission matches the form to the fils', () => {
  const est = PT.commissionEstimate({
    sessionRevenue: 37304.50,
    sessionCount: 109,
    chargeTotal: 0,
    comm: {}
  });
  assert.equal(est.totalRevenue, 37304.50);
  assert.equal(est.netRevenue, 30452.65);
  assert.equal(est.quota, 7758);
  assert.equal(est.commRevenue, 22694.65);
  assert.equal(est.tierRate, 0.65);
  assert.equal(est.tierLabel, '101-119 · 65%');
  assert.equal(est.sessionsToNext, 11);
  assert.equal(est.commission, 14751.52);
  assert.equal(est.netRevenue, Math.round(37304.50 * (30452.65 / 37304.50) * 100) / 100);
});

test('daily email has the fixed subject and the four sections', () => {
  const jeremy = client({ id: 'jeremy', name: 'Jeremy', packageSessions: '2', packageValue: '800', startDate: '2026-11-01' });
  const sessions = [
    {
      eventId: '1', clientName: 'Jeremy', date: '2026-11-02', start: '09:00', status: 'free',
      disposition: 'kept', note: 'Free pra compensar outras sessoes', createdAt: '2026-11-02 05:07'
    },
    {
      eventId: '2', clientName: 'Aurelie', date: '2026-11-02', start: '16:00', status: 'normal',
      disposition: 'pending', note: 'Nao tem sessoes', createdAt: '2026-11-02 05:07'
    },
    {
      eventId: '3', clientName: 'Jeremy', date: '2026-08-01', start: '09:00', status: 'normal',
      disposition: 'kept', createdAt: '2026-11-02 05:07'
    }
  ];
  const mail = PT.buildSummary({ clients: [jeremy], sessions: sessions }, TODAY, '2026-11-02 05:07 Asia/Dubai');
  assert.equal(mail.subject, 'PT Planner daily sync');
  assert.equal(mail.to, 'pedrocerdeira81@gmail.com');
  assert.match(mail.body, /^PT Planner daily sync\nStatus: ok\nWhen: 2026-11-02 05:07 Asia\/Dubai/);
  const addedPart = mail.body.split('Clients low')[0];
  assert.match(addedPart, /Sessions added: 0/);
  assert.doesNotMatch(addedPart, /Jeremy/);
  assert.match(mail.body, /Jeremy \| 2026-11-02 09:00 \| free \| Free pra compensar outras sessoes/);
  assert.match(mail.body, /Older sessions saved: 1/);
  assert.match(mail.body, /Clients low or out: 1/);
  assert.match(mail.body, /Jeremy \| 2 left \| low/);
  assert.match(mail.body, /Flagged notes: 1/);
  assert.doesNotMatch(mail.body, /Unmatched names/);
  assert.doesNotMatch(mail.body, /Aurelie/);
  const failed = PT.buildDailyEmail({ ok: false, when: '2026-11-02 05:07 Asia/Dubai', error: 'Calendar is off' });
  assert.equal(failed.subject, 'PT Planner daily sync');
  assert.match(failed.body, /Status: failed/);
  assert.match(failed.body, /Calendar is off/);
});

test('bringing the old planner over keeps packages and does not copy sessions', () => {
  const incoming = {
    clients: [{ id: '1', name: 'Ali', packageSessions: '10', packageValue: '2000', startDate: '2026-01-05' }],
    sessions: [{ clientName: 'Ali', date: '2026-01-06' }],
    charges: [{ id: 'c1', clientId: '1', type: 'late_cancel', date: '2026-01-07', notes: 'Cancelled 1h before' }],
    comm: { quota: '7758', netFactor: '81.63' },
    period: { start: '2026-01-01', end: '2026-01-31' }
  };
  const once = PT.mergeMigration({ clients: [], charges: [], settings: {} }, incoming);
  assert.deepEqual(once.added, ['Ali']);
  assert.equal(once.clients[0].packages[0].sessions, '10');
  assert.equal(once.clients[0].startDate, '2026-01-05');
  assert.equal(once.charges[0].amount, 0);
  assert.equal(once.charges[0].notes, 'Cancelled 1h before');
  assert.equal(once.settings.quota, '7758');
  assert.equal(once.settings.periodStart, '2026-01-01');
  assert.equal(once.sessions, undefined);
  const twice = PT.mergeMigration({
    clients: once.clients,
    charges: once.charges,
    settings: once.settings
  }, incoming);
  assert.deepEqual(twice.added, []);
  assert.deepEqual(twice.skipped, ['Ali']);
  assert.equal(twice.charges.length, 1);
});

test('the pasted Apps Script is the built planner and stays private', () => {
  const gas = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
  assert.match(gas, /function dailySync/);
  assert.match(gas, /inTimezone\(TZ\)/);
  assert.match(gas, /PT Planner daily sync/);
  assert.match(gas, /pedrocerdeira81@gmail.com/);
  assert.match(gas, /Only myself|assertOwner_/);
  assert.match(html, /Example data/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /viewport-fit=cover/);
  assert.equal(PT.EMAIL_SUBJECT, 'PT Planner daily sync');
  assert.equal(PT.SUMMARY_EMAIL, 'pedrocerdeira81@gmail.com');
});

test('a PT title becomes a client and older sessions stay outside a fresh package', () => {
  const result = PT.applySync([], [
    ev('old', 'Omar PT', '2026-08-01', '', '07:00'),
    ev('today', 'Omar PT', TODAY, '', '18:00'),
    ev('mid', 'Omar PT', '2026-11-04', '', '09:00')
  ], Object.assign({ clients: [], ignored: [], today: TODAY }, WINDOW));
  assert.equal(result.clients.length, 1);
  assert.equal(result.clients[0].name, 'Omar');
  assert.equal(result.clients[0].startDate, TODAY);
  assert.equal(result.sessions.filter((s) => s.disposition === 'kept').length, 3);
  assert.equal(PT.unmatchedFromSessions(result.sessions, result.clients).length, 0);
  const again = PT.applySync(result.sessions, [
    ev('old', 'Omar PT', '2026-08-01'),
    ev('today', 'Omar PT', TODAY),
    ev('mid', 'Omar PT', '2026-11-04')
  ], Object.assign({ clients: result.clients, ignored: [], today: TODAY }, WINDOW));
  assert.equal(again.clients.length, 1);
  const saved = PT.saveClientPackage(result.clients[0], {
    sessions: '10',
    sessionsLeft: '10',
    balanceManual: true,
    value: '4000',
    startDate: TODAY
  }, result.sessions, result.clients);
  const stats = PT.currentRemaining(saved, result.sessions, [saved]);
  assert.equal(stats.used, 2);
  assert.equal(stats.remaining, 10);
  assert.equal(stats.perSession, 400);
  assert.equal(saved.packages[0].expiry, undefined);
  assert.equal(saved.packages[0].paymentStatus, undefined);
});

test('a title containing free is not counted, and a title that does not end in PT is dropped', () => {
  const result = PT.applySync([], [
    ev('omar', 'Omar free PT', TODAY, '', '09:00'),
    ev('plain', 'Free session', TODAY, '', '10:00'),
    ev('word', 'Freedom PT', TODAY, '', '11:00'),
    ev('shift', 'O pai morreu', TODAY, '', '12:00')
  ], Object.assign({ clients: [], ignored: [], today: TODAY }, WINDOW));
  assert.deepEqual(result.clients.map((c) => c.name).sort(), ['Freedom', 'Omar free']);
  const omar = result.sessions.find((s) => s.eventId === 'omar');
  assert.equal(result.sessions.some((s) => s.eventId === 'plain' || s.eventId === 'shift'), false);
  assert.equal(omar.clientName, 'Omar free');
  assert.equal(omar.status, 'free');
  assert.equal(omar.disposition, 'kept');
  const period = { start: '2026-10-29', end: '2026-11-29' };
  let clients = result.clients.map((c) => {
    if (c.name === 'Omar free') {
      return PT.saveClientPackage(c, { sessions: '10', sessionsLeft: '8', balanceManual: true, value: '4000', startDate: '2026-11-01' }, result.sessions, result.clients);
    }
    if (c.name === 'Freedom') {
      return PT.saveClientPackage(c, { sessions: '10', sessionsLeft: '10', balanceManual: true, value: '2000', startDate: '2026-11-01' }, result.sessions, result.clients);
    }
    return c;
  });
  const omarClient = clients.find((c) => c.name === 'Omar free');
  assert.equal(PT.currentRemaining(omarClient, result.sessions, clients).used, 0);
  assert.equal(PT.currentRemaining(omarClient, result.sessions, clients).remaining, 8);
  assert.equal(PT.periodBillable(clients, result.sessions, period, TODAY).length, 1);
  assert.equal(PT.periodSessionRevenue(clients, result.sessions, period, TODAY), 200);
  const locked = PT.setStatus(result.sessions, 'omar', 'normal');
  assert.equal(locked.find((s) => s.eventId === 'omar').statusLocked, true);
  const again = PT.applySync(locked, [
    ev('omar', 'Omar free PT', TODAY, '', '09:00'),
    ev('plain', 'Free session', TODAY, '', '10:00'),
    ev('word', 'Freedom PT', TODAY, '', '11:00')
  ], Object.assign({ clients: result.clients, ignored: [], today: TODAY }, WINDOW));
  assert.equal(again.sessions.find((s) => s.eventId === 'omar').status, 'free');
  assert.equal(again.clients.filter((c) => c.name === 'Omar free').length, 1);
  const mail = PT.buildSummary({ clients: clients, sessions: again.sessions, settings: { periods: [period] } }, TODAY, '2026-11-02 05:07 Asia/Dubai');
  const addedPart = mail.body.split('Clients low')[0];
  assert.match(addedPart, /Sessions added: 1/);
  assert.doesNotMatch(addedPart, /Omar/);
  assert.doesNotMatch(addedPart, /Free session/);
});

test('pay periods are exact dates and the current one is the period that contains today', () => {
  const periods = [
    { id: 'a', start: '2026-09-30', end: '2026-10-28' },
    { id: 'b', start: '2026-10-29', end: '2026-11-29' }
  ];
  assert.equal(PT.inPeriod('2026-10-28', periods[0]), true);
  assert.equal(PT.inPeriod('2026-10-29', periods[0]), false);
  assert.equal(PT.inPeriod('2026-11-02', null), false);
  assert.equal(PT.activePeriod(periods, '2026-11-02').id, 'b');
  assert.equal(PT.activePeriod(periods, '2026-10-01').id, 'a');
  const rolled = PT.savePeriods(periods, { start: '2026-11-30', end: '2026-12-28' });
  assert.equal(rolled.periods.length, 3);
  assert.equal(PT.activePeriod(rolled.periods, '2026-11-02').id, 'b');
  assert.equal(PT.activePeriod(rolled.periods, '2026-12-01').start, '2026-11-30');
  const edited = PT.savePeriods(periods, { id: 'b', start: '2026-10-29', end: '2026-11-20' });
  assert.equal(edited.periods.length, 2);
  assert.equal(PT.inPeriod('2026-11-25', edited.periods[1]), false);
  assert.throws(() => PT.savePeriods(periods, { start: '2026-12-02', end: '2026-12-01' }), /before/);
  const win = PT.syncWindow('2026-11-03', periods);
  assert.equal(win.windowStart, '2026-10-29');
  assert.equal(win.windowEnd, '2027-01-02');
  const recent = PT.syncWindow('2026-11-03', []);
  assert.equal(recent.windowStart, '2026-09-04');
  const ancient = PT.syncWindow('2026-11-03', [{ id: 'old', start: '2025-01-01', end: '2026-12-01' }]);
  assert.equal(ancient.windowStart, '2026-07-06');
});

test('a recurring series keeps every occurrence and replaces the old shared id', () => {
  const series = 'larissa@google.com';
  const nov2 = series + '@20261102T030000Z';
  const nov4 = series + '@20261104T030000Z';
  const larissa = client({ id: 'larissa', name: 'Larissa', packageSessions: '10', packageValue: '2000', startDate: '2026-11-01' });
  const old = [{
    eventId: series,
    calendarId: 'primary',
    title: 'Larissa PT',
    clientName: 'Larissa',
    date: '2026-11-02',
    start: '07:00',
    end: '08:00',
    status: 'charged',
    statusLocked: true,
    disposition: 'kept',
    hidden: false,
    removed: false,
    createdAt: '2026-11-02 05:07'
  }];
  const events = [
    ev(nov2, 'Larissa PT', '2026-11-02', '', '07:00'),
    ev(nov4, 'Larissa PT', '2026-11-04', '', '07:00')
  ];
  const first = PT.applySync(old, events, Object.assign({ clients: [larissa], ignored: [] }, WINDOW));
  const live = first.sessions.filter((s) => !s.removed);
  assert.deepEqual(live.map((s) => s.eventId).sort(), [nov2, nov4]);
  assert.equal(live.find((s) => s.eventId === nov2).status, 'charged');
  assert.equal(live.find((s) => s.eventId === nov2).statusLocked, true);
  assert.equal(live.find((s) => s.eventId === nov4).status, 'normal');
  assert.equal(first.sessions.some((s) => s.eventId === series), false);
  assert.deepEqual(first.idRemap, [{ from: series, to: nov2 }]);
  assert.equal(PT.packageUsed(larissa, first.sessions, larissa.packages[0], [larissa]), 2);
  const hiddenOld = [Object.assign({}, old[0], { hidden: true, status: 'normal', statusLocked: false })];
  const hiddenSync = PT.applySync(hiddenOld, events, Object.assign({ clients: [larissa], ignored: [] }, WINDOW));
  assert.equal(hiddenSync.sessions.find((s) => s.eventId === nov2).hidden, true);
  assert.equal(PT.packageUsed(larissa, hiddenSync.sessions, larissa.packages[0], [larissa]), 1);
  const again = PT.applySync(first.sessions, events, Object.assign({ clients: [larissa], ignored: [] }, WINDOW));
  assert.equal(again.sessions.filter((s) => !s.removed && s.clientName === 'Larissa').length, 2);
  assert.equal(again.sessions.find((s) => s.eventId === nov2).status, 'charged');
  const single = PT.applySync(
    [{ eventId: 'omar@google.com', clientName: 'Omar', date: TODAY, start: '18:00', status: 'normal', disposition: 'kept' }],
    [ev('omar@google.com', 'Omar PT', TODAY, '', '18:00')],
    Object.assign({ clients: [client({ id: 'omar', name: 'Omar' })], ignored: [] }, WINDOW)
  );
  assert.equal(single.sessions.filter((s) => s.eventId === 'omar@google.com' && !s.removed).length, 1);
  assert.equal(single.idRemap.length, 0);
  const charges = PT.retargetCharges([
    { id: 'ch1', clientId: 'larissa', eventId: series, type: 'late_cancel', amount: 200, date: '2026-11-02', notes: '', createdAt: '' },
    { id: 'ch2', clientId: 'sofia', eventId: '', type: 'no_show', amount: 150, date: '2026-10-30', notes: '', createdAt: '' }
  ], first.idRemap);
  assert.equal(charges[0].eventId, nov2);
  assert.equal(charges[1].eventId, '');
  assert.equal(charges[0].amount, 200);
});

test('Yusuf package save sticks, deducts each eligible session once, and a blank write cannot erase it', () => {
  const made = PT.applySync([], [
    ev('y1', 'Yusuf PT', '2026-11-05', '', '12:00'),
    ev('y2', 'Yusuf PT', '2026-11-12', '', '12:00'),
    ev('free', 'Yusuf free PT', '2026-11-05', '', '13:00'),
    ev('old', 'Yusuf PT', '2026-10-29', '', '12:00')
  ], Object.assign({ clients: [], ignored: [], today: '2026-11-06' }, WINDOW));
  assert.equal(made.clients.length, 2);
  const yusuf = made.clients.find((c) => c.name === 'Yusuf');
  assert.equal(yusuf.packages[0].sessions, '');
  assert.equal(PT.packageReady(yusuf.packages[0]), false);
  const now = { today: '2026-11-06', time: '16:37' };
  const saved = PT.saveClientPackage(yusuf, {
    sessions: '10', value: '4000', startDate: '2026-11-03', note: ''
  }, made.sessions, made.clients, now);
  assert.equal(saved.id, yusuf.id);
  assert.equal(PT.packageReady(saved.packages[0]), true);
  assert.equal(saved.packages[0].value, '4000');
  const stats = PT.currentRemaining(saved, made.sessions, made.clients.map((c) => c.id === saved.id ? saved : c), now);
  assert.equal(stats.used, 1);
  assert.equal(stats.remaining, 9);
  const again = PT.applySync(made.sessions, [
    ev('y1', 'Yusuf PT', '2026-11-05', '', '12:00'),
    ev('y2', 'Yusuf PT', '2026-11-12', '', '12:00'),
    ev('free', 'Yusuf free PT', '2026-11-05', '', '13:00'),
    ev('old', 'Yusuf PT', '2026-10-29', '', '12:00')
  ], Object.assign({ clients: [saved], ignored: [], today: '2026-11-06' }, WINDOW));
  assert.equal(again.clients[0].packages[0].sessions, '10');
  assert.equal(again.clients[0].packages[0].value, '4000');
  assert.equal(PT.currentRemaining(again.clients[0], again.sessions, again.clients, now).used, 1);
  const named = PT.createClient(again.clients, {
    name: 'Yusuf', sessions: '12', value: '4800', startDate: '2026-11-03', sessionsLeft: '9', balanceManual: true
  }, again.sessions, again.clients, now);
  assert.equal(named.length, again.clients.length);
  assert.equal(named.find((c) => c.name === 'Yusuf').id, yusuf.id);
  assert.equal(PT.currentRemaining(named.find((c) => c.name === 'Yusuf'), again.sessions, named, now).remaining, 9);
  const wiped = PT.mergeClientRecord(saved, {
    id: saved.id,
    name: 'Yusuf',
    packages: [{ id: saved.packages[0].id, sessions: '', sessionsLeft: '', value: '', startDate: '2026-11-03' }]
  });
  assert.equal(wiped.packages[0].sessions, '10');
  assert.equal(wiped.packages[0].value, '4000');
  const sherine = PT.mergeClientRecord({
    id: 'sherine',
    name: 'Sherine',
    packages: [{ id: 'sherine-pkg1', sessions: '', sessionsLeft: '0', value: '', startDate: '2026-11-01' }]
  }, {
    id: 'sherine',
    name: 'Sherine',
    packages: [{ id: 'sherine-pkg1', sessions: '', sessionsLeft: '', value: '', startDate: '2026-11-01' }]
  });
  assert.equal(sherine.packages[0].sessionsLeft, '0');
  assert.equal(PT.addDaysYmd('2026-11-05', -1), '2026-11-04');
  assert.equal(PT.addDaysYmd('2026-11-01', -1), '2026-10-31');
  assert.equal(PT.mondayOf('2026-11-05'), '2026-11-02');
});

test('a package of 6 uses finished Yusuf sessions after 5 Nov and not later Thursdays', () => {
  const now = { today: '2026-11-06', time: '16:37' };
  const yusuf = client({
    id: 'yusuf', name: 'Yusuf', packageSessions: '6', packageValue: '', startDate: '2026-11-05'
  });
  yusuf.packages[0].note = 'Split with mira';
  function row(id, date, start, end) {
    return {
      eventId: id, clientName: 'Yusuf', title: 'Yusuf PT', date: date,
      start: start, end: end, status: 'normal', disposition: 'kept'
    };
  }
  const sessions = [
    row('before', '2026-11-04', '12:00', '13:00'),
    row('nov5', '2026-11-05', '12:00', '13:00'),
    row('ended-today', '2026-11-06', '12:00', '13:00'),
    row('later-today', '2026-11-06', '18:00', '19:00'),
    row('nov26', '2026-11-26', '12:00', '13:00'),
    row('dec3', '2026-12-03', '12:00', '13:00'),
    row('dec10', '2026-12-10', '12:00', '13:00'),
    row('dec17', '2026-12-17', '12:00', '13:00'),
    row('dec24', '2026-12-24', '12:00', '13:00'),
    row('dec31', '2026-12-31', '12:00', '13:00')
  ];
  const onlyPast = sessions.filter((s) => s.eventId === 'before' || s.eventId === 'nov5' || s.eventId.indexOf('dec') === 0 || s.eventId === 'nov26');
  const first = PT.currentRemaining(yusuf, onlyPast, [yusuf], now);
  assert.equal(first.used, 1);
  assert.equal(first.remaining, 5);
  assert.equal(first.used + first.remaining, first.total);
  assert.equal(first.total, 6);
  assert.equal(yusuf.packages[0].value, '');
  assert.equal(yusuf.packages[0].note, 'Split with mira');
  assert.equal(PT.packageUsed(yusuf, onlyPast, yusuf.packages[0], [yusuf], now), 1);
  const withToday = PT.currentRemaining(yusuf, sessions, [yusuf], now);
  assert.equal(withToday.used, 2);
  assert.equal(withToday.remaining, 4);
  assert.equal(withToday.used + withToday.remaining, 6);
  const manual = client({
    id: 'yusuf', name: 'Yusuf', packageSessions: '12', packageValue: '4080', startDate: '2026-11-05'
  });
  manual.packages[0].sessionsLeft = '13';
  const shown = PT.currentRemaining(manual, sessions, [manual], now);
  assert.equal(shown.total, 12);
  assert.equal(shown.used, 2);
  assert.equal(shown.opening, 13);
  assert.equal(shown.remaining, 11);
  assert.equal(shown.used + shown.remaining, 13);
  assert.notEqual(shown.used + shown.remaining, shown.total);
  const renewed = PT.renewPackage(yusuf, { sessions: '6', value: '', startDate: '2026-12-01' });
  assert.equal(PT.packageUsed(renewed, sessions, renewed.packages[0], [renewed], now), 2);
  assert.equal(PT.currentRemaining(renewed, sessions, [renewed], now).used, 0);
  assert.equal(PT.packageUsed(renewed, sessions, renewed.packages[1], [renewed], { today: '2026-12-04', time: '16:00' }), 1);
});

test('a full J Club period keeps booked sessions in the plan and out of earned totals', () => {
  const period = { start: '2026-10-30', end: '2026-11-28' };
  const now = { today: '2026-11-06', time: '16:37' };
  const person = client({
    id: 'yusuf', name: 'Yusuf', packageSessions: '6', packageValue: '600', startDate: '2026-11-05'
  });
  function row(id, date, start, end, status) {
    return {
      eventId: id, clientName: 'Yusuf', title: 'Yusuf PT', date: date,
      start: start, end: end, status: status || 'normal', disposition: 'kept'
    };
  }
  const sessions = [
    row('oct31', '2026-10-31', '10:00', '11:00'),
    row('nov5', '2026-11-05', '12:00', '13:00'),
    row('morning', '2026-11-06', '12:00', '13:00'),
    row('tonight', '2026-11-06', '18:00', '19:00'),
    row('free', '2026-11-04', '09:00', '10:00', 'free'),
    row('nov12', '2026-11-12', '12:00', '13:00'),
    row('nov26', '2026-11-26', '12:00', '13:00')
  ];
  const finished = sessions.filter((s) => PT.sessionHasEnded(s, now) && s.status !== 'free');
  const planned = PT.periodBillable([person], sessions, period, now);
  const done = PT.periodFinished([person], sessions, period, now);
  assert.equal(planned.length, 6);
  assert.equal(done.length, 3);
  assert.equal(done.length, finished.filter((s) => s.date >= period.start && s.date <= period.end).length);
  assert.equal(done.some((s) => s.eventId === 'tonight' || s.eventId === 'nov12' || s.eventId === 'nov26'), false);
  const earned = PT.periodSessionRevenue([person], done, period, now);
  const projected = PT.periodSessionRevenue([person], sessions, period, now);
  assert.equal(earned, 300);
  assert.equal(projected, 600);
  const est = PT.commissionEstimate({
    sessionRevenue: earned, sessionCount: done.length, chargeTotal: 0,
    comm: { quota: '0', netFactor: '100', includeCharges: false }
  });
  const outlook = PT.commissionEstimate({
    sessionRevenue: projected, sessionCount: planned.length, chargeTotal: 0,
    comm: { quota: '0', netFactor: '100', includeCharges: false }
  });
  assert.equal(est.sessionCount, 3);
  assert.equal(est.tierRate, 0.45);
  assert.equal(est.commission, 135);
  assert.equal(outlook.sessionCount, 6);
  assert.equal(outlook.commission, 270);
  assert.notEqual(est.commission, outlook.commission);
  const pack = PT.currentRemaining(person, sessions, [person], now);
  assert.equal(pack.used, 2);
  assert.equal(pack.remaining, 4);
  assert.equal(pack.used + pack.remaining, pack.total);
});

test('Fix numbers save uses size minus finished sessions, even if sessions left shows 12', () => {
  const now = { today: '2026-11-06', time: '16:37' };
  const yusuf = client({
    id: 'mw0c6ng7pyjibs', name: 'Yusuf', packageSessions: '12', packageValue: '4080', startDate: '2026-11-05'
  });
  yusuf.packages[0].id = 'mw0c6ng7pyjibs-pkg1';
  yusuf.packages[0].sessionsLeft = '13';
  yusuf.packages[0].note = 'Split with mira';
  const sessions = [
    { eventId: 'nov5', clientName: 'Yusuf', title: 'Yusuf PT', date: '2026-11-05', start: '12:00', end: '13:00', status: 'normal', disposition: 'kept' },
    { eventId: 'nov26', clientName: 'Yusuf', title: 'Yusuf PT', date: '2026-11-26', start: '12:00', end: '13:00', status: 'normal', disposition: 'kept' }
  ];
  const before = PT.currentRemaining(yusuf, sessions, [yusuf], now);
  assert.equal(before.used, 1);
  assert.equal(before.remaining, 12);
  const form = PT.packageFormDefaults(yusuf, sessions, [yusuf], now);
  assert.equal(form.sessions, '12');
  assert.equal(form.sessionsLeft, '');
  assert.equal(form.balanceManual, false);
  assert.equal(form.value, '4080');
  assert.equal(form.startDate, '2026-11-05');
  assert.equal(form.note, 'Split with mira');
  assert.equal(form.manualAvailable, true);
  const saved = PT.saveClientPackage(yusuf, {
    name: 'Yusuf',
    sessions: form.sessions,
    sessionsLeft: '12',
    value: '4080',
    startDate: form.startDate,
    note: form.note,
    balanceManual: form.balanceManual,
    mode: 'edit'
  }, sessions, [yusuf], now);
  const after = PT.currentRemaining(saved, sessions, [saved], now);
  assert.equal(after.total, 12);
  assert.equal(after.used, 1);
  assert.equal(after.remaining, 11);
  assert.equal(saved.packages[0].sessionsLeft, '');
  assert.equal(saved.packages[0].balanceMode, 'auto');
  assert.equal(saved.packages[0].value, '4080');
  const reloaded = PT.packageFormDefaults(saved, sessions, [saved], now);
  assert.equal(reloaded.sessionsLeft, '');
  assert.equal(reloaded.previewLeft, 11);
  const moved = PT.saveClientPackage(saved, {
    sessions: '12',
    sessionsLeft: String(reloaded.previewLeft),
    value: '4080',
    startDate: '2026-11-04',
    note: 'Split with mira',
    balanceManual: false,
    mode: 'edit'
  }, sessions, [saved], now);
  const movedStats = PT.currentRemaining(moved, sessions, [moved], now);
  assert.equal(movedStats.used, 1);
  assert.equal(movedStats.remaining, 11);
  const merged = PT.mergeClientRecord(yusuf, moved);
  assert.equal(merged.packages[0].balanceMode, 'auto');
  assert.equal(merged.packages[0].sessionsLeft, '');
  assert.equal(PT.currentRemaining(merged, sessions, [merged], now).remaining, 11);
  const byHand = PT.saveClientPackage(saved, {
    sessions: '12', sessionsLeft: '4', value: '4080', startDate: '2026-11-05',
    balanceManual: true, mode: 'edit'
  }, sessions, [saved], now);
  assert.equal(byHand.packages[0].balanceMode, 'manual');
  assert.equal(byHand.packages[0].balanceSetAt, '2026-11-06');
  assert.equal(PT.currentRemaining(byHand, sessions, [byHand], now).remaining, 4);
});

test('one review applies legacy balances and leaves zeros, hand balances, and short history', () => {
  const now = { today: '2026-11-06', time: '16:37' };
  const periods = [{ id: 'p', start: '2026-10-30', end: '2026-11-28' }];
  const yusuf = client({ id: 'yusuf', name: 'Yusuf', packageSessions: '12', packageValue: '4080', startDate: '2026-11-05' });
  yusuf.packages[0].id = 'yusuf-pkg';
  yusuf.packages[0].sessionsLeft = '13';
  yusuf.packages[0].note = 'Split with mira';
  const sherine = client({ id: 'sherine', name: 'Sherine', packageSessions: '10', packageValue: '100', startDate: '2026-11-01' });
  sherine.packages[0].sessionsLeft = '0';
  const marked = client({ id: 'marked', name: 'Marked', packageSessions: '8', packageValue: '80', startDate: '2026-11-01' });
  marked.packages[0].sessionsLeft = '0';
  marked.packages[0].balanceMode = 'manual';
  marked.packages[0].balanceSetAt = '2026-11-06';
  const ready = client({ id: 'ready', name: 'Ready', packageSessions: '8', packageValue: '80', startDate: '2026-11-01' });
  ready.packages[0].balanceMode = 'auto';
  ready.packages[0].sessionsLeft = '';
  const ancient = client({ id: 'ancient', name: 'Ancient', packageSessions: '10', packageValue: '50', startDate: '2025-01-01' });
  ancient.packages[0].sessionsLeft = '15';
  let reno = client({ id: 'reno', name: 'Reno', packageSessions: '8', packageValue: '800', startDate: '2026-06-01' });
  reno.packages[0].sessionsLeft = '5';
  reno.packages[0].note = 'old note';
  reno = PT.renewPackage(reno, { sessions: '10', value: '900', startDate: '2026-11-01' });
  reno.packages[1].sessionsLeft = '14';
  const sessions = [
    { eventId: 'nov5', clientName: 'Yusuf', title: 'Yusuf PT', date: '2026-11-05', start: '12:00', end: '13:00', status: 'normal', disposition: 'kept' },
    { eventId: 'nov26', clientName: 'Yusuf', title: 'Yusuf PT', date: '2026-11-26', start: '12:00', end: '13:00', status: 'normal', disposition: 'kept' }
  ];
  const clients = [yusuf, sherine, marked, ready, ancient, reno];
  const form = PT.packageFormDefaults(yusuf, sessions, clients, now);
  assert.equal(form.previewLeft, 11);
  assert.equal(form.previewUsed, 1);
  assert.equal(PT.currentRemaining(yusuf, sessions, clients, now).remaining, 12);
  const review = PT.legacyBalanceReview(clients, sessions, now, periods);
  function row(id) { return review.rows.filter((r) => r.clientId === id)[0]; }
  assert.equal(row('yusuf').selected, true);
  assert.equal(row('yusuf').oldLeft, 12);
  assert.equal(row('yusuf').calendarLeft, 11);
  assert.equal(row('sherine').status, 'kept-zero');
  assert.equal(row('sherine').selected, false);
  assert.equal(row('marked').status, 'explicit');
  assert.equal(row('marked').selected, false);
  assert.equal(row('ready').status, 'auto');
  assert.equal(row('ancient').status, 'short-history');
  assert.equal(row('ancient').selected, false);
  assert.equal(row('reno').selected, true);
  assert.equal(row('reno').calendarLeft, 10);
  const picked = review.rows.filter((r) => r.selected).map((r) => r.clientId);
  const more = sessions.concat([
    { eventId: 'nov6', clientName: 'Yusuf', title: 'Yusuf PT', date: '2026-11-06', start: '10:00', end: '11:00', status: 'normal', disposition: 'kept' }
  ]);
  const first = PT.applyLegacyBalances(clients, picked.concat(['sherine', 'marked', 'ready', 'ancient']), more, now, periods);
  assert.deepEqual(first.applied.slice().sort(), ['reno', 'yusuf']);
  const y2 = first.clients.filter((c) => c.id === 'yusuf')[0];
  assert.equal(y2.packages[0].value, '4080');
  assert.equal(y2.packages[0].startDate, '2026-11-05');
  assert.equal(y2.packages[0].note, 'Split with mira');
  assert.equal(y2.packages[0].balanceMode, 'auto');
  assert.equal(PT.currentRemaining(y2, more, first.clients, now).remaining, 10);
  assert.equal(first.clients.filter((c) => c.id === 'sherine')[0].packages[0].sessionsLeft, '0');
  assert.equal(first.clients.filter((c) => c.id === 'marked')[0].packages[0].balanceMode, 'manual');
  assert.equal(first.clients.filter((c) => c.id === 'marked')[0].packages[0].sessionsLeft, '0');
  assert.equal(first.clients.filter((c) => c.id === 'ancient')[0].packages[0].sessionsLeft, '15');
  const old = first.clients.filter((c) => c.id === 'reno')[0].packages[0];
  assert.equal(old.sessionsLeft, '5');
  assert.equal(old.note, 'old note');
  assert.equal(old.value, '800');
  assert.equal(old.startDate, '2026-06-01');
  const second = PT.applyLegacyBalances(first.clients, picked, more, now, periods);
  assert.equal(second.applied.length, 0);
  assert.equal(PT.currentRemaining(second.clients.filter((c) => c.id === 'yusuf')[0], more, second.clients, now).remaining, 10);
  assert.equal(second.clients.length, clients.length);
});

test('exact names do not let Ali take Alison', () => {
  assert.equal(PT.namesMatch('Ali', 'Alison'), false);
  assert.equal(PT.namesMatch('Jean  Pierre', 'jean pierre'), true);
  const ali = client({ id: '1', name: 'Ali', packageSessions: '10', packageValue: '2000', startDate: '2026-01-01' });
  const sessions = [{ eventId: 'a', clientName: 'Alison', date: '2026-02-01', status: 'normal', disposition: 'kept' }];
  assert.equal(PT.packageUsed(ali, sessions, ali.packages[0], [ali]), 0);
});
