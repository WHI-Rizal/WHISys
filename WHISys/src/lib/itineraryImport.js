// Import itinerary dari file Word (.docx) buatan tim Operasional.
// Tanpa library tambahan: .docx itu file zip, jadi dibaca langsung pakai
// DecompressionStream bawaan browser (Chrome/Edge/Safari modern), lalu teks
// dari word/document.xml diparse pakai aturan (rule-based) di parseItineraryText.

const MAX_DOCX_BYTES = 8 * 1024 * 1024;

const decodeEntities = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, '&');

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Ambil isi satu file di dalam zip (cuma butuh word/document.xml).
async function readZipEntry(buf, wantedName) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('File bukan .docx yang valid.');
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (name === wantedName) {
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = u8.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error('Format kompresi .docx nggak didukung.');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('Isi dokumen Word nggak ditemukan.');
}

export function docxXmlToLines(xml) {
  const text = decodeEntities(
    xml
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<w:cr[^>]*\/>/g, '\n')
      .replace(/<w:tab[^>]*\/>/g, ' ')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
  );
  return text.split('\n');
}

async function readDocxXml(file) {
  if (!file) throw new Error('File belum dipilih.');
  if (!/\.docx$/i.test(file.name || '')) throw new Error('Format file harus .docx (Word).');
  if (file.size > MAX_DOCX_BYTES) throw new Error('Ukuran file terlalu besar (maksimal 8 MB).');
  if (typeof DecompressionStream === 'undefined') throw new Error('Browser ini belum mendukung baca file Word. Pakai Chrome atau Edge versi terbaru.');
  const buf = await file.arrayBuffer();
  const bytes = await readZipEntry(buf, 'word/document.xml');
  return new TextDecoder('utf-8').decode(bytes);
}

export async function readDocxLines(file) {
  return docxXmlToLines(await readDocxXml(file));
}

// ---------- Parser teks ----------

const MONTHS = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12
};
const monthNum = (w) => MONTHS[String(w || '').toLowerCase().replace(/\./g, '')] || 0;
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dmyToIso = (s) => {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? iso(m[3], Number(m[2]), Number(m[1])) : '';
};
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const fixTime = (t) => {
  const m = String(t || '').match(/(\d{1,2})[:.](\d{2})/);
  return m ? `${pad(m[1])}:${m[2]}` : '';
};
const tidy = (s) => s.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const stripDecor = (s) => s
  .replace(/[\u{1F000}-\u{1FFFF}☀-➿️​]/gu, '')
  .replace(/\*/g, '')
  .replace(/ /g, ' ')
  .trim();

function parsePeriode(text) {
  const t = text.replace(/[–—]/g, '-');
  let m = t.match(/(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})\s*-\s*(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})/);
  if (m && monthNum(m[2]) && monthNum(m[5])) return { start: iso(m[3], monthNum(m[2]), m[1]), end: iso(m[6], monthNum(m[5]), m[4]) };
  m = t.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})/);
  if (m && monthNum(m[3])) return { start: iso(m[4], monthNum(m[3]), m[1]), end: iso(m[4], monthNum(m[3]), m[2]) };
  m = t.match(/(\d{1,2})\s+([A-Za-z.]+)\s*-\s*(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})/);
  if (m && monthNum(m[2]) && monthNum(m[4])) {
    const endY = Number(m[5]);
    const startY = monthNum(m[2]) > monthNum(m[4]) ? endY - 1 : endY;
    return { start: iso(startY, monthNum(m[2]), m[1]), end: iso(endY, monthNum(m[4]), m[3]) };
  }
  return null;
}

function normMeals(raw) {
  if (!raw) return '';
  const map = { B: 'Breakfast', L: 'Lunch', D: 'Dinner' };
  return raw.split('/').map((x) => x.trim()).filter((x) => x && x !== '-')
    .map((x) => map[x.toUpperCase()] || x).join(', ');
}

function parseMoneyLine(line) {
  const l = line.replace(/^[•\-•\d.)\s]+(?=[A-Za-z])/, '').trim();
  const mm = l.match(/(?:Rp\.?|IDR\.?)?\s*(\d{1,3}(?:\.\d{3})+|\d{4,})/i);
  if (!mm) return { label: tidy(l).replace(/[:\s]+$/, ''), amount: '', note: '' };
  const before = l.slice(0, mm.index).replace(/(?:Rp\.?|IDR\.?)\s*$/i, '');
  const after = l.slice(mm.index + mm[0].length);
  return {
    label: tidy(before).replace(/[:\-\s]+$/, ''),
    amount: Number(mm[1].replace(/\./g, '')),
    note: tidy(after)
  };
}

export function parseItineraryText(rawLinesInput) {
  const warnings = [];
  // Template Import Itinerary WHI: semua teks DI ATAS baris "=== MULAI ITINERARY ==="
  // (petunjuk pengisian) diabaikan, dan baris yang diawali "//" dianggap catatan
  // pribadi. File Word lama tanpa penanda tetap dibaca seperti biasa.
  let rawLines = rawLinesInput;
  const startIdx = rawLinesInput.findIndex((l) => /^\s*={3,}\s*mulai/i.test(l));
  if (startIdx >= 0) rawLines = rawLinesInput.slice(startIdx + 1);
  rawLines = rawLines.filter((l) => !/^\s*\/\//.test(l));
  const lines = rawLines.map(stripDecor);
  const nonEmpty = lines.filter(Boolean);

  // ---- Judul ----
  let name = '';
  for (const l of nonEmpty) {
    if (/^periode/i.test(l)) break;
    if (/^\(.*\)$/.test(l) || /^start\b/i.test(l)) continue;
    name = tidy(l);
    break;
  }
  if (!name) warnings.push('Judul paket nggak terbaca, isi manual.');

  // ---- Periode ----
  let periode = null;
  for (const l of nonEmpty) {
    const m = l.match(/^periode\s*:?\s*(.+)$/i);
    if (m) { periode = parsePeriode(m[1]); break; }
  }

  // ---- Harga ----
  let priceMain = 0;
  for (const l of nonEmpty) {
    const m = l.match(/^(?:IDR|Rp)\.?\s*([\d.]+)\s*\/?\s*pax/i);
    if (m) { priceMain = Number(m[1].replace(/\./g, '')); break; }
  }

  // ---- Maskapai ----
  let airline = '';
  const fi = nonEmpty.findIndex((l) => /^flight\s*by/i.test(l));
  if (fi >= 0) {
    const same = nonEmpty[fi].replace(/^flight\s*by\s*:?\s*/i, '').trim();
    airline = tidy(same || nonEmpty[fi + 1] || '');
  }

  // ---- Flight ----
  const flightSegments = [];
  const flightRe = /(\d{1,2}\/\d{1,2}\/\d{4})\s*:?\s*([A-Z0-9]{2}\s?\d{1,4})\s+([A-Z]{3})\s*-\s*([A-Z]{3})\s+(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/;
  for (const l of nonEmpty) {
    const m = l.replace(/[–—]/g, '-').match(flightRe);
    if (m) flightSegments.push({ flightNumber: m[2].replace(/\s+/, ' '), date: dmyToIso(m[1]), route: `${m[3]} - ${m[4]}`, depTime: fixTime(m[5]), arrTime: fixTime(m[6]) });
  }
  if (!flightSegments.length && !/^la\b|la\s*only|tanpa\s*tiket/i.test(airline)) warnings.push('Jadwal flight nggak terbaca, isi manual di Rincian Penerbangan.');

  // ---- Bagi bagian ----
  const idxItin = lines.findIndex((l) => /^itinerary\b/i.test(l));
  const idxInc = lines.findIndex((l) => /^include\b/i.test(l));
  const idxExc = lines.findIndex((l) => /^exclude\b/i.test(l));
  const firstDay = lines.findIndex((l) => /^DAY\s*\d+/i.test(l));
  const itinStart = idxItin >= 0 ? idxItin + 1 : firstDay;
  // Template Private Trip: blok HARGA (harga per opsi, kurs, ketentuan) ada setelah itinerary.
  const idxHarga = lines.findIndex((l) => /^harga(\s+paket)?\s*:?\s*$/i.test(l));
  const itinEnd = [idxInc, idxExc, idxHarga].filter((x) => x > itinStart).sort((a, b) => a - b)[0] ?? lines.length;

  // ---- Itinerary per hari ----
  const days = [];
  const notes = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const desc = cur.lines.filter(Boolean);
    let title = '';
    if (desc.length && !/^[•\-]/.test(desc[0])) {
      const letters = desc[0].replace(/[^A-Za-z]/g, '');
      const upper = letters.replace(/[^A-Z]/g, '').length;
      if (letters.length && upper / letters.length >= 0.7) title = tidy(desc.shift());
    }
    const hotelLine = desc.find((x) => /bermalam di/i.test(x));
    const hotel = hotelLine ? 'Bermalam di ' + tidy(hotelLine.replace(/^.*bermalam di\s*/i, '')).replace(/[.]$/, '') : '';
    days.push({
      title,
      description: desc.map((x) => x.replace(/^•\s*/, '• ').replace(/^-\s*/, '- ')).join('\n'),
      meals: cur.meals,
      hotel,
      _date: cur.date
    });
    cur = null;
  };
  if (itinStart >= 0) {
    for (let i = itinStart; i < itinEnd; i++) {
      const l = lines[i];
      if (!l) continue;
      const dm = l.match(/^DAY\s*(\d+)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})?\s*(?:\(([^)]*)\))?/i);
      if (dm) { flush(); cur = { date: dmyToIso(dm[2]), meals: normMeals(dm[3]), lines: [] }; continue; }
      if (/^note\b/i.test(l)) { flush(); notes.push(l.replace(/^note\s*:?\s*/i, '').trim()); continue; }
      if (cur) cur.lines.push(l);
    }
    flush();
  }
  if (!days.length) warnings.push('Itinerary per hari (DAY 1, DAY 2, dst) nggak terbaca. Cek penulisannya.');
  if (days.some((d) => !d.title)) warnings.push('Ada hari yang judul rutenya nggak terbaca, lengkapi manual.');

  // ---- Info khas Private Trip (masuk Catatan Khusus + harga anak) ----
  const privateNotes = [];
  let priceChild = 0;
  const amountOf = (l) => {
    const m = l.match(/(?:IDR|Rp)\.?\s*([\d.]+)/i);
    return m ? Number(m[1].replace(/\./g, '')) : 0;
  };
  // Total peserta
  for (const l of nonEmpty) {
    const m = l.match(/^total\s*(?:pax|peserta)\s*:?\s*(.+)$/i);
    if (m) { privateNotes.push('Total peserta: ' + tidy(m[1])); break; }
  }
  // Blok HOTEL (sebelum ITINERARY): satu baris per kota
  const idxHotel = lines.findIndex((l) => /^hotel\s*:?\s*$/i.test(l));
  if (idxHotel >= 0) {
    const hotelEnd = [idxItin, firstDay].filter((x) => x > idxHotel).sort((a, b) => a - b)[0] ?? lines.length;
    const hotels = [];
    for (let i = idxHotel + 1; i < hotelEnd; i++) if (lines[i]) hotels.push(tidy(lines[i].replace(/^[•\-]\s*/, '')));
    if (hotels.length) privateNotes.push('Hotel: ' + hotels.join('; '));
  }
  // Blok HARGA
  if (idxHarga >= 0) {
    const hargaEnd = [idxInc, idxExc].filter((x) => x > idxHarga).sort((a, b) => a - b)[0] ?? lines.length;
    for (let i = idxHarga + 1; i < hargaEnd; i++) {
      const l = lines[i];
      if (!l) continue;
      if (/^note\b/i.test(l)) break;
      if (/^(?:harga\s+)?(?:dewasa|adult|utama)\b/i.test(l) && amountOf(l)) { priceMain = amountOf(l); continue; }
      if (/^(?:harga\s+)?(?:anak|child)\b/i.test(l) && amountOf(l)) { priceChild = amountOf(l); continue; }
      privateNotes.push(tidy(l.replace(/^[•\-]\s*/, '')));
    }
  }

  if (!priceMain) warnings.push('Harga per pax nggak terbaca, isi manual.');

  // ---- Include ----
  const priceIncludes = [];
  if (idxInc >= 0) {
    const end = idxExc > idxInc ? idxExc : lines.length;
    for (let i = idxInc + 1; i < end; i++) {
      const l = lines[i];
      if (!l) continue;
      if (/^note\b/i.test(l)) break;
      priceIncludes.push(tidy(l.replace(/^(\d+[.)]|[•\-])\s*/, '')));
    }
  } else warnings.push('Bagian INCLUDE nggak ditemukan.');

  // ---- Exclude + catatan ----
  const priceExcludes = [];
  if (idxExc >= 0) {
    let inNote = false;
    for (let i = idxExc + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      if (/^note\b/i.test(l)) { inNote = true; const rest = l.replace(/^note\s*:?\s*/i, '').trim(); if (rest) notes.push(rest); continue; }
      if (inNote) { notes.push(l); continue; }
      const it = parseMoneyLine(l);
      if (it.label) priceExcludes.push(it);
    }
  } else warnings.push('Bagian EXCLUDE nggak ditemukan.');

  // ---- Tanggal & durasi ----
  const dayDates = days.map((d) => d._date).filter(Boolean);
  let departureDate = periode?.start || dayDates[0] || '';
  let durationDays = '';
  if (periode) durationDays = `${dayDiff(periode.start, periode.end) + 1} Hari`;
  else if (days.length) durationDays = `${days.length} Hari`;
  if (!departureDate) warnings.push('Tanggal keberangkatan nggak terbaca, isi manual.');
  if (periode && days.length && dayDiff(periode.start, periode.end) + 1 !== days.length) {
    warnings.push(`Periode menunjukkan ${dayDiff(periode.start, periode.end) + 1} hari, tapi itinerary punya ${days.length} hari. Cek lagi.`);
  }
  if (!priceChild && notes.some((n) => /disc|diskon|full payment|infant|usia/i.test(n))) {
    warnings.push('Ada ketentuan harga anak/infant di catatan. Harga anak (kolom Harga Anak) nggak diisi otomatis, silakan atur manual.');
  }

  return {
    fields: { name, departureDate, durationDays, airline, priceMain, priceChild, priceIncludes, priceExcludes, flightSegments, specialNote: [...privateNotes, ...notes].join('\n') },
    itinerary: days.map(({ _date, ...d }) => d),
    warnings
  };
}


// ---------- Parser Private Trip (dokumen tabel) ----------
// Format dokumen penawaran Private Trip tim OP: judul, blok DATE/TOTAL/FLIGHT BY/HOTEL,
// tabel hari (Date | Destination | Meals | Accomodation | Transport), NOTE, tabel harga
// (OPSI | JUMLAH PAX | HARGA ...), Ketentuan Harga, tabel Harga Termasuk / Tidak Termasuk,
// lalu Syarat dan Ketentuan (diabaikan, sudah baku).

const MON3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };
const mon3 = (w) => MON3[String(w || '').toLowerCase().slice(0, 3)] || 0;

const xmlText = (x) => decodeEntities(
  x.replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n').replace(/<w:tab\b[^>]*\/>/g, ' ').replace(/<[^>]+>/g, '')
);

// Pecah isi body jadi urutan elemen tingkat atas: paragraf (p) dan tabel (t).
function privateElements(xml) {
  const start = xml.indexOf('<w:body>');
  const body = start >= 0 ? xml.slice(start) : xml;
  const out = [];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(body))) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl>')) {
      const rows = (chunk.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map((tr) =>
        (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map((tc) =>
          (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map((px) => ({ text: xmlText(px), bullet: /<w:numPr>/.test(px) }))
        )
      );
      out.push({ type: 't', rows });
    } else {
      out.push({ type: 'p', paras: [{ text: xmlText(chunk), bullet: /<w:numPr>/.test(chunk) }] });
    }
  }
  return out;
}

const starFix = (s) => s.replace(/\s*\*\s*(\d)/g, ' Bintang $1');
const cellLines = (cell) => cell.flatMap((p) => p.text.split('\n')).map((l) => tidy(stripDecor(starFix(l)))).filter(Boolean);
const cellFlat = (cell) => cellLines(cell).join(' ');

export function isPrivateDocXml(xml) {
  return privateElements(xml).some((e) => e.type === 't' && e.rows[0] && e.rows[0].length >= 4
    && /^date$/i.test(cellFlat(e.rows[0][0])) && /^destination$/i.test(cellFlat(e.rows[0][1])));
}

function mealCode(v, name) {
  const t = String(v || '').trim();
  if (!t || /^-+$/.test(t)) return '';
  if (/^ob$|on\s*board/i.test(t)) return `${name} (On Board)`;
  return name;
}

export function parsePrivateDocXml(xml) {
  const warnings = [];
  const els = privateElements(xml);
  const dayIdx = els.findIndex((e) => e.type === 't' && e.rows[0] && e.rows[0].length >= 4
    && /^date$/i.test(cellFlat(e.rows[0][0])) && /^destination$/i.test(cellFlat(e.rows[0][1])));
  const before = els.slice(0, dayIdx);
  const after = els.slice(dayIdx + 1);

  // ---- Header: judul + DATE/TOTAL/FLIGHT BY ----
  const headLines = [];
  for (const e of before) {
    if (e.type === 'p') e.paras.forEach((p) => p.text.split('\n').forEach((l) => headLines.push(l)));
    else e.rows.forEach((r) => r.forEach((c) => c.forEach((p) => p.text.split('\n').forEach((l) => headLines.push(l)))));
  }
  const hl = headLines.map((l) => stripDecor(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dateAt = hl.findIndex((l) => /^(DATE|DAT|PERIODE)\b/i.test(l));
  const titleLines = (dateAt >= 0 ? hl.slice(0, dateAt) : hl.slice(0, 1)).slice(0, 3);
  const name = tidy(titleLines.join(' - '));
  if (!name) warnings.push('Judul paket nggak terbaca, isi manual.');
  const flat = hl.slice(Math.max(dateAt, 0)).join('\n');

  let periode = null;
  const pm = flat.match(/(?:DATE|DAT|PERIODE)\s*:?\s*(.+?)(?=\s*TOTAL|\n|$)/i);
  if (pm) periode = parsePeriode(pm[1]);
  if (!periode) warnings.push('Tanggal keberangkatan (DATE) nggak terbaca, isi manual.');

  const privateNotes = [];
  const tm = flat.match(/TOTAL\s*:?\s*([^\n]+?)(?=\s*(?:FLIGHT|HOTEL)|\n|$)/i);
  if (tm) privateNotes.push('Total peserta: ' + tidy(tm[1]));

  let airline = '';
  const am = flat.match(/FLIGHT\s*(?:BY|DETAIL)\s*:?\s*(.+?)(?=\s*HOTEL|\s*Pergi|\n|$)/i);
  if (am) airline = tidy(am[1]);

  const yearFor = (m, d) => {
    if (!periode) return new Date().getFullYear();
    const y0 = Number(periode.start.slice(0, 4));
    const y1 = Number(periode.end.slice(0, 4));
    const cands = [y0, y1].map((y) => iso(y, m, d));
    const best = cands.find((c) => dayDiff(periode.start, c) >= -2 && dayDiff(c, periode.end) >= -2);
    return Number((best || cands[0]).slice(0, 4));
  };

  // ---- Flight ----
  const flightSegments = [];
  const seen = new Set();
  const flightRe = /\b([A-Z]{2})\s?(\d{2,4})\s+(?:[A-Z]\s+)?(\d{1,2})\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|MEI|AGU|OKT|DES)\s*(?:\d\s?\*?\s*)?([A-Z]{3})\s*-?\s*([A-Z]{3})\s*(?:DK\d\s+)?(\d{1,2})[.:]?(\d{2})\s*-?\s*(\d{1,2})[.:]?(\d{2})/g;
  let fm;
  while ((fm = flightRe.exec(flat))) {
    const m = mon3(fm[4]);
    const date = iso(yearFor(m, Number(fm[3])), m, Number(fm[3]));
    const key = fm[1] + fm[2] + date;
    if (seen.has(key)) continue;
    seen.add(key);
    flightSegments.push({ flightNumber: `${fm[1]} ${fm[2]}`, date, route: `${fm[5]} - ${fm[6]}`, depTime: `${pad(fm[7])}:${fm[8]}`, arrTime: `${pad(fm[9])}:${fm[10]}` });
  }
  if (!flightSegments.length && !/^la\b|la\s*only|tanpa\s*tiket/i.test(airline)) warnings.push('Jadwal flight nggak terbaca, isi manual di Rincian Penerbangan.');

  // ---- Tabel hari ----
  const dayRows = els[dayIdx].rows.slice(1).filter((r) => r.length >= 2 && /DAY/i.test(cellFlat(r[0])));
  const days = [];
  const hotels = [];
  dayRows.forEach((r, i) => {
    const c0 = cellLines(r[0]);
    let dateIso = '';
    const dtext = c0.join(' ').replace(new RegExp('^DAY\\s*' + (i + 1) + '\\s*', 'i'), '');
    const dm = dtext.match(/(\d{1,2})\s*([A-Za-z]{3,})/);
    if (dm && mon3(dm[2])) dateIso = iso(yearFor(mon3(dm[2]), Number(dm[1])), mon3(dm[2]), Number(dm[1]));
    const dest = r[1].flatMap((p) => p.text.split('\n').map((l) => ({ text: tidy(stripDecor(l)), bullet: p.bullet }))).filter((x) => x.text);
    const title = dest.length ? dest[0].text : '';
    const desc = dest.slice(1).map((x) => (x.bullet ? '- ' : '') + x.text);
    const mt = (r[2] ? cellLines(r[2]) : []).join(' ');
    const bm = mt.match(/B\s*:\s*(.*?)\s*L\s*:/i);
    const lm = mt.match(/L\s*:\s*(.*?)\s*D\s*:/i);
    const dmm = mt.match(/D\s*:\s*(.*)$/i);
    const meals = [mealCode(bm && bm[1], 'Breakfast'), mealCode(lm && lm[1], 'Lunch'), mealCode(dmm && dmm[1], 'Dinner')].filter(Boolean).join(', ');
    const acc = r[3] ? cellFlat(r[3]) : '';
    if (acc && !hotels.includes(acc)) hotels.push(acc);
    days.push({ title, description: desc.join('\n'), meals, hotel: acc ? 'Bermalam di ' + acc : '', _date: dateIso });
  });
  if (!days.length) warnings.push('Tabel itinerary per hari nggak terbaca. Cek penulisannya.');
  if (days.some((d) => !d.title)) warnings.push('Ada hari yang judul rutenya nggak terbaca, lengkapi manual.');
  if (hotels.length) privateNotes.push('Hotel: ' + hotels.join('; '));

  // ---- NOTE, tabel harga, ketentuan, include/exclude ----
  const itinNotes = [];
  let priceMain = 0;
  let priceChild = 0;
  const priceIncludes = [];
  const priceExcludes = [];
  let phase = 'note';
  for (const e of after) {
    if (e.type === 'p') {
      const lines = e.paras.flatMap((p) => p.text.split('\n')).map((l) => tidy(stripDecor(l))).filter(Boolean);
      for (const l of lines) {
        if (/^syarat\s+dan\s+ketentuan/i.test(l)) { phase = 'stop'; break; }
        if (phase === 'stop') break;
        if (/^note\s*:?\s*$/i.test(l)) { phase = 'note'; continue; }
        if (/^ketentuan\s+harga/i.test(l)) { phase = 'ketentuan'; continue; }
        if (!/[A-Za-z]/.test(l.replace(/^note\s*:?\s*/i, ''))) continue;
        if (phase === 'note') itinNotes.push(l.replace(/^note\s*:?\s*/i, ''));
        else if (phase === 'ketentuan') {
          const mn = l.match(/minimal\s+keberangkatan\s*\d+\s*pax/i);
          if (mn) privateNotes.push(tidy(mn[0]));
          if (/kurs|terupdate|update/i.test(l) && !/^WHI\s+berhak/i.test(l)) privateNotes.push(l);
        }
      }
      if (phase === 'stop') break;
      continue;
    }
    const head = e.rows[0] ? e.rows[0].map(cellFlat) : [];
    if (head.length >= 3 && /^(opsi|periode)$/i.test(head[0]) && /harga/i.test(head.slice(1).join(' '))) {
      const rows = e.rows.slice(1).map((r) => {
        const cells = r.map(cellFlat);
        const amounts = cells.slice(2).map((c, ci) => {
          const m = c.match(/(\d{1,3}(?:[.,]\d{3})+|\d{4,})/);
          return m ? { name: (head[ci + 2] || '').replace(/^harga\s*/i, '') || 'Harga', val: Number(m[1].replace(/[.,]/g, '')) } : null;
        }).filter(Boolean);
        return { label: cells[0] || '', pax: cells[1] || '', amounts };
      }).filter((r) => r.label && r.amounts.length);
      const total = (r) => r.amounts.reduce((a, b) => a + b.val, 0);
      const mainRow = rows.find((r) => /dewasa|adult/i.test(r.label)) || rows.find((r) => /quad/i.test(r.label)) || rows[0];
      const childRow = rows.find((r) => /^(child|anak)/i.test(r.label)) || rows.find((r) => /cnb/i.test(r.label));
      if (mainRow) priceMain = total(mainRow);
      if (childRow && childRow !== mainRow) priceChild = total(childRow);
      rows.forEach((r) => {
        const detail = r.amounts.length > 1
          ? r.amounts.map((a) => `${a.name} IDR ${a.val.toLocaleString('id-ID')}`).join(' + ') + ` = IDR ${total(r).toLocaleString('id-ID')} / pax`
          : `IDR ${total(r).toLocaleString('id-ID')} / pax`;
        if (r !== mainRow && r !== childRow) privateNotes.push(`Harga ${r.label}: ${detail}`);
        else if (r.amounts.length > 1) privateNotes.push(`Harga ${r.label}: ${detail}`);
      });
      if (rows.some((r) => r.amounts.length > 1)) warnings.push('Harga terdiri dari beberapa kolom (misalnya Tiket + LA). Harga utama dan anak diisi dari jumlah kolomnya, rinciannya ada di Catatan Khusus. Cek lagi.');
      continue;
    }
    if (head.length >= 2 && /termasuk/i.test(head[0]) && /tidak\s*termasuk/i.test(head[1]) && e.rows[1]) {
      cellLines(e.rows[1][0]).forEach((l) => priceIncludes.push(l.replace(/^[•\-]\s*/, '')));
      cellLines(e.rows[1][1]).forEach((l) => { const it = parseMoneyLine(l); if (it.label) priceExcludes.push(it); });
    }
  }
  if (!priceMain) warnings.push('Harga per pax nggak terbaca dari tabel harga, isi manual.');
  if (!priceIncludes.length) warnings.push('Bagian HARGA TERMASUK nggak ditemukan.');
  if (!priceExcludes.length) warnings.push('Bagian HARGA TIDAK TERMASUK nggak ditemukan.');

  // ---- Tanggal & durasi ----
  const dayDates = days.map((d) => d._date).filter(Boolean);
  const departureDate = periode?.start || dayDates[0] || '';
  let durationDays = '';
  if (periode) durationDays = `${dayDiff(periode.start, periode.end) + 1} Hari`;
  else if (days.length) durationDays = `${days.length} Hari`;
  if (periode && days.length && dayDiff(periode.start, periode.end) + 1 !== days.length) {
    warnings.push(`Periode menunjukkan ${dayDiff(periode.start, periode.end) + 1} hari, tapi itinerary punya ${days.length} hari. Cek lagi.`);
  }

  return {
    fields: { name, departureDate, durationDays, airline, priceMain, priceChild, priceIncludes, priceExcludes, flightSegments, specialNote: [...privateNotes, ...itinNotes].join('\n') },
    itinerary: days.map(({ _date, ...d }) => d),
    warnings
  };
}

export async function importItineraryFromDocx(file) {
  const xml = await readDocxXml(file);
  // Dokumen Private Trip (tabel Date | Destination | Meals | ...) dibaca per struktur tabel,
  // dokumen Series (teks per baris) dibaca pakai parseItineraryText.
  if (isPrivateDocXml(xml)) return parsePrivateDocXml(xml);
  return parseItineraryText(docxXmlToLines(xml));
}
