// PT Planner. Paste this whole file into Code.gs.
// Do not put client names in this file. They stay in your private Google Sheet.
// Pure PT Planner rules. No Google calls, no client lists.
// The Apps Script file and the phone screen both use this.
var PT = (function () {
  var EMAIL_SUBJECT = 'PT Planner daily sync';
  var SUMMARY_EMAIL = 'pedrocerdeira81@gmail.com';
  var LOW_AT = 2;
  var EMAIL_CAP = 30;

  var BUILTIN_IGNORE = { 'resumo': true, 'new month': true };
  var STOP_FULL = {
    'lunch': true, 'dinner': true, 'breakfast': true, 'gym': true, 'workout': true,
    'personal': true, 'holiday': true, 'vacation': true, 'birthday': true, 'flight': true,
    'airport': true, 'doctor': true, 'dentist': true, 'haircut': true, 'meeting': true,
    'call': true, 'zoom': true, 'available': true, 'off': true, 'day off': true,
    'travel': true, 'busy': true, 'blocked': true, 'out of office': true, 'ooo': true,
    'focus time': true, 'appointment': true, 'reminder': true, 'notes': true, 'admin': true,
    'break': true, 'commute': true, 'school': true, 'pickup': true, 'birthday party': true
  };

  function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
  }
  function collapseSpace(s) {
    return String(s == null ? '' : s).replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function normName(s) {
    return collapseSpace(s).toLowerCase();
  }
  function namesMatch(a, b) {
    var x = normName(a), y = normName(b);
    if (!x || !y) return false;
    return x === y;
  }
  function addDaysYmd(ymd, n) {
    var p = String(ymd || '').split('-');
    var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    if (isNaN(dt.getTime())) return '';
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  function mondayOf(ymd) {
    var p = String(ymd || '').split('-');
    var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    if (isNaN(dt.getTime())) return '';
    var day = dt.getUTCDay();
    var diff = day === 0 ? -6 : 1 - day;
    return addDaysYmd(ymd, diff);
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function asAmountString(v) {
    if (v == null || v === '') return '';
    return String(v);
  }
  function inPeriod(d, period) {
    if (!d || !period || !period.start || !period.end) return false;
    var date = String(d).slice(0, 10);
    return date >= String(period.start) && date <= String(period.end);
  }
  // September 2026 J Club form: net 30452.65 / revenue 37304.50.
  // 81.63% on the form is this factor rounded. The longer figure matches the fils.
  var DEFAULT_NET_FACTOR = String((30452.65 / 37304.50) * 100);
  function defaultTiers() {
    return [
      { from: 0, rate: 45 },
      { from: 81, rate: 60 },
      { from: 101, rate: 65 },
      { from: 120, rate: 70 }
    ];
  }
  function roundFils(n) {
    var x = Number(n);
    if (!isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }
  function normalizeTiers(list) {
    var source = (Array.isArray(list) && list.length) ? list : defaultTiers();
    var map = {}, order = [], i, from, rate, key;
    for (i = 0; i < source.length; i++) {
      var row = source[i] || {};
      if (row.from === '' || row.from == null || row.rate === '' || row.rate == null) continue;
      from = Number(row.from);
      rate = Number(row.rate);
      if (!isFinite(from) || from < 0 || !isFinite(rate)) continue;
      from = Math.round(from);
      key = String(from);
      if (!Object.prototype.hasOwnProperty.call(map, key)) order.push(from);
      map[key] = rate;
    }
    if (!order.length) {
      source = defaultTiers();
      map = {};
      order = [];
      for (i = 0; i < source.length; i++) {
        order.push(source[i].from);
        map[String(source[i].from)] = source[i].rate;
      }
    }
    order.sort(function (a, b) { return a - b; });
    var out = [];
    for (i = 0; i < order.length; i++) out.push({ from: order[i], rate: map[String(order[i])] });
    return out;
  }
  function tierForCount(n, tiers) {
    var table = normalizeTiers(tiers);
    n = Number(n) || 0;
    var hit = table[0], i;
    for (i = 0; i < table.length; i++) {
      if (n >= table[i].from) hit = table[i];
    }
    return hit;
  }
  function getTier(n, tiers) {
    return (Number(tierForCount(n, tiers).rate) || 0) / 100;
  }
  function sessionsToNextTier(n, tiers) {
    var table = normalizeTiers(tiers);
    n = Number(n) || 0;
    var i;
    for (i = 0; i < table.length; i++) {
      if (table[i].from > n) return table[i].from - n;
    }
    return 0;
  }
  function getTierLabel(n, tiers) {
    var table = normalizeTiers(tiers);
    var hit = tierForCount(n, tiers);
    var nextFrom = null, i;
    for (i = 0; i < table.length; i++) {
      if (table[i].from > hit.from) { nextFrom = table[i].from; break; }
    }
    var rate = String(hit.rate) + '%';
    if (nextFrom == null) return hit.from + '+ · ' + rate;
    if (hit.from <= 0) return 'Up to ' + (nextFrom - 1) + ' · ' + rate;
    return hit.from + '-' + (nextFrom - 1) + ' · ' + rate;
  }
  function normalizePackage(p, fallbackId) {
    p = p || {};
    var sessions = (p.sessions != null && p.sessions !== '') ? p.sessions : p.packageSessions;
    var value = (p.value != null && p.value !== '') ? p.value : p.packageValue;
    var left = (p.sessionsLeft != null && p.sessionsLeft !== '') ? p.sessionsLeft : '';
    return {
      id: p.id ? String(p.id) : String(fallbackId || uid()),
      sessions: asAmountString(sessions),
      sessionsLeft: left === '' ? '' : String(left),
      value: asAmountString(value),
      startDate: p.startDate ? String(p.startDate).slice(0, 10) : '',
      note: p.note != null ? String(p.note) : ''
    };
  }
  function sortPackages(packages) {
    var arr = [], list = packages || [], i, out = [];
    for (i = 0; i < list.length; i++) arr.push({ p: list[i], i: i });
    arr.sort(function (a, b) {
      var as = a.p.startDate || '', bs = b.p.startDate || '';
      if (as < bs) return -1;
      if (as > bs) return 1;
      return a.i - b.i;
    });
    for (i = 0; i < arr.length; i++) out.push(arr[i].p);
    return out;
  }
  function currentPackage(packages) {
    var sorted = sortPackages(packages);
    if (!sorted.length) return null;
    return sorted[sorted.length - 1];
  }
  function withLegacy(client) {
    var cur = currentPackage(client.packages);
    var packages = [], list = client.packages || [], i;
    for (i = 0; i < list.length; i++) {
      packages.push(normalizePackage(list[i], list[i].id));
    }
    return {
      id: String(client.id),
      name: client.name,
      aliases: (client.aliases || []).slice(),
      packages: packages,
      packageSessions: cur ? cur.sessions : '',
      packageValue: cur ? cur.value : '',
      startDate: cur ? cur.startDate : ''
    };
  }
  function migrateClient(c) {
    if (!c || typeof c !== 'object') return null;
    var name = collapseSpace(c.name || '');
    var id = (c.id != null && String(c.id) !== '') ? String(c.id) : uid();
    var packages = [], i, aliases = [], seen = {}, own = normName(name);
    if (Array.isArray(c.packages) && c.packages.length) {
      for (i = 0; i < c.packages.length; i++) packages.push(normalizePackage(c.packages[i], id + '-pkg' + (i + 1)));
    } else {
      packages.push(normalizePackage({
        id: id + '-pkg1',
        sessions: c.packageSessions,
        value: c.packageValue,
        startDate: c.startDate,
        sessionsLeft: c.sessionsLeft,
        note: c.note
      }, id + '-pkg1'));
    }
    var rawAliases = Array.isArray(c.aliases) ? c.aliases : [];
    for (i = 0; i < rawAliases.length; i++) {
      var label = collapseSpace(rawAliases[i]);
      var n = normName(label);
      if (!n || n === own || seen[n]) continue;
      seen[n] = true;
      aliases.push(label);
    }
    if (!name && (c.id == null || String(c.id) === '')) return null;
    return withLegacy({ id: id, name: name, aliases: aliases, packages: packages });
  }
  function migrateClients(list) {
    if (!Array.isArray(list)) return [];
    var out = [], i, c;
    for (i = 0; i < list.length; i++) {
      c = migrateClient(list[i]);
      if (c && c.name) out.push(c);
    }
    return out;
  }
  function migrateCharge(c) {
    if (!c || typeof c !== 'object') return null;
    var amount = 0;
    if (c.amount != null && c.amount !== '') {
      var n = Number(c.amount);
      amount = isFinite(n) && n >= 0 ? n : 0;
    }
    return {
      id: c.id != null && String(c.id) !== '' ? String(c.id) : uid(),
      clientId: c.clientId != null ? String(c.clientId) : '',
      eventId: c.eventId != null ? String(c.eventId) : '',
      type: c.type ? String(c.type) : 'other',
      date: c.date ? String(c.date).slice(0, 10) : '',
      notes: c.notes != null ? String(c.notes) : '',
      amount: amount,
      createdAt: c.createdAt ? String(c.createdAt) : ''
    };
  }
  function migrateCharges(list) {
    if (!Array.isArray(list)) return [];
    var out = [], i, c;
    for (i = 0; i < list.length; i++) {
      c = migrateCharge(list[i]);
      if (c) out.push(c);
    }
    return out;
  }
  function normalizeComm(c) {
    c = c || {};
    return {
      quota: c.quota != null && c.quota !== '' ? String(c.quota) : '7758',
      netFactor: c.netFactor != null && c.netFactor !== '' ? String(c.netFactor) : DEFAULT_NET_FACTOR,
      includeCharges: !!c.includeCharges,
      showCommission: c.showCommission === false ? false : true,
      tiers: normalizeTiers(c.tiers)
    };
  }
  function normalizePeriod(p) {
    p = p || {};
    var start = p.start ? String(p.start).slice(0, 10) : '';
    var end = p.end ? String(p.end).slice(0, 10) : '';
    return { id: p.id ? String(p.id) : uid(), start: start, end: end };
  }
  function sortPeriods(list) {
    var out = [], i, p;
    for (i = 0; i < (list || []).length; i++) {
      p = normalizePeriod(list[i]);
      if (!p.start || !p.end || p.end < p.start) continue;
      out.push(p);
    }
    out.sort(function (a, b) {
      if (a.start < b.start) return -1;
      if (a.start > b.start) return 1;
      if (a.end < b.end) return -1;
      if (a.end > b.end) return 1;
      return 0;
    });
    return out;
  }
  function activePeriod(periods, today) {
    var list = sortPeriods(periods), i, hit = null, past = null;
    today = String(today || '');
    for (i = 0; i < list.length; i++) {
      if (today && today >= list[i].start && today <= list[i].end) hit = list[i];
      if (today && list[i].end < today) past = list[i];
    }
    if (hit) return hit;
    if (past) return past;
    return list.length ? list[list.length - 1] : null;
  }
  function savePeriods(existing, fields) {
    var list = sortPeriods(existing);
    var start = fields && fields.start ? String(fields.start).slice(0, 10) : '';
    var end = fields && fields.end ? String(fields.end).slice(0, 10) : '';
    if (!start || !end) throw new Error('Enter the start and the end.');
    if (end < start) throw new Error('The end date is before the start date.');
    var id = fields.id ? String(fields.id) : '';
    var next = [], found = false, i, made = id || uid();
    for (i = 0; i < list.length; i++) {
      if (id && String(list[i].id) === id) {
        next.push({ id: id, start: start, end: end });
        found = true;
      } else next.push(list[i]);
    }
    if (!found) next.push({ id: made, start: start, end: end });
    return { periods: sortPeriods(next), id: found ? id : made };
  }
  function syncWindow(today, periods) {
    var ahead = addDaysYmd(today, 60);
    var fallback = addDaysYmd(today, -60);
    var cap = addDaysYmd(today, -120);
    var period = activePeriod(periods, today);
    var start = (period && period.start) ? period.start : fallback;
    if (start < cap) start = cap;
    if (!start || start > today) start = fallback;
    return { windowStart: start, windowEnd: ahead };
  }
  function resolvedNetFactor(comm) {
    var n = Number(comm && comm.netFactor);
    if (!n) n = Number(DEFAULT_NET_FACTOR);
    return n / 100;
  }
  function resolvedQuota(comm) {
    var n = Number(comm && comm.quota);
    return n || 0;
  }
  function clientsForName(clients, sessionName) {
    var n = normName(sessionName), out = [], list = clients || [], i, j;
    if (!n) return out;
    for (i = 0; i < list.length; i++) {
      if (normName(list[i].name) === n) { out.push(list[i]); continue; }
      var aliases = list[i].aliases || [];
      for (j = 0; j < aliases.length; j++) {
        if (normName(aliases[j]) === n) { out.push(list[i]); break; }
      }
    }
    return out;
  }
  function findClient(clients, sessionName) {
    var hits = clientsForName(clients, sessionName);
    return hits.length === 1 ? hits[0] : null;
  }
  function sessionCountsFor(client, allClients, sessionName) {
    if (!client) return false;
    var owner = findClient(allClients || [client], sessionName);
    return !!(owner && String(owner.id) === String(client.id));
  }
  function packageForDate(packages, date) {
    var sorted = sortPackages(packages), found = null, i, start;
    for (i = 0; i < sorted.length; i++) {
      start = sorted[i].startDate || '';
      if (start && String(date) < start) break;
      found = sorted[i];
    }
    return found;
  }
  function packageWindow(packages, pkg) {
    var sorted = sortPackages(packages), idx = -1, i, next;
    for (i = 0; i < sorted.length; i++) {
      if (String(sorted[i].id) === String(pkg.id)) { idx = i; break; }
    }
    next = (idx >= 0 && idx < sorted.length - 1) ? sorted[idx + 1] : null;
    return { start: (pkg && pkg.startDate) || '', end: next && next.startDate ? next.startDate : '' };
  }
  function sessionInWindow(date, w) {
    if (!date) return false;
    if (w.start && String(date) < String(w.start)) return false;
    if (w.end && String(date) >= String(w.end)) return false;
    return true;
  }
  function isYes(v) {
    return v === true || v === 'yes' || v === 'true' || v === 1 || v === '1';
  }
  function isBillable(session) {
    if (!session) return false;
    if (isYes(session.removed) || isYes(session.hidden)) return false;
    if (session.disposition && session.disposition !== 'kept') return false;
    if (session.status === 'free') return false;
    return true;
  }
  function sessionCounts(session, client, allClients) {
    if (!isBillable(session)) return false;
    return sessionCountsFor(client, allClients, session.clientName);
  }
  function packageUsed(client, sessions, pkg, allClients) {
    if (!client || !pkg) return 0;
    var w = packageWindow(client.packages, pkg), n = 0, list = sessions || [], i;
    for (i = 0; i < list.length; i++) {
      if (!sessionCounts(list[i], client, allClients)) continue;
      if (!sessionInWindow(list[i].date, w)) continue;
      n++;
    }
    return n;
  }
  function sessionRate(pkg) {
    var n = Number(pkg && pkg.sessions);
    if (!(n > 0)) return 0;
    return Number(pkg.value || 0) / n;
  }
  function rateForSessionDate(packages, date) {
    var sorted = sortPackages(packages), pkg;
    if (!sorted.length) return 0;
    pkg = packageForDate(sorted, date);
    if (!pkg) pkg = sorted[0];
    return sessionRate(pkg);
  }
  function periodSessionRevenue(clients, sessions, period, today) {
    var total = 0, list = sessions || [], i, owner;
    for (i = 0; i < list.length; i++) {
      if (!isBillable(list[i])) continue;
      if (!inPeriod(list[i].date, period, today)) continue;
      owner = findClient(clients, list[i].clientName);
      if (!owner) continue;
      total += rateForSessionDate(owner.packages, list[i].date);
    }
    return total;
  }
  function periodBillable(clients, sessions, period, today) {
    var out = [], list = sessions || [], i;
    for (i = 0; i < list.length; i++) {
      if (!isBillable(list[i])) continue;
      if (!inPeriod(list[i].date, period, today)) continue;
      if (!findClient(clients, list[i].clientName)) continue;
      out.push(list[i]);
    }
    return out;
  }
  function chargeAmount(ch) {
    var n = Number(ch && ch.amount);
    return isFinite(n) ? n : 0;
  }
  function periodChargeTotal(charges, period, today) {
    var total = 0, list = charges || [], i;
    for (i = 0; i < list.length; i++) {
      if (!inPeriod(list[i].date, period, today)) continue;
      total += chargeAmount(list[i]);
    }
    return total;
  }
  function chargeTotalFor(charges, clientId) {
    var total = 0, list = charges || [], i;
    for (i = 0; i < list.length; i++) {
      if (clientId != null && String(list[i].clientId) !== String(clientId)) continue;
      total += chargeAmount(list[i]);
    }
    return total;
  }
  function commissionEstimate(opts) {
    opts = opts || {};
    var comm = normalizeComm(opts.comm);
    var sessionRevenue = Number(opts.sessionRevenue) || 0;
    var chargeTotal = Number(opts.chargeTotal) || 0;
    var sessionCount = Number(opts.sessionCount) || 0;
    var totalRevenue = sessionRevenue + (comm.includeCharges ? chargeTotal : 0);
    var netRevenue = roundFils(totalRevenue * resolvedNetFactor(comm));
    var quota = resolvedQuota(comm);
    var commRevenue = roundFils(Math.max(0, netRevenue - quota));
    var tierRate = getTier(sessionCount, comm.tiers);
    return {
      totalRevenue: roundFils(totalRevenue),
      netRevenue: netRevenue,
      quota: quota,
      netFactor: resolvedNetFactor(comm) * 100,
      commRevenue: commRevenue,
      commission: roundFils(commRevenue * tierRate),
      tierRate: tierRate,
      tierPercent: tierForCount(sessionCount, comm.tiers).rate,
      tierLabel: getTierLabel(sessionCount, comm.tiers),
      sessionsToNext: sessionsToNextTier(sessionCount, comm.tiers),
      sessionCount: sessionCount,
      sessionRevenue: roundFils(sessionRevenue),
      chargeTotal: chargeTotal,
      includeCharges: comm.includeCharges,
      showCommission: comm.showCommission
    };
  }
  function sessionsForClient(client, sessions, allClients) {
    var sorted = sortPackages(client && client.packages), first = sorted[0];
    var start = first && first.startDate ? first.startDate : '';
    var out = [], list = sessions || [], i;
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || isYes(s.removed) || isYes(s.hidden)) continue;
      if (s.disposition && s.disposition !== 'kept') continue;
      if (!sessionCountsFor(client, allClients || [client], s.clientName)) continue;
      if (start && s.date < start) continue;
      out.push(s);
    }
    out.sort(compareSessions);
    return out;
  }
  function packageReady(pkg) {
    return !!(pkg && String(pkg.sessions) !== '' && Number(pkg.sessions) > 0);
  }
  function openingLeft(pkg) {
    if (!pkg) return 0;
    if (pkg.sessionsLeft != null && String(pkg.sessionsLeft) !== '') return Number(pkg.sessionsLeft) || 0;
    return Number(pkg.sessions) || 0;
  }
  function currentRemaining(client, sessions, allClients) {
    var pkg = currentPackage(client && client.packages);
    var total = pkg ? (Number(pkg.sessions) || 0) : 0;
    var used = packageUsed(client, sessions, pkg, allClients || [client]);
    var opening = openingLeft(pkg);
    var remaining = opening - used;
    var per = sessionRate(pkg);
    var ready = packageReady(pkg);
    var price = pkg ? Number(pkg.value || 0) : 0;
    return {
      used: used,
      total: total,
      remaining: remaining,
      perSession: per,
      remainingValue: remaining * per,
      low: ready && remaining > 0 && remaining <= LOW_AT,
      out: ready && remaining <= 0,
      ready: ready,
      packageId: pkg ? pkg.id : '',
      value: price,
      startDate: pkg ? pkg.startDate : '',
      note: pkg ? pkg.note : ''
    };
  }
  function assertClientName(clients, name, exceptId) {
    var n = normName(name), list = clients || [], i, j;
    if (!n) throw new Error('Add a name.');
    for (i = 0; i < list.length; i++) {
      if (exceptId != null && String(list[i].id) === String(exceptId)) continue;
      if (normName(list[i].name) === n) throw new Error('Another client already uses that name.');
      var aliases = list[i].aliases || [];
      for (j = 0; j < aliases.length; j++) {
        if (normName(aliases[j]) === n) throw new Error('Another client already uses that name.');
      }
    }
  }
  function addAlias(clients, clientId, alias) {
    var label = collapseSpace(alias), n = normName(label), list = clients || [], owner = null, i, j;
    if (!n) throw new Error('That name is empty.');
    for (i = 0; i < list.length; i++) if (String(list[i].id) === String(clientId)) owner = list[i];
    if (!owner) throw new Error('Choose a client.');
    if (normName(owner.name) === n) return list;
    var owned = owner.aliases || [];
    for (j = 0; j < owned.length; j++) if (normName(owned[j]) === n) return list;
    for (i = 0; i < list.length; i++) {
      if (normName(list[i].name) === n) throw new Error(label + ' is already used by another client.');
      var aliases = list[i].aliases || [];
      for (j = 0; j < aliases.length; j++) {
        if (normName(aliases[j]) === n) throw new Error(label + ' is already used by another client.');
      }
    }
    var next = [];
    for (i = 0; i < list.length; i++) {
      if (String(list[i].id) !== String(clientId)) { next.push(list[i]); continue; }
      next.push(withLegacy({
        id: list[i].id,
        name: list[i].name,
        aliases: (list[i].aliases || []).concat([label]),
        packages: list[i].packages
      }));
    }
    return next;
  }
  function renewPackage(client, fields) {
    var cur = currentPackage(client.packages);
    var sessions = fields && fields.sessions;
    var start = fields && fields.startDate ? String(fields.startDate).slice(0, 10) : '';
    if (sessions == null || sessions === '' || !(Number(sessions) > 0)) throw new Error('Add the number of sessions.');
    if (!start) throw new Error('Add the start date.');
    if (cur && cur.startDate && start <= cur.startDate) throw new Error('Use a start date after ' + cur.startDate + '.');
    var pkg = normalizePackage(Object.assign({}, fields, { id: uid(), sessions: sessions, value: fields.value, startDate: start }));
    var packages = (client.packages || []).concat([pkg]);
    return withLegacy({ id: client.id, name: client.name, aliases: client.aliases || [], packages: packages });
  }
  function filledAmount(v) {
    return v != null && String(v) !== '';
  }
  function updateCurrentPackage(client, fields) {
    fields = fields || {};
    var packages = (client.packages && client.packages.length) ? client.packages : [normalizePackage({
      sessions: '', value: '', startDate: ''
    }, String(client.id || 'c') + '-pkg1')];
    var cur = currentPackage(packages);
    var nextPkgs = [], i, prev, merged;
    for (i = 0; i < packages.length; i++) {
      if (String(packages[i].id) !== String(cur.id)) { nextPkgs.push(packages[i]); continue; }
      prev = packages[i];
      merged = {
        id: prev.id,
        sessions: filledAmount(fields.sessions) ? fields.sessions : prev.sessions,
        sessionsLeft: prev.sessionsLeft,
        value: filledAmount(fields.value) ? fields.value : prev.value,
        startDate: filledAmount(fields.startDate) ? fields.startDate : prev.startDate,
        note: fields.note != null ? fields.note : prev.note
      };
      nextPkgs.push(normalizePackage(merged, prev.id));
    }
    return withLegacy({ id: client.id, name: client.name, aliases: client.aliases || [], packages: nextPkgs });
  }
  function createClient(clients, fields, sessions, allClients) {
    var name = collapseSpace(fields && fields.name);
    if (!name) throw new Error('Add a name.');
    if (fields.sessions == null || fields.sessions === '' || !(Number(fields.sessions) > 0)) throw new Error('Add the number of sessions.');
    var pool = allClients || clients || [];
    var existing = findClient(clients, name);
    if (existing) {
      var updated = saveClientPackage(existing, fields, sessions, pool);
      var replaced = [], n;
      for (n = 0; n < (clients || []).length; n++) {
        replaced.push(String(clients[n].id) === String(existing.id) ? updated : clients[n]);
      }
      return replaced;
    }
    assertClientName(clients, name);
    var shell = migrateClient({
      id: fields.id || uid(),
      name: name,
      packageSessions: fields.sessions,
      packageValue: fields.value || 0,
      startDate: fields.startDate || '',
      sessionsLeft: '',
      note: fields.note || '',
      aliases: []
    });
    var saved = saveClientPackage(shell, fields, sessions || [], pool.concat([shell]));
    return (clients || []).concat([saved]);
  }
  function saveClientPackage(client, fields, sessions, allClients) {
    fields = fields || {};
    var before = currentPackage(client && client.packages);
    var next = fields.mode === 'renew' ? renewPackage(client, fields) : updateCurrentPackage(client, fields);
    if (fields.name && normName(fields.name) !== normName(next.name)) {
      var renamed = renameClient([next], next.id, fields.name);
      next = renamed[0];
    }
    var pkg = currentPackage(next.packages);
    var counted = packageUsed(next, sessions || [], pkg, allClients || [next]);
    var explicitLeft = filledAmount(fields.sessionsLeft);
    var explicitSize = filledAmount(fields.sessions);
    var hadSize = !!(before && filledAmount(before.sessions) && Number(before.sessions) > 0);
    var packages = [], i, copy, desired;
    for (i = 0; i < next.packages.length; i++) {
      if (String(next.packages[i].id) !== String(pkg.id)) { packages.push(next.packages[i]); continue; }
      copy = normalizePackage(next.packages[i]);
      if (explicitLeft) {
        desired = Number(fields.sessionsLeft);
        if (!isFinite(desired) || desired < 0) throw new Error('Sessions left needs to be zero or more.');
        copy.sessionsLeft = String(desired + counted);
      } else if (fields.mode === 'renew' || (explicitSize && !hadSize)) {
        copy.sessionsLeft = '';
      } else if (before && filledAmount(before.sessionsLeft)) {
        copy.sessionsLeft = String(before.sessionsLeft);
      }
      packages.push(copy);
    }
    return withLegacy({ id: next.id, name: next.name, aliases: next.aliases || [], packages: packages });
  }
  function mergePackageRecord(kept, incoming) {
    var base = normalizePackage(kept || {});
    var next = normalizePackage(incoming || {}, base.id);
    if (!filledAmount(next.sessions) && filledAmount(base.sessions)) next.sessions = String(base.sessions);
    if (!filledAmount(next.value) && filledAmount(base.value)) next.value = String(base.value);
    if (!filledAmount(next.sessionsLeft) && filledAmount(base.sessionsLeft)) next.sessionsLeft = String(base.sessionsLeft);
    if (!filledAmount(next.startDate) && filledAmount(base.startDate)) next.startDate = String(base.startDate);
    if (!filledAmount(next.note) && filledAmount(base.note)) next.note = String(base.note);
    if (!next.id && base.id) next.id = base.id;
    return normalizePackage(next, next.id || base.id);
  }
  function mergeClientRecord(existing, incoming) {
    if (!existing) return migrateClient(incoming);
    if (!incoming) return migrateClient(existing);
    var ex = migrateClient(existing);
    var inc = migrateClient(incoming);
    var exPkgs = ex.packages || [];
    var inPkgs = inc.packages || [];
    var used = {}, merged = [], i, j, found;
    for (i = 0; i < inPkgs.length; i++) {
      found = null;
      for (j = 0; j < exPkgs.length; j++) {
        if (String(exPkgs[j].id) === String(inPkgs[i].id)) {
          found = exPkgs[j];
          used[String(exPkgs[j].id)] = true;
          break;
        }
      }
      merged.push(mergePackageRecord(found, inPkgs[i]));
    }
    for (j = 0; j < exPkgs.length; j++) {
      if (used[String(exPkgs[j].id)]) continue;
      if (filledAmount(exPkgs[j].sessions) || filledAmount(exPkgs[j].value) || filledAmount(exPkgs[j].sessionsLeft)) {
        merged.push(normalizePackage(exPkgs[j]));
      }
    }
    var aliases = (inc.aliases && inc.aliases.length) ? inc.aliases : (ex.aliases || []);
    return withLegacy({
      id: inc.id || ex.id,
      name: inc.name || ex.name,
      aliases: aliases,
      packages: merged.length ? merged : exPkgs
    });
  }
  function blankAutoClient(name, today) {
    return migrateClient({
      id: uid(),
      name: name,
      packageSessions: '',
      packageValue: '',
      startDate: today || '',
      sessionsLeft: '',
      aliases: []
    });
  }
  function renameClient(clients, clientId, name) {
    var label = collapseSpace(name);
    assertClientName(clients, label, clientId);
    var next = [], i, found = false;
    for (i = 0; i < (clients || []).length; i++) {
      if (String(clients[i].id) !== String(clientId)) { next.push(clients[i]); continue; }
      found = true;
      next.push(withLegacy({
        id: clients[i].id,
        name: label,
        aliases: clients[i].aliases || [],
        packages: clients[i].packages
      }));
    }
    if (!found) throw new Error('That client is not in the planner.');
    return next;
  }
  function titleHasFree(title) {
    return /\bfree\b/i.test(collapseSpace(title));
  }
  function parseTitle(title) {
    var trimmed = collapseSpace(title).replace(/[\s.。,!?;:'"’”‘…)\]}…\-–—|]+$/g, '').trim();
    var free = titleHasFree(title);
    if (!trimmed || !/\bpt$/i.test(trimmed)) return { display: '', key: '', explicit: false, free: free };
    var display = collapseSpace(trimmed.replace(/\s*\bpt$/i, ' ')).replace(/^[-–—|:,.\s]+|[-–—|:,.\s]+$/g, '').trim();
    display = collapseSpace(display);
    if (!display) return { display: '', key: '', explicit: true, free: free };
    return { display: display, key: normName(display), explicit: true, free: free };
  }
  function looksLikeClientName(display) {
    var s = collapseSpace(display);
    if (!s || s.length > 40) return false;
    if (/[0-9@]|https?:|www\./i.test(s)) return false;
    var parts = s.split(' ');
    if (!parts.length || parts.length > 4) return false;
    var i;
    for (i = 0; i < parts.length; i++) {
      if (!/^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F.'’-]{0,30}$/.test(parts[i])) return false;
    }
    return true;
  }
  function guessStatus(note) {
    var n = collapseSpace(note).toLowerCase();
    if (!n) return 'normal';
    if (/free|compensar|make[\s-]?up|cortesia|gr[aá]tis|gratis/.test(n)) return 'free';
    if (/charged|late[\s-]?cancel|no[\s-]?show|cobra[dn]/.test(n)) return 'charged';
    return 'normal';
  }
  function isFlaggedNote(note) {
    var n = collapseSpace(note).toLowerCase();
    if (!n) return false;
    return /charged|free|compensar|n[aã]o tem|nao tem|no sessions|late[\s-]?cancel|no[\s-]?show|make[\s-]?up|cortesia|gr[aá]tis|gratis/.test(n);
  }
  function isBuiltinIgnore(key) {
    return !!BUILTIN_IGNORE[key];
  }
  function isStoplist(key) {
    if (STOP_FULL[key]) return true;
    var first = String(key || '').split(' ')[0];
    return !!STOP_FULL[first];
  }
  function isIgnoredName(ignored, key) {
    var list = ignored || [], i;
    for (i = 0; i < list.length; i++) if (normName(list[i]) === key) return true;
    return false;
  }
  function compareSessions(a, b) {
    if ((a.date || '') < (b.date || '')) return -1;
    if ((a.date || '') > (b.date || '')) return 1;
    if ((a.start || '') < (b.start || '')) return -1;
    if ((a.start || '') > (b.start || '')) return 1;
    if ((a.clientName || '') < (b.clientName || '')) return -1;
    if ((a.clientName || '') > (b.clientName || '')) return 1;
    return 0;
  }
  function copySession(s) {
    return {
      eventId: String(s.eventId || ''),
      calendarId: s.calendarId || '',
      title: s.title || '',
      clientName: s.clientName || '',
      date: s.date ? String(s.date).slice(0, 10) : '',
      start: s.start || '',
      end: s.end || '',
      allDay: isYes(s.allDay),
      note: s.note || '',
      status: s.status || 'normal',
      statusLocked: isYes(s.statusLocked),
      disposition: s.disposition || 'pending',
      hidden: isYes(s.hidden),
      removed: isYes(s.removed),
      createdAt: s.createdAt || ''
    };
  }
  function blankSession(ev, parsed, stamp) {
    return {
      eventId: String(ev.eventId),
      calendarId: ev.calendarId || '',
      title: ev.title || '',
      clientName: parsed.display,
      date: ev.date || '',
      start: ev.allDay ? '' : (ev.start || ''),
      end: ev.allDay ? '' : (ev.end || ''),
      allDay: !!ev.allDay,
      note: collapseSpace(ev.note || ''),
      status: titleHasFree(ev.title) ? 'free' : guessStatus(ev.note),
      statusLocked: false,
      disposition: 'pending',
      hidden: false,
      removed: false,
      createdAt: stamp || ''
    };
  }
  function occurrenceSeriesId(eventId) {
    var id = String(eventId || '');
    var match = id.match(/^(.*)@(\d{8}T\d{6}Z)$/);
    if (!match || !match[2]) return '';
    return match[1];
  }
  function sameOccurrenceSlot(row, ev) {
    if (!row || !ev) return false;
    if (String(row.date || '') !== String(ev.date || '')) return false;
    var rowStart = row.allDay ? '' : (row.start || '');
    var evStart = ev.allDay ? '' : (ev.start || '');
    if (rowStart && evStart && rowStart !== evStart) return false;
    return true;
  }
  function retargetCharges(charges, idRemap) {
    var map = {}, i, ch, next, copy;
    for (i = 0; i < (idRemap || []).length; i++) {
      if (!idRemap[i] || !idRemap[i].from) continue;
      map[String(idRemap[i].from)] = String(idRemap[i].to || '');
    }
    var out = [];
    for (i = 0; i < (charges || []).length; i++) {
      ch = charges[i];
      next = map[String(ch && ch.eventId || '')];
      if (!next) { out.push(ch); continue; }
      copy = migrateCharge(ch);
      copy.eventId = next;
      out.push(copy);
    }
    return out;
  }
  function applySync(prevSessions, events, ctx) {
    ctx = ctx || {};
    var clients = (ctx.clients || []).slice();
    var byId = {}, i, list = prevSessions || [];
    for (i = 0; i < list.length; i++) {
      if (!list[i] || !list[i].eventId) continue;
      byId[String(list[i].eventId)] = copySession(list[i]);
    }
    var seen = {}, added = [], unique = [], seenEv = {}, idRemap = [];
    var incoming = events || [];
    for (i = 0; i < incoming.length; i++) {
      var ev = incoming[i];
      if (!ev || !ev.eventId || seenEv[String(ev.eventId)]) continue;
      seenEv[String(ev.eventId)] = true;
      unique.push(ev);
    }
    for (i = 0; i < unique.length; i++) {
      ev = unique[i];
      var id = String(ev.eventId);
      var parsed = parseTitle(ev.title);
      if (!parsed.explicit) {
        if (byId[id]) delete byId[id];
        continue;
      }
      seen[id] = true;
      if (!parsed.key || parsed.key === 'pt' || parsed.key.length < 2) continue;
      var prev = byId[id];
      if (!prev) {
        var seriesId = occurrenceSeriesId(id);
        var legacy = seriesId && byId[seriesId];
        if (legacy && sameOccurrenceSlot(legacy, ev)) {
          delete byId[seriesId];
          legacy.eventId = id;
          byId[id] = legacy;
          prev = legacy;
          idRemap.push({ from: seriesId, to: id });
        }
      }
      if (isIgnoredName(ctx.ignored, parsed.key)) {
        if (prev) {
          prev.disposition = 'ignored';
          prev.title = ev.title || prev.title;
          prev.date = ev.date || prev.date;
          prev.note = collapseSpace(ev.note || '');
          prev.removed = false;
        }
        continue;
      }
      var hits = clientsForName(clients, parsed.display);
      var disposition = 'pending';
      if (hits.length > 1) disposition = 'pending';
      else {
        if (!hits.length) {
          var made = blankAutoClient(parsed.display, ctx.today || '');
          clients = clients.concat([made]);
          hits = [made];
        }
        disposition = 'kept';
      }
      if (!prev) {
        var row = blankSession(ev, parsed, ctx.nowStamp || '');
        row.disposition = disposition;
        byId[id] = row;
        if (disposition === 'kept') added.push(row);
        continue;
      }
      var wasKept = prev.disposition === 'kept' && !prev.removed && !prev.hidden;
      prev.title = ev.title || prev.title;
      prev.clientName = parsed.display;
      prev.date = ev.date || prev.date;
      prev.start = ev.allDay ? '' : (ev.start || '');
      prev.end = ev.allDay ? '' : (ev.end || '');
      prev.allDay = !!ev.allDay;
      prev.note = collapseSpace(ev.note || '');
      prev.calendarId = ev.calendarId || prev.calendarId;
      prev.removed = false;
      if (!prev.hidden && !prev.dispositionLocked) prev.disposition = disposition;
      if (titleHasFree(ev.title)) prev.status = 'free';
      else if (!prev.statusLocked) prev.status = guessStatus(prev.note);
      if (prev.disposition === 'kept' && !prev.hidden && !wasKept) added.push(prev);
    }
    var start = ctx.windowStart || '';
    var end = ctx.windowEnd || '';
    var ids = [], k;
    for (k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) ids.push(k);
    for (i = 0; i < ids.length; i++) {
      if (!parseTitle(byId[ids[i]] && byId[ids[i]].title).explicit) delete byId[ids[i]];
    }
    for (i = 0; i < ids.length; i++) {
      var s = byId[ids[i]];
      if (!s || seen[s.eventId]) continue;
      var superseded = false, seenId;
      for (seenId in seen) {
        if (Object.prototype.hasOwnProperty.call(seen, seenId) && occurrenceSeriesId(seenId) === String(s.eventId)) {
          superseded = true;
          break;
        }
      }
      if (superseded && start && end && s.date >= start && s.date <= end) {
        delete byId[s.eventId];
        continue;
      }
      if (start && end && s.date >= start && s.date <= end) s.removed = true;
    }
    var sessions = [];
    for (i = 0; i < ids.length; i++) if (byId[ids[i]]) sessions.push(byId[ids[i]]);
    sessions.sort(compareSessions);
    added.sort(compareSessions);
    return { sessions: sessions, added: added, clients: clients, idRemap: idRemap };
  }
  function summaryAdded(sessions, today) {
    var cutoff = addDaysYmd(today, -1);
    var out = [], list = sessions || [], i, s, created;
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (!s || s.disposition !== 'kept' || isYes(s.hidden) || isYes(s.removed)) continue;
      if (s.status === 'free') continue;
      if (!s.date || s.date < cutoff) continue;
      created = String(s.createdAt || '').slice(0, 10);
      if (created !== today && created !== cutoff) continue;
      out.push(s);
    }
    out.sort(compareSessions);
    return out;
  }
  function olderSavedToday(sessions, today) {
    var cutoff = addDaysYmd(today, -1);
    var n = 0, i, s, created;
    for (i = 0; i < (sessions || []).length; i++) {
      s = sessions[i];
      created = String(s.createdAt || '').slice(0, 10);
      if (created !== today) continue;
      if (s.status === 'free') continue;
      if (s.date && s.date < cutoff) n++;
    }
    return n;
  }
  function lowClients(clients, sessions) {
    var out = [], list = clients || [], i, stats;
    for (i = 0; i < list.length; i++) {
      stats = currentRemaining(list[i], sessions, list);
      if (!stats.ready || !(stats.low || stats.out)) continue;
      out.push({ name: list[i].name, remaining: stats.remaining, out: stats.out, low: stats.low });
    }
    out.sort(function (a, b) { return a.remaining - b.remaining; });
    return out;
  }
  function flaggedSoon(sessions, today) {
    var end = addDaysYmd(today, 7);
    var out = [], list = sessions || [], i, s;
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (!s || isYes(s.removed) || isYes(s.hidden) || s.disposition !== 'kept') continue;
      if (!parseTitle(s.title).explicit && s.title) continue;
      if (!s.date || s.date < today || s.date > end) continue;
      if (s.status === 'free' || s.status === 'charged' || isFlaggedNote(s.note)) out.push(s);
    }
    out.sort(compareSessions);
    return out;
  }
  function unmatchedFromSessions(sessions, clients) {
    var map = {}, list = sessions || [], i, s, n, hits, key;
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (!s || isYes(s.removed) || isYes(s.hidden) || s.disposition !== 'pending') continue;
      n = normName(s.clientName);
      if (!n) continue;
      hits = clientsForName(clients, s.clientName);
      if (!map[n]) map[n] = { key: n, label: collapseSpace(s.clientName), count: 0, ambiguous: hits.length > 1 };
      map[n].count++;
      if (hits.length > 1) map[n].ambiguous = true;
    }
    var out = [];
    for (key in map) if (Object.prototype.hasOwnProperty.call(map, key)) out.push(map[key]);
    out.sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
    return out;
  }
  function emailLine(s) {
    var time = (s.allDay || !s.start) ? 'all-day' : s.start;
    var note = collapseSpace(s.note || '').replace(/\s+/g, ' ');
    if (note.length > 180) note = note.slice(0, 177) + '...';
    var bits = [s.clientName || s.title || 'Session', (s.date || '') + ' ' + time, s.status || 'normal'];
    if (note) bits.push(note);
    return bits.join(' | ');
  }
  function pushCapped(lines, items, format) {
    var n = Math.min(items.length, EMAIL_CAP), i;
    for (i = 0; i < n; i++) lines.push('- ' + format(items[i]));
    if (items.length > EMAIL_CAP) lines.push('- and ' + (items.length - EMAIL_CAP) + ' more');
    if (!items.length) lines.push('- None');
  }
  function buildDailyEmail(report) {
    report = report || {};
    var lines = [];
    lines.push('PT Planner daily sync');
    lines.push('Status: ' + (report.ok === false ? 'failed' : 'ok'));
    lines.push('When: ' + (report.when || ''));
    if (report.period) lines.push('Period: ' + report.period);
    lines.push('');
    if (report.ok === false) {
      lines.push('The automatic check did not finish.');
      lines.push('Error: ' + (report.error || 'Unknown error'));
      lines.push('Open PT Planner on the iPhone and tap Update from Calendar.');
      return { subject: EMAIL_SUBJECT, to: SUMMARY_EMAIL, body: lines.join('\n') };
    }
    var added = report.added || [];
    lines.push('Sessions added: ' + added.length);
    pushCapped(lines, added, emailLine);
    if (report.olderSaved > 0) lines.push('Older sessions saved: ' + report.olderSaved);
    lines.push('');
    var low = report.low || [];
    lines.push('Clients low or out: ' + low.length);
    pushCapped(lines, low, function (c) {
      return c.name + ' | ' + c.remaining + ' left | ' + (c.out ? 'out' : 'low');
    });
    lines.push('');
    var flagged = report.flagged || [];
    lines.push('Flagged notes: ' + flagged.length);
    pushCapped(lines, flagged, emailLine);
    return { subject: EMAIL_SUBJECT, to: SUMMARY_EMAIL, body: lines.join('\n') };
  }
  function buildSummary(state, today, whenLabel) {
    state = state || {};
    var sessions = state.sessions || [];
    var clients = state.clients || [];
    var period = activePeriod((state.settings && state.settings.periods) || [], today);
    return buildDailyEmail({
      ok: true,
      when: whenLabel || (today + ' Asia/Dubai'),
      period: period ? (period.start + ' to ' + period.end) : '',
      added: summaryAdded(sessions, today),
      olderSaved: olderSavedToday(sessions, today),
      low: lowClients(clients, sessions),
      flagged: flaggedSoon(sessions, today)
    });
  }
  function linkName(clients, sessions, clientId, aliasLabel) {
    var nextClients = addAlias(clients, clientId, aliasLabel);
    var key = normName(aliasLabel);
    var nextSessions = (sessions || []).map(function (s) {
      if (normName(s.clientName) !== key || isYes(s.removed)) return s;
      var c = copySession(s);
      c.disposition = 'kept';
      c.hidden = false;
      return c;
    });
    return { clients: nextClients, sessions: nextSessions };
  }
  function ignoreName(ignored, sessions, label) {
    var key = normName(label);
    var nextIgnored = (ignored || []).slice();
    if (!isIgnoredName(nextIgnored, key)) nextIgnored.push(collapseSpace(label));
    var nextSessions = (sessions || []).map(function (s) {
      if (normName(s.clientName) !== key) return s;
      var c = copySession(s);
      c.disposition = 'ignored';
      return c;
    });
    return { ignored: nextIgnored, sessions: nextSessions };
  }
  function setStatus(sessions, eventId, status) {
    if (status !== 'normal' && status !== 'free' && status !== 'charged') throw new Error('Pick normal, free, or charged.');
    var found = false;
    var next = (sessions || []).map(function (s) {
      if (String(s.eventId) !== String(eventId)) return s;
      found = true;
      var c = copySession(s);
      c.status = status;
      c.statusLocked = true;
      return c;
    });
    if (!found) throw new Error('That session is not in the planner.');
    return next;
  }
  function hideSession(sessions, eventId) {
    var found = false;
    var next = (sessions || []).map(function (s) {
      if (String(s.eventId) !== String(eventId)) return s;
      found = true;
      var c = copySession(s);
      c.hidden = true;
      return c;
    });
    if (!found) throw new Error('That session is not in the planner.');
    return next;
  }
  function deleteClient(clients, sessions, clientId) {
    var victim = null, i;
    for (i = 0; i < (clients || []).length; i++) if (String(clients[i].id) === String(clientId)) victim = clients[i];
    var nextClients = (clients || []).filter(function (c) { return String(c.id) !== String(clientId); });
    if (!victim) return { clients: nextClients, sessions: sessions || [] };
    var names = {}, aliases = victim.aliases || [];
    names[normName(victim.name)] = true;
    for (i = 0; i < aliases.length; i++) names[normName(aliases[i])] = true;
    var nextSessions = (sessions || []).map(function (s) {
      if (!names[normName(s.clientName)]) return s;
      if (s.disposition === 'ignored') return s;
      if (findClient(nextClients, s.clientName)) return s;
      var c = copySession(s);
      c.disposition = 'pending';
      return c;
    });
    return { clients: nextClients, sessions: nextSessions };
  }
  function chargeKey(ch) {
    return [ch.clientId, ch.date, ch.type, collapseSpace(ch.notes), String(ch.amount), ch.eventId || ''].join('|');
  }
  function mergeMigration(current, incoming) {
    current = current || {};
    var clients = migrateClients(current.clients || []);
    var added = [], skipped = [], i;
    var incomingClients = migrateClients((incoming && incoming.clients) || []);
    for (i = 0; i < incomingClients.length; i++) {
      var c = incomingClients[i];
      if (!c.name) continue;
      if (findClient(clients, c.name) || clientsForName(clients, c.name).length) { skipped.push(c.name); continue; }
      clients = clients.concat([c]);
      added.push(c.name);
    }
    var charges = migrateCharges(current.charges || []);
    var seen = {}, j;
    for (j = 0; j < charges.length; j++) seen[chargeKey(charges[j])] = true;
    var more = migrateCharges((incoming && incoming.charges) || []);
    for (j = 0; j < more.length; j++) {
      var key = chargeKey(more[j]);
      if (seen[key]) continue;
      var owner = null;
      for (i = 0; i < clients.length; i++) if (String(clients[i].id) === String(more[j].clientId)) owner = clients[i];
      if (!owner) continue;
      seen[key] = true;
      charges.push(more[j]);
    }
    var settings = current.settings ? {
      quota: current.settings.quota,
      netFactor: current.settings.netFactor,
      includeCharges: current.settings.includeCharges,
      showCommission: current.settings.showCommission,
      periodStart: current.settings.periodStart || '',
      periodEnd: current.settings.periodEnd || ''
    } : {};
    var comm = normalizeComm((incoming && incoming.comm) || {});
    var period = normalizePeriod((incoming && incoming.period) || {});
    if (settings.quota == null || settings.quota === '') settings.quota = comm.quota;
    if (settings.netFactor == null || settings.netFactor === '') settings.netFactor = comm.netFactor;
    if (settings.includeCharges == null) settings.includeCharges = comm.includeCharges;
    if (settings.showCommission == null) settings.showCommission = comm.showCommission;
    if (!settings.periodStart && !settings.periodEnd && period.start && period.end) {
      settings.periodStart = period.start;
      settings.periodEnd = period.end;
    }
    return { clients: clients, charges: charges, settings: settings, added: added, skipped: skipped };
  }
  function visibleSessions(sessions) {
    return (sessions || []).filter(function (s) {
      return s && !isYes(s.removed) && !isYes(s.hidden) && s.disposition !== 'ignored';
    });
  }

  return {
    EMAIL_SUBJECT: EMAIL_SUBJECT,
    SUMMARY_EMAIL: SUMMARY_EMAIL,
    LOW_AT: LOW_AT,
    collapseSpace: collapseSpace,
    normName: normName,
    namesMatch: namesMatch,
    addDaysYmd: addDaysYmd,
    mondayOf: mondayOf,
    uid: uid,
    inPeriod: inPeriod,
    sortPeriods: sortPeriods,
    activePeriod: activePeriod,
    savePeriods: savePeriods,
    syncWindow: syncWindow,
    saveClientPackage: saveClientPackage,
    mergeClientRecord: mergeClientRecord,
    packageReady: packageReady,
    defaultTiers: defaultTiers,
    normalizeTiers: normalizeTiers,
    getTier: getTier,
    getTierLabel: getTierLabel,
    sessionsToNextTier: sessionsToNextTier,
    titleHasFree: titleHasFree,
    migrateClient: migrateClient,
    migrateClients: migrateClients,
    migrateCharge: migrateCharge,
    migrateCharges: migrateCharges,
    normalizeComm: normalizeComm,
    normalizePeriod: normalizePeriod,
    currentPackage: currentPackage,
    sortPackages: sortPackages,
    clientsForName: clientsForName,
    findClient: findClient,
    packageUsed: packageUsed,
    packageWindow: packageWindow,
    isBillable: isBillable,
    periodSessionRevenue: periodSessionRevenue,
    periodBillable: periodBillable,
    chargeAmount: chargeAmount,
    periodChargeTotal: periodChargeTotal,
    chargeTotalFor: chargeTotalFor,
    commissionEstimate: commissionEstimate,
    sessionsForClient: sessionsForClient,
    currentRemaining: currentRemaining,
    renewPackage: renewPackage,
    updateCurrentPackage: updateCurrentPackage,
    createClient: createClient,
    renameClient: renameClient,
    addAlias: addAlias,
    parseTitle: parseTitle,
    looksLikeClientName: looksLikeClientName,
    guessStatus: guessStatus,
    isFlaggedNote: isFlaggedNote,
    applySync: applySync,
    retargetCharges: retargetCharges,
    summaryAdded: summaryAdded,
    olderSavedToday: olderSavedToday,
    lowClients: lowClients,
    flaggedSoon: flaggedSoon,
    unmatchedFromSessions: unmatchedFromSessions,
    buildDailyEmail: buildDailyEmail,
    buildSummary: buildSummary,
    linkName: linkName,
    ignoreName: ignoreName,
    setStatus: setStatus,
    hideSession: hideSession,
    deleteClient: deleteClient,
    mergeMigration: mergeMigration,
    visibleSessions: visibleSessions,
    compareSessions: compareSessions,
    copySession: copySession
  };
})();


// Google Apps Script side. Paste together with the rules above, into Code.gs.
var TZ = 'Asia/Dubai';
var CLIENT_HEADERS = ['id', 'name', 'aliases', 'packages', 'createdAt'];
var SESSION_HEADERS = ['eventId', 'calendarId', 'title', 'clientName', 'date', 'start', 'end', 'allDay', 'note', 'status', 'statusLocked', 'disposition', 'hidden', 'removed', 'createdAt'];
var CHARGE_HEADERS = ['id', 'clientId', 'eventId', 'type', 'amount', 'date', 'notes', 'createdAt'];
var SETTING_HEADERS = ['key', 'value'];
var CODE_MARK = '2026-11-06-source';

function doGet() {
  return HtmlService.createHtmlOutput(appHtml_())
    .setTitle('PT Planner')
    .setFaviconUrl('https://pedrocerdeira81-coder.github.io/Pt-planner/icons/planner-180.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function appHtml_() {
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"default\">\n<meta name=\"apple-mobile-web-app-title\" content=\"PT Planner\">\n<meta name=\"theme-color\" content=\"#f4f0e8\">\n<title>PT Planner</title>\n<link rel=\"apple-touch-icon\" href=\"https://pedrocerdeira81-coder.github.io/Pt-planner/icons/planner-180.png\">\n<link rel=\"icon\" href=\"https://pedrocerdeira81-coder.github.io/Pt-planner/icons/planner-180.png\">\n<style>\n:root {\n  --bg: #e7e2d8;\n  --paper: #f7f4ee;\n  --card: #fffcf8;\n  --ink: #1c211e;\n  --muted: #746d64;\n  --line: #e4dcd0;\n  --green: #0e6b4f;\n  --green-soft: #e5f3ec;\n  --amber: #8a5a00;\n  --amber-soft: #fff4d8;\n  --red: #8e2f2f;\n  --red-soft: #fdecec;\n  --blue: #1d4f86;\n  --blue-soft: #e8f1fb;\n  --shadow: 0 1px 1px rgba(50, 32, 10, 0.04), 0 10px 30px rgba(50, 32, 10, 0.06);\n}\n* { box-sizing: border-box; }\nhtml, body { margin: 0; padding: 0; width: 100%; min-height: 100%; }\nhtml { -webkit-text-size-adjust: 100%; }\nbody {\n  background: var(--bg);\n  color: var(--ink);\n  font-family: \"Avenir Next\", \"Segoe UI\", -apple-system, BlinkMacSystemFont, sans-serif;\n  letter-spacing: -0.011em;\n  -webkit-font-smoothing: antialiased;\n  text-rendering: optimizeLegibility;\n}\nbutton, input, select, textarea { font: inherit; color: inherit; }\nbutton { cursor: pointer; }\n.app {\n  width: 100%;\n  max-width: 480px;\n  min-height: 100dvh;\n  margin: 0 auto;\n  background: var(--paper);\n  position: relative;\n}\n.example {\n  background: #146c43;\n  color: #f4fff8;\n  text-align: center;\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: 0.04em;\n  padding: 8px 16px;\n}\n.top {\n  padding: calc(16px + constant(safe-area-inset-top)) 18px 8px;\n  padding: calc(16px + env(safe-area-inset-top)) 18px 8px;\n  display: flex;\n  justify-content: space-between;\n  align-items: flex-start;\n  gap: 12px;\n}\n.brand {\n  font-family: \"Iowan Old Style\", Palatino, ui-serif, Georgia, serif;\n  font-size: 30px;\n  line-height: 1;\n  letter-spacing: -0.03em;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.mark {\n  width: 28px;\n  height: 28px;\n  border-radius: 9px;\n  background: var(--green);\n  color: #f4fff8;\n  font-family: \"Avenir Next\", -apple-system, sans-serif;\n  font-size: 11px;\n  font-weight: 750;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  letter-spacing: 0.04em;\n}\n.brand .mark { color: #f4fff8; }\n.sub { color: var(--muted); font-size: 13px; margin-top: 6px; }\n.icon-btn, .back {\n  border: 0;\n  background: var(--card);\n  width: 44px;\n  height: 44px;\n  border-radius: 14px;\n  box-shadow: var(--shadow);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 0;\n}\n.back { width: auto; padding: 0 14px; font-weight: 650; font-size: 15px; }\nsvg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\n.wrap { padding: 8px 16px 108px; }\nh2 {\n  font-size: 13px;\n  letter-spacing: 0.08em;\n  text-transform: uppercase;\n  color: var(--muted);\n  margin: 18px 0 10px;\n  font-weight: 750;\n}\n.card, .row, .client, .primary, .ghost, .danger {\n  transition: transform .18s ease, box-shadow .18s ease, background .18s ease;\n}\n.card {\n  background: var(--card);\n  border-radius: 22px;\n  box-shadow: var(--shadow);\n  padding: 16px;\n  margin-bottom: 12px;\n}\n.sheet { animation: rise .28s ease; }\n@keyframes rise { from { transform: translateY(18px); opacity: .5; } to { transform: none; opacity: 1; } }\n.row {\n  width: 100%;\n  text-align: left;\n  border: 0;\n  background: var(--card);\n  border-radius: 18px;\n  box-shadow: var(--shadow);\n  padding: 12px 14px;\n  margin-bottom: 10px;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n.when { width: 72px; flex: none; color: var(--muted); font-size: 13px; font-weight: 700; }\n.when b { display: block; color: var(--ink); font-size: 15px; font-weight: 750; }\n.grow { flex: 1; min-width: 0; }\n.name { font-size: 16px; font-weight: 720; letter-spacing: -0.02em; }\n.note { color: var(--muted); font-size: 13px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.tag, .pill {\n  border-radius: 999px;\n  padding: 4px 8px;\n  font-size: 11px;\n  font-weight: 750;\n  letter-spacing: 0.02em;\n  flex: none;\n}\n.tag.normal, .pill.ok { background: var(--green-soft); color: var(--green); }\n.tag.free { background: var(--blue-soft); color: var(--blue); }\n.tag.charged, .pill.low { background: var(--amber-soft); color: var(--amber); }\n.pill.out { background: var(--red-soft); color: var(--red); }\n.client {\n  display: block;\n  width: 100%;\n  text-align: left;\n  border: 0;\n  background: var(--card);\n  border-radius: 18px;\n  box-shadow: var(--shadow);\n  padding: 14px;\n  margin-bottom: 10px;\n  border-left: 4px solid var(--green);\n}\n.client.low { border-left-color: #e0a100; }\n.client.out { border-left-color: var(--red); }\n.client-top, .spread { display: flex; justify-content: space-between; align-items: center; gap: 8px; }\n.left { font-weight: 750; }\n.left.low { color: var(--amber); }\n.left.out { color: var(--red); }\n.left.ok { color: var(--green); }\n.bar { height: 6px; background: #efe8dc; border-radius: 99px; margin: 10px 0 8px; overflow: hidden; }\n.bar span { display: block; height: 100%; background: var(--green); border-radius: 99px; }\n.client.low .bar span { background: #e0a100; }\n.client.out .bar span { background: var(--red); }\n.meta { color: var(--muted); font-size: 13px; }\n.primary, .ghost, .danger {\n  width: 100%;\n  min-height: 48px;\n  border-radius: 14px;\n  border: 0;\n  font-weight: 720;\n  margin-top: 8px;\n}\n.primary { background: var(--green); color: white; }\n.ghost { background: transparent; border: 1.5px solid var(--line); }\n.danger { background: var(--red-soft); color: var(--red); }\n.small { width: auto; min-height: 40px; padding: 0 14px; margin: 0; }\n.nav {\n  position: fixed;\n  left: 50%;\n  transform: translateX(-50%);\n  width: min(480px, 100%);\n  bottom: 0;\n  display: flex;\n  background: rgba(255, 253, 251, 0.94);\n  backdrop-filter: blur(16px);\n  border-top: 1px solid var(--line);\n  padding: 6px 6px calc(8px + constant(safe-area-inset-bottom));\n  padding-bottom: calc(8px + env(safe-area-inset-bottom));\n  z-index: 5;\n}\n.nav button {\n  flex: 1;\n  border: 0;\n  background: transparent;\n  color: var(--muted);\n  font-size: 11px;\n  font-weight: 720;\n  padding: 6px 0 4px;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 2px;\n}\n.nav button.on { color: var(--green); }\n.hero-num {\n  font-family: ui-serif, Georgia, serif;\n  font-size: 64px;\n  line-height: 0.9;\n  letter-spacing: -0.04em;\n}\n.hero-num small { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 16px; letter-spacing: 0; margin-left: 6px; font-weight: 650; }\n.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }\n.stat { background: #f6f3ee; border-radius: 14px; padding: 10px 12px; }\n.stat b { display: block; font-size: 15px; }\n.stat span { color: var(--muted); font-size: 11px; font-weight: 720; letter-spacing: 0.04em; text-transform: uppercase; }\nlabel { display: block; font-size: 12px; font-weight: 720; color: var(--muted); margin: 12px 0 6px; }\ninput, select, textarea {\n  width: 100%;\n  min-height: 48px;\n  border-radius: 14px;\n  border: 1.5px solid var(--line);\n  background: #fff;\n  padding: 12px 14px;\n  font-size: 16px;\n}\ntextarea { min-height: 80px; }\n.seg { display: flex; gap: 6px; }\n.seg button { flex: 1; min-height: 44px; border-radius: 12px; border: 1.5px solid var(--line); background: #fff; font-weight: 720; }\n.seg button.on { background: var(--ink); color: white; border-color: var(--ink); }\n.backdrop {\n  position: fixed;\n  inset: 0;\n  background: rgba(28, 25, 22, 0.42);\n  z-index: 20;\n  display: flex;\n  align-items: flex-end;\n  justify-content: center;\n}\n.sheet {\n  width: min(480px, 100%);\n  background: #fffdfb;\n  border-radius: 22px 22px 0 0;\n  padding: 10px 16px calc(18px + env(safe-area-inset-bottom));\n  max-height: 88dvh;\n  overflow: auto;\n}\n.handle { width: 40px; height: 4px; border-radius: 99px; background: #e4ddd2; margin: 6px auto 12px; }\n.day-head { display: flex; justify-content: space-between; align-items: baseline; margin: 16px 2px 8px; }\n.day-head b { font-size: 16px; }\n.today-mark { color: var(--green); }\n.empty { color: var(--muted); text-align: center; padding: 32px 16px; line-height: 1.45; }\n.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }\n.stats div { background: var(--card); border-radius: 18px; padding: 12px 10px; box-shadow: var(--shadow); }\n.stats b { display: block; font-size: 15px; letter-spacing: -0.03em; margin-top: 4px; }\n.stats span { color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: 0.06em; text-transform: uppercase; }\n.row.is-free { opacity: 0.55; }\n.row.is-free .name, .row.is-free .when b { color: var(--muted); font-weight: 650; }\n.tier-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }\n.tier-row input { min-height: 44px; }\n.tier-row .ghost { width: auto; min-height: 44px; margin-top: 0; padding: 0 12px; }\nbutton:disabled { opacity: .35; }\n.banner {\n  background: var(--green-soft);\n  color: var(--green);\n  border-radius: 14px;\n  padding: 12px 14px;\n  margin-bottom: 10px;\n  font-size: 14px;\n  font-weight: 650;\n}\n.warn {\n  background: var(--amber-soft);\n  color: #6d4700;\n  border-radius: 14px;\n  padding: 12px 14px;\n  margin-bottom: 10px;\n  font-size: 14px;\n}\n.err { color: var(--red); font-size: 14px; font-weight: 650; margin-top: 8px; }\n.weekbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; }\n.weekbar b { white-space: nowrap; }\n.daybar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }\n.daybar .ghost { width: auto; flex: 1 1 auto; min-height: 44px; margin-top: 0; padding: 0 10px; }\n.daybar input[type=\"date\"] { flex: 1 1 150px; min-width: 140px; min-height: 44px; }\n.day.is-selected { outline: 2px solid var(--green); border-radius: 16px; padding: 4px; }\n.when .meta { display: block; font-size: 11px; font-weight: 700; }\n.check { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 15px; }\n.check input { width: 22px; height: 22px; min-height: 0; }\n.pair { display: flex; gap: 8px; }\n.pair .ghost, .pair .primary, .pair .danger { margin-top: 0; }\nol.steps { margin: 8px 0 0; padding-left: 18px; }\nol.steps li { margin: 6px 0; }\na { color: var(--green); }\n.loading, .fatal { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 32px; text-align: center; }\n@media (min-width: 768px) {\n  .app {\n    max-width: 1100px;\n    display: grid;\n    grid-template-columns: 200px minmax(0, 1fr);\n    grid-template-rows: auto 1fr;\n    align-items: start;\n  }\n  .app > .top { grid-column: 2; grid-row: 1; padding-bottom: 0; }\n  .app > .wrap { grid-column: 2; grid-row: 2; padding: 8px 28px 40px; }\n  .app > .nav {\n    grid-column: 1;\n    grid-row: 1 / span 2;\n    position: sticky;\n    top: 0;\n    left: auto;\n    transform: none;\n    width: auto;\n    height: 100dvh;\n    flex-direction: column;\n    align-items: stretch;\n    justify-content: flex-start;\n    gap: 4px;\n    border-top: 0;\n    border-right: 1px solid var(--line);\n    background: #f3efe8;\n    padding: 22px 12px 22px;\n  }\n  .nav button {\n    flex: none;\n    flex-direction: row;\n    justify-content: flex-start;\n    gap: 10px;\n    font-size: 15px;\n    padding: 12px 14px;\n    border-radius: 12px;\n    text-align: left;\n  }\n  .nav button.on { background: var(--green-soft); }\n  .stats { grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); }\n  .home-split { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr); gap: 22px; align-items: start; }\n  .home-today { min-width: 0; }\n  .client-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }\n  .client-grid > .client, .client-grid > .row, .client-grid > .card { margin-bottom: 0; }\n  .week-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; align-items: start; }\n  .week-grid .day-head { margin-top: 0; }\n  .report-layout { display: grid; grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr); gap: 18px; align-items: start; }\n  .detail { display: grid; grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr); gap: 18px; align-items: start; }\n  .backdrop { align-items: center; padding: 24px; }\n  .sheet { width: min(560px, 100%); border-radius: 22px; max-height: 86dvh; }\n  .toolbar .primary { width: auto; min-width: 200px; padding-left: 22px; padding-right: 22px; }\n}\n@media (min-width: 1024px) {\n  .client-grid { grid-template-columns: 1fr 1fr 1fr; }\n  .week-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }\n}\n</style>\n</head>\n<body>\n<script type=\"application/json\" id=\"boot-data\">___PT_BOOT___</script>\n<div id=\"app\"></div>\n<script>\n// Pure PT Planner rules. No Google calls, no client lists.\n// The Apps Script file and the phone screen both use this.\nvar PT = (function () {\n  var EMAIL_SUBJECT = 'PT Planner daily sync';\n  var SUMMARY_EMAIL = 'pedrocerdeira81@gmail.com';\n  var LOW_AT = 2;\n  var EMAIL_CAP = 30;\n\n  var BUILTIN_IGNORE = { 'resumo': true, 'new month': true };\n  var STOP_FULL = {\n    'lunch': true, 'dinner': true, 'breakfast': true, 'gym': true, 'workout': true,\n    'personal': true, 'holiday': true, 'vacation': true, 'birthday': true, 'flight': true,\n    'airport': true, 'doctor': true, 'dentist': true, 'haircut': true, 'meeting': true,\n    'call': true, 'zoom': true, 'available': true, 'off': true, 'day off': true,\n    'travel': true, 'busy': true, 'blocked': true, 'out of office': true, 'ooo': true,\n    'focus time': true, 'appointment': true, 'reminder': true, 'notes': true, 'admin': true,\n    'break': true, 'commute': true, 'school': true, 'pickup': true, 'birthday party': true\n  };\n\n  function pad2(n) {\n    n = String(n);\n    return n.length < 2 ? '0' + n : n;\n  }\n  function collapseSpace(s) {\n    return String(s == null ? '' : s).replace(/[\\u00a0\\u200b\\u200c\\u200d\\ufeff]/g, ' ').replace(/\\s+/g, ' ').trim();\n  }\n  function normName(s) {\n    return collapseSpace(s).toLowerCase();\n  }\n  function namesMatch(a, b) {\n    var x = normName(a), y = normName(b);\n    if (!x || !y) return false;\n    return x === y;\n  }\n  function addDaysYmd(ymd, n) {\n    var p = String(ymd || '').split('-');\n    var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));\n    if (isNaN(dt.getTime())) return '';\n    dt.setUTCDate(dt.getUTCDate() + n);\n    return dt.toISOString().slice(0, 10);\n  }\n  function mondayOf(ymd) {\n    var p = String(ymd || '').split('-');\n    var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));\n    if (isNaN(dt.getTime())) return '';\n    var day = dt.getUTCDay();\n    var diff = day === 0 ? -6 : 1 - day;\n    return addDaysYmd(ymd, diff);\n  }\n  function uid() {\n    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);\n  }\n  function asAmountString(v) {\n    if (v == null || v === '') return '';\n    return String(v);\n  }\n  function inPeriod(d, period) {\n    if (!d || !period || !period.start || !period.end) return false;\n    var date = String(d).slice(0, 10);\n    return date >= String(period.start) && date <= String(period.end);\n  }\n  // September 2026 J Club form: net 30452.65 / revenue 37304.50.\n  // 81.63% on the form is this factor rounded. The longer figure matches the fils.\n  var DEFAULT_NET_FACTOR = String((30452.65 / 37304.50) * 100);\n  function defaultTiers() {\n    return [\n      { from: 0, rate: 45 },\n      { from: 81, rate: 60 },\n      { from: 101, rate: 65 },\n      { from: 120, rate: 70 }\n    ];\n  }\n  function roundFils(n) {\n    var x = Number(n);\n    if (!isFinite(x)) return 0;\n    return Math.round(x * 100) / 100;\n  }\n  function normalizeTiers(list) {\n    var source = (Array.isArray(list) && list.length) ? list : defaultTiers();\n    var map = {}, order = [], i, from, rate, key;\n    for (i = 0; i < source.length; i++) {\n      var row = source[i] || {};\n      if (row.from === '' || row.from == null || row.rate === '' || row.rate == null) continue;\n      from = Number(row.from);\n      rate = Number(row.rate);\n      if (!isFinite(from) || from < 0 || !isFinite(rate)) continue;\n      from = Math.round(from);\n      key = String(from);\n      if (!Object.prototype.hasOwnProperty.call(map, key)) order.push(from);\n      map[key] = rate;\n    }\n    if (!order.length) {\n      source = defaultTiers();\n      map = {};\n      order = [];\n      for (i = 0; i < source.length; i++) {\n        order.push(source[i].from);\n        map[String(source[i].from)] = source[i].rate;\n      }\n    }\n    order.sort(function (a, b) { return a - b; });\n    var out = [];\n    for (i = 0; i < order.length; i++) out.push({ from: order[i], rate: map[String(order[i])] });\n    return out;\n  }\n  function tierForCount(n, tiers) {\n    var table = normalizeTiers(tiers);\n    n = Number(n) || 0;\n    var hit = table[0], i;\n    for (i = 0; i < table.length; i++) {\n      if (n >= table[i].from) hit = table[i];\n    }\n    return hit;\n  }\n  function getTier(n, tiers) {\n    return (Number(tierForCount(n, tiers).rate) || 0) / 100;\n  }\n  function sessionsToNextTier(n, tiers) {\n    var table = normalizeTiers(tiers);\n    n = Number(n) || 0;\n    var i;\n    for (i = 0; i < table.length; i++) {\n      if (table[i].from > n) return table[i].from - n;\n    }\n    return 0;\n  }\n  function getTierLabel(n, tiers) {\n    var table = normalizeTiers(tiers);\n    var hit = tierForCount(n, tiers);\n    var nextFrom = null, i;\n    for (i = 0; i < table.length; i++) {\n      if (table[i].from > hit.from) { nextFrom = table[i].from; break; }\n    }\n    var rate = String(hit.rate) + '%';\n    if (nextFrom == null) return hit.from + '+ · ' + rate;\n    if (hit.from <= 0) return 'Up to ' + (nextFrom - 1) + ' · ' + rate;\n    return hit.from + '-' + (nextFrom - 1) + ' · ' + rate;\n  }\n  function normalizePackage(p, fallbackId) {\n    p = p || {};\n    var sessions = (p.sessions != null && p.sessions !== '') ? p.sessions : p.packageSessions;\n    var value = (p.value != null && p.value !== '') ? p.value : p.packageValue;\n    var left = (p.sessionsLeft != null && p.sessionsLeft !== '') ? p.sessionsLeft : '';\n    return {\n      id: p.id ? String(p.id) : String(fallbackId || uid()),\n      sessions: asAmountString(sessions),\n      sessionsLeft: left === '' ? '' : String(left),\n      value: asAmountString(value),\n      startDate: p.startDate ? String(p.startDate).slice(0, 10) : '',\n      note: p.note != null ? String(p.note) : ''\n    };\n  }\n  function sortPackages(packages) {\n    var arr = [], list = packages || [], i, out = [];\n    for (i = 0; i < list.length; i++) arr.push({ p: list[i], i: i });\n    arr.sort(function (a, b) {\n      var as = a.p.startDate || '', bs = b.p.startDate || '';\n      if (as < bs) return -1;\n      if (as > bs) return 1;\n      return a.i - b.i;\n    });\n    for (i = 0; i < arr.length; i++) out.push(arr[i].p);\n    return out;\n  }\n  function currentPackage(packages) {\n    var sorted = sortPackages(packages);\n    if (!sorted.length) return null;\n    return sorted[sorted.length - 1];\n  }\n  function withLegacy(client) {\n    var cur = currentPackage(client.packages);\n    var packages = [], list = client.packages || [], i;\n    for (i = 0; i < list.length; i++) {\n      packages.push(normalizePackage(list[i], list[i].id));\n    }\n    return {\n      id: String(client.id),\n      name: client.name,\n      aliases: (client.aliases || []).slice(),\n      packages: packages,\n      packageSessions: cur ? cur.sessions : '',\n      packageValue: cur ? cur.value : '',\n      startDate: cur ? cur.startDate : ''\n    };\n  }\n  function migrateClient(c) {\n    if (!c || typeof c !== 'object') return null;\n    var name = collapseSpace(c.name || '');\n    var id = (c.id != null && String(c.id) !== '') ? String(c.id) : uid();\n    var packages = [], i, aliases = [], seen = {}, own = normName(name);\n    if (Array.isArray(c.packages) && c.packages.length) {\n      for (i = 0; i < c.packages.length; i++) packages.push(normalizePackage(c.packages[i], id + '-pkg' + (i + 1)));\n    } else {\n      packages.push(normalizePackage({\n        id: id + '-pkg1',\n        sessions: c.packageSessions,\n        value: c.packageValue,\n        startDate: c.startDate,\n        sessionsLeft: c.sessionsLeft,\n        note: c.note\n      }, id + '-pkg1'));\n    }\n    var rawAliases = Array.isArray(c.aliases) ? c.aliases : [];\n    for (i = 0; i < rawAliases.length; i++) {\n      var label = collapseSpace(rawAliases[i]);\n      var n = normName(label);\n      if (!n || n === own || seen[n]) continue;\n      seen[n] = true;\n      aliases.push(label);\n    }\n    if (!name && (c.id == null || String(c.id) === '')) return null;\n    return withLegacy({ id: id, name: name, aliases: aliases, packages: packages });\n  }\n  function migrateClients(list) {\n    if (!Array.isArray(list)) return [];\n    var out = [], i, c;\n    for (i = 0; i < list.length; i++) {\n      c = migrateClient(list[i]);\n      if (c && c.name) out.push(c);\n    }\n    return out;\n  }\n  function migrateCharge(c) {\n    if (!c || typeof c !== 'object') return null;\n    var amount = 0;\n    if (c.amount != null && c.amount !== '') {\n      var n = Number(c.amount);\n      amount = isFinite(n) && n >= 0 ? n : 0;\n    }\n    return {\n      id: c.id != null && String(c.id) !== '' ? String(c.id) : uid(),\n      clientId: c.clientId != null ? String(c.clientId) : '',\n      eventId: c.eventId != null ? String(c.eventId) : '',\n      type: c.type ? String(c.type) : 'other',\n      date: c.date ? String(c.date).slice(0, 10) : '',\n      notes: c.notes != null ? String(c.notes) : '',\n      amount: amount,\n      createdAt: c.createdAt ? String(c.createdAt) : ''\n    };\n  }\n  function migrateCharges(list) {\n    if (!Array.isArray(list)) return [];\n    var out = [], i, c;\n    for (i = 0; i < list.length; i++) {\n      c = migrateCharge(list[i]);\n      if (c) out.push(c);\n    }\n    return out;\n  }\n  function normalizeComm(c) {\n    c = c || {};\n    return {\n      quota: c.quota != null && c.quota !== '' ? String(c.quota) : '7758',\n      netFactor: c.netFactor != null && c.netFactor !== '' ? String(c.netFactor) : DEFAULT_NET_FACTOR,\n      includeCharges: !!c.includeCharges,\n      showCommission: c.showCommission === false ? false : true,\n      tiers: normalizeTiers(c.tiers)\n    };\n  }\n  function normalizePeriod(p) {\n    p = p || {};\n    var start = p.start ? String(p.start).slice(0, 10) : '';\n    var end = p.end ? String(p.end).slice(0, 10) : '';\n    return { id: p.id ? String(p.id) : uid(), start: start, end: end };\n  }\n  function sortPeriods(list) {\n    var out = [], i, p;\n    for (i = 0; i < (list || []).length; i++) {\n      p = normalizePeriod(list[i]);\n      if (!p.start || !p.end || p.end < p.start) continue;\n      out.push(p);\n    }\n    out.sort(function (a, b) {\n      if (a.start < b.start) return -1;\n      if (a.start > b.start) return 1;\n      if (a.end < b.end) return -1;\n      if (a.end > b.end) return 1;\n      return 0;\n    });\n    return out;\n  }\n  function activePeriod(periods, today) {\n    var list = sortPeriods(periods), i, hit = null, past = null;\n    today = String(today || '');\n    for (i = 0; i < list.length; i++) {\n      if (today && today >= list[i].start && today <= list[i].end) hit = list[i];\n      if (today && list[i].end < today) past = list[i];\n    }\n    if (hit) return hit;\n    if (past) return past;\n    return list.length ? list[list.length - 1] : null;\n  }\n  function savePeriods(existing, fields) {\n    var list = sortPeriods(existing);\n    var start = fields && fields.start ? String(fields.start).slice(0, 10) : '';\n    var end = fields && fields.end ? String(fields.end).slice(0, 10) : '';\n    if (!start || !end) throw new Error('Enter the start and the end.');\n    if (end < start) throw new Error('The end date is before the start date.');\n    var id = fields.id ? String(fields.id) : '';\n    var next = [], found = false, i, made = id || uid();\n    for (i = 0; i < list.length; i++) {\n      if (id && String(list[i].id) === id) {\n        next.push({ id: id, start: start, end: end });\n        found = true;\n      } else next.push(list[i]);\n    }\n    if (!found) next.push({ id: made, start: start, end: end });\n    return { periods: sortPeriods(next), id: found ? id : made };\n  }\n  function syncWindow(today, periods) {\n    var ahead = addDaysYmd(today, 60);\n    var fallback = addDaysYmd(today, -60);\n    var cap = addDaysYmd(today, -120);\n    var period = activePeriod(periods, today);\n    var start = (period && period.start) ? period.start : fallback;\n    if (start < cap) start = cap;\n    if (!start || start > today) start = fallback;\n    return { windowStart: start, windowEnd: ahead };\n  }\n  function resolvedNetFactor(comm) {\n    var n = Number(comm && comm.netFactor);\n    if (!n) n = Number(DEFAULT_NET_FACTOR);\n    return n / 100;\n  }\n  function resolvedQuota(comm) {\n    var n = Number(comm && comm.quota);\n    return n || 0;\n  }\n  function clientsForName(clients, sessionName) {\n    var n = normName(sessionName), out = [], list = clients || [], i, j;\n    if (!n) return out;\n    for (i = 0; i < list.length; i++) {\n      if (normName(list[i].name) === n) { out.push(list[i]); continue; }\n      var aliases = list[i].aliases || [];\n      for (j = 0; j < aliases.length; j++) {\n        if (normName(aliases[j]) === n) { out.push(list[i]); break; }\n      }\n    }\n    return out;\n  }\n  function findClient(clients, sessionName) {\n    var hits = clientsForName(clients, sessionName);\n    return hits.length === 1 ? hits[0] : null;\n  }\n  function sessionCountsFor(client, allClients, sessionName) {\n    if (!client) return false;\n    var owner = findClient(allClients || [client], sessionName);\n    return !!(owner && String(owner.id) === String(client.id));\n  }\n  function packageForDate(packages, date) {\n    var sorted = sortPackages(packages), found = null, i, start;\n    for (i = 0; i < sorted.length; i++) {\n      start = sorted[i].startDate || '';\n      if (start && String(date) < start) break;\n      found = sorted[i];\n    }\n    return found;\n  }\n  function packageWindow(packages, pkg) {\n    var sorted = sortPackages(packages), idx = -1, i, next;\n    for (i = 0; i < sorted.length; i++) {\n      if (String(sorted[i].id) === String(pkg.id)) { idx = i; break; }\n    }\n    next = (idx >= 0 && idx < sorted.length - 1) ? sorted[idx + 1] : null;\n    return { start: (pkg && pkg.startDate) || '', end: next && next.startDate ? next.startDate : '' };\n  }\n  function sessionInWindow(date, w) {\n    if (!date) return false;\n    if (w.start && String(date) < String(w.start)) return false;\n    if (w.end && String(date) >= String(w.end)) return false;\n    return true;\n  }\n  function isYes(v) {\n    return v === true || v === 'yes' || v === 'true' || v === 1 || v === '1';\n  }\n  function isBillable(session) {\n    if (!session) return false;\n    if (isYes(session.removed) || isYes(session.hidden)) return false;\n    if (session.disposition && session.disposition !== 'kept') return false;\n    if (session.status === 'free') return false;\n    return true;\n  }\n  function sessionCounts(session, client, allClients) {\n    if (!isBillable(session)) return false;\n    return sessionCountsFor(client, allClients, session.clientName);\n  }\n  function packageUsed(client, sessions, pkg, allClients) {\n    if (!client || !pkg) return 0;\n    var w = packageWindow(client.packages, pkg), n = 0, list = sessions || [], i;\n    for (i = 0; i < list.length; i++) {\n      if (!sessionCounts(list[i], client, allClients)) continue;\n      if (!sessionInWindow(list[i].date, w)) continue;\n      n++;\n    }\n    return n;\n  }\n  function sessionRate(pkg) {\n    var n = Number(pkg && pkg.sessions);\n    if (!(n > 0)) return 0;\n    return Number(pkg.value || 0) / n;\n  }\n  function rateForSessionDate(packages, date) {\n    var sorted = sortPackages(packages), pkg;\n    if (!sorted.length) return 0;\n    pkg = packageForDate(sorted, date);\n    if (!pkg) pkg = sorted[0];\n    return sessionRate(pkg);\n  }\n  function periodSessionRevenue(clients, sessions, period, today) {\n    var total = 0, list = sessions || [], i, owner;\n    for (i = 0; i < list.length; i++) {\n      if (!isBillable(list[i])) continue;\n      if (!inPeriod(list[i].date, period, today)) continue;\n      owner = findClient(clients, list[i].clientName);\n      if (!owner) continue;\n      total += rateForSessionDate(owner.packages, list[i].date);\n    }\n    return total;\n  }\n  function periodBillable(clients, sessions, period, today) {\n    var out = [], list = sessions || [], i;\n    for (i = 0; i < list.length; i++) {\n      if (!isBillable(list[i])) continue;\n      if (!inPeriod(list[i].date, period, today)) continue;\n      if (!findClient(clients, list[i].clientName)) continue;\n      out.push(list[i]);\n    }\n    return out;\n  }\n  function chargeAmount(ch) {\n    var n = Number(ch && ch.amount);\n    return isFinite(n) ? n : 0;\n  }\n  function periodChargeTotal(charges, period, today) {\n    var total = 0, list = charges || [], i;\n    for (i = 0; i < list.length; i++) {\n      if (!inPeriod(list[i].date, period, today)) continue;\n      total += chargeAmount(list[i]);\n    }\n    return total;\n  }\n  function chargeTotalFor(charges, clientId) {\n    var total = 0, list = charges || [], i;\n    for (i = 0; i < list.length; i++) {\n      if (clientId != null && String(list[i].clientId) !== String(clientId)) continue;\n      total += chargeAmount(list[i]);\n    }\n    return total;\n  }\n  function commissionEstimate(opts) {\n    opts = opts || {};\n    var comm = normalizeComm(opts.comm);\n    var sessionRevenue = Number(opts.sessionRevenue) || 0;\n    var chargeTotal = Number(opts.chargeTotal) || 0;\n    var sessionCount = Number(opts.sessionCount) || 0;\n    var totalRevenue = sessionRevenue + (comm.includeCharges ? chargeTotal : 0);\n    var netRevenue = roundFils(totalRevenue * resolvedNetFactor(comm));\n    var quota = resolvedQuota(comm);\n    var commRevenue = roundFils(Math.max(0, netRevenue - quota));\n    var tierRate = getTier(sessionCount, comm.tiers);\n    return {\n      totalRevenue: roundFils(totalRevenue),\n      netRevenue: netRevenue,\n      quota: quota,\n      netFactor: resolvedNetFactor(comm) * 100,\n      commRevenue: commRevenue,\n      commission: roundFils(commRevenue * tierRate),\n      tierRate: tierRate,\n      tierPercent: tierForCount(sessionCount, comm.tiers).rate,\n      tierLabel: getTierLabel(sessionCount, comm.tiers),\n      sessionsToNext: sessionsToNextTier(sessionCount, comm.tiers),\n      sessionCount: sessionCount,\n      sessionRevenue: roundFils(sessionRevenue),\n      chargeTotal: chargeTotal,\n      includeCharges: comm.includeCharges,\n      showCommission: comm.showCommission\n    };\n  }\n  function sessionsForClient(client, sessions, allClients) {\n    var sorted = sortPackages(client && client.packages), first = sorted[0];\n    var start = first && first.startDate ? first.startDate : '';\n    var out = [], list = sessions || [], i;\n    for (i = 0; i < list.length; i++) {\n      var s = list[i];\n      if (!s || isYes(s.removed) || isYes(s.hidden)) continue;\n      if (s.disposition && s.disposition !== 'kept') continue;\n      if (!sessionCountsFor(client, allClients || [client], s.clientName)) continue;\n      if (start && s.date < start) continue;\n      out.push(s);\n    }\n    out.sort(compareSessions);\n    return out;\n  }\n  function packageReady(pkg) {\n    return !!(pkg && String(pkg.sessions) !== '' && Number(pkg.sessions) > 0);\n  }\n  function openingLeft(pkg) {\n    if (!pkg) return 0;\n    if (pkg.sessionsLeft != null && String(pkg.sessionsLeft) !== '') return Number(pkg.sessionsLeft) || 0;\n    return Number(pkg.sessions) || 0;\n  }\n  function currentRemaining(client, sessions, allClients) {\n    var pkg = currentPackage(client && client.packages);\n    var total = pkg ? (Number(pkg.sessions) || 0) : 0;\n    var used = packageUsed(client, sessions, pkg, allClients || [client]);\n    var opening = openingLeft(pkg);\n    var remaining = opening - used;\n    var per = sessionRate(pkg);\n    var ready = packageReady(pkg);\n    var price = pkg ? Number(pkg.value || 0) : 0;\n    return {\n      used: used,\n      total: total,\n      remaining: remaining,\n      perSession: per,\n      remainingValue: remaining * per,\n      low: ready && remaining > 0 && remaining <= LOW_AT,\n      out: ready && remaining <= 0,\n      ready: ready,\n      packageId: pkg ? pkg.id : '',\n      value: price,\n      startDate: pkg ? pkg.startDate : '',\n      note: pkg ? pkg.note : ''\n    };\n  }\n  function assertClientName(clients, name, exceptId) {\n    var n = normName(name), list = clients || [], i, j;\n    if (!n) throw new Error('Add a name.');\n    for (i = 0; i < list.length; i++) {\n      if (exceptId != null && String(list[i].id) === String(exceptId)) continue;\n      if (normName(list[i].name) === n) throw new Error('Another client already uses that name.');\n      var aliases = list[i].aliases || [];\n      for (j = 0; j < aliases.length; j++) {\n        if (normName(aliases[j]) === n) throw new Error('Another client already uses that name.');\n      }\n    }\n  }\n  function addAlias(clients, clientId, alias) {\n    var label = collapseSpace(alias), n = normName(label), list = clients || [], owner = null, i, j;\n    if (!n) throw new Error('That name is empty.');\n    for (i = 0; i < list.length; i++) if (String(list[i].id) === String(clientId)) owner = list[i];\n    if (!owner) throw new Error('Choose a client.');\n    if (normName(owner.name) === n) return list;\n    var owned = owner.aliases || [];\n    for (j = 0; j < owned.length; j++) if (normName(owned[j]) === n) return list;\n    for (i = 0; i < list.length; i++) {\n      if (normName(list[i].name) === n) throw new Error(label + ' is already used by another client.');\n      var aliases = list[i].aliases || [];\n      for (j = 0; j < aliases.length; j++) {\n        if (normName(aliases[j]) === n) throw new Error(label + ' is already used by another client.');\n      }\n    }\n    var next = [];\n    for (i = 0; i < list.length; i++) {\n      if (String(list[i].id) !== String(clientId)) { next.push(list[i]); continue; }\n      next.push(withLegacy({\n        id: list[i].id,\n        name: list[i].name,\n        aliases: (list[i].aliases || []).concat([label]),\n        packages: list[i].packages\n      }));\n    }\n    return next;\n  }\n  function renewPackage(client, fields) {\n    var cur = currentPackage(client.packages);\n    var sessions = fields && fields.sessions;\n    var start = fields && fields.startDate ? String(fields.startDate).slice(0, 10) : '';\n    if (sessions == null || sessions === '' || !(Number(sessions) > 0)) throw new Error('Add the number of sessions.');\n    if (!start) throw new Error('Add the start date.');\n    if (cur && cur.startDate && start <= cur.startDate) throw new Error('Use a start date after ' + cur.startDate + '.');\n    var pkg = normalizePackage(Object.assign({}, fields, { id: uid(), sessions: sessions, value: fields.value, startDate: start }));\n    var packages = (client.packages || []).concat([pkg]);\n    return withLegacy({ id: client.id, name: client.name, aliases: client.aliases || [], packages: packages });\n  }\n  function filledAmount(v) {\n    return v != null && String(v) !== '';\n  }\n  function updateCurrentPackage(client, fields) {\n    fields = fields || {};\n    var packages = (client.packages && client.packages.length) ? client.packages : [normalizePackage({\n      sessions: '', value: '', startDate: ''\n    }, String(client.id || 'c') + '-pkg1')];\n    var cur = currentPackage(packages);\n    var nextPkgs = [], i, prev, merged;\n    for (i = 0; i < packages.length; i++) {\n      if (String(packages[i].id) !== String(cur.id)) { nextPkgs.push(packages[i]); continue; }\n      prev = packages[i];\n      merged = {\n        id: prev.id,\n        sessions: filledAmount(fields.sessions) ? fields.sessions : prev.sessions,\n        sessionsLeft: prev.sessionsLeft,\n        value: filledAmount(fields.value) ? fields.value : prev.value,\n        startDate: filledAmount(fields.startDate) ? fields.startDate : prev.startDate,\n        note: fields.note != null ? fields.note : prev.note\n      };\n      nextPkgs.push(normalizePackage(merged, prev.id));\n    }\n    return withLegacy({ id: client.id, name: client.name, aliases: client.aliases || [], packages: nextPkgs });\n  }\n  function createClient(clients, fields, sessions, allClients) {\n    var name = collapseSpace(fields && fields.name);\n    if (!name) throw new Error('Add a name.');\n    if (fields.sessions == null || fields.sessions === '' || !(Number(fields.sessions) > 0)) throw new Error('Add the number of sessions.');\n    var pool = allClients || clients || [];\n    var existing = findClient(clients, name);\n    if (existing) {\n      var updated = saveClientPackage(existing, fields, sessions, pool);\n      var replaced = [], n;\n      for (n = 0; n < (clients || []).length; n++) {\n        replaced.push(String(clients[n].id) === String(existing.id) ? updated : clients[n]);\n      }\n      return replaced;\n    }\n    assertClientName(clients, name);\n    var shell = migrateClient({\n      id: fields.id || uid(),\n      name: name,\n      packageSessions: fields.sessions,\n      packageValue: fields.value || 0,\n      startDate: fields.startDate || '',\n      sessionsLeft: '',\n      note: fields.note || '',\n      aliases: []\n    });\n    var saved = saveClientPackage(shell, fields, sessions || [], pool.concat([shell]));\n    return (clients || []).concat([saved]);\n  }\n  function saveClientPackage(client, fields, sessions, allClients) {\n    fields = fields || {};\n    var before = currentPackage(client && client.packages);\n    var next = fields.mode === 'renew' ? renewPackage(client, fields) : updateCurrentPackage(client, fields);\n    if (fields.name && normName(fields.name) !== normName(next.name)) {\n      var renamed = renameClient([next], next.id, fields.name);\n      next = renamed[0];\n    }\n    var pkg = currentPackage(next.packages);\n    var counted = packageUsed(next, sessions || [], pkg, allClients || [next]);\n    var explicitLeft = filledAmount(fields.sessionsLeft);\n    var explicitSize = filledAmount(fields.sessions);\n    var hadSize = !!(before && filledAmount(before.sessions) && Number(before.sessions) > 0);\n    var packages = [], i, copy, desired;\n    for (i = 0; i < next.packages.length; i++) {\n      if (String(next.packages[i].id) !== String(pkg.id)) { packages.push(next.packages[i]); continue; }\n      copy = normalizePackage(next.packages[i]);\n      if (explicitLeft) {\n        desired = Number(fields.sessionsLeft);\n        if (!isFinite(desired) || desired < 0) throw new Error('Sessions left needs to be zero or more.');\n        copy.sessionsLeft = String(desired + counted);\n      } else if (fields.mode === 'renew' || (explicitSize && !hadSize)) {\n        copy.sessionsLeft = '';\n      } else if (before && filledAmount(before.sessionsLeft)) {\n        copy.sessionsLeft = String(before.sessionsLeft);\n      }\n      packages.push(copy);\n    }\n    return withLegacy({ id: next.id, name: next.name, aliases: next.aliases || [], packages: packages });\n  }\n  function mergePackageRecord(kept, incoming) {\n    var base = normalizePackage(kept || {});\n    var next = normalizePackage(incoming || {}, base.id);\n    if (!filledAmount(next.sessions) && filledAmount(base.sessions)) next.sessions = String(base.sessions);\n    if (!filledAmount(next.value) && filledAmount(base.value)) next.value = String(base.value);\n    if (!filledAmount(next.sessionsLeft) && filledAmount(base.sessionsLeft)) next.sessionsLeft = String(base.sessionsLeft);\n    if (!filledAmount(next.startDate) && filledAmount(base.startDate)) next.startDate = String(base.startDate);\n    if (!filledAmount(next.note) && filledAmount(base.note)) next.note = String(base.note);\n    if (!next.id && base.id) next.id = base.id;\n    return normalizePackage(next, next.id || base.id);\n  }\n  function mergeClientRecord(existing, incoming) {\n    if (!existing) return migrateClient(incoming);\n    if (!incoming) return migrateClient(existing);\n    var ex = migrateClient(existing);\n    var inc = migrateClient(incoming);\n    var exPkgs = ex.packages || [];\n    var inPkgs = inc.packages || [];\n    var used = {}, merged = [], i, j, found;\n    for (i = 0; i < inPkgs.length; i++) {\n      found = null;\n      for (j = 0; j < exPkgs.length; j++) {\n        if (String(exPkgs[j].id) === String(inPkgs[i].id)) {\n          found = exPkgs[j];\n          used[String(exPkgs[j].id)] = true;\n          break;\n        }\n      }\n      merged.push(mergePackageRecord(found, inPkgs[i]));\n    }\n    for (j = 0; j < exPkgs.length; j++) {\n      if (used[String(exPkgs[j].id)]) continue;\n      if (filledAmount(exPkgs[j].sessions) || filledAmount(exPkgs[j].value) || filledAmount(exPkgs[j].sessionsLeft)) {\n        merged.push(normalizePackage(exPkgs[j]));\n      }\n    }\n    var aliases = (inc.aliases && inc.aliases.length) ? inc.aliases : (ex.aliases || []);\n    return withLegacy({\n      id: inc.id || ex.id,\n      name: inc.name || ex.name,\n      aliases: aliases,\n      packages: merged.length ? merged : exPkgs\n    });\n  }\n  function blankAutoClient(name, today) {\n    return migrateClient({\n      id: uid(),\n      name: name,\n      packageSessions: '',\n      packageValue: '',\n      startDate: today || '',\n      sessionsLeft: '',\n      aliases: []\n    });\n  }\n  function renameClient(clients, clientId, name) {\n    var label = collapseSpace(name);\n    assertClientName(clients, label, clientId);\n    var next = [], i, found = false;\n    for (i = 0; i < (clients || []).length; i++) {\n      if (String(clients[i].id) !== String(clientId)) { next.push(clients[i]); continue; }\n      found = true;\n      next.push(withLegacy({\n        id: clients[i].id,\n        name: label,\n        aliases: clients[i].aliases || [],\n        packages: clients[i].packages\n      }));\n    }\n    if (!found) throw new Error('That client is not in the planner.');\n    return next;\n  }\n  function titleHasFree(title) {\n    return /\\bfree\\b/i.test(collapseSpace(title));\n  }\n  function parseTitle(title) {\n    var trimmed = collapseSpace(title).replace(/[\\s.。,!?;:'\"’”‘…)\\]}…\\-–—|]+$/g, '').trim();\n    var free = titleHasFree(title);\n    if (!trimmed || !/\\bpt$/i.test(trimmed)) return { display: '', key: '', explicit: false, free: free };\n    var display = collapseSpace(trimmed.replace(/\\s*\\bpt$/i, ' ')).replace(/^[-–—|:,.\\s]+|[-–—|:,.\\s]+$/g, '').trim();\n    display = collapseSpace(display);\n    if (!display) return { display: '', key: '', explicit: true, free: free };\n    return { display: display, key: normName(display), explicit: true, free: free };\n  }\n  function looksLikeClientName(display) {\n    var s = collapseSpace(display);\n    if (!s || s.length > 40) return false;\n    if (/[0-9@]|https?:|www\\./i.test(s)) return false;\n    var parts = s.split(' ');\n    if (!parts.length || parts.length > 4) return false;\n    var i;\n    for (i = 0; i < parts.length; i++) {\n      if (!/^[A-Za-z\\u00C0-\\u024F][A-Za-z\\u00C0-\\u024F.'’-]{0,30}$/.test(parts[i])) return false;\n    }\n    return true;\n  }\n  function guessStatus(note) {\n    var n = collapseSpace(note).toLowerCase();\n    if (!n) return 'normal';\n    if (/free|compensar|make[\\s-]?up|cortesia|gr[aá]tis|gratis/.test(n)) return 'free';\n    if (/charged|late[\\s-]?cancel|no[\\s-]?show|cobra[dn]/.test(n)) return 'charged';\n    return 'normal';\n  }\n  function isFlaggedNote(note) {\n    var n = collapseSpace(note).toLowerCase();\n    if (!n) return false;\n    return /charged|free|compensar|n[aã]o tem|nao tem|no sessions|late[\\s-]?cancel|no[\\s-]?show|make[\\s-]?up|cortesia|gr[aá]tis|gratis/.test(n);\n  }\n  function isBuiltinIgnore(key) {\n    return !!BUILTIN_IGNORE[key];\n  }\n  function isStoplist(key) {\n    if (STOP_FULL[key]) return true;\n    var first = String(key || '').split(' ')[0];\n    return !!STOP_FULL[first];\n  }\n  function isIgnoredName(ignored, key) {\n    var list = ignored || [], i;\n    for (i = 0; i < list.length; i++) if (normName(list[i]) === key) return true;\n    return false;\n  }\n  function compareSessions(a, b) {\n    if ((a.date || '') < (b.date || '')) return -1;\n    if ((a.date || '') > (b.date || '')) return 1;\n    if ((a.start || '') < (b.start || '')) return -1;\n    if ((a.start || '') > (b.start || '')) return 1;\n    if ((a.clientName || '') < (b.clientName || '')) return -1;\n    if ((a.clientName || '') > (b.clientName || '')) return 1;\n    return 0;\n  }\n  function copySession(s) {\n    return {\n      eventId: String(s.eventId || ''),\n      calendarId: s.calendarId || '',\n      title: s.title || '',\n      clientName: s.clientName || '',\n      date: s.date ? String(s.date).slice(0, 10) : '',\n      start: s.start || '',\n      end: s.end || '',\n      allDay: isYes(s.allDay),\n      note: s.note || '',\n      status: s.status || 'normal',\n      statusLocked: isYes(s.statusLocked),\n      disposition: s.disposition || 'pending',\n      hidden: isYes(s.hidden),\n      removed: isYes(s.removed),\n      createdAt: s.createdAt || ''\n    };\n  }\n  function blankSession(ev, parsed, stamp) {\n    return {\n      eventId: String(ev.eventId),\n      calendarId: ev.calendarId || '',\n      title: ev.title || '',\n      clientName: parsed.display,\n      date: ev.date || '',\n      start: ev.allDay ? '' : (ev.start || ''),\n      end: ev.allDay ? '' : (ev.end || ''),\n      allDay: !!ev.allDay,\n      note: collapseSpace(ev.note || ''),\n      status: titleHasFree(ev.title) ? 'free' : guessStatus(ev.note),\n      statusLocked: false,\n      disposition: 'pending',\n      hidden: false,\n      removed: false,\n      createdAt: stamp || ''\n    };\n  }\n  function occurrenceSeriesId(eventId) {\n    var id = String(eventId || '');\n    var match = id.match(/^(.*)@(\\d{8}T\\d{6}Z)$/);\n    if (!match || !match[2]) return '';\n    return match[1];\n  }\n  function sameOccurrenceSlot(row, ev) {\n    if (!row || !ev) return false;\n    if (String(row.date || '') !== String(ev.date || '')) return false;\n    var rowStart = row.allDay ? '' : (row.start || '');\n    var evStart = ev.allDay ? '' : (ev.start || '');\n    if (rowStart && evStart && rowStart !== evStart) return false;\n    return true;\n  }\n  function retargetCharges(charges, idRemap) {\n    var map = {}, i, ch, next, copy;\n    for (i = 0; i < (idRemap || []).length; i++) {\n      if (!idRemap[i] || !idRemap[i].from) continue;\n      map[String(idRemap[i].from)] = String(idRemap[i].to || '');\n    }\n    var out = [];\n    for (i = 0; i < (charges || []).length; i++) {\n      ch = charges[i];\n      next = map[String(ch && ch.eventId || '')];\n      if (!next) { out.push(ch); continue; }\n      copy = migrateCharge(ch);\n      copy.eventId = next;\n      out.push(copy);\n    }\n    return out;\n  }\n  function applySync(prevSessions, events, ctx) {\n    ctx = ctx || {};\n    var clients = (ctx.clients || []).slice();\n    var byId = {}, i, list = prevSessions || [];\n    for (i = 0; i < list.length; i++) {\n      if (!list[i] || !list[i].eventId) continue;\n      byId[String(list[i].eventId)] = copySession(list[i]);\n    }\n    var seen = {}, added = [], unique = [], seenEv = {}, idRemap = [];\n    var incoming = events || [];\n    for (i = 0; i < incoming.length; i++) {\n      var ev = incoming[i];\n      if (!ev || !ev.eventId || seenEv[String(ev.eventId)]) continue;\n      seenEv[String(ev.eventId)] = true;\n      unique.push(ev);\n    }\n    for (i = 0; i < unique.length; i++) {\n      ev = unique[i];\n      var id = String(ev.eventId);\n      var parsed = parseTitle(ev.title);\n      if (!parsed.explicit) {\n        if (byId[id]) delete byId[id];\n        continue;\n      }\n      seen[id] = true;\n      if (!parsed.key || parsed.key === 'pt' || parsed.key.length < 2) continue;\n      var prev = byId[id];\n      if (!prev) {\n        var seriesId = occurrenceSeriesId(id);\n        var legacy = seriesId && byId[seriesId];\n        if (legacy && sameOccurrenceSlot(legacy, ev)) {\n          delete byId[seriesId];\n          legacy.eventId = id;\n          byId[id] = legacy;\n          prev = legacy;\n          idRemap.push({ from: seriesId, to: id });\n        }\n      }\n      if (isIgnoredName(ctx.ignored, parsed.key)) {\n        if (prev) {\n          prev.disposition = 'ignored';\n          prev.title = ev.title || prev.title;\n          prev.date = ev.date || prev.date;\n          prev.note = collapseSpace(ev.note || '');\n          prev.removed = false;\n        }\n        continue;\n      }\n      var hits = clientsForName(clients, parsed.display);\n      var disposition = 'pending';\n      if (hits.length > 1) disposition = 'pending';\n      else {\n        if (!hits.length) {\n          var made = blankAutoClient(parsed.display, ctx.today || '');\n          clients = clients.concat([made]);\n          hits = [made];\n        }\n        disposition = 'kept';\n      }\n      if (!prev) {\n        var row = blankSession(ev, parsed, ctx.nowStamp || '');\n        row.disposition = disposition;\n        byId[id] = row;\n        if (disposition === 'kept') added.push(row);\n        continue;\n      }\n      var wasKept = prev.disposition === 'kept' && !prev.removed && !prev.hidden;\n      prev.title = ev.title || prev.title;\n      prev.clientName = parsed.display;\n      prev.date = ev.date || prev.date;\n      prev.start = ev.allDay ? '' : (ev.start || '');\n      prev.end = ev.allDay ? '' : (ev.end || '');\n      prev.allDay = !!ev.allDay;\n      prev.note = collapseSpace(ev.note || '');\n      prev.calendarId = ev.calendarId || prev.calendarId;\n      prev.removed = false;\n      if (!prev.hidden && !prev.dispositionLocked) prev.disposition = disposition;\n      if (titleHasFree(ev.title)) prev.status = 'free';\n      else if (!prev.statusLocked) prev.status = guessStatus(prev.note);\n      if (prev.disposition === 'kept' && !prev.hidden && !wasKept) added.push(prev);\n    }\n    var start = ctx.windowStart || '';\n    var end = ctx.windowEnd || '';\n    var ids = [], k;\n    for (k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) ids.push(k);\n    for (i = 0; i < ids.length; i++) {\n      if (!parseTitle(byId[ids[i]] && byId[ids[i]].title).explicit) delete byId[ids[i]];\n    }\n    for (i = 0; i < ids.length; i++) {\n      var s = byId[ids[i]];\n      if (!s || seen[s.eventId]) continue;\n      var superseded = false, seenId;\n      for (seenId in seen) {\n        if (Object.prototype.hasOwnProperty.call(seen, seenId) && occurrenceSeriesId(seenId) === String(s.eventId)) {\n          superseded = true;\n          break;\n        }\n      }\n      if (superseded && start && end && s.date >= start && s.date <= end) {\n        delete byId[s.eventId];\n        continue;\n      }\n      if (start && end && s.date >= start && s.date <= end) s.removed = true;\n    }\n    var sessions = [];\n    for (i = 0; i < ids.length; i++) if (byId[ids[i]]) sessions.push(byId[ids[i]]);\n    sessions.sort(compareSessions);\n    added.sort(compareSessions);\n    return { sessions: sessions, added: added, clients: clients, idRemap: idRemap };\n  }\n  function summaryAdded(sessions, today) {\n    var cutoff = addDaysYmd(today, -1);\n    var out = [], list = sessions || [], i, s, created;\n    for (i = 0; i < list.length; i++) {\n      s = list[i];\n      if (!s || s.disposition !== 'kept' || isYes(s.hidden) || isYes(s.removed)) continue;\n      if (s.status === 'free') continue;\n      if (!s.date || s.date < cutoff) continue;\n      created = String(s.createdAt || '').slice(0, 10);\n      if (created !== today && created !== cutoff) continue;\n      out.push(s);\n    }\n    out.sort(compareSessions);\n    return out;\n  }\n  function olderSavedToday(sessions, today) {\n    var cutoff = addDaysYmd(today, -1);\n    var n = 0, i, s, created;\n    for (i = 0; i < (sessions || []).length; i++) {\n      s = sessions[i];\n      created = String(s.createdAt || '').slice(0, 10);\n      if (created !== today) continue;\n      if (s.status === 'free') continue;\n      if (s.date && s.date < cutoff) n++;\n    }\n    return n;\n  }\n  function lowClients(clients, sessions) {\n    var out = [], list = clients || [], i, stats;\n    for (i = 0; i < list.length; i++) {\n      stats = currentRemaining(list[i], sessions, list);\n      if (!stats.ready || !(stats.low || stats.out)) continue;\n      out.push({ name: list[i].name, remaining: stats.remaining, out: stats.out, low: stats.low });\n    }\n    out.sort(function (a, b) { return a.remaining - b.remaining; });\n    return out;\n  }\n  function flaggedSoon(sessions, today) {\n    var end = addDaysYmd(today, 7);\n    var out = [], list = sessions || [], i, s;\n    for (i = 0; i < list.length; i++) {\n      s = list[i];\n      if (!s || isYes(s.removed) || isYes(s.hidden) || s.disposition !== 'kept') continue;\n      if (!parseTitle(s.title).explicit && s.title) continue;\n      if (!s.date || s.date < today || s.date > end) continue;\n      if (s.status === 'free' || s.status === 'charged' || isFlaggedNote(s.note)) out.push(s);\n    }\n    out.sort(compareSessions);\n    return out;\n  }\n  function unmatchedFromSessions(sessions, clients) {\n    var map = {}, list = sessions || [], i, s, n, hits, key;\n    for (i = 0; i < list.length; i++) {\n      s = list[i];\n      if (!s || isYes(s.removed) || isYes(s.hidden) || s.disposition !== 'pending') continue;\n      n = normName(s.clientName);\n      if (!n) continue;\n      hits = clientsForName(clients, s.clientName);\n      if (!map[n]) map[n] = { key: n, label: collapseSpace(s.clientName), count: 0, ambiguous: hits.length > 1 };\n      map[n].count++;\n      if (hits.length > 1) map[n].ambiguous = true;\n    }\n    var out = [];\n    for (key in map) if (Object.prototype.hasOwnProperty.call(map, key)) out.push(map[key]);\n    out.sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });\n    return out;\n  }\n  function emailLine(s) {\n    var time = (s.allDay || !s.start) ? 'all-day' : s.start;\n    var note = collapseSpace(s.note || '').replace(/\\s+/g, ' ');\n    if (note.length > 180) note = note.slice(0, 177) + '...';\n    var bits = [s.clientName || s.title || 'Session', (s.date || '') + ' ' + time, s.status || 'normal'];\n    if (note) bits.push(note);\n    return bits.join(' | ');\n  }\n  function pushCapped(lines, items, format) {\n    var n = Math.min(items.length, EMAIL_CAP), i;\n    for (i = 0; i < n; i++) lines.push('- ' + format(items[i]));\n    if (items.length > EMAIL_CAP) lines.push('- and ' + (items.length - EMAIL_CAP) + ' more');\n    if (!items.length) lines.push('- None');\n  }\n  function buildDailyEmail(report) {\n    report = report || {};\n    var lines = [];\n    lines.push('PT Planner daily sync');\n    lines.push('Status: ' + (report.ok === false ? 'failed' : 'ok'));\n    lines.push('When: ' + (report.when || ''));\n    if (report.period) lines.push('Period: ' + report.period);\n    lines.push('');\n    if (report.ok === false) {\n      lines.push('The automatic check did not finish.');\n      lines.push('Error: ' + (report.error || 'Unknown error'));\n      lines.push('Open PT Planner on the iPhone and tap Update from Calendar.');\n      return { subject: EMAIL_SUBJECT, to: SUMMARY_EMAIL, body: lines.join('\\n') };\n    }\n    var added = report.added || [];\n    lines.push('Sessions added: ' + added.length);\n    pushCapped(lines, added, emailLine);\n    if (report.olderSaved > 0) lines.push('Older sessions saved: ' + report.olderSaved);\n    lines.push('');\n    var low = report.low || [];\n    lines.push('Clients low or out: ' + low.length);\n    pushCapped(lines, low, function (c) {\n      return c.name + ' | ' + c.remaining + ' left | ' + (c.out ? 'out' : 'low');\n    });\n    lines.push('');\n    var flagged = report.flagged || [];\n    lines.push('Flagged notes: ' + flagged.length);\n    pushCapped(lines, flagged, emailLine);\n    return { subject: EMAIL_SUBJECT, to: SUMMARY_EMAIL, body: lines.join('\\n') };\n  }\n  function buildSummary(state, today, whenLabel) {\n    state = state || {};\n    var sessions = state.sessions || [];\n    var clients = state.clients || [];\n    var period = activePeriod((state.settings && state.settings.periods) || [], today);\n    return buildDailyEmail({\n      ok: true,\n      when: whenLabel || (today + ' Asia/Dubai'),\n      period: period ? (period.start + ' to ' + period.end) : '',\n      added: summaryAdded(sessions, today),\n      olderSaved: olderSavedToday(sessions, today),\n      low: lowClients(clients, sessions),\n      flagged: flaggedSoon(sessions, today)\n    });\n  }\n  function linkName(clients, sessions, clientId, aliasLabel) {\n    var nextClients = addAlias(clients, clientId, aliasLabel);\n    var key = normName(aliasLabel);\n    var nextSessions = (sessions || []).map(function (s) {\n      if (normName(s.clientName) !== key || isYes(s.removed)) return s;\n      var c = copySession(s);\n      c.disposition = 'kept';\n      c.hidden = false;\n      return c;\n    });\n    return { clients: nextClients, sessions: nextSessions };\n  }\n  function ignoreName(ignored, sessions, label) {\n    var key = normName(label);\n    var nextIgnored = (ignored || []).slice();\n    if (!isIgnoredName(nextIgnored, key)) nextIgnored.push(collapseSpace(label));\n    var nextSessions = (sessions || []).map(function (s) {\n      if (normName(s.clientName) !== key) return s;\n      var c = copySession(s);\n      c.disposition = 'ignored';\n      return c;\n    });\n    return { ignored: nextIgnored, sessions: nextSessions };\n  }\n  function setStatus(sessions, eventId, status) {\n    if (status !== 'normal' && status !== 'free' && status !== 'charged') throw new Error('Pick normal, free, or charged.');\n    var found = false;\n    var next = (sessions || []).map(function (s) {\n      if (String(s.eventId) !== String(eventId)) return s;\n      found = true;\n      var c = copySession(s);\n      c.status = status;\n      c.statusLocked = true;\n      return c;\n    });\n    if (!found) throw new Error('That session is not in the planner.');\n    return next;\n  }\n  function hideSession(sessions, eventId) {\n    var found = false;\n    var next = (sessions || []).map(function (s) {\n      if (String(s.eventId) !== String(eventId)) return s;\n      found = true;\n      var c = copySession(s);\n      c.hidden = true;\n      return c;\n    });\n    if (!found) throw new Error('That session is not in the planner.');\n    return next;\n  }\n  function deleteClient(clients, sessions, clientId) {\n    var victim = null, i;\n    for (i = 0; i < (clients || []).length; i++) if (String(clients[i].id) === String(clientId)) victim = clients[i];\n    var nextClients = (clients || []).filter(function (c) { return String(c.id) !== String(clientId); });\n    if (!victim) return { clients: nextClients, sessions: sessions || [] };\n    var names = {}, aliases = victim.aliases || [];\n    names[normName(victim.name)] = true;\n    for (i = 0; i < aliases.length; i++) names[normName(aliases[i])] = true;\n    var nextSessions = (sessions || []).map(function (s) {\n      if (!names[normName(s.clientName)]) return s;\n      if (s.disposition === 'ignored') return s;\n      if (findClient(nextClients, s.clientName)) return s;\n      var c = copySession(s);\n      c.disposition = 'pending';\n      return c;\n    });\n    return { clients: nextClients, sessions: nextSessions };\n  }\n  function chargeKey(ch) {\n    return [ch.clientId, ch.date, ch.type, collapseSpace(ch.notes), String(ch.amount), ch.eventId || ''].join('|');\n  }\n  function mergeMigration(current, incoming) {\n    current = current || {};\n    var clients = migrateClients(current.clients || []);\n    var added = [], skipped = [], i;\n    var incomingClients = migrateClients((incoming && incoming.clients) || []);\n    for (i = 0; i < incomingClients.length; i++) {\n      var c = incomingClients[i];\n      if (!c.name) continue;\n      if (findClient(clients, c.name) || clientsForName(clients, c.name).length) { skipped.push(c.name); continue; }\n      clients = clients.concat([c]);\n      added.push(c.name);\n    }\n    var charges = migrateCharges(current.charges || []);\n    var seen = {}, j;\n    for (j = 0; j < charges.length; j++) seen[chargeKey(charges[j])] = true;\n    var more = migrateCharges((incoming && incoming.charges) || []);\n    for (j = 0; j < more.length; j++) {\n      var key = chargeKey(more[j]);\n      if (seen[key]) continue;\n      var owner = null;\n      for (i = 0; i < clients.length; i++) if (String(clients[i].id) === String(more[j].clientId)) owner = clients[i];\n      if (!owner) continue;\n      seen[key] = true;\n      charges.push(more[j]);\n    }\n    var settings = current.settings ? {\n      quota: current.settings.quota,\n      netFactor: current.settings.netFactor,\n      includeCharges: current.settings.includeCharges,\n      showCommission: current.settings.showCommission,\n      periodStart: current.settings.periodStart || '',\n      periodEnd: current.settings.periodEnd || ''\n    } : {};\n    var comm = normalizeComm((incoming && incoming.comm) || {});\n    var period = normalizePeriod((incoming && incoming.period) || {});\n    if (settings.quota == null || settings.quota === '') settings.quota = comm.quota;\n    if (settings.netFactor == null || settings.netFactor === '') settings.netFactor = comm.netFactor;\n    if (settings.includeCharges == null) settings.includeCharges = comm.includeCharges;\n    if (settings.showCommission == null) settings.showCommission = comm.showCommission;\n    if (!settings.periodStart && !settings.periodEnd && period.start && period.end) {\n      settings.periodStart = period.start;\n      settings.periodEnd = period.end;\n    }\n    return { clients: clients, charges: charges, settings: settings, added: added, skipped: skipped };\n  }\n  function visibleSessions(sessions) {\n    return (sessions || []).filter(function (s) {\n      return s && !isYes(s.removed) && !isYes(s.hidden) && s.disposition !== 'ignored';\n    });\n  }\n\n  return {\n    EMAIL_SUBJECT: EMAIL_SUBJECT,\n    SUMMARY_EMAIL: SUMMARY_EMAIL,\n    LOW_AT: LOW_AT,\n    collapseSpace: collapseSpace,\n    normName: normName,\n    namesMatch: namesMatch,\n    addDaysYmd: addDaysYmd,\n    mondayOf: mondayOf,\n    uid: uid,\n    inPeriod: inPeriod,\n    sortPeriods: sortPeriods,\n    activePeriod: activePeriod,\n    savePeriods: savePeriods,\n    syncWindow: syncWindow,\n    saveClientPackage: saveClientPackage,\n    mergeClientRecord: mergeClientRecord,\n    packageReady: packageReady,\n    defaultTiers: defaultTiers,\n    normalizeTiers: normalizeTiers,\n    getTier: getTier,\n    getTierLabel: getTierLabel,\n    sessionsToNextTier: sessionsToNextTier,\n    titleHasFree: titleHasFree,\n    migrateClient: migrateClient,\n    migrateClients: migrateClients,\n    migrateCharge: migrateCharge,\n    migrateCharges: migrateCharges,\n    normalizeComm: normalizeComm,\n    normalizePeriod: normalizePeriod,\n    currentPackage: currentPackage,\n    sortPackages: sortPackages,\n    clientsForName: clientsForName,\n    findClient: findClient,\n    packageUsed: packageUsed,\n    packageWindow: packageWindow,\n    isBillable: isBillable,\n    periodSessionRevenue: periodSessionRevenue,\n    periodBillable: periodBillable,\n    chargeAmount: chargeAmount,\n    periodChargeTotal: periodChargeTotal,\n    chargeTotalFor: chargeTotalFor,\n    commissionEstimate: commissionEstimate,\n    sessionsForClient: sessionsForClient,\n    currentRemaining: currentRemaining,\n    renewPackage: renewPackage,\n    updateCurrentPackage: updateCurrentPackage,\n    createClient: createClient,\n    renameClient: renameClient,\n    addAlias: addAlias,\n    parseTitle: parseTitle,\n    looksLikeClientName: looksLikeClientName,\n    guessStatus: guessStatus,\n    isFlaggedNote: isFlaggedNote,\n    applySync: applySync,\n    retargetCharges: retargetCharges,\n    summaryAdded: summaryAdded,\n    olderSavedToday: olderSavedToday,\n    lowClients: lowClients,\n    flaggedSoon: flaggedSoon,\n    unmatchedFromSessions: unmatchedFromSessions,\n    buildDailyEmail: buildDailyEmail,\n    buildSummary: buildSummary,\n    linkName: linkName,\n    ignoreName: ignoreName,\n    setStatus: setStatus,\n    hideSession: hideSession,\n    deleteClient: deleteClient,\n    mergeMigration: mergeMigration,\n    visibleSessions: visibleSessions,\n    compareSessions: compareSessions,\n    copySession: copySession\n  };\n})();\n</script>\n<script>\n(function () {\n  var EXAMPLE = /(?:\\?|&)example=1(?:&|$)/.test(location.search) && !(window.google && google.script && google.script.run);\n  var state = null;\n  var ui = { sheet: null, error: '', fatal: '', loading: false, monthOffset: 0, weekOffset: 0, boot: null };\n\n  function esc(s) {\n    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c];\n    });\n  }\n  function parseYmd(ymd) {\n    var p = String(ymd || '').split('-');\n    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));\n  }\n  function prettyDate(ymd) {\n    var dt = parseYmd(ymd);\n    if (isNaN(dt.getTime())) return '';\n    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];\n    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];\n    return days[dt.getUTCDay()] + ' ' + dt.getUTCDate() + ' ' + months[dt.getUTCMonth()];\n  }\n  function longDate(ymd) {\n    var dt = parseYmd(ymd);\n    if (isNaN(dt.getTime())) return '';\n    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];\n    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];\n    return days[dt.getUTCDay()] + ', ' + dt.getUTCDate() + ' ' + months[dt.getUTCMonth()];\n  }\n  function prettyTime(hm, allDay) {\n    if (allDay || !hm) return 'All day';\n    var h = Number(String(hm).slice(0, 2));\n    var m = String(hm).slice(3, 5) || '00';\n    var ap = h >= 12 ? 'pm' : 'am';\n    var h12 = h % 12;\n    if (!h12) h12 = 12;\n    return h12 + ':' + m + ' ' + ap;\n  }\n  function money(n) {\n    var v = Math.round(Number(n) || 0);\n    var sign = v < 0 ? '-' : '';\n    return 'AED ' + sign + Math.abs(v).toLocaleString('en-US');\n  }\n  function moneyExact(n) {\n    var v = Math.round((Number(n) || 0) * 100) / 100;\n    var sign = v < 0 ? '-' : '';\n    return 'AED ' + sign + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });\n  }\n  function periodList() {\n    return PT.sortPeriods((state.settings && state.settings.periods) || []);\n  }\n  function viewedPeriod() {\n    var list = periodList(), i;\n    if (ui.periodId) {\n      for (i = 0; i < list.length; i++) if (String(list[i].id) === String(ui.periodId)) return list[i];\n    }\n    return PT.activePeriod(list, state.today);\n  }\n  function periodBar() {\n    var list = periodList();\n    var current = viewedPeriod();\n    if (!current) {\n      return '<div class=\"card\"><div class=\"name\">Set this pay period</div><p class=\"meta\">J Club does not use calendar months. A period might run 30 Sep to 28 Oct, then 29 Oct to 29 Nov.</p><label>Starts</label><input data-field=\"pstart\" type=\"date\"><label>Ends</label><input data-field=\"pend\" type=\"date\"><button type=\"button\" class=\"primary\" data-act=\"save-period\">Save period</button></div>';\n    }\n    var idx = 0, i;\n    for (i = 0; i < list.length; i++) if (list[i].id === current.id) idx = i;\n    var prev = idx > 0 ? list[idx - 1].id : '';\n    var next = idx < list.length - 1 ? list[idx + 1].id : '';\n    return '<div class=\"weekbar\"><button type=\"button\" class=\"ghost small\" data-act=\"pick-period\" data-id=\"' + esc(prev) + '\"' + (prev ? '' : ' disabled') + '>Previous</button><b>' + esc(prettyDate(current.start) + ' – ' + prettyDate(current.end)) + '</b><button type=\"button\" class=\"ghost small\" data-act=\"pick-period\" data-id=\"' + esc(next) + '\"' + (next ? '' : ' disabled') + '>Next</button></div><div class=\"pair\" style=\"margin-top:8px\"><button type=\"button\" class=\"ghost\" data-act=\"edit-period\" data-id=\"' + esc(current.id) + '\">Edit these dates</button><button type=\"button\" class=\"ghost\" data-act=\"new-period\">Next period</button></div>';\n  }\n  function route() {\n    var h = (location.hash || '#home').replace(/^#/, '');\n    var parts = h.split('/');\n    return { name: parts[0] || 'home', id: decodeURIComponent(parts.slice(1).join('/')) };\n  }\n  function clientById(id) {\n    var list = state.clients || [], i;\n    for (i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];\n    return null;\n  }\n  function sessionById(id) {\n    var list = state.sessions || [], i;\n    for (i = 0; i < list.length; i++) if (String(list[i].eventId) === String(id)) return list[i];\n    return null;\n  }\n  function statusLabel(s) {\n    if (s === 'free') return 'Free';\n    if (s === 'charged') return 'Charged';\n    return 'Normal';\n  }\n  function chargeLabel(t) {\n    if (t === 'late_cancel') return 'Late cancel';\n    if (t === 'no_show') return 'No show';\n    return 'Other';\n  }\n  function icon(name) {\n    var paths = {\n      home: '<path d=\"M4 11 12 4l8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z\"/>',\n      week: '<rect x=\"4\" y=\"5\" width=\"16\" height=\"15\" rx=\"2\"/><path d=\"M4 10h16M8 3.5V7M16 3.5V7\"/>',\n      people: '<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3.8 19c.5-2.8 2.6-4.2 5.2-4.2s4.7 1.4 5.2 4.2\"/><circle cx=\"17\" cy=\"9\" r=\"2.2\"/><path d=\"M16 14.6c1.8.4 3.2 1.5 3.8 3.6\"/>',\n      report: '<path d=\"M5 19V10M12 19V5M19 19v-7\"/>',\n      gear: '<path d=\"M4 8h16M4 16h16\"/><circle cx=\"9\" cy=\"8\" r=\"2.3\" fill=\"#fffdfb\"/><circle cx=\"15\" cy=\"16\" r=\"2.3\" fill=\"#fffdfb\"/>'\n    };\n    return '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">' + (paths[name] || '') + '</svg>';\n  }\n  function field(name, root) {\n    var el = (root || document).querySelector('[data-field=\"' + name + '\"]');\n    if (!el) return '';\n    if (el.type === 'checkbox') return el.checked;\n    return el.value;\n  }\n\n  function sessionButton(s, withDate) {\n    var free = s.status === 'free';\n    var when = '<b>' + esc(prettyTime(s.start, s.allDay)) + '</b>';\n    if (withDate) when = '<span class=\"meta\">' + esc(prettyDate(s.date) || s.date || '') + '</span>' + when;\n    return '<button type=\"button\" class=\"row' + (free ? ' is-free' : '') + '\" data-act=\"session\" data-id=\"' + esc(s.eventId) + '\">' +\n      '<div class=\"when\">' + when + '</div>' +\n      '<div class=\"grow\"><div class=\"name\">' + esc(s.clientName) + '</div>' +\n      (s.note ? '<div class=\"note\">' + esc(s.note) + '</div>' : '') +\n      '</div><span class=\"tag ' + esc(s.status || 'normal') + '\">' + statusLabel(s.status) + '</span></button>';\n  }\n  function clientButton(c) {\n    var st = PT.currentRemaining(c, state.sessions, state.clients);\n    var klass = !st.ready ? 'ok' : (st.out ? 'out' : (st.low ? 'low' : 'ok'));\n    var badge = !st.ready ? '<span class=\"pill low\">Set</span>' : (st.out ? '<span class=\"pill out\">Out</span>' : (st.low ? '<span class=\"pill low\">Low</span>' : ''));\n    var pct = st.total > 0 ? Math.max(0, Math.min(100, Math.round((st.used / st.total) * 100))) : (st.out ? 100 : 0);\n    var period = viewedPeriod();\n    var monthCount = period ? PT.periodBillable([c], state.sessions, period, state.today).length : 0;\n    return '<button type=\"button\" class=\"client ' + klass + '\" data-act=\"open-client\" data-id=\"' + esc(c.id) + '\">' +\n      '<div class=\"client-top\"><div class=\"name\">' + esc(c.name) + '</div><div>' + badge + '</div></div>' +\n      '<div class=\"bar\"><span style=\"width:' + pct + '%\"></span></div>' +\n      '<div class=\"spread\"><span class=\"left ' + klass + '\">' + (st.ready ? (st.remaining + ' left') : 'Set package') + '</span><span class=\"meta\">' + (st.ready ? (st.used + ' of ' + st.total + ' used') : 'From the calendar') + '</span></div>' +\n      '<div class=\"spread\" style=\"margin-top:6px\"><span class=\"meta\">' + monthCount + ' this period</span><span class=\"meta\">' + (st.ready ? esc(money(st.remainingValue)) + ' left' : 'Set package') + '</span></div></button>';\n  }\n\n  function shell(title, body, back) {\n    var top = EXAMPLE ? '<div class=\"example\">Example data. These are not real clients.</div>' : '';\n    var head = '<header class=\"top\"><div>' +\n      (back ? '<button type=\"button\" class=\"back\" data-act=\"nav\" data-go=\"' + esc(back) + '\">Back</button>' : '<div class=\"brand\"><span class=\"mark\">PT</span> Planner</div><div class=\"sub\">' + esc(title || '') + '</div>') +\n      '</div>' +\n      (back ? '' : '<button type=\"button\" class=\"icon-btn\" data-act=\"nav\" data-go=\"#settings\" aria-label=\"Settings\">' + icon('gear') + '</button>') +\n      '</header>';\n    var notice = '';\n    if (ui.boot && ui.boot.ok) {\n      var n = (ui.boot.added || []).length;\n      notice = '<div class=\"banner\">' + (n ? ('Brought over ' + n + (n === 1 ? ' client.' : ' clients.')) : 'Those clients were already in PT Planner.') + '</div>';\n    } else if (ui.boot && ui.boot.error) {\n      notice = '<div class=\"warn\">' + esc(ui.boot.error) + '</div>';\n    }\n    if (ui.syncing) notice += '<div class=\"banner\">Syncing calendar…</div>';\n    if (ui.syncError) notice += '<div class=\"warn\">' + esc(ui.syncError) + ' Tap Update from Calendar to try again.</div>';\n    if (!EXAMPLE && state && state.triggerError) notice += '<div class=\"warn\">' + esc(state.triggerError) + '</div>';\n    if (!EXAMPLE && state && state.triggerReady === false) notice += '<div class=\"warn\">The 5:00 check is not on yet. Stay on this page. If Google asks, tap Allow.</div>';\n    return top + '<div class=\"app\" data-screen=\"' + esc(route().name) + '\">' + head + '<div class=\"wrap\">' + notice + body + '</div>' + nav() + sheet() + '</div>';\n  }\n  function nav() {\n    var r = route().name;\n    function item(id, label, ic) {\n      return '<button type=\"button\" data-act=\"nav\" data-go=\"#' + id + '\"' + (r === id ? ' class=\"on\" aria-current=\"page\"' : '') + '>' + icon(ic) + label + '</button>';\n    }\n    return '<nav class=\"nav\">' + item('home', 'Home', 'home') + item('week', 'Week', 'week') + item('clients', 'Clients', 'people') + item('report', 'Report', 'report') + '</nav>';\n  }\n  function sheet() {\n    if (!ui.sheet) return '';\n    return '<div class=\"backdrop\" data-act=\"close\"><div class=\"sheet\" data-act=\"stop\"><div class=\"handle\"></div>' + ui.sheet + '<div class=\"err\" id=\"form-error\">' + esc(ui.error || '') + '</div></div></div>';\n  }\n\n  function payFigures(period) {\n    var billable = period ? PT.periodBillable(state.clients, state.sessions, period, state.today) : [];\n    var earned = period ? PT.periodSessionRevenue(state.clients, state.sessions, period, state.today) : 0;\n    var chargeTotal = period ? PT.periodChargeTotal(state.charges, period, state.today) : 0;\n    var est = PT.commissionEstimate({\n      sessionRevenue: earned,\n      chargeTotal: chargeTotal,\n      sessionCount: billable.length,\n      comm: state.settings\n    });\n    return { billable: billable, earned: earned, chargeTotal: chargeTotal, est: est };\n  }\n  function payStats(pay) {\n    var est = pay.est || {};\n    var off = state.settings && state.settings.showCommission === false;\n    var next = est.sessionsToNext ? String(est.sessionsToNext) : 'Top';\n    var tier = (est.tierPercent != null ? est.tierPercent : 0) + '%';\n    return '<div class=\"stats\"><div><span>Sessions</span><b>' + pay.billable.length + '</b></div>' +\n      '<div><span>Tier</span><b>' + esc(tier) + '</b></div>' +\n      '<div><span>To next</span><b>' + esc(next) + '</b></div>' +\n      '<div><span>Revenue</span><b>' + esc(moneyExact(pay.earned)) + '</b></div>' +\n      '<div><span>Commission</span><b>' + (off ? 'Off' : esc(moneyExact(est.commission))) + '</b></div></div>';\n  }\n\n  function homeScreen() {\n    var today = state.today;\n    var todays = (state.sessions || []).filter(function (s) {\n      return s.date === today && s.disposition === 'kept';\n    }).sort(PT.compareSessions);\n    var attention = (state.clients || []).filter(function (c) {\n      var st = PT.currentRemaining(c, state.sessions, state.clients);\n      return st.ready && (st.low || st.out);\n    });\n    var needs = (state.clients || []).filter(function (c) { return !PT.currentRemaining(c, state.sessions, state.clients).ready; });\n    var period = viewedPeriod();\n    var pay = payFigures(period);\n    var lead = periodBar();\n    lead += '<p class=\"sub\" style=\"margin:12px 0\">' + esc(state.lastSync ? ('Last check ' + state.lastSync) : 'Not checked yet') + (state.source && state.source.id ? (' · sheet ' + state.source.id) : '') + '</p>';\n    lead += payStats(pay);\n    lead += '<button type=\"button\" class=\"primary\" data-act=\"sync\">Update from Calendar</button>';\n    var todayCount = todays.filter(function (s) { return s.status !== 'free'; }).length;\n    var todayBlock = '<h2>Today <span class=\"meta\">' + todayCount + '</span></h2>';\n    if (!todays.length) todayBlock += '<div class=\"card empty\">Nothing on the calendar today.</div>';\n    todays.forEach(function (s) { todayBlock += sessionButton(s); });\n    var body = '<div class=\"home-split\"><div class=\"home-lead\">' + lead + '</div><div class=\"home-today\">' + todayBlock + '</div></div>';\n    if (attention.length) {\n      body += '<h2>Low or out</h2><div class=\"client-grid\">';\n      attention.forEach(function (c) { body += clientButton(c); });\n      body += '</div>';\n    }\n    if (needs.length) {\n      body += '<h2>Set a package</h2><div class=\"client-grid\">';\n      needs.forEach(function (c) { body += clientButton(c); });\n      body += '</div>';\n    }\n    body += '<h2>Packages</h2>';\n    var rest = (state.clients || []).slice().sort(function (a, b) {\n      return PT.currentRemaining(a, state.sessions, state.clients).remaining - PT.currentRemaining(b, state.sessions, state.clients).remaining;\n    });\n    if (!rest.length) body += '<div class=\"card empty\">Clients appear when a calendar title ends in PT.</div>';\n    else {\n      body += '<div class=\"client-grid\">';\n      rest.forEach(function (c) { body += clientButton(c); });\n      body += '</div>';\n    }\n    return shell(longDate(today), body, '');\n  }\n\n  function selectedDay() {\n    var day = ui.day || state.today;\n    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(day || ''))) day = state.today;\n    return day;\n  }\n  function weekScreen() {\n    var focus = selectedDay();\n    var start = PT.mondayOf(focus);\n    var end = PT.addDaysYmd(start, 6);\n    var body = '<div class=\"daybar\"><button type=\"button\" class=\"ghost\" data-act=\"day\" data-id=\"-1\">Previous day</button>' +\n      '<input data-field=\"browse-day\" type=\"date\" aria-label=\"Choose a day\" value=\"' + esc(focus) + '\">' +\n      '<button type=\"button\" class=\"ghost\" data-act=\"day\" data-id=\"today\">Today</button>' +\n      '<button type=\"button\" class=\"ghost\" data-act=\"day\" data-id=\"1\">Next day</button></div>' +\n      '<div class=\"weekbar\"><button type=\"button\" class=\"ghost small\" data-act=\"day\" data-id=\"-7\">Previous week</button><b>' + esc(prettyDate(start) + ' – ' + prettyDate(end)) + '</b><button type=\"button\" class=\"ghost small\" data-act=\"day\" data-id=\"7\">Next week</button></div>' +\n      '<p class=\"meta\">The number on a day leaves free sessions out. Only sessions already saved from the calendar are here.</p><div class=\"week-grid\">';\n    var d, i, list, label;\n    for (i = 0; i < 7; i++) {\n      d = PT.addDaysYmd(start, i);\n      list = (state.sessions || []).filter(function (s) { return s.date === d && s.disposition === 'kept'; }).sort(PT.compareSessions);\n      label = prettyDate(d) + (d === state.today ? ' · Today' : '');\n      var counted = list.filter(function (s) { return s.status !== 'free'; }).length;\n      body += '<section class=\"day' + (d === focus ? ' is-selected' : '') + '\"><div class=\"day-head\"><b class=\"' + (d === state.today ? 'today-mark' : '') + '\">' + esc(label) + '</b><span class=\"meta\">' + counted + '</span></div>';\n      if (!list.length) body += '<div class=\"meta\" style=\"margin:0 2px 8px\">Nothing saved</div>';\n      list.forEach(function (s) { body += sessionButton(s); });\n      body += '</section>';\n    }\n    body += '</div>';\n    return shell('Week', body, '');\n  }\n\n  function clientsScreen() {\n    var body = '<div class=\"toolbar\"><button type=\"button\" class=\"primary\" data-act=\"new-client\">Add a client</button></div>';\n    var list = (state.clients || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });\n    if (!list.length) body += '<div class=\"card empty\">No clients yet.</div>';\n    else {\n      body += '<div class=\"client-grid\">';\n      list.forEach(function (c) { body += clientButton(c); });\n      body += '</div>';\n    }\n    return shell('Clients', body, '');\n  }\n\n  function clientScreen(id) {\n    var c = clientById(id);\n    if (!c) return shell('Client', '<div class=\"card empty\">That client is not here.</div>', '#clients');\n    var st = PT.currentRemaining(c, state.sessions, state.clients);\n    var klass = st.out ? 'out' : (st.low ? 'low' : 'ok');\n    var body = '<div class=\"detail\"><div class=\"detail-side\"><div class=\"card\"><div class=\"name\" style=\"font-size:22px\">' + esc(c.name) + '</div>' +\n      '<div class=\"hero-num ' + klass + '\" style=\"margin-top:10px;color:' + (!st.ready ? 'var(--ink)' : st.out ? 'var(--red)' : st.low ? 'var(--amber)' : 'var(--green)') + '\">' + (st.ready ? (st.remaining + '<small>left</small>') : '<small style=\"font-size:28px\">Set the package</small>') + '</div>' +\n      '<p class=\"meta\" style=\"margin-top:8px\">' + (st.ready ? (st.used + ' of ' + st.total + ' used · ' + moneyExact(st.perSession) + ' each') : 'Add the package size, what is left, and the price.') + '</p>' +\n      '<div class=\"grid\" style=\"margin-top:12px\"><div class=\"stat\"><b>' + esc(money(st.value)) + '</b><span>Package</span></div><div class=\"stat\"><b>' + (st.ready ? esc(moneyExact(st.remainingValue)) : '—') + '</b><span>Value left</span></div></div>' +\n      '<p class=\"meta\">Counts from ' + esc(st.startDate ? prettyDate(st.startDate) : 'the start date') + (st.note ? ' · ' + esc(st.note) : '') + '</p>' +\n      '<div class=\"pair\" style=\"margin-top:8px\"><button type=\"button\" class=\"primary\" data-act=\"renew\" data-id=\"' + esc(c.id) + '\">Renew</button><button type=\"button\" class=\"ghost\" data-act=\"fix\" data-id=\"' + esc(c.id) + '\">Fix numbers</button></div></div></div><div class=\"detail-main\">';\n    var packages = PT.sortPackages(c.packages || []);\n    if (packages.length > 1) {\n      body += '<h2>History</h2>';\n      packages.forEach(function (pkg) {\n        var used = PT.packageUsed(c, state.sessions, pkg, state.clients);\n        var current = PT.currentPackage(c.packages);\n        body += '<div class=\"card\"><b>' + (current && current.id === pkg.id ? 'Current package' : 'Earlier package') + '</b><div class=\"meta\" style=\"margin-top:4px\">' + used + ' of ' + esc(pkg.sessions) + ' used · ' + esc(money(pkg.value)) + (pkg.startDate ? ' · from ' + esc(prettyDate(pkg.startDate)) : '') + '</div></div>';\n      });\n    }\n    if ((c.aliases || []).length) body += '<h2>Calendar names</h2><div class=\"card\">' + c.aliases.map(function (a) { return esc(a); }).join(', ') + '</div>';\n    var sessions = PT.sessionsForClient(c, state.sessions, state.clients).slice().reverse();\n    body += '<h2>Sessions</h2>';\n    if (!sessions.length) body += '<div class=\"card empty\">No kept sessions yet.</div>';\n    var lastDay = '';\n    sessions.slice(0, 40).forEach(function (s) {\n      if (s.date !== lastDay) {\n        body += '<div class=\"day-head\"><b>' + esc(prettyDate(s.date) || s.date) + (s.date === state.today ? ' · Today' : '') + '</b></div>';\n        lastDay = s.date;\n      }\n      body += sessionButton(s);\n    });\n    var charges = (state.charges || []).filter(function (ch) { return String(ch.clientId) === String(c.id); });\n    body += '<h2>Charges</h2>';\n    if (!charges.length) body += '<div class=\"card empty\">No AED charges.</div>';\n    charges.forEach(function (ch) { body += chargeRow(ch); });\n    body += '<button type=\"button\" class=\"ghost\" data-act=\"add-charge\" data-id=\"' + esc(c.id) + '\">Add an AED charge</button>';\n    body += '<button type=\"button\" class=\"danger\" data-act=\"ask-delete\" data-id=\"' + esc(c.id) + '\">Remove client</button>';\n    body += '</div></div>';\n    return shell('', body, '#clients');\n  }\n\n  function chargeRow(ch) {\n    var c = clientById(ch.clientId);\n    return '<div class=\"card\"><div class=\"spread\"><b>' + esc(c ? c.name : 'Client') + '</b><b>' + esc(money(ch.amount)) + '</b></div>' +\n      '<div class=\"meta\" style=\"margin-top:4px\">' + esc(chargeLabel(ch.type)) + ' · ' + esc(prettyDate(ch.date)) + '</div>' +\n      (ch.notes ? '<div class=\"note\">' + esc(ch.notes) + '</div>' : '') +\n      '<div class=\"pair\" style=\"margin-top:8px\"><button type=\"button\" class=\"ghost small\" data-act=\"edit-charge\" data-id=\"' + esc(ch.id) + '\">Edit</button><button type=\"button\" class=\"ghost small\" data-act=\"delete-charge\" data-id=\"' + esc(ch.id) + '\">Remove</button></div></div>';\n  }\n\n  function reportScreen() {\n    var period = viewedPeriod();\n    var pay = payFigures(period);\n    var body = periodBar();\n    if (!period) return shell('Report', body + '<div class=\"card empty\">Set the pay period and the report will use those dates.</div>', '');\n    body += '<div class=\"report-layout\"><div class=\"report-summary\"><div class=\"card\" style=\"margin-top:12px\"><div class=\"meta\">Sessions this period</div><div class=\"hero-num\" style=\"font-size:48px;margin-top:6px\">' + pay.billable.length + '</div>' +\n      '<p class=\"meta\">' + esc(pay.est.tierLabel) + '. ' + (pay.est.sessionsToNext ? (pay.est.sessionsToNext + ' to the next tier.') : 'Top tier.') + ' Free sessions are not counted.</p>' +\n      payStats(pay) +\n      '<p class=\"meta\">Net ' + esc(moneyExact(pay.est.netRevenue)) + ' after ' + esc(String(Math.round(pay.est.netFactor * 100) / 100)) + '%. Quota ' + esc(moneyExact(pay.est.quota)) + ' comes off. Commission revenue ' + esc(moneyExact(pay.est.commRevenue)) + '. Charges ' + esc(money(pay.chargeTotal)) + (pay.est.includeCharges ? ' are in the commission.' : ' stay out of the commission.') + '</p></div>';\n    body += '</div><div class=\"report-people\">';\n    var rows = (state.clients || []).map(function (c) {\n      var list = PT.sessionsForClient(c, state.sessions, state.clients).filter(function (s) {\n        return PT.inPeriod(s.date, period, state.today);\n      });\n      var counted = list.filter(function (s) { return s.status !== 'free'; }).length;\n      var free = list.length - counted;\n      return { name: c.name, counted: counted, free: free };\n    }).filter(function (r) { return r.counted || r.free; }).sort(function (a, b) { return b.counted - a.counted; });\n    body += '<h2>By client</h2>';\n    if (!rows.length) body += '<div class=\"card empty\">No sessions in these dates.</div>';\n    else {\n      body += '<div class=\"client-grid\">';\n      rows.forEach(function (r) {\n        body += '<div class=\"card\"><div class=\"spread\"><b>' + esc(r.name) + '</b><b>' + r.counted + '</b></div>' +\n          (r.free ? '<div class=\"meta\">' + r.free + ' free, not counted</div>' : '') + '</div>';\n      });\n      body += '</div>';\n    }\n    body += '<button type=\"button\" class=\"ghost\" data-act=\"nav\" data-go=\"#charges\">Charges in AED</button></div></div>';\n    return shell('Report', body, '');\n  }\n\n  function chargesScreen() {\n    var period = viewedPeriod();\n    var list = (state.charges || []).filter(function (ch) { return period && PT.inPeriod(ch.date, period); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });\n    var total = list.reduce(function (sum, ch) { return sum + PT.chargeAmount(ch); }, 0);\n    var body = periodBar();\n    body += '<div class=\"card\" style=\"margin-top:12px\"><div class=\"meta\">Charges this period</div><div class=\"hero-num\" style=\"font-size:42px;margin-top:6px\">' + esc(money(total)) + '</div></div>';\n    body += '<button type=\"button\" class=\"primary\" data-act=\"add-charge\">Add a charge</button>';\n    if (!period) body += '<div class=\"card empty\">Set the pay period first.</div>';\n    else if (!list.length) body += '<div class=\"card empty\">No charges in this period.</div>';\n    else {\n      body += '<div class=\"client-grid\">';\n      list.forEach(function (ch) { body += chargeRow(ch); });\n      body += '</div>';\n    }\n    return shell('Charges', body, '#report');\n  }\n\n  function tierRows(tiers) {\n    var list = (tiers && tiers.length) ? tiers : PT.defaultTiers();\n    return list.map(function (row, i) {\n      return '<div class=\"tier-row\"><input data-field=\"tier-from\" inputmode=\"numeric\" aria-label=\"From sessions\" value=\"' + esc(row.from) + '\">' +\n        '<input data-field=\"tier-rate\" inputmode=\"decimal\" aria-label=\"Rate percent\" value=\"' + esc(row.rate) + '\">' +\n        '<button type=\"button\" class=\"ghost\" data-act=\"remove-tier\" data-id=\"' + i + '\">Remove</button></div>';\n    }).join('');\n  }\n  function readTierInputs(root) {\n    var scope = root || document;\n    var froms = scope.querySelectorAll('[data-field=\"tier-from\"]');\n    var rates = scope.querySelectorAll('[data-field=\"tier-rate\"]');\n    var out = [], i;\n    for (i = 0; i < froms.length; i++) out.push({ from: froms[i].value, rate: rates[i] ? rates[i].value : '' });\n    return out;\n  }\n  function settingsScreen() {\n    var s = state.settings || {};\n    var net = (s.netFactor != null && s.netFactor !== '') ? s.netFactor : PT.normalizeComm({}).netFactor;\n    var quota = (s.quota != null && s.quota !== '') ? s.quota : '7758';\n    var src = state.source || {};\n    var body = '<div class=\"name\" style=\"font-size:28px;font-family:ui-serif,Georgia,serif;margin-bottom:8px\">Settings</div>';\n    if (src.id || src.code) {\n      body += '<div class=\"card\"><b>Where this copy saves</b><p class=\"meta\">This screen reads one Google Sheet, the one bound to the script you opened. A different file named PT Planner is not this copy.</p>' +\n        '<p class=\"meta\">Spreadsheet id ' + esc(src.id || 'unknown') + (src.name ? (' · ' + esc(src.name)) : '') + '</p>' +\n        (src.url ? '<p class=\"meta\"><a href=\"' + esc(src.url) + '\">Open that spreadsheet</a></p>' : '') +\n        '<p class=\"meta\">Code ' + esc(src.code || '') + '</p></div>';\n    }\n    body += '<div class=\"card\"><label class=\"check\"><input data-field=\"showCommission\" type=\"checkbox\"' + (s.showCommission !== false ? ' checked' : '') + '> Show commission on Home and Report</label>' +\n      '<label class=\"check\"><input data-field=\"includeCharges\" type=\"checkbox\"' + (s.includeCharges ? ' checked' : '') + '> Add AED charges into the commission</label>' +\n      '<label>Quota for a pay period (AED)</label><input data-field=\"quota\" inputmode=\"decimal\" value=\"' + esc(quota) + '\">' +\n      '<label>Net factor (%)</label><input data-field=\"netFactor\" inputmode=\"decimal\" value=\"' + esc(net) + '\">' +\n      '<p class=\"meta\">The J Club sheet shows 81.63%. This longer number is the same factor, kept so the fils match. The quota is always taken off after the net.</p>' +\n      '<label>Tiers</label><p class=\"meta\">From this many sessions in the pay period, this rate applies. Free sessions are not counted. The next tier is the following row.</p>' +\n      '<div class=\"tier-row\"><span class=\"meta\" style=\"flex:1\">From sessions</span><span class=\"meta\" style=\"flex:1\">Rate %</span><span style=\"width:84px\"></span></div>' +\n      tierRows(s.tiers) +\n      '<button type=\"button\" class=\"ghost\" data-act=\"add-tier\">Add a tier</button>' +\n      '<button type=\"button\" class=\"primary\" data-act=\"save-settings\">Save</button></div>';\n    body += '<div class=\"card\"><b>Morning email</b><p class=\"meta\">Every day around 5:00 (Dubai time) the planner checks the calendar and emails pedrocerdeira81@gmail.com. The subject is exactly “PT Planner daily sync”.</p>' +\n      '<button type=\"button\" class=\"ghost\" data-act=\"email\">Email today’s summary</button></div>';\n    body += '<div class=\"card\"><b>Home screen</b><ol class=\"steps\"><li>Open this planner in Safari.</li><li>Tap the Share button (the square with the arrow).</li><li>Tap Add to Home Screen.</li><li>Leave the name as PT Planner. If you see Open as Web App, leave it on.</li><li>Tap Add, then tap the new icon.</li></ol></div>';\n    if ((state.ignored || []).length) {\n      body += '<h2>Ignored names</h2>';\n      state.ignored.forEach(function (name) {\n        body += '<div class=\"card spread\"><span>' + esc(name) + '</span><button type=\"button\" class=\"ghost small\" data-act=\"unignore\" data-name=\"' + esc(name) + '\">Restore</button></div>';\n      });\n    }\n    return shell('Settings', body, '#home');\n  }\n\n  function openSession(id) {\n    var s = sessionById(id);\n    if (!s) return;\n    var c = PT.findClient(state.clients, s.clientName);\n    ui.error = '';\n    ui.sheet = '<div class=\"name\">' + esc(s.clientName) + '</div><p class=\"meta\">' + esc(prettyDate(s.date)) + ' · ' + esc(prettyTime(s.start, s.allDay)) + '</p>' +\n      (s.note ? '<div class=\"card\" style=\"box-shadow:none;background:#f6f3ee\">' + esc(s.note) + '</div>' : '<p class=\"meta\">No note on the calendar event.</p>') +\n      '<label>Count this session as</label><div class=\"seg\">' +\n      ['normal', 'free', 'charged'].map(function (st) {\n        return '<button type=\"button\" data-act=\"status\" data-id=\"' + esc(s.eventId) + '\" data-status=\"' + st + '\"' + (s.status === st ? ' class=\"on\"' : '') + '>' + statusLabel(st) + '</button>';\n      }).join('') + '</div>' +\n      '<p class=\"meta\">Free does not use a package session. Normal and charged do.</p>' +\n      (c ? '<button type=\"button\" class=\"ghost\" data-act=\"add-charge\" data-id=\"' + esc(c.id) + '\" data-event=\"' + esc(s.eventId) + '\" data-date=\"' + esc(s.date) + '\">Add an AED charge</button>' : '') +\n      '<button type=\"button\" class=\"danger\" data-act=\"hide\" data-id=\"' + esc(s.eventId) + '\">Hide this session</button>';\n    render();\n  }\n\n  function payFields(pkg, left) {\n    return '<label>Sessions in the package</label><input data-field=\"sessions\" inputmode=\"numeric\" value=\"' + esc(pkg && pkg.sessions ? pkg.sessions : '') + '\">' +\n      '<label>Sessions left</label><input data-field=\"sessionsLeft\" inputmode=\"numeric\" value=\"' + esc(left) + '\">' +\n      '<label>Package value (AED)</label><input data-field=\"value\" inputmode=\"decimal\" value=\"' + esc(pkg && pkg.value ? pkg.value : '') + '\">' +\n      '<label>Starts</label><input data-field=\"start\" type=\"date\" value=\"' + esc((pkg && pkg.startDate) || state.today) + '\">' +\n      '<label>Notes</label><input data-field=\"note\" value=\"' + esc(pkg && pkg.note ? pkg.note : '') + '\">';\n  }\n  function readPackage(root) {\n    return {\n      name: field('name', root),\n      sessions: field('sessions', root),\n      sessionsLeft: field('sessionsLeft', root),\n      value: field('value', root),\n      startDate: field('start', root),\n      note: field('note', root)\n    };\n  }\n  function openClientForm(c) {\n    ui.error = '';\n    var pkg = c ? PT.currentPackage(c.packages) : null;\n    var st = c ? PT.currentRemaining(c, state.sessions, state.clients) : null;\n    var left = st && st.ready ? String(st.remaining) : (pkg && pkg.sessions ? pkg.sessions : '');\n    ui.sheet = '<div class=\"name\">' + (c ? 'Package' : 'New client') + '</div><p class=\"meta\">Sessions before the start date are ignored, so an old calendar does not use up a fresh package. Leave sessions left empty to subtract every saved session on or after the start date, including ones still ahead on the calendar.</p>' +\n      '<label>Name</label><input data-field=\"name\" value=\"' + esc(c ? c.name : '') + '\">' +\n      payFields(pkg, left) +\n      '<button type=\"button\" class=\"primary\" data-act=\"save-client\" data-id=\"' + esc(c ? c.id : '') + '\">' + (c ? 'Save' : 'Add client') + '</button>';\n    render();\n  }\n\n  function openRenew(id) {\n    var c = clientById(id);\n    if (!c) return;\n    ui.error = '';\n    ui.sheet = '<div class=\"name\">Renew ' + esc(c.name) + '</div><p class=\"meta\">The old package stays in the history. Only sessions on or after the new start date count.</p>' +\n      payFields(null, '') +\n      '<button type=\"button\" class=\"primary\" data-act=\"save-renew\" data-id=\"' + esc(c.id) + '\">Save renewal</button>';\n    render();\n  }\n\n  function openCharge(clientId, eventId, date, existing) {\n    ui.error = '';\n    existing = existing || {};\n    var type = existing.type || 'late_cancel';\n    var options = '<option value=\"\">Choose a client</option>' + (state.clients || []).map(function (c) {\n      return '<option value=\"' + esc(c.id) + '\"' + (String(c.id) === String(clientId) ? ' selected' : '') + '>' + esc(c.name) + '</option>';\n    }).join('');\n    function opt(value, label) { return '<option value=\"' + value + '\"' + (type === value ? ' selected' : '') + '>' + label + '</option>'; }\n    ui.sheet = '<div class=\"name\">AED charge</div>' +\n      '<label>Client</label><select data-field=\"clientId\">' + options + '</select>' +\n      '<label>Amount (AED)</label><input data-field=\"amount\" inputmode=\"decimal\" value=\"' + esc(existing.amount != null ? existing.amount : '') + '\" placeholder=\"200\">' +\n      '<label>Type</label><select data-field=\"type\">' + opt('late_cancel', 'Late cancel') + opt('no_show', 'No show') + opt('other', 'Other') + '</select>' +\n      '<label>Date</label><input data-field=\"date\" type=\"date\" value=\"' + esc(date || state.today) + '\">' +\n      '<label>Note</label><input data-field=\"notes\" value=\"' + esc(existing.notes || '') + '\" placeholder=\"Optional\">' +\n      '<button type=\"button\" class=\"primary\" data-act=\"save-charge\" data-id=\"' + esc(existing.id || '') + '\" data-event=\"' + esc(eventId || '') + '\">Save charge</button>';\n    render();\n  }\n\n  function openDelete(id) {\n    var c = clientById(id);\n    if (!c) return;\n    ui.sheet = '<div class=\"name\">Remove ' + esc(c.name) + '?</div><p class=\"meta\">The calendar will stop adding this name. Charges for them are removed.</p>' +\n      '<button type=\"button\" class=\"danger\" data-act=\"delete-client\" data-id=\"' + esc(id) + '\">Remove</button>' +\n      '<button type=\"button\" class=\"ghost\" data-act=\"close\">Keep</button>';\n    render();\n  }\n\n  function showError(message) {\n    ui.error = message || 'Try again.';\n    var box = document.getElementById('form-error');\n    if (box && ui.sheet) { box.textContent = ui.error; return; }\n    render();\n  }\n\n  function afterSave(next) {\n    state = next;\n    ui.error = '';\n    ui.sheet = null;\n    ui.loading = false;\n    render();\n  }\n\n  function localAct(name, args) {\n    var a = args[0] || {};\n    if (name === 'apiSyncNow') {\n      state.lastSync = state.today + ' 05:04 Asia/Dubai';\n      ui.toast = 'Example calendar is already loaded.';\n      return;\n    }\n    if (name === 'apiEmailSummary') {\n      ui.toast = 'Example only. No email was sent.';\n      return;\n    }\n    if (name === 'apiSetStatus') state.sessions = PT.setStatus(state.sessions, a.eventId, a.status);\n    else if (name === 'apiHide') state.sessions = PT.hideSession(state.sessions, a.eventId).filter(function (s) { return !s.hidden; });\n    else if (name === 'apiMap') {\n      if (a.action === 'ignore') {\n        var ig = PT.ignoreName(state.ignored, state.sessions, a.name);\n        state.ignored = ig.ignored;\n        state.sessions = ig.sessions.filter(function (s) { return s.disposition !== 'ignored'; });\n      } else if (a.action === 'create') {\n        state.clients = PT.createClient(state.clients, a);\n        var created = state.clients[state.clients.length - 1];\n        var made = PT.linkName(state.clients, state.sessions, created.id, a.name);\n        state.clients = made.clients;\n        state.sessions = made.sessions;\n      } else {\n        var linked = PT.linkName(state.clients, state.sessions, a.clientId, a.name);\n        state.clients = linked.clients;\n        state.sessions = linked.sessions;\n      }\n    } else if (name === 'apiSaveClient') {\n      if (!a.id) state.clients = PT.createClient(state.clients, a, state.sessions, state.clients);\n      else {\n        state.clients = state.clients.map(function (c) {\n          return String(c.id) === String(a.id) ? PT.saveClientPackage(c, a, state.sessions, state.clients) : c;\n        });\n      }\n    } else if (name === 'apiSavePeriods') {\n      var savedPeriods = PT.savePeriods((state.settings && state.settings.periods) || [], a);\n      state.settings.periods = savedPeriods.periods;\n      ui.periodId = savedPeriods.id;\n    } else if (name === 'apiDeleteClient') {\n      var removed = PT.deleteClient(state.clients, state.sessions, a.id);\n      state.clients = removed.clients;\n      state.sessions = removed.sessions.filter(function (s) { return s.disposition !== 'ignored'; });\n      state.charges = (state.charges || []).filter(function (ch) { return String(ch.clientId) !== String(a.id); });\n      if (route().name === 'client') location.hash = '#clients';\n    } else if (name === 'apiSaveCharge') {\n      var amount = Number(a.amount);\n      if (!isFinite(amount) || amount < 0) throw new Error('Enter an amount in AED, or 0.');\n      if (!a.clientId) throw new Error('Choose a client.');\n      var entry = PT.migrateCharge({\n        id: a.id || ('ch' + Date.now()),\n        clientId: a.clientId,\n        eventId: a.eventId || '',\n        type: a.type || 'other',\n        amount: amount,\n        date: a.date || state.today,\n        notes: a.notes || '',\n        createdAt: state.today\n      });\n      var replaced = false;\n      state.charges = (state.charges || []).map(function (ch) {\n        if (a.id && String(ch.id) === String(a.id)) { replaced = true; return entry; }\n        return ch;\n      });\n      if (!replaced) state.charges = state.charges.concat([entry]);\n    } else if (name === 'apiDeleteCharge') {\n      state.charges = (state.charges || []).filter(function (ch) { return String(ch.id) !== String(a.id); });\n    } else if (name === 'apiSaveSettings') {\n      var comm = PT.normalizeComm(a);\n      comm.periods = (state.settings && state.settings.periods) || [];\n      state.settings = comm;\n    } else if (name === 'apiUnignore') {\n      var key = PT.normName(a.name);\n      state.ignored = (state.ignored || []).filter(function (n) { return PT.normName(n) !== key; });\n    }\n  }\n\n  function call(name, args, timeoutMs) {\n    return new Promise(function (resolve, reject) {\n      var settled = false;\n      var limit = window.PT_CALL_TIMEOUT || timeoutMs || 20000;\n      var timer = setTimeout(function () {\n        if (settled) return;\n        settled = true;\n        reject(new Error('This is taking too long. Check the connection, then tap Try again.'));\n      }, limit);\n      function finish(fn, value) {\n        if (settled) return;\n        settled = true;\n        clearTimeout(timer);\n        fn(value);\n      }\n      try {\n        if (!(window.google && google.script && google.script.run)) {\n          finish(reject, new Error('Open PT Planner from the Google link, in Safari.'));\n          return;\n        }\n        // google.script.run ignores Function.apply and Function.call, and then\n        // neither handler runs. Call the server function directly.\n        var runner = google.script.run\n          .withSuccessHandler(function (value) { finish(resolve, value); })\n          .withFailureHandler(function (err) {\n            var message = 'Could not reach PT Planner.';\n            if (err && err.message) message = String(err.message);\n            else if (typeof err === 'string' && err) message = err;\n            finish(reject, new Error(message));\n          });\n        args = args || [];\n        if (args.length === 0) runner[name]();\n        else if (args.length === 1) runner[name](args[0]);\n        else if (args.length === 2) runner[name](args[0], args[1]);\n        else if (args.length === 3) runner[name](args[0], args[1], args[2]);\n        else finish(reject, new Error('PT Planner could not send that request.'));\n      } catch (err) {\n        finish(reject, new Error((err && err.message) || 'PT Planner could not start.'));\n      }\n    });\n  }\n\n  function go(name, args) {\n    try {\n      if (EXAMPLE) {\n        localAct(name, args || [{}]);\n        ui.error = '';\n        ui.sheet = null;\n        render();\n        if (ui.toast) {\n          var note = ui.toast;\n          ui.toast = '';\n          var el = document.createElement('div');\n          el.className = 'banner';\n          el.style.position = 'fixed';\n          el.style.left = '16px';\n          el.style.right = '16px';\n          el.style.bottom = '96px';\n          el.style.zIndex = '30';\n          el.textContent = note;\n          document.body.appendChild(el);\n          setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2200);\n        }\n        return;\n      }\n      ui.loading = true;\n      var slow = name === 'apiSyncNow' || name === 'apiEmailSummary';\n      call(name, args, slow ? 120000 : 20000).then(afterSave).catch(function (err) { ui.loading = false; showError(err.message); });\n    } catch (err) {\n      showError(err.message);\n    }\n  }\n\n  function onClick(e) {\n    var el = e.target.closest('[data-act]');\n    if (!el) return;\n    var act = el.getAttribute('data-act');\n    if (act === 'stop') return;\n    if (act === 'close') { ui.sheet = null; ui.error = ''; render(); return; }\n    if (act === 'nav') {\n      ui.sheet = null;\n      var dest = el.getAttribute('data-go');\n      if (location.hash !== dest) location.hash = dest;\n      else render();\n      return;\n    }\n    if (act === 'week' || act === 'day') {\n      var step = el.getAttribute('data-id');\n      if (step === 'today') ui.day = state.today;\n      else ui.day = PT.addDaysYmd(selectedDay(), Number(step || 0));\n      render();\n      return;\n    }\n    if (act === 'pick-period') {\n      var pick = el.getAttribute('data-id');\n      if (!pick) return;\n      ui.periodId = pick;\n      render();\n      return;\n    }\n    if (act === 'edit-period' || act === 'new-period') {\n      var chosen = null;\n      if (act === 'edit-period') {\n        periodList().forEach(function (p) { if (String(p.id) === String(el.getAttribute('data-id'))) chosen = p; });\n      }\n      ui.error = '';\n      ui.sheet = '<div class=\"name\">' + (act === 'new-period' ? 'Next pay period' : 'Edit pay period') + '</div><p class=\"meta\">Use the exact dates from J Club. Totals update as soon as you save.</p><label>Starts</label><input data-field=\"pstart\" type=\"date\" value=\"' + esc(chosen ? chosen.start : '') + '\"><label>Ends</label><input data-field=\"pend\" type=\"date\" value=\"' + esc(chosen ? chosen.end : '') + '\"><button type=\"button\" class=\"primary\" data-act=\"save-period\" data-id=\"' + esc(chosen ? chosen.id : '') + '\">Save</button>';\n      render();\n      return;\n    }\n    if (act === 'save-period') {\n      var holder = el.closest('.sheet') || el.closest('.card') || document;\n      go('apiSavePeriods', [{ id: el.getAttribute('data-id') || '', start: field('pstart', holder), end: field('pend', holder) }]);\n      return;\n    }\n    if (act === 'session') { openSession(el.getAttribute('data-id')); return; }\n    if (act === 'open-client') { location.hash = '#client/' + encodeURIComponent(el.getAttribute('data-id')); return; }\n    if (act === 'sync') {\n      if (EXAMPLE) { go('apiSyncNow', [{}]); return; }\n      beginSync();\n      return;\n    }\n    if (act === 'email') { go('apiEmailSummary', [{}]); return; }\n    if (act === 'status') { go('apiSetStatus', [{ eventId: el.getAttribute('data-id'), status: el.getAttribute('data-status') }]); return; }\n    if (act === 'hide') { go('apiHide', [{ eventId: el.getAttribute('data-id') }]); return; }\n    if (act === 'new-client') { openClientForm(null); return; }\n    if (act === 'fix') { openClientForm(clientById(el.getAttribute('data-id'))); return; }\n    if (act === 'renew') { openRenew(el.getAttribute('data-id')); return; }\n    if (act === 'save-client' || act === 'save-renew') {\n      var root = el.closest('.sheet');\n      var pack = readPackage(root);\n      pack.id = el.getAttribute('data-id');\n      pack.mode = act === 'save-renew' ? 'renew' : 'edit';\n      go('apiSaveClient', [pack]);\n      return;\n    }\n    if (act === 'ask-delete') { openDelete(el.getAttribute('data-id')); return; }\n    if (act === 'delete-client') { go('apiDeleteClient', [{ id: el.getAttribute('data-id') }]); return; }\n    if (act === 'add-charge') { ui.sheet = null; openCharge(el.getAttribute('data-id'), el.getAttribute('data-event'), el.getAttribute('data-date')); return; }\n    if (act === 'edit-charge') {\n      var existing = null;\n      (state.charges || []).forEach(function (ch) { if (String(ch.id) === String(el.getAttribute('data-id'))) existing = ch; });\n      if (!existing) return;\n      openCharge(existing.clientId, existing.eventId, existing.date, existing);\n      return;\n    }\n    if (act === 'save-charge') {\n      var box = el.closest('.sheet');\n      go('apiSaveCharge', [{\n        id: el.getAttribute('data-id') || '',\n        clientId: field('clientId', box),\n        amount: field('amount', box),\n        type: field('type', box) || 'other',\n        date: field('date', box),\n        notes: field('notes', box),\n        eventId: el.getAttribute('data-event') || ''\n      }]);\n      return;\n    }\n    if (act === 'delete-charge') { go('apiDeleteCharge', [{ id: el.getAttribute('data-id') }]); return; }\n    if (act === 'add-tier' || act === 'remove-tier') {\n      var edited = readTierInputs(el.closest('.sheet') || document);\n      if (act === 'add-tier') edited.push({ from: '', rate: '' });\n      else edited.splice(Number(el.getAttribute('data-id')), 1);\n      state.settings = state.settings || {};\n      state.settings.tiers = edited;\n      render();\n      return;\n    }\n    if (act === 'save-settings') {\n      go('apiSaveSettings', [{\n        showCommission: field('showCommission'),\n        includeCharges: field('includeCharges'),\n        quota: field('quota'),\n        netFactor: field('netFactor'),\n        tiers: readTierInputs(document)\n      }]);\n      return;\n    }\n    if (act === 'unignore') { go('apiUnignore', [{ name: el.getAttribute('data-name') }]); return; }\n    if (act === 'retry-boot') { startApp(); return; }\n  }\n\n  function render() {\n    var root = document.getElementById('app');\n    if (!state) {\n      var splash = '<div class=\"app loading\"><div><div class=\"brand\"><span class=\"mark\">PT</span> Planner</div>';\n      if (ui.fatal) {\n        splash += '<p>' + esc(ui.fatal) + '</p><button type=\"button\" class=\"primary\" data-act=\"retry-boot\">Try again</button>';\n      } else {\n        splash += '<p class=\"meta\">' + esc(ui.status || 'Opening your planner…') + '</p>';\n      }\n      root.innerHTML = splash + '</div></div>';\n      return;\n    }\n    var r = route();\n    var html = '';\n    if (r.name === 'week') html = weekScreen();\n    else if (r.name === 'clients') html = clientsScreen();\n    else if (r.name === 'client') html = clientScreen(r.id);\n    else if (r.name === 'report') html = reportScreen();\n    else if (r.name === 'charges') html = chargesScreen();\n    else if (r.name === 'settings') html = settingsScreen();\n    else html = homeScreen();\n    root.innerHTML = html;\n  }\n\n  function readBoot() {\n    var el = document.getElementById('boot-data');\n    if (!el) return null;\n    var text = (el.textContent || '').replace(/^\\s+|\\s+$/g, '');\n    if (!text || text === '___PT_BOOT___' || text === 'null') return null;\n    try { return JSON.parse(text); } catch (e) { return null; }\n  }\n\n  function buildExample() {\n    function many(name, dates, start, status, note) {\n      return dates.map(function (date, i) {\n        return {\n          eventId: name.toLowerCase().replace(/\\s+/g, '-') + '-' + date,\n          calendarId: 'example',\n          title: name + ' PT',\n          clientName: name,\n          date: date,\n          start: start,\n          end: '08:00',\n          allDay: false,\n          note: note || '',\n          status: status || 'normal',\n          statusLocked: !!(status && status !== 'normal'),\n          disposition: 'kept',\n          hidden: false,\n          removed: false,\n          createdAt: '2026-10-01 05:04'\n        };\n      });\n    }\n    var clients = [\n      PT.migrateClient({ id: 'larissa', name: 'Larissa', packageSessions: '20', packageValue: '7000', startDate: '2026-09-01' }),\n      PT.migrateClient({ id: 'jeremy', name: 'Jeremy', packageSessions: '12', packageValue: '4800', startDate: '2026-08-01' }),\n      PT.migrateClient({\n        id: 'mohammad',\n        name: 'Mohammad family',\n        packages: [\n          { id: 'm-old', sessions: '8', value: '4000', startDate: '2026-01-06' },\n          { id: 'm-now', sessions: '10', value: '5500', startDate: '2026-06-01' }\n        ]\n      }),\n      PT.migrateClient({ id: 'sofia', name: 'Sofia', packageSessions: '16', packageValue: '6400', startDate: '2026-10-01' }),\n      PT.migrateClient({ id: 'omar', name: 'Omar', packageSessions: '', packageValue: '', startDate: '2026-11-02' })\n    ];\n    var sessions = []\n      .concat(many('Larissa', ['2026-09-03', '2026-09-10', '2026-09-17', '2026-10-01', '2026-10-22', '2026-11-05', '2026-11-09', '2026-11-12', '2026-11-16', '2026-11-19', '2026-11-23', '2026-11-26', '2026-11-30'], '07:00'))\n      .concat(many('Jeremy', ['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25', '2026-09-08', '2026-09-15', '2026-09-29', '2026-10-06', '2026-10-20', '2026-10-27'], '09:00'))\n      .concat(many('Mohammad family', ['2026-01-08', '2026-01-15', '2026-01-22', '2026-02-05', '2026-02-19', '2026-03-05', '2026-03-19', '2026-04-02'], '18:00'))\n      .concat(many('Mohammad family', ['2026-06-04', '2026-06-18', '2026-07-02', '2026-07-16', '2026-08-06', '2026-08-20', '2026-09-10', '2026-10-08', '2026-10-29'], '18:00'))\n      .concat(many('Sofia', ['2026-10-06', '2026-10-13', '2026-10-27', '2026-11-06', '2026-11-10', '2026-11-13', '2026-11-17', '2026-11-20', '2026-11-24'], '08:30'));\n    sessions.push({\n      eventId: 'larissa-today', calendarId: 'example', title: 'Larissa PT', clientName: 'Larissa',\n      date: '2026-11-02', start: '07:00', end: '08:00', allDay: false, note: '', status: 'normal',\n      statusLocked: false, disposition: 'kept', hidden: false, removed: false, createdAt: '2026-11-02 05:04'\n    });\n    sessions.push({\n      eventId: 'jeremy-today', calendarId: 'example', title: 'Jeremy free Pt', clientName: 'Jeremy',\n      date: '2026-11-02', start: '09:00', end: '10:00', allDay: false, note: 'Free pra compensar outras sessoes',\n      status: 'free', statusLocked: true, disposition: 'kept', hidden: false, removed: false, createdAt: '2026-11-02 05:04'\n    });\n    sessions.push({\n      eventId: 'mohammad-today', calendarId: 'example', title: 'Mohammad family PT', clientName: 'Mohammad family',\n      date: '2026-11-02', start: '18:00', end: '19:00', allDay: false, note: 'Charged, give back friday',\n      status: 'charged', statusLocked: true, disposition: 'kept', hidden: false, removed: false, createdAt: '2026-11-02 05:04'\n    });\n    sessions.push({\n      eventId: 'sofia-tomorrow', calendarId: 'example', title: 'Sofia PT', clientName: 'Sofia',\n      date: '2026-11-03', start: '08:30', end: '09:30', allDay: false, note: '', status: 'normal',\n      statusLocked: false, disposition: 'kept', hidden: false, removed: false, createdAt: '2026-11-02 05:04'\n    });\n    return {\n      today: '2026-11-02',\n      nowLabel: '2026-11-02 05:04 Asia/Dubai',\n      lastSync: '2026-11-02 05:04 Asia/Dubai',\n      triggerReady: true,\n      triggerError: '',\n      webAppUrl: '',\n      clients: clients,\n      sessions: sessions,\n      charges: [\n        { id: 'ch1', clientId: 'jeremy', eventId: '', type: 'late_cancel', amount: 200, date: '2026-11-01', notes: 'Cancelled 1 hour before', createdAt: '2026-11-01' },\n        { id: 'ch2', clientId: 'sofia', eventId: '', type: 'no_show', amount: 150, date: '2026-10-30', notes: 'Did not arrive', createdAt: '2026-10-30' }\n      ],\n      settings: {\n        quota: '2000', netFactor: '81.63', includeCharges: false, showCommission: true,\n        periods: [\n          { id: 'p1', start: '2026-09-30', end: '2026-10-28' },\n          { id: 'p2', start: '2026-10-29', end: '2026-11-29' }\n        ]\n      },\n      ignored: []\n    };\n  }\n\n  document.addEventListener('click', onClick);\n  document.addEventListener('change', function (e) {\n    var input = e.target && e.target.getAttribute && e.target.getAttribute('data-field') === 'browse-day' ? e.target : null;\n    if (!input || !input.value) return;\n    ui.day = input.value;\n    render();\n  });\n  window.addEventListener('hashchange', function () { ui.sheet = null; render(); });\n\n  function showState(s) {\n    state = s;\n    ui.boot = readBoot();\n    render();\n  }\n  function pollSync(seen, n) {\n    if (n > 20) {\n      ui.syncing = false;\n      render();\n      return;\n    }\n    setTimeout(function () {\n      call('apiGetState', [], 15000).then(function (s) {\n        if (s && s.today) state = s;\n        if (s && s.lastSync && s.lastSync !== seen) {\n          ui.syncing = false;\n          render();\n          return;\n        }\n        render();\n        pollSync(seen, n + 1);\n      }).catch(function () { pollSync(seen, n + 1); });\n    }, 4000);\n  }\n  function beginSync() {\n    if (!state) return;\n    var seen = state.lastSync || '';\n    ui.syncing = true;\n    ui.syncError = '';\n    render();\n    var attempt = 0;\n    function run() {\n      attempt++;\n      call('apiSyncNow', [], 90000).then(function (next) {\n        if (next && next.syncing) {\n          pollSync(seen, 0);\n          return;\n        }\n        if (next && next.today) state = next;\n        ui.syncing = false;\n        render();\n      }).catch(function (err) {\n        if (attempt < 3) {\n          setTimeout(run, 4000);\n          return;\n        }\n        ui.syncing = false;\n        ui.syncError = (err && err.message) || 'Calendar check did not finish.';\n        render();\n      });\n    }\n    run();\n  }\n  function startApp() {\n    ui.fatal = '';\n    ui.syncError = '';\n    ui.syncing = false;\n    ui.status = 'Opening your planner…';\n    state = null;\n    try { render(); } catch (e) { ui.fatal = (e && e.message) || 'PT Planner could not open.'; }\n    call('apiGetState', [], 20000).then(function (s) {\n      if (!s || typeof s !== 'object' || !s.today) throw new Error('PT Planner sent an empty reply.');\n      ui.status = '';\n      showState(s);\n      beginSync();\n    }).catch(function (err) {\n      ui.syncing = false;\n      ui.fatal = (err && err.message) || 'PT Planner could not open.';\n      state = null;\n      try { render(); } catch (e2) {}\n    });\n  }\n\n  if (!EXAMPLE && !(window.google && google.script && google.script.run)) {\n    document.getElementById('app').innerHTML = '<div class=\"app fatal\"><div><div class=\"brand\"><span class=\"mark\">PT</span> Planner</div><p>Open the Google link on your iPhone. This file is only the screen.</p><p><a href=\"?example=1#home\">View example screens</a></p></div></div>';\n  } else if (EXAMPLE) {\n    state = buildExample();\n    render();\n  } else {\n    startApp();\n  }\n})();\n</script>\n</body>\n</html>\n";
}

function dailySync() {
  try {
    runSync_({ email: 'trigger' });
  } catch (err) {
    try {
      deliver_(stampMail_(PT.buildDailyEmail({
        ok: false,
        when: whenLabel_(),
        error: String(err && err.message || err)
      }), {}));
    } catch (ignore) {}
    throw err;
  }
}

function apiGetState() {
  assertOwner_();
  try {
    return publicState_();
  } catch (err) {
    var empty = PT.normalizeComm({});
    empty.periods = [];
    return {
      today: todayDubai_(),
      nowLabel: whenLabel_(),
      lastSync: '',
      triggerReady: false,
      triggerError: '',
      webAppUrl: '',
      clients: [],
      sessions: [],
      charges: [],
      settings: empty,
      ignored: [],
      syncing: false
    };
  }
}

function apiSyncNow() {
  var result = runSync_({ email: false });
  var state = publicState_();
  state.syncing = !!(result && result.busy);
  return state;
}

function apiEmailSummary() {
  var result = runSync_({ email: 'now' });
  var state = publicState_();
  state.syncing = !!(result && result.busy);
  return state;
}

function apiSaveClient(obj) {
  return withLock_(function () {
    assertOwner_();
    obj = obj || {};
    var clients = readClients_();
    var sessions = readSessionsAll_();
    var fields = packageFields_(obj);
    if (!obj.id) {
      clients = PT.createClient(clients, fields, sessions, clients);
    } else {
      clients = mapClient_(clients, obj.id, function (c) {
        return PT.saveClientPackage(c, fields, sessions, clients);
      });
    }
    writeClients_(clients);
    return publicState_();
  });
}

function apiDeleteClient(obj) {
  return withLock_(function () {
    assertOwner_();
    var id = obj && obj.id ? obj.id : obj;
    var clients = readClients_();
    var victim = null, i;
    for (i = 0; i < clients.length; i++) if (String(clients[i].id) === String(id)) victim = clients[i];
    var result = PT.deleteClient(clients, readSessionsAll_(), id);
    var ignored = readIgnored_();
    if (victim) {
      var ig = PT.ignoreName(ignored, result.sessions, victim.name);
      ignored = ig.ignored;
      result.sessions = ig.sessions;
    }
    writeIgnored_(ignored);
    writeClients_(result.clients);
    writeSessions_(result.sessions);
    var charges = readCharges_().filter(function (ch) { return String(ch.clientId) !== String(id); });
    writeCharges_(charges);
    return publicState_();
  });
}

function apiMap(obj) {
  return withLock_(function () {
    assertOwner_();
    obj = obj || {};
    var name = clip_(obj.name, 80);
    var clients = readClients_();
    var sessions = readSessionsAll_();
    var ignored = readIgnored_();
    if (obj.action === 'ignore') {
      var ignoredResult = PT.ignoreName(ignored, sessions, name);
      writeIgnored_(ignoredResult.ignored);
      writeSessions_(ignoredResult.sessions);
    } else if (obj.action === 'create') {
      clients = PT.createClient(clients, {
        name: name,
        sessions: obj.sessions,
        sessionsLeft: obj.sessionsLeft,
        value: obj.value,
        startDate: obj.startDate || todayDubai_(),
        note: obj.note
      }, sessions, clients);
      var created = clients[clients.length - 1];
      var linkedNew = PT.linkName(clients, sessions, created.id, name);
      writeClients_(linkedNew.clients);
      writeSessions_(linkedNew.sessions);
    } else {
      var linked = PT.linkName(clients, sessions, obj.clientId, name);
      writeClients_(linked.clients);
      writeSessions_(linked.sessions);
    }
    return publicState_();
  });
}

function apiSetStatus(obj) {
  return withLock_(function () {
    assertOwner_();
    obj = obj || {};
    writeSessions_(PT.setStatus(readSessionsAll_(), obj.eventId, obj.status));
    return publicState_();
  });
}

function apiHide(obj) {
  return withLock_(function () {
    assertOwner_();
    writeSessions_(PT.hideSession(readSessionsAll_(), obj && obj.eventId));
    return publicState_();
  });
}

function apiSaveCharge(obj) {
  return withLock_(function () {
    assertOwner_();
    obj = obj || {};
    var charges = readCharges_();
    var amount = Number(obj.amount);
    if (!isFinite(amount) || amount < 0) throw new Error('Enter an amount in AED, or 0.');
    if (!obj.clientId) throw new Error('Choose a client.');
    var entry = PT.migrateCharge({
      id: obj.id || PT.uid(),
      clientId: String(obj.clientId),
      eventId: obj.eventId ? String(obj.eventId) : '',
      type: obj.type || 'other',
      amount: amount,
      date: clip_(obj.date, 10) || todayDubai_(),
      notes: clip_(obj.notes, 500),
      createdAt: nowStamp_()
    });
    var replaced = false;
    charges = charges.map(function (ch) {
      if (obj.id && String(ch.id) === String(obj.id)) { replaced = true; entry.createdAt = ch.createdAt || entry.createdAt; return entry; }
      return ch;
    });
    if (!replaced) charges.push(entry);
    writeCharges_(charges);
    return publicState_();
  });
}

function apiDeleteCharge(obj) {
  return withLock_(function () {
    assertOwner_();
    var id = obj && obj.id;
    writeCharges_(readCharges_().filter(function (ch) { return String(ch.id) !== String(id); }));
    return publicState_();
  });
}

function apiSaveSettings(obj) {
  return withLock_(function () {
    assertOwner_();
    obj = obj || {};
    var comm = PT.normalizeComm({
      quota: obj.quota,
      netFactor: obj.netFactor,
      includeCharges: !!obj.includeCharges,
      showCommission: obj.showCommission !== false && obj.showCommission !== 'false',
      tiers: obj.tiers
    });
    setSetting_('quota', String(comm.quota));
    setSetting_('netFactor', String(comm.netFactor));
    setSetting_('includeCharges', comm.includeCharges ? 'yes' : '');
    setSetting_('showCommission', comm.showCommission ? 'yes' : 'no');
    setSetting_('tiers', JSON.stringify(comm.tiers));
    return publicState_();
  });
}

function apiSavePeriods(obj) {
  return withLock_(function () {
    assertOwner_();
    var saved = PT.savePeriods(PT.sortPeriods(parseJson_(getSetting_('periods'), [])), obj || {});
    setSetting_('periods', JSON.stringify(saved.periods));
    return publicState_();
  });
}

function apiUnignore(obj) {
  return withLock_(function () {
    assertOwner_();
    var key = PT.normName(obj && obj.name);
    var ignored = readIgnored_().filter(function (name) { return PT.normName(name) !== key; });
    writeIgnored_(ignored);
    var sessions = readSessionsAll_().map(function (s) {
      if (PT.normName(s.clientName) !== key) return s;
      if (s.disposition !== 'ignored') return s;
      var copy = PT.copySession(s);
      copy.disposition = 'pending';
      return copy;
    });
    writeSessions_(sessions);
    return publicState_();
  });
}

function runSync_(opts) {
  opts = opts || {};
  assertOwner_();
  var props = PropertiesService.getScriptProperties();
  var nowMs = Date.now();
  var until = Number(props.getProperty('syncingUntil') || '0');
  if (until > nowMs) return { busy: true };
  props.setProperty('syncingUntil', String(nowMs + 3 * 60 * 1000));
  try {
    var today = todayDubai_();
    var periods = [];
    try { periods = phoneSettings_().periods || []; } catch (e) { periods = []; }
    var span = PT.syncWindow(today, periods);
    var events = fetchEvents_(span.windowStart, span.windowEnd);
    var sendMail = false;
    var saved = withWriteLock_(function () {
      ensureSheets_();
      var ctx = {
        clients: readClients_(),
        ignored: readIgnored_(),
        today: today,
        windowStart: span.windowStart,
        windowEnd: span.windowEnd,
        nowStamp: nowStamp_()
      };
      var result = PT.applySync(readSessionsAll_(), events, ctx);
      if (result.idRemap && result.idRemap.length) writeCharges_(PT.retargetCharges(readCharges_(), result.idRemap));
      writeSessions_(result.sessions);
      writeClients_(result.clients || ctx.clients);
      var patch = { lastSync: whenLabel_(), triggerError: '' };
      if (opts.email === 'now') sendMail = true;
      else if (opts.email === 'trigger' && getSetting_('lastTriggerEmail') !== today) {
        patch.lastTriggerEmail = today;
        sendMail = true;
      }
      patchSettings_(patch);
      return result;
    });
    if (!saved) return { busy: true };
    if (sendMail) {
      try {
        deliver_(stampMail_(PT.buildSummary({
          clients: saved.clients || [],
          sessions: saved.sessions || [],
          settings: phoneSettings_()
        }, today, whenLabel_()), readBack_(saved)));
      } catch (e2) {}
    }
    rememberTrigger_();
    return { busy: false, checked: events.length };
  } finally {
    try { props.setProperty('syncingUntil', '0'); } catch (e4) {}
  }
}

function rememberTrigger_() {
  try {
    ensureDailyTrigger_();
    setSetting_('triggerError', '');
  } catch (err) {
    setSetting_('triggerError', String(err && err.message || err));
  }
}

function ensureDailyTrigger_() {
  var props = PropertiesService.getScriptProperties();
  var want = 'dubai-5am-v1';
  var triggers = ScriptApp.getProjectTriggers();
  var daily = [];
  var i;
  for (i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailySync') daily.push(triggers[i]);
  }
  if (props.getProperty('triggerVersion') !== want) {
    for (i = 0; i < daily.length; i++) ScriptApp.deleteTrigger(daily[i]);
    daily = [];
    props.setProperty('triggerVersion', want);
  }
  if (!daily.length) {
    ScriptApp.newTrigger('dailySync')
      .timeBased()
      .atHour(5)
      .nearMinute(0)
      .everyDays(1)
      .inTimezone(TZ)
      .create();
  } else {
    for (i = 1; i < daily.length; i++) ScriptApp.deleteTrigger(daily[i]);
  }
}

function importMigration_(b64) {
  assertOwner_();
  var raw = String(b64 || '');
  if (!raw || raw.length > 120000) throw new Error('That list is too big to send in one go. Add the clients in the app instead.');
  var json = Utilities.newBlob(Utilities.base64Decode(padB64_(raw))).getDataAsString('UTF-8');
  var data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !Array.isArray(data.clients)) throw new Error('The old planner did not send a client list.');
  if (data.clients.length > 200) throw new Error('That is more clients than this planner will take in one go.');
  return withLock_(function () {
    ensureSheets_();
    var merged = PT.mergeMigration({
      clients: readClients_(),
      charges: readCharges_(),
      settings: {
        quota: getSetting_('quota'),
        netFactor: getSetting_('netFactor'),
        includeCharges: getSetting_('includeCharges') === '' ? null : getSetting_('includeCharges') === 'yes',
        showCommission: getSetting_('showCommission') === '' ? null : getSetting_('showCommission') !== 'no',
        periodStart: getSetting_('periodStart'),
        periodEnd: getSetting_('periodEnd')
      }
    }, {
      clients: data.clients,
      charges: data.charges || [],
      comm: data.comm || {},
      period: data.period || {}
    });
    writeClients_(merged.clients);
    writeCharges_(merged.charges);
    var s = merged.settings || {};
    if (s.quota != null) setSetting_('quota', String(s.quota));
    if (s.netFactor != null) setSetting_('netFactor', String(s.netFactor));
    if (s.includeCharges != null) setSetting_('includeCharges', s.includeCharges ? 'yes' : '');
    if (s.showCommission != null) setSetting_('showCommission', s.showCommission ? 'yes' : 'no');
    if (s.periodStart) setSetting_('periodStart', s.periodStart);
    if (s.periodEnd) setSetting_('periodEnd', s.periodEnd);
    return { ok: true, added: merged.added, skipped: merged.skipped };
  });
}

function assertOwner_() {
  var active = '';
  var owner = '';
  try { active = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  try { owner = Session.getEffectiveUser().getEmail() || ''; } catch (e2) {}
  if (!owner) throw new Error('PT Planner could not confirm the Google account.');
  // Execute-as-me often leaves the active email blank, including on iPad,
  // even for the owner. Only a different signed-in person is rejected.
  // Who has access: Only myself already blocks everyone else.
  if (active && active.toLowerCase() !== owner.toLowerCase()) throw new Error('This planner belongs to ' + owner + '.');
}

function fetchEvents_(startYmd, endYmd) {
  var start = Utilities.parseDate(startYmd + ' 00:00:00', TZ, 'yyyy-MM-dd HH:mm:ss');
  var end = Utilities.parseDate(endYmd + ' 23:59:59', TZ, 'yyyy-MM-dd HH:mm:ss');
  var calendars = CalendarApp.getAllCalendars();
  var out = [], i, j;
  for (i = 0; i < calendars.length; i++) {
    var cal = calendars[i];
    var owned = false;
    try { owned = cal.isOwnedByMe(); } catch (e) { owned = false; }
    if (!owned) continue;
    var events = [];
    try { events = cal.getEvents(start, end); } catch (e2) { continue; }
    for (j = 0; j < events.length; j++) {
      var ev = events[j];
      var type = '';
      try { type = ev.getEventType ? String(ev.getEventType()) : ''; } catch (e3) { type = ''; }
      if (type && type !== 'DEFAULT') continue;
      try {
        if (ev.getMyStatus && ev.getMyStatus() === CalendarApp.GuestStatus.NO) continue;
      } catch (e4) {}
      var title = '';
      try { title = ev.getTitle() || ''; } catch (e5) { title = ''; }
      if (/^cancelled:/i.test(title) || /^canceled:/i.test(title)) continue;
      var allDay = false;
      try { allDay = !!ev.isAllDayEvent(); } catch (e6) { allDay = false; }
      var startTime = ev.getStartTime();
      var endTime = ev.getEndTime();
      var note = '';
      try { note = ev.getDescription() || ''; } catch (e7) { note = ''; }
      note = String(note).replace(/<[^>]+>/g, ' ');
      note = PT.collapseSpace(note);
      out.push({
        eventId: eventKey_(ev, startTime),
        calendarId: String(cal.getId()),
        title: title,
        date: Utilities.formatDate(startTime, TZ, 'yyyy-MM-dd'),
        start: allDay ? '' : Utilities.formatDate(startTime, TZ, 'HH:mm'),
        end: allDay ? '' : Utilities.formatDate(endTime, TZ, 'HH:mm'),
        allDay: allDay,
        note: note
      });
    }
  }
  return out;
}

// CalendarApp getId() returns the iCalUID, which is the SAME for every
// occurrence of a recurring series. Add the occurrence start so each
// instance gets its own session row (single events keep their plain id).
function eventKey_(ev, startTime) {
  var id = String(ev.getId());
  var recurring = false;
  try { recurring = !!(ev.isRecurringEvent && ev.isRecurringEvent()); } catch (e) { recurring = false; }
  if (!recurring) return id;
  return id + '@' + Utilities.formatDate(startTime, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

function deliver_(mail) {
  MailApp.sendEmail({
    to: mail.to,
    subject: mail.subject,
    body: mail.body,
    name: 'PT Planner'
  });
}

function publicState_() {
  var sessions = readSessionsAll_().filter(function (s) {
    return !s.removed && !s.hidden && s.disposition !== 'ignored';
  });
  var triggerOn = false;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var i;
    for (i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'dailySync') triggerOn = true;
    }
  } catch (e) { triggerOn = false; }
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e2) { url = ''; }
  return {
    today: todayDubai_(),
    nowLabel: whenLabel_(),
    lastSync: getSetting_('lastSync'),
    triggerReady: triggerOn,
    triggerError: getSetting_('triggerError'),
    webAppUrl: url,
    source: dataSource_(),
    clients: readClients_(),
    sessions: sessions,
    charges: readCharges_(),
    settings: phoneSettings_(),
    ignored: readIgnored_()
  };
}

function phoneSettings_() {
  var show = getSetting_('showCommission');
  var comm = PT.normalizeComm({
    quota: getSetting_('quota'),
    netFactor: getSetting_('netFactor'),
    includeCharges: getSetting_('includeCharges') === 'yes',
    showCommission: show === 'no' ? false : true,
    tiers: parseJson_(getSetting_('tiers'), [])
  });
  comm.periods = PT.sortPeriods(parseJson_(getSetting_('periods'), []));
  return comm;
}

function packageFields_(obj) {
  obj = obj || {};
  return {
    mode: obj.mode || '',
    name: clip_(obj.name, 80),
    sessions: obj.sessions,
    sessionsLeft: obj.sessionsLeft,
    value: obj.value,
    startDate: clip_(obj.startDate, 10),
    note: clip_(obj.note, 500)
  };
}

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the PT Planner Google Sheet, choose Extensions, then Apps Script, and deploy that script.');
  return ss;
}

function ensureSheets_() {
  var ss = ss_();
  tab_(ss, 'Clients', CLIENT_HEADERS);
  tab_(ss, 'Sessions', SESSION_HEADERS);
  tab_(ss, 'Charges', CHARGE_HEADERS);
  tab_(ss, 'Settings', SETTING_HEADERS);
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1) {
    var used = false;
    try { used = first.getLastRow() > 0 && String(first.getRange(1, 1).getValue() || '') !== ''; } catch (e) { used = true; }
    if (!used) ss.deleteSheet(first);
  }
}

function tab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sh;
}

function readTable_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h || ''); });
  var out = [], r, c, obj, empty;
  for (r = 1; r < values.length; r++) {
    obj = {};
    empty = true;
    for (c = 0; c < headers.length; c++) {
      obj[headers[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] != null) empty = false;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

function writeTable_(name, headers, rows) {
  var sh = ss_().getSheetByName(name);
  var values = [headers], i, c, line, v;
  for (i = 0; i < rows.length; i++) {
    line = [];
    for (c = 0; c < headers.length; c++) {
      v = rows[i][headers[c]];
      line.push(v == null ? '' : v);
    }
    values.push(line);
  }
  var range = sh.getRange(1, 1, values.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(values);
  var lastRow = values.length, lastCol = headers.length;
  try { if (sh.getLastRow) lastRow = sh.getLastRow(); } catch (e) {}
  try { if (sh.getLastColumn) lastCol = sh.getLastColumn(); } catch (e2) {}
  if (lastRow > values.length) {
    try {
      var extra = sh.getRange(values.length + 1, 1, lastRow - values.length, Math.max(lastCol, headers.length));
      if (extra.clearContent) extra.clearContent();
    } catch (e3) {}
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e5f4ec');
}

function readClients_() {
  return readTable_('Clients').map(function (row) {
    var aliases = parseJson_(row.aliases, []);
    var packages = parseJson_(row.packages, []);
    return PT.migrateClient({
      id: row.id,
      name: row.name,
      aliases: aliases,
      packages: packages,
      packageSessions: row.packageSessions,
      packageValue: row.packageValue,
      startDate: asYmd_(row.startDate)
    });
  }).filter(function (c) { return c && c.name; });
}

function writeClients_(clients) {
  var existing = {};
  try {
    readClients_().forEach(function (c) { if (c && c.id) existing[String(c.id)] = c; });
  } catch (e) { existing = {}; }
  var rows = (clients || []).map(function (c) {
    var prior = c && existing[String(c.id)];
    var clean = prior ? PT.mergeClientRecord(prior, c) : PT.migrateClient(c);
    return {
      id: clean.id,
      name: clean.name,
      aliases: JSON.stringify(clean.aliases || []),
      packages: JSON.stringify(clean.packages || []),
      createdAt: c.createdAt || nowStamp_()
    };
  });
  writeTable_('Clients', CLIENT_HEADERS, rows);
}

function dataSource_() {
  var out = { id: '', name: '', url: '', code: CODE_MARK };
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { return out; }
  if (!ss) return out;
  try { out.id = String(ss.getId() || ''); } catch (e2) {}
  try { out.name = String(ss.getName() || ''); } catch (e3) {}
  try { out.url = String(ss.getUrl() || ''); } catch (e4) {}
  return out;
}

function readBack_(saved) {
  var out = { sessions: '', clients: '', readBack: 'not checked' };
  try {
    var all = readSessionsAll_();
    var have = {}, i, missing = 0, wrote = (saved && saved.sessions) || [];
    out.sessions = all.length;
    out.clients = readClients_().length;
    for (i = 0; i < all.length; i++) have[String(all[i].eventId)] = true;
    for (i = 0; i < wrote.length; i++) {
      if (wrote[i] && wrote[i].eventId && !have[String(wrote[i].eventId)]) missing++;
    }
    out.readBack = missing ? ('missing ' + missing + ' of ' + wrote.length) : 'ok';
  } catch (e) {
    out.readBack = 'failed';
  }
  return out;
}

function stampMail_(mail, extra) {
  var src = dataSource_();
  extra = extra || {};
  var block = [
    'Spreadsheet: ' + (src.name || ''),
    'Spreadsheet id: ' + (src.id || ''),
    'Spreadsheet url: ' + (src.url || ''),
    'Code: ' + src.code,
    'Sessions stored: ' + (extra.sessions == null ? '' : extra.sessions),
    'Clients stored: ' + (extra.clients == null ? '' : extra.clients),
    'Read-back: ' + (extra.readBack || '')
  ].join('\n');
  var parts = String(mail && mail.body || '').split('\n');
  parts.splice(3, 0, block);
  mail.body = parts.join('\n');
  return mail;
}

function readSessionsAll_() {
  return readTable_('Sessions').map(function (row) {
    if (!row.eventId) return null;
    return {
      eventId: String(row.eventId),
      calendarId: String(row.calendarId || ''),
      title: String(row.title || ''),
      clientName: String(row.clientName || ''),
      date: asYmd_(row.date),
      start: asHm_(row.start),
      end: asHm_(row.end),
      allDay: yes_(row.allDay),
      note: String(row.note || ''),
      status: row.status ? String(row.status) : 'normal',
      statusLocked: yes_(row.statusLocked),
      disposition: row.disposition ? String(row.disposition) : 'pending',
      hidden: yes_(row.hidden),
      removed: yes_(row.removed),
      createdAt: row.createdAt ? String(row.createdAt) : ''
    };
  }).filter(function (s) { return !!s; });
}

function writeSessions_(sessions) {
  var rows = (sessions || []).map(function (s) {
    var c = PT.copySession(s);
    return {
      eventId: c.eventId,
      calendarId: c.calendarId,
      title: c.title,
      clientName: c.clientName,
      date: c.date,
      start: c.start,
      end: c.end,
      allDay: c.allDay ? 'yes' : '',
      note: c.note,
      status: c.status,
      statusLocked: c.statusLocked ? 'yes' : '',
      disposition: c.disposition,
      hidden: c.hidden ? 'yes' : '',
      removed: c.removed ? 'yes' : '',
      createdAt: c.createdAt
    };
  });
  writeTable_('Sessions', SESSION_HEADERS, rows);
}

function readCharges_() {
  return PT.migrateCharges(readTable_('Charges').map(function (row) {
    return {
      id: row.id,
      clientId: row.clientId,
      eventId: row.eventId,
      type: row.type,
      amount: row.amount,
      date: asYmd_(row.date),
      notes: row.notes,
      createdAt: row.createdAt ? String(row.createdAt) : ''
    };
  }));
}

function writeCharges_(charges) {
  var rows = PT.migrateCharges(charges).map(function (ch) {
    return {
      id: ch.id,
      clientId: ch.clientId,
      eventId: ch.eventId,
      type: ch.type,
      amount: String(ch.amount),
      date: ch.date,
      notes: ch.notes,
      createdAt: ch.createdAt || nowStamp_()
    };
  });
  writeTable_('Charges', CHARGE_HEADERS, rows);
}

function readIgnored_() {
  return parseJson_(getSetting_('ignored'), []);
}

function writeIgnored_(list) {
  setSetting_('ignored', JSON.stringify(list || []));
}

var settingsCache_ = null;

function settingsMap_() {
  if (settingsCache_) return settingsCache_;
  var map = {};
  readTable_('Settings').forEach(function (row) {
    if (row.key) map[String(row.key)] = row.value == null ? '' : String(row.value);
  });
  settingsCache_ = map;
  return map;
}

function getSetting_(key) {
  var map = settingsMap_();
  return map[key] == null ? '' : map[key];
}

function patchSettings_(pairs) {
  var map = settingsMap_();
  var k;
  for (k in pairs) if (Object.prototype.hasOwnProperty.call(pairs, k)) {
    map[k] = pairs[k] == null ? '' : String(pairs[k]);
  }
  var keys = Object.keys(map);
  var rows = [], i;
  for (i = 0; i < keys.length; i++) rows.push({ key: keys[i], value: map[keys[i]] });
  writeTable_('Settings', SETTING_HEADERS, rows);
}

function setSetting_(key, value) {
  var patch = {};
  patch[key] = value;
  patchSettings_(patch);
}

function mapClient_(clients, id, fn) {
  var found = false;
  var next = clients.map(function (c) {
    if (String(c.id) !== String(id)) return c;
    found = true;
    return fn(c);
  });
  if (!found) throw new Error('That client is not in the planner.');
  return next;
}

function parseJson_(text, fallback) {
  if (text == null || text === '') return fallback;
  if (typeof text === 'object') return text;
  try { return JSON.parse(String(text)); } catch (e) { return fallback; }
}

function yes_(v) {
  return v === true || v === 'yes' || v === 'true' || v === 1 || v === '1';
}

function asYmd_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : (s ? s.slice(0, 10) : '');
}

function asHm_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, TZ, 'HH:mm');
  }
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  var h = m[1].length < 2 ? '0' + m[1] : m[1];
  return h + ':' + m[2];
}

function todayDubai_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
}

function whenLabel_() {
  return nowStamp_() + ' Asia/Dubai';
}

function withWriteLock_(fn) {
  var lock = LockService.getScriptLock();
  // A few seconds covers the sheet write. The calendar read stays outside this lock.
  if (!lock.tryLock(4000)) return null;
  try { return fn(); } finally { lock.releaseLock(); }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) throw new Error('PT Planner is busy. Try again in a moment.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function clip_(s, n) {
  s = String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  if (s.length > n) return s.slice(0, n);
  return s;
}

function padB64_(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return s;
}

function safeJson_(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}
