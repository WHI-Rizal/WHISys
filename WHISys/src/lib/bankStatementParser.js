// =====================================================================
// Parser file mutasi bank (Excel/CSV) — dipakai di BROWSER (client-side),
// dipanggil dari tombol "Import File Mutasi" di tab Rekonsiliasi Bank
// (LaporanKeuanganModule.jsx). Nggak ada server/API tambahan — file
// dibaca & diparse langsung di browser staf yang upload, hasilnya
// langsung ditulis ke Firestore lewat client SDK (pola sama kayak fitur
// lain di WHISys), makanya nggak butuh Google Cloud/Service Account sama
// sekali.
//
// Formatnya FLEKSIBEL — parser ini nyari baris header (baris yang ada
// kata "Tanggal" & salah satu dari "Keterangan"/"Debit"/"Kredit"/"Mutasi")
// di antara beberapa baris pertama, terus nyocokin nama kolom secara
// fuzzy (case-insensitive, partial match). Jadi file export ASLI dari
// internet banking (BCA, BSI, bank manapun) biasanya bisa langsung
// kebaca tanpa perlu diubah dulu formatnya — TAPI kalau ternyata gagal
// kebaca / banyak baris ke-skip, cek pesan errornya (biasanya nunjukin
// kolom apa yang nggak ketemu) & sesuaikan file-nya atau kabari buat
// parser-nya disesuaikan.
// =====================================================================

import * as XLSX from 'xlsx';

const HEADER_KEYWORD_GROUPS = [
  ['tanggal', 'tgl'],
  ['keterangan', 'uraian', 'remark', 'description', 'mutasi', 'debit', 'kredit', 'credit'],
];

const COLUMN_ALIASES = {
  date: ['tanggal transaksi', 'tanggal', 'tgl transaksi', 'tgl'],
  description: ['keterangan', 'uraian', 'remark', 'description', 'deskripsi'],
  combinedAmount: ['mutasi'],
  debit: ['debit', 'db'],
  credit: ['kredit', 'credit', 'cr'],
  balance: ['saldo', 'balance'],
};

const findHeaderRowIndex = (rows) => {
  const maxScan = Math.min(rows.length, 15);
  for (let i = 0; i < maxScan; i++) {
    const rowText = (rows[i] || []).map(c => String(c || '').toLowerCase().trim());
    const matchCount = HEADER_KEYWORD_GROUPS.filter(group =>
      group.some(keyword => rowText.some(cell => cell.includes(keyword)))
    ).length;
    if (matchCount >= HEADER_KEYWORD_GROUPS.length) return i;
  }
  return -1;
};

const findColumnIndex = (headerRow, aliases) => {
  const headerLower = headerRow.map(h => String(h || '').toLowerCase().trim());
  for (const alias of aliases) {
    const idx = headerLower.findIndex(h => h.includes(alias));
    if (idx !== -1) return idx;
  }
  return -1;
};

const parseAmount = (raw) => {
  if (raw === null || raw === undefined || raw === '') return { num: 0, isCredit: false, isDebit: false };
  if (typeof raw === 'number') return { num: Math.abs(raw), isCredit: false, isDebit: false };
  let s = String(raw).trim();
  if (!s || s === '-') return { num: 0, isCredit: false, isDebit: false };
  const isCredit = /\bcr\b/i.test(s);
  const isDebit = /\bdb\b/i.test(s);
  s = s.replace(/[^\d,.-]/g, '');
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const parts = s.split(',');
    if (parts[parts.length - 1].length <= 2) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  } else {
    const dotParts = s.split('.');
    if (dotParts.length > 1 && dotParts.slice(1).every(p => p.length === 3)) s = s.replace(/\./g, '');
  }
  return { num: Math.abs(parseFloat(s) || 0), isCredit, isDebit };
};

const parseDateCell = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (!parsed) return null;
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}T12:00:00.000Z`;
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${y.padStart(4, '0')}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T12:00:00.000Z`;
  }
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T12:00:00.000Z`;
  }
  return null;
};

// arrayBuffer: hasil File.arrayBuffer() dari <input type="file"> di browser.
// Return { rows: [{date, description, debit, credit, balanceAfter}], skipped, totalRowsScanned }
export const parseBankStatementFile = (arrayBuffer) => {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

  const headerRowIdx = findHeaderRowIndex(rows);
  if (headerRowIdx === -1) {
    throw new Error('Baris header (Tanggal/Keterangan/Debit/Kredit) nggak ketemu di 15 baris pertama file. Cek lagi filenya — mungkin ada baris judul/logo yang kebanyakan di atas, atau format kolomnya beda dari yang diharapkan.');
  }
  const headerRow = rows[headerRowIdx];

  const dateIdx = findColumnIndex(headerRow, COLUMN_ALIASES.date);
  const descIdx = findColumnIndex(headerRow, COLUMN_ALIASES.description);
  const debitIdx = findColumnIndex(headerRow, COLUMN_ALIASES.debit);
  const creditIdx = findColumnIndex(headerRow, COLUMN_ALIASES.credit);
  const combinedIdx = findColumnIndex(headerRow, COLUMN_ALIASES.combinedAmount);
  const balanceIdx = findColumnIndex(headerRow, COLUMN_ALIASES.balance);

  if (dateIdx === -1) throw new Error('Kolom "Tanggal" nggak ketemu di header file.');
  if (debitIdx === -1 && creditIdx === -1 && combinedIdx === -1) {
    throw new Error('Kolom Debit/Kredit/Mutasi nggak ketemu di header file.');
  }

  const parsed = [];
  let skipped = 0;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const date = parseDateCell(row[dateIdx]);
    if (!date) { skipped += 1; continue; }

    let debit = 0;
    let credit = 0;
    if (combinedIdx !== -1) {
      const amt = parseAmount(row[combinedIdx]);
      if (amt.isCredit) credit = amt.num;
      else debit = amt.num;
    } else {
      debit = debitIdx !== -1 ? parseAmount(row[debitIdx]).num : 0;
      credit = creditIdx !== -1 ? parseAmount(row[creditIdx]).num : 0;
    }

    if (debit === 0 && credit === 0) { skipped += 1; continue; }

    const description = descIdx !== -1 ? String(row[descIdx] || '').trim() : '-';
    const balanceAfter = balanceIdx !== -1 && row[balanceIdx] !== '' ? parseAmount(row[balanceIdx]).num : null;

    parsed.push({ date, description, debit, credit, balanceAfter });
  }

  return { rows: parsed, skipped, totalRowsScanned: rows.length - headerRowIdx - 1 };
};
