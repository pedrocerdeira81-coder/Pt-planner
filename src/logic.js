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
  function inPeriod(d, period, today) {
    if (!d) return false;
    var date = String(d).slice(0, 10);
    if (!period || !period.start || !period.end) return date.slice(0, 7) === String(today || '').slice(0, 7);
    return date >= String(period.start) && date <= String(period.end);
  }
  function getTier(n) {
    n = Number(n) || 0;
    if (n >= 120) return 0.70;
    if (n >= 101) return 0.65;
    if (n >= 81) return 0.60;
    return 0.45;
  }
  function getTierLabel(n) {
    n = Number(n) || 0;
    if (n >= 120) return '120+ · 70%';
    if (n >= 101) return '101-119 · 65%';
    if (n >= 81) return '81-100 · 60%';
    return 'Up to 80 · 45%';
  }
  function normalizePackage(p, fallbackId) {
    p = p || {};
    var sessions = (p.sessions != null && p.sessions !== '') ? p.sessions : p.packageSessions;
    var value = (p.value != null && p.value !== '') ? p.value : p.packageValue;
    return {
      id: p.id ? String(p.id) : String(fallbackId || uid()),
      sessions: asAmountString(sessions),
      value: asAmountString(value),
      startDate: p.startDate ? String(p.startDate).slice(0, 10) : ''
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
      packages.push({
        id: String(list[i].id),
        sessions: String(list[i].sessions),
        value: String(list[i].value),
        startDate: list[i].startDate || ''
      });
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
        startDate: c.startDate
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
      netFactor: c.netFactor != null && c.netFactor !== '' ? String(c.netFactor) : '81.63',
      includeCharges: !!c.includeCharges,
      showCommission: c.showCommission === false ? false : true
    };
  }
  function normalizePeriod(p) {
    p = p || {};
    return { start: p.start ? String(p.start).slice(0, 10) : '', end: p.end ? String(p.end).slice(0, 10) : '' };
  }
  function resolvedNetFactor(comm) {
    var n = Number(comm && comm.netFactor);
    if (!n) n = 81.63;
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
    var netRevenue = totalRevenue * resolvedNetFactor(comm);
    var quota = resolvedQuota(comm);
    var commRevenue = Math.max(0, netRevenue - quota);
    return {
      totalRevenue: totalRevenue,
      netRevenue: netRevenue,
      quota: quota,
      netFactor: resolvedNetFactor(comm) * 100,
      commRevenue: commRevenue,
      commission: commRevenue * getTier(sessionCount),
      tierLabel: getTierLabel(sessionCount),
      sessionCount: sessionCount,
      sessionRevenue: sessionRevenue,
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
  function currentRemaining(client, sessions, allClients) {
    var pkg = currentPackage(client && client.packages);
    var total = pkg ? (Number(pkg.sessions) || 0) : 0;
    var used = packageUsed(client, sessions, pkg, allClients || [client]);
    var remaining = total - used;
    var per = sessionRate(pkg);
    return {
      used: used,
      total: total,
      remaining: remaining,
      perSession: per,
      remainingValue: remaining * per,
      low: remaining > 0 && remaining <= LOW_AT,
      out: remaining <= 0,
      packageId: pkg ? pkg.id : '',
      value: pkg ? Number(pkg.value || 0) : 0,
      startDate: pkg ? pkg.startDate : ''
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
    var pkg = normalizePackage({ id: uid(), sessions: sessions, value: fields.value, startDate: start });
    var packages = (client.packages || []).concat([pkg]);
    return withLegacy({ id: client.id, name: client.name, aliases: client.aliases || [], packages: packages });
  }
  function updateCurrentPackage(client, fields) {
    var packages = (client.packages && client.packages.length) ? client.packages : [normalizePackage({
      sessions: '', value: '', startDate: ''
    }, String(client.id || 'c') + '-pkg1')];
    var cur = currentPackage(packages);
    var nextPkgs = [], i;
    for (i = 0; i < packages.length; i++) {
      if (String(packages[i].id) !== String(cur.id)) { nextPkgs.push(packages[i]); continue; }
      nextPkgs.push(normalizePackage({
        id: packages[i].id,
        sessions: fields.sessions,
        value: fields.value,
        startDate: fields.startDate
      }, packages[i].id));
    }
    return withLegacy({ id: client.id, name: client.name, aliases: client.aliases || [], packages: nextPkgs });
  }
  function createClient(clients, fields) {
    var name = collapseSpace(fields && fields.name);
    assertClientName(clients, name);
    var sessions = fields.sessions;
    if (sessions == null || sessions === '' || !(Number(sessions) > 0)) throw new Error('Add the number of sessions.');
    var client = migrateClient({
      id: fields.id || uid(),
      name: name,
      packageSessions: sessions,
      packageValue: fields.value || 0,
      startDate: fields.startDate || '',
      aliases: []
    });
    return (clients || []).concat([client]);
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
  function parseTitle(title) {
    var trimmed = collapseSpace(title).replace(/[.。]+$/g, '').trim();
    if (!trimmed) return { display: '', key: '', explicit: false };
    var m = trimmed.match(/^(.*?)(?:\s*[-–—|:]\s*|\s+)pt$/i);
    if (m && collapseSpace(m[1])) {
      var display = collapseSpace(m[1]);
      return { display: display, key: normName(display), explicit: true };
    }
    return { display: trimmed, key: normName(trimmed), explicit: false };
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
      status: guessStatus(ev.note),
      statusLocked: false,
      disposition: 'pending',
      hidden: false,
      removed: false,
      createdAt: stamp || ''
    };
  }
  function applySync(prevSessions, events, ctx) {
    ctx = ctx || {};
    var byId = {}, i, list = prevSessions || [];
    for (i = 0; i < list.length; i++) {
      if (!list[i] || !list[i].eventId) continue;
      byId[String(list[i].eventId)] = copySession(list[i]);
    }
    var seen = {}, added = [], unique = [], seenEv = {};
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
      seen[id] = true;
      var parsed = parseTitle(ev.title);
      if (!parsed.key || parsed.key === 'pt' || parsed.key.length < 2) continue;
      if (isBuiltinIgnore(parsed.key)) continue;
      var prev = byId[id];
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
      var hits = clientsForName(ctx.clients, parsed.display);
      var explicit = parsed.explicit;
      var nameLike = looksLikeClientName(parsed.display) && !isStoplist(parsed.key);
      if (!explicit && hits.length === 0 && !nameLike) continue;
      if (!explicit && isStoplist(parsed.key) && hits.length === 0) continue;
      var disposition = hits.length === 1 ? 'kept' : 'pending';
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
      if (!prev.statusLocked) prev.status = guessStatus(prev.note);
      if (prev.disposition === 'kept' && !prev.hidden && !wasKept) added.push(prev);
    }
    var start = ctx.windowStart || '';
    var end = ctx.windowEnd || '';
    var ids = [], k;
    for (k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) ids.push(k);
    for (i = 0; i < ids.length; i++) {
      var s = byId[ids[i]];
      if (seen[s.eventId]) continue;
      if (start && end && s.date >= start && s.date <= end) s.removed = true;
    }
    var sessions = [];
    for (i = 0; i < ids.length; i++) sessions.push(byId[ids[i]]);
    sessions.sort(compareSessions);
    added.sort(compareSessions);
    return { sessions: sessions, added: added };
  }
  function summaryAdded(sessions, today) {
    var cutoff = addDaysYmd(today, -1);
    var out = [], list = sessions || [], i, s, created;
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (!s || s.disposition !== 'kept' || isYes(s.hidden) || isYes(s.removed)) continue;
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
      if (s.date && s.date < cutoff) n++;
    }
    return n;
  }
  function lowClients(clients, sessions) {
    var out = [], list = clients || [], i, stats;
    for (i = 0; i < list.length; i++) {
      stats = currentRemaining(list[i], sessions, list);
      if (!(stats.low || stats.out)) continue;
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
      if (!s || isYes(s.removed) || isYes(s.hidden) || s.disposition === 'ignored') continue;
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
    lines.push('');
    var unmatched = report.unmatched || [];
    lines.push('Unmatched names: ' + unmatched.length);
    pushCapped(lines, unmatched, function (u) {
      var noun = u.count === 1 ? ' session' : ' sessions';
      return u.label + ' | ' + u.count + noun + (u.ambiguous ? ' | needs a choice' : '');
    });
    return { subject: EMAIL_SUBJECT, to: SUMMARY_EMAIL, body: lines.join('\n') };
  }
  function buildSummary(state, today, whenLabel) {
    state = state || {};
    var sessions = state.sessions || [];
    var clients = state.clients || [];
    return buildDailyEmail({
      ok: true,
      when: whenLabel || (today + ' Asia/Dubai'),
      added: summaryAdded(sessions, today),
      olderSaved: olderSavedToday(sessions, today),
      low: lowClients(clients, sessions),
      flagged: flaggedSoon(sessions, today),
      unmatched: unmatchedFromSessions(sessions, clients)
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
    getTier: getTier,
    getTierLabel: getTierLabel,
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

if (typeof module !== 'undefined' && module.exports) module.exports = PT;
