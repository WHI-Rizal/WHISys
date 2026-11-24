// ---------------------------------------------------------------------
// Import data MANIFEST dari file lama (Google Sheet / Excel / CSV) ke
// sistem. Modul ini cuma berisi fungsi murni (baca file → baris
// terstruktur, lalu cocokin ke booking & Data Master Jamaah). Penulisan
// ke Firestore dilakukan di ManifestImportModal.jsx setelah user
// ngecek pratinjau.
//
// Format yang dibaca: tabel dengan baris header (Name / Nama, Paspor No.,
// F/M, Place of Birth, Date of Birth, Date of Issue, Date of Expiry,
// Issuing Office, Room, Number, Kode Booking, Note — nama kolom
// fleksibel, urutan bebas). Sel yang di-merge (Room/Number/Kode per
// kamar) otomatis diisi ke semua baris yang tergabung.
// ---------------------------------------------------------------------

const HEADER_SYNONYMS = {
  no: ['no', 'nomor', 'urut'],
  name: ['name', 'nama', 'nama lengkap', 'full name', 'nama jamaah', 'nama peserta', 'passenger name', 'nama paspor', 'nama sesuai paspor'],
  code: ['kode', 'kode booking', 'booking code', 'kode rombongan', 'kode grup', 'kode group', 'booking', 'group', 'grup', 'rombongan'],
  passportNumber: ['paspor no', 'passport no', 'no paspor', 'no passport', 'passport number', 'nomor paspor', 'paspor', 'passport', 'passport nomor', 'nomor passport'],
  gender: ['f/m', 'm/f', 'gender', 'jk', 'jenis kelamin', 'sex', 'l/p', 'p/l', 'fm'],
  birthPlace: ['place of birth', 'tempat lahir', 'pob', 'tmpt lahir', 'birth place', 'kota lahir'],
  birthDate: ['date of birth', 'tanggal lahir', 'tgl lahir', 'dob', 'birth date', 'birthdate', 'date of birth dd mmm yyyy'],
  age: ['age', 'umur', 'usia'],
  passportIssueDate: ['date of issue', 'tanggal terbit', 'tgl terbit', 'issue date', 'issued', 'date issued', 'tgl keluar', 'tanggal keluar', 'tanggal dikeluarkan', 'date of issued'],
  passportExpiry: ['date of expiry', 'tanggal expiry', 'expiry', 'expired', 'tgl expired', 'masa berlaku', 'date of expired', 'expiry date', 'tanggal habis', 'expired date', 'tgl habis', 'tanggal expired', 'berlaku sampai'],
  passportIssuingOffice: ['issuing office', 'kantor imigrasi', 'imigrasi', 'place of issue', 'kantor penerbit', 'issuing authority', 'kantor', 'tempat terbit', 'office of issue'],
  room: ['room', 'tipe kamar', 'type', 'room type', 'tipe', 'kamar', 'jenis kamar', 'type room'],
  roomLabel: ['number', 'nomor kamar', 'no kamar', 'room no', 'room number', 'no. kamar', 'room num', 'no room', 'nomor room'],
  note: ['note', 'notes', 'catatan', 'keterangan', 'remark', 'remarks', 'ket'],
};

export const MANIFEST_FIELD_LABELS = {
  name: 'Nama', code: 'Kode Booking', passportNumber: 'Paspor', gender: 'F/M', birthPlace: 'Tempat Lahir',
  birthDate: 'Tgl Lahir', passportIssueDate: 'Tgl Terbit', passportExpiry: 'Tgl Expiry',
  passportIssuingOffice: 'Kantor Imigrasi', room: 'Tipe Kamar', roomLabel: 'Nomor Kamar', note: 'Catatan',
};

const normHeader = (v) => String(v == null ? '' : v)
  .toLowerCase()
  .replace(/[\n\r\t]+/g, ' ')
  .replace(/[().:*#]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const detectField = (cell) => {
  const h = normHeader(cell);
  if (!h) return null;
  for (const [field, list] of Object.entries(HEADER_SYNONYMS)) {
    if (list.includes(h)) return field;
  }
  // cocok sebagian (mis. "Date of Birth (dd-mmm-yyyy)")
  const order = ['passportIssueDate', 'passportExpiry', 'birthDate', 'birthPlace', 'passportIssuingOffice', 'passportNumber', 'roomLabel', 'room', 'name', 'code', 'gender', 'note', 'age'];
  for (const field of order) {
    if (HEADER_SYNONYMS[field].some(s => s.length >= 5 && h.startsWith(s + ' '))) return field;
  }
  return null;
};

// ---------- normalisasi nilai ----------
const MONTHS = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, pebruari: 2, mar: 3, maret: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, nop: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};
const pad = (n) => String(n).padStart(2, '0');
const validYMD = (y, m, d) => y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
const iso = (y, m, d) => (validYMD(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : '');

// kind: 'birth' | 'doc' (terbit/expiry) — cuma buat nebak tahun 2 digit
export const toISODate = (v, kind = 'doc') => {
  if (v === '' || v == null) return '';
  if (v instanceof Date) {
    if (isNaN(v)) return '';
    return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number') {
    if (v > 1000 && v < 80000) { // serial Excel
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return '';
  }
  const s = String(v).trim();
  if (!s || s === '-') return '';
  const fixYear = (yy) => {
    if (yy >= 100) return yy;
    const cur = new Date().getFullYear() % 100;
    if (kind === 'birth') return yy > cur ? 1900 + yy : 2000 + yy;
    return 2000 + yy;
  };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]+([A-Za-z]+)[-/. ,]*(\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) return iso(fixYear(+m[3]), mon, +m[1]);
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let d = +m[1]; let mo = +m[2];
    if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } // ketemu format bulan/tanggal
    return iso(fixYear(+m[3]), mo, d);
  }
  m = s.match(/^([A-Za-z]+)[ ,.-]+(\d{1,2})[ ,.-]+(\d{4})$/); // "Jan 5, 2030"
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return '';
};

export const normGender = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  if (/^(f|p|w|female|perempuan|wanita|cewek|ibu|mrs|ms)/.test(s)) return 'P';
  if (/^(m|l|male|laki|pria|cowok|bapak|mr)/.test(s)) return 'L';
  return '';
};

export const normPassport = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');

const TITLE_TOKENS = new Set(['MR', 'MRS', 'MS', 'MISS', 'MSTR', 'MASTER', 'BAPAK', 'BPK', 'IBU', 'IBUK', 'H', 'HJ', 'HAJI', 'HAJJAH', 'DR', 'DRS', 'IR', 'PROF', 'TN', 'NY', 'NN', 'INF', 'CHD']);
export const nameTokens = (s) => String(s == null ? '' : s)
  .toUpperCase()
  .replace(/\(.*?\)/g, ' ')
  .replace(/[^A-Z0-9 ]/g, ' ')
  .split(/\s+/)
  .filter(t => t && !TITLE_TOKENS.has(t));
export const nameKey = (s) => nameTokens(s).sort().join(' ');

const lev1 = (a, b) => { // true kalau jarak edit <= 1
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};
export const nameScore = (a, b) => {
  const ta = nameTokens(a); const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const used = new Set();
  let hit = 0;
  for (const x of ta) {
    const idx = tb.findIndex((y, k) => !used.has(k) && (x === y || (x.length >= 5 && y.length >= 5 && lev1(x, y))));
    if (idx >= 0) { used.add(idx); hit++; }
  }
  return hit / Math.max(ta.length, tb.length);
};

const TL_RE = /\b(TOUR\s*LEADER|T\/L|TL)\b/i;

// Nama tipe kamar di file → nama tipe kamar sistem (roomTypeNames = daftar nama yang valid)
export const normRoomType = (raw, roomTypeNames = []) => {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { value: '', unknown: false };
  const up = s.toUpperCase().replace(/[^A-Z]/g, '');
  const find = (n) => roomTypeNames.find(x => x.toLowerCase() === n.toLowerCase()) || '';
  const direct = find(s);
  if (direct) return { value: direct, unknown: false };
  const alias = {
    QUAD: 'Quad', QUADRUPLE: 'Quad', QUARD: 'Quad', QUADS: 'Quad',
    TRIPLE: 'Triple', TRP: 'Triple', TRIPLES: 'Triple', TRIPEL: 'Triple',
    DOUBLE: 'Double', DBL: 'Double', TWIN: 'Double', DOUBLETWIN: 'Double', TWINDOUBLE: 'Double', DOUBLES: 'Double',
    SINGLE: 'Single', SGL: 'Single',
  };
  const mapped = alias[up];
  if (mapped) {
    const v = find(mapped);
    if (v) return { value: v, unknown: false };
  }
  return { value: '', unknown: true };
};

// ---------- baca file ----------
export const parseManifestBuffer = ({ buffer, fileName = '', XLSX, roomTypeNames = [] }) => {
  const isCsv = /\.(csv|tsv|txt)$/i.test(fileName);
  let wb;
  if (isCsv) {
    let text = new TextDecoder('utf-8').decode(buffer);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    // Google Sheet export bisa pakai ; (Excel Indonesia) — deteksi pemisah dari baris pertama
    const first = text.split(/\r?\n/).find(l => l.trim()) || '';
    const FS = (first.split(';').length > first.split(',').length && !/\.tsv$/i.test(fileName)) ? ';' : (/\.tsv$/i.test(fileName) ? '\t' : ',');
    wb = XLSX.read(text, { type: 'string', raw: true, FS });
  } else {
    wb = XLSX.read(buffer, { type: 'array' });
  }

  let best = null;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
    // propagasi sel yang di-merge
    (ws['!merges'] || []).forEach(mg => {
      const r0 = mg.s.r - range.s.r; const c0 = mg.s.c - range.s.c;
      const v = (aoa[r0] || [])[c0];
      if (v === '' || v == null) return;
      for (let r = mg.s.r; r <= mg.e.r; r++) {
        for (let c = mg.s.c; c <= mg.e.c; c++) {
          const rr = r - range.s.r; const cc = c - range.s.c;
          if (!aoa[rr]) aoa[rr] = [];
          if (aoa[rr][cc] === '' || aoa[rr][cc] == null) aoa[rr][cc] = v;
        }
      }
    });
    // cari baris header
    let headerRow = -1; let map = null;
    for (let r = 0; r < Math.min(aoa.length, 40); r++) {
      const row = aoa[r] || [];
      const m = {};
      row.forEach((cell, c) => {
        const f = detectField(cell);
        if (f && m[f] === undefined) m[f] = c;
      });
      if (m.name !== undefined && Object.keys(m).length >= 3) { headerRow = r; map = m; break; }
    }
    if (headerRow < 0) continue;
    const score = Object.keys(map).length;
    if (!best || score > best.score) best = { sheetName, aoa, headerRow, map, score, header: aoa[headerRow] };
  }
  if (!best) {
    throw new Error('Baris judul kolom nggak ketemu. Pastikan ada kolom "Name"/"Nama" plus minimal dua kolom lain (Paspor, Tanggal Lahir, Room, dst).');
  }

  const { aoa, headerRow, map } = best;
  const get = (row, f) => (map[f] === undefined ? '' : row[map[f]]);
  const str = (v) => String(v == null ? '' : v).trim();
  const rows = [];
  let skipped = 0;
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    let name = str(get(row, 'name'));
    if (!name) { continue; }
    if (/^(grand\s*total|total|jumlah|sub\s*total)\b/i.test(name)) { skipped++; continue; }
    if (/^(f|m|p|l|room|quad|triple|double|twin)$/i.test(name)) { skipped++; continue; }
    const warnings = [];
    const roomRaw = str(get(row, 'room'));
    const codeRaw = str(get(row, 'code'));
    const noRaw = str(get(row, 'no'));
    let isTL = TL_RE.test(name) || /^(TL|T\/L|TOUR\s*LEADER)$/i.test(roomRaw) || /^(TL|T\/L)$/i.test(codeRaw) || /^(TL|T\/L)$/i.test(noRaw);
    if (isTL) {
      name = name.replace(/\(\s*(TOUR\s*LEADER|T\/L|TL)\s*\)/ig, ' ').replace(/\b(TOUR\s*LEADER|T\/L)\b/ig, ' ').replace(/\s+TL$/i, ' ').replace(/\s+/g, ' ').trim();
    }
    const rt = isTL ? { value: '', unknown: false } : normRoomType(roomRaw, roomTypeNames);
    if (rt.unknown) warnings.push(`Tipe kamar "${roomRaw}" nggak dikenal`);
    const pass = normPassport(get(row, 'passportNumber'));
    const dob = toISODate(get(row, 'birthDate'), 'birth');
    const issue = toISODate(get(row, 'passportIssueDate'), 'doc');
    const exp = toISODate(get(row, 'passportExpiry'), 'doc');
    const chk = (field, raw, parsed) => {
      if (str(raw) && !parsed) warnings.push(`${MANIFEST_FIELD_LABELS[field]} "${str(raw)}" nggak terbaca sebagai tanggal`);
    };
    chk('birthDate', get(row, 'birthDate'), dob);
    chk('passportIssueDate', get(row, 'passportIssueDate'), issue);
    chk('passportExpiry', get(row, 'passportExpiry'), exp);
    const rawGender = str(get(row, 'gender'));
    const gender = normGender(rawGender);
    if (rawGender && !gender) warnings.push(`F/M "${rawGender}" nggak dikenal`);
    rows.push({
      rowNo: r + 1, // nomor baris di file (1-based)
      name,
      isTL,
      code: codeRaw && !/^(TL|T\/L)$/i.test(codeRaw) ? codeRaw : '',
      passportNumber: pass,
      gender,
      birthPlace: str(get(row, 'birthPlace')),
      birthDate: dob,
      passportIssueDate: issue,
      passportExpiry: exp,
      passportIssuingOffice: str(get(row, 'passportIssuingOffice')),
      roomTypeRaw: roomRaw,
      roomType: rt.value,
      roomLabel: str(get(row, 'roomLabel')),
      note: str(get(row, 'note')),
      warnings,
    });
  }

  const mapped = Object.entries(map).filter(([f]) => f !== 'no' && f !== 'age').map(([f, c]) => ({ field: f, label: MANIFEST_FIELD_LABELS[f] || f, header: str(best.header[c]), col: c }));
  const missing = ['passportNumber', 'birthDate', 'passportExpiry', 'room', 'roomLabel', 'code'].filter(f => map[f] === undefined).map(f => MANIFEST_FIELD_LABELS[f] || f);
  return { sheetName: best.sheetName, rows, mapped, missing, skipped };
};

// ---------- pencocokan ----------
// bookings: booking AKTIF di paket tujuan. jamaahList: Data Master Jamaah.
// existingTourLeaders: packages.tourLeaders paket tujuan.
// Status per baris:
//  matched    → ketemu pasti (paspor, atau kode+nama, atau nama persis)
//  similar    → ada kandidat mirip, user wajib pilih
//  jamaah_only→ ada di Data Master tapi belum punya booking di paket ini
//  notfound   → nggak ketemu di mana-mana
export const matchManifestRows = (rows, { bookings = [], jamaahList = [], existingTourLeaders = [] }) => {
  const jamaahById = new Map(jamaahList.map(j => [j.id, j]));
  const jamaahByPass = new Map();
  jamaahList.forEach(j => { const p = normPassport(j.passportNumber); if (p) { if (!jamaahByPass.has(p)) jamaahByPass.set(p, []); jamaahByPass.get(p).push(j); } });
  const bkJamaah = (b) => jamaahById.get(b.jamaahId) || jamaahList.find(j => nameKey(j.fullName) === nameKey(b.jamaahName)) || null;
  const bkCode = (b) => String(b.groupBookingCode || b.bookingCode || '');
  const usedBookings = new Set();
  const usedJamaahTl = new Set();

  const topBookings = (name) => bookings
    .map(b => ({ booking: b, jamaah: bkJamaah(b), score: nameScore(name, b.jamaahName) }))
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const topJamaah = (name) => jamaahList
    .map(j => ({ jamaah: j, score: nameScore(name, j.fullName) }))
    .filter(x => x.score >= 0.66)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return rows.map(row => {
    const key = nameKey(row.name);
    const passMatches = row.passportNumber ? (jamaahByPass.get(row.passportNumber) || []) : [];

    // ---- Tour Leader: cocokin ke Data Master Jamaah aja ----
    if (row.isTL) {
      let jm = null; let reason = '';
      if (passMatches.length === 1) { jm = passMatches[0]; reason = 'paspor sama'; }
      if (!jm) { const ex = jamaahList.filter(j => nameKey(j.fullName) === key); if (ex.length === 1) { jm = ex[0]; reason = 'nama sama persis'; } }
      if (jm && !usedJamaahTl.has(jm.id)) {
        usedJamaahTl.add(jm.id);
        const already = existingTourLeaders.some(t => t.jamaahId === jm.id);
        return { row, status: 'matched', kind: 'tl', jamaah: jm, booking: null, reason: `${reason}${already ? ' (sudah jadi TL di paket ini)' : ''}`, candidates: [] };
      }
      const cands = topJamaah(row.name).map(c => ({ type: 'jamaah', ...c }));
      if (cands.length) return { row, status: 'similar', kind: 'tl', jamaah: null, booking: null, reason: 'nama mirip', candidates: cands };
      return { row, status: 'notfound', kind: 'tl', jamaah: null, booking: null, reason: 'belum ada di Data Master Jamaah', candidates: [] };
    }

    // ---- Jamaah biasa ----
    const pick = (b, reason) => {
      if (usedBookings.has(b.id)) {
        return { row, status: 'similar', kind: 'booking', jamaah: bkJamaah(b), booking: null, reason: 'booking ini sudah dipakai baris lain di file', candidates: [{ type: 'booking', booking: b, jamaah: bkJamaah(b), score: 1 }] };
      }
      usedBookings.add(b.id);
      return { row, status: 'matched', kind: 'booking', jamaah: bkJamaah(b), booking: b, reason, candidates: [] };
    };

    // 1. paspor
    if (passMatches.length === 1) {
      const jm = passMatches[0];
      const b = bookings.find(x => !usedBookings.has(x.id) && (x.jamaahId === jm.id || nameKey(x.jamaahName) === nameKey(jm.fullName)));
      if (b) return pick(b, 'paspor sama');
      const any = bookings.find(x => x.jamaahId === jm.id || nameKey(x.jamaahName) === nameKey(jm.fullName));
      if (any) return pick(any, 'paspor sama');
      return { row, status: 'jamaah_only', kind: 'jamaah', jamaah: jm, booking: null, reason: 'paspor sama, tapi belum punya booking di paket ini', candidates: [] };
    }
    // 2. kode + nama
    if (row.code) {
      const inCode = bookings.filter(b => bkCode(b).toUpperCase() === row.code.toUpperCase());
      const exact = inCode.filter(b => nameKey(b.jamaahName) === key && !usedBookings.has(b.id));
      if (exact.length === 1) return pick(exact[0], 'kode booking + nama sama');
    }
    // 3. nama persis
    const exactAll = bookings.filter(b => nameKey(b.jamaahName) === key);
    if (exactAll.length === 1) return pick(exactAll[0], 'nama sama persis');
    if (exactAll.length > 1) {
      const free = exactAll.filter(b => !usedBookings.has(b.id));
      const byCode = row.code ? free.filter(b => bkCode(b).toUpperCase() === row.code.toUpperCase()) : [];
      if (byCode.length === 1) return pick(byCode[0], 'nama sama, kode cocok');
      return { row, status: 'similar', kind: 'booking', jamaah: null, booking: null, reason: 'ada beberapa jamaah bernama sama di paket ini', candidates: exactAll.map(b => ({ type: 'booking', booking: b, jamaah: bkJamaah(b), score: 1 })) };
    }
    // 4. mirip di booking paket
    const sim = topBookings(row.name).filter(x => x.score >= 0.66);
    if (sim.length) return { row, status: 'similar', kind: 'booking', jamaah: null, booking: null, reason: 'nama mirip tapi nggak persis', candidates: sim.map(c => ({ type: 'booking', ...c })) };
    // 5. ada di Data Master tapi belum booking
    const exJ = jamaahList.filter(j => nameKey(j.fullName) === key);
    if (exJ.length === 1) return { row, status: 'jamaah_only', kind: 'jamaah', jamaah: exJ[0], booking: null, reason: 'ada di Data Master, belum punya booking di paket ini', candidates: [] };
    if (exJ.length > 1) return { row, status: 'similar', kind: 'jamaah', jamaah: null, booking: null, reason: 'ada beberapa jamaah bernama sama di Data Master', candidates: exJ.map(j => ({ type: 'jamaah', jamaah: j, score: 1 })) };
    const jc = topJamaah(row.name).map(c => ({ type: 'jamaah', ...c }));
    if (jc.length) return { row, status: 'similar', kind: 'jamaah', jamaah: null, booking: null, reason: 'mirip dengan data di Data Master Jamaah', candidates: jc };
    return { row, status: 'notfound', kind: 'jamaah', jamaah: null, booking: null, reason: 'nggak ketemu di paket ini maupun Data Master', candidates: [] };
  });
};

// ---------- rencana update ----------
const JAMAAH_FIELDS = ['passportNumber', 'birthPlace', 'birthDate', 'passportIssueDate', 'passportExpiry', 'passportIssuingOffice', 'gender'];
export const JAMAAH_FIELD_LABELS = {
  passportNumber: 'Paspor', birthPlace: 'Tempat lahir', birthDate: 'Tgl lahir', passportIssueDate: 'Tgl terbit',
  passportExpiry: 'Tgl expiry', passportIssuingOffice: 'Kantor imigrasi', gender: 'F/M',
};
const sameVal = (field, a, b) => {
  if (field === 'passportNumber') return normPassport(a) === normPassport(b);
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
};

// Hitung perubahan apa saja yang akan ditulis ke dokumen jamaah.
// existing = dokumen jamaah (atau {} buat jamaah baru). overwrite = timpa yang udah terisi.
export const buildJamaahPatch = (row, existing = {}, overwrite = false) => {
  const patch = {}; const conflicts = []; const fills = [];
  JAMAAH_FIELDS.forEach(f => {
    const incoming = row[f];
    if (!incoming) return;
    const cur = existing[f];
    if (!cur) { patch[f] = incoming; fills.push(f); return; }
    if (sameVal(f, cur, incoming)) return;
    conflicts.push({ field: f, current: cur, incoming });
    if (overwrite) patch[f] = incoming;
  });
  return { patch, conflicts, fills };
};

export const buildBookingPatch = (row, existing = {}, overwrite = false) => {
  const patch = {}; const conflicts = [];
  const setIf = (f, incoming, label) => {
    if (!incoming) return;
    const cur = existing[f];
    if (!cur) { patch[f] = incoming; return; }
    if (String(cur).trim().toUpperCase() === String(incoming).trim().toUpperCase()) return;
    conflicts.push({ field: f, label, current: cur, incoming });
    if (overwrite) patch[f] = incoming;
  };
  setIf('roomType', row.roomType, 'Tipe kamar');
  setIf('roomLabel', row.roomLabel, 'Nomor kamar');
  setIf('manifestNote', row.note, 'Catatan');
  return { patch, conflicts };
};
