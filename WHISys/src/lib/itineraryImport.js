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

export async function readDocxLines(file) {
  if (!file) throw new Error('File belum dipilih.');
  if (!/\.docx$/i.test(file.name || '')) throw new Error('Format file harus .docx (Word).');
  if (file.size > MAX_DOCX_BYTES) throw new Error('Ukuran file terlalu besar (maksimal 8 MB).');
  if (typeof DecompressionStream === 'undefined') throw new Error('Browser ini belum mendukung baca file Word. Pakai Chrome atau Edge versi terbaru.');
  const buf = await file.arrayBuffer();
  const bytes = await readZipEntry(buf, 'word/document.xml');
  return docxXmlToLines(new TextDecoder('utf-8').decode(bytes));
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
  let m = t.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})/);
  if (m && monthNum(m[3])) return { start: iso(m[4], monthNum(m[3]), m[1]), end: iso(m[4], monthNum(m[3]), m[2]) };
  m = t.match(/(\d{1,2})\s+([A-Za-z.]+)\s*-\s*(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})/);
  if (m && monthNum(m[2]) && monthNum(m[4])) {
    const endY = Number(m[5]);
    const startY = monthNum(m[2]) > monthNum(m[4]) ? endY - 1 : endY;
    return { start: iso(startY, monthNum(m[2]), m[1]), end: iso(endY, monthNum(m[4]), m[3]) };
  }
  m = t.match(/(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})\s*-\s*(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})/);
  if (m && monthNum(m[2]) && monthNum(m[5])) return { start: iso(m[3], monthNum(m[2]), m[1]), end: iso(m[6], monthNum(m[5]), m[4]) };
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

export async function importItineraryFromDocx(file) {
  const lines = await readDocxLines(file);
  return parseItineraryText(lines);
}
