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
};

// Bikin 1 baris jurnal. `extra` dipakai buat nempelin accountId/accountName
// (KHUSUS baris yang nyentuh akun 1101 Kas & Bank) biar baris itu bisa
// dilacak balik ke doc `financial_accounts` mana persisnya — dipakai laporan
// Arus Kas & rekonsiliasi saldo kas per rekening.
const glLine = (code, debit = 0, credit = 0, extra = {}) => ({
  accountCode: code,
  accountName: COA_NAME_BY_CODE[code] || code,
  debit: Math.round(Number(debit) || 0),
  credit: Math.round(Number(credit) || 0),
  ...(extra.accountId ? { accountId: extra.accountId } : {}),
  ...(extra.accountName ? { financialAccountName: extra.accountName } : {}),
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

// 6. Biaya Operasional — selalu tunai/bank, nggak ada opsi deposit.
export const postOperationalExpense = async ({ expenseId, category, amount, accountId, accountName, date, createdByUid, createdByName }) => {
  const amt = Number(amount) || 0;
  if (amt <= 0) return null;
  return postJournalEntry({
    date, description: `Biaya Operasional - ${category || '-'}`,
    source: 'operational_expense', sourceDocId: expenseId, reference: category || '',
    lines: [
      glLine(ACC.OPEX, amt, 0),
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