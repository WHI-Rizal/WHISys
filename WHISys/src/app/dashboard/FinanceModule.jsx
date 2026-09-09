'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, getDoc, setDoc, deleteDoc, doc, updateDoc, query, where, increment } from 'firebase/firestore';
import { Wallet, ArrowDownLeft, ArrowUpRight, X, Trash2, TrendingUp, BarChart3, Eye, Building2, CheckCircle2, RotateCcw, Clock, Download, Pencil, Plus, Settings, FileBarChart, ChevronDown, ChevronRight } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import DateFieldID from '@/components/DateFieldID';
import { logActivity } from '../../lib/activityLog';
import { calculatePPN } from '../../lib/ppn';
import {
  postIncomePayment, postDepositTopup, postVendorBillCreated, postVendorPayment,
  postOperationalExpense,
  deleteJournalEntriesBySource
} from '../../lib/journal';

const DEFAULT_COMPANY_PROFILE = {
  name: 'PT. WISATA HALAL INTERNASIONAL',
  ppiuNumber: '',
  address: '',
  phone: '',
  email: ''
};

const loadImageAsDataURL = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    } catch (err) {
      reject(err);
    }
  };
  img.onerror = reject;
  img.src = src;
});

// Daftar bank umum utk field "Nama Bank" begitu Metode Bayar dipilih
// "Transfer Bank" — samain sama yang ada di BookingsModule.jsx.
const BANK_LIST = ['BCA', 'Mandiri', 'BNI', 'BRI', 'BSI (Bank Syariah Indonesia)', 'CIMB Niaga', 'Danamon', 'Permata', 'BTN', 'Bank Lainnya'];

// Resolusi nama bank final dari pasangan field bankName/customBankName.
const resolveBankName = (bankName, customBankName) => {
  if (bankName === 'Bank Lainnya') return (customBankName || '').trim() || 'Bank Lainnya';
  return bankName || '';
};

const OPERATIONAL_CATEGORIES = [
  'Sewa Kantor',
  'Gaji Staff',
  'Listrik & Internet',
  'ATK',
  'Marketing',
  'Komisi Mitra/Agen',
  'Lain-lain'
];

const VENDOR_CATEGORIES = [
  'Tiket Pesawat',
  'Hotel Makkah',
  'Hotel Madinah',
  'Visa & Siskopatuh',
  'LA & Bus Transport',
  'Perlengkapan Koper',
  'Lain-lain'
];

// ID dokumen konfigurasi daftar Kategori Vendor yang bisa diedit user —
// sengaja "disamarkan" sebagai salah satu dokumen di collection 'vendors'
// (bukan collection terpisah) supaya hak akses tulisnya otomatis ikut
// aturan Firestore Rules yang udah ada buat kelola data vendor
// (Finance & Super Admin), tanpa perlu minta perubahan rules baru.
const VENDOR_CATEGORY_CONFIG_ID = '_categories_config';

// Sama persis pola-nya kayak VENDOR_CATEGORY_CONFIG_ID di atas, cuma buat
// daftar Kategori Biaya Operasional — "disamarkan" jadi 1 dokumen di
// collection 'expenses_operational' sendiri biar ikut hak akses tulis yang
// udah ada (Finance/Super Admin), nggak perlu Firestore Rules baru.
const OPEX_CATEGORY_CONFIG_ID = '_categories_config';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const todayISODate = () => new Date().toISOString().slice(0, 10);

// Gabungkan tanggal setoran yang dipilih staff dengan jam-menit-detik
// SEKARANG, biar createdAt tetap kronologis kalau dibandingkan sama transaksi
// lain yang dicatat hari yang sama — sama persis dgn resolvePaymentCreatedAt
// yang dipakai di BookingsModule.jsx.
// Tanggal setoran nggak boleh diisi SEBELUM tanggal pemesanan/booking-nya
// sendiri dibuat — nggak masuk akal ada uang masuk sebelum bookingnya ada.
// Ambil bagian yyyy-mm-dd doang dari createdAt biar perbandingannya adil
// (createdAt aslinya nyimpen jam-menit-detik juga).
const getBookingMinDate = (createdAt) => (createdAt ? String(createdAt).slice(0, 10) : '');
const isPaymentDateBeforeBooking = (paymentDateStr, bookingCreatedAt) => {
  const minDate = getBookingMinDate(bookingCreatedAt);
  return !!(paymentDateStr && minDate && paymentDateStr < minDate);
};

const resolvePaymentCreatedAt = (dateStr) => {
  if (!dateStr) return new Date().toISOString();
  const now = new Date();
  const timePart = now.toTimeString().slice(0, 8);
  const combined = new Date(`${dateStr}T${timePart}`);
  return isNaN(combined.getTime()) ? now.toISOString() : combined.toISOString();
};

// Bungkus 1 baris "transaksi setoran" hasil gabungan sejumlah dokumen
// payments_income yang lahir dari 1x setoran yang sama tapi kesplit ke
// beberapa peserta dalam 1 grup booking (lihat groupTransactionId).
const buildIncomeRow = (docs, bookingsById, isFallbackMerge) => {
  const totalAmount = docs.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
  const first = docs[0];
  const bookingIds = Array.from(new Set(docs.map(d => d.bookingId).filter(Boolean)));
  const relatedBookings = bookingIds.map(id => bookingsById[id]).filter(Boolean);
  const groupCode = relatedBookings[0]
    ? (relatedBookings[0].groupBookingCode || relatedBookings[0].bookingCode)
    : (first.bookingCode || '-');
  const paxCount = relatedBookings.length > 0 ? relatedBookings.length : docs.length;
  const isMerged = docs.length > 1;
  let notes = (first.notes || '').replace(/\s*\(Grup[^)]*\)\s*$/, '').trim();
  if (isMerged) {
    notes = `${notes}${notes ? ' ' : ''}(Gabungan ${paxCount} peserta)`;
    if (isFallbackMerge) notes += ' — digabung otomatis, estimasi';
  }
  return {
    key: isMerged ? `merged_${docs.map(d => d.id).join('_')}` : first.id,
    docs,
    isMerged,
    amount: totalAmount,
    paymentMethod: first.paymentMethod,
    bankName: first.bankName || '',
    accountName: first.accountName || '',
    notes,
    createdAt: first.createdAt,
    groupCode,
    paxCount,
    packageName: first.packageName,
    jamaahName: first.jamaahName,
    ordererName: (relatedBookings[0] && relatedBookings[0].ordererName) || first.ordererName || '',
    bookingId: first.bookingId
  };
};

// Gabungkan seluruh transaksi payments_income jadi baris per TRANSAKSI ASLI
// (bukan per pecahan pax) — dokumen yang berbagi groupTransactionId yang sama
// digabung akurat (ditulis pas app benar-benar nge-split 1 setoran ke banyak
// pax dalam 1 grup booking). Data lama tanpa groupTransactionId dicoba
// digabung pakai heuristik (kode grup + metode + catatan + menit yang sama),
// ditandai jelas "digabung otomatis, estimasi" kalau kepakai.
const buildMergedIncomeRows = (paymentsFlat, bookingsList) => {
  const bookingsById = {};
  bookingsList.forEach(b => { bookingsById[b.id] = b; });
  const resolveGroupCode = (tx) => {
    const bk = bookingsById[tx.bookingId];
    return bk ? (bk.groupBookingCode || bk.bookingCode) : (tx.bookingCode || '-');
  };

  const withGtx = paymentsFlat.filter(p => p.groupTransactionId);
  const withoutGtx = paymentsFlat.filter(p => !p.groupTransactionId);

  const rows = [];
  const gtxMap = {};
  withGtx.forEach(p => {
    if (!gtxMap[p.groupTransactionId]) gtxMap[p.groupTransactionId] = [];
    gtxMap[p.groupTransactionId].push(p);
  });
  Object.values(gtxMap).forEach(docs => rows.push(buildIncomeRow(docs, bookingsById, false)));

  const fallbackMap = {};
  withoutGtx.forEach(p => {
    const key = `${resolveGroupCode(p)}||${p.paymentMethod || ''}||${(p.notes || '')}||${(p.createdAt || '').slice(0, 16)}`;
    if (!fallbackMap[key]) fallbackMap[key] = [];
    fallbackMap[key].push(p);
  });
  Object.values(fallbackMap).forEach(docs => {
    if (docs.length >= 2) {
      rows.push(buildIncomeRow(docs, bookingsById, true));
    } else {
      docs.forEach(p => rows.push(buildIncomeRow([p], bookingsById, false)));
    }
  });

  return rows;
};

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const getPeriodKey = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const formatPeriodLabel = (periodKey) => {
  if (!periodKey || periodKey === 'all') return 'Semua Periode';
  const [year, month] = periodKey.split('-');
  return `${MONTH_NAMES_ID[Number(month) - 1]} ${year}`;
};

// Format tanggal jadi "22 September 2026" — dipakai buat label rentang
// tanggal custom (mis. Laporan Closing TC, biar HR bisa atur cutoff payroll
// sendiri, nggak kepatok tanggal 1-akhir bulan kalender).
const formatDateLabelID = (dateStr) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getDate()} ${MONTH_NAMES_ID[d.getMonth()]} ${d.getFullYear()}`;
};

const formatDateRangeLabel = (start, end) => {
  if (!start && !end) return 'Semua Periode';
  if (start && end) return `${formatDateLabelID(start)} – ${formatDateLabelID(end)}`;
  if (start) return `Mulai ${formatDateLabelID(start)}`;
  return `Sampai ${formatDateLabelID(end)}`;
};

// Ambil cuma bagian tanggal (YYYY-MM-DD) dari sebuah dateString/ISO string,
// berdasarkan komponen tanggal LOKAL (bukan UTC) — konsisten sama
// formatDateDDMMYYYY & getPeriodKey di atas, biar nggak ada pergeseran
// tanggal gara-gara beda timezone pas dibandingin sama input <input type="date">.
const toLocalDateOnlyString = (dateInput) => {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Konversi 1 bulan kalender ("YYYY-MM") jadi rentang tanggal awal-akhir
// bulan itu ("YYYY-MM-01" s/d tanggal terakhir bulan itu) — dipakai buat
// shortcut "Pilih Bulan" di Laporan Closing TC, biar tetap ada cara cepat
// milih 1 bulan penuh kayak sebelumnya, di samping opsi rentang tanggal bebas.
const getMonthBoundaries = (monthKey) => {
  if (!monthKey) return null;
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return null;
  const lastDay = new Date(y, m, 0).getDate();
  return { start: `${monthKey}-01`, end: `${monthKey}-${String(lastDay).padStart(2, '0')}` };
};

// Default rentang tanggal Laporan Closing TC = siklus cutoff payroll HRD
// (tanggal 22 - 21 bulan berikutnya), otomatis ngikutin tanggal hari ini:
// - Kalau hari ini udah tanggal 22 ke atas, berarti lagi masuk siklus BARU
//   yang baru mulai (22 bulan ini - 21 bulan depan).
// - Kalau belum, berarti masih di siklus yang dimulai bulan lalu
//   (22 bulan lalu - 21 bulan ini).
// Tetap bisa diubah bebas lewat 2 input tanggal di UI kalau HR butuh
// rentang lain di luar pola 22-21 ini.
const getDefaultPayrollCutoffRange = () => {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-indexed
  const d = today.getDate();
  const pad = (n) => String(n).padStart(2, '0');

  let startY, startM, endY, endM;
  if (d >= 22) {
    startY = y; startM = m;
    endM = (m + 1) % 12;
    endY = m === 11 ? y + 1 : y;
  } else {
    endY = y; endM = m;
    startM = (m + 11) % 12;
    startY = m === 0 ? y - 1 : y;
  }
  return {
    start: `${startY}-${pad(startM + 1)}-22`,
    end: `${endY}-${pad(endM + 1)}-21`
  };
};

export default function FinanceModule({ onSelectBooking, theme = 'dark', currentUser = null }) {
  const isDark = theme === 'dark';

  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    tableHeaderBg: isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-slate-100 text-slate-500',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    tableRowBorder: isDark ? 'divide-slate-800/60' : 'divide-slate-200',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
    tabActive: isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-300 text-slate-900 font-bold',
  };

  const [transactions, setTransactions] = useState([]);
  const [vendorPayments, setVendorPayments] = useState([]);
  const [operationalExpenses, setOperationalExpenses] = useState([]);
  const [bookingsList, setBookingsList] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [jamaahList, setJamaahList] = useState([]);
  const [financialAccounts, setFinancialAccounts] = useState([]);
  const [vendorsList, setVendorsList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Data Master Vendor — nama & kategori vendor dikelola terpusat di sini,
  // plus saldo deposit vendor (nampung DP block seat yang batal tapi
  // nggak hangus, bisa dipakai lagi buat booking baru ke vendor yang sama).
  const [showVendorMasterModal, setShowVendorMasterModal] = useState(false);
  const [editingVendorMasterId, setEditingVendorMasterId] = useState(null);
  const [vendorMasterForm, setVendorMasterForm] = useState({ name: '', category: VENDOR_CATEGORIES[0] });

  // Kategori Vendor sekarang bisa ditambah/diedit sendiri lewat tombol
  // "Kelola Kategori" (nggak melulu daftar bawaan VENDOR_CATEGORIES lagi).
  // Disimpan sebagai satu dokumen konfigurasi di collection 'vendors' sendiri
  // (id tetap '_categories_config', ditandai isCategoryConfig:true dan
  // disaring keluar dari vendorsList) — biar hak akses tulisnya otomatis
  // sama kayak yang udah berlaku buat kelola data vendor (Finance/Admin),
  // tanpa perlu ubah Firestore Rules lagi.
  const [vendorCategories, setVendorCategories] = useState(VENDOR_CATEGORIES);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState([]);
  const [newCategoryText, setNewCategoryText] = useState('');
  const [savingCategories, setSavingCategories] = useState(false);

  // Kategori Biaya Operasional — pola sama persis kayak Kategori Vendor di
  // atas, bisa ditambah/diedit/dihapus sendiri lewat "Kelola Kategori".
  const [operationalCategories, setOperationalCategories] = useState(OPERATIONAL_CATEGORIES);
  const [showOpexCategoryModal, setShowOpexCategoryModal] = useState(false);
  const [opexCategoryDraft, setOpexCategoryDraft] = useState([]);
  const [newOpexCategoryText, setNewOpexCategoryText] = useState('');
  const [savingOpexCategories, setSavingOpexCategories] = useState(false);

  // Modal "Konversi ke Saldo Deposit" — dibuka dari 1 baris riwayat Bayar
  // Vendor yang DP-nya batal dipakai (trip cancel) tapi nggak hangus.
  const [showConvertDepositModal, setShowConvertDepositModal] = useState(false);
  const [convertingPayment, setConvertingPayment] = useState(null);
  const [convertForm, setConvertForm] = useState({ vendorId: '', amount: '', notes: '' });

  // Modal "Tambah/Koreksi Saldo Deposit Vendor" manual — dipakai buat input
  // saldo yang udah ada dari sebelumnya (migrasi data lama), atau koreksi
  // manual lain di luar alur konversi DP batal.
  const [showVendorDepositAdjustModal, setShowVendorDepositAdjustModal] = useState(false);
  const [adjustingVendor, setAdjustingVendor] = useState(null);
  const [vendorAdjustForm, setVendorAdjustForm] = useState({ amount: '', notes: 'Saldo awal (migrasi data lama)' });

  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [showOperationalModal, setShowOperationalModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);

  // Guard double-submit (tombol di-disable selagi proses async jalan) buat
  // form-form Finance — sebelumnya nggak ada, jadi double-klik/koneksi
  // lambat + klik ulang bisa bikin data (dan saldo, dan jurnal) tercatat
  // dobel. Lihat juga audit "Kualitas Kode & Bug" §HIGH.
  const [savingIncome, setSavingIncome] = useState(false);
  const [savingDeposit, setSavingDeposit] = useState(false);
  const [savingVendor, setSavingVendor] = useState(false);
  const [savingVendorBill, setSavingVendorBill] = useState(false);
  const [savingOperational, setSavingOperational] = useState(false);
  const [activeTab, setActiveTab] = useState('income');

  // Tab "Laporan" — HUB laporan-laporan finansial yang bakal terus nambah ke
  // depannya. reportsSubTab nentuin sub-laporan mana yang lagi ditampilkan
  // di dalam tab ini (dipisah dari activeTab biar nambah laporan baru nggak
  // ganggu tab-tab lain yang udah ada).
  const [reportsSubTab, setReportsSubTab] = useState('closing_tc');

  // Sub-laporan "Closing TC & Komisi" — filter RENTANG TANGGAL bebas
  // (bukan cuma per bulan kalender) berdasarkan tanggal transaksi booking,
  // defaultnya otomatis ngikutin siklus cutoff payroll HRD (tanggal 22 - 21
  // bulan berikutnya), tapi tetap bisa diubah manual ke rentang tanggal
  // apapun lewat 2 input tanggal di UI. Plus state accordion baris TC mana
  // yang lagi dibuka breakdown-nya.
  const [closingTcStartDate, setClosingTcStartDate] = useState(() => getDefaultPayrollCutoffRange().start);
  const [closingTcEndDate, setClosingTcEndDate] = useState(() => getDefaultPayrollCutoffRange().end);
  // Shortcut "Pilih Bulan" — nampilin & milih periode per bulan kalender
  // kayak sebelumnya, murni buat kemudahan (begitu dipilih, langsung
  // ngeset closingTcStartDate/EndDate ke tanggal 1 - akhir bulan itu).
  // Rentang tanggal manual di atas tetap jadi sumber kebenaran filternya.
  const [closingTcQuickMonth, setClosingTcQuickMonth] = useState(() => getPeriodKey(todayISODate()));
  const [expandedClosingTcIds, setExpandedClosingTcIds] = useState([]);

  // Sub-laporan "Sumber Lead per Bulan" — komposisi closing/seat per sumber
  // lead (Ads, Alumni, Pameran, dst — diisi TC/Sales pas registrasi booking
  // di modul Booking) buat 1 bulan terpilih. leadSourceMetric nentuin basis
  // hitungnya: 'purchase' = jumlah closing/pemesanan (1 grup = 1 closing,
  // pax tunggal juga dihitung 1), 'seat' = jumlah pax/seat (1 booking = 1 seat).
  const [leadSourcePeriod, setLeadSourcePeriod] = useState(() => getPeriodKey(todayISODate()));
  const [leadSourceMetric, setLeadSourceMetric] = useState('purchase');

  const [incomeForm, setIncomeForm] = useState({
    groupCode: '',
    amount: '',
    paymentMethod: 'Transfer Bank',
    accountId: '',
    notes: 'DP Keberangkatan',
    date: new Date().toISOString().slice(0, 10)
  });

  // Modal "+ Tambah Deposit" — buat nyatet transferan yang udah masuk tapi
  // belum jelas dipakai buat booking mana, langsung masuk saldo Pemesan DAN
  // saldo akun Kas/Bank yang nerima duitnya.
  const [depositForm, setDepositForm] = useState({
    customerId: '',
    amount: '',
    accountId: '',
    notes: 'Titip Deposit (belum ada booking)',
    date: todayISODate()
  });

  const [vendorForm, setVendorForm] = useState({
    packageId: '',
    vendorId: '',
    vendorName: '',
    category: VENDOR_CATEGORIES[0],
    payMethod: 'Kas/Bank',
    amount: '',
    accountId: '',
    billId: '',
    notes: 'DP Booking Seat',
    paymentDate: todayISODate()
  });

  // Tagihan Vendor (vendor_bills) — invoice yang diterima dari vendor
  // SEBELUM dibayar, biar Hutang Usaha ke vendor beneran ke-catat (nggak
  // cuma keliatan pas udah dibayar kayak sebelumnya). Bayar Vendor yang
  // udah ada tetap bisa dipakai tanpa pilih tagihan (ad-hoc, backward
  // compatible) — pilih tagihan itu OPSIONAL.
  const [vendorBills, setVendorBills] = useState([]);
  const [showVendorBillModal, setShowVendorBillModal] = useState(false);
  const [vendorBillForm, setVendorBillForm] = useState({
    vendorId: '',
    packageId: '',
    billNumber: '',
    category: VENDOR_CATEGORIES[0],
    amount: '',
    billDate: todayISODate(),
    dueDate: '',
    notes: ''
  });

  const [operationalForm, setOperationalForm] = useState({
    category: OPERATIONAL_CATEGORIES[0],
    amount: '',
    accountId: '',
    notes: '',
    expenseDate: todayISODate()
  });
  // null = mode catat baru, diisi id doc `expenses_operational` = mode edit
  // (misal salah pilih kategori/akun pas nyatet).
  const [editingOperationalId, setEditingOperationalId] = useState(null);


  const fetchData = async () => {
    setLoading(true);
    try {
      const bkSnap = await getDocs(collection(db, 'bookings'));
      setBookingsList(bkSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const pkgSnap = await getDocs(collection(db, 'packages'));
      // "_destination_categories_config" itu dokumen konfigurasi daftar
      // Destinasi/Kota Tujuan (dikelola dari PackagesModule.jsx), bukan
      // paket beneran — disaring keluar biar nggak dianggap paket kosong.
      setPackagesList(pkgSnap.docs.filter(d => d.id !== '_destination_categories_config').map(d => ({ id: d.id, ...d.data() })));

      const jmhSnap = await getDocs(collection(db, 'jamaah'));
      setJamaahList(jmhSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const accSnap = await getDocs(collection(db, 'financial_accounts'));
      setFinancialAccounts(accSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const vendorMasterSnap = await getDocs(collection(db, 'vendors'));
      const vendorDocs = vendorMasterSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const categoryConfigDoc = vendorDocs.find(v => v.id === VENDOR_CATEGORY_CONFIG_ID);
      setVendorsList(vendorDocs.filter(v => v.id !== VENDOR_CATEGORY_CONFIG_ID));
      if (categoryConfigDoc && Array.isArray(categoryConfigDoc.categories) && categoryConfigDoc.categories.length > 0) {
        setVendorCategories(categoryConfigDoc.categories);
      }

      const txSnap = await getDocs(collection(db, 'payments_income'));
      setTransactions(txSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const vpSnap = await getDocs(collection(db, 'payments_vendor'));
      setVendorPayments(vpSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const vbSnap = await getDocs(collection(db, 'vendor_bills'));
      setVendorBills(vbSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const opSnap = await getDocs(collection(db, 'expenses_operational'));
      const opDocs = opSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const opexCategoryConfigDoc = opDocs.find(o => o.id === OPEX_CATEGORY_CONFIG_ID);
      setOperationalExpenses(opDocs.filter(o => o.id !== OPEX_CATEGORY_CONFIG_ID));
      if (opexCategoryConfigDoc && Array.isArray(opexCategoryConfigDoc.categories) && opexCategoryConfigDoc.categories.length > 0) {
        setOperationalCategories(opexCategoryConfigDoc.categories);
      }
    } catch (err) {
      console.error("Gagal mengambil data keuangan:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const syncBookingTotalPaid = async (bookingId) => {
    if (!bookingId) return;
    try {
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', bookingId));
      const snap = await getDocs(q);
      const totalPaidReal = snap.docs.reduce((acc, curr) => acc + (Number(curr.data().amount) || 0), 0);

      const bkSnap = await getDocs(collection(db, 'bookings'));
      const targetBk = bkSnap.docs.find(d => d.id === bookingId);
      
      if (targetBk) {
        const totalAmount = Number(targetBk.data().totalAmount) || 0;
        // Sama kayak versi di BookingsModule.jsx — kalau semua setoran booking
        // ini kehapus sampai totalPaidReal balik ke 0, statusnya harus balik
        // ke "Belum Bayar", bukan nyangkut di "DP Paid".
        const status = totalPaidReal <= 0 ? 'Belum Bayar' : (totalPaidReal >= totalAmount ? 'Full Payment' : 'DP Paid');

        await updateDoc(doc(db, 'bookings', bookingId), {
          totalPaid: totalPaidReal,
          paymentStatus: status
        });
      }
    } catch (err) {
      console.error("Gagal sinkronisasi data booking:", err);
    }
  };

  // Saldo Deposit nempel ke Pemesan (collection 'jamaah'). delta positif =
  // nambah saldo (top up manual / konversi refund batal di modul Booking),
  // delta negatif = pakai saldo buat bayar setoran. Tiap perubahan dicatat
  // ke 'deposit_ledger' biar ada riwayatnya.
  const adjustDepositBalance = async (customerId, customerName, delta, type, notes, bookingCode, createdAtOverride) => {
    if (!customerId || !delta) return;
    await updateDoc(doc(db, 'jamaah', customerId), { depositBalance: increment(delta) });
    await addDoc(collection(db, 'deposit_ledger'), {
      customerId,
      customerName: customerName || '-',
      type,
      amount: delta,
      notes: notes || '',
      bookingCode: bookingCode || '',
      createdAt: createdAtOverride || new Date().toISOString()
    });
  };

  // Saldo Deposit VENDOR (collection 'vendors', field depositBalance) —
  // nampung DP block seat/dll yang batal (trip cancel) tapi nggak hangus,
  // jadi kredit yang bisa dipakai lagi buat booking baru ke vendor yang
  // sama. Beda arah sama Saldo Deposit customer (customer nitip duit ke
  // kita, ini kita "nitip" DP ke vendor). delta positif = nambah saldo
  // (konversi dari DP yang batal / top up manual), delta negatif = dipakai
  // buat bayar vendor tanpa keluar uang baru dari Kas/Bank.
  const adjustVendorDepositBalance = async (vendorId, vendorName, delta, type, notes, reference, createdAtOverride) => {
    if (!vendorId || !delta) return;
    await updateDoc(doc(db, 'vendors', vendorId), { depositBalance: increment(delta) });
    await addDoc(collection(db, 'vendor_deposit_ledger'), {
      vendorId,
      vendorName: vendorName || '-',
      type,
      amount: delta,
      notes: notes || '',
      reference: reference || '',
      createdAt: createdAtOverride || new Date().toISOString()
    });
  };

  // Saldo tiap akun Kas/Bank (collection 'financial_accounts') — delta positif
  // = uang beneran masuk ke akun ini (setoran jamaah, top up deposit), delta
  // negatif = uang keluar dari akun ini (bayar vendor, biaya operasional).
  // Metode Bayar "Saldo Deposit" SENGAJA nggak lewat sini — itu cuma
  // mindahin saldo titipan customer, bukan uang baru yang masuk/keluar kas.
  // Tiap perubahan saldo juga dicatat ke 'account_mutations' biar ada
  // riwayat mutasi per akun buat rekonsiliasi manual sama rekening koran.
  const adjustAccountBalance = async (accountId, delta, meta = {}) => {
    if (!accountId || !delta) return;
    await updateDoc(doc(db, 'financial_accounts', accountId), { balance: increment(delta) });
    const acc = financialAccounts.find(a => a.id === accountId);
    await addDoc(collection(db, 'account_mutations'), {
      accountId,
      accountName: acc?.name || meta.accountName || '-',
      type: delta > 0 ? 'in' : 'out',
      amount: Math.abs(delta),
      description: meta.description || '-',
      reference: meta.reference || '',
      source: meta.source || '-',
      // sourceDocId = ID dokumen transaksi asal (payments_income/payments_vendor/
      // expenses_operational) — dipakai buat nemuin & ngapus/nyesuain baris ini
      // lagi kalau transaksinya diedit/dihapus, biar riwayat mutasi nggak
      // numpuk baris "koreksi" tiap ada perubahan.
      sourceDocId: meta.sourceDocId || '',
      createdAt: meta.date || new Date().toISOString()
    });
  };

  // Hapus baris account_mutations yang berasal dari SATU dokumen transaksi
  // (dicari lewat sourceDocId) — dipake pas transaksi asalnya dihapus, biar
  // riwayat mutasi ikutan hilang (bukan nambah baris "koreksi hapus").
  // Saldo akun tetap disesuaikan langsung (nggak nulis baris baru).
  const removeAccountMutationBySource = async (accountId, sourceDocId, delta) => {
    if (!accountId) return;
    if (delta) {
      await updateDoc(doc(db, 'financial_accounts', accountId), { balance: increment(delta) });
    }
    if (!sourceDocId) return;
    try {
      const q = query(collection(db, 'account_mutations'), where('accountId', '==', accountId), where('sourceDocId', '==', sourceDocId));
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    } catch (err) {
      console.error('Gagal menghapus riwayat mutasi terkait:', err);
    }
  };

  // ============ Data Master Vendor (nama & kategori vendor + saldo deposit) ============

  const handleVendorMasterSubmit = async (e) => {
    e.preventDefault();
    if (!vendorMasterForm.name.trim()) {
      alert("Isi nama vendornya dulu.");
      return;
    }
    try {
      if (editingVendorMasterId) {
        await updateDoc(doc(db, 'vendors', editingVendorMasterId), {
          name: vendorMasterForm.name.trim(),
          category: vendorMasterForm.category
        });
        logActivity({
          userId: currentUser?.uid,
          userName: currentUser?.fullName || currentUser?.email,
          userRole: currentUser?.role,
          action: 'update',
          module: 'Vendor',
          targetLabel: vendorMasterForm.name.trim(),
          details: `Mengubah data vendor "${vendorMasterForm.name.trim()}" (kategori: ${vendorMasterForm.category})`
        });
      } else {
        await addDoc(collection(db, 'vendors'), {
          name: vendorMasterForm.name.trim(),
          category: vendorMasterForm.category,
          depositBalance: 0,
          createdAt: new Date().toISOString()
        });
        logActivity({
          userId: currentUser?.uid,
          userName: currentUser?.fullName || currentUser?.email,
          userRole: currentUser?.role,
          action: 'create',
          module: 'Vendor',
          targetLabel: vendorMasterForm.name.trim(),
          details: `Menambahkan vendor baru "${vendorMasterForm.name.trim()}" (kategori: ${vendorMasterForm.category})`
        });
      }
      setShowVendorMasterModal(false);
      setEditingVendorMasterId(null);
      setVendorMasterForm({ name: '', category: vendorCategories[0] });
      fetchData();
    } catch (err) {
      alert("Gagal menyimpan data vendor: " + err.message);
    }
  };

  const handleEditVendorMaster = (v) => {
    setEditingVendorMasterId(v.id);
    setVendorMasterForm({ name: v.name || '', category: v.category || vendorCategories[0] });
    setShowVendorMasterModal(true);
  };

  const handleDeleteVendorMaster = async (v) => {
    // Jaga-jaga pertama: vendor yang masih ada saldo depositnya jangan bisa
    // kehapus gitu aja, biar jejak kreditnya nggak ilang.
    if (Number(v.depositBalance || 0) !== 0) {
      alert(`Vendor "${v.name}" masih punya saldo deposit Rp ${Number(v.depositBalance).toLocaleString('id-ID')}. Pakai dulu atau koreksi saldonya sebelum vendor ini dihapus.`);
      return;
    }
    // Jaga-jaga kedua: walau saldonya 0, tetep diwanti-wanti kalau vendor
    // ini udah punya riwayat pembayaran — biar staff sadar riwayat itu
    // bakal jadi nggak nyambung ke vendor manapun lagi kalau dihapus.
    try {
      const vpQ = query(collection(db, 'payments_vendor'), where('vendorId', '==', v.id));
      const vpSnap = await getDocs(vpQ);
      if (!vpSnap.empty) {
        if (!confirm(`Vendor "${v.name}" udah punya ${vpSnap.size} riwayat pembayaran (saldo depositnya emang 0, tapi pernah dipakai). Riwayat itu nggak ikut kehapus, cuma jadi nggak nyambung ke vendor manapun lagi kalau vendor ini dihapus. Tetap hapus?`)) return;
      } else {
        if (!confirm(`Hapus vendor "${v.name}"?`)) return;
      }
      await deleteDoc(doc(db, 'vendors', v.id));
      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'delete',
        module: 'Vendor',
        targetLabel: v.name,
        details: `Menghapus vendor "${v.name}"`
      });
      fetchData();
    } catch (err) {
      alert("Gagal menghapus vendor: " + err.message);
    }
  };

  // ============ Kelola Kategori Vendor (Tambah/Edit/Hapus) ============

  const openCategoryModal = () => {
    setCategoryDraft(vendorCategories.map((c, i) => ({ key: `existing-${i}`, original: c, value: c })));
    setNewCategoryText('');
    setShowCategoryModal(true);
  };

  const handleAddCategoryDraft = () => {
    const text = newCategoryText.trim();
    if (!text) return;
    const isDuplicate = categoryDraft.some(c => c.value.trim().toLowerCase() === text.toLowerCase());
    if (isDuplicate) {
      alert(`Kategori "${text}" udah ada di daftar.`);
      return;
    }
    setCategoryDraft(prev => [...prev, { key: `new-${Date.now()}`, original: null, value: text }]);
    setNewCategoryText('');
  };

  const handleRenameCategoryDraft = (key, value) => {
    setCategoryDraft(prev => prev.map(c => c.key === key ? { ...c, value } : c));
  };

  const handleRemoveCategoryDraft = (key) => {
    const target = categoryDraft.find(c => c.key === key);
    if (!target) return;
    if (target.original) {
      const usedCount = vendorsList.filter(v => v.category === target.original).length;
      if (usedCount > 0) {
        if (!confirm(`Kategori "${target.original}" masih dipakai oleh ${usedCount} vendor. Kalau dihapus dari daftar, vendor-vendor itu tetap tersimpan kategorinya (nggak ikut kehapus/kereset), cuma nggak muncul lagi di pilihan dropdown. Tetap hapus dari daftar?`)) return;
      }
    }
    setCategoryDraft(prev => prev.filter(c => c.key !== key));
  };

  const handleSaveCategories = async () => {
    const finalValues = categoryDraft.map(c => c.value.trim()).filter(Boolean);
    if (finalValues.length === 0) {
      alert("Minimal harus ada 1 kategori.");
      return;
    }
    const lowerSet = new Set();
    for (const v of finalValues) {
      const lower = v.toLowerCase();
      if (lowerSet.has(lower)) {
        alert(`Ada kategori yang namanya sama: "${v}". Gabungkan atau ganti dulu salah satunya.`);
        return;
      }
      lowerSet.add(lower);
    }

    setSavingCategories(true);
    try {
      // Rename: kategori lama yang namanya diubah (bukan yang baru ditambah)
      // ikut disesuaikan ke semua vendor yang masih pakai nama lama itu,
      // biar data vendor existing tetap konsisten sama daftar kategori terbaru.
      const renames = categoryDraft.filter(c => c.original && c.value.trim() && c.value.trim() !== c.original);
      for (const r of renames) {
        const affected = vendorsList.filter(v => v.category === r.original);
        await Promise.all(affected.map(v => updateDoc(doc(db, 'vendors', v.id), { category: r.value.trim() })));
      }

      await setDoc(doc(db, 'vendors', VENDOR_CATEGORY_CONFIG_ID), {
        isCategoryConfig: true,
        categories: finalValues,
        updatedAt: new Date().toISOString()
      });

      setVendorCategories(finalValues);
      setShowCategoryModal(false);
      await fetchData();
    } catch (err) {
      alert("Gagal menyimpan daftar kategori: " + err.message);
    }
    setSavingCategories(false);
  };

  // ============ Kelola Kategori Biaya Operasional (Tambah/Edit/Hapus) ============

  const openOpexCategoryModal = () => {
    setOpexCategoryDraft(operationalCategories.map((c, i) => ({ key: `existing-${i}`, original: c, value: c })));
    setNewOpexCategoryText('');
    setShowOpexCategoryModal(true);
  };

  const handleAddOpexCategoryDraft = () => {
    const text = newOpexCategoryText.trim();
    if (!text) return;
    const isDuplicate = opexCategoryDraft.some(c => c.value.trim().toLowerCase() === text.toLowerCase());
    if (isDuplicate) {
      alert(`Kategori "${text}" udah ada di daftar.`);
      return;
    }
    setOpexCategoryDraft(prev => [...prev, { key: `new-${Date.now()}`, original: null, value: text }]);
    setNewOpexCategoryText('');
  };

  const handleRenameOpexCategoryDraft = (key, value) => {
    setOpexCategoryDraft(prev => prev.map(c => c.key === key ? { ...c, value } : c));
  };

  const handleRemoveOpexCategoryDraft = (key) => {
    const target = opexCategoryDraft.find(c => c.key === key);
    if (!target) return;
    if (target.original) {
      const usedCount = operationalExpenses.filter(o => o.category === target.original).length;
      if (usedCount > 0) {
        if (!confirm(`Kategori "${target.original}" masih dipakai oleh ${usedCount} catatan biaya operasional. Kalau dihapus dari daftar, catatan-catatan itu tetap tersimpan kategorinya (nggak ikut kehapus/kereset), cuma nggak muncul lagi di pilihan dropdown. Tetap hapus dari daftar?`)) return;
      }
    }
    setOpexCategoryDraft(prev => prev.filter(c => c.key !== key));
  };

  const handleSaveOpexCategories = async () => {
    const finalValues = opexCategoryDraft.map(c => c.value.trim()).filter(Boolean);
    if (finalValues.length === 0) {
      alert("Minimal harus ada 1 kategori.");
      return;
    }
    const lowerSet = new Set();
    for (const v of finalValues) {
      const lower = v.toLowerCase();
      if (lowerSet.has(lower)) {
        alert(`Ada kategori yang namanya sama: "${v}". Gabungkan atau ganti dulu salah satunya.`);
        return;
      }
      lowerSet.add(lower);
    }

    setSavingOpexCategories(true);
    try {
      // Rename: kategori lama yang namanya diubah (bukan yang baru ditambah)
      // ikut disesuaikan ke semua catatan biaya operasional yang masih pakai
      // nama lama itu, biar data existing tetap konsisten sama daftar terbaru.
      const renames = opexCategoryDraft.filter(c => c.original && c.value.trim() && c.value.trim() !== c.original);
      for (const r of renames) {
        const affected = operationalExpenses.filter(o => o.category === r.original);
        await Promise.all(affected.map(o => updateDoc(doc(db, 'expenses_operational', o.id), { category: r.value.trim() })));
      }

      await setDoc(doc(db, 'expenses_operational', OPEX_CATEGORY_CONFIG_ID), {
        isCategoryConfig: true,
        categories: finalValues,
        updatedAt: new Date().toISOString()
      });

      setOperationalCategories(finalValues);
      setShowOpexCategoryModal(false);
      await fetchData();
    } catch (err) {
      alert("Gagal menyimpan daftar kategori: " + err.message);
    }
    setSavingOpexCategories(false);
  };

  // ============ Konversi DP Vendor batal (nggak hangus) -> Saldo Deposit Vendor ============

  const handleOpenConvertModal = (vp) => {
    if (vp.convertedToDeposit) {
      alert("Transaksi ini udah pernah dikonversi ke Saldo Deposit sebelumnya.");
      return;
    }
    const matchedVendor = vendorsList.find(v => v.name === vp.vendorName);
    setConvertingPayment(vp);
    setConvertForm({
      vendorId: matchedVendor?.id || '',
      amount: vp.amount,
      notes: `Konversi DP batal - ${vp.category} (${vp.packageName || '-'})`
    });
    setShowConvertDepositModal(true);
  };

  const handleConvertSubmit = async (e) => {
    e.preventDefault();
    if (!convertForm.vendorId) {
      alert("Pilih vendor tujuan saldo depositnya dulu.");
      return;
    }
    const amountVal = Number(convertForm.amount || 0);
    if (amountVal <= 0) {
      alert("Isi nominal yang valid (lebih dari 0).");
      return;
    }
    try {
      const vendor = vendorsList.find(v => v.id === convertForm.vendorId);
      // CATATAN: konversi ini SENGAJA nggak nyentuh saldo akun Kas/Bank —
      // uang DP-nya emang udah beneran keluar dari kas pas dibayar dulu.
      // Konversi cuma nyatet bahwa vendor sekarang "berutang" jasa senilai
      // segini ke kita, yang bisa dipakai lagi buat booking berikutnya.
      await adjustVendorDepositBalance(
        convertForm.vendorId,
        vendor?.name || '-',
        amountVal,
        'refund_conversion',
        convertForm.notes,
        convertingPayment?.packageName || convertingPayment?.category || '',
        new Date().toISOString()
      );
      await updateDoc(doc(db, 'payments_vendor', convertingPayment.id), {
        convertedToDeposit: true,
        convertedAmount: amountVal,
        convertedToVendorId: convertForm.vendorId,
        convertedAt: new Date().toISOString()
      });
      setShowConvertDepositModal(false);
      setConvertingPayment(null);
      setConvertForm({ vendorId: '', amount: '', notes: '' });
      fetchData();
    } catch (err) {
      alert("Gagal mengonversi ke Saldo Deposit: " + err.message);
    }
  };

  const handleOpenVendorDepositAdjust = (v) => {
    setAdjustingVendor(v);
    setVendorAdjustForm({ amount: '', notes: 'Saldo awal (migrasi data lama)' });
    setShowVendorDepositAdjustModal(true);
  };

  // Tambah/koreksi saldo deposit vendor secara manual — dipakai buat input
  // saldo yang udah ada dari sebelum sistem ini dipakai, atau koreksi lain
  // di luar alur konversi DP batal. Nominal boleh negatif buat ngoreksi
  // turun (misal salah input kelebihan sebelumnya).
  const handleVendorDepositAdjustSubmit = async (e) => {
    e.preventDefault();
    const deltaVal = Number(vendorAdjustForm.amount || 0);
    if (deltaVal === 0) {
      alert("Isi nominal yang valid (bukan 0). Isi negatif kalau mau mengoreksi turun.");
      return;
    }
    if (deltaVal < 0 && Math.abs(deltaVal) > Number(adjustingVendor.depositBalance || 0)) {
      alert(`Saldo deposit vendor "${adjustingVendor.name}" cuma Rp ${Number(adjustingVendor.depositBalance || 0).toLocaleString('id-ID')}, nggak bisa dikoreksi turun lebih dari itu.`);
      return;
    }
    try {
      await adjustVendorDepositBalance(
        adjustingVendor.id,
        adjustingVendor.name,
        deltaVal,
        'manual_adjustment',
        vendorAdjustForm.notes,
        '',
        new Date().toISOString()
      );
      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'update',
        module: 'Vendor',
        targetLabel: adjustingVendor.name,
        details: `Menyesuaikan saldo deposit vendor "${adjustingVendor.name}" sebesar Rp ${deltaVal.toLocaleString('id-ID')} (${vendorAdjustForm.notes || '-'})`
      });
      setShowVendorDepositAdjustModal(false);
      setAdjustingVendor(null);
      setVendorAdjustForm({ amount: '', notes: 'Saldo awal (migrasi data lama)' });
      fetchData();
    } catch (err) {
      alert("Gagal menyesuaikan saldo deposit vendor: " + err.message);
    }
  };

  const handleDepositSubmit = async (e) => {
    e.preventDefault();
    const customer = jamaahList.find(j => j.id === depositForm.customerId);
    if (!customer) {
      alert("Pilih Pemesan/Customer dulu.");
      return;
    }
    const amountVal = Number(depositForm.amount || 0);
    if (amountVal <= 0) {
      alert("Isi nominal deposit yang valid (lebih dari 0).");
      return;
    }
    if (!depositForm.accountId) {
      alert("Pilih akun Kas/Bank yang nerima transferan ini dulu.");
      return;
    }
    if (savingDeposit) return; // cegah double-submit (double-klik/koneksi lambat)
    setSavingDeposit(true);
    try {
      const account = financialAccounts.find(a => a.id === depositForm.accountId);
      await adjustDepositBalance(
        customer.id,
        customer.fullName,
        amountVal,
        'topup',
        `${depositForm.notes}${account ? ` (${account.name})` : ''}`,
        '',
        resolvePaymentCreatedAt(depositForm.date)
      );
      await adjustAccountBalance(depositForm.accountId, amountVal, {
        description: `Titip Deposit - ${customer.fullName || '-'}${depositForm.notes ? ` (${depositForm.notes})` : ''}`,
        reference: customer.customerCode || customer.fullName || '',
        source: 'deposit_topup',
        date: resolvePaymentCreatedAt(depositForm.date)
      });
      await postDepositTopup({
        sourceDocId: `deposit_${customer.id}_${Date.now()}`, jamaahName: customer.fullName, amount: amountVal,
        accountId: depositForm.accountId, accountName: account?.name || '',
        date: resolvePaymentCreatedAt(depositForm.date),
        createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
      }).catch(err => {
        console.error('Gagal posting jurnal titip deposit:', err);
        alert(`Deposit tersimpan & saldo Kas/Bank sudah bertambah, TAPI jurnalnya GAGAL diposting (${err.message}). Laporan Keuangan (Neraca/Buku Besar) untuk transaksi ini belum akurat sampai dikoreksi — segera lapor ke tim IT/Finance.`);
      });
      setShowDepositModal(false);
      setDepositForm({ customerId: '', amount: '', accountId: '', notes: 'Titip Deposit (belum ada booking)', date: todayISODate() });
      fetchData();
    } catch (err) {
      alert("Gagal mencatat deposit: " + err.message);
    } finally {
      setSavingDeposit(false);
    }
  };

  const handleDeleteVendorPayment = async (vp) => {
    // Sama kayak hapus setoran jamaah — kalau paket terkait pembayaran vendor
    // ini omzet/HPP-nya udah "diakui" (masuk Laporan P&L), hapus DIBLOK dulu
    // biar angka yang udah dilaporkan nggak berubah diam-diam.
    const recognizedPkg = findPackageForVendor(vp);
    if (recognizedPkg && recognizedPkg.revenueRecognized) {
      alert(`Pembayaran vendor ini tidak dapat dihapus karena paket "${recognizedPkg.name}" omzet & HPP-nya sudah "Diakui" dan sudah masuk Laporan P&L.\n\nBatalkan dulu pengakuan pendapatan paket ini lewat tombol "Batalkan Pengakuan" di tab Riwayat Bayar Vendor/Laporan, baru pembayaran ini bisa dihapus/dikoreksi.`);
      return;
    }
    if (vp.convertedToDeposit) {
      if (!confirm(`PERHATIAN: transaksi ini udah pernah dikonversi jadi Saldo Deposit Vendor (Rp ${Number(vp.convertedAmount || 0).toLocaleString('id-ID')}). Menghapus catatan aslinya TIDAK otomatis narik balik saldo deposit yang udah kebentuk itu. Kalau emang mau dikoreksi, sesuaikan juga saldo deposit vendornya secara manual. Tetap lanjut hapus?`)) return;
    } else {
      if (!confirm("Apakah Anda yakin ingin menghapus catatan pengeluaran vendor ini?")) return;
    }
    try {
      await deleteDoc(doc(db, 'payments_vendor', vp.id));
      if (vp.payMethod === 'Saldo Deposit Vendor' && vp.vendorId) {
        // Dibayar pakai Saldo Deposit Vendor (bukan potong Kas/Bank) — pas
        // dihapus, saldo depositnya dibalikin lagi ke vendor terkait.
        await adjustVendorDepositBalance(vp.vendorId, vp.vendorName, Number(vp.amount) || 0, 'usage_reversal', `Koreksi hapus - ${vp.category || '-'}`, vp.packageName || '');
      } else if (vp.accountId) {
        // Uangnya balik lagi ke saldo akun Kas/Bank yang tadinya kepotong, dan
        // baris mutasinya ikut hilang dari riwayat (bukan nambah baris "koreksi").
        await removeAccountMutationBySource(vp.accountId, vp.id, Number(vp.amount) || 0);
      }
      // Kalau pembayaran ini tadinya dilink ke Tagihan Vendor, kembaliin lagi
      // sisa tagihannya (amountPaid dikurangi, status dihitung ulang).
      if (vp.billId) {
        const linkedBill = vendorBills.find(b => b.id === vp.billId);
        if (linkedBill) {
          const revertedAmountPaid = Math.max(0, Number(linkedBill.amountPaid || 0) - (Number(vp.amount) || 0));
          const revertedStatus = revertedAmountPaid <= 0 ? 'unpaid' : (revertedAmountPaid >= Number(linkedBill.amount) - 1 ? 'paid' : 'partial');
          await updateDoc(doc(db, 'vendor_bills', vp.billId), { amountPaid: revertedAmountPaid, status: revertedStatus });
        }
      }
      await deleteJournalEntriesBySource('vendor_payment', vp.id);
      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'delete',
        module: 'Pembayaran Vendor',
        targetLabel: vp.vendorName || vp.category,
        details: `Menghapus catatan pembayaran vendor "${vp.vendorName || '-'}" (${vp.category || '-'}) senilai Rp ${Number(vp.amount || 0).toLocaleString('id-ID')}`
      });
      fetchData();
    } catch (err) {
      alert("Gagal menghapus pembayaran vendor: " + err.message);
    }
  };

  const handleDeleteOperationalExpense = async (op) => {
    if (!confirm("Apakah Anda yakin ingin menghapus catatan biaya operasional ini?")) return;
    try {
      await deleteDoc(doc(db, 'expenses_operational', op.id));
      if (op.accountId) await removeAccountMutationBySource(op.accountId, op.id, Number(op.amount) || 0);
      await deleteJournalEntriesBySource('operational_expense', op.id);
      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'delete',
        module: 'Pengeluaran Operasional',
        targetLabel: op.category,
        details: `Menghapus catatan biaya operasional "${op.category || '-'}" senilai Rp ${Number(op.amount || 0).toLocaleString('id-ID')}`
      });
      fetchData();
    } catch (err) {
      alert("Gagal menghapus biaya operasional: " + err.message);
    }
  };

  const handleIncomeSubmit = async (e) => {
    e.preventDefault();
    if (savingIncome) return; // cegah double-submit (double-klik/koneksi lambat)
    setSavingIncome(true);
    try {
      const groupItems = bookingsList
        .filter(b => (b.groupBookingCode || b.bookingCode) === incomeForm.groupCode)
        .sort((a, b) => {
          if (a.groupPaxIndex != null && b.groupPaxIndex != null) return a.groupPaxIndex - b.groupPaxIndex;
          return 0;
        });
      if (groupItems.length === 0) return;

      const amountVal = Number(incomeForm.amount);
      const paxCount = groupItems.length;
      const incomeOrdererId = groupItems[0]?.ordererId;
      const incomeOrdererName = groupItems[0]?.ordererName;

      if (isPaymentDateBeforeBooking(incomeForm.date, groupItems[0]?.createdAt)) {
        const minDate = getBookingMinDate(groupItems[0]?.createdAt);
        alert(`Tanggal setoran nggak boleh sebelum tanggal pemesanan kode ${incomeForm.groupCode} dibuat (${minDate.split('-').reverse().join('/')}).`);
        return;
      }

      if (incomeForm.paymentMethod === 'Saldo Deposit') {
        const ordererData = jamaahList.find(j => j.id === incomeOrdererId);
        const currentBalance = Number(ordererData?.depositBalance || 0);
        if (amountVal > currentBalance) {
          alert(`Saldo Deposit Pemesan tidak cukup. Saldo saat ini: Rp ${currentBalance.toLocaleString('id-ID')}, dibutuhkan: Rp ${amountVal.toLocaleString('id-ID')}.`);
          return;
        }
      } else if (!incomeForm.accountId) {
        alert("Pilih akun Kas/Bank yang nerima setoran ini dulu.");
        return;
      }
      const incomeAccount = financialAccounts.find(a => a.id === incomeForm.accountId);

      // Setoran dibagi rata ke semua pax dalam kode booking ini (sisa
      // pembagian jatuh ke pax pertama) — pola sama persis dengan setoran
      // grup di modul Booking & Manifest. Kalau kode booking ini cuma 1 pax,
      // ini otomatis jadi setoran biasa (nggak kesplit).
      const baseShare = Math.floor(amountVal / paxCount);
      const remainder = amountVal - (baseShare * paxCount);

      // Seluruh dokumen payments_income hasil split dari 1x submit ini
      // ditandai groupTransactionId yang sama, biar bisa digabung balik jadi
      // 1 baris transaksi pas ditampilkan (di sini maupun di modul Booking).
      const groupTransactionId = `gtx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const isGroup = paxCount > 1;

      // Dokumen payments_income pertama yang berhasil dibuat dari 1x submit
      // ini — dipakai jadi sourceDocId mutasi kas/bank pas transaksinya cuma
      // 1 pax (bukan grup), biar konsisten sama pola hapus yang sudah ada.
      let firstPayRefId = null;

      for (let i = 0; i < groupItems.length; i++) {
        const item = groupItems[i];
        const paxShare = baseShare + (i === 0 ? remainder : 0);

        if (paxShare > 0) {
          const payRef = await addDoc(collection(db, 'payments_income'), {
            bookingId: item.id,
            bookingCode: item.bookingCode,
            jamaahName: item.jamaahName,
            packageId: item.packageId,
            packageName: item.packageName,
            amount: paxShare,
            paymentMethod: incomeForm.paymentMethod,
            ...(incomeForm.paymentMethod !== 'Saldo Deposit' ? { accountId: incomeForm.accountId, accountName: incomeAccount?.name || '' } : {}),
            notes: isGroup ? `${incomeForm.notes} (Grup ${incomeForm.groupCode})` : incomeForm.notes,
            createdAt: resolvePaymentCreatedAt(incomeForm.date),
            ...(isGroup ? { groupTransactionId } : {})
          });
          if (!firstPayRefId) firstPayRefId = payRef.id;
          await postIncomePayment({
            paymentId: payRef.id, bookingCode: item.bookingCode, amount: paxShare,
            paymentMethod: incomeForm.paymentMethod, accountId: incomeForm.accountId, accountName: incomeAccount?.name || '',
            date: resolvePaymentCreatedAt(incomeForm.date),
            createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
          }).catch(err => {
            console.error('Gagal posting jurnal setoran:', err);
            alert(`Setoran ${item.bookingCode} tersimpan, TAPI jurnalnya GAGAL diposting (${err.message}). Laporan Keuangan (Neraca/Buku Besar) untuk setoran ini belum akurat sampai dikoreksi — segera lapor ke tim IT/Finance.`);
          });
        }

        await syncBookingTotalPaid(item.id);
      }

      // Mutasi Kas/Bank dicatat SATU KALI per transaksi setoran asli (bukan
      // per pecahan pax) — biar "Riwayat Mutasi" persis sama jumlah uang yang
      // beneran masuk ke rekening, gampang direkonsiliasi sama mutasi bank
      // aslinya. Rincian per-peserta tetap ada, itu di payments_income.
      if (incomeForm.paymentMethod !== 'Saldo Deposit' && amountVal > 0 && firstPayRefId) {
        await adjustAccountBalance(incomeForm.accountId, amountVal, {
          description: isGroup
            ? `Setoran Grup ${incomeForm.groupCode} (${paxCount} peserta)`
            : `Setoran - ${groupItems[0]?.jamaahName || incomeForm.groupCode} (Kode ${incomeForm.groupCode})`,
          reference: incomeForm.groupCode,
          source: 'income_payment',
          date: resolvePaymentCreatedAt(incomeForm.date),
          sourceDocId: isGroup ? groupTransactionId : firstPayRefId
        });
      }

      if (incomeForm.paymentMethod === 'Saldo Deposit' && amountVal > 0) {
        await adjustDepositBalance(incomeOrdererId, incomeOrdererName, -amountVal, 'usage', `Bayar setoran kode booking ${incomeForm.groupCode}`, incomeForm.groupCode, resolvePaymentCreatedAt(incomeForm.date));
      }

      setShowIncomeModal(false);
      setIncomeForm({ groupCode: '', amount: '', paymentMethod: 'Transfer Bank', accountId: '', notes: 'DP Keberangkatan', date: new Date().toISOString().slice(0, 10) });
      fetchData();
    } catch (err) {
      alert("Gagal mencatat pembayaran: " + err.message);
    } finally {
      setSavingIncome(false);
    }
  };

  const handleDeleteIncomeRow = async (row) => {
    // Kalau paket terkait setoran ini omzetnya udah "diakui" (masuk Laporan
    // P&L periode tertentu), hapus setoran ini DIBLOK dulu — kalau nggak,
    // angka omset yang udah dilaporkan ke owner bisa berubah diam-diam tanpa
    // jejak. Staff harus "Batalkan Pengakuan Pendapatan" paket itu dulu
    // (modul Paket ini balik ke status Diterima/Dibayar Dimuka, keluar dari
    // P&L), baru boleh hapus/koreksi setorannya.
    const recognizedPkg = row.docs.map(d => findPackageForIncome(d)).find(pkg => pkg && pkg.revenueRecognized);
    if (recognizedPkg) {
      alert(`Setoran ini tidak dapat dihapus karena paket "${recognizedPkg.name}" omzetnya sudah "Diakui" dan sudah masuk Laporan P&L.\n\nBatalkan dulu pengakuan pendapatan paket ini lewat tombol "Batalkan Pengakuan" di tab Riwayat Setoran Jamaah/Laporan, baru setoran ini bisa dihapus/dikoreksi.`);
      return;
    }
    let confirmMsg = row.isMerged
      ? `Hapus transaksi setoran gabungan senilai Rp ${row.amount.toLocaleString('id-ID')} ini? Ini akan menghapus ${row.docs.length} catatan setoran split (per peserta) yang jadi bagiannya sekaligus.`
      : "Apakah Anda yakin ingin menghapus catatan transaksi setoran ini?";
    // Setoran yang dibayar pakai Saldo Deposit nggak punya accountId — saldo
    // Kas/Bank memang nggak perlu disesuaikan (uangnya emang bukan uang baru
    // masuk), TAPI saldo Deposit Pemesan yang udah kepotong pas setoran ini
    // dicatat SENGAJA nggak otomatis dibalikin di sini (lihat komentar di
    // bawah) — staff gampang lupa itu kalau nggak diingetin di titik ini.
    const depositDocs = row.docs.filter(d => d.paymentMethod === 'Saldo Deposit');
    if (depositDocs.length > 0) {
      const depositTotal = depositDocs.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
      confirmMsg += `\n\nPERHATIAN: Rp ${depositTotal.toLocaleString('id-ID')} dari transaksi ini dibayar pakai Saldo Deposit — saldo Deposit Pemesan yang udah kepotong TIDAK akan otomatis dikembalikan. Kalau setoran ini dihapus karena salah catat, koreksi saldo Deposit Pemesan-nya secara manual lewat modul Data Master Jamaah/Booking.`;
    }
    if (!confirm(confirmMsg)) return;
    try {
      await Promise.all(row.docs.map(d => deleteDoc(doc(db, 'payments_income', d.id))));
      await Promise.all(row.docs.map(d => deleteJournalEntriesBySource('income_payment', d.id)));
      // Uang yang beneran masuk ke Kas/Bank dicatat SATU baris mutasi per
      // transaksi setoran asli (lihat handleIncomeSubmit) — jadi pas
      // transaksinya dihapus, baris mutasi itu juga cuma perlu dihapus SEKALI
      // (dicari lewat sourceDocId yang sama: groupTransactionId kalau
      // transaksinya grup, atau id doc pertama kalau bukan grup), bukan
      // per-pax kayak dulu. Saldo akun dikurangi sebesar total setorannya.
      // (doc yang dibayar pakai Saldo Deposit nggak punya accountId, jadi
      // otomatis dilewati — saldo deposit-nya juga sengaja nggak dibalikin di
      // sini, itu koreksi manual terpisah lewat modul Booking).
      const mutationAccountId = row.docs.find(d => d.accountId)?.accountId;
      if (mutationAccountId) {
        const mutationSourceDocId = row.isMerged
          ? (row.docs.find(d => d.groupTransactionId)?.groupTransactionId || row.docs[0]?.id)
          : row.docs[0]?.id;
        const mutQ = query(collection(db, 'account_mutations'), where('accountId', '==', mutationAccountId), where('sourceDocId', '==', mutationSourceDocId));
        const mutSnap = await getDocs(mutQ);
        if (mutSnap.docs.length > 0) {
          // Transaksi baru (pasca perbaikan) — cuma 1 baris mutasi buat
          // seluruh transaksi, hapus baris itu & kurangi saldo sekali.
          await Promise.all(mutSnap.docs.map(d => deleteDoc(d.ref)));
          await updateDoc(doc(db, 'financial_accounts', mutationAccountId), { balance: increment(-(Number(row.amount) || 0)) });
        } else {
          // Transaksi grup lama (dibuat sebelum perbaikan ini) — tiap
          // pecahan pax masih punya baris mutasinya sendiri-sendiri, jadi
          // dicari & dihapus satu-satu lewat id doc payments_income aslinya.
          await Promise.all(row.docs.map(d => d.accountId ? removeAccountMutationBySource(d.accountId, d.id, -(Number(d.amount) || 0)) : Promise.resolve()));
        }
      }
      const affectedBookingIds = Array.from(new Set(row.docs.map(d => d.bookingId).filter(Boolean)));
      await Promise.all(affectedBookingIds.map(id => syncBookingTotalPaid(id)));
      fetchData();
    } catch (err) {
      alert("Gagal menghapus transaksi: " + err.message);
    }
  };

  // Catat Tagihan Vendor baru (invoice yang diterima, BELUM dibayar) —
  // ini yang bikin Hutang Usaha ke vendor beneran ke-hitung di Neraca,
  // nggak nunggu sampai duitnya keluar.
  const handleVendorBillSubmit = async (e) => {
    e.preventDefault();
    if (savingVendorBill) return; // cegah double-submit
    setSavingVendorBill(true);
    try {
      const selectedVendor = vendorsList.find(v => v.id === vendorBillForm.vendorId);
      if (!selectedVendor) {
        alert("Pilih vendornya dulu dari Data Master Vendor.");
        return;
      }
      const selectedPkg = packagesList.find(p => p.id === vendorBillForm.packageId);
      const billAmountVal = Number(vendorBillForm.amount);
      if (!billAmountVal || billAmountVal <= 0) {
        alert("Isi nominal tagihan yang valid.");
        return;
      }

      const billDateResolved = resolvePaymentCreatedAt(vendorBillForm.billDate);
      const billRef = await addDoc(collection(db, 'vendor_bills'), {
        vendorId: selectedVendor.id,
        vendorName: selectedVendor.name,
        packageId: selectedPkg?.id || '',
        packageName: selectedPkg?.name || '',
        billNumber: vendorBillForm.billNumber || '',
        category: vendorBillForm.category,
        amount: billAmountVal,
        amountPaid: 0,
        status: 'unpaid',
        billDate: vendorBillForm.billDate || todayISODate(),
        dueDate: vendorBillForm.dueDate || '',
        notes: vendorBillForm.notes || '',
        createdByUid: currentUser?.uid || '',
        createdByName: currentUser?.fullName || currentUser?.email || '',
        createdAt: billDateResolved
      });

      await postVendorBillCreated({
        billId: billRef.id,
        vendorName: selectedVendor.name,
        amount: billAmountVal,
        date: billDateResolved,
        createdByUid: currentUser?.uid,
        createdByName: currentUser?.fullName || currentUser?.email
      }).catch(err => {
        console.error('Gagal posting jurnal tagihan vendor:', err);
        alert(`Tagihan vendor tersimpan, TAPI jurnalnya GAGAL diposting (${err.message}). Hutang Vendor di Neraca belum akurat sampai dikoreksi — segera lapor ke tim IT/Finance.`);
      });

      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'create',
        module: 'Tagihan Vendor',
        targetLabel: selectedVendor.name,
        details: `Mencatat tagihan vendor "${selectedVendor.name}" (${vendorBillForm.category}) senilai Rp ${billAmountVal.toLocaleString('id-ID')}${vendorBillForm.billNumber ? ` (No. ${vendorBillForm.billNumber})` : ''}`
      });
      setShowVendorBillModal(false);
      setVendorBillForm({ vendorId: '', packageId: '', billNumber: '', category: vendorCategories[0], amount: '', billDate: todayISODate(), dueDate: '', notes: '' });
      fetchData();
    } catch (err) {
      alert("Gagal mencatat tagihan vendor: " + err.message);
    } finally {
      setSavingVendorBill(false);
    }
  };

  // Hapus Tagihan Vendor — CUMA boleh kalau belum ada pembayaran yang
  // nempel ke tagihan ini (amountPaid === 0). Kalau udah ada pembayaran
  // yang di-link, hapus dulu/lepas link pembayarannya baru bisa hapus
  // tagihannya — biar nggak ninggalin payments_vendor yang nunjuk ke
  // tagihan yang udah nggak ada.
  const handleDeleteVendorBill = async (bill) => {
    if (Number(bill.amountPaid) > 0) {
      alert(`Tagihan ini udah ada pembayaran senilai Rp ${Number(bill.amountPaid).toLocaleString('id-ID')} yang nempel. Nggak bisa dihapus langsung — hapus dulu pembayaran vendor yang terkait tagihan ini di tab "Riwayat Bayar Vendor".`);
      return;
    }
    if (!confirm(`Yakin mau hapus tagihan vendor "${bill.vendorName}" senilai Rp ${Number(bill.amount).toLocaleString('id-ID')}?`)) return;
    try {
      await deleteDoc(doc(db, 'vendor_bills', bill.id));
      await deleteJournalEntriesBySource('vendor_bill_created', bill.id);
      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'delete',
        module: 'Tagihan Vendor',
        targetLabel: bill.vendorName,
        details: `Menghapus tagihan vendor "${bill.vendorName}" senilai Rp ${Number(bill.amount).toLocaleString('id-ID')}`
      });
      fetchData();
    } catch (err) {
      alert("Gagal menghapus tagihan vendor: " + err.message);
    }
  };

  const handleVendorSubmit = async (e) => {
    e.preventDefault();
    if (savingVendor) return; // cegah double-submit
    setSavingVendor(true);
    try {
      const selectedPkg = packagesList.find(p => p.id === vendorForm.packageId);
      if (!selectedPkg) {
        alert("Pilih paket keberangkatan terkait dulu. Kalau ini biaya kantor yang bukan buat trip tertentu, catat lewat tombol \"Biaya Operasional Kantor\", bukan di sini.");
        return;
      }
      const selectedVendor = vendorsList.find(v => v.id === vendorForm.vendorId);
      if (!selectedVendor) {
        alert("Pilih vendornya dulu dari Data Master Vendor. Kalau belum ada, tambahkan dulu lewat tab \"Data Vendor\".");
        return;
      }
      const vendorAmountVal = Number(vendorForm.amount);
      const isDepositPay = vendorForm.payMethod === 'Saldo Deposit Vendor';

      if (isDepositPay) {
        const currentDeposit = Number(selectedVendor.depositBalance || 0);
        if (vendorAmountVal > currentDeposit) {
          alert(`Saldo Deposit vendor "${selectedVendor.name}" tidak cukup. Saldo saat ini: Rp ${currentDeposit.toLocaleString('id-ID')}, dibutuhkan: Rp ${vendorAmountVal.toLocaleString('id-ID')}.`);
          return;
        }
      } else if (!vendorForm.accountId) {
        alert("Pilih akun Kas/Bank yang dipakai bayar vendor ini dulu.");
        return;
      }
      const vendorAccount = financialAccounts.find(a => a.id === vendorForm.accountId);
      const selectedBill = vendorForm.billId ? vendorBills.find(b => b.id === vendorForm.billId) : null;
      if (vendorForm.billId && !selectedBill) {
        alert("Tagihan yang dipilih nggak ketemu (mungkin udah dihapus) — pilih ulang atau kosongkan pilihan tagihan.");
        return;
      }
      if (selectedBill) {
        const sisaTagihan = Number(selectedBill.amount) - Number(selectedBill.amountPaid || 0);
        if (vendorAmountVal > sisaTagihan + 1) {
          alert(`Nominal pembayaran (Rp ${vendorAmountVal.toLocaleString('id-ID')}) lebih besar dari sisa tagihan "${selectedBill.billNumber || selectedBill.category}" (Rp ${sisaTagihan.toLocaleString('id-ID')}). Kurangi nominalnya atau bayar sisanya lewat tagihan lain.`);
          return;
        }
      }

      const paymentDateResolved = resolvePaymentCreatedAt(vendorForm.paymentDate);
      const vendorRef = await addDoc(collection(db, 'payments_vendor'), {
        packageId: selectedPkg.id,
        packageName: selectedPkg.name,
        vendorId: selectedVendor.id,
        vendorName: selectedVendor.name,
        category: vendorForm.category,
        amount: vendorAmountVal,
        payMethod: vendorForm.payMethod,
        ...(isDepositPay ? {} : { accountId: vendorForm.accountId, accountName: vendorAccount?.name || '' }),
        ...(selectedBill ? { billId: selectedBill.id } : {}),
        notes: vendorForm.notes,
        createdAt: paymentDateResolved
      });

      if (isDepositPay) {
        await adjustVendorDepositBalance(
          selectedVendor.id,
          selectedVendor.name,
          -vendorAmountVal,
          'usage',
          `Bayar ${vendorForm.category} - ${selectedPkg.name}`,
          selectedPkg.name,
          paymentDateResolved
        );
      } else {
        await adjustAccountBalance(vendorForm.accountId, -vendorAmountVal, {
          description: `Bayar Vendor - ${selectedVendor.name} (${vendorForm.category})`,
          reference: selectedVendor.name,
          source: 'vendor_payment',
          date: paymentDateResolved,
          sourceDocId: vendorRef.id
        });
      }

      // Kalau pembayaran ini dilink ke Tagihan Vendor, kurangi sisa
      // tagihannya & update status (unpaid/partial/paid) sekalian.
      if (selectedBill) {
        const newAmountPaid = Number(selectedBill.amountPaid || 0) + vendorAmountVal;
        const newStatus = newAmountPaid >= Number(selectedBill.amount) - 1 ? 'paid' : (newAmountPaid > 0 ? 'partial' : 'unpaid');
        await updateDoc(doc(db, 'vendor_bills', selectedBill.id), { amountPaid: newAmountPaid, status: newStatus });
      }

      await postVendorPayment({
        paymentId: vendorRef.id,
        vendorName: selectedVendor.name,
        amount: vendorAmountVal,
        payMethod: vendorForm.payMethod,
        accountId: isDepositPay ? null : vendorForm.accountId,
        accountName: isDepositPay ? null : (vendorAccount?.name || ''),
        billId: selectedBill?.id || null,
        date: paymentDateResolved,
        createdByUid: currentUser?.uid,
        createdByName: currentUser?.fullName || currentUser?.email
      }).catch(err => {
        console.error('Gagal posting jurnal bayar vendor:', err);
        alert(`Pembayaran vendor tersimpan & saldo Kas/Bank sudah terpotong, TAPI jurnalnya GAGAL diposting (${err.message}). Laporan Keuangan (Neraca/Buku Besar) untuk transaksi ini belum akurat sampai dikoreksi — segera lapor ke tim IT/Finance.`);
      });

      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'create',
        module: 'Pembayaran Vendor',
        targetLabel: selectedVendor.name,
        details: `Mencatat pembayaran vendor "${selectedVendor.name}" (${vendorForm.category}) senilai Rp ${vendorAmountVal.toLocaleString('id-ID')} untuk paket "${selectedPkg.name}"${selectedBill ? ` (bayar tagihan ${selectedBill.billNumber || selectedBill.category})` : ''}`
      });
      setShowVendorModal(false);
      setVendorForm({ packageId: '', vendorId: '', vendorName: '', category: vendorCategories[0], payMethod: 'Kas/Bank', amount: '', accountId: '', billId: '', notes: 'DP Booking Seat', paymentDate: todayISODate() });
      fetchData();
    } catch (err) {
      alert("Gagal mencatat pembayaran vendor: " + err.message);
    } finally {
      setSavingVendor(false);
    }
  };

  // Buka form Catat Biaya Operasional dalam mode EDIT — dipake pas ada
  // salah pilih kategori/akun/nominal pas nyatet, jadi nggak perlu
  // hapus-lalu-catat-ulang manual.
  const handleEditOperationalExpense = (op) => {
    setEditingOperationalId(op.id);
    setOperationalForm({
      category: op.category || operationalCategories[0],
      amount: String(op.amount ?? ''),
      accountId: op.accountId || '',
      notes: op.notes || '',
      expenseDate: (op.expenseDate || (op.createdAt || '').slice(0, 10) || todayISODate())
    });
    setShowOperationalModal(true);
  };

  const handleOperationalSubmit = async (e) => {
    e.preventDefault();
    if (savingOperational) return; // cegah double-submit
    setSavingOperational(true);
    try {
      if (!operationalForm.accountId) {
        alert("Pilih akun Kas/Bank yang dipakai bayar biaya ini dulu.");
        return;
      }
      const opAccount = financialAccounts.find(a => a.id === operationalForm.accountId);
      const opAmountVal = Number(operationalForm.amount);
      const expenseDateVal = operationalForm.expenseDate || todayISODate();
      const journalDate = resolvePaymentCreatedAt(expenseDateVal);

      if (editingOperationalId) {
        // Mode EDIT: cari data lama dulu buat tau akun & nominal SEBELUM
        // diubah, biar bisa dibalik dulu (kembaliin saldo akun lama +
        // hapus riwayat mutasi & jurnal lama) sebelum nerapin nilai baru —
        // pola yang sama kayak hapus-lalu-catat-ulang, cuma digabung jadi
        // 1 langkah biar user nggak perlu 2 aksi terpisah.
        const oldOp = operationalExpenses.find(o => o.id === editingOperationalId);
        if (oldOp?.accountId) {
          await removeAccountMutationBySource(oldOp.accountId, editingOperationalId, Number(oldOp.amount) || 0);
        }
        await deleteJournalEntriesBySource('operational_expense', editingOperationalId);

        await updateDoc(doc(db, 'expenses_operational', editingOperationalId), {
          category: operationalForm.category,
          amount: opAmountVal,
          accountId: operationalForm.accountId,
          accountName: opAccount?.name || '',
          notes: operationalForm.notes,
          expenseDate: expenseDateVal
        });
        await adjustAccountBalance(operationalForm.accountId, -opAmountVal, {
          description: `Biaya Operasional - ${operationalForm.category}`,
          reference: operationalForm.category || '',
          source: 'operational_expense',
          date: journalDate,
          sourceDocId: editingOperationalId
        });
        await postOperationalExpense({
          expenseId: editingOperationalId, category: operationalForm.category, amount: opAmountVal,
          accountId: operationalForm.accountId, accountName: opAccount?.name || '',
          date: journalDate,
          createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
        }).catch(err => {
          console.error('Gagal posting jurnal biaya operasional:', err);
          alert(`Biaya operasional tersimpan & saldo Kas/Bank sudah terpotong, TAPI jurnalnya GAGAL diposting (${err.message}). Laporan Keuangan (Neraca/Buku Besar/Laba Rugi) untuk transaksi ini belum akurat sampai dikoreksi — segera lapor ke tim IT/Finance.`);
        });

        logActivity({
          userId: currentUser?.uid,
          userName: currentUser?.fullName || currentUser?.email,
          userRole: currentUser?.role,
          action: 'update',
          module: 'Pengeluaran Operasional',
          targetLabel: operationalForm.category,
          details: `Mengubah catatan biaya operasional "${oldOp?.category || '-'}" (Rp ${Number(oldOp?.amount || 0).toLocaleString('id-ID')}) jadi "${operationalForm.category}" (Rp ${opAmountVal.toLocaleString('id-ID')})`
        });
      } else {
        const opRef = await addDoc(collection(db, 'expenses_operational'), {
          category: operationalForm.category,
          amount: opAmountVal,
          accountId: operationalForm.accountId,
          accountName: opAccount?.name || '',
          notes: operationalForm.notes,
          expenseDate: expenseDateVal,
          createdAt: new Date().toISOString()
        });
        await adjustAccountBalance(operationalForm.accountId, -opAmountVal, {
          description: `Biaya Operasional - ${operationalForm.category}`,
          reference: operationalForm.category || '',
          source: 'operational_expense',
          date: journalDate,
          sourceDocId: opRef.id
        });
        await postOperationalExpense({
          expenseId: opRef.id, category: operationalForm.category, amount: opAmountVal,
          accountId: operationalForm.accountId, accountName: opAccount?.name || '',
          date: journalDate,
          createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
        }).catch(err => {
          console.error('Gagal posting jurnal biaya operasional:', err);
          alert(`Biaya operasional tersimpan & saldo Kas/Bank sudah terpotong, TAPI jurnalnya GAGAL diposting (${err.message}). Laporan Keuangan (Neraca/Buku Besar/Laba Rugi) untuk transaksi ini belum akurat sampai dikoreksi — segera lapor ke tim IT/Finance.`);
        });

        logActivity({
          userId: currentUser?.uid,
          userName: currentUser?.fullName || currentUser?.email,
          userRole: currentUser?.role,
          action: 'create',
          module: 'Pengeluaran Operasional',
          targetLabel: operationalForm.category,
          details: `Mencatat biaya operasional "${operationalForm.category}" senilai Rp ${opAmountVal.toLocaleString('id-ID')}`
        });
      }

      setShowOperationalModal(false);
      setEditingOperationalId(null);
      setOperationalForm({ category: operationalCategories[0], amount: '', accountId: '', notes: '', expenseDate: todayISODate() });
      fetchData();
    } catch (err) {
      alert("Gagal menyimpan biaya operasional: " + err.message);
    } finally {
      setSavingOperational(false);
    }
  };

  const totalIncome = transactions.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalVendorPaid = vendorPayments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalOperational = operationalExpenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const netCashflow = totalIncome - totalVendorPaid - totalOperational;

  // Opsi "Pilih Kode Booking" di modal Terima Setoran Jamaah — dikelompokkan
  // per kode booking rombongan (bukan per pax lagi), biar 1 kode booking cuma
  // muncul 1x meskipun pesertanya banyak.
  const groupedBookingOptions = (() => {
    const map = {};
    bookingsList.forEach(b => {
      const code = b.groupBookingCode || b.bookingCode;
      if (!map[code]) map[code] = [];
      map[code].push(b);
    });
    return Object.entries(map).map(([code, items]) => ({
      code,
      items,
      primary: items[0],
      paxCount: items.length
    }));
  })();

  // Baris "Riwayat Setoran Jamaah" — setoran yang kesplit ke beberapa pax
  // dalam 1 kode booking rombongan digabung balik jadi 1 baris nominal utuh.
  const incomeRows = buildMergedIncomeRows(transactions, bookingsList);

  // Paket terkait suatu setoran/pembayaran vendor, dipakai buat cek status pengakuan pendapatan.
  // Prioritas cari lewat packageId (akurat, nggak ambigu). packageName cuma
  // fallback buat setoran lama yang dicatat sebelum field packageId ada —
  // matching pakai nama rawan salah kalau ada 2 paket dengan nama sama persis.
  const findPackageForIncome = (tx) => {
    if (tx.packageId) {
      const byId = packagesList.find(p => p.id === tx.packageId);
      if (byId) return byId;
    }
    return packagesList.find(p => p.name === tx.packageName) || null;
  };
  const findPackageForVendor = (vp) => {
    if (!vp.packageId || vp.packageId === 'GLOBAL') return null;
    return packagesList.find(p => p.id === vp.packageId) || packagesList.find(p => p.name === vp.packageName) || null;
  };

  // ================= Laporan > Closing TC & Komisi =================
  // Cuma booking yang closing-nya lewat TC (closingSourceType === 'tc' dan
  // closingSourceId keisi) yang dihitung — closing dari Partner atau yang
  // sumbernya kosong nggak masuk laporan ini. Difilter dari bookingsList
  // berdasarkan tanggal transaksi (createdAt) yang jatuh di RENTANG TANGGAL
  // (closingTcStartDate s/d closingTcEndDate, inklusif keduanya) yang
  // dipilih — bukan lagi per bulan kalender, biar HRD bisa atur cutoff
  // payroll-nya sendiri (mis. tanggal 22 - 21 bulan berikutnya).
  const closingTcBookingsInPeriod = bookingsList.filter(bk => {
    if (bk.closingSourceType !== 'tc' || !bk.closingSourceId) return false;
    const txDate = toLocalDateOnlyString(bk.createdAt);
    if (!txDate) return false;
    if (closingTcStartDate && txDate < closingTcStartDate) return false;
    if (closingTcEndDate && txDate > closingTcEndDate) return false;
    return true;
  });

  // Rekap per TC (key = closingSourceId) berisi total closingan/pax + rincian
  // per Kategori Destinasi (dari packagesList.destinationCity, fallback
  // 'Lainnya' kalau paketnya udah nggak ketemu).
  const closingTcSummary = (() => {
    const byTc = {};
    closingTcBookingsInPeriod.forEach(bk => {
      const tcId = bk.closingSourceId;
      const tcName = bk.closingSourceName || '(Tanpa Nama)';
      const pkg = packagesList.find(p => p.id === bk.packageId);
      const destCategory = pkg?.destinationCity || 'Lainnya';
      const amount = Number(bk.totalAmount) || 0;

      if (!byTc[tcId]) {
        byTc[tcId] = { tcId, tcName, totalClosing: 0, totalPax: 0, byDestination: {} };
      }
      byTc[tcId].totalClosing += amount;
      byTc[tcId].totalPax += 1;

      if (!byTc[tcId].byDestination[destCategory]) {
        byTc[tcId].byDestination[destCategory] = { category: destCategory, closing: 0, pax: 0 };
      }
      byTc[tcId].byDestination[destCategory].closing += amount;
      byTc[tcId].byDestination[destCategory].pax += 1;
    });

    return Object.values(byTc)
      .map(tc => ({
        ...tc,
        byDestination: Object.values(tc.byDestination).sort((a, b) => b.closing - a.closing)
      }))
      .sort((a, b) => b.totalClosing - a.totalClosing);
  })();

  const closingTcGrandTotal = closingTcSummary.reduce((acc, tc) => ({
    totalClosing: acc.totalClosing + tc.totalClosing,
    totalPax: acc.totalPax + tc.totalPax
  }), { totalClosing: 0, totalPax: 0 });

  // ================= Laporan > Sumber Lead per Bulan =================
  // Komposisi closing/seat per Sumber Lead (diisi TC/Sales pas registrasi
  // booking) buat 1 bulan terpilih — dipisah dari Closing TC di atas karena
  // ini soal DARI MANA calon jamaah kenal WHI, bukan siapa yang closing-in.
  const leadSourceAvailablePeriods = Array.from(new Set(
    bookingsList.map(bk => getPeriodKey(bk.createdAt)).filter(Boolean)
  )).sort().reverse();

  const LEAD_SOURCE_COLORS = ['#3b82f6', '#f97316', '#10b981', '#f59e0b', '#ec4899', '#6366f1', '#ef4444', '#22c55e', '#a855f7', '#14b8a6'];

  const leadSourceReport = (() => {
    const bookingsInPeriod = bookingsList.filter(bk => getPeriodKey(bk.createdAt) === leadSourcePeriod);

    // Basis "Purchase" = jumlah closing/pemesanan — 1 grup rombongan (dikenali
    // dari groupBookingCode) dihitung 1x, biar nggak keganda per-pax. Basis
    // "Seat" = jumlah pax/seat — tiap dokumen booking dihitung apa adanya
    // (persis pola getPackageSeatInfo di modul Paket).
    const bucket = {};
    const seenGroupKeys = new Set();

    bookingsInPeriod.forEach(bk => {
      const label = (bk.leadSource || '').trim() || 'Tidak Diisi';
      if (leadSourceMetric === 'seat') {
        bucket[label] = (bucket[label] || 0) + 1;
      } else {
        const groupKey = bk.groupBookingCode || bk.bookingCode || bk.id;
        if (seenGroupKeys.has(groupKey)) return;
        seenGroupKeys.add(groupKey);
        bucket[label] = (bucket[label] || 0) + 1;
      }
    });

    const total = Object.values(bucket).reduce((a, b) => a + b, 0);
    const entries = Object.entries(bucket)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    // Sumber dengan kontribusi kecil (di luar 8 besar, atau share < 2%)
    // digabung jadi 1 slice "Lainnya" biar pie-nya tetap kebaca.
    const MAX_SLICES = 8;
    const MIN_SHARE = 0.02;
    const top = [];
    let othersCount = 0;
    entries.forEach((entry, idx) => {
      const share = total > 0 ? entry.count / total : 0;
      if (idx < MAX_SLICES && share >= MIN_SHARE) {
        top.push({ ...entry });
      } else {
        othersCount += entry.count;
      }
    });
    if (othersCount > 0) {
      const existingLainnya = top.find(e => e.label === 'Lainnya');
      if (existingLainnya) {
        existingLainnya.count += othersCount;
      } else {
        top.push({ label: 'Lainnya', count: othersCount });
      }
    }
    top.sort((a, b) => b.count - a.count);

    const slices = top.map((entry, idx) => ({
      ...entry,
      percent: total > 0 ? (entry.count / total) * 100 : 0,
      color: LEAD_SOURCE_COLORS[idx % LEAD_SOURCE_COLORS.length]
    }));

    return { slices, total };
  })();

  const leadSourceConicGradient = (() => {
    if (leadSourceReport.slices.length === 0) return null;
    let cursor = 0;
    const stops = leadSourceReport.slices.map(s => {
      const start = cursor;
      const end = cursor + s.percent;
      cursor = end;
      return `${s.color} ${start}% ${end}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  })();

  const toggleClosingTcExpand = (tcId) => {
    setExpandedClosingTcIds(prev => prev.includes(tcId) ? prev.filter(id => id !== tcId) : [...prev, tcId]);
  };

  // Escape 1 field CSV: dibungkus tanda kutip dua kalau isinya ada koma,
  // kutip dua, atau baris baru — kutip dua di dalamnya di-double-kan.
  const csvEscapeField = (value) => {
    const str = String(value ?? '');
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const handleDownloadClosingTcCSV = () => {
    const rows = [['Nama TC', 'Kategori Destinasi', 'Jumlah Closingan', 'Jumlah Pax']];
    closingTcSummary.forEach(tc => {
      tc.byDestination.forEach(dest => {
        rows.push([tc.tcName, dest.category, dest.closing, dest.pax]);
      });
    });
    rows.push(['TOTAL', '', closingTcGrandTotal.totalClosing, closingTcGrandTotal.totalPax]);

    // BOM di depan biar Excel baca UTF-8 dengan benar (nama TC/destinasi
    // yang pakai karakter non-ASCII nggak jadi karakter aneh pas dibuka).
    const csvContent = '﻿' + rows.map(row => row.map(csvEscapeField).join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Laporan-Closing-TC-${closingTcStartDate || 'awal'}_${closingTcEndDate || 'akhir'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  // ================ /Laporan > Closing TC & Komisi ================

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Wallet className="w-5 h-5 text-emerald-500" /> Arus Kas Operasional & Payments
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Pencatatan setoran jamaah dan pembayaran deposit/pelunasan vendor.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowIncomeModal(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
          >
            <ArrowDownLeft className="w-4 h-4" /> + Terima Setoran Jamaah
          </button>
          <button
            onClick={() => setShowDepositModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
          >
            <Wallet className="w-4 h-4" /> + Tambah Deposit
          </button>
          <button
            onClick={() => setShowVendorModal(true)}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
          >
            <ArrowUpRight className="w-4 h-4" /> + Bayar Vendor
          </button>
          <button
            onClick={() => { setEditingOperationalId(null); setOperationalForm({ category: operationalCategories[0], amount: '', accountId: '', notes: '', expenseDate: todayISODate() }); setShowOperationalModal(true); }}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
          >
            <Building2 className="w-4 h-4" /> + Biaya Operasional Kantor
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className={`${styles.cardBg} border p-5 rounded-xl`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Total Kas Masuk (Jamaah)</p>
          <h3 className="text-2xl font-bold text-emerald-500">Rp {totalIncome.toLocaleString('id-ID')}</h3>
        </div>
        <div className={`${styles.cardBg} border p-5 rounded-xl`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Total Keluar (Vendor & Flight)</p>
          <h3 className="text-2xl font-bold text-rose-500">Rp {totalVendorPaid.toLocaleString('id-ID')}</h3>
        </div>
        <div className={`${styles.cardBg} border p-5 rounded-xl`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Total Biaya Operasional Kantor</p>
          <h3 className="text-2xl font-bold text-amber-500">Rp {totalOperational.toLocaleString('id-ID')}</h3>
        </div>
        <div className={`${styles.cardBg} border p-5 rounded-xl`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Saldo Kas Bersih Operasional</p>
          <h3 className={`text-2xl font-bold ${netCashflow >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>
            Rp {netCashflow.toLocaleString('id-ID')}
          </h3>
        </div>
      </div>

      <div className={`flex gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-2`}>
        <button
          onClick={() => setActiveTab('income')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'income' ? `${styles.tabActive} text-emerald-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          Riwayat Setoran Jamaah ({transactions.length})
        </button>
        <button
          onClick={() => setActiveTab('vendor')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'vendor' ? `${styles.tabActive} text-rose-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          Riwayat Bayar Vendor ({vendorPayments.length})
        </button>
        <button
          onClick={() => setActiveTab('vendor_bills')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'vendor_bills' ? `${styles.tabActive} text-orange-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          Tagihan Vendor ({vendorBills.filter(b => b.status !== 'paid').length})
        </button>
        <button
          onClick={() => setActiveTab('operational')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'operational' ? `${styles.tabActive} text-amber-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          Biaya Operasional Kantor ({operationalExpenses.length})
        </button>
        <button
          onClick={() => setActiveTab('vendors_master')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
            activeTab === 'vendors_master' ? `${styles.tabActive} text-rose-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          <Building2 className="w-3.5 h-3.5" /> Data Vendor ({vendorsList.length})
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
            activeTab === 'reports' ? `${styles.tabActive} text-indigo-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          <FileBarChart className="w-3.5 h-3.5" /> Laporan
        </button>
      </div>

      {activeTab === 'income' && (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <tr>
                  <th className="p-4">Kode Booking / Jamaah</th>
                  <th className="p-4">Paket Travel</th>
                  <th className="p-4">Metode & Catatan</th>
                  <th className="p-4">Tanggal Setor</th>
                  <th className="p-4 text-right">Nominal Masuk</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {incomeRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className={`p-8 text-center ${styles.textSub}`}>Belum ada transaksi setoran jamaah.</td>
                  </tr>
                ) : (
                  incomeRows.map((row) => (
                    <tr key={row.key} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>
                        {row.paxCount > 1 ? `${row.paxCount} Peserta` : (row.jamaahName || '-')}
                        {row.ordererName && (
                          <span className={`block text-[10.5px] font-normal ${styles.textSub}`}>
                            {row.ordererName}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (onSelectBooking && row.bookingId) {
                              onSelectBooking(row.bookingId);
                            }
                          }}
                          className="block text-[10px] text-emerald-500 font-mono hover:underline text-left cursor-pointer"
                        >
                          {row.groupCode} ↗
                        </button>
                      </td>
                      <td className={`p-4 ${styles.textTitle}`}>{row.packageName}</td>
                      <td className="p-4">
                        <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] mr-1`}>{row.paymentMethod}{row.accountName ? ` - ${row.accountName}` : ''}</span>
                        <span className={styles.textSub}>{row.notes}</span>
                      </td>
                      <td className={`p-4 ${styles.textSub}`}>{formatDateDDMMYYYY(row.createdAt)}</td>
                      <td className="p-4 text-right font-bold text-emerald-500">
                        + Rp {Number(row.amount).toLocaleString('id-ID')}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleDeleteIncomeRow(row)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                          title="Hapus Transaksi Setoran"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 p-3">
            {incomeRows.length === 0 ? (
              <p className={`p-8 text-center text-xs ${styles.textSub}`}>Belum ada transaksi setoran jamaah.</p>
            ) : (
              incomeRows.map((row) => (
                <div key={row.key} className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-2`}>
                  <div>
                    <div className={`font-semibold ${styles.textTitle}`}>
                      {row.paxCount > 1 ? `${row.paxCount} Peserta` : (row.jamaahName || '-')}
                    </div>
                    {row.ordererName && (
                      <span className={`block text-[10.5px] font-normal ${styles.textSub}`}>{row.ordererName}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (onSelectBooking && row.bookingId) {
                          onSelectBooking(row.bookingId);
                        }
                      }}
                      className="block text-[10px] text-emerald-500 font-mono hover:underline text-left cursor-pointer"
                    >
                      {row.groupCode} ↗
                    </button>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Paket Travel</span>
                    <div className={styles.textTitle}>{row.packageName}</div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Metode & Catatan</span>
                    <div>
                      <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] mr-1`}>{row.paymentMethod}{row.accountName ? ` - ${row.accountName}` : ''}</span>
                      <span className={styles.textSub}>{row.notes}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Tanggal Setor</span>
                    <div className={styles.textSub}>{formatDateDDMMYYYY(row.createdAt)}</div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Nominal Masuk</span>
                    <div className="font-bold text-emerald-500">+ Rp {Number(row.amount).toLocaleString('id-ID')}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => handleDeleteIncomeRow(row)}
                      className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                      title="Hapus Transaksi Setoran"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'vendor' && (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <tr>
                  <th className="p-4">Nama Vendor / Supplier</th>
                  <th className="p-4">Kategori Layanan</th>
                  <th className="p-4">Paket Terkait</th>
                  <th className="p-4">Catatan & Tanggal</th>
                  <th className="p-4 text-right">Nominal Dibayar</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {vendorPayments.length === 0 ? (
                  <tr>
                    <td colSpan="6" className={`p-8 text-center ${styles.textSub}`}>Belum ada riwayat pembayaran vendor.</td>
                  </tr>
                ) : (
                  vendorPayments.map((vp) => (
                    <tr key={vp.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>{vp.vendorName}</td>
                      <td className="p-4">
                        <span className="bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2.5 py-1 rounded-full font-medium">
                          {vp.category}
                        </span>
                      </td>
                      <td className={`p-4 ${styles.textTitle}`}>
                        {vp.packageName}
                        {vp.packageId === 'GLOBAL' && (
                          <span className="block text-[10px] text-amber-500 font-medium mt-0.5">
                            ⚠ Data lama tanpa paket — review manual
                          </span>
                        )}
                      </td>
                      <td className={`p-4 ${styles.textSub}`}>
                        {vp.notes}
                        <span className="block text-[10px] text-slate-400">{formatDateDDMMYYYY(vp.createdAt)}</span>
                        {vp.payMethod === 'Saldo Deposit Vendor' && (
                          <span className="inline-block mt-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[10px] font-medium">Pakai Saldo Deposit</span>
                        )}
                        {vp.convertedToDeposit && (
                          <span className="inline-block mt-1 ml-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-0.5 rounded-full text-[10px] font-medium">✓ Dikonversi ke Deposit</span>
                        )}
                      </td>
                      <td className="p-4 text-right font-bold text-rose-500">
                        - Rp {Number(vp.amount).toLocaleString('id-ID')}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {!vp.convertedToDeposit && vp.payMethod !== 'Saldo Deposit Vendor' && (
                            <button
                              onClick={() => handleOpenConvertModal(vp)}
                              className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                              title="Konversi ke Saldo Deposit (DP batal, nggak hangus)"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteVendorPayment(vp)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                            title="Hapus Pembayaran Vendor"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 p-3">
            {vendorPayments.length === 0 ? (
              <p className={`p-8 text-center text-xs ${styles.textSub}`}>Belum ada riwayat pembayaran vendor.</p>
            ) : (
              vendorPayments.map((vp) => (
                <div key={vp.id} className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-2`}>
                  <div className={`font-semibold ${styles.textTitle}`}>{vp.vendorName}</div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Kategori Layanan</span>
                    <div>
                      <span className="bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2.5 py-1 rounded-full font-medium inline-block">
                        {vp.category}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Paket Terkait</span>
                    <div className={styles.textTitle}>
                      {vp.packageName}
                      {vp.packageId === 'GLOBAL' && (
                        <span className="block text-[10px] text-amber-500 font-medium mt-0.5">
                          ⚠ Data lama tanpa paket — review manual
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Catatan & Tanggal</span>
                    <div className={styles.textSub}>
                      {vp.notes}
                      <span className="block text-[10px] text-slate-400">{formatDateDDMMYYYY(vp.createdAt)}</span>
                      {vp.payMethod === 'Saldo Deposit Vendor' && (
                        <span className="inline-block mt-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[10px] font-medium">Pakai Saldo Deposit</span>
                      )}
                      {vp.convertedToDeposit && (
                        <span className="inline-block mt-1 ml-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-0.5 rounded-full text-[10px] font-medium">✓ Dikonversi ke Deposit</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Nominal Dibayar</span>
                    <div className="font-bold text-rose-500">- Rp {Number(vp.amount).toLocaleString('id-ID')}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!vp.convertedToDeposit && vp.payMethod !== 'Saldo Deposit Vendor' && (
                      <button
                        onClick={() => handleOpenConvertModal(vp)}
                        className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                        title="Konversi ke Saldo Deposit (DP batal, nggak hangus)"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteVendorPayment(vp)}
                      className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                      title="Hapus Pembayaran Vendor"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'vendor_bills' && (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <div className="p-4 flex justify-end">
            <button
              onClick={() => setShowVendorBillModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Catat Tagihan Vendor Baru
            </button>
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <tr>
                  <th className="p-4">Vendor / No. Tagihan</th>
                  <th className="p-4">Kategori</th>
                  <th className="p-4">Paket Terkait</th>
                  <th className="p-4">Tgl Tagihan / Jatuh Tempo</th>
                  <th className="p-4 text-right">Nominal / Sisa</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {vendorBills.length === 0 ? (
                  <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Belum ada tagihan vendor tercatat.</td></tr>
                ) : (
                  vendorBills
                    .slice()
                    .sort((a, b) => new Date(b.billDate || b.createdAt || 0) - new Date(a.billDate || a.createdAt || 0))
                    .map((bill) => {
                      const sisa = Number(bill.amount) - Number(bill.amountPaid || 0);
                      const statusStyle = bill.status === 'paid'
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                        : bill.status === 'partial'
                          ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                          : 'bg-rose-500/10 text-rose-500 border-rose-500/20';
                      const statusLabel = bill.status === 'paid' ? 'Lunas' : bill.status === 'partial' ? 'Sebagian' : 'Belum Dibayar';
                      return (
                        <tr key={bill.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                          <td className={`p-4 font-semibold ${styles.textTitle}`}>
                            {bill.vendorName}
                            {bill.billNumber && <span className={`block text-[10px] font-normal ${styles.textSub}`}>No. {bill.billNumber}</span>}
                          </td>
                          <td className="p-4">
                            <span className="bg-orange-500/10 text-orange-500 border border-orange-500/20 px-2.5 py-1 rounded-full font-medium">{bill.category}</span>
                          </td>
                          <td className={`p-4 ${styles.textSub}`}>{bill.packageName || '-'}</td>
                          <td className={`p-4 ${styles.textSub}`}>
                            {formatDateDDMMYYYY(bill.billDate)}
                            {bill.dueDate && <span className="block text-[10px]">Jatuh tempo: {formatDateDDMMYYYY(bill.dueDate)}</span>}
                          </td>
                          <td className="p-4 text-right">
                            <div className={`font-bold ${styles.textTitle}`}>Rp {Number(bill.amount).toLocaleString('id-ID')}</div>
                            {sisa > 0 && bill.status !== 'unpaid' && (
                              <div className="text-[10px] text-amber-500">Sisa Rp {sisa.toLocaleString('id-ID')}</div>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            <span className={`px-2.5 py-1 rounded-full border font-medium ${statusStyle}`}>{statusLabel}</span>
                          </td>
                          <td className="p-4 text-center">
                            <button
                              onClick={() => handleDeleteVendorBill(bill)}
                              className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                              title="Hapus Tagihan Vendor"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 p-3">
            {vendorBills.length === 0 ? (
              <p className={`p-8 text-center text-xs ${styles.textSub}`}>Belum ada tagihan vendor tercatat.</p>
            ) : (
              vendorBills
                .slice()
                .sort((a, b) => new Date(b.billDate || b.createdAt || 0) - new Date(a.billDate || a.createdAt || 0))
                .map((bill) => {
                  const sisa = Number(bill.amount) - Number(bill.amountPaid || 0);
                  const statusStyle = bill.status === 'paid'
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                    : bill.status === 'partial'
                      ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                      : 'bg-rose-500/10 text-rose-500 border-rose-500/20';
                  const statusLabel = bill.status === 'paid' ? 'Lunas' : bill.status === 'partial' ? 'Sebagian' : 'Belum Dibayar';
                  return (
                    <div key={bill.id} className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-2`}>
                      <div className="flex justify-between items-start">
                        <div className={`font-semibold ${styles.textTitle}`}>
                          {bill.vendorName}
                          {bill.billNumber && <span className={`block text-[10px] font-normal ${styles.textSub}`}>No. {bill.billNumber}</span>}
                        </div>
                        <span className={`px-2 py-0.5 rounded-full border font-medium text-[10px] ${statusStyle}`}>{statusLabel}</span>
                      </div>
                      <div><span className="bg-orange-500/10 text-orange-500 border border-orange-500/20 px-2.5 py-1 rounded-full font-medium">{bill.category}</span></div>
                      <div className={styles.textSub}>Paket: {bill.packageName || '-'}</div>
                      <div className={styles.textSub}>
                        {formatDateDDMMYYYY(bill.billDate)}
                        {bill.dueDate && ` • Jatuh tempo: ${formatDateDDMMYYYY(bill.dueDate)}`}
                      </div>
                      <div className={`font-bold ${styles.textTitle}`}>Rp {Number(bill.amount).toLocaleString('id-ID')}</div>
                      {sisa > 0 && bill.status !== 'unpaid' && <div className="text-amber-500">Sisa Rp {sisa.toLocaleString('id-ID')}</div>}
                      <button
                        onClick={() => handleDeleteVendorBill(bill)}
                        className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                        title="Hapus Tagihan Vendor"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      )}

      {activeTab === 'operational' && (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <tr>
                  <th className="p-4">Kategori</th>
                  <th className="p-4">Catatan & Tanggal</th>
                  <th className="p-4 text-right">Nominal Keluar</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {operationalExpenses.length === 0 ? (
                  <tr>
                    <td colSpan="4" className={`p-8 text-center ${styles.textSub}`}>Belum ada catatan biaya operasional kantor.</td>
                  </tr>
                ) : (
                  operationalExpenses.map((op) => (
                    <tr key={op.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                      <td className="p-4">
                        <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-1 rounded-full font-medium">
                          {op.category}
                        </span>
                      </td>
                      <td className={`p-4 ${styles.textSub}`}>
                        {op.notes || '-'}
                        <span className="block text-[10px] text-slate-400">{formatDateDDMMYYYY(op.expenseDate || op.createdAt)}</span>
                      </td>
                      <td className="p-4 text-right font-bold text-amber-500">
                        - Rp {Number(op.amount).toLocaleString('id-ID')}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleEditOperationalExpense(op)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                            title="Edit Biaya Operasional"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteOperationalExpense(op)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                            title="Hapus Biaya Operasional"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 p-3">
            {operationalExpenses.length === 0 ? (
              <p className={`p-8 text-center text-xs ${styles.textSub}`}>Belum ada catatan biaya operasional kantor.</p>
            ) : (
              operationalExpenses.map((op) => (
                <div key={op.id} className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-2`}>
                  <div>
                    <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-1 rounded-full font-medium inline-block">
                      {op.category}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Catatan & Tanggal</span>
                    <div className={styles.textSub}>
                      {op.notes || '-'}
                      <span className="block text-[10px] text-slate-400">{formatDateDDMMYYYY(op.expenseDate || op.createdAt)}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Nominal Keluar</span>
                    <div className="font-bold text-amber-500">- Rp {Number(op.amount).toLocaleString('id-ID')}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => handleEditOperationalExpense(op)}
                      className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                      title="Edit Biaya Operasional"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteOperationalExpense(op)}
                      className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                      title="Hapus Biaya Operasional"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'vendors_master' && (
        <div className="space-y-4">
          <div className={`${styles.cardBg} border rounded-xl p-4 flex justify-between items-center`}>
            <div>
              <p className={`text-xs font-medium ${styles.textSub}`}>Total Saldo Deposit Seluruh Vendor</p>
              <p className={`text-xl font-bold ${styles.textTitle}`}>
                Rp {vendorsList.reduce((acc, v) => acc + (Number(v.depositBalance) || 0), 0).toLocaleString('id-ID')}
              </p>
            </div>
            <button
              onClick={() => {
                setEditingVendorMasterId(null);
                setVendorMasterForm({ name: '', category: vendorCategories[0] });
                setShowVendorMasterModal(true);
              }}
              className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
            >
              <Building2 className="w-4 h-4" /> + Tambah Vendor
            </button>
          </div>

          <p className={`text-[10.5px] ${styles.textSub}`}>
            Saldo Deposit Vendor nampung DP (misal block seat) yang batal (trip cancel) tapi nggak hangus — bisa dipakai lagi buat booking berikutnya ke vendor yang sama, lewat pilihan "Metode Bayar: Saldo Deposit Vendor" di form Bayar Vendor.
          </p>

          <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <tr>
                    <th className="p-4">Nama Vendor</th>
                    <th className="p-4">Kategori</th>
                    <th className="p-4 text-right">Saldo Deposit</th>
                    <th className="p-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${styles.tableRowBorder}`}>
                  {vendorsList.length === 0 ? (
                    <tr>
                      <td colSpan="4" className={`p-8 text-center ${styles.textSub}`}>Belum ada vendor. Tambahkan dulu biar bisa dipilih pas catat "Bayar Vendor".</td>
                    </tr>
                  ) : (
                    vendorsList.map(v => (
                      <tr key={v.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                        <td className={`p-4 font-semibold ${styles.textTitle}`}>{v.name}</td>
                        <td className="p-4">
                          <span className="bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2.5 py-1 rounded-full font-medium">
                            {v.category}
                          </span>
                        </td>
                        <td className={`p-4 text-right font-bold ${Number(v.depositBalance || 0) > 0 ? 'text-emerald-500' : styles.textTitle}`}>
                          Rp {Number(v.depositBalance || 0).toLocaleString('id-ID')}
                        </td>
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleOpenVendorDepositAdjust(v)}
                              className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                              title="Tambah/Koreksi Saldo Deposit"
                            >
                              <Wallet className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleEditVendorMaster(v)}
                              className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                              title="Edit Vendor"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteVendorMaster(v)}
                              className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                              title="Hapus Vendor"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-3 p-3">
              {vendorsList.length === 0 ? (
                <p className={`p-8 text-center text-xs ${styles.textSub}`}>Belum ada vendor. Tambahkan dulu biar bisa dipilih pas catat "Bayar Vendor".</p>
              ) : (
                vendorsList.map(v => (
                  <div key={v.id} className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-2`}>
                    <div className={`font-semibold ${styles.textTitle}`}>{v.name}</div>
                    <div>
                      <span className="text-[10px] opacity-60 uppercase">Kategori</span>
                      <div>
                        <span className="bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2.5 py-1 rounded-full font-medium inline-block">
                          {v.category}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] opacity-60 uppercase">Saldo Deposit</span>
                      <div className={`font-bold ${Number(v.depositBalance || 0) > 0 ? 'text-emerald-500' : styles.textTitle}`}>
                        Rp {Number(v.depositBalance || 0).toLocaleString('id-ID')}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => handleOpenVendorDepositAdjust(v)}
                        className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                        title="Tambah/Koreksi Saldo Deposit"
                      >
                        <Wallet className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleEditVendorMaster(v)}
                        className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                        title="Edit Vendor"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteVendorMaster(v)}
                        className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                        title="Hapus Vendor"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-4">
          {/* Sub-tab strip Laporan — tambah sibling baru di sini kalau ada
              laporan baru lagi ke depannya, misal:
              { key: 'komisi_partner', label: 'Komisi Partner' } */}
          <div className={`flex gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-2`}>
            <button
              onClick={() => setReportsSubTab('closing_tc')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                reportsSubTab === 'closing_tc' ? `${styles.tabActive} text-indigo-500 border` : `${styles.textSub} hover:${styles.textTitle}`
              }`}
            >
              Closing TC
            </button>
            <button
              onClick={() => setReportsSubTab('lead_source')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                reportsSubTab === 'lead_source' ? `${styles.tabActive} text-indigo-500 border` : `${styles.textSub} hover:${styles.textTitle}`
              }`}
            >
              Sumber Lead
            </button>
            {/* — sub-tab laporan berikutnya nyusul di sini — */}
          </div>

          {reportsSubTab === 'closing_tc' && (
            <div className="space-y-4">
              <div className={`${styles.cardBg} border rounded-xl overflow-hidden p-4`}>
                <div className="flex flex-col gap-3 mb-4">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div>
                      <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
                        <FileBarChart className="w-4 h-4 text-indigo-500" /> Laporan Closing TC & Komisi
                      </h4>
                      <p className={`text-xs ${styles.textSub} mt-1`}>
                        Rekap jumlah closingan (omset) dan jumlah pax per Travel Consultant, dipecah per kategori destinasi.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="month"
                        title="Pilih Bulan (cepat)"
                        className={`${styles.inputBg} rounded-lg p-2 text-xs border`}
                        value={closingTcQuickMonth}
                        onChange={e => {
                          const monthKey = e.target.value;
                          setClosingTcQuickMonth(monthKey);
                          const range = getMonthBoundaries(monthKey);
                          if (range) {
                            setClosingTcStartDate(range.start);
                            setClosingTcEndDate(range.end);
                          }
                        }}
                      />
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          title="Dari Tanggal Transaksi"
                          className={`${styles.inputBg} rounded-lg p-2 text-xs border`}
                          value={closingTcStartDate}
                          max={closingTcEndDate || undefined}
                          onChange={e => setClosingTcStartDate(e.target.value)}
                        />
                        <span className={`text-xs ${styles.textSub}`}>s/d</span>
                        <input
                          type="date"
                          title="Sampai Tanggal Transaksi"
                          className={`${styles.inputBg} rounded-lg p-2 text-xs border`}
                          value={closingTcEndDate}
                          min={closingTcStartDate || undefined}
                          onChange={e => setClosingTcEndDate(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleDownloadClosingTcCSV}
                      className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" /> Download CSV
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className={`${styles.innerBg} border p-4 rounded-xl`}>
                    <p className={`text-xs ${styles.textSub} mb-1`}>Total Closingan Semua TC</p>
                    <h3 className="text-xl font-bold text-emerald-500">
                      Rp {closingTcGrandTotal.totalClosing.toLocaleString('id-ID')}
                    </h3>
                  </div>
                  <div className={`${styles.innerBg} border p-4 rounded-xl`}>
                    <p className={`text-xs ${styles.textSub} mb-1`}>Total Pax Semua TC</p>
                    <h3 className={`text-xl font-bold ${styles.textTitle}`}>
                      {closingTcGrandTotal.totalPax.toLocaleString('id-ID')}
                    </h3>
                  </div>
                </div>
              </div>

              <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                      <tr>
                        <th className="p-4 w-8"></th>
                        <th className="p-4">Nama TC</th>
                        <th className="p-4 text-right">Total Closingan</th>
                        <th className="p-4 text-right">Total Pax</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {closingTcSummary.length === 0 ? (
                        <tr>
                          <td colSpan="4" className={`p-8 text-center ${styles.textSub}`}>Belum ada closingan dari TC di periode ini.</td>
                        </tr>
                      ) : (
                        closingTcSummary.map(tc => {
                          const isExpanded = expandedClosingTcIds.includes(tc.tcId);
                          return (
                            <React.Fragment key={tc.tcId}>
                              <tr className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                                <td className="p-4">
                                  <button
                                    type="button"
                                    onClick={() => toggleClosingTcExpand(tc.tcId)}
                                    className={`p-1 rounded ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}
                                    title={isExpanded ? 'Sembunyikan rincian' : 'Lihat rincian per destinasi'}
                                  >
                                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                  </button>
                                </td>
                                <td className={`p-4 font-semibold ${styles.textTitle}`}>{tc.tcName}</td>
                                <td className="p-4 text-right font-bold text-emerald-500">
                                  Rp {tc.totalClosing.toLocaleString('id-ID')}
                                </td>
                                <td className={`p-4 text-right ${styles.textTitle}`}>{tc.totalPax}</td>
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td colSpan="4" className="p-0">
                                    <div className={`${styles.innerBg} border-y m-3 rounded-lg overflow-hidden`}>
                                      <table className="w-full text-left text-[11px]">
                                        <thead className={`${styles.tableHeaderBg} uppercase`}>
                                          <tr>
                                            <th className="p-3">Kategori Destinasi</th>
                                            <th className="p-3 text-right">Jumlah Closingan (Rp)</th>
                                            <th className="p-3 text-right">Jumlah Pax</th>
                                          </tr>
                                        </thead>
                                        <tbody className={`divide-y ${styles.tableRowBorder}`}>
                                          {tc.byDestination.map(dest => (
                                            <tr key={dest.category}>
                                              <td className={`p-3 ${styles.textTitle}`}>{dest.category}</td>
                                              <td className="p-3 text-right text-emerald-500">Rp {dest.closing.toLocaleString('id-ID')}</td>
                                              <td className={`p-3 text-right ${styles.textSub}`}>{dest.pax}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden space-y-3 p-3">
                  {closingTcSummary.length === 0 ? (
                    <p className={`p-8 text-center text-xs ${styles.textSub}`}>Belum ada closingan dari TC di periode ini.</p>
                  ) : (
                    closingTcSummary.map(tc => {
                      const isExpanded = expandedClosingTcIds.includes(tc.tcId);
                      return (
                        <div key={tc.tcId} className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-2`}>
                          <div className="flex items-center justify-between">
                            <div className={`font-semibold ${styles.textTitle}`}>{tc.tcName}</div>
                            <button
                              type="button"
                              onClick={() => toggleClosingTcExpand(tc.tcId)}
                              className={`p-1 rounded ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}
                              title={isExpanded ? 'Sembunyikan rincian' : 'Lihat rincian per destinasi'}
                            >
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </div>
                          <div>
                            <span className="text-[10px] opacity-60 uppercase">Total Closingan</span>
                            <div className="font-bold text-emerald-500">Rp {tc.totalClosing.toLocaleString('id-ID')}</div>
                          </div>
                          <div>
                            <span className="text-[10px] opacity-60 uppercase">Total Pax</span>
                            <div className={styles.textTitle}>{tc.totalPax}</div>
                          </div>
                          {isExpanded && (
                            <div className={`${styles.cardBg} border rounded-lg p-2 space-y-2 mt-2`}>
                              {tc.byDestination.map(dest => (
                                <div key={dest.category} className="flex justify-between items-center text-[11px]">
                                  <span className={styles.textTitle}>{dest.category}</span>
                                  <span className="text-right">
                                    <span className="block text-emerald-500">Rp {dest.closing.toLocaleString('id-ID')}</span>
                                    <span className={styles.textSub}>{dest.pax} pax</span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {reportsSubTab === 'lead_source' && (
            <div className="space-y-4">
              <div className={`${styles.cardBg} border rounded-xl p-4`}>
                <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-3 mb-4">
                  <div>
                    <h4 className={`text-sm font-bold ${styles.textTitle}`}>Sumber Lead per Bulan</h4>
                    <p className={`text-xs ${styles.textSub} mt-1`}>
                      Komposisi {leadSourceMetric === 'seat' ? 'seat' : 'closing'} per sumber lead untuk bulan terpilih. Sumber dengan kontribusi kecil digabung ke "Lainnya".
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className={`${styles.inputBg} rounded-lg p-2 text-xs border`}
                      value={leadSourcePeriod}
                      onChange={e => setLeadSourcePeriod(e.target.value)}
                    >
                      {!leadSourceAvailablePeriods.includes(leadSourcePeriod) && (
                        <option value={leadSourcePeriod}>{formatPeriodLabel(leadSourcePeriod)}</option>
                      )}
                      {leadSourceAvailablePeriods.map(p => (
                        <option key={p} value={p}>{formatPeriodLabel(p)}</option>
                      ))}
                    </select>
                    <div className={`flex items-center rounded-lg border ${isDark ? 'border-slate-700' : 'border-slate-200'} overflow-hidden text-xs font-medium`}>
                      <button
                        type="button"
                        onClick={() => setLeadSourceMetric('purchase')}
                        className={`px-3 py-2 transition-colors ${
                          leadSourceMetric === 'purchase' ? 'bg-indigo-600 text-white' : `${isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white text-slate-600 hover:bg-slate-100'}`
                        }`}
                      >
                        Purchase
                      </button>
                      <button
                        type="button"
                        onClick={() => setLeadSourceMetric('seat')}
                        className={`px-3 py-2 transition-colors border-l ${isDark ? 'border-slate-700' : 'border-slate-200'} ${
                          leadSourceMetric === 'seat' ? 'bg-indigo-600 text-white' : `${isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white text-slate-600 hover:bg-slate-100'}`
                        }`}
                      >
                        Seat
                      </button>
                    </div>
                  </div>
                </div>

                {leadSourceReport.total === 0 ? (
                  <div className={`p-10 text-center text-xs ${styles.textSub}`}>Belum ada data booking dengan Sumber Lead terisi untuk periode ini.</div>
                ) : (
                  <div className="flex flex-col md:flex-row items-center gap-8 py-2">
                    <div
                      className="w-56 h-56 rounded-full flex-shrink-0"
                      style={{ background: leadSourceConicGradient }}
                      title={`Total: ${leadSourceReport.total}`}
                    />
                    <div className="flex-1 w-full space-y-2">
                      {leadSourceReport.slices.map((s) => (
                        <div key={s.label} className="flex items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                            <span className={`${styles.textTitle} truncate`}>{s.label}</span>
                          </div>
                          <span className={`${styles.textSub} whitespace-nowrap`}>
                            {s.count} ({s.percent.toFixed(0)}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {showVendorMasterModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowVendorMasterModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <Building2 className="w-5 h-5 text-rose-500" /> {editingVendorMasterId ? 'Edit Vendor' : 'Tambah Vendor'}
            </h3>
            <form onSubmit={handleVendorMasterSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Nama Vendor / Perusahaan</label>
                <input
                  type="text" required placeholder="Contoh: Saudi Airlines / Hotel Pullman Makkah"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorMasterForm.name}
                  onChange={e => setVendorMasterForm({ ...vendorMasterForm, name: e.target.value })}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-medium">Kategori</label>
                  <button
                    type="button"
                    onClick={openCategoryModal}
                    className="text-[10px] text-rose-500 hover:underline flex items-center gap-1"
                  >
                    <Settings className="w-3 h-3" /> Kelola Kategori
                  </button>
                </div>
                <select
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorMasterForm.category}
                  onChange={e => setVendorMasterForm({ ...vendorMasterForm, category: e.target.value })}
                >
                  {vendorCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              {editingVendorMasterId && (
                <p className="text-[10px] opacity-70">Saldo Deposit vendor ini cuma berubah otomatis lewat transaksi (konversi DP batal / pemakaian), nggak bisa diubah manual dari sini.</p>
              )}
              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowVendorMasterModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-rose-600 text-white rounded-lg font-medium">
                  Simpan Vendor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowCategoryModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Settings className="w-5 h-5 text-rose-500" /> Kelola Kategori Vendor
            </h3>
            <p className={`text-[11px] ${styles.textSub} mb-4`}>
              Ubah nama kategori yang udah ada, hapus yang nggak kepake, atau tambah kategori baru. Perubahan ini langsung kepakai di semua dropdown Kategori Vendor.
            </p>

            <div className="space-y-2 mb-4">
              {categoryDraft.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <input
                    type="text"
                    className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                    value={c.value}
                    onChange={e => handleRenameCategoryDraft(c.key, e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveCategoryDraft(c.key)}
                    className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                    title="Hapus kategori ini"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {categoryDraft.length === 0 && (
                <p className={`text-xs ${styles.textSub}`}>Belum ada kategori. Tambahkan minimal 1 di bawah.</p>
              )}
            </div>

            <div className="flex items-center gap-2 mb-5">
              <input
                type="text"
                placeholder="Nama kategori baru, cth: Katering"
                className={`w-full ${styles.inputBg} rounded-lg p-2.5 text-xs`}
                value={newCategoryText}
                onChange={e => setNewCategoryText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategoryDraft(); } }}
              />
              <button
                type="button"
                onClick={handleAddCategoryDraft}
                className="flex items-center gap-1 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium shrink-0"
              >
                <Plus className="w-4 h-4" /> Tambah
              </button>
            </div>

            <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <button type="button" onClick={() => setShowCategoryModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}>
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveCategories}
                disabled={savingCategories}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium"
              >
                {savingCategories ? 'Menyimpan...' : 'Simpan Kategori'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOpexCategoryModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowOpexCategoryModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Settings className="w-5 h-5 text-amber-500" /> Kelola Kategori Biaya Operasional
            </h3>
            <p className={`text-[11px] ${styles.textSub} mb-4`}>
              Ubah nama kategori yang udah ada, hapus yang nggak kepake, atau tambah kategori baru. Perubahan ini langsung kepakai di dropdown Kategori Biaya, dan juga di breakdown per kategori pada Laba Rugi.
            </p>

            <div className="space-y-2 mb-4">
              {opexCategoryDraft.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <input
                    type="text"
                    className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                    value={c.value}
                    onChange={e => handleRenameOpexCategoryDraft(c.key, e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveOpexCategoryDraft(c.key)}
                    className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                    title="Hapus kategori ini"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {opexCategoryDraft.length === 0 && (
                <p className={`text-xs ${styles.textSub}`}>Belum ada kategori. Tambahkan minimal 1 di bawah.</p>
              )}
            </div>

            <div className="flex items-center gap-2 mb-5">
              <input
                type="text"
                placeholder="Nama kategori baru, cth: Katering"
                className={`w-full ${styles.inputBg} rounded-lg p-2.5 text-xs`}
                value={newOpexCategoryText}
                onChange={e => setNewOpexCategoryText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddOpexCategoryDraft(); } }}
              />
              <button
                type="button"
                onClick={handleAddOpexCategoryDraft}
                className="flex items-center gap-1 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium shrink-0"
              >
                <Plus className="w-4 h-4" /> Tambah
              </button>
            </div>

            <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <button type="button" onClick={() => setShowOpexCategoryModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}>
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveOpexCategories}
                disabled={savingOpexCategories}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium"
              >
                {savingOpexCategories ? 'Menyimpan...' : 'Simpan Kategori'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVendorDepositAdjustModal && adjustingVendor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowVendorDepositAdjustModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-2 flex items-center gap-2`}>
              <Wallet className="w-5 h-5 text-emerald-500" /> Tambah/Koreksi Saldo Deposit
            </h3>
            <p className={`text-[10.5px] ${styles.textSub} mb-4`}>
              Vendor: <strong className={styles.textTitle}>{adjustingVendor.name}</strong> · Saldo sekarang: Rp {Number(adjustingVendor.depositBalance || 0).toLocaleString('id-ID')}
              <br />Pakai ini buat input saldo yang udah ada dari sebelum sistem ini dipakai, atau koreksi manual lain. Isi nominal negatif kalau mau mengoreksi turun.
            </p>
            <form onSubmit={handleVendorDepositAdjustSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Nominal (Rp) — isi negatif buat koreksi turun</label>
                <input
                  type="number" required placeholder="10000000"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorAdjustForm.amount}
                  onChange={e => setVendorAdjustForm({ ...vendorAdjustForm, amount: e.target.value })}
                />
              </div>
              <div>
                <label className="block mb-1 font-medium">Catatan</label>
                <input
                  type="text"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorAdjustForm.notes}
                  onChange={e => setVendorAdjustForm({ ...vendorAdjustForm, notes: e.target.value })}
                />
              </div>
              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowVendorDepositAdjustModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showConvertDepositModal && convertingPayment && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowConvertDepositModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-2 flex items-center gap-2`}>
              <RotateCcw className="w-5 h-5 text-emerald-500" /> Konversi ke Saldo Deposit Vendor
            </h3>
            <p className={`text-[10.5px] ${styles.textSub} mb-4`}>
              Transaksi asli (Rp {Number(convertingPayment.amount || 0).toLocaleString('id-ID')} ke {convertingPayment.vendorName}) TETAP tercatat apa adanya — konversi ini cuma nambahin kredit ke vendor terkait, nggak menyentuh saldo Kas/Bank (uangnya emang udah keluar duluan).
            </p>
            <form onSubmit={handleConvertSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Vendor Tujuan Saldo Deposit</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={convertForm.vendorId}
                  onChange={e => setConvertForm({ ...convertForm, vendorId: e.target.value })}
                >
                  <option value="">-- Pilih Vendor --</option>
                  {vendorsList.map(v => (
                    <option key={v.id} value={v.id}>{v.name} (Saldo sekarang: Rp {Number(v.depositBalance || 0).toLocaleString('id-ID')})</option>
                  ))}
                </select>
                {vendorsList.length === 0 && (
                  <p className="text-[10px] mt-1 text-amber-500">Belum ada vendor di Data Master. Tambahkan dulu lewat tab "Data Vendor".</p>
                )}
              </div>
              <div>
                <label className="block mb-1 font-medium">Nominal yang Dikonversi (Rp)</label>
                <input
                  type="number" required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={convertForm.amount}
                  onChange={e => setConvertForm({ ...convertForm, amount: e.target.value })}
                />
                <p className="text-[10px] mt-1 opacity-70">Default-nya sama kayak nominal DP aslinya, tapi bisa disesuaikan kalau cuma sebagian yang nggak hangus.</p>
              </div>
              <div>
                <label className="block mb-1 font-medium">Catatan</label>
                <input
                  type="text"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={convertForm.notes}
                  onChange={e => setConvertForm({ ...convertForm, notes: e.target.value })}
                />
              </div>
              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowConvertDepositModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  Konversi ke Deposit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showIncomeModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowIncomeModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <ArrowDownLeft className="w-5 h-5 text-emerald-500" /> Catat Setoran Pembayaran Jamaah
            </h3>

            <form onSubmit={handleIncomeSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Pilih Kode Booking</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={incomeForm.groupCode}
                  onChange={e => setIncomeForm({ ...incomeForm, groupCode: e.target.value })}
                >
                  <option value="">-- Pilih Kode Booking --</option>
                  {groupedBookingOptions.map(g => (
                    <option key={g.code} value={g.code}>
                      {g.code} - {g.paxCount > 1 ? `${g.paxCount} Peserta` : g.primary.jamaahName}{g.primary.ordererName ? ` a.n. ${g.primary.ordererName}` : ''} ({g.primary.packageName})
                    </option>
                  ))}
                </select>
                <p className={`text-[10.5px] ${styles.textSub} mt-1`}>
                  Untuk booking rombongan, nominal setoran otomatis dibagi rata ke semua peserta dalam kode booking ini.
                </p>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nominal Setoran (Rp)</label>
                <input
                  type="number" required placeholder="5000000"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={incomeForm.amount}
                  onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Metode</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={incomeForm.paymentMethod}
                    onChange={e => setIncomeForm({ ...incomeForm, paymentMethod: e.target.value })}
                  >
                    <option value="Transfer Bank">Transfer Bank</option>
                    <option value="Cash / Tunai">Cash / Tunai</option>
                    <option value="EDC / Kartu">EDC / Kartu</option>
                    <option value="Saldo Deposit">Saldo Deposit</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Tanggal Setoran</label>
                  <DateFieldID
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={incomeForm.date}
                    onChange={(val) => setIncomeForm({ ...incomeForm, date: val })}
                    min={getBookingMinDate(groupedBookingOptions.find(g => g.code === incomeForm.groupCode)?.primary?.createdAt)}
                  />
                  {incomeForm.groupCode && (
                    <p className={`text-[10px] mt-1 ${styles.textSub}`}>
                      Nggak bisa sebelum tanggal pemesanan dibuat ({getBookingMinDate(groupedBookingOptions.find(g => g.code === incomeForm.groupCode)?.primary?.createdAt).split('-').reverse().join('/')}).
                    </p>
                  )}
                </div>
              </div>

              {incomeForm.paymentMethod !== 'Saldo Deposit' && (
                <div>
                  <label className="block mb-1 font-medium">Masuk ke Akun Kas/Bank</label>
                  <select
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={incomeForm.accountId}
                    onChange={e => setIncomeForm({ ...incomeForm, accountId: e.target.value })}
                  >
                    <option value="">-- Pilih Akun --</option>
                    {financialAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} (Saldo: Rp {Number(a.balance || 0).toLocaleString('id-ID')})</option>
                    ))}
                  </select>
                  {financialAccounts.length === 0 && (
                    <p className="text-[10px] mt-1 text-amber-500">Belum ada akun Kas/Bank. Tambahkan dulu lewat tab "Kas & Bank".</p>
                  )}
                </div>
              )}
              {incomeForm.paymentMethod === 'Saldo Deposit' && (() => {
                const selectedGroup = groupedBookingOptions.find(g => g.code === incomeForm.groupCode);
                const ordererData = jamaahList.find(j => j.id === selectedGroup?.primary?.ordererId);
                const balance = Number(ordererData?.depositBalance || 0);
                return (
                  <p className={`text-[11px] p-2 rounded-lg ${balance > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                    Saldo Deposit {ordererData ? ordererData.fullName : (selectedGroup?.primary?.ordererName || 'Pemesan')} saat ini: Rp {balance.toLocaleString('id-ID')}
                  </p>
                );
              })()}

              <div>
                <label className="block mb-1 font-medium">Keterangan</label>
                <input
                  type="text" placeholder="DP 1 / Pelunasan"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={incomeForm.notes}
                  onChange={e => setIncomeForm({ ...incomeForm, notes: e.target.value })}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowIncomeModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" disabled={savingIncome} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium disabled:opacity-60">
                  {savingIncome ? 'Menyimpan...' : 'Simpan Pembayaran'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDepositModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowDepositModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Wallet className="w-5 h-5 text-blue-500" /> Tambah Saldo Deposit
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Buat customer yang sudah transfer DP tapi belum jelas mau dipakai buat booking mana — nominalnya masuk saldo Pemesan dulu, baru dipakai belakangan lewat Metode Bayar "Saldo Deposit".
            </p>

            <form onSubmit={handleDepositSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Pemesan / Customer</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={depositForm.customerId}
                  onChange={e => setDepositForm({ ...depositForm, customerId: e.target.value })}
                >
                  <option value="">-- Pilih Data Master Jamaah --</option>
                  {jamaahList.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.fullName} - {j.customerCode || 'CST'} (Saldo saat ini: Rp {Number(j.depositBalance || 0).toLocaleString('id-ID')})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Nominal Deposit (Rp)</label>
                  <input
                    type="number" required min="1" placeholder="5000000"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={depositForm.amount}
                    onChange={e => setDepositForm({ ...depositForm, amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Tanggal Terima</label>
                  <DateFieldID
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={depositForm.date}
                    onChange={(val) => setDepositForm({ ...depositForm, date: val })}
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Masuk ke Akun Kas/Bank</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={depositForm.accountId}
                  onChange={e => setDepositForm({ ...depositForm, accountId: e.target.value })}
                >
                  <option value="">-- Pilih Akun --</option>
                  {financialAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} (Saldo: Rp {Number(a.balance || 0).toLocaleString('id-ID')})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1 font-medium">Keterangan</label>
                <input
                  type="text" placeholder="Titip Deposit (belum ada booking)"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={depositForm.notes}
                  onChange={e => setDepositForm({ ...depositForm, notes: e.target.value })}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowDepositModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" disabled={savingDeposit} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60">
                  {savingDeposit ? 'Menyimpan...' : 'Simpan Deposit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showVendorModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowVendorModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <ArrowUpRight className="w-5 h-5 text-rose-500" /> Catat Pembayaran Vendor / Supplier
            </h3>

            <form onSubmit={handleVendorSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Paket Keberangkatan Terkait</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorForm.packageId}
                  onChange={e => setVendorForm({ ...vendorForm, packageId: e.target.value })}
                >
                  <option value="">-- Pilih Paket --</option>
                  {packagesList.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                  ))}
                </select>
                <p className={`text-[10.5px] ${styles.textSub} mt-1`}>
                  Biaya kantor yang bukan buat trip tertentu (sewa, gaji, listrik, dll) dicatat lewat tombol <strong>"+ Biaya Operasional Kantor"</strong>, bukan di sini.
                </p>
              </div>

              <div>
                <label className="block mb-1 font-medium">Vendor / Perusahaan</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorForm.vendorId}
                  onChange={e => {
                    const v = vendorsList.find(x => x.id === e.target.value);
                    setVendorForm({ ...vendorForm, vendorId: e.target.value, category: v?.category || vendorForm.category, billId: '' });
                  }}
                >
                  <option value="">-- Pilih Vendor --</option>
                  {vendorsList.map(v => (
                    <option key={v.id} value={v.id}>{v.name}{Number(v.depositBalance || 0) > 0 ? ` (Saldo Deposit: Rp ${Number(v.depositBalance).toLocaleString('id-ID')})` : ''}</option>
                  ))}
                </select>
                {vendorsList.length === 0 && (
                  <p className="text-[10px] mt-1 text-amber-500">Belum ada vendor. Tambahkan dulu lewat tab "Data Vendor".</p>
                )}
              </div>

              {vendorForm.vendorId && vendorBills.filter(b => b.vendorId === vendorForm.vendorId && b.status !== 'paid').length > 0 && (
                <div>
                  <label className="block mb-1 font-medium">Bayar Tagihan Mana? <span className="font-normal text-[10px]">(opsional)</span></label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={vendorForm.billId}
                    onChange={e => setVendorForm({ ...vendorForm, billId: e.target.value })}
                  >
                    <option value="">-- Bayar Ad-hoc (Tanpa Tagihan) --</option>
                    {vendorBills.filter(b => b.vendorId === vendorForm.vendorId && b.status !== 'paid').map(b => (
                      <option key={b.id} value={b.id}>
                        {b.billNumber || '(tanpa no. tagihan)'} — Sisa Rp {Number((b.amount || 0) - (b.amountPaid || 0)).toLocaleString('id-ID')}
                      </option>
                    ))}
                  </select>
                  <p className={`text-[10.5px] ${styles.textSub} mt-1`}>
                    Kalau dipilih, pembayaran ini otomatis ngurangin sisa tagihan vendor ini.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-medium">Kategori Pengeluaran</label>
                    <button
                      type="button"
                      onClick={openCategoryModal}
                      className="text-[10px] text-rose-500 hover:underline flex items-center gap-1"
                    >
                      <Settings className="w-3 h-3" /> Kelola
                    </button>
                  </div>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={vendorForm.category}
                    onChange={e => setVendorForm({ ...vendorForm, category: e.target.value })}
                  >
                    {vendorCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Nominal Bayar (Rp)</label>
                  <input
                    type="number" required placeholder="50000000"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={vendorForm.amount}
                    onChange={e => setVendorForm({ ...vendorForm, amount: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Metode Bayar</label>
                <select
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorForm.payMethod}
                  onChange={e => setVendorForm({ ...vendorForm, payMethod: e.target.value })}
                >
                  <option value="Kas/Bank">Kas/Bank (uang keluar beneran)</option>
                  <option value="Saldo Deposit Vendor">Saldo Deposit Vendor (pakai kredit yang udah ada)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tanggal Pembayaran</label>
                  <DateFieldID
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={vendorForm.paymentDate}
                    onChange={(val) => setVendorForm({ ...vendorForm, paymentDate: val })}
                  />
                </div>
                {vendorForm.payMethod === 'Saldo Deposit Vendor' ? (
                  <div>
                    <label className="block mb-1 font-medium">Saldo Deposit Vendor</label>
                    <div className={`w-full ${styles.inputBg} rounded-lg p-2.5 font-semibold text-emerald-500`}>
                      Rp {Number(vendorsList.find(v => v.id === vendorForm.vendorId)?.depositBalance || 0).toLocaleString('id-ID')}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block mb-1 font-medium">Keluar dari Akun Kas/Bank</label>
                    <select
                      required
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={vendorForm.accountId}
                      onChange={e => setVendorForm({ ...vendorForm, accountId: e.target.value })}
                    >
                      <option value="">-- Pilih Akun --</option>
                      {financialAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name} (Saldo: Rp {Number(a.balance || 0).toLocaleString('id-ID')})</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block mb-1 font-medium">Keterangan Catatan</label>
                <input
                  type="text" placeholder="DP Deposit 50% Tiket Group"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorForm.notes}
                  onChange={e => setVendorForm({ ...vendorForm, notes: e.target.value })}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowVendorModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" disabled={savingVendor} className="px-4 py-2 bg-rose-600 text-white rounded-lg font-medium disabled:opacity-60">
                  {savingVendor ? 'Menyimpan...' : 'Simpan Pengeluaran Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showVendorBillModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowVendorBillModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <ArrowUpRight className="w-5 h-5 text-orange-500" /> Catat Tagihan Vendor Baru
            </h3>
            <p className={`text-[10.5px] ${styles.textSub} mb-4`}>
              Catat invoice/tagihan dari vendor begitu diterima, sebelum dibayar. Nanti pas bayar, pilih tagihan ini di form "Catat Pembayaran Vendor".
            </p>

            <form onSubmit={handleVendorBillSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Vendor / Perusahaan</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorBillForm.vendorId}
                  onChange={e => {
                    const v = vendorsList.find(x => x.id === e.target.value);
                    setVendorBillForm({ ...vendorBillForm, vendorId: e.target.value, category: v?.category || vendorBillForm.category });
                  }}
                >
                  <option value="">-- Pilih Vendor --</option>
                  {vendorsList.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                {vendorsList.length === 0 && (
                  <p className="text-[10px] mt-1 text-amber-500">Belum ada vendor. Tambahkan dulu lewat tab "Data Vendor".</p>
                )}
              </div>

              <div>
                <label className="block mb-1 font-medium">Paket Keberangkatan Terkait <span className="font-normal text-[10px]">(opsional)</span></label>
                <select
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorBillForm.packageId}
                  onChange={e => setVendorBillForm({ ...vendorBillForm, packageId: e.target.value })}
                >
                  <option value="">-- Nggak Terkait Paket Tertentu --</option>
                  {packagesList.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nomor Tagihan / Invoice</label>
                <input
                  type="text" placeholder="INV-2026-001"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorBillForm.billNumber}
                  onChange={e => setVendorBillForm({ ...vendorBillForm, billNumber: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-medium">Kategori</label>
                    <button
                      type="button"
                      onClick={openCategoryModal}
                      className="text-[10px] text-rose-500 hover:underline flex items-center gap-1"
                    >
                      <Settings className="w-3 h-3" /> Kelola
                    </button>
                  </div>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={vendorBillForm.category}
                    onChange={e => setVendorBillForm({ ...vendorBillForm, category: e.target.value })}
                  >
                    {vendorCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Nominal Tagihan (Rp)</label>
                  <input
                    type="number" required placeholder="50000000"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={vendorBillForm.amount}
                    onChange={e => setVendorBillForm({ ...vendorBillForm, amount: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tanggal Tagihan</label>
                  <DateFieldID
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={vendorBillForm.billDate}
                    onChange={(val) => setVendorBillForm({ ...vendorBillForm, billDate: val })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Jatuh Tempo <span className="font-normal text-[10px]">(opsional)</span></label>
                  <DateFieldID
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={vendorBillForm.dueDate}
                    onChange={(val) => setVendorBillForm({ ...vendorBillForm, dueDate: val })}
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Keterangan Catatan</label>
                <input
                  type="text" placeholder="Tiket Group 45 Pax Keberangkatan Maret"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorBillForm.notes}
                  onChange={e => setVendorBillForm({ ...vendorBillForm, notes: e.target.value })}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowVendorBillModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" disabled={savingVendorBill} className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium disabled:opacity-60">
                  {savingVendorBill ? 'Menyimpan...' : 'Simpan Tagihan Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showOperationalModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => { setShowOperationalModal(false); setEditingOperationalId(null); }} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <Building2 className="w-5 h-5 text-amber-500" /> {editingOperationalId ? 'Edit Biaya Operasional Kantor' : 'Catat Biaya Operasional Kantor'}
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Khusus buat pengeluaran yang bukan biaya trip/vendor — misalnya sewa kantor, gaji staff, listrik, ATK, dll.
            </p>

            <form onSubmit={handleOperationalSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium">Kategori Biaya</label>
                    <button
                      type="button"
                      onClick={openOpexCategoryModal}
                      className="flex items-center gap-1 text-[10px] text-amber-500 hover:text-amber-400"
                    >
                      <Settings className="w-3 h-3" /> Kelola Kategori
                    </button>
                  </div>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={operationalForm.category}
                    onChange={e => setOperationalForm({ ...operationalForm, category: e.target.value })}
                  >
                    {operationalCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Nominal (Rp)</label>
                  <input
                    type="number" required placeholder="2500000"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={operationalForm.amount}
                    onChange={e => setOperationalForm({ ...operationalForm, amount: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tanggal Biaya</label>
                  <DateFieldID
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={operationalForm.expenseDate}
                    onChange={(val) => setOperationalForm({ ...operationalForm, expenseDate: val })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Keluar dari Akun Kas/Bank</label>
                  <select
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={operationalForm.accountId}
                    onChange={e => setOperationalForm({ ...operationalForm, accountId: e.target.value })}
                  >
                    <option value="">-- Pilih Akun --</option>
                    {financialAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} (Saldo: Rp {Number(a.balance || 0).toLocaleString('id-ID')})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Keterangan Catatan</label>
                <input
                  type="text" placeholder="Contoh: Sewa kantor bulan Agustus 2026"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={operationalForm.notes}
                  onChange={e => setOperationalForm({ ...operationalForm, notes: e.target.value })}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => { setShowOperationalModal(false); setEditingOperationalId(null); }} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" disabled={savingOperational} className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium disabled:opacity-60">
                  {savingOperational ? 'Menyimpan...' : (editingOperationalId ? 'Simpan Perubahan' : 'Simpan Biaya Operasional')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
