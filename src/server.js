// Google Apps Script side. Paste together with the rules above, into Code.gs.
var TZ = 'Asia/Dubai';
var CLIENT_HEADERS = ['id', 'name', 'aliases', 'packages', 'createdAt'];
var SESSION_HEADERS = ['eventId', 'calendarId', 'title', 'clientName', 'date', 'start', 'end', 'allDay', 'note', 'status', 'statusLocked', 'disposition', 'hidden', 'removed', 'createdAt'];
var CHARGE_HEADERS = ['id', 'clientId', 'eventId', 'type', 'amount', 'date', 'notes', 'createdAt'];
var SETTING_HEADERS = ['key', 'value'];

function doGet() {
  return HtmlService.createHtmlOutput(appHtml_())
    .setTitle('PT Planner')
    .setFaviconUrl('https://pedrocerdeira81-coder.github.io/Pt-planner/icons/planner-180.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function appHtml_() {
  return HTML_LITERAL;
}

function dailySync() {
  try {
    runSync_({ email: 'trigger' });
  } catch (err) {
    try {
      deliver_(PT.buildDailyEmail({
        ok: false,
        when: whenLabel_(),
        error: String(err && err.message || err)
      }));
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
        deliver_(PT.buildSummary({
          clients: saved.clients || [],
          sessions: saved.sessions || [],
          settings: phoneSettings_()
        }, today, whenLabel_()));
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
        eventId: String(ev.getId()),
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
  sh.clear();
  sh.getRange(1, 1, values.length, headers.length).setNumberFormat('@');
  sh.getRange(1, 1, values.length, headers.length).setValues(values);
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
  var rows = (clients || []).map(function (c) {
    var clean = PT.migrateClient(c);
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
