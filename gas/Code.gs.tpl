/**
 * 성현교회 출석부 — 구글시트 연동 (Google Apps Script)
 *
 * 1) 교인관리용 새 구글시트를 만들고 [확장 프로그램 → Apps Script]를 엽니다.
 * 2) 이 파일 내용을 Code.gs에 붙여넣고, 아래 KEY를 원하는 비밀번호로 바꿉니다.
 * 3) [+ → HTML] 파일을 'index' 이름으로 만들고 renderer/index.html 내용을 붙여넣습니다. (태블릿용)
 * 4) [배포 → 새 배포 → 웹 앱] 실행: 나 / 액세스: 모든 사용자 → 배포 → 웹앱 URL(…/exec) 복사
 * 5) 데스크탑 앱 [설정·데이터]에 URL과 KEY를 넣고 '지금 동기화'.
 *    태블릿은 같은 URL을 브라우저로 열고 KEY를 한 번 입력하면 탭 출석체크가 구글시트에 바로 저장됩니다.
 *
 * 시트 구성: 교인명부 / 출석 / 헌금생활 / 기록 / _설정  (처음 동기화할 때 자동 생성)
 * 헌금생활은 참여 항목만 저장하며 금액은 저장하지 않습니다.
 */
const KEY = '여기에-비밀번호를-입력';

const MEMBER_FIELDS = [
  ['id','ID'],['name','이름'],['gender','성별'],['birth','생년월일'],['lunar','음력'],['phone','연락처'],['address','주소'],
  ['title','직분'],['district','구역'],['society','전도회'],['ministries','봉사활동'],['regDate','등록일'],['baptism','세례구분'],
  ['baptismDate','세례일'],['eduDate','새가족교육이수일'],['status','상태'],['approvedDate','정회원승인일'],['approvalNote','승인근거'],
  ['prevChurch','이전교회'],['family','가족'],['memo','메모'],['updatedAt','수정시각'],['deleted','삭제']
];

/* ---------- 웹앱 진입점 ---------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.action) {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('성현교회 출석부')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (p.key !== KEY) return json_({ ok: false, error: 'key' });
  try {
    if (p.action === 'pull') return json_({ ok: true, data: readAll_() });
    if (p.action === 'offerings') return json_({ ok: true, data: readOfferings_(p.sheetId) });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.key !== KEY) return json_({ ok: false, error: 'key' });
    if (body.action === 'push') return json_({ ok: true, data: pushMerge_(body.data) });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

/* 태블릿 웹앱(google.script.run)용 */
function apiPull(key) { if (key !== KEY) return JSON.stringify({ ok: false, error: '비밀번호가 다릅니다' }); return JSON.stringify({ ok: true, data: readAll_() }); }
function apiPush(key, s) { if (key !== KEY) return JSON.stringify({ ok: false, error: '비밀번호가 다릅니다' }); return JSON.stringify({ ok: true, data: pushMerge_(JSON.parse(s)) }); }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* 받은 데이터를 시트 데이터와 합쳐서(최신 수정 우선) 저장하고 결과를 돌려줌 */
function pushMerge_(incoming) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const merged = mergeData(readAll_(), incoming);
    writeAll_(merged);
    return merged;
  } finally { lock.releaseLock(); }
}

/* ---------- 시트 읽기/쓰기 ---------- */
function sheet_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (header && sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#dcebe3'); }
  return sh;
}
function rows_(sh) {
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, sh.getLastColumn()).getDisplayValues();
}
function write_(sh, header, rows) {
  sh.clearContents();
  const all = [header].concat(rows);
  const rng = sh.getRange(1, 1, all.length, header.length);
  rng.setNumberFormat('@');
  rng.setValues(all);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#dcebe3');
  sh.setFrozenRows(1);
}

function readAll_() {
  const out = { version: 1, settings: {}, members: [], attendance: {}, offerings: {}, logs: [] };
  const mh = MEMBER_FIELDS.map(f => f[1]);
  rows_(sheet_('교인명부', mh)).forEach(r => {
    if (!r[0]) return;
    const m = {};
    MEMBER_FIELDS.forEach((f, i) => { m[f[0]] = r[i] || ''; });
    m.lunar = m.lunar === '음력' || m.lunar === 'TRUE';
    m.deleted = m.deleted === 'Y' || m.deleted === 'TRUE';
    m.ministries = m.ministries ? m.ministries.split(',').map(s => s.trim()).filter(String) : [];
    m.updatedAt = Number(m.updatedAt) || 0;
    out.members.push(m);
  });
  rows_(sheet_('출석', ['날짜', '예배키', '예배', '인원', '출석자ID', '출석자', '수정시각'])).forEach(r => {
    if (!r[0]) return;
    out.attendance[r[0] + '|' + r[1]] = { ids: r[4] ? r[4].split(',').filter(String) : [], t: Number(r[6]) || 0 };
  });
  rows_(sheet_('헌금생활', ['날짜', '교인ID', '이름', '참여항목', '수정시각'])).forEach(r => {
    if (!r[0]) return;
    const o = out.offerings[r[0]] || (out.offerings[r[0]] = { t: Number(r[4]) || 0, recs: {} });
    if (r[1]) o.recs[r[1]] = r[3] ? r[3].split(',').map(s => s.trim()).filter(String) : [];
  });
  rows_(sheet_('기록', ['ID', '교인ID', '이름', '날짜', '구분', '내용', '수정시각', '삭제'])).forEach(r => {
    if (!r[0]) return;
    out.logs.push({ id: r[0], memberId: r[1], date: r[3], type: r[4], text: r[5], t: Number(r[6]) || 0, deleted: r[7] === 'Y' });
  });
  const st = rows_(sheet_('_설정', ['항목', '값']));
  st.forEach(r => { if (r[0] === 'settings') { try { out.settings = JSON.parse(r[1]); } catch (e) {} } });
  return out;
}

function writeAll_(d) {
  const names = {}; (d.members || []).forEach(m => names[m.id] = m.name);
  const svcName = {}; ((d.settings || {}).services || []).forEach(s => svcName[s.key] = s.name);
  const di = x => { const a = (d.settings && d.settings.districts) || []; const i = a.indexOf(x); return i < 0 ? 99 : i; };

  const members = (d.members || []).slice().sort((a, b) => (a.deleted - b.deleted) || (di(a.district) - di(b.district)) || String(a.name).localeCompare(String(b.name), 'ko'));
  write_(sheet_('교인명부'), MEMBER_FIELDS.map(f => f[1]), members.map(m => MEMBER_FIELDS.map(([k]) => {
    if (k === 'lunar') return m.lunar ? '음력' : '양력';
    if (k === 'deleted') return m.deleted ? 'Y' : '';
    if (k === 'ministries') return (m.ministries || []).join(', ');
    return m[k] == null ? '' : String(m[k]);
  })));

  const att = Object.keys(d.attendance || {}).sort().reverse().map(k => {
    const [date, svc] = k.split('|'); const v = d.attendance[k];
    return [date, svc, svcName[svc] || svc, String((v.ids || []).length), (v.ids || []).join(','), (v.ids || []).map(i => names[i] || '?').join(', '), String(v.t || 0)];
  });
  write_(sheet_('출석'), ['날짜', '예배키', '예배', '인원', '출석자ID', '출석자', '수정시각'], att);

  const off = [];
  Object.keys(d.offerings || {}).sort().reverse().forEach(date => {
    const o = d.offerings[date]; const ids = Object.keys(o.recs || {});
    if (!ids.length) off.push([date, '', '', '', String(o.t || 0)]);
    ids.forEach(id => off.push([date, id, names[id] || '', (o.recs[id] || []).join(', '), String(o.t || 0)]));
  });
  write_(sheet_('헌금생활'), ['날짜', '교인ID', '이름', '참여항목', '수정시각'], off);

  write_(sheet_('기록'), ['ID', '교인ID', '이름', '날짜', '구분', '내용', '수정시각', '삭제'],
    (d.logs || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(l => [l.id, l.memberId, names[l.memberId] || '', l.date, l.type, l.text, String(l.t || 0), l.deleted ? 'Y' : '']));

  write_(sheet_('_설정'), ['항목', '값'], [['settings', JSON.stringify(d.settings || {})]]);
}

/* 기존 헌금집계 구글시트에서 '참여 항목'만 추출 (금액은 돌려주지 않음) */
function readOfferings_(sheetId) {
  const ss = SpreadsheetApp.openById(sheetId);
  let out = [];
  ss.getSheets().forEach(sh => { out = out.concat(parseOfferingGrid(sh.getDataRange().getDisplayValues(), '')); });
  return out;
}

/* ---------- 앱과 같은 코드 ---------- */
/*__SHARED__*/
