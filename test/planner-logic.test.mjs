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
  assert.deepEqual(PT.parseTitle('Larissa PT'), { display: 'Larissa', key: 'larissa', explicit: true });
  assert.deepEqual(PT.parseTitle('Jeremy Pt '), { display: 'Jeremy', key: 'jeremy', explicit: true });
  assert.deepEqual(PT.parseTitle('Mohammad family PT'), { display: 'Mohammad family', key: 'mohammad family', explicit: true });
  assert.deepEqual(PT.parseTitle('  aurelie '), { display: 'aurelie', key: 'aurelie', explicit: false });
  assert.equal(PT.parseTitle('Larissa - PT').explicit, true);
  assert.equal(PT.parseTitle('Larissa - PT').display, 'Larissa');
});

test('Resumo and New month are ignored, a bare client name is not', () => {
  const clients = [client()];
  const result = PT.applySync([], [
    ev('1', 'Resumo', TODAY),
    ev('2', 'New month', TODAY),
    ev('3', 'New  month', TODAY),
    ev('4', 'Larissa PT', TODAY),
    ev('5', 'Aurelie ', TODAY, 'Nao tem sessoes'),
    ev('6', 'Lunch', TODAY),
    ev('7', 'Dentist', TODAY)
  ], Object.assign({ clients: clients, ignored: [] }, WINDOW));
  const names = result.sessions.filter((s) => !s.removed).map((s) => s.clientName).sort();
  assert.deepEqual(names, ['Aurelie', 'Larissa']);
  assert.equal(result.sessions.find((s) => s.clientName === 'Larissa').disposition, 'kept');
  assert.equal(result.sessions.find((s) => s.clientName === 'Aurelie').disposition, 'pending');
  assert.equal(result.added.length, 1);
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

test('an unknown name can be linked once and then counts', () => {
  const sofia = client({ id: 'sofia', name: 'Sofia', packageSessions: '8', packageValue: '3200', startDate: '2026-11-01' });
  const synced = PT.applySync([], [ev('a', 'Aurelie ', TODAY)], Object.assign({ clients: [sofia], ignored: [] }, WINDOW));
  assert.equal(PT.unmatchedFromSessions(synced.sessions, [sofia])[0].label, 'Aurelie');
  const linked = PT.linkName(synced.sessions && [sofia], synced.sessions, 'sofia', 'Aurelie');
  assert.deepEqual(linked.clients[0].aliases, ['Aurelie']);
  assert.equal(linked.sessions[0].disposition, 'kept');
  assert.equal(PT.currentRemaining(linked.clients[0], linked.sessions, linked.clients).used, 1);
  assert.equal(PT.unmatchedFromSessions(linked.sessions, linked.clients).length, 0);
  const next = PT.applySync(linked.sessions, [ev('b', 'Aurelie', '2026-11-04')], Object.assign({ clients: linked.clients, ignored: [] }, WINDOW));
  assert.equal(next.sessions.filter((s) => s.clientName === 'Aurelie' && s.disposition === 'kept').length, 2);
});

test('ignore hides a name from later checks', () => {
  const synced = PT.applySync([], [ev('a', 'Lunch', TODAY), ev('z', 'Resumo', TODAY)], Object.assign({ clients: [], ignored: [] }, WINDOW));
  assert.equal(synced.sessions.length, 0);
  const named = PT.applySync([], [ev('a', 'Samir', TODAY)], Object.assign({ clients: [], ignored: [] }, WINDOW));
  const ignored = PT.ignoreName([], named.sessions, 'Samir');
  const again = PT.applySync(ignored.sessions, [ev('a', 'Samir', TODAY), ev('b', 'Samir', '2026-11-05')], Object.assign({ clients: [], ignored: ignored.ignored }, WINDOW));
  assert.equal(PT.unmatchedFromSessions(again.sessions, []).length, 0);
  assert.equal(again.sessions.filter((s) => s.disposition === 'pending').length, 0);
});

test('two clients with the same name are not both charged for one session', () => {
  const a = client({ id: '1', name: 'Ali' });
  const b = client({ id: '2', name: 'Ali' });
  const synced = PT.applySync([], [ev('a', 'Ali PT', TODAY)], Object.assign({ clients: [a, b], ignored: [] }, WINDOW));
  assert.equal(synced.sessions[0].disposition, 'pending');
  assert.equal(PT.packageUsed(a, synced.sessions, a.packages[0], [a, b]), 0);
  assert.equal(PT.unmatchedFromSessions(synced.sessions, [a, b])[0].ambiguous, true);
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
  assert.equal(PT.getTier(120), 0.70);
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
  assert.match(mail.body, /Sessions added: 1/);
  assert.match(mail.body, /Jeremy \| 2026-11-02 09:00 \| free \| Free pra compensar outras sessoes/);
  assert.match(mail.body, /Older sessions saved: 1/);
  assert.match(mail.body, /Clients low or out: 1/);
  assert.match(mail.body, /Jeremy \| 2 left \| low/);
  assert.match(mail.body, /Flagged notes: 2/);
  assert.match(mail.body, /Unmatched names: 1/);
  assert.match(mail.body, /Aurelie \| 1 session/);
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
    ev('mid', 'PT Omar', '2026-11-04', '', '09:00')
  ], Object.assign({ clients: [], ignored: [], today: TODAY }, WINDOW));
  assert.equal(result.clients.length, 1);
  assert.equal(result.clients[0].name, 'Omar');
  assert.equal(result.clients[0].startDate, TODAY);
  assert.equal(result.sessions.filter((s) => s.disposition === 'kept').length, 3);
  assert.equal(PT.unmatchedFromSessions(result.sessions, result.clients).length, 0);
  const again = PT.applySync(result.sessions, [
    ev('old', 'Omar PT', '2026-08-01'),
    ev('today', 'Omar PT', TODAY),
    ev('mid', 'PT Omar', '2026-11-04')
  ], Object.assign({ clients: result.clients, ignored: [], today: TODAY }, WINDOW));
  assert.equal(again.clients.length, 1);
  const saved = PT.saveClientPackage(result.clients[0], {
    sessions: '10',
    sessionsLeft: '10',
    value: '4000',
    startDate: TODAY,
    paymentStatus: 'part',
    amountReceived: '1500',
    method: 'card'
  }, result.sessions, result.clients);
  const stats = PT.currentRemaining(saved, result.sessions, [saved]);
  assert.equal(stats.used, 2);
  assert.equal(stats.remaining, 10);
  assert.equal(stats.paymentStatus, 'part');
  assert.equal(PT.moneyDue(saved).due, 2500);
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
});

test('exact names do not let Ali take Alison', () => {
  assert.equal(PT.namesMatch('Ali', 'Alison'), false);
  assert.equal(PT.namesMatch('Jean  Pierre', 'jean pierre'), true);
  const ali = client({ id: '1', name: 'Ali', packageSessions: '10', packageValue: '2000', startDate: '2026-01-01' });
  const sessions = [{ eventId: 'a', clientName: 'Alison', date: '2026-02-01', status: 'normal', disposition: 'kept' }];
  assert.equal(PT.packageUsed(ali, sessions, ali.packages[0], [ali]), 0);
});
