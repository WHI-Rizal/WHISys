// =====================================================================
// Jurnal Umum / Chart of Accounts — mesin akuntansi jurnal ganda WHISys
// =====================================================================
// File ini SATU-SATUNYA tempat yang boleh nulis ke collection
// `journal_entries`. Semua modul (BookingsModule, FinanceModule) manggil
// helper di sini PERSIS di titik yang sama dengan addDoc/updateDoc
// transaksi aslinya (payments_income, payments_vendor,
// expenses_operational, bookings, dst) — bukan ngerombak flow yang udah
// ada, cuma nambahin "sisi jurnal"-nya di sebelahnya.
//
// KENAPA gini strukturnya (bukan double-entry generik lepas dari bisnis):
// - Setiap akun & mapping jurnal di bawah ini SENGAJA dipetakan lurus dari
//   mekanisme yang UDAH ADA di app (revenueRecognized/recognizedAt per
//   paket, paymentMethod 'Saldo Deposit', payMethod 'Saldo Deposit
//   Vendor', dll) — biar Neraca/Buku Besar/Jurnal SELALU nyambung sama
//   angka Laba Rugi yang udah ditampilin FinanceModule.jsx, bukan jadi
//   sumber kebenaran kedua yang bisa beda sendiri.
// - "Piutang Jamaah" di-posting PENUH sebesar totalAmount begitu booking
//   dibuat (bukan cuma pas ada setoran) — pola standar akuntansi akrual
//   "akui piutang penuh saat kontrak/booking terjadi, kurangi tiap ada
//   pembayaran". Ini juga bikin Piutang Jamaah di Neraca itu ANGKA HASIL
//   JURNAL (bisa diaudit), bukan cuma live-sum field totalAmount-totalPaid.
//
// Semua fungsi di sini NON-ATOMIC (sequential await biasa), niru gaya
// adjustAccountBalance/dkk yang udah ada di FinanceModule.jsx — bukan
// Firestore transaction — biar konsisten sama risiko yang udah diterima
// kode lama, nggak nambah kerumitan baru.

import { db } from './firebase';
import {
  collection, addDoc, doc, getDoc, setDoc, deleteDoc, query, where, getDocs, orderBy
} from 'firebase/firestore';
import { calculatePPN } from './ppn';

// ---------------------------------------------------------------------
// Chart of Accounts (COA) — daftar akun tetap/sistem. Kode dipakai juga
// sebagai document ID di collection `chart_of_accounts`, jadi seeding-nya
// idempotent (setDoc by code, aman dijalanin ulang).
// ---------------------------------------------------------------------
export const COA = [
  { code: '1101', name: 'Kas & Bank', type: 'Aset', normalBalance: 'debit' },
  { code: '1201', name: 'Piutang Jamaah', type: 'Aset', normalBalance: 'debit' },
  { code: '1301', name: 'Piutang Deposit Vendor', type: 'Aset', normalBalance: 'debit' },
  { code: '1401', name: 'Biaya Dibayar Dimuka', type: 'Aset', normalBalance: 'debit' },
  { code: '2101', name: 'Utang Deposit Jamaah', type: 'Liabilitas', normalBalance: 'credit' },
  { code: '2201', name: 'Pendapatan Diterima Dimuka', type: 'Liabilitas', normalBalance: 'credit' },
  { code: '2301', name: 'Hutang Vendor (Utang Usaha)', type: 'Liabilitas', normalBalance: 'credit' },
  { code: '2401', name: 'PPN Keluaran', type: 'Liabilitas', normalBalance: 'credit' },
  { code: '3101', name: 'Modal / Laba Ditahan', type: 'Ekuitas', normalBalance: 'credit' },
  { code: '4101', name: 'Pendapatan Jasa Perjalanan', type: 'Pendapatan', normalBalance: 'credit' },
  { code: '5101', name: 'Beban Pokok Penjualan (HPP)', type: 'Beban', normalBalance: 'debit' },
  { code: '5201', name: 'Beban Operasional', type: 'Beban', normalBalance: 'debit' },
  { code: '5301', name: 'Biaya Penalty/Materialized', type: 'Beban', normalBalance: 'debit' },
];

const COA_NAME_BY_CODE = COA.reduce((acc, a) => { acc[a.code] = a.name; return acc; }, {});

// Alias kode akun biar titik pemanggilan gampang dibaca (ACC.KAS_BANK,
// dst) tanpa harus apal angka kodenya.
export const ACC = {
  KAS_BANK: '1101',
  PIUTANG_JAMAAH: '1201',
  PIUTANG_DEPOSIT_VENDOR: '1301',
  BIAYA_DIBAYAR_DIMUKA: '1401',
  UTANG_DEPOSIT_JAMAAH: '2101',
  PENDAPATAN_DITERIMA_DIMUKA: '2201',
  HUTANG_VENDOR: '2301',
  PPN_KELUARAN: '2401',
  MODAL: '3101',
  PENDAPATAN: '4101',
  HPP: '5101',
  OPEX: '5201',
  BIAYA_PENALTY: '5301',
};

// Bikin 1 baris jurnal. `extra` dipakai buat nempelin info tambahan yang
// nggak keliatan dari accountCode doang:
// - accountId/accountName (KHUSUS baris yang nyentuh akun 1101 Kas & Bank)
//   biar baris itu bisa dilacak balik ke doc `financial_accounts` mana
//   persisnya — dipakai laporan Arus Kas & rekonsiliasi saldo kas per rekening.
// - category (KHUSUS baris yang nyentuh akun 5201 Beban Operasional) biar
//   baris itu bisa difilter/dipecah per kategori biaya di Buku Besar &
//   breakdown Laba Rugi, sama kayak Kas & Bank dipecah per rekening — jadi
//   kategori baru yang ditambah user (lewat "Kelola Kategori") otomatis
//   ikut kejurnal & muncul di Buku Besar juga, bukan cuma di P&L.
const glLine = (code, debit = 0, credit = 0, extra = {}) => ({
  accountCode: code,
  accountName: COA_NAME_BY_CODE[code] || code,
  debit: Math.round(Number(debit) || 0),
  credit: Math.round(Number(credit) || 0),
  ...(extra.accountId ? { accountId: extra.accountId } : {}),
  ...(extra.accountName ? { financialAccountName: extra.accountName } : {}),
  ...(extra.category ? { category: extra.category } : {}),
});

// Seed Chart of Accounts sekali (idempotent — setDoc by code, aman
// dipanggil berkali-kali). Dipanggil otomatis begitu modul Laporan
// Keuangan dibuka pertama kali, dan juga dipanggil di awal migrasi.
export const seedChartOfAccounts = async () => {
  const created = [];
  for (const acc of COA) {
    const ref = doc(db, 'chart_of_accounts', acc.code);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { ...acc, createdAt: new Date().toISOString() });
      created.push(acc.code);
    }
  }
  return created;
};

// ---------------------------------------------------------------------
// Inti: posting 1 entry jurnal. Nolak (throw) kalau debit != kredit —
// SEMUA pemanggil di bawah ini WAJIB balance sebelum sampai sini, jadi
// kalau ini nge-throw berarti ada bug di salah satu helper/pemanggilnya,
// bukan kondisi normal yang perlu ditolerir diam-diam.
// ---------------------------------------------------------------------
export const postJournalEntry = async ({
  date, description, source, sourceDocId, reference, lines,
  createdByUid, createdByName, isManual = false, isReversal = false
}) => {
  const validLines = (lines || []).filter(l => (l.debit || 0) !== 0 || (l.credit || 0) !== 0);
  const totalDebit = validLines.reduce((a, l) => a + (Number(l.debit) || 0), 0);
  const totalCredit = validLines.reduce((a, l) => a + (Number(l.credit) || 0), 0);

  if (validLines.length === 0) return null; // nggak ada nominal, nggak usah bikin entry kosong

  if (Math.abs(totalDebit - totalCredit) > 1) { // toleransi Rp1 buat pembulatan
    throw new Error(`Jurnal tidak balance (Debit Rp${totalDebit.toLocaleString('id-ID')} vs Kredit Rp${totalCredit.toLocaleString('id-ID')}) — "${description}". Transaksi TIDAK disimpan ke jurnal, tapi transaksi aslinya sendiri tetap tersimpan. Segera lapor ke tim IT.`);
  }

  return addDoc(collection(db, 'journal_entries'), {
    date: date || new Date().toISOString(),
    description: description || '-',
    source: source || 'manual',
    sourceDocId: sourceDocId || '',
    reference: reference || '',
    lines: validLines,
    totalDebit,
    totalCredit,
    isManual,
    isReversal,
    createdByUid: createdByUid || '',
    createdByName: createdByName || '',
    createdAt: new Date().toISOString()
  });
};

// ---------------------------------------------------------------------
// Helper per-event — dipanggil dari titik yang sama persis dengan
// addDoc/updateDoc transaksi aslinya di BookingsModule.jsx & FinanceModule.jsx.
// Semua "amount <= 0 → return null" (skip diam-diam, bukan error) biar
// pemanggil nggak perlu cek nominal dulu sebelum manggil.
// ---------------------------------------------------------------------

// 1. Booking baru dibuat — akui piutang & pendapatan diterima dimuka
//    PENUH sebesar totalAmount (bukan cuma sebesar DP yang udah masuk).
export const postBookingCreated = async ({ bookingId, bookingCode, totalAmount, date, createdByUid, createdByName }) => {
  const amt = Number(totalAmount) || 0;
  if (amt <= 0) return null;
  return postJournalEntry({
    date, description: `Booking baru ${bookingCode || bookingId}`,
    source: 'booking_created', sourceDocId: bookingId, reference: bookingCode || '',
    lines: [
      glLine(ACC.PIUTANG_JAMAAH, amt, 0),
      glLine(ACC.PENDAPATAN_DITERIMA_DIMUKA, 0, amt),
    ],
    createdByUid, createdByName
  });
};

// 2. Setoran/pembayaran jamaah masuk (payments_income) — kurangi Piutang
//    Jamaah, sisi lain Kas/Bank (atau Utang Deposit Jamaah kalau
//    dibayar pakai Saldo Deposit customer).
export const postIncomePayment = async ({ paymentId, bookingCode, amount, paymentMethod, accountId, accountName, date, createdByUid, createdByName }) => {
  const amt = Number(amount) || 0;
  if (amt <= 0) return null;
  const viaDeposit = paymentMethod === 'Saldo Deposit';
  const debitLine = viaDeposit
    ? glLine(ACC.UTANG_DEPOSIT_JAMAAH, amt, 0)
    : glLine(ACC.KAS_BANK, amt, 0, { accountId, accountName });
  return postJournalEntry({
    date, description: `Setoran - ${bookingCode || paymentId}`,
    source: 'income_payment', sourceDocId: paymentId, reference: bookingCode || '',
    lines: [debitLine, glLine(ACC.PIUTANG_JAMAAH, 0, amt)],
    createdByUid, createdByName
  });
};

// 3. Titip Deposit customer (belum tentu dipakai buat booking mana) — kas
//    masuk, jadi utang perusahaan ke jamaah (bisa dipakai/ditarik lagi).
export const postDepositTopup = async ({ sourceDocId, jamaahName, amount, accountId, accountName, date, createdByUid, createdByName }) => {
  const amt = Number(amount) || 0;
  if (amt <= 0) return null;
  return postJournalEntry({
    date, description: `Titip Deposit - ${jamaahName || '-'}`,
    source: 'deposit_topup', sourceDocId, reference: jamaahName || '',
    lines: [
      glLine(ACC.KAS_BANK, amt, 0, { accountId, accountName }),
      glLine(ACC.UTANG_DEPOSIT_JAMAAH, 0, amt),
    ],
    createdByUid, createdByName
  });
};

// 4. Tagihan Vendor baru diterima (BELUM dibayar) — fitur baru. Ini yang
//    bikin Hutang Vendor beneran ke-catat SEBELUM uang keluar, bukan cuma
//    keliatan pas dibayar kayak sebelumnya.
export const postVendorBillCreated = async ({ billId, vendorName, amount, date, createdByUid, createdByName }) => {
  const amt = Number(amount) || 0;
  if (amt <= 0) return null;
  return postJournalEntry({
    date, description: `Tagihan Vendor - ${vendorName || '-'}`,
    source: 'vendor_bill_created', sourceDocId: billId, reference: vendorName || '',
    lines: [
      glLine(ACC.BIAYA_DIBAYAR_DIMUKA, amt, 0),
      glLine(ACC.HUTANG_VENDOR, 0, amt),
    ],
    createdByUid, createdByName
  });
};

// 5. Bayar Vendor. Dua varian:
//    - Ada `billId` (bayar tagihan yang udah dicatat) → lunasin Hutang Vendor.
//    - Nggak ada `billId` (ad-hoc, kompatibel sama alur lama tanpa tagihan)
//      → langsung ke Biaya Dibayar Dimuka kayak sebelum fitur Tagihan Vendor ada.
export const postVendorPayment = async ({ paymentId, vendorName, amount, payMethod, accountId, accountName, billId, date, createdByUid, createdByName }) => {
  const amt = Number(amount) || 0;
  if (amt <= 0) return null;
  const viaDeposit = payMethod === 'Saldo Deposit Vendor';
  const creditLine = viaDeposit
    ? glLine(ACC.PIUTANG_DEPOSIT_VENDOR, 0, amt)
    : glLine(ACC.KAS_BANK, 0, amt, { accountId, accountName });
  const debitLine = billId
    ? glLine(ACC.HUTANG_VENDOR, amt, 0)
    : glLine(ACC.BIAYA_DIBAYAR_DIMUKA, amt, 0);
  return postJournalEntry({
    date, description: `Bayar Vendor - ${vendorName || '-'}`,
    source: 'vendor_payment', sourceDocId: paymentId, reference: vendorName || '',
    lines: [debitLine, creditLine],
    createdByUid, createdByName
  });
};

// 5b. Konversi DP Vendor yang batal (trip cancel, tapi nggak hangus) jadi
//     Saldo Deposit Vendor — misal tiket block seat yang udah dibayar penuh
//     tapi keberangkatannya batal, sebagian nilainya di-roll-over jadi kredit
//     buat booking vendor berikutnya (bukan uang cash yang keluar/masuk lagi,
//     Kas & Bank SENGAJA nggak disentuh — uangnya emang udah beneran keluar
//     pas dibayar dulu, dicatat lewat postVendorPayment di atas).
//
//     `originalAmount` = nominal pembayaran vendor ASLI yang lagi dikonversi
//     (masih nangkring di 1401 Biaya Dibayar Dimuka sejak dibayar dulu).
//     `rolloverAmount` = porsi yang beneran bisa dipakai lagi (jadi Piutang
//     Deposit Vendor, akun 1301). Selisihnya (originalAmount - rolloverAmount)
//     = bagian yang hangus/kena penalty pembatalan-reschedule — LANGSUNG
//     diakui sebagai beban SEKARANG (nggak nunggu paketnya "Akui
//     Pendapatan", soalnya duit/kreditnya emang udah nggak balik lagi ke
//     paket yang batal itu). Staf pilih mau selisih ini masuk HPP paket yang
//     batal (`selisihAccount: 'hpp'`) atau ke akun terpisah "Biaya
//     Penalty/Materialized" (`selisihAccount: 'penalty'`) biar nggak
//     nyampur sama HPP operasional biasa.
//
//     Setelah dikonversi, `originalAmount` ini DIKELUARKAN dari perhitungan
//     HPP live per-paket (lihat filter `convertedToDeposit` di
//     LaporanKeuanganModule.jsx ProfitLossTab) — biar nggak kehitung dobel
//     pas paket itu nanti/udah diklik Akui Pendapatan.
export const postVendorDepositConversion = async ({ paymentId, vendorName, packageName, originalAmount, rolloverAmount, selisihAccount, date, createdByUid, createdByName }) => {
  const original = Math.max(0, Number(originalAmount) || 0);
  const rollover = Math.min(original, Math.max(0, Number(rolloverAmount) || 0));
  const selisih = original - rollover;
  if (original <= 0) return null;
  const lines = [];
  if (rollover > 0) lines.push(glLine(ACC.PIUTANG_DEPOSIT_VENDOR, rollover, 0));
  if (selisih > 0) {
    const acc = selisihAccount === 'penalty' ? ACC.BIAYA_PENALTY : ACC.HPP;
    lines.push(glLine(acc, selisih, 0));
  }
  lines.push(glLine(ACC.BIAYA_DIBAYAR_DIMUKA, 0, original));
  return postJournalEntry({
    date, description: `Konversi DP Vendor Batal ke Saldo Deposit - ${vendorName || '-'}${packageName ? ` (${packageName})` : ''}`,
    source: 'vendor_deposit_conversion', sourceDocId: paymentId, reference: vendorName || '',
    lines, createdByUid, createdByName
  });
};

// 6. Biaya Operasional — selalu tunai/bank, nggak ada opsi deposit.
export const postOperationalExpense = async ({ expenseId, category, amount, accountId, accountName, date, createdByUid, createdByName }) => {
  const amt = Number(amount) || 0;
  if (amt <= 0) return null;
  return postJournalEntry({
    date, description: `Biaya Operasional - ${category || '-'}`,
    source: 'operational_expense', sourceDocId: expenseId, reference: category || '',
    lines: [
      glLine(ACC.OPEX, amt, 0, { category }),
      glLine(ACC.KAS_BANK, 0, amt, { accountId, accountName }),
    ],
    createdByUid, createdByName
  });
};

// 7. Akui Pendapatan (toggle revenueRecognized suatu paket → true).
//    `incomeTotal` = total payments_income paket itu (PERSIS metrik yang
//    sama dipakai P&L existing), `vendorTotal` = total payments_vendor
//    paket itu. PPN dipecah pakai calculatePPN yang sama dgn breakdown P&L.
export const postRevenueRecognition = async ({ packageId, packageName, incomeTotal, vendorTotal, date, createdByUid, createdByName }) => {
  const lines = [];
  const inc = Number(incomeTotal) || 0;
  if (inc > 0) {
    const { dpp, ppn } = calculatePPN(inc);
    lines.push(glLine(ACC.PENDAPATAN_DITERIMA_DIMUKA, inc, 0));
    lines.push(glLine(ACC.PENDAPATAN, 0, dpp));
    if (ppn > 0) lines.push(glLine(ACC.PPN_KELUARAN, 0, ppn));
  }
  const vc = Number(vendorTotal) || 0;
  if (vc > 0) {
    lines.push(glLine(ACC.HPP, vc, 0));
    lines.push(glLine(ACC.BIAYA_DIBAYAR_DIMUKA, 0, vc));
  }
  if (lines.length === 0) return null;
  return postJournalEntry({
    date, description: `Akui Pendapatan - ${packageName || packageId}`,
    source: 'revenue_recognition', sourceDocId: packageId, reference: packageName || '',
    lines, createdByUid, createdByName
  });
};

// 8. Batalkan Pengakuan Pendapatan — kebalikan persis dari #7.
export const postRevenueUnrecognition = async ({ packageId, packageName, incomeTotal, vendorTotal, date, createdByUid, createdByName }) => {
  const lines = [];
  const inc = Number(incomeTotal) || 0;
  if (inc > 0) {
    const { dpp, ppn } = calculatePPN(inc);
    lines.push(glLine(ACC.PENDAPATAN, dpp, 0));
    if (ppn > 0) lines.push(glLine(ACC.PPN_KELUARAN, ppn, 0));
    lines.push(glLine(ACC.PENDAPATAN_DITERIMA_DIMUKA, 0, inc));
  }
  const vc = Number(vendorTotal) || 0;
  if (vc > 0) {
    lines.push(glLine(ACC.BIAYA_DIBAYAR_DIMUKA, vc, 0));
    lines.push(glLine(ACC.HPP, 0, vc));
  }
  if (lines.length === 0) return null;
  return postJournalEntry({
    date, description: `Batalkan Pengakuan Pendapatan - ${packageName || packageId}`,
    source: 'revenue_unrecognition', sourceDocId: packageId, reference: packageName || '',
    lines, createdByUid, createdByName, isReversal: true
  });
};

// 9. Batal/Refund booking (single ATAU grup — pemanggil tinggal jumlahin
//    totalnya kalau grup). `isRecognized` = status revenueRecognized paket
//    booking ini SAAT batal (dicek oleh pemanggil) — nentuin sisi jurnal
//    yang dipakai: kalau BELUM diakui, keluar dari Pendapatan Diterima
//    Dimuka (liability); kalau UDAH diakui, keluar dari Pendapatan
//    (langsung ngurangin pendapatan yang udah tercatat). Kalau
//    refundAmount < writeOffAmount + totalPaid (ada yang dihanguskan),
//    selisihnya OTOMATIS nempel jadi pendapatan perusahaan (DP hangus) —
//    itu emang benar secara akuntansi, bukan bug.
export const postBookingCancelRefund = async ({ bookingId, bookingCode, writeOffAmount, refundAmount, isRecognized, refundToDeposit, accountId, accountName, date, createdByUid, createdByName }) => {
  const revenueAcc = isRecognized ? ACC.PENDAPATAN : ACC.PENDAPATAN_DITERIMA_DIMUKA;
  const woAmt = Math.max(0, Number(writeOffAmount) || 0);
  const refAmt = Math.max(0, Number(refundAmount) || 0);
  const totalDebit = woAmt + refAmt;
  if (totalDebit <= 0) return null;

  const lines = [glLine(revenueAcc, totalDebit, 0)];
  if (woAmt > 0) lines.push(glLine(ACC.PIUTANG_JAMAAH, 0, woAmt));
  if (refAmt > 0) {
    if (refundToDeposit) lines.push(glLine(ACC.UTANG_DEPOSIT_JAMAAH, 0, refAmt));
    else lines.push(glLine(ACC.KAS_BANK, 0, refAmt, { accountId, accountName }));
  }

  return postJournalEntry({
    date, description: `Batal/Refund Booking ${bookingCode || bookingId}`,
    source: 'booking_cancel_refund', sourceDocId: `refund_${bookingId}`, reference: bookingCode || '',
    lines, createdByUid, createdByName
  });
};

// Hapus jurnal yang nempel ke suatu transaksi yang DIHAPUS di modul lain
// (misal staf hapus setoran/pembayaran vendor/biaya operasional yang salah
// input) — dicari lewat (source, sourceDocId) yang sama kayak dipakainya
// pas posting. Dipanggil BARENGAN dengan reversal account_mutations yang
// udah ada (removeAccountMutationBySource dkk di FinanceModule.jsx),
// bukan gantiin — dua-duanya jalan bareng biar Kas/Bank & Jurnal tetap
// sinkron begitu ada transaksi yang dihapus.
export const deleteJournalEntriesBySource = async (source, sourceDocId) => {
  if (!sourceDocId) return;
  try {
    const q = query(collection(db, 'journal_entries'), where('source', '==', source), where('sourceDocId', '==', sourceDocId));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  } catch (err) {
    console.error(`Gagal menghapus jurnal terkait (${source}/${sourceDocId}):`, err);
  }
};

// ---------------------------------------------------------------------
// Query helper buat modul Laporan Keuangan — baca SEMUA journal_entries,
// dipakai bareng oleh Jurnal Umum, Buku Besar, Neraca, Arus Kas.
// (Koleksi ini biasanya nggak akan sebesar payments_income dkk gabungan,
// tapi tetap kita urutin biar konsisten & gampang di-cache di komponen.)
// ---------------------------------------------------------------------
export const fetchAllJournalEntries = async () => {
  const snap = await getDocs(query(collection(db, 'journal_entries'), orderBy('date', 'asc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const fetchChartOfAccounts = async () => {
  const snap = await getDocs(collection(db, 'chart_of_accounts'));
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return list.length > 0 ? list.sort((a, b) => a.code.localeCompare(b.code)) : COA;
};

// Tempelin field `category` ke baris jurnal 5201 (Beban Operasional) yang
// dibuat SEBELUM fitur breakdown-per-kategori ini ada (jadi baris lama
// itu belum punya field category-nya) — dicari balik dari doc
// expenses_operational asli lewat sourceDocId. Idempotent & aman dipanggil
// berkali-kali: entry yang udah punya category dilewatin, cuma yang bolong
// yang ditambal. Dipanggil otomatis tiap kali modul Laporan Keuangan
// dibuka, jadi kategori baru maupun histori lama sama-sama kefilter di
// Buku Besar, bukan cuma transaksi yang baru dicatat setelah fitur ini rilis.
//
// PENTING: Firestore Rules sengaja nolak `update` di journal_entries (biar
// jurnal immutable/nggak bisa diotak-atik diam-diam) — jadi nambal di sini
// dilakuin lewat hapus dokumen lama + bikin baru (create+delete, dua-duanya
// DIIZINKAN rules), bukan updateDoc. Field lain (tanggal, deskripsi,
// nominal, createdBy asli, dst) disalin persis apa adanya, cuma baris OPEX
// yang ditambahin field category.
export const backfillOpexJournalCategories = async (operationalExpenses) => {
  const expenseById = {};
  (operationalExpenses || []).forEach(e => { expenseById[e.id] = e; });

  const snap = await getDocs(query(collection(db, 'journal_entries'), where('source', '==', 'operational_expense')));
  const patches = [];
  snap.docs.forEach(d => {
    const data = d.data();
    const lines = data.lines || [];
    const idx = lines.findIndex(l => l.accountCode === ACC.OPEX);
    if (idx === -1 || lines[idx].category) return;
    const expense = expenseById[data.sourceDocId];
    if (!expense || !expense.category) return;
    const newLines = lines.map((l, i) => (i === idx ? { ...l, category: expense.category } : l));
    patches.push(
      addDoc(collection(db, 'journal_entries'), { ...data, lines: newLines })
        .then(() => deleteDoc(d.ref))
    );
  });

  if (patches.length > 0) await Promise.all(patches);
  return patches.length;
};

// =====================================================================
// MIGRASI DATA AWAL — backfill jurnal dari SEMUA data lama yang udah ada
// sebelum fitur Jurnal ini rilis, biar Neraca/Buku Besar akurat sejak
// hari pertama (bukan mulai dari nol).
//
// SEKALI JALAN doang (dijaga flag `settings/journal_migration.done`) —
// kalau udah pernah sukses, manggil ini lagi bakal langsung ditolak
// (throw), biar nggak keposting dobel. Data yang dibutuhkan (financial
// accounts, bookings, dst) sengaja DITERIMA sebagai parameter (bukan
// query sendiri di sini) — modul Laporan Keuangan yang manggil ini SUDAH
// fetch semua collection itu buat kebutuhan laporan lain, jadi nggak
// perlu baca Firestore dua kali.
//
// CATATAN KETERBATASAN: "Titip Deposit" (deposit_ledger) sengaja BELUM
// di-backfill di versi ini — datanya nyebar di collection terpisah dgn
// beberapa jenis transaksi (topup/usage/refund_conversion) yang volumenya
// jauh lebih kecil & manual dibanding 6 sumber utama di bawah. Saldo akun
// 2101 (Utang Deposit Jamaah) di Neraca, akibatnya, bisa sedikit meleset
// dari saldo asli `jamaah.depositBalance` sampai ini di-backfill juga
// (bisa nyusul kalau perlu).
// =====================================================================
export const runInitialJournalMigration = async ({
  financialAccounts, bookings, paymentsIncome, paymentsVendor, operationalExpenses, packages,
  createdByUid, createdByName
}) => {
  const flagRef = doc(db, 'settings', 'journal_migration');
  const flagSnap = await getDoc(flagRef);
  if (flagSnap.exists() && flagSnap.data().done) {
    throw new Error(`Migrasi data awal sudah pernah dijalankan sebelumnya (tanggal ${flagSnap.data().migratedAt || '-'}). Nggak bisa dijalankan dua kali biar jurnal nggak dobel-catat.`);
  }

  await seedChartOfAccounts();

  const summary = { created: 0, skipped: 0, errors: [] };
  const safe = async (fn, label) => {
    try {
      const res = await fn();
      if (res) summary.created += 1; else summary.skipped += 1;
    } catch (err) {
      summary.errors.push(`${label}: ${err.message}`);
    }
  };

  // 1. Saldo awal tiap akun Kas/Bank
  for (const acc of (financialAccounts || [])) {
    const opening = Number(acc.openingBalance) || 0;
    if (opening === 0) { summary.skipped += 1; continue; }
    await safe(() => postJournalEntry({
      date: acc.createdAt || new Date().toISOString(),
      description: `Saldo Awal - ${acc.name}`,
      source: 'opening_balance', sourceDocId: acc.id, reference: acc.name,
      lines: [
        glLine(ACC.KAS_BANK, opening, 0, { accountId: acc.id, accountName: acc.name }),
        glLine(ACC.MODAL, 0, opening),
      ],
      createdByUid, createdByName
    }), `Saldo awal ${acc.name}`);
  }

  // 2. Semua booking (aktif, cancelled, rescheduled) — piutang + pendapatan
  //    diterima dimuka diakui penuh persis kayak alur baru.
  for (const b of (bookings || [])) {
    await safe(() => postBookingCreated({
      bookingId: b.id, bookingCode: b.bookingCode, totalAmount: b.totalAmount,
      date: b.createdAt, createdByUid, createdByName
    }), `Booking ${b.bookingCode || b.id}`);
  }

  // 3. Semua setoran jamaah
  for (const p of (paymentsIncome || [])) {
    await safe(() => postIncomePayment({
      paymentId: p.id, bookingCode: p.bookingCode, amount: p.amount, paymentMethod: p.paymentMethod,
      accountId: p.accountId, accountName: p.accountName, date: p.createdAt, createdByUid, createdByName
    }), `Setoran ${p.bookingCode || p.id}`);
  }

  // 4. Semua pembayaran vendor — diperlakukan AD-HOC semua (billId null),
  //    soalnya fitur Tagihan Vendor baru mulai ada sejak migrasi ini rilis.
  for (const v of (paymentsVendor || [])) {
    await safe(() => postVendorPayment({
      paymentId: v.id, vendorName: v.vendorName, amount: v.amount, payMethod: v.payMethod,
      accountId: v.accountId, accountName: v.accountName, billId: null,
      date: v.createdAt, createdByUid, createdByName
    }), `Bayar Vendor ${v.vendorName || v.id}`);
  }

  // 5. Semua biaya operasional
  for (const e of (operationalExpenses || [])) {
    await safe(() => postOperationalExpense({
      expenseId: e.id, category: e.category, amount: e.amount,
      accountId: e.accountId, accountName: e.accountName,
      date: e.expenseDate || e.createdAt, createdByUid, createdByName
    }), `Opex ${e.category || e.id}`);
  }

  // 6. Paket yang statusnya UDAH "Akui Pendapatan" — reklas ke Pendapatan +
  //    HPP, pakai metrik sama persis kayak yang ditampilin P&L existing
  //    (live-sum payments_income/payments_vendor by packageId, fallback
  //    packageName).
  for (const pkg of (packages || [])) {
    if (!pkg.revenueRecognized) continue;
    const incomeTotal = (paymentsIncome || [])
      .filter(p => (p.packageId ? p.packageId === pkg.id : p.packageName === pkg.name))
      .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const vendorTotal = (paymentsVendor || [])
      .filter(v => (v.packageId ? v.packageId === pkg.id : v.packageName === pkg.name))
      .reduce((acc, v) => acc + (Number(v.amount) || 0), 0);
    await safe(() => postRevenueRecognition({
      packageId: pkg.id, packageName: pkg.name, incomeTotal, vendorTotal,
      date: pkg.recognizedAt || new Date().toISOString(), createdByUid, createdByName
    }), `Akui Pendapatan ${pkg.name || pkg.id}`);
  }

  // 7. Booking yang statusnya cancelled — write-off piutang sisa + jurnal refund.
  for (const b of (bookings || [])) {
    if (b.status !== 'cancelled') continue;
    const pkg = (packages || []).find(p => p.id === b.packageId);
    const writeOffAmount = Math.max(0, (Number(b.totalAmount) || 0) - (Number(b.totalPaid) || 0));
    await safe(() => postBookingCancelRefund({
      bookingId: b.id, bookingCode: b.bookingCode,
      writeOffAmount, refundAmount: Number(b.refundAmount) || 0,
      isRecognized: !!(pkg && pkg.revenueRecognized),
      refundToDeposit: b.refundMethod === 'Deposit / Saldo Akun',
      accountId: b.refundAccountId, accountName: b.refundAccountName,
      date: b.cancelledAt || b.createdAt, createdByUid, createdByName
    }), `Batal ${b.bookingCode || b.id}`);
  }

  await setDoc(flagRef, {
    done: true,
    migratedAt: new Date().toISOString(),
    migratedByUid: createdByUid || '',
    migratedByName: createdByName || '',
    summary: { created: summary.created, skipped: summary.skipped, errorCount: summary.errors.length }
  });

  return summary;
};

// =====================================================================
// KOREKSI DAMPAK RESCHEDULE DI MIGRASI DATA AWAL — lihat catatan
// MEDIUM-HIGH di Audit Sistem 9 Sep 2026 (§2). Alur reschedule yang
// LIVE (BookingsModule.jsx handleRescheduleSubmit/handleGroupRescheduleSubmit)
// udah bener dari awal: begitu booking di-reschedule, booking lama
// "ditutup buku" (write-off sisa piutang) dan setoran Carry-Over-nya
// direklas (BUKAN dianggap kas baru). Masalahnya cuma di
// `runInitialJournalMigration` — itu jurnal SEMUA booking (termasuk yang
// statusnya udah 'rescheduled' sebelum migrasi jalan) secara penuh tanpa
// nutup buku booking lamanya, DAN nganggep dokumen payments_income
// `paymentMethod: 'Carry-Over Reschedule'` sebagai setoran kas beneran
// (padahal itu cuma catatan pemindahan, bukan uang masuk) — jadi
// Piutang Jamaah & Kas/Bank di Neraca bisa kelebihan catat untuk
// booking-booking yang di-reschedule SEBELUM migrasi ini pernah jalan.
//
// Dua fungsi di bawah ini READ-ONLY DULU (diagnose) baru APPLY (correction)
// — dipisah sengaja, biar staf bisa liat dulu angka & daftar booking yang
// kena dampak sebelum ada jurnal apapun yang diposting, bukan main
// langsung apply dari balik layar.
// =====================================================================

// Diagnosa (READ-ONLY, nggak nulis apapun ke Firestore) — nerima data yang
// UDAH di-fetch pemanggil (LaporanKeuanganModule udah punya semuanya di
// state), biar nggak query Firestore dua kali. Balikin daftar booking lama
// yang KEMUNGKINAN masih kena dampak (belum pernah ditutup buku via jurnal
// `booking_cancel_refund` bersourceDocId `refund_<id>`-nya), lengkap sama
// nominal potensi koreksinya, plus total keseluruhan.
export const diagnoseRescheduleMigrationImpact = ({ bookings, paymentsIncome, journalEntries }) => {
  const bookingById = {};
  (bookings || []).forEach(b => { bookingById[b.id] = b; });

  // sourceDocId booking_cancel_refund SELALU `refund_<bookingId>` (lihat
  // postBookingCancelRefund), jadi cukup dicek ada/enggaknya per id, nggak
  // perlu ngecek isi baris jurnalnya.
  const writeOffSourceDocIds = new Set(
    (journalEntries || [])
      .filter(e => e.source === 'booking_cancel_refund')
      .map(e => e.sourceDocId)
  );
  // sourceDocId booking_reschedule_carryover SELALU id booking BARU (lihat
  // handleRescheduleSubmit/handleGroupRescheduleSubmit).
  const carryoverReclassDoneForNewBookingId = new Set(
    (journalEntries || [])
      .filter(e => e.source === 'booking_reschedule_carryover')
      .map(e => e.sourceDocId)
  );

  const affected = [];
  let totalWriteOff = 0;
  let totalGhostCash = 0;

  (bookings || []).forEach(oldBooking => {
    if (oldBooking.status !== 'rescheduled') return;
    if (writeOffSourceDocIds.has(`refund_${oldBooking.id}`)) return; // udah pernah ditutup buku (via live code ATAU koreksi sebelumnya) — skip

    const newBooking = oldBooking.rescheduledToBookingId ? bookingById[oldBooking.rescheduledToBookingId] : null;
    const carryoverPayment = newBooking
      ? (paymentsIncome || []).find(p => p.bookingId === newBooking.id && p.paymentMethod === 'Carry-Over Reschedule')
      : null;
    const carryoverAlreadyReclassed = newBooking ? carryoverReclassDoneForNewBookingId.has(newBooking.id) : false;

    const writeOffAmount = Math.max(0, (Number(oldBooking.totalAmount) || 0) - (Number(oldBooking.totalPaid) || 0));
    const ghostCashAmount = (!carryoverAlreadyReclassed && carryoverPayment) ? (Number(carryoverPayment.amount) || 0) : 0;

    if (writeOffAmount <= 0 && ghostCashAmount <= 0) return; // nggak ada dampak nominal apapun, aman dilewati

    affected.push({
      oldBookingId: oldBooking.id,
      oldBookingCode: oldBooking.bookingCode,
      oldJamaahName: oldBooking.jamaahName,
      newBookingId: newBooking?.id || null,
      newBookingCode: newBooking?.bookingCode || oldBooking.rescheduledToBookingCode || '-',
      writeOffAmount,
      ghostCashAmount,
      carryoverPaymentId: carryoverPayment?.id || null,
    });
    totalWriteOff += writeOffAmount;
    totalGhostCash += ghostCashAmount;
  });

  return { affected, totalWriteOff, totalGhostCash, count: affected.length };
};

// Terapkan koreksi (SEKALI per booking, aman dipanggil ulang — tiap item
// di-cek lagi idempotency-nya sebelum nulis apapun). Nerima `affected`
// persis dari hasil diagnoseRescheduleMigrationImpact di atas, `packages`
// buat nentuin isRecognized booking lama (best-effort — pakai status
// SEKARANG, bukan status persis di detik reschedule terjadi dulu, karena
// histori itu nggak kesimpen), dan `financialAccounts`/`bookings` cuma
// buat lookup nama & sinkron.
export const applyRescheduleMigrationCorrection = async ({ affected, bookings, packages, createdByUid, createdByName }) => {
  const bookingById = {};
  (bookings || []).forEach(b => { bookingById[b.id] = b; });

  const summary = { corrected: 0, skipped: 0, errors: [] };

  for (const item of (affected || [])) {
    try {
      // Re-cek idempotency langsung ke Firestore (bukan cuma dari snapshot
      // diagnosa) — jaga-jaga kalau ada 2 tab/staf yang nge-klik "Terapkan
      // Koreksi" hampir bersamaan, atau data udah berubah sejak diagnosa
      // ditampilin.
      const existingWriteOff = await getDocs(query(
        collection(db, 'journal_entries'),
        where('source', '==', 'booking_cancel_refund'),
        where('sourceDocId', '==', `refund_${item.oldBookingId}`)
      ));
      const alreadyDone = existingWriteOff.docs.length > 0;
      if (alreadyDone) { summary.skipped += 1; continue; }

      const oldBooking = bookingById[item.oldBookingId];
      const oldPkg = (packages || []).find(p => p.id === oldBooking?.packageId);

      // 1. Reklas Carry-Over — samain PERSIS logic yang dipakai alur
      //    reschedule LIVE: lepas dulu jurnal `income_payment` yang salah
      //    (migrasi lama nganggep carry-over sebagai kas beneran masuk),
      //    baru pasang jurnal reklas yang benar (Pendapatan Diterima Dimuka
      //    booking lama -> pengurang Piutang Jamaah booking baru, BUKAN kas).
      if (item.ghostCashAmount > 0 && item.carryoverPaymentId) {
        await deleteJournalEntriesBySource('income_payment', item.carryoverPaymentId);
        await postJournalEntry({
          date: new Date().toISOString(),
          description: `Koreksi Migrasi — Carry-Over Reschedule ${item.oldBookingCode} -> ${item.newBookingCode}`,
          source: 'booking_reschedule_carryover', sourceDocId: item.newBookingId, reference: item.newBookingCode,
          lines: [
            glLine(ACC.PENDAPATAN_DITERIMA_DIMUKA, item.ghostCashAmount, 0),
            glLine(ACC.PIUTANG_JAMAAH, 0, item.ghostCashAmount),
          ],
          createdByUid, createdByName
        });
      }

      // 2. Tutup buku booking lama — write-off sisa piutang yang nggak
      //    akan pernah ketagih (persis pola postBookingCancelRefund yang
      //    sama dipakai alur reschedule/batal LIVE).
      if (item.writeOffAmount > 0) {
        await postBookingCancelRefund({
          bookingId: item.oldBookingId, bookingCode: item.oldBookingCode,
          writeOffAmount: item.writeOffAmount, refundAmount: 0,
          isRecognized: !!(oldPkg && oldPkg.revenueRecognized),
          date: new Date().toISOString(), createdByUid, createdByName
        });
      }

      summary.corrected += 1;
    } catch (err) {
      summary.errors.push(`${item.oldBookingCode || item.oldBookingId}: ${err.message}`);
    }
  }

  return summary;
};

// ---------------------------------------------------------------------
// Diagnosa & koreksi booking yang KESIMPEN tapi jurnalnya GAGAL keposting
// (postBookingCreated dipanggil pakai `.catch(console.error)` di
// BookingsModule.jsx — booking-nya sendiri tetap sukses tersimpan walau
// jurnalnya gagal, misal network/permission error pas prosesnya). Pola
// diagnose-dulu-baru-apply ini SAMA PERSIS kayak
// diagnoseRescheduleMigrationImpact/applyRescheduleMigrationCorrection di
// atas — read-only dulu, biar staf bisa liat daftarnya sebelum ada jurnal
// baru yang diposting.
// ---------------------------------------------------------------------
export const diagnoseMissingBookingJournals = ({ bookings, journalEntries }) => {
  // Booking dianggap "udah kejurnal" kalau ada journal_entries dengan
  // source 'booking_created' & sourceDocId = id booking itu — persis
  // pola postBookingCreated di atas.
  const journaledBookingIds = new Set(
    (journalEntries || []).filter(e => e.source === 'booking_created').map(e => e.sourceDocId)
  );

  // Cuma booking status 'active' yang di-cek (booking yang udah
  // dibatalkan/di-reschedule dilewatin dulu — akuntansinya lebih rumit
  // karena ada 2 kemungkinan bolong sekaligus (booking_created DAN
  // booking_cancel_refund/booking_reschedule_carryover-nya), jadi lebih
  // aman dicek manual daripada di-auto-koreksi di sini).
  const affected = (bookings || [])
    .filter(b => (b.status || 'active') === 'active')
    .filter(b => Number(b.totalAmount || 0) > 0)
    .filter(b => !journaledBookingIds.has(b.id))
    .map(b => ({
      bookingId: b.id,
      bookingCode: b.bookingCode,
      jamaahName: b.jamaahName,
      totalAmount: Number(b.totalAmount || 0),
      createdAt: b.createdAt,
    }));

  const totalAmount = affected.reduce((acc, b) => acc + b.totalAmount, 0);
  return { affected, totalAmount, count: affected.length };
};

export const applyMissingBookingJournalsCorrection = async ({ affected, createdByUid, createdByName }) => {
  const summary = { corrected: 0, skipped: 0, errors: [] };
  for (const item of (affected || [])) {
    try {
      // Cek ulang tepat sebelum posting (bukan cuma pas diagnosa) — jaga-
      // jaga kalau ada 2 orang buka modal ini bersamaan, atau ada jurnal
      // yang masuk di antara diagnosa & klik Terapkan Koreksi.
      const existing = await getDocs(query(
        collection(db, 'journal_entries'),
        where('source', '==', 'booking_created'),
        where('sourceDocId', '==', item.bookingId)
      ));
      if (existing.docs.length > 0) { summary.skipped += 1; continue; }

      const posted = await postBookingCreated({
        bookingId: item.bookingId, bookingCode: item.bookingCode, totalAmount: item.totalAmount,
        date: item.createdAt || new Date().toISOString(), createdByUid, createdByName
      });
      if (posted) summary.corrected += 1; else summary.skipped += 1;
    } catch (err) {
      summary.errors.push(`${item.bookingCode || item.bookingId}: ${err.message}`);
    }
  }
  return summary;
};

// ---------------------------------------------------------------------
// Rekonsiliasi Piutang Jamaah PER BOOKING — dipakai buat nyari tau
// PERSIS booking mana yang bikin "1201 - Piutang Jamaah" di Neraca beda
// sama "Total Piutang Jamaah" di tab Piutang & Hutang (yang itu live-sum
// dari bookingsList, independen dari jurnal). Dibikin nyusul laporan user
// kalau selisihnya malah MELEBAR & KEBALIK arah setelah nge-klik "Cek
// Booking Belum Terjurnal" — indikasi kuat ada jurnal `booking_created`
// yang keposting DOBEL, bukan genuinely ada yang belum kejurnal.
//
// Caranya: kelompokkan SEMUA baris jurnal yang nyentuh akun 1201 by
// `reference`-nya — SELALU bookingCode di setiap fungsi yang nyentuh akun
// ini (postBookingCreated, postIncomePayment, postBookingCancelRefund,
// reklas carry-over reschedule — cek semua di atas), jadi ini valid buat
// SEMUA jenis transaksi yang pernah gerakin Piutang Jamaah booking itu,
// bukan cuma booking_created doang. Bandingin net-nya (Debit - Kredit)
// sama liveOutstanding (totalAmount - totalPaid, PERSIS rumus ArApTab) —
// yang beda berarti ada bolong (diff negatif) atau dobel-catat (diff
// positif) buat booking itu spesifik.
export const diagnoseArReconciliation = ({ bookings, journalEntries }) => {
  const journalNetByRef = {};
  (journalEntries || []).forEach(e => {
    const ref = e.reference || '';
    if (!ref) return;
    (e.lines || []).forEach(l => {
      if (l.accountCode !== ACC.PIUTANG_JAMAAH) return;
      journalNetByRef[ref] = (journalNetByRef[ref] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0);
    });
  });

  // Deteksi eksplisit dobel-posting `booking_created` (2+ entry dengan
  // source+sourceDocId PERSIS sama) — ini indikator paling gamblang ada
  // jurnal yang keposting berkali-kali buat booking yang sama (misal gara-
  // gara "Cek Booking Belum Terjurnal" salah nandain booking yang
  // sebenarnya udah kejurnal duluan sebagai "belum").
  const bookingCreatedCountBySourceDocId = {};
  (journalEntries || []).forEach(e => {
    if (e.source !== 'booking_created') return;
    bookingCreatedCountBySourceDocId[e.sourceDocId] = (bookingCreatedCountBySourceDocId[e.sourceDocId] || 0) + 1;
  });
  const duplicateBookingCreated = Object.entries(bookingCreatedCountBySourceDocId)
    .filter(([, count]) => count > 1)
    .map(([bookingId, count]) => {
      const b = (bookings || []).find(bk => bk.id === bookingId);
      return { bookingId, bookingCode: b?.bookingCode || bookingId, jamaahName: b?.jamaahName || '-', count };
    });

  const mismatches = (bookings || [])
    .filter(b => (b.status || 'active') === 'active')
    .map(b => {
      const liveOutstanding = Math.max(0, Number(b.totalAmount || 0) - Number(b.totalPaid || 0));
      const journalNet = journalNetByRef[b.bookingCode] || 0;
      const diff = Math.round(journalNet - liveOutstanding);
      const isDuplicate = (bookingCreatedCountBySourceDocId[b.id] || 0) > 1;
      return {
        bookingId: b.id, bookingCode: b.bookingCode, jamaahName: b.jamaahName,
        totalAmount: Number(b.totalAmount || 0), totalPaid: Number(b.totalPaid || 0),
        liveOutstanding, journalNet, diff, isDuplicate,
      };
    })
    .filter(item => Math.abs(item.diff) > 1)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const totalDiff = mismatches.reduce((acc, m) => acc + m.diff, 0);

  return { mismatches, totalDiff, duplicateBookingCreated, count: mismatches.length };
};

// Koreksi KHUSUS buat kasus dobel-posting `booking_created` yang kedetek
// di atas — per booking yang kena, pertahankan entry yang PALING DULU
// dibuat (`createdAt` jurnal paling kecil = yang asli), hapus sisanya
// (yang keposting belakangan = hasil dobel/salah diagnosa). Query ulang
// LANGSUNG ke Firestore (bukan dari snapshot diagnosa) biar dapet urutan
// createdAt yang akurat & aman diulang (kalau udah cuma tersisa 1, di-skip).
export const removeDuplicateBookingCreatedEntries = async ({ duplicateBookingCreated }) => {
  const summary = { deleted: 0, keptBookings: 0, errors: [] };
  for (const item of (duplicateBookingCreated || [])) {
    try {
      const snap = await getDocs(query(
        collection(db, 'journal_entries'),
        where('source', '==', 'booking_created'),
        where('sourceDocId', '==', item.bookingId)
      ));
      if (snap.docs.length <= 1) continue; // udah kekoreksi duluan / nggak jadi dobel
      const sorted = snap.docs.slice().sort((a, b) => (a.data().createdAt || '').localeCompare(b.data().createdAt || ''));
      const [, ...extras] = sorted; // buang yang pertama (dipertahankan), sisanya dihapus
      for (const d of extras) {
        await deleteDoc(d.ref);
        summary.deleted += 1;
      }
      summary.keptBookings += 1;
    } catch (err) {
      summary.errors.push(`${item.bookingCode || item.bookingId}: ${err.message}`);
    }
  }
  return summary;
};
