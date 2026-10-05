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
 * 교인명부 탭에는 직접 입력·붙여넣기 가능 (ID·수정시각·삭제 칸은 비워 두면 자동 기록, 상태가 비면 '준회원', 예전 '재적'도 준회원으로 처리)
 * 헌금생활은 참여 항목만 저장하며 금액은 저장하지 않습니다.
 */
const KEY = '여기에-비밀번호를-입력';
// 웹앱 '관리 화면' 비밀번호 (태블릿 모드 → 전체 메뉴). 실제 값은 Apps Script 편집기에서만 바꿉니다.
const ADMIN_PW = '여기에-관리자-비밀번호를-입력';

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
    const out = HtmlService.createHtmlOutputFromFile('index')
      .setTitle('성현교회 출석부')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    // 홈 화면에 추가했을 때 주소창 없이 앱처럼 열리도록 (허용되지 않는 태그는 건너뜀)
    [['apple-mobile-web-app-capable', 'yes'], ['mobile-web-app-capable', 'yes'],
     ['apple-mobile-web-app-title', '성현교회 출석부'], ['apple-mobile-web-app-status-bar-style', 'black-translucent']]
      .forEach(t => { try { out.addMetaTag(t[0], t[1]); } catch (err) {} });
    return out;
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

function apiAdmin(key, pw) {
  if (key !== KEY) return JSON.stringify({ ok: false, error: '비밀번호가 다릅니다' });
  return JSON.stringify({ ok: String(pw || '') === ADMIN_PW && ADMIN_PW.indexOf('여기에') !== 0 });
}

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

/* ---------- 교인명부: 시트에서 직접 입력한 줄도 받아들임 ---------- */
// 열 순서가 바뀌어도 머리글 이름으로 찾음. ID가 없으면 만들어 시트에 바로 기록.
function memberCols_(sh) {
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0].map(h => String(h).trim());
  const col = {};
  MEMBER_FIELDS.forEach(([k, label]) => { const i = head.indexOf(label); if (i >= 0) col[k] = i; });
  return { head, col };
}
function normDate_(v) {
  v = String(v || '').trim();
  if (!v) return '';
  let m = v.match(/^(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (!m) m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  return v;
}
function normBirth_(v) {
  // 생일: 전체(1976-09-15) · 월일(09-15) · 월만(09) 허용
  v = String(v || '').trim();
  if (!v) return '';
  const p2 = x => ('0' + x).slice(-2);
  let m = v.match(/^(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/) || v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]);
  m = v.match(/^(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})\s*일?$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return p2(m[1]) + '-' + p2(m[2]);
  m = v.match(/^(\d{1,2})\s*월?$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return p2(m[1]);
  return v;
}
function normDist_(v) {
  // '3', '3 구역', '3구' → '3구역'
  v = String(v == null ? '' : v).trim();
  const m = v.match(/^(\d+)\s*(구역|구)?$/);
  return m ? m[1] + '구역' : v;
}
function normPhone_(v) {
  let d = String(v || '').replace(/[^\d]/g, '');
  if (!d) return String(v || '').trim();
  if (d.length === 10 && d.charAt(0) === '1') d = '0' + d;
  if (d.length === 11 && d.indexOf('010') === 0) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  return String(v).trim();
}
function readMembers_() {
  const sh = sheet_('교인명부', MEMBER_FIELDS.map(f => f[1]));
  const n = sh.getLastRow();
  if (n < 2) return [];
  const { col } = memberCols_(sh);
  if (col.name == null) return [];
  const vals = sh.getRange(2, 1, n - 1, sh.getLastColumn()).getDisplayValues();
  const out = [];
  const now = Date.now();
  vals.forEach((r, i) => {
    const get = k => (col[k] == null ? '' : String(r[col[k]] || '').trim());
    const name = get('name');
    if (!name) return;
    let id = get('id'), upd = Number(get('updatedAt')) || 0;
    if (!id) {
      id = 's' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
      upd = now;
      if (col.id != null) sh.getRange(i + 2, col.id + 1).setNumberFormat('@').setValue(id);
      if (col.updatedAt != null) sh.getRange(i + 2, col.updatedAt + 1).setNumberFormat('@').setValue(String(upd));
    }
    const m = {};
    MEMBER_FIELDS.forEach(([k]) => { m[k] = get(k); });
    m.id = id;
    m.name = name.replace(/\s+/g, '');
    m.updatedAt = upd;
    ['regDate', 'baptismDate', 'eduDate', 'approvedDate'].forEach(k => { m[k] = normDate_(m[k]); });
    m.birth = normBirth_(m.birth);
    m.phone = normPhone_(m.phone);
    m.district = normDist_(m.district);
    m.lunar = /음|TRUE|Y/i.test(m.lunar);
    m.deleted = /^(Y|TRUE|삭제)$/i.test(m.deleted);
    m.ministries = m.ministries ? m.ministries.split(/[,、·\/]/).map(s => s.trim()).filter(String) : [];
    if (!m.status || m.status === '재적') m.status = '준회원';
    if (m.gender) m.gender = /여|F/i.test(m.gender) ? '여' : /남|M/i.test(m.gender) ? '남' : m.gender;
    out.push(m);
  });
  return out;
}

/* 시트에서 교인명부를 직접 고치면 수정시각을 기록 → 다음 동기화 때 시트 내용이 우선 */
function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    if (sh.getName() !== '교인명부' || e.range.getLastRow() < 2) return;
    const { col } = memberCols_(sh);
    if (col.updatedAt == null) return;
    const top = Math.max(2, e.range.getRow()), bottom = e.range.getLastRow();
    const editedCols = [];
    for (let c = e.range.getColumn(); c <= e.range.getLastColumn(); c++) editedCols.push(c - 1);
    if (editedCols.every(c => c === col.updatedAt || c === col.id)) return;
    const stamp = String(Date.now());
    const rng = sh.getRange(top, col.updatedAt + 1, bottom - top + 1, 1);
    rng.setNumberFormat('@').setValues(Array(bottom - top + 1).fill([stamp]));
  } catch (err) { /* 무시 */ }
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
  out.members = readMembers_();
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
function mergeData(a,b){
  a=a||{};b=b||{};const out={version:1};
  const real=x=>x&&x.updatedAt!==1&&x.t!==1; /* 예시 데이터(수정시각 1)는 동기화하지 않음 */
  const sa=a.settings||{},sb=b.settings||{};
  out.settings=Object.assign({},(sb.updatedAt||0)>(sa.updatedAt||0)?sb:sa);
  const mm={};[].concat(a.members||[],b.members||[]).forEach(m=>{if(!real(m)||!m.id)return;const c=mm[m.id];if(!c||(m.updatedAt||0)>(c.updatedAt||0))mm[m.id]=m});
  out.members=Object.keys(mm).map(k=>mm[k]);
  ['attendance','offerings'].forEach(f=>{out[f]={};[a[f]||{},b[f]||{}].forEach(o=>Object.keys(o).forEach(k=>{if(!real(o[k]))return;const c=out[f][k];if(!c||(o[k].t||0)>(c.t||0))out[f][k]=o[k]}))});
  const ll={};[].concat(a.logs||[],b.logs||[]).forEach(l=>{if(!real(l)||!l.id)return;const c=ll[l.id];if(!c||(l.t||0)>(c.t||0))ll[l.id]=l});
  out.logs=Object.keys(ll).map(k=>ll[k]);
  return out;
}

function parseOfferingGrid(grid,fallbackDate){
  const out=[];let date=fallbackDate||'';let cols=null;
  const SKIPH=/^(no\.?|번호|이름|성명|합계|계|총계|소계|내용|비고)$/i;
  const SKIPN=/(합계|소계|총계|담당|비고|확인|^계$|^no\.?$)/i;
  const num=v=>{const n=parseFloat(String(v).replace(/[^\d.\-]/g,''));return isNaN(n)?0:n};
  for(const row of grid){
    const cells=(row||[]).map(c=>String(c==null?'':c).trim());
    const filled=cells.filter(Boolean);
    if(!filled.length)continue;
    const nameIdx=cells.findIndex(c=>/^(이름|성명)$/.test(c.replace(/\s/g,'')));
    if(nameIdx>=0){cols={name:nameIdx,cats:[]};cells.forEach((c,i)=>{const k=c.replace(/\s/g,'');if(i!==nameIdx&&k&&!SKIPH.test(k))cols.cats.push([i,k])});continue}
    const dm=filled.join(' ').match(/(20\d{2})\s*[년.\-\/]\s*(\d{1,2})\s*[월.\-\/]\s*(\d{1,2})/);
    if(dm&&filled.length<=3){date=`${dm[1]}-${String(dm[2]).padStart(2,'0')}-${String(dm[3]).padStart(2,'0')}`;cols=null;continue}
    if(!cols||!date)continue;
    const name=(cells[cols.name]||'').replace(/\s/g,'');
    if(!name||SKIPN.test(name)||/^무명/.test(name)||/^\d+$/.test(name))continue;
    const cats=cols.cats.filter(([i])=>num(cells[i])>0).map(c=>c[1]);
    if(cats.length)out.push({date,name,cats});
  }
  return out;
}

