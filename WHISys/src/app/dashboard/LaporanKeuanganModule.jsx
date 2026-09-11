'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import {
  BookOpen, Wallet, TrendingUp, Scale, Users, RefreshCw, Download,
  ChevronDown, ChevronRight, ShieldCheck, X, BarChart3, CheckCircle2, RotateCcw,
  Clock, ArrowDownLeft, ArrowUpRight, Eye, Pencil, Trash2
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import DateFieldID from '@/components/DateFieldID';
import { logActivity } from '../../lib/activityLog';
import { calculatePPN } from '../../lib/ppn';
import {
  COA, ACC, seedChartOfAccounts, fetchAllJournalEntries, fetchChartOfAccounts,
  runInitialJournalMigration, postJournalEntry, postRevenueRecognition, postRevenueUnrecognition,
  backfillOpexJournalCategories, diagnoseRescheduleMigrationImpact, applyRescheduleMigrationCorrection,
  diagnoseMissingBookingJournals, applyMissingBookingJournalsCorrection,
  diagnoseArReconciliation, removeDuplicateBookingCreatedEntries, removeOrphanBookingJournalEntries,
  diagnoseMissingCommissionJournals, applyMissingCommissionJournalsCorrection, deleteJournalEntryById
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

// Daftar bank umum — sama persis kayak yang dipakai BookingsModule.jsx & FinanceModule.jsx.
const BANK_LIST = ['BCA', 'Mandiri', 'BNI', 'BRI', 'BSI (Bank Syariah Indonesia)', 'CIMB Niaga', 'Danamon', 'Permata', 'BTN', 'Bank Lainnya'];
const resolveBankName = (bankName, customBankName) => {
  if (bankName === 'Bank Lainnya') return (customBankName || '').trim() || 'Bank Lainnya';
  return bankName || '';
};

// Kop surat PDF — dipakai bareng oleh semua export (Buku Besar, Neraca, P&L,
// dst) biar tampilannya konsisten: logo + nama PT + PPIU + alamat + kontak,
// garis pembatas, terus judul laporan center. Balikin posisi Y abis kop biar
// pemanggil tinggal lanjut nulis isi laporan dari situ.
const addPdfLetterhead = async (docPdf, companyProfile, title, subtitle) => {
  const profile = companyProfile || DEFAULT_COMPANY_PROFILE;
  const pageWidth = docPdf.internal.pageSize.getWidth();
  const marginX = 14;
  let cursorY = 16;

  try {
    const logoDataUrl = await loadImageAsDataURL('/logo.png');
    docPdf.addImage(logoDataUrl, 'PNG', marginX, cursorY - 4, 18, 18);
  } catch (err) {
    console.warn('Logo tidak berhasil dimuat untuk PDF:', err);
  }

  const textStartX = marginX + 22;
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(13);
  docPdf.text(profile.name || DEFAULT_COMPANY_PROFILE.name, textStartX, cursorY);

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(8.5);
  let subY = cursorY + 5;
  if (profile.ppiuNumber) {
    docPdf.text(profile.ppiuNumber, textStartX, subY);
    subY += 4;
  }
  if (profile.address) {
    docPdf.text(profile.address, textStartX, subY, { maxWidth: pageWidth - textStartX - marginX });
    subY += 4;
  }
  const contactLine = [profile.phone, profile.email].filter(Boolean).join('  •  ');
  if (contactLine) {
    docPdf.text(contactLine, textStartX, subY);
    subY += 4;
  }

  cursorY = Math.max(cursorY + 18, subY) + 2;
  docPdf.setDrawColor(180);
  docPdf.line(marginX, cursorY, pageWidth - marginX, cursorY);
  cursorY += 8;

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(12);
  docPdf.text(title, pageWidth / 2, cursorY, { align: 'center' });
  cursorY += 6;

  if (subtitle) {
    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(9);
    docPdf.text(subtitle, pageWidth / 2, cursorY, { align: 'center' });
    cursorY += 4.5;
  }

  docPdf.setTextColor(0);
  return { cursorY, pageWidth, marginX };
};

// ---------------------------------------------------------------------
// Helper tanggal/format kecil — duplikat sengaja dari FinanceModule.jsx
// (bukan di-share lewat import) biar modul ini tetap independen & nggak
// nambah kopling ke file lain yang nggak perlu.
// ---------------------------------------------------------------------
const todayISODate = () => new Date().toISOString().slice(0, 10);

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatRp = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

// Label rekening kas/bank: pakai data financial_accounts yang masih aktif
// SEKARANG (nama akun + nama bank + no. rekening) biar jelas bedanya, bukan
// cuma "nama akun" hasil snapshot pas jurnal dibuat (yang kadang digenericin
// sama user jadi sama persis buat lebih dari satu rekening). Dipakai bareng
// oleh Neraca & Buku Besar biar labelnya konsisten di dua tempat.
const describeFinancialAccount = (fa, fallbackName) => {
  if (!fa) return fallbackName || 'Rekening Tanpa Nama';
  if (fa.type === 'Bank' && fa.bankName) {
    const tail = fa.accountNumber ? ` ${fa.accountNumber}` : '';
    return `${fa.name} — ${fa.bankName}${tail}`;
  }
  return fa.name || fallbackName || 'Rekening Tanpa Nama';
};

const getPeriodKey = (dateString) => {
  const d = dateString ? new Date(dateString) : new Date();
  if (isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const formatPeriodLabel = (periodKey) => {
  if (!periodKey || periodKey === '-') return '-';
  const [y, m] = periodKey.split('-');
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${months[Number(m) - 1] || m} ${y}`;
};

const ACCOUNT_TYPE_ORDER = ['Aset', 'Liabilitas', 'Ekuitas', 'Pendapatan', 'Beban'];

const AGING_BUCKETS = [
  { key: '0-30', label: '0-30 Hari', min: 0, max: 30 },
  { key: '31-60', label: '31-60 Hari', min: 31, max: 60 },
  { key: '61-90', label: '61-90 Hari', min: 61, max: 90 },
  { key: '90+', label: '> 90 Hari', min: 91, max: Infinity },
];

const daysBetween = (fromISO, toISO) => {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 0;
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
};

const bucketFor = (days) => AGING_BUCKETS.find(b => days >= b.min && days <= b.max) || AGING_BUCKETS[AGING_BUCKETS.length - 1];

export default function LaporanKeuanganModule({ theme = 'dark', currentUser = null }) {
  const isDark = theme === 'dark';
  const isSuperAdmin = (currentUser?.role || '').toLowerCase().includes('super');

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

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('journal');

  const [journalEntries, setJournalEntries] = useState([]);
  const [chartOfAccounts, setChartOfAccounts] = useState(COA);
  const [bookingsList, setBookingsList] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [vendorBills, setVendorBills] = useState([]);
  const [vendorsList, setVendorsList] = useState([]);
  const [financialAccounts, setFinancialAccounts] = useState([]);
  const [paymentsIncome, setPaymentsIncome] = useState([]);
  const [paymentsVendor, setPaymentsVendor] = useState([]);
  const [operationalExpenses, setOperationalExpenses] = useState([]);

  const [migrating, setMigrating] = useState(false);
  const [migrationDone, setMigrationDone] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [companyProfile, setCompanyProfile] = useState(DEFAULT_COMPANY_PROFILE);

  // Diagnosa & koreksi dampak reschedule di Migrasi Data Awal — lihat
  // diagnoseRescheduleMigrationImpact/applyRescheduleMigrationCorrection
  // di lib/journal.js buat penjelasan lengkap masalahnya.
  const [showRescheduleDiagnosis, setShowRescheduleDiagnosis] = useState(false);
  const [rescheduleDiagnosis, setRescheduleDiagnosis] = useState(null);
  const [applyingRescheduleFix, setApplyingRescheduleFix] = useState(false);

  // Diagnosa & koreksi booking yang kesimpen tapi jurnal `booking_created`-
  // nya gagal keposting (misal network/permission error pas nyimpen booking
  // baru) — lihat diagnoseMissingBookingJournals/applyMissingBookingJournalsCorrection
  // di lib/journal.js. Pola sama persis kayak Cek Dampak Reschedule di atas.
  const [showMissingJournalDiagnosis, setShowMissingJournalDiagnosis] = useState(false);
  const [missingJournalDiagnosis, setMissingJournalDiagnosis] = useState(null);
  const [applyingMissingJournalFix, setApplyingMissingJournalFix] = useState(false);

  // Rekonsiliasi Piutang Jamaah PER BOOKING — buat nyari tau persis booking
  // mana yang bikin Neraca beda sama Total Piutang Jamaah di tab Piutang &
  // Hutang (lihat diagnoseArReconciliation/removeDuplicateBookingCreatedEntries
  // di lib/journal.js). Read-only diagnosa, cuma aksi koreksi yang disediakan
  // di sini yang well-defined & aman (hapus jurnal booking_created yang
  // eksplisit dobel-posting) — mismatch lain ditampilin apa adanya biar staf/
  // finance yang putuskan koreksinya, bukan di-auto-apply.
  const [showArReconciliation, setShowArReconciliation] = useState(false);
  const [arReconciliation, setArReconciliation] = useState(null);
  const [removingDuplicates, setRemovingDuplicates] = useState(false);
  const [removingOrphans, setRemovingOrphans] = useState(false);
  const [expandedArBookingIds, setExpandedArBookingIds] = useState([]);
  const [deletingEntryId, setDeletingEntryId] = useState(null);

  // Diagnosa & koreksi jurnal Komisi Mitra/Agen yang belum pernah keposting
  // (lihat catatan lengkap di diagnoseMissingCommissionJournals, lib/journal.js
  // — gap-nya baru ditambal 11 Sep 2026, histori lama perlu dibackfill manual).
  const [commissionPayments, setCommissionPayments] = useState([]);
  const [showMissingCommissionDiagnosis, setShowMissingCommissionDiagnosis] = useState(false);
  const [missingCommissionDiagnosis, setMissingCommissionDiagnosis] = useState(null);
  const [applyingMissingCommissionFix, setApplyingMissingCommissionFix] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      await seedChartOfAccounts();
      const [
        jeList, coaList, bookSnap, pkgSnap, billSnap, vendorSnap, accSnap,
        incomeSnap, vendorPaySnap, opexSnap, migFlagSnap, profileSnap, commissionSnap
      ] = await Promise.all([
        fetchAllJournalEntries(),
        fetchChartOfAccounts(),
        getDocs(collection(db, 'bookings')),
        getDocs(collection(db, 'packages')),
        getDocs(collection(db, 'vendor_bills')),
        getDocs(collection(db, 'vendors')),
        getDocs(collection(db, 'financial_accounts')),
        getDocs(collection(db, 'payments_income')),
        getDocs(collection(db, 'payments_vendor')),
        getDocs(collection(db, 'expenses_operational')),
        getDoc(doc(db, 'settings', 'journal_migration')),
        getDoc(doc(db, 'settings', 'company_profile')),
        getDocs(collection(db, 'partner_commission_payments')),
      ]);
      const opexList = opexSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => !o.isCategoryConfig);

      setChartOfAccounts(coaList);
      setBookingsList(bookSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      // Filter dokumen config kategori destinasi ('_destination_categories_config')
      // yang disamarkan sebagai doc di collection 'packages' sendiri (lihat
      // PackagesModule.jsx) — kalau nggak difilter, dia ikut ke-anggep "paket"
      // di semua tab yang pakai packagesList di sini (termasuk Analisa Margin).
      setPackagesList(pkgSnap.docs.filter(d => d.id !== '_destination_categories_config').map(d => ({ id: d.id, ...d.data() })));
      setVendorBills(billSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setVendorsList(vendorSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => !v.isCategoryConfig));
      setFinancialAccounts(accSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPaymentsIncome(incomeSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPaymentsVendor(vendorPaySnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setOperationalExpenses(opexList);
      setCommissionPayments(commissionSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setMigrationDone(!!(migFlagSnap.exists() && migFlagSnap.data().done));
      if (profileSnap.exists() && profileSnap.data().company) {
        setCompanyProfile({ ...DEFAULT_COMPANY_PROFILE, ...profileSnap.data().company });
      }

      // Tambal baris jurnal Beban Operasional lama yang belum punya field
      // `category` (dibuat sebelum fitur breakdown-per-kategori ada) —
      // idempotent, cuma nambal yang bolong. Kalau ada yang ditambal,
      // jurnalnya di-fetch ulang biar Buku Besar/breakdown langsung
      // kepakai versi yang udah lengkap tanpa perlu reload manual.
      try {
        const patched = await backfillOpexJournalCategories(opexList);
        setJournalEntries(patched > 0 ? await fetchAllJournalEntries() : jeList);
      } catch (err) {
        console.error('Gagal menambal kategori jurnal biaya operasional lama:', err);
        setJournalEntries(jeList);
      }
    } catch (err) {
      console.error('Gagal memuat data Laporan Keuangan:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleRunMigration = async () => {
    if (!confirm('Migrasi data awal ini akan bikin jurnal dari SELURUH data lama (booking, setoran, bayar vendor, biaya operasional, pengakuan pendapatan, pembatalan) yang belum pernah dijurnal sebelumnya. Proses ini SEKALI JALAN doang dan tidak bisa diulang kalau sudah pernah sukses. Lanjutkan?')) return;
    setMigrating(true);
    try {
      const summary = await runInitialJournalMigration({
        financialAccounts, bookings: bookingsList, paymentsIncome, paymentsVendor,
        operationalExpenses, packages: packagesList,
        createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
      });
      alert(`Migrasi selesai!\n\nJurnal dibuat: ${summary.created}\nDilewati (nominal 0): ${summary.skipped}\nError: ${summary.errors.length}${summary.errors.length > 0 ? `\n\nDetail error:\n${summary.errors.slice(0, 10).join('\n')}` : ''}`);
      await fetchData();
    } catch (err) {
      alert('Gagal menjalankan migrasi: ' + err.message);
    }
    setMigrating(false);
  };

  const handleOpenRescheduleDiagnosis = () => {
    const result = diagnoseRescheduleMigrationImpact({ bookings: bookingsList, paymentsIncome, journalEntries });
    setRescheduleDiagnosis(result);
    setShowRescheduleDiagnosis(true);
  };

  const handleApplyRescheduleFix = async () => {
    if (!rescheduleDiagnosis || rescheduleDiagnosis.affected.length === 0) return;
    if (!confirm(`Terapkan koreksi buat ${rescheduleDiagnosis.affected.length} booking hasil reschedule yang kena dampak? Ini bakal posting jurnal koreksi tutup-buku + reklas carry-over per booking (aman diulang, item yang udah pernah dikoreksi otomatis dilewati).`)) return;
    setApplyingRescheduleFix(true);
    try {
      const summary = await applyRescheduleMigrationCorrection({
        affected: rescheduleDiagnosis.affected, bookings: bookingsList, packages: packagesList,
        createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
      });
      alert(`Koreksi selesai!\n\nBooking dikoreksi: ${summary.corrected}\nDilewati (udah pernah dikoreksi/nggak kena dampak lagi): ${summary.skipped}\nError: ${summary.errors.length}${summary.errors.length > 0 ? `\n\nDetail error:\n${summary.errors.slice(0, 10).join('\n')}` : ''}`);
      await fetchData();
      setShowRescheduleDiagnosis(false);
      setRescheduleDiagnosis(null);
    } catch (err) {
      alert('Gagal menerapkan koreksi: ' + err.message);
    }
    setApplyingRescheduleFix(false);
  };

  const handleOpenMissingJournalDiagnosis = () => {
    const result = diagnoseMissingBookingJournals({ bookings: bookingsList, journalEntries });
    setMissingJournalDiagnosis(result);
    setShowMissingJournalDiagnosis(true);
  };

  const handleApplyMissingJournalFix = async () => {
    if (!missingJournalDiagnosis || missingJournalDiagnosis.affected.length === 0) return;
    if (!confirm(`Posting jurnal buat ${missingJournalDiagnosis.affected.length} booking yang kelewat ini? Ini bakal jalanin "Booking baru" (Dr Piutang Jamaah, Cr Pendapatan Diterima Dimuka) per booking, pakai tanggal & nominal asli booking-nya (bukan tanggal hari ini) — aman diulang, booking yang udah kejurnal otomatis dilewati.`)) return;
    setApplyingMissingJournalFix(true);
    try {
      const summary = await applyMissingBookingJournalsCorrection({
        affected: missingJournalDiagnosis.affected,
        createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
      });
      alert(`Koreksi selesai!\n\nBooking dikoreksi: ${summary.corrected}\nDilewati (udah kejurnal duluan): ${summary.skipped}\nError: ${summary.errors.length}${summary.errors.length > 0 ? `\n\nDetail error:\n${summary.errors.slice(0, 10).join('\n')}` : ''}`);
      await fetchData();
      setShowMissingJournalDiagnosis(false);
      setMissingJournalDiagnosis(null);
    } catch (err) {
      alert('Gagal menerapkan koreksi: ' + err.message);
    }
    setApplyingMissingJournalFix(false);
  };

  const handleOpenArReconciliation = () => {
    const result = diagnoseArReconciliation({ bookings: bookingsList, journalEntries });
    setArReconciliation(result);
    setShowArReconciliation(true);
  };

  const handleRemoveDuplicates = async () => {
    if (!arReconciliation || arReconciliation.duplicateBookingCreated.length === 0) return;
    if (!confirm(`Hapus jurnal "Booking baru" yang dobel-posting buat ${arReconciliation.duplicateBookingCreated.length} booking ini? Yang dipertahankan cuma jurnal yang PALING DULU dibuat per booking (yang asli), sisanya (hasil dobel) dihapus. Aman diulang.`)) return;
    setRemovingDuplicates(true);
    try {
      const summary = await removeDuplicateBookingCreatedEntries({ duplicateBookingCreated: arReconciliation.duplicateBookingCreated });
      alert(`Selesai!\n\nJurnal dobel yang dihapus: ${summary.deleted}\nBooking yang dibereskan: ${summary.keptBookings}\nError: ${summary.errors.length}${summary.errors.length > 0 ? `\n\nDetail error:\n${summary.errors.slice(0, 10).join('\n')}` : ''}`);
      await fetchData();
      setShowArReconciliation(false);
      setArReconciliation(null);
    } catch (err) {
      alert('Gagal menghapus jurnal dobel: ' + err.message);
    }
    setRemovingDuplicates(false);
  };

  const handleRemoveOrphans = async () => {
    if (!arReconciliation || arReconciliation.orphanEntries.length === 0) return;
    if (!confirm(`Hapus ${arReconciliation.orphanEntries.length} jurnal yatim piatu (nempel ke booking yang udah dihapus permanen dari sistem)? Ini nggak bisa dibatalkan (tapi transaksi aslinya emang udah nggak ada juga).`)) return;
    setRemovingOrphans(true);
    try {
      const summary = await removeOrphanBookingJournalEntries({ orphanEntries: arReconciliation.orphanEntries });
      alert(`Selesai!\n\nJurnal yatim piatu yang dihapus: ${summary.deleted}\nError: ${summary.errors.length}${summary.errors.length > 0 ? `\n\nDetail error:\n${summary.errors.slice(0, 10).join('\n')}` : ''}`);
      await fetchData();
      setShowArReconciliation(false);
      setArReconciliation(null);
    } catch (err) {
      alert('Gagal menghapus jurnal yatim piatu: ' + err.message);
    }
    setRemovingOrphans(false);
  };

  const toggleArBookingExpand = (bookingId) => {
    setExpandedArBookingIds(prev => prev.includes(bookingId) ? prev.filter(x => x !== bookingId) : [...prev, bookingId]);
  };

  const handleDeleteArEntry = async (entryId, label) => {
    if (!confirm(`Hapus jurnal ini (${label})? Cuma hapus entry ini doang, bukan seluruh booking-nya. Pastikan udah yakin ini beneran dobel/salah sebelum hapus.`)) return;
    setDeletingEntryId(entryId);
    try {
      await deleteJournalEntryById(entryId);
      await fetchData();
      // Re-diagnosa pakai data yang baru di-fetch (fetchData nge-update
      // journalEntries/bookingsList state, tapi butuh nunggu 1 tick biar
      // state-nya kepake) — paling aman minta user buka ulang modalnya.
      setShowArReconciliation(false);
      setArReconciliation(null);
      alert('Jurnal berhasil dihapus. Buka lagi "Rekonsiliasi Piutang per Booking" buat lihat hasil terbarunya.');
    } catch (err) {
      alert('Gagal menghapus jurnal: ' + err.message);
    }
    setDeletingEntryId(null);
  };

  const handleOpenMissingCommissionDiagnosis = () => {
    const result = diagnoseMissingCommissionJournals({ commissionPayments, journalEntries });
    setMissingCommissionDiagnosis(result);
    setShowMissingCommissionDiagnosis(true);
  };

  const handleApplyMissingCommissionFix = async () => {
    if (!missingCommissionDiagnosis || missingCommissionDiagnosis.affected.length === 0) return;
    if (!confirm(`Posting jurnal buat ${missingCommissionDiagnosis.affected.length} pembayaran komisi Mitra/Agen lama yang belum pernah kejurnal? Aman diulang, yang udah kejurnal otomatis dilewati.`)) return;
    setApplyingMissingCommissionFix(true);
    try {
      const summary = await applyMissingCommissionJournalsCorrection({
        affected: missingCommissionDiagnosis.affected,
        createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
      });
      alert(`Koreksi selesai!\n\nKomisi dikoreksi: ${summary.corrected}\nDilewati (udah kejurnal duluan): ${summary.skipped}\nError: ${summary.errors.length}${summary.errors.length > 0 ? `\n\nDetail error:\n${summary.errors.slice(0, 10).join('\n')}` : ''}`);
      await fetchData();
      setShowMissingCommissionDiagnosis(false);
      setMissingCommissionDiagnosis(null);
    } catch (err) {
      alert('Gagal menerapkan koreksi: ' + err.message);
    }
    setApplyingMissingCommissionFix(false);
  };

  if (loading) {
    return (
      <div className={`${styles.cardBg} border rounded-xl p-12 text-center`}>
        <RefreshCw className={`w-6 h-6 mx-auto mb-3 animate-spin ${styles.textSub}`} />
        <p className={`text-xs ${styles.textSub}`}>Memuat data Laporan Keuangan...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3`}>
        <div>
          <h2 className={`text-lg font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Scale className="w-5 h-5 text-indigo-500" /> Laporan Keuangan
          </h2>
          <p className={`text-xs ${styles.textSub} mt-0.5`}>Jurnal Umum, Buku Besar, Neraca, Arus Kas, Piutang & Hutang — jurnal ganda otomatis dari setiap transaksi.</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && !migrationDone && (
            <button
              onClick={handleRunMigration}
              disabled={migrating}
              className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${migrating ? 'animate-spin' : ''}`} /> {migrating ? 'Memproses...' : 'Migrasi Data Awal'}
            </button>
          )}
          {isSuperAdmin && migrationDone && (
            <span className="text-[10.5px] text-emerald-500 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Migrasi data awal sudah pernah dijalankan.</span>
          )}
          {isSuperAdmin && migrationDone && (
            <button
              onClick={handleOpenRescheduleDiagnosis}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
              title="Cek apakah ada booking hasil reschedule (sebelum migrasi jalan) yang kena dobel-catat di Neraca"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Cek Dampak Reschedule
            </button>
          )}
          {isSuperAdmin && (
            <button
              onClick={handleOpenMissingJournalDiagnosis}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
              title="Cek apakah ada booking yang kesimpen tapi jurnalnya gagal keposting (misal gara-gara error koneksi)"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Cek Booking Belum Terjurnal
            </button>
          )}
          {isSuperAdmin && (
            <button
              onClick={handleOpenArReconciliation}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
              title="Cari tau persis booking mana yang bikin Piutang Jamaah di Neraca beda sama Total Piutang Jamaah di tab Piutang & Hutang"
            >
              <Scale className="w-3.5 h-3.5" /> Rekonsiliasi Piutang per Booking
            </button>
          )}
          {isSuperAdmin && (
            <button
              onClick={handleOpenMissingCommissionDiagnosis}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
              title="Cek pembayaran komisi Mitra/Agen lama yang belum pernah kejurnal (gap ditambal 11 Sep 2026)"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Cek Komisi Mitra Belum Terjurnal
            </button>
          )}
        </div>
      </div>

      {showRescheduleDiagnosis && rescheduleDiagnosis && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`${styles.cardBg} border rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-sm font-bold ${styles.textTitle}`}>Dampak Reschedule di Migrasi Data Awal</h3>
              <button onClick={() => { setShowRescheduleDiagnosis(false); setRescheduleDiagnosis(null); }} className={styles.textSub}><X className="w-4 h-4" /></button>
            </div>
            <p className={`text-xs ${styles.textSub} mb-3`}>
              Migrasi Data Awal nge-jurnal SEMUA booking apa adanya, termasuk booking yang statusnya udah "rescheduled" SEBELUM migrasi jalan — booking lama itu nggak ditutup buku, dan setoran "Carry-Over Reschedule"-nya (bukan uang beneran masuk) sempat ke-jurnal seolah kas beneran nambah. Ini diagnosa read-only dulu, belum ada jurnal apapun yang diposting.
            </p>
            {rescheduleDiagnosis.count === 0 ? (
              <div className={`p-4 rounded-lg ${styles.innerBg} border text-xs ${styles.textSub} flex items-center gap-2`}>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Nggak ada booking yang kena dampak ini. Neraca kamu aman dari sisi reschedule.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                    <p className={`text-[10.5px] ${styles.textSub}`}>Booking kena dampak</p>
                    <p className={`text-lg font-bold ${styles.textTitle}`}>{rescheduleDiagnosis.count}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                    <p className={`text-[10.5px] ${styles.textSub}`}>Total Piutang belum ditutup buku + kas hantu</p>
                    <p className="text-lg font-bold text-amber-500">{formatRp(rescheduleDiagnosis.totalWriteOff + rescheduleDiagnosis.totalGhostCash)}</p>
                  </div>
                </div>
                <div className="overflow-x-auto mb-3">
                  <table className="w-full text-[11px]">
                    <thead className={styles.tableHeaderBg}>
                      <tr>
                        <th className="text-left p-2 font-medium">Booking Lama</th>
                        <th className="text-left p-2 font-medium">-&gt; Booking Baru</th>
                        <th className="text-right p-2 font-medium">Piutang belum ditutup</th>
                        <th className="text-right p-2 font-medium">Kas hantu (carry-over)</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {rescheduleDiagnosis.affected.map(item => (
                        <tr key={item.oldBookingId}>
                          <td className="p-2">{item.oldBookingCode || item.oldBookingId} <span className={styles.textSub}>({item.oldJamaahName || '-'})</span></td>
                          <td className="p-2">{item.newBookingCode}</td>
                          <td className="p-2 text-right">{formatRp(item.writeOffAmount)}</td>
                          <td className="p-2 text-right">{formatRp(item.ghostCashAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={handleApplyRescheduleFix}
                  disabled={applyingRescheduleFix}
                  className="w-full px-3 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg disabled:opacity-60"
                >
                  {applyingRescheduleFix ? 'Memproses...' : `Terapkan Koreksi buat ${rescheduleDiagnosis.count} Booking Ini`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showMissingJournalDiagnosis && missingJournalDiagnosis && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`${styles.cardBg} border rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-sm font-bold ${styles.textTitle}`}>Booking Belum Terjurnal</h3>
              <button onClick={() => { setShowMissingJournalDiagnosis(false); setMissingJournalDiagnosis(null); }} className={styles.textSub}><X className="w-4 h-4" /></button>
            </div>
            <p className={`text-xs ${styles.textSub} mb-3`}>
              Booking baru di sistem otomatis nge-jurnal Piutang Jamaah begitu disimpan. Kadang jurnalnya bisa gagal keposting (misal koneksi putus pas nyimpen) walau booking-nya sendiri tetap tersimpan — daftar di bawah ini booking status aktif yang KESIMPEN tapi belum ada jurnal "Booking baru"-nya sama sekali. Ini diagnosa read-only dulu, belum ada jurnal apapun yang diposting.
            </p>
            {missingJournalDiagnosis.count === 0 ? (
              <div className={`p-4 rounded-lg ${styles.innerBg} border text-xs ${styles.textSub} flex items-center gap-2`}>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Nggak ada booking yang kelewat. Semua booking aktif udah kejurnal.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                    <p className={`text-[10.5px] ${styles.textSub}`}>Booking kena dampak</p>
                    <p className={`text-lg font-bold ${styles.textTitle}`}>{missingJournalDiagnosis.count}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                    <p className={`text-[10.5px] ${styles.textSub}`}>Total Piutang yang belum kejurnal</p>
                    <p className="text-lg font-bold text-amber-500">{formatRp(missingJournalDiagnosis.totalAmount)}</p>
                  </div>
                </div>
                <div className="overflow-x-auto mb-3">
                  <table className="w-full text-[11px]">
                    <thead className={styles.tableHeaderBg}>
                      <tr>
                        <th className="text-left p-2 font-medium">Booking</th>
                        <th className="text-left p-2 font-medium">Jamaah</th>
                        <th className="text-left p-2 font-medium">Tanggal Booking</th>
                        <th className="text-right p-2 font-medium">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {missingJournalDiagnosis.affected.map(item => (
                        <tr key={item.bookingId}>
                          <td className="p-2">{item.bookingCode || item.bookingId}</td>
                          <td className="p-2">{item.jamaahName || '-'}</td>
                          <td className="p-2">{formatDateDDMMYYYY((item.createdAt || '').slice(0, 10))}</td>
                          <td className="p-2 text-right">{formatRp(item.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={handleApplyMissingJournalFix}
                  disabled={applyingMissingJournalFix}
                  className="w-full px-3 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg disabled:opacity-60"
                >
                  {applyingMissingJournalFix ? 'Memproses...' : `Posting Jurnal buat ${missingJournalDiagnosis.count} Booking Ini`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showMissingCommissionDiagnosis && missingCommissionDiagnosis && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`${styles.cardBg} border rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-sm font-bold ${styles.textTitle}`}>Komisi Mitra/Agen Belum Terjurnal</h3>
              <button onClick={() => { setShowMissingCommissionDiagnosis(false); setMissingCommissionDiagnosis(null); }} className={styles.textSub}><X className="w-4 h-4" /></button>
            </div>
            <p className={`text-xs ${styles.textSub} mb-3`}>
              Pembayaran Komisi Mitra/Agen (modul Mitra & Agen) sempat nggak pernah dijurnal sama sekali sejak fitur ini dibikin — cuma nulis Biaya Operasional + mutasi akun langsung, nggak pernah lewat jurnal ganda. Ditambal 11 September 2026 (transaksi baru otomatis kejurnal), tapi histori LAMA di bawah ini perlu di-backfill manual biar Neraca/Buku Besar/Arus Kas akurat. Read-only dulu, belum ada jurnal apapun yang diposting.
            </p>
            {missingCommissionDiagnosis.count === 0 ? (
              <div className={`p-4 rounded-lg ${styles.innerBg} border text-xs ${styles.textSub} flex items-center gap-2`}>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Nggak ada yang kelewat. Semua pembayaran komisi udah kejurnal.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                    <p className={`text-[10.5px] ${styles.textSub}`}>Pembayaran kena dampak</p>
                    <p className={`text-lg font-bold ${styles.textTitle}`}>{missingCommissionDiagnosis.count}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                    <p className={`text-[10.5px] ${styles.textSub}`}>Total belum kejurnal</p>
                    <p className="text-lg font-bold text-amber-500">{formatRp(missingCommissionDiagnosis.totalAmount)}</p>
                  </div>
                </div>
                <div className="overflow-x-auto mb-3">
                  <table className="w-full text-[11px]">
                    <thead className={styles.tableHeaderBg}>
                      <tr>
                        <th className="text-left p-2 font-medium">Mitra/Agen</th>
                        <th className="text-left p-2 font-medium">Tanggal</th>
                        <th className="text-right p-2 font-medium">Nominal</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {missingCommissionDiagnosis.affected.map(item => (
                        <tr key={item.paymentId}>
                          <td className="p-2">{item.partnerName || '-'}</td>
                          <td className="p-2">{formatDateDDMMYYYY((item.createdAt || '').slice(0, 10))}</td>
                          <td className="p-2 text-right">{formatRp(item.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={handleApplyMissingCommissionFix}
                  disabled={applyingMissingCommissionFix}
                  className="w-full px-3 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg disabled:opacity-60"
                >
                  {applyingMissingCommissionFix ? 'Memproses...' : `Posting Jurnal buat ${missingCommissionDiagnosis.count} Pembayaran Ini`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showArReconciliation && arReconciliation && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className={`${styles.cardBg} border rounded-xl max-w-4xl w-full max-h-[85vh] overflow-y-auto p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-sm font-bold ${styles.textTitle}`}>Rekonsiliasi Piutang Jamaah per Booking</h3>
              <button onClick={() => { setShowArReconciliation(false); setArReconciliation(null); }} className={styles.textSub}><X className="w-4 h-4" /></button>
            </div>
            <p className={`text-xs ${styles.textSub} mb-3`}>
              Bandingin per booking aktif: nilai "Piutang Jamaah" hasil jurnal (yang kepakai di Neraca) vs sisa tagihan live (totalAmount - totalPaid, yang kepakai di tab Piutang & Hutang). Cuma booking yang BEDA yang ditampilin. Diff positif = jurnal kelebihan catat (kemungkinan dobel-posting); diff negatif = jurnal kurang catat (ada yang belum kejurnal). Read-only, belum ada apapun yang diubah.
            </p>
            {arReconciliation.orphanEntries.length > 0 && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 mb-3">
                <p className="text-xs font-bold text-rose-500 mb-1">Ketemu {arReconciliation.orphanEntries.length} jurnal YATIM PIATU (nempel ke booking yang udah dihapus permanen dari sistem) — total Rp {formatRp(arReconciliation.orphanTotal1201)} nempel di Neraca selamanya kalau nggak dibersihin:</p>
                <ul className="text-[11px] text-rose-400 list-disc list-inside mb-2 max-h-32 overflow-y-auto">
                  {arReconciliation.orphanEntries.map(o => (
                    <li key={o.id}>{o.reference || o.sourceDocId} — {o.description} ({formatRp(o.net1201)})</li>
                  ))}
                </ul>
                <button
                  onClick={handleRemoveOrphans}
                  disabled={removingOrphans}
                  className="w-full px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg disabled:opacity-60"
                >
                  {removingOrphans ? 'Memproses...' : `Hapus ${arReconciliation.orphanEntries.length} Jurnal Yatim Piatu Ini`}
                </button>
              </div>
            )}
            {arReconciliation.count === 0 ? (
              <div className={`p-4 rounded-lg ${styles.innerBg} border text-xs ${styles.textSub} flex items-center gap-2`}>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Nggak ada booking yang beda. Jurnal Piutang Jamaah sudah cocok 1:1 sama live-sum-nya.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                    <p className={`text-[10.5px] ${styles.textSub}`}>Booking yang beda</p>
                    <p className={`text-lg font-bold ${styles.textTitle}`}>{arReconciliation.count}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                    <p className={`text-[10.5px] ${styles.textSub}`}>Total selisih bersih</p>
                    <p className={`text-lg font-bold ${arReconciliation.totalDiff >= 0 ? 'text-rose-500' : 'text-amber-500'}`}>{formatRp(arReconciliation.totalDiff)}</p>
                  </div>
                </div>
                {arReconciliation.duplicateBookingCreated.length > 0 && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 mb-3">
                    <p className="text-xs font-bold text-rose-500 mb-1">Ketemu {arReconciliation.duplicateBookingCreated.length} booking dengan jurnal "Booking baru" DOBEL-posting:</p>
                    <ul className="text-[11px] text-rose-400 list-disc list-inside mb-2">
                      {arReconciliation.duplicateBookingCreated.map(d => (
                        <li key={d.bookingId}>{d.bookingCode || d.bookingId} ({d.jamaahName || '-'}) — {d.count}x jurnal</li>
                      ))}
                    </ul>
                    <button
                      onClick={handleRemoveDuplicates}
                      disabled={removingDuplicates}
                      className="w-full px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg disabled:opacity-60"
                    >
                      {removingDuplicates ? 'Memproses...' : `Hapus Jurnal Dobel buat ${arReconciliation.duplicateBookingCreated.length} Booking Ini (pertahankan yang paling awal)`}
                    </button>
                  </div>
                )}
                <p className={`text-[10.5px] ${styles.textSub} mb-1.5`}>Klik baris buat lihat rincian jurnal per booking (biar ketauan persis entry mana yang dobel/salah, sebelum dihapus satu-satu).</p>
                <div className="overflow-x-auto mb-3">
                  <table className="w-full text-[11px]">
                    <thead className={styles.tableHeaderBg}>
                      <tr>
                        <th className="text-left p-2 font-medium">Booking</th>
                        <th className="text-left p-2 font-medium">Jamaah</th>
                        <th className="text-right p-2 font-medium">Sisa Tagihan (Live)</th>
                        <th className="text-right p-2 font-medium">Piutang (Jurnal)</th>
                        <th className="text-right p-2 font-medium">Diff</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {arReconciliation.mismatches.map(item => (
                        <React.Fragment key={item.bookingId}>
                          <tr className={`cursor-pointer ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`} onClick={() => toggleArBookingExpand(item.bookingId)}>
                            <td className="p-2">{item.bookingCode || item.bookingId}{item.isDuplicate && <span className="ml-1 text-[9.5px] text-rose-500 font-bold">DOBEL</span>}</td>
                            <td className="p-2">{item.jamaahName || '-'}</td>
                            <td className="p-2 text-right">{formatRp(item.liveOutstanding)}</td>
                            <td className="p-2 text-right">{formatRp(item.journalNet)}</td>
                            <td className={`p-2 text-right font-bold ${item.diff >= 0 ? 'text-rose-500' : 'text-amber-500'}`}>{item.diff >= 0 ? '+' : ''}{formatRp(item.diff)}</td>
                            <td className="p-2 text-right">{expandedArBookingIds.includes(item.bookingId) ? <ChevronDown className="w-3.5 h-3.5 inline" /> : <ChevronRight className="w-3.5 h-3.5 inline" />}</td>
                          </tr>
                          {expandedArBookingIds.includes(item.bookingId) && (
                            <tr>
                              <td colSpan={6} className={`p-0 ${styles.innerBg}`}>
                                {item.entries.length === 0 ? (
                                  <p className={`p-3 text-[10.5px] ${styles.textSub}`}>Nggak ada jurnal yang nyentuh 1201 buat booking ini (aneh — cek manual di Jurnal Umum pakai kode booking ini).</p>
                                ) : (
                                  <table className="w-full text-[10.5px]">
                                    <thead>
                                      <tr className={styles.textSub}>
                                        <th className="text-left px-3 py-1.5 font-medium">Tanggal</th>
                                        <th className="text-left px-3 py-1.5 font-medium">Source</th>
                                        <th className="text-left px-3 py-1.5 font-medium">Deskripsi</th>
                                        <th className="text-right px-3 py-1.5 font-medium">Debit</th>
                                        <th className="text-right px-3 py-1.5 font-medium">Kredit</th>
                                        <th className="px-3 py-1.5"></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {item.entries.map(en => (
                                        <tr key={en.id} className="border-t border-dashed border-slate-700/30">
                                          <td className="px-3 py-1.5">{formatDateDDMMYYYY((en.date || '').slice(0, 10))}</td>
                                          <td className="px-3 py-1.5">{en.source}{en.isManual && ' (manual)'}</td>
                                          <td className="px-3 py-1.5">{en.description}</td>
                                          <td className="px-3 py-1.5 text-right">{en.debit > 0 ? formatRp(en.debit) : '-'}</td>
                                          <td className="px-3 py-1.5 text-right">{en.credit > 0 ? formatRp(en.credit) : '-'}</td>
                                          <td className="px-3 py-1.5 text-right">
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleDeleteArEntry(en.id, `${en.source} - ${en.description}`); }}
                                              disabled={deletingEntryId === en.id}
                                              className="text-rose-500 hover:text-rose-400 disabled:opacity-50"
                                              title="Hapus entry jurnal ini"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className={`${styles.cardBg} border rounded-xl p-1.5 flex flex-wrap gap-1`}>
        {[
          { key: 'journal', label: 'Jurnal Umum', icon: BookOpen },
          { key: 'cash_bank', label: 'Kas & Bank', icon: Wallet },
          { key: 'ledger', label: 'Buku Besar', icon: Wallet },
          { key: 'balance_sheet', label: 'Neraca', icon: Scale },
          { key: 'profit_loss', label: 'Laba Rugi (P&L)', icon: BarChart3 },
          { key: 'cash_flow', label: 'Arus Kas', icon: TrendingUp },
          { key: 'ar_ap', label: 'Piutang & Hutang', icon: Users },
          { key: 'margin_analysis', label: 'Analisa Margin', icon: ArrowUpRight },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 border ${activeTab === t.key ? styles.tabActive : `border-transparent ${styles.textSub} hover:${styles.textTitle}`}`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'journal' && (
        <JournalTab styles={styles} isDark={isDark} journalEntries={journalEntries} chartOfAccounts={chartOfAccounts} currentUser={currentUser} onRefresh={fetchData} />
      )}
      {activeTab === 'ledger' && (
        <LedgerTab styles={styles} isDark={isDark} journalEntries={journalEntries} chartOfAccounts={chartOfAccounts} financialAccounts={financialAccounts} companyProfile={companyProfile} />
      )}
      {activeTab === 'balance_sheet' && (
        <BalanceSheetTab styles={styles} isDark={isDark} journalEntries={journalEntries} chartOfAccounts={chartOfAccounts} financialAccounts={financialAccounts} companyProfile={companyProfile} generatingPdf={generatingPdf} setGeneratingPdf={setGeneratingPdf} />
      )}
      {activeTab === 'cash_flow' && (
        <CashFlowTab styles={styles} isDark={isDark} journalEntries={journalEntries} financialAccounts={financialAccounts} />
      )}
      {activeTab === 'ar_ap' && (
        <ArApTab styles={styles} isDark={isDark} bookingsList={bookingsList} vendorBills={vendorBills} vendorsList={vendorsList} />
      )}
      {activeTab === 'profit_loss' && (
        <ProfitLossTab
          styles={styles} isDark={isDark} currentUser={currentUser}
          transactions={paymentsIncome} vendorPayments={paymentsVendor}
          operationalExpenses={operationalExpenses} packagesList={packagesList}
          onRefresh={fetchData}
        />
      )}
      {activeTab === 'margin_analysis' && (
        <MarginAnalysisTab
          styles={styles} isDark={isDark}
          packagesList={packagesList} journalEntries={journalEntries} companyProfile={companyProfile}
        />
      )}
      {activeTab === 'cash_bank' && (
        <CashBankTab styles={styles} isDark={isDark} currentUser={currentUser} financialAccounts={financialAccounts} onRefresh={fetchData} />
      )}
    </div>
  );
}

// =====================================================================
// TAB 1: JURNAL UMUM
// =====================================================================
function JournalTab({ styles, isDark, journalEntries, chartOfAccounts, currentUser, onRefresh }) {
  const [expandedIds, setExpandedIds] = useState([]);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterSource, setFilterSource] = useState('all');
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualForm, setManualForm] = useState({
    date: todayISODate(), description: '', debitAccount: '', creditAccount: '', amount: ''
  });
  const [savingManual, setSavingManual] = useState(false);

  const isFinanceOrAdmin = ['finance', 'admin', 'super admin'].includes((currentUser?.role || '').toLowerCase()) || (currentUser?.role || '').toLowerCase().includes('super');

  const sources = Array.from(new Set(journalEntries.map(e => e.source).filter(Boolean)));

  const filtered = journalEntries.filter(e => {
    const dateStr = (e.date || '').slice(0, 10);
    if (filterStart && dateStr < filterStart) return false;
    if (filterEnd && dateStr > filterEnd) return false;
    if (filterSource !== 'all' && e.source !== filterSource) return false;
    return true;
  });

  const toggleExpand = (id) => setExpandedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    const amt = Number(manualForm.amount);
    if (!manualForm.debitAccount || !manualForm.creditAccount) {
      alert('Pilih akun Debit dan akun Kredit dulu.');
      return;
    }
    if (manualForm.debitAccount === manualForm.creditAccount) {
      alert('Akun Debit dan Kredit tidak boleh sama.');
      return;
    }
    if (!(amt > 0)) {
      alert('Isi nominal yang valid (lebih dari 0).');
      return;
    }
    setSavingManual(true);
    try {
      const debitAcc = chartOfAccounts.find(a => a.code === manualForm.debitAccount);
      const creditAcc = chartOfAccounts.find(a => a.code === manualForm.creditAccount);
      await postJournalEntry({
        date: new Date(manualForm.date).toISOString(),
        description: manualForm.description || 'Jurnal Koreksi Manual',
        source: 'manual', sourceDocId: `manual_${Date.now()}`, reference: '',
        lines: [
          { accountCode: debitAcc.code, accountName: debitAcc.name, debit: amt, credit: 0 },
          { accountCode: creditAcc.code, accountName: creditAcc.name, debit: 0, credit: amt },
        ],
        createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email,
        isManual: true
      });
      setShowManualModal(false);
      setManualForm({ date: todayISODate(), description: '', debitAccount: '', creditAccount: '', amount: '' });
      onRefresh();
    } catch (err) {
      alert('Gagal menyimpan jurnal manual: ' + err.message);
    }
    setSavingManual(false);
  };

  return (
    <div className="space-y-3">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex flex-wrap items-end gap-3`}>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Dari Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterStart} onChange={e => setFilterStart(e.target.value)} />
        </div>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Sampai Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterEnd} onChange={e => setFilterEnd(e.target.value)} />
        </div>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Sumber</label>
          <select className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="all">Semua Sumber</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        {isFinanceOrAdmin && (
          <button onClick={() => setShowManualModal(true)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
            + Jurnal Manual
          </button>
        )}
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={styles.tableHeaderBg}>
              <tr>
                <th className="text-left p-3 font-medium">Tanggal</th>
                <th className="text-left p-3 font-medium">Deskripsi</th>
                <th className="text-left p-3 font-medium">Sumber</th>
                <th className="text-right p-3 font-medium">Debit</th>
                <th className="text-right p-3 font-medium">Kredit</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className={`p-6 text-center ${styles.textSub}`}>Belum ada jurnal pada periode/filter ini.</td></tr>
              )}
              {filtered.map(entry => (
                <React.Fragment key={entry.id}>
                  <tr className={`cursor-pointer ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`} onClick={() => toggleExpand(entry.id)}>
                    <td className="p-3 whitespace-nowrap">{formatDateDDMMYYYY(entry.date)}</td>
                    <td className={`p-3 ${styles.textTitle}`}>{entry.description}{entry.isManual ? <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400">Manual</span> : ''}</td>
                    <td className={`p-3 ${styles.textSub}`}>{entry.source}</td>
                    <td className="p-3 text-right font-medium">{formatRp(entry.totalDebit)}</td>
                    <td className="p-3 text-right font-medium">{formatRp(entry.totalCredit)}</td>
                    <td className="p-3 text-right">{expandedIds.includes(entry.id) ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}</td>
                  </tr>
                  {expandedIds.includes(entry.id) && (
                    <tr>
                      <td colSpan={6} className={`p-0 ${styles.innerBg}`}>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className={styles.textSub}>
                              <th className="text-left px-6 py-1.5 font-medium">Akun</th>
                              <th className="text-right px-6 py-1.5 font-medium">Debit</th>
                              <th className="text-right px-6 py-1.5 font-medium">Kredit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(entry.lines || []).map((line, i) => (
                              <tr key={i}>
                                <td className={`px-6 py-1 ${styles.textTitle}`}>{line.accountCode} - {line.accountName}{line.financialAccountName ? ` (${line.financialAccountName})` : ''}</td>
                                <td className="px-6 py-1 text-right">{line.debit > 0 ? formatRp(line.debit) : '-'}</td>
                                <td className="px-6 py-1 text-right">{line.credit > 0 ? formatRp(line.credit) : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showManualModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
            <button onClick={() => setShowManualModal(false)} className={`absolute right-4 top-4 ${styles.textSub}`}><X className="w-5 h-5" /></button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4`}>Jurnal Koreksi Manual</h3>
            <p className={`text-[10.5px] ${styles.textSub} mb-4`}>Buat entry jurnal 2 baris (1 Debit, 1 Kredit) buat koreksi yang nggak bisa lewat transaksi normal. Nominal debit & kredit otomatis sama (balance).</p>
            <form onSubmit={handleManualSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Tanggal</label>
                <input type="date" required className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.date} onChange={e => setManualForm({ ...manualForm, date: e.target.value })} />
              </div>
              <div>
                <label className="block mb-1 font-medium">Akun Debit</label>
                <select required className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.debitAccount} onChange={e => setManualForm({ ...manualForm, debitAccount: e.target.value })}>
                  <option value="">-- Pilih Akun --</option>
                  {chartOfAccounts.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium">Akun Kredit</label>
                <select required className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.creditAccount} onChange={e => setManualForm({ ...manualForm, creditAccount: e.target.value })}>
                  <option value="">-- Pilih Akun --</option>
                  {chartOfAccounts.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium">Nominal (Rp)</label>
                <input type="number" required className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.amount} onChange={e => setManualForm({ ...manualForm, amount: e.target.value })} />
              </div>
              <div>
                <label className="block mb-1 font-medium">Keterangan</label>
                <input type="text" className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.description} onChange={e => setManualForm({ ...manualForm, description: e.target.value })} placeholder="Koreksi saldo..." />
              </div>
              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowManualModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>Batal</button>
                <button type="submit" disabled={savingManual} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-60">{savingManual ? 'Menyimpan...' : 'Simpan Jurnal'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB 2: BUKU BESAR
// =====================================================================
function LedgerTab({ styles, isDark, journalEntries, chartOfAccounts, financialAccounts, companyProfile }) {
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [accountCode, setAccountCode] = useState(chartOfAccounts[0]?.code || '');
  const [subAccountId, setSubAccountId] = useState(''); // '' = semua rekening (khusus 1101 - Kas & Bank)
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');

  const account = chartOfAccounts.find(a => a.code === accountCode);
  const isKasBank = accountCode === ACC.KAS_BANK;
  const isOpex = accountCode === ACC.OPEX;

  // Khusus 1101 - Kas & Bank: 1 akun COA ini nampung banyak rekening
  // (financial_accounts) sekaligus, jadi dikasih dropdown tambahan buat
  // milih rekening spesifik atau lihat semuanya digabung.
  const kasBankAccountOptions = isKasBank ? (() => {
    const byId = {};
    financialAccounts.forEach(fa => { byId[fa.id] = { accountId: fa.id, label: describeFinancialAccount(fa) }; });
    journalEntries.forEach(e => (e.lines || []).forEach(l => {
      if (l.accountCode !== ACC.KAS_BANK || !l.accountId || byId[l.accountId]) return;
      byId[l.accountId] = { accountId: l.accountId, label: l.financialAccountName || 'Rekening Tanpa Nama' };
    }));
    return Object.values(byId);
  })() : [];

  // Khusus 5201 - Beban Operasional: sama persis pola-nya kayak Kas & Bank
  // di atas, cuma yang dipecah bukan rekening tapi kategori biaya — ditarik
  // langsung dari kategori yang nempel di baris jurnal (l.category), jadi
  // kategori baru yang ditambah lewat "Kelola Kategori" otomatis kebaca di
  // sini juga begitu ada transaksi pertamanya, nggak perlu setting tambahan.
  const opexCategoryOptions = isOpex ? (() => {
    const set = new Set();
    journalEntries.forEach(e => (e.lines || []).forEach(l => {
      if (l.accountCode === ACC.OPEX && l.category) set.add(l.category);
    }));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  })() : [];

  const handleAccountCodeChange = (code) => {
    setAccountCode(code);
    setSubAccountId('');
  };

  const matchesSubFilter = (l) => {
    if (isKasBank) return !subAccountId || l.accountId === subAccountId;
    if (isOpex) return !subAccountId || l.category === subAccountId;
    return true;
  };

  // Semua baris jurnal yang nyentuh akun terpilih, diurutkan tanggal ASC,
  // dihitung saldo berjalan (running balance) sesuai normalBalance akun
  // (debit-normal: +debit -credit; credit-normal: +credit -debit).
  const rows = journalEntries
    .filter(e => (e.lines || []).some(l => l.accountCode === accountCode && matchesSubFilter(l)))
    .filter(e => {
      const d = (e.date || '').slice(0, 10);
      if (filterStart && d < filterStart) return false;
      if (filterEnd && d > filterEnd) return false;
      return true;
    })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .flatMap(e => (e.lines || [])
      .filter(l => l.accountCode === accountCode && matchesSubFilter(l))
      .map(l => ({
        date: e.date, description: e.description, source: e.source,
        debit: l.debit || 0, credit: l.credit || 0, financialAccountName: l.financialAccountName
      })));

  let running = 0;
  const isDebitNormal = !account || account.normalBalance === 'debit';
  const rowsWithBalance = rows.map(r => {
    running += isDebitNormal ? (r.debit - r.credit) : (r.credit - r.debit);
    return { ...r, balance: running };
  });

  const selectedSubAccountLabel = isKasBank && subAccountId
    ? (kasBankAccountOptions.find(o => o.accountId === subAccountId)?.label || '')
    : (isOpex && subAccountId ? subAccountId : '');

  const handleExportPdf = async () => {
    setGeneratingPdf(true);
    try {
      const docPdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const { cursorY } = await addPdfLetterhead(
        docPdf, companyProfile,
        `BUKU BESAR - ${account?.code || ''} ${account?.name || ''}${selectedSubAccountLabel ? ' — ' + selectedSubAccountLabel : ''}`,
        `Dicetak: ${formatDateDDMMYYYY(new Date().toISOString())}`
      );
      autoTable(docPdf, {
        startY: cursorY + 2,
        margin: { left: 14, right: 14 },
        head: [['Tanggal', 'Deskripsi', 'Debit', 'Kredit', 'Saldo']],
        body: rowsWithBalance.map(r => [
          formatDateDDMMYYYY(r.date), r.description,
          r.debit > 0 ? r.debit.toLocaleString('id-ID') : '-',
          r.credit > 0 ? r.credit.toLocaleString('id-ID') : '-',
          r.balance.toLocaleString('id-ID')
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }
      });
      const fileSuffix = subAccountId ? '-' + (isKasBank ? subAccountId.slice(-6) : subAccountId.replace(/[^a-zA-Z0-9]+/g, '-')) : '';
      docPdf.save(`Buku-Besar-${account?.code || ''}${fileSuffix}-${todayISODate()}.pdf`);
    } catch (err) {
      alert('Gagal membuat PDF Buku Besar: ' + err.message);
    }
    setGeneratingPdf(false);
  };

  return (
    <div className="space-y-3">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex flex-wrap items-end gap-3`}>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Pilih Akun</label>
          <select className={`${styles.inputBg} rounded-lg p-2 text-xs border min-w-[220px]`} value={accountCode} onChange={e => handleAccountCodeChange(e.target.value)}>
            {chartOfAccounts.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
          </select>
        </div>
        {isKasBank && (
          <div>
            <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Rekening</label>
            <select className={`${styles.inputBg} rounded-lg p-2 text-xs border min-w-[220px]`} value={subAccountId} onChange={e => setSubAccountId(e.target.value)}>
              <option value="">Semua Rekening (Digabung)</option>
              {kasBankAccountOptions.map(o => <option key={o.accountId} value={o.accountId}>{o.label}</option>)}
            </select>
          </div>
        )}
        {isOpex && (
          <div>
            <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Kategori</label>
            <select className={`${styles.inputBg} rounded-lg p-2 text-xs border min-w-[220px]`} value={subAccountId} onChange={e => setSubAccountId(e.target.value)}>
              <option value="">Semua Kategori (Digabung)</option>
              {opexCategoryOptions.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Dari Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterStart} onChange={e => setFilterStart(e.target.value)} />
        </div>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Sampai Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterEnd} onChange={e => setFilterEnd(e.target.value)} />
        </div>
        <div className="flex-1" />
        <button onClick={handleExportPdf} disabled={generatingPdf} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-60">
          <Download className="w-3.5 h-3.5" /> {generatingPdf ? 'Membuat...' : 'Export PDF'}
        </button>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={styles.tableHeaderBg}>
              <tr>
                <th className="text-left p-3 font-medium">Tanggal</th>
                <th className="text-left p-3 font-medium">Deskripsi</th>
                <th className="text-right p-3 font-medium">Debit</th>
                <th className="text-right p-3 font-medium">Kredit</th>
                <th className="text-right p-3 font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {rowsWithBalance.length === 0 && (
                <tr><td colSpan={5} className={`p-6 text-center ${styles.textSub}`}>Belum ada mutasi buat akun ini.</td></tr>
              )}
              {rowsWithBalance.map((r, i) => (
                <tr key={i}>
                  <td className="p-3 whitespace-nowrap">{formatDateDDMMYYYY(r.date)}</td>
                  <td className={`p-3 ${styles.textTitle}`}>{r.description}{r.financialAccountName ? ` — ${r.financialAccountName}` : ''}</td>
                  <td className="p-3 text-right">{r.debit > 0 ? formatRp(r.debit) : '-'}</td>
                  <td className="p-3 text-right">{r.credit > 0 ? formatRp(r.credit) : '-'}</td>
                  <td className={`p-3 text-right font-semibold ${styles.textTitle}`}>{formatRp(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            {rowsWithBalance.length > 0 && (
              <tfoot>
                <tr className={styles.tableHeaderBg}>
                  <td colSpan={4} className="p-3 text-right font-bold">Saldo Akhir</td>
                  <td className="p-3 text-right font-bold">{formatRp(rowsWithBalance[rowsWithBalance.length - 1].balance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 3: NERACA (BALANCE SHEET)
// =====================================================================
function BalanceSheetTab({ styles, isDark, journalEntries, chartOfAccounts, financialAccounts, companyProfile, generatingPdf, setGeneratingPdf }) {
  const [asOfDate, setAsOfDate] = useState(todayISODate());

  // Saldo tiap akun s/d tanggal terpilih — jumlahin semua baris jurnal yang
  // tanggalnya <= asOfDate, arah saldo sesuai normalBalance akun.
  const balanceByAccount = {};
  chartOfAccounts.forEach(a => { balanceByAccount[a.code] = 0; });
  // 1101 - Kas & Bank juga dipecah per rekening (accountId di tiap baris
  // jurnal, dari financial_accounts), biar Neraca nggak nge-gabung semua
  // rekening jadi satu angka doang.
  const kasBankByAccountId = {};
  journalEntries
    .filter(e => (e.date || '').slice(0, 10) <= asOfDate)
    .forEach(e => {
      (e.lines || []).forEach(l => {
        const acc = chartOfAccounts.find(a => a.code === l.accountCode);
        if (!acc) return;
        const delta = acc.normalBalance === 'debit' ? (l.debit - l.credit) : (l.credit - l.debit);
        balanceByAccount[l.accountCode] = (balanceByAccount[l.accountCode] || 0) + delta;
        if (l.accountCode === ACC.KAS_BANK) {
          const key = l.accountId || '__tanpa_rekening__';
          if (!kasBankByAccountId[key]) {
            kasBankByAccountId[key] = { accountId: l.accountId || null, accountName: l.financialAccountName || 'Rekening Tanpa Nama', balance: 0 };
          }
          kasBankByAccountId[key].balance += delta;
        }
      });
    });
  // Urutkan ikutin urutan financial_accounts yang masih aktif dulu, baru
  // sisanya (misal rekening yang udah dihapus tapi masih ada histori jurnal).
  const kasBankRows = [
    ...financialAccounts
      .filter(fa => kasBankByAccountId[fa.id])
      .map(fa => ({ ...kasBankByAccountId[fa.id], accountName: describeFinancialAccount(fa, kasBankByAccountId[fa.id].accountName) })),
    ...Object.entries(kasBankByAccountId)
      .filter(([key]) => !financialAccounts.some(fa => fa.id === key))
      .map(([, v]) => v),
  ].filter(r => Math.abs(r.balance) >= 1 || financialAccounts.some(fa => fa.id === r.accountId));
  // Kalau masih ada label yang sama persis (misal dua-duanya emang dikasih
  // nama "Kas & Bank" tanpa bank/no. rekening pembeda), tempelin potongan ID
  // biar tetap bisa dibedain di layar & PDF.
  const labelCount = {};
  kasBankRows.forEach(r => { labelCount[r.accountName] = (labelCount[r.accountName] || 0) + 1; });
  kasBankRows.forEach(r => {
    if (labelCount[r.accountName] > 1 && r.accountId) {
      r.accountName = `${r.accountName} (${r.accountId.slice(-4)})`;
    }
  });

  const byType = {};
  ACCOUNT_TYPE_ORDER.forEach(t => { byType[t] = []; });
  chartOfAccounts.forEach(a => {
    const bal = balanceByAccount[a.code] || 0;
    if (Math.abs(bal) < 1 && !['Aset', 'Liabilitas', 'Ekuitas'].includes(a.type)) return;
    (byType[a.type] || (byType[a.type] = [])).push({ ...a, balance: bal });
  });

  const totalAset = (byType['Aset'] || []).reduce((acc, a) => acc + a.balance, 0);
  const totalLiabilitas = (byType['Liabilitas'] || []).reduce((acc, a) => acc + a.balance, 0);
  // Laba Ditahan berjalan (belum ditutup ke Modal) dihitung dari selisih
  // Pendapatan - Beban s/d tanggal ini, ditambahkan ke Modal/Laba Ditahan
  // biar Neraca tetap balance walau belum ada proses tutup buku periodik.
  const totalPendapatan = (byType['Pendapatan'] || []).reduce((acc, a) => acc + a.balance, 0);
  const totalBeban = (byType['Beban'] || []).reduce((acc, a) => acc + a.balance, 0);
  const labaBerjalan = totalPendapatan - totalBeban;
  const totalEkuitasBase = (byType['Ekuitas'] || []).reduce((acc, a) => acc + a.balance, 0);
  const totalEkuitas = totalEkuitasBase + labaBerjalan;

  const selisih = totalAset - (totalLiabilitas + totalEkuitas);

  const handleExportPdf = async () => {
    setGeneratingPdf(true);
    try {
      const docPdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const { cursorY: tableStartY } = await addPdfLetterhead(
        docPdf, companyProfile, 'NERACA (BALANCE SHEET)', `Per Tanggal: ${formatDateDDMMYYYY(asOfDate)}`
      );

      const assetRows = [];
      (byType['Aset'] || []).forEach(a => {
        assetRows.push([`${a.code} - ${a.name}`, a.balance.toLocaleString('id-ID')]);
        if (a.code === ACC.KAS_BANK) {
          kasBankRows.forEach(r => assetRows.push([`   - ${r.accountName}`, r.balance.toLocaleString('id-ID')]));
        }
      });
      assetRows.push(['TOTAL ASET', totalAset.toLocaleString('id-ID')]);
      autoTable(docPdf, {
        startY: tableStartY, margin: { left: 14, right: 110 },
        head: [['Aset', 'Rp']], body: assetRows,
        styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 1: { halign: 'right' } },
        didParseCell: (d) => { if (d.row.index === assetRows.length - 1) d.cell.styles.fontStyle = 'bold'; }
      });

      const liabRows = (byType['Liabilitas'] || []).map(a => [`${a.code} - ${a.name}`, a.balance.toLocaleString('id-ID')]);
      liabRows.push(['TOTAL LIABILITAS', totalLiabilitas.toLocaleString('id-ID')]);
      const eqRows = [...(byType['Ekuitas'] || []).map(a => [`${a.code} - ${a.name}`, a.balance.toLocaleString('id-ID')]), ['Laba Berjalan', labaBerjalan.toLocaleString('id-ID')], ['TOTAL EKUITAS', totalEkuitas.toLocaleString('id-ID')]];
      autoTable(docPdf, {
        startY: tableStartY, margin: { left: 110, right: 14 },
        head: [['Liabilitas & Ekuitas', 'Rp']], body: [...liabRows, ['', ''], ...eqRows],
        styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 1: { halign: 'right' } }
      });

      const finalY = Math.max(docPdf.lastAutoTable.finalY, tableStartY) + 10;
      docPdf.setFontSize(9);
      docPdf.text(`Selisih Aset vs (Liabilitas + Ekuitas): Rp ${selisih.toLocaleString('id-ID')} ${Math.abs(selisih) < 2 ? '(Balance)' : '(TIDAK BALANCE — cek jurnal)'}`, 14, finalY);

      docPdf.save(`Neraca-WHISys-${asOfDate}.pdf`);
    } catch (err) {
      alert('Gagal membuat PDF Neraca: ' + err.message);
    }
    setGeneratingPdf(false);
  };

  return (
    <div className="space-y-3">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex flex-wrap items-end gap-3`}>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Per Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={asOfDate} onChange={e => setAsOfDate(e.target.value)} />
        </div>
        <div className="flex-1" />
        <button onClick={handleExportPdf} disabled={generatingPdf} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-60">
          <Download className="w-3.5 h-3.5" /> {generatingPdf ? 'Membuat...' : 'Export PDF'}
        </button>
      </div>

      <div className={`rounded-xl p-3 border flex items-center gap-2 text-xs ${Math.abs(selisih) < 2 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-rose-500/10 border-rose-500/30 text-rose-500'}`}>
        <Scale className="w-4 h-4" />
        {Math.abs(selisih) < 2 ? 'Neraca Balance — Total Aset = Total Liabilitas + Ekuitas.' : `Neraca TIDAK Balance — selisih ${formatRp(selisih)}. Cek jurnal (kemungkinan ada input yang belum lewat mekanisme auto-jurnal).`}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Aset</h3>
          <table className="w-full text-xs">
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {(byType['Aset'] || []).map(a => (
                a.code === ACC.KAS_BANK ? (
                  <React.Fragment key={a.code}>
                    <tr>
                      <td className={`p-3 font-semibold ${styles.textTitle}`}>{a.code} - {a.name}</td>
                      <td className={`p-3 text-right font-semibold ${styles.textTitle}`}>{formatRp(a.balance)}</td>
                    </tr>
                    {kasBankRows.map(r => (
                      <tr key={r.accountId || r.accountName}>
                        <td className={`p-3 pl-6 text-[11px] ${styles.textSub}`}>— {r.accountName}</td>
                        <td className={`p-3 text-right text-[11px] ${styles.textSub}`}>{formatRp(r.balance)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ) : (
                  <tr key={a.code}>
                    <td className={`p-3 ${styles.textSub}`}>{a.code} - {a.name}</td>
                    <td className={`p-3 text-right ${styles.textTitle}`}>{formatRp(a.balance)}</td>
                  </tr>
                )
              ))}
            </tbody>
            <tfoot>
              <tr className={styles.tableHeaderBg}>
                <td className="p-3 font-bold">Total Aset</td>
                <td className="p-3 text-right font-bold">{formatRp(totalAset)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Liabilitas & Ekuitas</h3>
          <table className="w-full text-xs">
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {(byType['Liabilitas'] || []).map(a => (
                <tr key={a.code}>
                  <td className={`p-3 ${styles.textSub}`}>{a.code} - {a.name}</td>
                  <td className={`p-3 text-right ${styles.textTitle}`}>{formatRp(a.balance)}</td>
                </tr>
              ))}
              <tr>
                <td className={`p-3 font-semibold ${styles.textTitle}`}>Total Liabilitas</td>
                <td className={`p-3 text-right font-semibold ${styles.textTitle}`}>{formatRp(totalLiabilitas)}</td>
              </tr>
              {(byType['Ekuitas'] || []).map(a => (
                <tr key={a.code}>
                  <td className={`p-3 ${styles.textSub}`}>{a.code} - {a.name}</td>
                  <td className={`p-3 text-right ${styles.textTitle}`}>{formatRp(a.balance)}</td>
                </tr>
              ))}
              <tr>
                <td className={`p-3 ${styles.textSub}`}>Laba Berjalan (Pendapatan - Beban)</td>
                <td className={`p-3 text-right ${styles.textTitle}`}>{formatRp(labaBerjalan)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className={styles.tableHeaderBg}>
                <td className="p-3 font-bold">Total Ekuitas</td>
                <td className="p-3 text-right font-bold">{formatRp(totalEkuitas)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 4: ARUS KAS
// =====================================================================
function CashFlowTab({ styles, isDark, journalEntries, financialAccounts }) {
  // Semua baris jurnal yang nyentuh akun 1101 Kas & Bank, dikelompokkan per
  // bulan (kas masuk = debit, kas keluar = credit) & per source.
  const cashLines = [];
  journalEntries.forEach(e => {
    (e.lines || []).filter(l => l.accountCode === ACC.KAS_BANK).forEach(l => {
      cashLines.push({ period: getPeriodKey(e.date), source: e.source, debit: l.debit || 0, credit: l.credit || 0, date: e.date, description: e.description });
    });
  });

  const byPeriod = {};
  cashLines.forEach(l => {
    if (!byPeriod[l.period]) byPeriod[l.period] = { masuk: 0, keluar: 0, bySource: {} };
    byPeriod[l.period].masuk += l.debit;
    byPeriod[l.period].keluar += l.credit;
    if (!byPeriod[l.period].bySource[l.source]) byPeriod[l.period].bySource[l.source] = { masuk: 0, keluar: 0 };
    byPeriod[l.period].bySource[l.source].masuk += l.debit;
    byPeriod[l.period].bySource[l.source].keluar += l.credit;
  });

  const periods = Object.keys(byPeriod).sort().reverse();
  const [expandedPeriods, setExpandedPeriods] = useState([]);
  const togglePeriod = (p) => setExpandedPeriods(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const totalMasuk = cashLines.reduce((acc, l) => acc + l.debit, 0);
  const totalKeluar = cashLines.reduce((acc, l) => acc + l.credit, 0);
  const netKasJurnal = totalMasuk - totalKeluar;
  const totalSaldoAkunSaatIni = financialAccounts.reduce((acc, a) => acc + (Number(a.balance) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Total Kas Masuk</p>
          <p className="text-lg font-bold text-emerald-500">{formatRp(totalMasuk)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Total Kas Keluar</p>
          <p className="text-lg font-bold text-rose-500">{formatRp(totalKeluar)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Kas Bersih (dari Jurnal)</p>
          <p className={`text-lg font-bold ${styles.textTitle}`}>{formatRp(netKasJurnal)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Saldo Kas/Bank Saat Ini (Rekonsiliasi)</p>
          <p className={`text-lg font-bold ${Math.abs(netKasJurnal - totalSaldoAkunSaatIni) < 2 ? 'text-emerald-500' : 'text-amber-500'}`}>{formatRp(totalSaldoAkunSaatIni)}</p>
          {Math.abs(netKasJurnal - totalSaldoAkunSaatIni) >= 2 && (
            <p className="text-[10px] text-amber-500 mt-1">Beda dgn Kas Bersih Jurnal (mungkin ada saldo awal/mutasi manual di luar jurnal).</p>
          )}
        </div>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={styles.tableHeaderBg}>
              <tr>
                <th className="text-left p-3 font-medium">Periode</th>
                <th className="text-right p-3 font-medium">Kas Masuk</th>
                <th className="text-right p-3 font-medium">Kas Keluar</th>
                <th className="text-right p-3 font-medium">Kas Bersih</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {periods.length === 0 && (
                <tr><td colSpan={5} className={`p-6 text-center ${styles.textSub}`}>Belum ada mutasi Kas & Bank.</td></tr>
              )}
              {periods.map(p => (
                <React.Fragment key={p}>
                  <tr className={`cursor-pointer ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`} onClick={() => togglePeriod(p)}>
                    <td className={`p-3 font-medium ${styles.textTitle}`}>{formatPeriodLabel(p)}</td>
                    <td className="p-3 text-right text-emerald-500">{formatRp(byPeriod[p].masuk)}</td>
                    <td className="p-3 text-right text-rose-500">{formatRp(byPeriod[p].keluar)}</td>
                    <td className={`p-3 text-right font-semibold ${styles.textTitle}`}>{formatRp(byPeriod[p].masuk - byPeriod[p].keluar)}</td>
                    <td className="p-3 text-right">{expandedPeriods.includes(p) ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}</td>
                  </tr>
                  {expandedPeriods.includes(p) && (
                    <tr>
                      <td colSpan={5} className={`p-0 ${styles.innerBg}`}>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className={styles.textSub}>
                              <th className="text-left px-6 py-1.5 font-medium">Sumber</th>
                              <th className="text-right px-6 py-1.5 font-medium">Masuk</th>
                              <th className="text-right px-6 py-1.5 font-medium">Keluar</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(byPeriod[p].bySource).map(([src, v]) => (
                              <tr key={src}>
                                <td className={`px-6 py-1 ${styles.textTitle}`}>{src}</td>
                                <td className="px-6 py-1 text-right">{v.masuk > 0 ? formatRp(v.masuk) : '-'}</td>
                                <td className="px-6 py-1 text-right">{v.keluar > 0 ? formatRp(v.keluar) : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 5: PIUTANG & HUTANG (AR/AP AGING)
// =====================================================================
function ArApTab({ styles, isDark, bookingsList, vendorBills, vendorsList }) {
  const today = todayISODate();

  // Piutang Jamaah — booking aktif dgn totalAmount > totalPaid, umur
  // dihitung dari tanggal booking dibuat (createdAt).
  const arList = bookingsList
    .filter(b => (b.status || 'active') === 'active')
    .map(b => ({ ...b, outstanding: Math.max(0, Number(b.totalAmount || 0) - Number(b.totalPaid || 0)) }))
    .filter(b => b.outstanding > 0)
    .map(b => ({ ...b, days: daysBetween(b.createdAt, today) }))
    .map(b => ({ ...b, bucket: bucketFor(b.days) }));

  // Hutang Vendor — dari vendor_bills status unpaid/partial, umur dari
  // dueDate (kalau ada) fallback billDate.
  const apList = vendorBills
    .filter(b => b.status !== 'paid')
    .map(b => ({ ...b, outstanding: Math.max(0, Number(b.amount || 0) - Number(b.amountPaid || 0)) }))
    .filter(b => b.outstanding > 0)
    .map(b => ({ ...b, days: daysBetween(b.dueDate || b.billDate, today) }))
    .map(b => ({ ...b, bucket: bucketFor(Math.max(0, b.days)) }));

  const arByBucket = {};
  AGING_BUCKETS.forEach(bk => { arByBucket[bk.key] = 0; });
  arList.forEach(b => { arByBucket[b.bucket.key] += b.outstanding; });
  const totalAr = arList.reduce((acc, b) => acc + b.outstanding, 0);

  const apByBucket = {};
  AGING_BUCKETS.forEach(bk => { apByBucket[bk.key] = 0; });
  apList.forEach(b => { apByBucket[b.bucket.key] += b.outstanding; });
  const totalAp = apList.reduce((acc, b) => acc + b.outstanding, 0);

  const vendorDepositPositive = vendorsList.filter(v => Number(v.depositBalance || 0) > 0);
  const totalVendorDeposit = vendorDepositPositive.reduce((acc, v) => acc + Number(v.depositBalance || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Total Piutang Jamaah</p>
          <p className="text-lg font-bold text-amber-500">{formatRp(totalAr)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Total Hutang Vendor</p>
          <p className="text-lg font-bold text-rose-500">{formatRp(totalAp)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Piutang Deposit Vendor (Kredit ke Kita)</p>
          <p className="text-lg font-bold text-emerald-500">{formatRp(totalVendorDeposit)}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {/* ---- Piutang Jamaah ---- */}
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Piutang Jamaah (AR)</h3>
          <div className={`grid grid-cols-4 divide-x ${isDark ? 'divide-slate-800' : 'divide-slate-200'} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} text-[10.5px]`}>
            {AGING_BUCKETS.map(bk => (
              <div key={bk.key} className="p-2 text-center">
                <p className={styles.textSub}>{bk.label}</p>
                <p className={`font-semibold ${styles.textTitle}`}>{formatRp(arByBucket[bk.key])}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className={styles.tableHeaderBg}>
                <tr>
                  <th className="text-left p-2.5 font-medium">Booking</th>
                  <th className="text-left p-2.5 font-medium">Jamaah</th>
                  <th className="text-right p-2.5 font-medium">Sisa</th>
                  <th className="text-right p-2.5 font-medium">Umur</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {arList.length === 0 && (
                  <tr><td colSpan={4} className={`p-4 text-center ${styles.textSub}`}>Tidak ada piutang jamaah outstanding.</td></tr>
                )}
                {arList.sort((a, b) => b.outstanding - a.outstanding).map(b => (
                  <tr key={b.id}>
                    <td className={`p-2.5 ${styles.textSub}`}>{b.bookingCode}</td>
                    <td className={`p-2.5 ${styles.textTitle}`}>{b.jamaahName}</td>
                    <td className="p-2.5 text-right text-amber-500 font-medium">{formatRp(b.outstanding)}</td>
                    <td className={`p-2.5 text-right ${styles.textSub}`}>{b.days}h ({b.bucket.label})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ---- Hutang Vendor ---- */}
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Hutang Vendor (AP)</h3>
          <div className={`grid grid-cols-4 divide-x ${isDark ? 'divide-slate-800' : 'divide-slate-200'} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} text-[10.5px]`}>
            {AGING_BUCKETS.map(bk => (
              <div key={bk.key} className="p-2 text-center">
                <p className={styles.textSub}>{bk.label}</p>
                <p className={`font-semibold ${styles.textTitle}`}>{formatRp(apByBucket[bk.key])}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className={styles.tableHeaderBg}>
                <tr>
                  <th className="text-left p-2.5 font-medium">Vendor</th>
                  <th className="text-left p-2.5 font-medium">No. Tagihan</th>
                  <th className="text-right p-2.5 font-medium">Sisa</th>
                  <th className="text-right p-2.5 font-medium">Umur</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {apList.length === 0 && (
                  <tr><td colSpan={4} className={`p-4 text-center ${styles.textSub}`}>Tidak ada hutang vendor outstanding.</td></tr>
                )}
                {apList.sort((a, b) => b.outstanding - a.outstanding).map(b => (
                  <tr key={b.id}>
                    <td className={`p-2.5 ${styles.textTitle}`}>{b.vendorName}</td>
                    <td className={`p-2.5 ${styles.textSub}`}>{b.billNumber || '-'}</td>
                    <td className="p-2.5 text-right text-rose-500 font-medium">{formatRp(b.outstanding)}</td>
                    <td className={`p-2.5 text-right ${styles.textSub}`}>{Math.max(0, b.days)}h ({b.bucket.label})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {vendorDepositPositive.length > 0 && (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Piutang Deposit Vendor (Saldo Kredit ke Kita)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={styles.tableHeaderBg}>
                <tr>
                  <th className="text-left p-2.5 font-medium">Vendor</th>
                  <th className="text-right p-2.5 font-medium">Saldo Deposit</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {vendorDepositPositive.map(v => (
                  <tr key={v.id}>
                    <td className={`p-2.5 ${styles.textTitle}`}>{v.name}</td>
                    <td className="p-2.5 text-right text-emerald-500 font-medium">{formatRp(v.depositBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB 6: LABA RUGI (P&L) — dipindah dari FinanceModule.jsx tab "Laporan"
// =====================================================================
function ProfitLossTab({ styles, isDark, currentUser, transactions, vendorPayments: allVendorPayments, operationalExpenses, packagesList, onRefresh }) {
  // Pembayaran vendor yang udah dikonversi ke Saldo Deposit Vendor (DP batal
  // tapi nggak hangus, kayak tiket block-seat yang di-roll-over ke
  // keberangkatan berikutnya) SUDAH diakui HPP/selisihnya sendiri secara
  // LANGSUNG pas konversi terjadi (lihat postVendorDepositConversion di
  // journal.js, dipanggil dari handleConvertSubmit FinanceModule.jsx) —
  // makanya dikeluarkan dari SEMUA perhitungan HPP/Biaya Dibayar Dimuka
  // "live" di tab ini (Akui Pendapatan, tabel Margin per Paket, dst), biar
  // nggak kehitung dobel pas paketnya diklik Akui Pendapatan.
  const vendorPayments = allVendorPayments.filter(vp => !vp.convertedToDeposit);
  const [plPeriod, setPlPeriod] = useState('all');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [companyProfile, setCompanyProfile] = useState(DEFAULT_COMPANY_PROFILE);

  const [showRecognizeModal, setShowRecognizeModal] = useState(false);
  const [pkgToRecognize, setPkgToRecognize] = useState(null);
  const [recognizeDateInput, setRecognizeDateInput] = useState(todayISODate());

  const [showProfitDetailModal, setShowProfitDetailModal] = useState(false);
  const [selectedPackageForDetail, setSelectedPackageForDetail] = useState(null);

  const [showOpexBreakdown, setShowOpexBreakdown] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const profileSnap = await getDoc(doc(db, 'settings', 'company_profile'));
        if (profileSnap.exists() && profileSnap.data().company) {
          setCompanyProfile({ ...DEFAULT_COMPANY_PROFILE, ...profileSnap.data().company });
        }
      } catch (err) {
        console.error('Gagal memuat profil perusahaan:', err);
      }
    })();
  }, []);

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
  const isIncomeRecognized = (tx) => {
    const pkg = findPackageForIncome(tx);
    return pkg ? !!pkg.revenueRecognized : true;
  };
  const isVendorRecognized = (vp) => {
    const pkg = findPackageForVendor(vp);
    return pkg ? !!pkg.revenueRecognized : true;
  };
  const recognizedPeriodForIncome = (tx) => {
    const pkg = findPackageForIncome(tx);
    return pkg?.recognizedAt ? getPeriodKey(pkg.recognizedAt) : getPeriodKey(tx.createdAt);
  };
  const recognizedPeriodForVendor = (vp) => {
    const pkg = findPackageForVendor(vp);
    return pkg?.recognizedAt ? getPeriodKey(pkg.recognizedAt) : getPeriodKey(vp.createdAt);
  };

  const recognizedTransactions = transactions.filter(isIncomeRecognized);
  const recognizedVendorPayments = vendorPayments.filter(isVendorRecognized);
  const unrecognizedTransactions = transactions.filter(tx => !isIncomeRecognized(tx));
  const unrecognizedVendorPayments = vendorPayments.filter(vp => !isVendorRecognized(vp));

  const totalDeferredRevenue = unrecognizedTransactions.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalPrepaidExpense = unrecognizedVendorPayments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

  const availablePeriods = Array.from(new Set([
    ...recognizedTransactions.map(recognizedPeriodForIncome),
    ...recognizedVendorPayments.map(recognizedPeriodForVendor),
    ...operationalExpenses.map(op => getPeriodKey(op.expenseDate || op.createdAt))
  ].filter(Boolean))).sort().reverse();

  const incomeInPeriod = plPeriod === 'all'
    ? recognizedTransactions
    : recognizedTransactions.filter(tx => recognizedPeriodForIncome(tx) === plPeriod);
  const vendorInPeriod = plPeriod === 'all'
    ? recognizedVendorPayments
    : recognizedVendorPayments.filter(vp => recognizedPeriodForVendor(vp) === plPeriod);
  const operationalInPeriod = plPeriod === 'all'
    ? operationalExpenses
    : operationalExpenses.filter(op => getPeriodKey(op.expenseDate || op.createdAt) === plPeriod);

  const plOmset = incomeInPeriod.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const plPpnBreakdown = incomeInPeriod.reduce((acc, curr) => {
    const { dpp, ppn } = calculatePPN(curr.amount);
    acc.dpp += dpp;
    acc.ppn += ppn;
    return acc;
  }, { dpp: 0, ppn: 0 });
  const plTotalDpp = plPpnBreakdown.dpp;
  const plTotalPpn = plPpnBreakdown.ppn;
  const plHpp = vendorInPeriod.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  // Laba Kotor/Bersih WAJIB dihitung dari plTotalDpp (Omset BERSIH tanpa
  // PPN), BUKAN plOmset (yang masih termasuk PPN 1,1% titipan negara) —
  // PPN itu utang ke kantor pajak, bukan pendapatan perusahaan. Pola ini
  // NYAMBUNG sama jurnal ganda (postRevenueRecognition di journal.js
  // misahin DPP ke akun 4101 Pendapatan, PPN-nya ke 2401 PPN Keluaran
  // yang liabilitas) — kalau Laba Kotor/Bersih di sini masih pakai
  // Omset ber-PPN, angkanya bakal SELALU lebih besar drpd Laba Berjalan
  // di Neraca (beda sebesar total PPN periode itu), bikin 2 laporan yang
  // harusnya nyambung malah beda sendiri-sendiri.
  const plLabaKotor = plTotalDpp - plHpp;
  const plOpex = operationalInPeriod.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const plLabaBersih = plLabaKotor - plOpex;

  // Breakdown Beban Operasional per kategori (Gaji, Sewa, Marketing, dst),
  // ngikutin periode yang lagi difilter — biar keliatan abis di mana aja,
  // bukan cuma 1 angka gede doang. Diurutin dari yang paling gede.
  const plOpexByCategory = Object.values(
    operationalInPeriod.reduce((acc, curr) => {
      const key = curr.category || 'Tanpa Kategori';
      if (!acc[key]) acc[key] = { category: key, total: 0, count: 0 };
      acc[key].total += Number(curr.amount) || 0;
      acc[key].count += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  const selectedPkgIncomes = selectedPackageForDetail
    ? transactions.filter(tx => tx.packageId === selectedPackageForDetail.id || (!tx.packageId && tx.packageName === selectedPackageForDetail.name))
    : [];
  const selectedPkgVendorCosts = selectedPackageForDetail
    ? vendorPayments.filter(vp => vp.packageId === selectedPackageForDetail.id || (!vp.packageId && vp.packageName === selectedPackageForDetail.name))
    : [];
  const totalSelectedPkgIncome = selectedPkgIncomes.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalSelectedPkgVendorCost = selectedPkgVendorCosts.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const selectedPkgProfit = totalSelectedPkgIncome - totalSelectedPkgVendorCost;

  const recognizedPackagesInPeriod = packagesList.filter(pkg => {
    if (!pkg.revenueRecognized) return false;
    if (plPeriod === 'all') return true;
    return getPeriodKey(pkg.recognizedAt) === plPeriod;
  }).map(pkg => {
    const pkgIncome = transactions
      .filter(tx => tx.packageId === pkg.id || (!tx.packageId && tx.packageName === pkg.name))
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const pkgVendorCost = vendorPayments
      .filter(vp => vp.packageId === pkg.id || (!vp.packageId && vp.packageName === pkg.name))
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    return { pkg, pkgIncome, pkgVendorCost, profit: pkgIncome - pkgVendorCost };
  });

  // Tabel "Analisis Margin per Program Paket" ikut kefilter plPeriod yang sama kayak
  // ringkasan Laba Rugi di atasnya, biar nggak numpuk semua paket dari awal berdiri.
  // Paket yang BELUM diakui pendapatannya tetap selalu keliatan di semua periode —
  // itu masih jadi action item ("Akui Pendapatan") yang belum kelar, jadi jangan
  // sampai ke-hide cuma gara-gara beda periode.
  const marginTablePackages = packagesList.filter(pkg => {
    if (!pkg.revenueRecognized) return true;
    if (plPeriod === 'all') return true;
    return getPeriodKey(pkg.recognizedAt) === plPeriod;
  });

  const openRecognizeModal = (pkg) => {
    const parsedDeparture = pkg.departureDate ? new Date(pkg.departureDate) : null;
    const defaultDate = parsedDeparture && !isNaN(parsedDeparture.getTime())
      ? parsedDeparture.toISOString().slice(0, 10)
      : todayISODate();
    setPkgToRecognize(pkg);
    setRecognizeDateInput(defaultDate);
    setShowRecognizeModal(true);
  };

  const handleConfirmRecognizeRevenue = async (e) => {
    e.preventDefault();
    if (!pkgToRecognize) return;
    try {
      const isoDate = new Date(recognizeDateInput).toISOString();
      const incomeTotal = transactions
        .filter(tx => (tx.packageId ? tx.packageId === pkgToRecognize.id : tx.packageName === pkgToRecognize.name))
        .reduce((acc, tx) => acc + (Number(tx.amount) || 0), 0);
      const vendorTotal = vendorPayments
        .filter(vp => (vp.packageId ? vp.packageId === pkgToRecognize.id : vp.packageName === pkgToRecognize.name))
        .reduce((acc, vp) => acc + (Number(vp.amount) || 0), 0);

      await updateDoc(doc(db, 'packages', pkgToRecognize.id), { revenueRecognized: true, recognizedAt: isoDate });
      await postRevenueRecognition({
        packageId: pkgToRecognize.id, packageName: pkgToRecognize.name, incomeTotal, vendorTotal,
        date: isoDate, createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
      }).catch(err => console.error('Gagal posting jurnal akui pendapatan:', err));
      await onRefresh();
      setSelectedPackageForDetail(prev => prev && prev.id === pkgToRecognize.id ? { ...prev, revenueRecognized: true, recognizedAt: isoDate } : prev);
      setShowRecognizeModal(false);
      setPkgToRecognize(null);
    } catch (err) {
      alert('Gagal mengakui pendapatan: ' + err.message);
    }
  };

  const handleUnrecognizeRevenue = async (pkg) => {
    if (!confirm(`Batalkan pengakuan pendapatan untuk paket "${pkg.name}"? Omset & HPP paket ini akan kembali berstatus Diterima/Dibayar Dimuka dan keluar dari Laporan P&L.`)) return;
    try {
      const incomeTotal = transactions
        .filter(tx => (tx.packageId ? tx.packageId === pkg.id : tx.packageName === pkg.name))
        .reduce((acc, tx) => acc + (Number(tx.amount) || 0), 0);
      const vendorTotal = vendorPayments
        .filter(vp => (vp.packageId ? vp.packageId === pkg.id : vp.packageName === pkg.name))
        .reduce((acc, vp) => acc + (Number(vp.amount) || 0), 0);

      await updateDoc(doc(db, 'packages', pkg.id), { revenueRecognized: false, recognizedAt: null });
      await postRevenueUnrecognition({
        packageId: pkg.id, packageName: pkg.name, incomeTotal, vendorTotal,
        date: new Date().toISOString(), createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
      }).catch(err => console.error('Gagal posting jurnal batal pengakuan pendapatan:', err));
      await onRefresh();
      setSelectedPackageForDetail(prev => prev && prev.id === pkg.id ? { ...prev, revenueRecognized: false, recognizedAt: null } : prev);
    } catch (err) {
      alert('Gagal membatalkan pengakuan pendapatan: ' + err.message);
    }
  };

  const handleDownloadProfitLossPDF = async () => {
    setGeneratingPdf(true);
    try {
      const docPdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageWidth = docPdf.internal.pageSize.getWidth();
      const marginX = 14;
      let cursorY = 16;

      try {
        const logoDataUrl = await loadImageAsDataURL('/logo.png');
        docPdf.addImage(logoDataUrl, 'PNG', marginX, cursorY - 4, 18, 18);
      } catch (err) {
        console.warn('Logo tidak berhasil dimuat untuk PDF:', err);
      }

      const textStartX = marginX + 22;
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(13);
      docPdf.text(companyProfile.name || DEFAULT_COMPANY_PROFILE.name, textStartX, cursorY);

      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(8.5);
      let subY = cursorY + 5;
      if (companyProfile.ppiuNumber) {
        docPdf.text(companyProfile.ppiuNumber, textStartX, subY);
        subY += 4;
      }
      if (companyProfile.address) {
        docPdf.text(companyProfile.address, textStartX, subY, { maxWidth: pageWidth - textStartX - marginX });
        subY += 4;
      }
      const contactLine = [companyProfile.phone, companyProfile.email].filter(Boolean).join('  •  ');
      if (contactLine) {
        docPdf.text(contactLine, textStartX, subY);
        subY += 4;
      }

      cursorY = Math.max(cursorY + 18, subY) + 2;
      docPdf.setDrawColor(180);
      docPdf.line(marginX, cursorY, pageWidth - marginX, cursorY);
      cursorY += 8;

      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(12);
      docPdf.text('LAPORAN LABA RUGI (PROFIT & LOSS)', pageWidth / 2, cursorY, { align: 'center' });
      cursorY += 6;
      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(9);
      docPdf.text(`Periode: ${formatPeriodLabel(plPeriod)}`, pageWidth / 2, cursorY, { align: 'center' });
      cursorY += 4.5;
      docPdf.setFontSize(8);
      docPdf.setTextColor(120);
      docPdf.text(`Dicetak: ${formatDateDDMMYYYY(new Date().toISOString())}`, pageWidth / 2, cursorY, { align: 'center' });
      docPdf.setTextColor(0);
      cursorY += 8;

      autoTable(docPdf, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Komponen', 'Nominal (Rp)']],
        body: [
          ['Omset Kotor (Pendapatan Diakui, termasuk PPN)', plOmset.toLocaleString('id-ID')],
          ['PPN Keluaran (titipan negara, BUKAN pendapatan)', `(${plTotalPpn.toLocaleString('id-ID')})`],
          ['Omset Bersih (DPP)', plTotalDpp.toLocaleString('id-ID')],
          ['HPP / Biaya Vendor', `(${plHpp.toLocaleString('id-ID')})`],
          ['Laba Kotor', plLabaKotor.toLocaleString('id-ID')],
          ['Biaya Operasional Kantor', `(${plOpex.toLocaleString('id-ID')})`],
          ['Laba Bersih', plLabaBersih.toLocaleString('id-ID')],
        ],
        styles: { fontSize: 9, cellPadding: 2.5 },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 1: { halign: 'right' } },
        didParseCell: (data) => {
          if (data.row.index === 6 && data.section === 'body') {
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });

      cursorY = docPdf.lastAutoTable.finalY + 8;

      if (plOpexByCategory.length > 0) {
        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(10);
        docPdf.text('Rincian Biaya Operasional per Kategori', marginX, cursorY);
        cursorY += 3;
        autoTable(docPdf, {
          startY: cursorY,
          margin: { left: marginX, right: marginX },
          head: [['Kategori', 'Jumlah Transaksi', 'Nominal (Rp)', '% dari Total']],
          body: plOpexByCategory.map(c => [
            c.category, `${c.count}x`, c.total.toLocaleString('id-ID'),
            plOpex > 0 ? `${((c.total / plOpex) * 100).toFixed(1)}%` : '-'
          ]),
          styles: { fontSize: 8.5, cellPadding: 2 },
          headStyles: { fillColor: [15, 23, 42] },
          columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
        });
        cursorY = docPdf.lastAutoTable.finalY + 8;
      }

      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(10);
      docPdf.text('Rincian Margin per Paket (Pendapatan Sudah Diakui)', marginX, cursorY);
      cursorY += 4;

      if (recognizedPackagesInPeriod.length === 0) {
        docPdf.setFont('helvetica', 'italic');
        docPdf.setFontSize(9);
        docPdf.text('Belum ada paket dengan pendapatan diakui pada periode ini.', marginX, cursorY + 4);
        cursorY += 10;
      } else {
        autoTable(docPdf, {
          startY: cursorY + 2,
          margin: { left: marginX, right: marginX },
          head: [['Nama Paket', 'Omset', 'HPP Vendor', 'Laba/Margin']],
          body: recognizedPackagesInPeriod.map(({ pkg, pkgIncome, pkgVendorCost, profit }) => [
            `${pkg.name}${pkg.code ? ` (${pkg.code})` : ''}`,
            pkgIncome.toLocaleString('id-ID'),
            pkgVendorCost.toLocaleString('id-ID'),
            profit.toLocaleString('id-ID')
          ]),
          styles: { fontSize: 8.5, cellPadding: 2.5 },
          headStyles: { fillColor: [15, 23, 42] },
          columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
        });
        cursorY = docPdf.lastAutoTable.finalY + 10;
      }

      if (cursorY > 250) {
        docPdf.addPage();
        cursorY = 20;
      }
      const signColWidth = (pageWidth - marginX * 2) / 2;
      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(9);
      docPdf.text('Dibuat oleh,', marginX, cursorY);
      docPdf.text('Mengetahui,', marginX + signColWidth, cursorY);
      cursorY += 22;
      docPdf.text('( ______________________ )', marginX, cursorY);
      docPdf.text('( ______________________ )', marginX + signColWidth, cursorY);
      cursorY += 4.5;
      docPdf.setFontSize(8);
      docPdf.setTextColor(120);
      docPdf.text('Finance / Admin', marginX, cursorY);
      docPdf.text('Direktur', marginX + signColWidth, cursorY);
      docPdf.setTextColor(0);

      const fileSuffix = plPeriod === 'all' ? 'semua-periode' : plPeriod;
      docPdf.save(`Laporan-Laba-Rugi-WHISys-${fileSuffix}.pdf`);
    } catch (err) {
      console.error('Gagal membuat PDF laporan:', err);
      alert('Gagal membuat PDF laporan: ' + err.message);
    }
    setGeneratingPdf(false);
  };

  return (
    <div className="space-y-4">
      <div className={`${styles.cardBg} border rounded-xl overflow-hidden p-4`}>
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-4">
          <div>
            <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
              <TrendingUp className="w-4 h-4 text-amber-500" /> Laporan Laba Rugi (P&L) Perusahaan
            </h4>
            <p className={`text-xs ${styles.textSub} mt-1`}>
              Omset seluruh jamaah dikurangi HPP vendor dan biaya operasional kantor — {formatPeriodLabel(plPeriod)}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className={`${styles.inputBg} rounded-lg p-2 text-xs border`}
              value={plPeriod}
              onChange={e => setPlPeriod(e.target.value)}
            >
              <option value="all">Semua Periode</option>
              {availablePeriods.map(p => (
                <option key={p} value={p}>{formatPeriodLabel(p)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleDownloadProfitLossPDF}
              disabled={generatingPdf}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" /> {generatingPdf ? 'Membuat PDF...' : 'Download Laporan (PDF)'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
            <span className={`text-[10px] ${styles.textSub} uppercase`}>Omset Kotor (termasuk PPN)</span>
            <p className="text-sm font-bold text-emerald-500 mt-1">Rp {plOmset.toLocaleString('id-ID')}</p>
          </div>
          <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
            <span className={`text-[10px] ${styles.textSub} uppercase`}>HPP Vendor</span>
            <p className="text-sm font-bold text-rose-500 mt-1">Rp {plHpp.toLocaleString('id-ID')}</p>
          </div>
          <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
            <span className={`text-[10px] ${styles.textSub} uppercase`}>Laba Kotor</span>
            <p className={`text-sm font-bold mt-1 ${plLabaKotor >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>Rp {plLabaKotor.toLocaleString('id-ID')}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowOpexBreakdown(v => !v)}
            className={`${styles.innerBg} p-3 rounded-lg border text-center hover:opacity-80 transition-opacity`}
          >
            <span className={`text-[10px] ${styles.textSub} uppercase flex items-center justify-center gap-1`}>
              Biaya Operasional {showOpexBreakdown ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
            <p className="text-sm font-bold text-amber-500 mt-1">Rp {plOpex.toLocaleString('id-ID')}</p>
          </button>
          <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
            <span className={`text-[10px] ${styles.textSub} uppercase`}>Laba Bersih</span>
            <p className={`text-sm font-bold mt-1 ${plLabaBersih >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>Rp {plLabaBersih.toLocaleString('id-ID')}</p>
          </div>
        </div>

        {showOpexBreakdown && (
          <div className={`mb-6 -mt-3 rounded-lg border overflow-hidden ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            <div className={`px-3 py-2 text-[10.5px] font-semibold ${styles.tableHeaderBg}`}>
              Rincian Biaya Operasional per Kategori — {formatPeriodLabel(plPeriod)}
            </div>
            {plOpexByCategory.length === 0 ? (
              <p className={`p-3 text-[11px] ${styles.textSub}`}>Nggak ada biaya operasional di periode ini.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody className={`divide-y ${styles.tableRowBorder}`}>
                  {plOpexByCategory.map(c => (
                    <tr key={c.category}>
                      <td className={`p-2.5 ${styles.textSub}`}>{c.category} <span className="text-[10px] opacity-70">({c.count}x)</span></td>
                      <td className={`p-2.5 text-right ${styles.textTitle}`}>Rp {c.total.toLocaleString('id-ID')}</td>
                      <td className={`p-2.5 text-right w-16 ${styles.textSub}`}>{plOpex > 0 ? `${((c.total / plOpex) * 100).toFixed(1)}%` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={styles.tableHeaderBg}>
                    <td className="p-2.5 font-bold">Total Biaya Operasional</td>
                    <td className="p-2.5 text-right font-bold">Rp {plOpex.toLocaleString('id-ID')}</td>
                    <td className="p-2.5 text-right font-bold">100%</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}

        <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg border ${isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
            <p className={`text-[11px] ${styles.textSub}`}>
              <span className={`font-bold ${styles.textTitle}`}>Pendapatan Diterima Dimuka: Rp {totalDeferredRevenue.toLocaleString('id-ID')}</span><br/>
              Setoran jamaah yang paketnya belum diklik "Akui Pendapatan" — belum masuk P&L.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
            <p className={`text-[11px] ${styles.textSub}`}>
              <span className={`font-bold ${styles.textTitle}`}>Biaya Dibayar Dimuka: Rp {totalPrepaidExpense.toLocaleString('id-ID')}</span><br/>
              Pembayaran vendor yang paketnya belum diklik "Akui Pendapatan" — belum masuk P&L.
            </p>
          </div>
        </div>

        <div className={`mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border ${isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'}`}>
          <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
            <span className={`text-[10px] ${styles.textSub} uppercase`}>DPP Total (Periode Ini)</span>
            <p className="text-sm font-bold text-blue-500 mt-1">Rp {plTotalDpp.toLocaleString('id-ID')}</p>
          </div>
          <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
            <span className={`text-[10px] ${styles.textSub} uppercase`}>PPN Terutang (1,1%)</span>
            <p className="text-sm font-bold text-amber-500 mt-1">Rp {plTotalPpn.toLocaleString('id-ID')}</p>
          </div>
          <div className="sm:col-span-2 flex items-start gap-2">
            <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <p className={`text-[11px] ${styles.textSub}`}>
              <span className={`font-bold ${styles.textTitle}`}>Rekap PPN (Setoran Pajak) — {formatPeriodLabel(plPeriod)}.</span><br/>
              Estimasi PPN yang sudah termasuk di setiap harga jual jamaah pada periode ini — perlu disetorkan sesuai skema PPN Besaran Tertentu Biro Perjalanan Wisata (PMK 71/2022).
            </p>
          </div>
        </div>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden p-4`}>
        <h4 className={`text-sm font-bold ${styles.textTitle} mb-2 flex items-center gap-2`}>
          <BarChart3 className="w-4 h-4 text-amber-500" /> Analisis Margin Laba Operasional per Program Paket
        </h4>
        <p className={`text-xs ${styles.textSub} mb-4`}>
          Membandingkan total setoran jamaah yang masuk (Omset Real) terhadap realisasi pembayaran biaya vendor (HPP). Klik <strong>Akui Pendapatan</strong> pada paket yang jasanya sudah terealisasi (mis. jamaah sudah berangkat) biar omset & HPP-nya masuk ke Laporan P&L. Sebelum diklik, nilainya tercatat sebagai Pendapatan/Biaya Dibayar Dimuka.
          Mengikuti filter periode <strong>{formatPeriodLabel(plPeriod)}</strong> di atas (paket yang belum diakui pendapatannya tetap ditampilkan di semua periode selama masih jadi action item).
        </p>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <tr>
                <th className="p-4">Nama Program Paket</th>
                <th className="p-4 text-right">Pemasukan (Omset)</th>
                <th className="p-4 text-right">HPP / Biaya Vendor</th>
                <th className="p-4 text-right">Laba / Margin Bersih</th>
                <th className="p-4 text-center">Status Margin</th>
                <th className="p-4 text-center">Status Pengakuan</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {marginTablePackages.length === 0 ? (
                <tr>
                  <td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Belum ada paket perjalanan pada periode ini.</td>
                </tr>
              ) : (
                marginTablePackages.map((pkg) => {
                  const pkgIncome = transactions
                    .filter(tx => tx.packageId === pkg.id || (!tx.packageId && tx.packageName === pkg.name))
                    .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
                  const pkgVendorCost = vendorPayments
                    .filter(vp => vp.packageId === pkg.id || (!vp.packageId && vp.packageName === pkg.name))
                    .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
                  const profit = pkgIncome - pkgVendorCost;
                  const isProfit = profit >= 0;

                  return (
                    <tr key={pkg.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>
                        {pkg.name}
                        <span className={`block text-[10px] ${styles.textSub} font-mono`}>{pkg.code} • Keberangkatan: {formatDateDDMMYYYY(pkg.departureDate)}</span>
                      </td>
                      <td className="p-4 text-right font-bold text-emerald-500">
                        Rp {pkgIncome.toLocaleString('id-ID')}
                      </td>
                      <td className="p-4 text-right font-bold text-rose-500">
                        Rp {pkgVendorCost.toLocaleString('id-ID')}
                      </td>
                      <td className={`p-4 text-right font-extrabold ${isProfit ? 'text-blue-500' : 'text-amber-500'}`}>
                        Rp {profit.toLocaleString('id-ID')}
                      </td>
                      <td className="p-4 text-center">
                        {isProfit ? (
                          <span className="inline-block px-2.5 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full font-bold text-[10px]">
                            PROFIT
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-1 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-full font-bold text-[10px]">
                            DEFISIT
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {pkg.revenueRecognized ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-bold text-[10px]">
                              <CheckCircle2 className="w-3 h-3" /> DIAKUI
                            </span>
                            <span className="text-[10px] text-slate-400">{formatDateDDMMYYYY(pkg.recognizedAt)}</span>
                            <button
                              type="button"
                              onClick={() => handleUnrecognizeRevenue(pkg)}
                              className="text-[10px] text-slate-400 hover:text-rose-500 inline-flex items-center gap-1 underline"
                            >
                              <RotateCcw className="w-3 h-3" /> Batalkan
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-1">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-500/10 text-slate-400 border border-slate-500/20 rounded-full font-bold text-[10px]">
                              <Clock className="w-3 h-3" /> DITERIMA DIMUKA
                            </span>
                            <button
                              type="button"
                              onClick={() => openRecognizeModal(pkg)}
                              className="mt-0.5 px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-[10px] font-medium inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Akui Pendapatan
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => {
                            setSelectedPackageForDetail(pkg);
                            setShowProfitDetailModal(true);
                          }}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-amber-500 rounded-lg transition-colors inline-flex items-center gap-1`}
                          title="Lihat Rincian Laba Rugi Paket Ini"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="md:hidden space-y-3">
          {marginTablePackages.length === 0 ? (
            <p className={`p-8 text-center text-xs ${styles.textSub}`}>Belum ada paket perjalanan pada periode ini.</p>
          ) : (
            marginTablePackages.map((pkg) => {
              const pkgIncome = transactions
                .filter(tx => tx.packageId === pkg.id || (!tx.packageId && tx.packageName === pkg.name))
                .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
              const pkgVendorCost = vendorPayments
                .filter(vp => vp.packageId === pkg.id || (!vp.packageId && vp.packageName === pkg.name))
                .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
              const profit = pkgIncome - pkgVendorCost;
              const isProfit = profit >= 0;

              return (
                <div key={pkg.id} className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-2`}>
                  <div>
                    <div className={`font-semibold ${styles.textTitle}`}>{pkg.name}</div>
                    <span className={`block text-[10px] ${styles.textSub} font-mono`}>{pkg.code} • Keberangkatan: {formatDateDDMMYYYY(pkg.departureDate)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Pemasukan (Omset)</span>
                    <div className="font-bold text-emerald-500">Rp {pkgIncome.toLocaleString('id-ID')}</div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">HPP / Biaya Vendor</span>
                    <div className="font-bold text-rose-500">Rp {pkgVendorCost.toLocaleString('id-ID')}</div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Laba / Margin Bersih</span>
                    <div className={`font-extrabold ${isProfit ? 'text-blue-500' : 'text-amber-500'}`}>Rp {profit.toLocaleString('id-ID')}</div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Status Margin</span>
                    <div>
                      {isProfit ? (
                        <span className="inline-block px-2.5 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full font-bold text-[10px]">
                          PROFIT
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-1 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-full font-bold text-[10px]">
                          DEFISIT
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] opacity-60 uppercase">Status Pengakuan</span>
                    <div>
                      {pkg.revenueRecognized ? (
                        <div className="flex flex-col items-start gap-1">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-bold text-[10px]">
                            <CheckCircle2 className="w-3 h-3" /> DIAKUI
                          </span>
                          <span className="text-[10px] text-slate-400">{formatDateDDMMYYYY(pkg.recognizedAt)}</span>
                          <button
                            type="button"
                            onClick={() => handleUnrecognizeRevenue(pkg)}
                            className="text-[10px] text-slate-400 hover:text-rose-500 inline-flex items-center gap-1 underline"
                          >
                            <RotateCcw className="w-3 h-3" /> Batalkan
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-500/10 text-slate-400 border border-slate-500/20 rounded-full font-bold text-[10px]">
                            <Clock className="w-3 h-3" /> DITERIMA DIMUKA
                          </span>
                          <button
                            type="button"
                            onClick={() => openRecognizeModal(pkg)}
                            className="mt-0.5 px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-[10px] font-medium inline-flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Akui Pendapatan
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => {
                        setSelectedPackageForDetail(pkg);
                        setShowProfitDetailModal(true);
                      }}
                      className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-amber-500 rounded-lg transition-colors inline-flex items-center gap-1`}
                      title="Lihat Rincian Laba Rugi Paket Ini"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {showProfitDetailModal && selectedPackageForDetail && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-3xl p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button
              onClick={() => setShowProfitDetailModal(false)}
              className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <BarChart3 className="w-5 h-5 text-amber-500" /> Breakdown Laba Rugi Program Paket
            </h3>
            <p className={`text-xs ${styles.textSub} mb-3`}>
              Paket: <strong className={styles.textTitle}>{selectedPackageForDetail.name}</strong> • Kode: <span className="font-mono text-emerald-500">{selectedPackageForDetail.code}</span>
            </p>

            <div className="mb-4">
              {selectedPackageForDetail.revenueRecognized ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-bold text-[10px]">
                    <CheckCircle2 className="w-3 h-3" /> PENDAPATAN SUDAH DIAKUI ({formatDateDDMMYYYY(selectedPackageForDetail.recognizedAt)})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleUnrecognizeRevenue(selectedPackageForDetail)}
                    className="text-[10px] text-slate-400 hover:text-rose-500 inline-flex items-center gap-1 underline"
                  >
                    <RotateCcw className="w-3 h-3" /> Batalkan Pengakuan
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-500/10 text-slate-400 border border-slate-500/20 rounded-full font-bold text-[10px]">
                    <Clock className="w-3 h-3" /> DITERIMA / DIBAYAR DIMUKA — BELUM MASUK P&L
                  </span>
                  <button
                    type="button"
                    onClick={() => openRecognizeModal(selectedPackageForDetail)}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-[10px] font-medium inline-flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Akui Pendapatan Sekarang
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Total Omset (Setoran)</span>
                <p className="text-sm font-bold text-emerald-500 mt-1">Rp {totalSelectedPkgIncome.toLocaleString('id-ID')}</p>
              </div>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Total Biaya Vendor (HPP)</span>
                <p className="text-sm font-bold text-rose-500 mt-1">Rp {totalSelectedPkgVendorCost.toLocaleString('id-ID')}</p>
              </div>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Margin Laba Bersih</span>
                <p className={`text-sm font-bold mt-1 ${selectedPkgProfit >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                  Rp {selectedPkgProfit.toLocaleString('id-ID')}
                </p>
              </div>
            </div>

            <div className="space-y-6 text-xs">
              <div>
                <h5 className="font-bold text-emerald-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                  <ArrowDownLeft className="w-4 h-4" /> Rincian Pemasukan Setoran Jamaah ({selectedPkgIncomes.length})
                </h5>
                <div className={`hidden md:block overflow-x-auto border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg`}>
                  <table className="w-full text-left">
                    <thead className={`${styles.tableHeaderBg} uppercase`}>
                      <tr>
                        <th className="p-2.5">Tanggal</th>
                        <th className="p-2.5">Jamaah & Booking</th>
                        <th className="p-2.5">Metode & Catatan</th>
                        <th className="p-2.5 text-right">Nominal</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {selectedPkgIncomes.length === 0 ? (
                        <tr><td colSpan="4" className={`p-4 text-center ${styles.textSub}`}>Belum ada setoran jamaah untuk paket ini.</td></tr>
                      ) : (
                        selectedPkgIncomes.map((tx) => (
                          <tr key={tx.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                            <td className={`p-2.5 ${styles.textSub}`}>{formatDateDDMMYYYY(tx.createdAt)}</td>
                            <td className={`p-2.5 font-semibold ${styles.textTitle}`}>
                              {tx.jamaahName}
                              <span className="block text-[10px] text-emerald-500 font-mono">{tx.bookingCode}</span>
                            </td>
                            <td className="p-2.5">
                              <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-1.5 py-0.5 rounded text-[10px] mr-1`}>{tx.paymentMethod}{tx.accountName ? ` - ${tx.accountName}` : ''}</span>
                              <span className={styles.textSub}>{tx.notes}</span>
                            </td>
                            <td className="p-2.5 text-right font-bold text-emerald-500">+ Rp {Number(tx.amount).toLocaleString('id-ID')}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className={`md:hidden space-y-2 border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg p-2`}>
                  {selectedPkgIncomes.length === 0 ? (
                    <p className={`p-4 text-center ${styles.textSub}`}>Belum ada setoran jamaah untuk paket ini.</p>
                  ) : (
                    selectedPkgIncomes.map((tx) => (
                      <div key={tx.id} className={`${styles.innerBg} border rounded-lg p-2.5 space-y-1.5`}>
                        <div>
                          <div className={`font-semibold ${styles.textTitle}`}>{tx.jamaahName}</div>
                          <span className="block text-[10px] text-emerald-500 font-mono">{tx.bookingCode}</span>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Tanggal</span>
                          <div className={styles.textSub}>{formatDateDDMMYYYY(tx.createdAt)}</div>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Metode & Catatan</span>
                          <div>
                            <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-1.5 py-0.5 rounded text-[10px] mr-1`}>{tx.paymentMethod}{tx.accountName ? ` - ${tx.accountName}` : ''}</span>
                            <span className={styles.textSub}>{tx.notes}</span>
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Nominal</span>
                          <div className="font-bold text-emerald-500">+ Rp {Number(tx.amount).toLocaleString('id-ID')}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <h5 className="font-bold text-rose-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                  <ArrowUpRight className="w-4 h-4" /> Rincian Pengeluaran HPP Vendor ({selectedPkgVendorCosts.length})
                </h5>
                <div className={`hidden md:block overflow-x-auto border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg`}>
                  <table className="w-full text-left">
                    <thead className={`${styles.tableHeaderBg} uppercase`}>
                      <tr>
                        <th className="p-2.5">Tanggal</th>
                        <th className="p-2.5">Vendor & Kategori</th>
                        <th className="p-2.5">Catatan Pengeluaran</th>
                        <th className="p-2.5 text-right">Nominal HPP</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {selectedPkgVendorCosts.length === 0 ? (
                        <tr><td colSpan="4" className={`p-4 text-center ${styles.textSub}`}>Belum ada biaya vendor untuk paket ini.</td></tr>
                      ) : (
                        selectedPkgVendorCosts.map((vp) => (
                          <tr key={vp.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                            <td className={`p-2.5 ${styles.textSub}`}>{formatDateDDMMYYYY(vp.createdAt)}</td>
                            <td className={`p-2.5 font-semibold ${styles.textTitle}`}>
                              {vp.vendorName}
                              <span className="block text-[10px] text-rose-500">{vp.category}</span>
                            </td>
                            <td className={`p-2.5 ${styles.textSub}`}>{vp.notes}</td>
                            <td className="p-2.5 text-right font-bold text-rose-500">- Rp {Number(vp.amount).toLocaleString('id-ID')}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className={`md:hidden space-y-2 border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg p-2`}>
                  {selectedPkgVendorCosts.length === 0 ? (
                    <p className={`p-4 text-center ${styles.textSub}`}>Belum ada biaya vendor untuk paket ini.</p>
                  ) : (
                    selectedPkgVendorCosts.map((vp) => (
                      <div key={vp.id} className={`${styles.innerBg} border rounded-lg p-2.5 space-y-1.5`}>
                        <div>
                          <div className={`font-semibold ${styles.textTitle}`}>{vp.vendorName}</div>
                          <span className="block text-[10px] text-rose-500">{vp.category}</span>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Tanggal</span>
                          <div className={styles.textSub}>{formatDateDDMMYYYY(vp.createdAt)}</div>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Catatan Pengeluaran</span>
                          <div className={styles.textSub}>{vp.notes}</div>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Nominal HPP</span>
                          <div className="font-bold text-rose-500">- Rp {Number(vp.amount).toLocaleString('id-ID')}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className={`flex justify-end pt-4 mt-6 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <button
                onClick={() => setShowProfitDetailModal(false)}
                className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}
              >
                Tutup Detail
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecognizeModal && pkgToRecognize && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button
              onClick={() => { setShowRecognizeModal(false); setPkgToRecognize(null); }}
              className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <CheckCircle2 className="w-5 h-5 text-blue-500" /> Akui Pendapatan Paket
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Paket: <strong className={styles.textTitle}>{pkgToRecognize.name}</strong>. Pilih tanggal pengakuan pendapatan — biasanya tanggal keberangkatan atau tanggal jasa benar-benar terealisasi. Omset & HPP paket ini akan masuk Laporan P&L di periode sesuai tanggal ini, bukan tanggal kamu klik tombol ini.
            </p>

            <form onSubmit={handleConfirmRecognizeRevenue} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Tanggal Pengakuan Pendapatan</label>
                <DateFieldID
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={recognizeDateInput}
                  onChange={(val) => setRecognizeDateInput(val)}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button
                  type="button"
                  onClick={() => { setShowRecognizeModal(false); setPkgToRecognize(null); }}
                  className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}
                >
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium">
                  Konfirmasi & Akui Pendapatan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB: ANALISA MARGIN — Margin Planning (Rencana Anggaran yang diisi di
// Paket Perjalanan) vs Margin Realisasi (angka riil yang udah dibekukan
// di jurnal `revenue_recognition`/`revenue_unrecognition` pas staf klik
// "Akui Pendapatan" di tab Laba Rugi). Tab ini murni agregasi client-side
// dari packagesList & journalEntries yang udah di-fetch parent — nggak ada
// query Firestore baru sama sekali di sini.
// =====================================================================
function MarginAnalysisTab({ styles, isDark, packagesList, journalEntries, companyProfile }) {
  const [subView, setSubView] = useState('per_paket'); // 'per_paket' | 'per_destinasi'
  const [filterDestinasi, setFilterDestinasi] = useState('all');
  const [filterTahun, setFilterTahun] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // all | recognized | not_recognized
  const [selectedPkgDetail, setSelectedPkgDetail] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Realisasi Income/HPP dihitung dari NET baris jurnal source
  // 'revenue_recognition' + 'revenue_unrecognition' yang sourceDocId-nya =
  // id paket ini. Sengaja pakai jurnal (bukan re-sum payments_income/
  // payments_vendor live) karena angkanya udah dibekukan pas momen Akui
  // Pendapatan — nggak kegeser kalau ada transaksi baru masuk belakangan,
  // dan otomatis netto balik ke 0 kalau paketnya di-"Batalkan Pengakuan".
  const marginRows = packagesList.map(pkg => {
    const relatedEntries = journalEntries.filter(je =>
      je.sourceDocId === pkg.id && (je.source === 'revenue_recognition' || je.source === 'revenue_unrecognition')
    );
    let realisasiIncome = 0;
    let realisasiHpp = 0;
    relatedEntries.forEach(je => {
      (je.lines || []).forEach(line => {
        if (line.accountCode === ACC.PENDAPATAN) {
          realisasiIncome += (Number(line.credit) || 0) - (Number(line.debit) || 0);
        }
        if (line.accountCode === ACC.HPP) {
          realisasiHpp += (Number(line.debit) || 0) - (Number(line.credit) || 0);
        }
      });
    });
    const realisasiMargin = realisasiIncome - realisasiHpp;

    const budgetCostTotal = Number(pkg.budgetCostTotal || 0);
    const quotaTotal = Number(pkg.quotaTotal || 0);
    const quotaTerjual = Math.max(0, quotaTotal - Number(pkg.quotaRemaining ?? quotaTotal));
    const hargaJualUtama = Number(pkg.priceMain || pkg.priceQuad || 0);
    const planningSelling = hargaJualUtama * quotaTotal;
    const planningMargin = planningSelling - budgetCostTotal;

    const hasRealisasiActivity = relatedEntries.length > 0;
    const recognizedYear = pkg.recognizedAt ? new Date(pkg.recognizedAt).getFullYear() : null;

    return {
      pkg, quotaTotal, quotaTerjual, hargaJualUtama,
      planningSelling, budgetCostTotal, planningMargin,
      realisasiIncome, realisasiHpp, realisasiMargin,
      selisih: realisasiMargin - planningMargin,
      hasRealisasiActivity, recognizedYear,
    };
  });

  const yearsAvailable = Array.from(new Set(marginRows.filter(r => r.recognizedYear).map(r => r.recognizedYear))).sort((a, b) => b - a);
  const destinasiAvailable = Array.from(new Set(packagesList.map(p => p.destinationCity).filter(Boolean))).sort();

  const filteredRows = marginRows.filter(r => {
    if (filterDestinasi !== 'all' && r.pkg.destinationCity !== filterDestinasi) return false;
    if (filterTahun !== 'all' && String(r.recognizedYear) !== filterTahun) return false;
    if (filterStatus === 'recognized' && !r.pkg.revenueRecognized) return false;
    if (filterStatus === 'not_recognized' && r.pkg.revenueRecognized) return false;
    return true;
  });

  // Per Destinasi (Tahunan/Multi-Tahun) — cuma paket yang udah ada
  // aktivitas Realisasi (diakui pendapatannya) yang diagregasi, biar angka
  // Margin Realisasi-nya bukan 0 semua gara-gara belum pernah Akui
  // Pendapatan.
  const perDestinasiMap = {};
  filteredRows.filter(r => r.pkg.revenueRecognized || r.hasRealisasiActivity).forEach(r => {
    const key = r.pkg.destinationCity || 'Tanpa Destinasi';
    if (!perDestinasiMap[key]) {
      perDestinasiMap[key] = { destinasi: key, jumlahPaket: 0, totalPax: 0, totalPlanning: 0, totalRealisasi: 0, totalRealisasiIncome: 0 };
    }
    perDestinasiMap[key].jumlahPaket += 1;
    perDestinasiMap[key].totalPax += r.quotaTerjual;
    perDestinasiMap[key].totalPlanning += r.planningMargin;
    perDestinasiMap[key].totalRealisasi += r.realisasiMargin;
    perDestinasiMap[key].totalRealisasiIncome += r.realisasiIncome;
  });
  const perDestinasiRows = Object.values(perDestinasiMap)
    .map(d => ({
      ...d,
      marginPct: d.totalRealisasiIncome > 0 ? (d.totalRealisasi / d.totalRealisasiIncome) * 100 : 0,
      selisih: d.totalRealisasi - d.totalPlanning
    }))
    .sort((a, b) => b.totalRealisasi - a.totalRealisasi);

  const maxAbsMargin = Math.max(1, ...perDestinasiRows.map(d => Math.max(Math.abs(d.totalPlanning), Math.abs(d.totalRealisasi))));

  const handleExportPdfPerPaket = async () => {
    setGeneratingPdf(true);
    try {
      const docPdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
      const { cursorY, marginX } = await addPdfLetterhead(docPdf, companyProfile, 'ANALISA MARGIN PER PAKET', 'Planning vs Realisasi');
      autoTable(docPdf, {
        startY: cursorY + 2,
        margin: { left: marginX, right: marginX },
        head: [['Paket', 'Destinasi', 'Kuota (Terjual/Total)', 'Planning Cost', 'Margin Planning', 'Status', 'Margin Realisasi', 'Selisih']],
        body: filteredRows.map(r => [
          `${r.pkg.name}${r.pkg.code ? ` (${r.pkg.code})` : ''}`,
          r.pkg.destinationCity || '-',
          `${r.quotaTerjual}/${r.quotaTotal}`,
          r.budgetCostTotal.toLocaleString('id-ID'),
          r.planningMargin.toLocaleString('id-ID'),
          r.pkg.revenueRecognized ? 'Sudah Diakui' : 'Belum Diakui',
          r.realisasiMargin.toLocaleString('id-ID'),
          r.selisih.toLocaleString('id-ID')
        ]),
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } }
      });
      docPdf.save(`Analisa-Margin-Per-Paket-${todayISODate()}.pdf`);
    } catch (err) {
      alert('Gagal membuat PDF Analisa Margin Per Paket: ' + err.message);
    }
    setGeneratingPdf(false);
  };

  const handleExportPdfPerDestinasi = async () => {
    setGeneratingPdf(true);
    try {
      const docPdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const subtitle = filterTahun === 'all' ? 'Semua Tahun' : `Tahun ${filterTahun}`;
      const { cursorY, marginX } = await addPdfLetterhead(docPdf, companyProfile, 'ANALISA MARGIN PER DESTINASI', subtitle);
      autoTable(docPdf, {
        startY: cursorY + 2,
        margin: { left: marginX, right: marginX },
        head: [['Destinasi', 'Jumlah Paket', 'Total Pax', 'Margin Planning', 'Margin Realisasi', 'Margin %', 'Selisih']],
        body: perDestinasiRows.map(d => [
          d.destinasi, String(d.jumlahPaket), String(d.totalPax),
          d.totalPlanning.toLocaleString('id-ID'), d.totalRealisasi.toLocaleString('id-ID'),
          `${d.marginPct.toFixed(1)}%`, d.selisih.toLocaleString('id-ID')
        ]),
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }
      });
      docPdf.save(`Analisa-Margin-Per-Destinasi-${todayISODate()}.pdf`);
    } catch (err) {
      alert('Gagal membuat PDF Analisa Margin Per Destinasi: ' + err.message);
    }
    setGeneratingPdf(false);
  };

  return (
    <div className="space-y-3">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex flex-wrap items-end gap-3`}>
        <div className={`${styles.innerBg} border rounded-lg p-1 flex gap-1`}>
          <button onClick={() => setSubView('per_paket')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${subView === 'per_paket' ? styles.tabActive : styles.textSub}`}>Per Paket</button>
          <button onClick={() => setSubView('per_destinasi')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${subView === 'per_destinasi' ? styles.tabActive : styles.textSub}`}>Per Destinasi (Tahunan)</button>
        </div>

        {subView === 'per_paket' && (
          <div>
            <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Destinasi</label>
            <select className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterDestinasi} onChange={e => setFilterDestinasi(e.target.value)}>
              <option value="all">Semua Destinasi</option>
              {destinasiAvailable.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Tahun (Akui Pendapatan)</label>
          <select className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterTahun} onChange={e => setFilterTahun(e.target.value)}>
            <option value="all">Semua Tahun</option>
            {yearsAvailable.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>
        {subView === 'per_paket' && (
          <div>
            <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Status</label>
            <select className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">Semua Status</option>
              <option value="recognized">Sudah Diakui</option>
              <option value="not_recognized">Belum Diakui</option>
            </select>
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={subView === 'per_paket' ? handleExportPdfPerPaket : handleExportPdfPerDestinasi}
          disabled={generatingPdf}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-60"
        >
          <Download className="w-3.5 h-3.5" /> {generatingPdf ? 'Membuat...' : 'Export PDF'}
        </button>
      </div>

      <p className={`text-[11px] ${styles.textSub} px-1`}>
        Margin Planning = estimasi target margin dari harga jual & Rencana Anggaran yang diisi pas bikin paket (menu Paket Perjalanan). Margin Realisasi = angka riil dari jurnal pas paket di-"Akui Pendapatan". Selisih = Realisasi − Planning.
      </p>

      {subView === 'per_paket' ? (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={styles.tableHeaderBg}>
                <tr>
                  <th className="text-left p-2.5 font-medium">Paket</th>
                  <th className="text-left p-2.5 font-medium">Destinasi</th>
                  <th className="text-right p-2.5 font-medium">Kuota</th>
                  <th className="text-right p-2.5 font-medium">Planning Cost</th>
                  <th className="text-right p-2.5 font-medium">Margin Planning</th>
                  <th className="text-center p-2.5 font-medium">Status</th>
                  <th className="text-right p-2.5 font-medium">Margin Realisasi</th>
                  <th className="text-right p-2.5 font-medium">Selisih</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {filteredRows.length === 0 && (
                  <tr><td colSpan={8} className={`p-4 text-center ${styles.textSub}`}>Tidak ada paket yang cocok dengan filter ini.</td></tr>
                )}
                {filteredRows.map(r => (
                  <tr key={r.pkg.id} className="cursor-pointer hover:bg-slate-500/5" onClick={() => setSelectedPkgDetail(r)}>
                    <td className={`p-2.5 ${styles.textTitle} font-medium`}>{r.pkg.name} {r.pkg.code ? <span className={styles.textSub}>({r.pkg.code})</span> : null}</td>
                    <td className={`p-2.5 ${styles.textSub}`}>{r.pkg.destinationCity || '-'}</td>
                    <td className={`p-2.5 text-right ${styles.textSub}`}>{r.quotaTerjual}/{r.quotaTotal}</td>
                    <td className="p-2.5 text-right">{formatRp(r.budgetCostTotal)}</td>
                    <td className={`p-2.5 text-right font-medium ${r.planningMargin >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatRp(r.planningMargin)}</td>
                    <td className="p-2.5 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${r.pkg.revenueRecognized ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                        {r.pkg.revenueRecognized ? 'Sudah Diakui' : 'Belum Diakui'}
                      </span>
                    </td>
                    <td className={`p-2.5 text-right font-medium ${r.realisasiMargin >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatRp(r.realisasiMargin)}</td>
                    <td className={`p-2.5 text-right font-medium ${r.selisih >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatRp(r.selisih)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={styles.tableHeaderBg}>
                <tr>
                  <th className="text-left p-2.5 font-medium">Destinasi</th>
                  <th className="text-right p-2.5 font-medium">Jumlah Paket</th>
                  <th className="text-right p-2.5 font-medium">Total Pax</th>
                  <th className="text-left p-2.5 font-medium w-56">Planning vs Realisasi</th>
                  <th className="text-right p-2.5 font-medium">Margin Planning</th>
                  <th className="text-right p-2.5 font-medium">Margin Realisasi</th>
                  <th className="text-right p-2.5 font-medium">Margin %</th>
                  <th className="text-right p-2.5 font-medium">Selisih</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {perDestinasiRows.length === 0 && (
                  <tr><td colSpan={8} className={`p-4 text-center ${styles.textSub}`}>Belum ada paket yang diakui pendapatannya untuk periode/filter ini.</td></tr>
                )}
                {perDestinasiRows.map(d => (
                  <tr key={d.destinasi}>
                    <td className={`p-2.5 ${styles.textTitle} font-medium`}>{d.destinasi}</td>
                    <td className={`p-2.5 text-right ${styles.textSub}`}>{d.jumlahPaket}</td>
                    <td className={`p-2.5 text-right ${styles.textSub}`}>{d.totalPax}</td>
                    <td className="p-2.5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9.5px] w-14 opacity-60">Planning</span>
                          <div className="flex-1 h-2 rounded bg-slate-500/15 overflow-hidden">
                            <div className="h-full bg-slate-400" style={{ width: `${(Math.abs(d.totalPlanning) / maxAbsMargin) * 100}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9.5px] w-14 opacity-60">Realisasi</span>
                          <div className="flex-1 h-2 rounded bg-slate-500/15 overflow-hidden">
                            <div className={`h-full ${d.totalRealisasi >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${(Math.abs(d.totalRealisasi) / maxAbsMargin) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-2.5 text-right">{formatRp(d.totalPlanning)}</td>
                    <td className={`p-2.5 text-right font-medium ${d.totalRealisasi >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatRp(d.totalRealisasi)}</td>
                    <td className={`p-2.5 text-right ${styles.textSub}`}>{d.marginPct.toFixed(1)}%</td>
                    <td className={`p-2.5 text-right font-medium ${d.selisih >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatRp(d.selisih)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedPkgDetail && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelectedPkgDetail(null)}>
          <div className={`${styles.cardBg} border rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-sm font-bold ${styles.textTitle}`}>{selectedPkgDetail.pkg.name} {selectedPkgDetail.pkg.code ? `(${selectedPkgDetail.pkg.code})` : ''}</h3>
              <button onClick={() => setSelectedPkgDetail(null)} className={styles.textSub}><X className="w-4 h-4" /></button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
              <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                <p className={`${styles.textSub} mb-1`}>Margin Planning</p>
                <p className={`text-base font-bold ${selectedPkgDetail.planningMargin >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatRp(selectedPkgDetail.planningMargin)}</p>
              </div>
              <div className={`p-3 rounded-lg ${styles.innerBg} border`}>
                <p className={`${styles.textSub} mb-1`}>Margin Realisasi</p>
                <p className={`text-base font-bold ${selectedPkgDetail.realisasiMargin >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatRp(selectedPkgDetail.realisasiMargin)}</p>
              </div>
            </div>

            {!selectedPkgDetail.pkg.revenueRecognized && (
              <p className={`text-[11px] ${styles.textSub} mb-3 italic`}>Paket ini belum "Akui Pendapatan" — Margin Realisasi masih 0 sampai diakui lewat tab Laba Rugi (P&L).</p>
            )}

            <p className={`text-[11px] font-semibold mb-1.5 ${styles.textTitle}`}>Rincian Rencana Anggaran (Fixed Cost)</p>
            <table className="w-full text-xs mb-3">
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {(selectedPkgDetail.pkg.budgetFixedCostItems || []).length === 0 && (
                  <tr><td className={`p-1.5 ${styles.textSub}`}>Belum diisi.</td></tr>
                )}
                {(selectedPkgDetail.pkg.budgetFixedCostItems || []).map((it, i) => (
                  <tr key={`fx-${i}`}><td className="p-1.5">{it.label || '-'}</td><td className="p-1.5 text-right">{formatRp(it.amount)}</td></tr>
                ))}
              </tbody>
            </table>

            <p className={`text-[11px] font-semibold mb-1.5 ${styles.textTitle}`}>Rincian Rencana Anggaran (Variable Cost TL)</p>
            <table className="w-full text-xs mb-3">
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {(selectedPkgDetail.pkg.budgetVariableCostItems || []).length === 0 && (
                  <tr><td className={`p-1.5 ${styles.textSub}`}>Belum diisi.</td></tr>
                )}
                {(selectedPkgDetail.pkg.budgetVariableCostItems || []).map((it, i) => (
                  <tr key={`vr-${i}`}><td className="p-1.5">{it.label || '-'}</td><td className="p-1.5 text-right">{formatRp(it.amount)}</td></tr>
                ))}
              </tbody>
            </table>

            <div className={`pt-2 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'} text-xs space-y-1`}>
              <div className="flex justify-between"><span className={styles.textSub}>Realisasi Income (DPP)</span><span className="font-medium">{formatRp(selectedPkgDetail.realisasiIncome)}</span></div>
              <div className="flex justify-between"><span className={styles.textSub}>Realisasi HPP Vendor</span><span className="font-medium">{formatRp(selectedPkgDetail.realisasiHpp)}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB 7: KAS & BANK — dipindah dari FinanceModule.jsx tab "Laporan"
// =====================================================================
function CashBankTab({ styles, isDark, currentUser, financialAccounts, onRefresh }) {
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [accountForm, setAccountForm] = useState({
    name: '', type: 'Kas', bankName: BANK_LIST[0], customBankName: '', accountNumber: '', openingBalance: ''
  });

  const [showMutationsModal, setShowMutationsModal] = useState(false);
  const [mutationAccount, setMutationAccount] = useState(null);
  const [mutationRows, setMutationRows] = useState([]);
  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationDateFrom, setMutationDateFrom] = useState('');
  const [mutationDateTo, setMutationDateTo] = useState('');

  const handleAccountSubmit = async (e) => {
    e.preventDefault();
    if (!accountForm.name.trim()) {
      alert('Isi nama akunnya dulu.');
      return;
    }
    try {
      const payload = {
        name: accountForm.name.trim(),
        type: accountForm.type,
        ...(accountForm.type === 'Bank' ? {
          bankName: resolveBankName(accountForm.bankName, accountForm.customBankName),
          accountNumber: accountForm.accountNumber || ''
        } : { bankName: '', accountNumber: '' })
      };
      if (editingAccountId) {
        await updateDoc(doc(db, 'financial_accounts', editingAccountId), payload);
        logActivity({
          userId: currentUser?.uid, userName: currentUser?.fullName || currentUser?.email, userRole: currentUser?.role,
          action: 'update', module: 'Akun Keuangan', targetLabel: payload.name,
          details: `Mengubah data akun Kas/Bank "${payload.name}"`
        });
      } else {
        const openingBalanceVal = Number(accountForm.openingBalance || 0);
        await addDoc(collection(db, 'financial_accounts'), {
          ...payload, openingBalance: openingBalanceVal, balance: openingBalanceVal, createdAt: new Date().toISOString()
        });
        logActivity({
          userId: currentUser?.uid, userName: currentUser?.fullName || currentUser?.email, userRole: currentUser?.role,
          action: 'create', module: 'Akun Keuangan', targetLabel: payload.name,
          details: `Menambahkan akun Kas/Bank baru "${payload.name}"`
        });
      }
      setShowAccountModal(false);
      setEditingAccountId(null);
      setAccountForm({ name: '', type: 'Kas', bankName: BANK_LIST[0], customBankName: '', accountNumber: '', openingBalance: '' });
      onRefresh();
    } catch (err) {
      alert('Gagal menyimpan akun: ' + err.message);
    }
  };

  const handleEditAccount = (acc) => {
    setEditingAccountId(acc.id);
    setAccountForm({
      name: acc.name || '',
      type: acc.type || 'Kas',
      bankName: BANK_LIST.includes(acc.bankName) ? acc.bankName : (acc.bankName ? 'Bank Lainnya' : BANK_LIST[0]),
      customBankName: BANK_LIST.includes(acc.bankName) ? '' : (acc.bankName || ''),
      accountNumber: acc.accountNumber || '',
      openingBalance: acc.openingBalance ?? ''
    });
    setShowAccountModal(true);
  };

  const handleDeleteAccount = async (acc) => {
    if (Number(acc.balance || 0) !== 0) {
      alert(`Akun "${acc.name}" masih punya saldo Rp ${Number(acc.balance).toLocaleString('id-ID')}. Kosongkan dulu saldonya (pastikan semua transaksi yang keiket ke akun ini sudah beres) sebelum akunnya dihapus.`);
      return;
    }
    try {
      const mutQ = query(collection(db, 'account_mutations'), where('accountId', '==', acc.id));
      const mutSnap = await getDocs(mutQ);
      if (!mutSnap.empty) {
        if (!confirm(`Akun "${acc.name}" udah punya ${mutSnap.size} riwayat mutasi (saldonya sekarang emang 0, tapi pernah dipakai). Riwayat itu nggak ikut kehapus, cuma jadi nggak nyambung ke akun manapun lagi kalau akun ini dihapus. Tetap hapus?`)) return;
      } else {
        if (!confirm(`Hapus akun "${acc.name}"?`)) return;
      }
      await deleteDoc(doc(db, 'financial_accounts', acc.id));
      logActivity({
        userId: currentUser?.uid, userName: currentUser?.fullName || currentUser?.email, userRole: currentUser?.role,
        action: 'delete', module: 'Akun Keuangan', targetLabel: acc.name,
        details: `Menghapus akun Kas/Bank "${acc.name}"`
      });
      onRefresh();
    } catch (err) {
      alert('Gagal menghapus akun: ' + err.message);
    }
  };

  const handleOpenMutations = async (acc) => {
    setMutationAccount(acc);
    setMutationDateFrom('');
    setMutationDateTo('');
    setShowMutationsModal(true);
    setMutationLoading(true);
    try {
      const q = query(collection(db, 'account_mutations'), where('accountId', '==', acc.id));
      const snap = await getDocs(q);
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      let running = Number(acc.openingBalance || 0);
      const withBalance = rows.map(r => {
        running += (r.type === 'in' ? Number(r.amount) || 0 : -(Number(r.amount) || 0));
        return { ...r, balanceAfter: running };
      });
      setMutationRows(withBalance);
    } catch (err) {
      alert('Gagal mengambil riwayat mutasi: ' + err.message);
      setMutationRows([]);
    } finally {
      setMutationLoading(false);
    }
  };

  const getFilteredMutationRows = () => {
    return mutationRows.filter(r => {
      const rowDate = (r.createdAt || '').slice(0, 10);
      if (mutationDateFrom && rowDate < mutationDateFrom) return false;
      if (mutationDateTo && rowDate > mutationDateTo) return false;
      return true;
    });
  };

  const handleExportMutations = () => {
    const rows = getFilteredMutationRows();
    if (rows.length === 0) {
      alert('Nggak ada data mutasi buat diexport pada rentang tanggal ini.');
      return;
    }
    const escapeCsv = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const header = ['Tanggal', 'Keterangan', 'Referensi', 'Masuk', 'Keluar', 'Saldo'];
    const lines = [header.join(',')];
    rows.forEach(r => {
      lines.push([
        escapeCsv(formatDateDDMMYYYY(r.createdAt)),
        escapeCsv(r.description),
        escapeCsv(r.reference),
        r.type === 'in' ? Number(r.amount) || 0 : 0,
        r.type === 'out' ? Number(r.amount) || 0 : 0,
        Number(r.balanceAfter) || 0
      ].join(','));
    });
    const csvContent = '﻿' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeAccName = (mutationAccount?.name || 'akun').replace(/[^a-z0-9]+/gi, '_');
    link.href = url;
    link.download = `Mutasi_${safeAccName}_${todayISODate()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex justify-between items-center`}>
        <div>
          <p className={`text-xs font-medium ${styles.textSub}`}>Total Saldo Seluruh Akun</p>
          <p className={`text-xl font-bold ${styles.textTitle}`}>
            Rp {financialAccounts.reduce((acc, a) => acc + (Number(a.balance) || 0), 0).toLocaleString('id-ID')}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingAccountId(null);
            setAccountForm({ name: '', type: 'Kas', bankName: BANK_LIST[0], customBankName: '', accountNumber: '', openingBalance: '' });
            setShowAccountModal(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
        >
          <Wallet className="w-4 h-4" /> + Tambah Akun
        </button>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <tr>
                <th className="p-4">Nama Akun</th>
                <th className="p-4">Jenis</th>
                <th className="p-4">No. Rekening</th>
                <th className="p-4 text-right">Saldo Berjalan</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {financialAccounts.length === 0 ? (
                <tr>
                  <td colSpan="5" className={`p-8 text-center ${styles.textSub}`}>Belum ada akun Kas/Bank. Tambahkan dulu biar transaksi setoran/pengeluaran bisa diiket ke akun tertentu.</td>
                </tr>
              ) : (
                financialAccounts.map(acc => (
                  <tr key={acc.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                    <td className={`p-4 font-semibold ${styles.textTitle}`}>{acc.name}</td>
                    <td className="p-4">
                      <span className={`${acc.type === 'Bank' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20'} border px-2.5 py-1 rounded-full font-medium`}>
                        {acc.type}
                      </span>
                    </td>
                    <td className={`p-4 ${styles.textSub}`}>{acc.type === 'Bank' ? (acc.accountNumber || '-') : '-'}</td>
                    <td className={`p-4 text-right font-bold ${styles.textTitle}`}>Rp {Number(acc.balance || 0).toLocaleString('id-ID')}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleOpenMutations(acc)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                          title="Lihat Riwayat Mutasi"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEditAccount(acc)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                          title="Edit Akun"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(acc)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                          title="Hapus Akun"
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
          {financialAccounts.length === 0 ? (
            <p className={`p-8 text-center text-xs ${styles.textSub}`}>Belum ada akun Kas/Bank. Tambahkan dulu biar transaksi setoran/pengeluaran bisa diiket ke akun tertentu.</p>
          ) : (
            financialAccounts.map(acc => (
              <div key={acc.id} className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-2`}>
                <div className={`font-semibold ${styles.textTitle}`}>{acc.name}</div>
                <div>
                  <span className="text-[10px] opacity-60 uppercase">Jenis</span>
                  <div>
                    <span className={`${acc.type === 'Bank' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20'} border px-2.5 py-1 rounded-full font-medium inline-block`}>
                      {acc.type}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] opacity-60 uppercase">No. Rekening</span>
                  <div className={styles.textSub}>{acc.type === 'Bank' ? (acc.accountNumber || '-') : '-'}</div>
                </div>
                <div>
                  <span className="text-[10px] opacity-60 uppercase">Saldo Berjalan</span>
                  <div className={`font-bold ${styles.textTitle}`}>Rp {Number(acc.balance || 0).toLocaleString('id-ID')}</div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => handleOpenMutations(acc)}
                    className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                    title="Lihat Riwayat Mutasi"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleEditAccount(acc)}
                    className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                    title="Edit Akun"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteAccount(acc)}
                    className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                    title="Hapus Akun"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showAccountModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowAccountModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <Wallet className="w-5 h-5 text-blue-500" /> {editingAccountId ? 'Edit Akun Kas/Bank' : 'Tambah Akun Kas/Bank'}
            </h3>

            <form onSubmit={handleAccountSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Nama Akun</label>
                <input
                  type="text" required placeholder="Contoh: Kas Kecil Kantor / BCA Operasional"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={accountForm.name}
                  onChange={e => setAccountForm({ ...accountForm, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block mb-1 font-medium">Jenis Akun</label>
                <select
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={accountForm.type}
                  onChange={e => setAccountForm({ ...accountForm, type: e.target.value })}
                >
                  <option value="Kas">Kas (Cash)</option>
                  <option value="Bank">Bank</option>
                </select>
              </div>

              {accountForm.type === 'Bank' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1 font-medium">Nama Bank</label>
                    <select
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={accountForm.bankName}
                      onChange={e => setAccountForm({ ...accountForm, bankName: e.target.value })}
                    >
                      {BANK_LIST.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">No. Rekening</label>
                    <input
                      type="text" placeholder="1234567890"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={accountForm.accountNumber}
                      onChange={e => setAccountForm({ ...accountForm, accountNumber: e.target.value })}
                    />
                  </div>
                  {accountForm.bankName === 'Bank Lainnya' && (
                    <div className="col-span-2">
                      <label className="block mb-1 font-medium">Nama Bank Lainnya</label>
                      <input
                        type="text" placeholder="Ketik nama banknya"
                        className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                        value={accountForm.customBankName}
                        onChange={e => setAccountForm({ ...accountForm, customBankName: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}

              {!editingAccountId && (
                <div>
                  <label className="block mb-1 font-medium">Saldo Awal (Rp)</label>
                  <input
                    type="number" placeholder="0"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={accountForm.openingBalance}
                    onChange={e => setAccountForm({ ...accountForm, openingBalance: e.target.value })}
                  />
                  <p className="text-[10px] mt-1 opacity-70">Saldo yang udah ada di akun ini SEBELUM mulai dicatat di sistem (boleh dikosongin/0 kalau mulai dari nol).</p>
                </div>
              )}
              {editingAccountId && (
                <p className="text-[10px] opacity-70">Saldo berjalan akun ini cuma berubah otomatis lewat transaksi (setoran/bayar vendor/dll), nggak bisa diubah manual dari sini.</p>
              )}

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowAccountModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                  Simpan Akun
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMutationsModal && mutationAccount && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col relative`}>
            <div className={`p-6 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} flex justify-between items-start gap-4`}>
              <div>
                <h3 className={`text-lg font-bold ${styles.textTitle}`}>Riwayat Mutasi — {mutationAccount.name}</h3>
                <p className={`text-xs ${styles.textSub} mt-1`}>
                  Saldo Awal: Rp {Number(mutationAccount.openingBalance || 0).toLocaleString('id-ID')} · Saldo Sekarang: Rp {Number(mutationAccount.balance || 0).toLocaleString('id-ID')}
                </p>
              </div>
              <button onClick={() => setShowMutationsModal(false)} className={`p-1.5 ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'} rounded-lg`}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 pb-3 flex flex-wrap items-end gap-3">
              <div>
                <label className={`block text-[10px] font-medium mb-1 ${styles.textSub}`}>Dari Tanggal</label>
                <input
                  type="date"
                  value={mutationDateFrom}
                  onChange={e => setMutationDateFrom(e.target.value)}
                  className={`text-xs px-3 py-2 rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                />
              </div>
              <div>
                <label className={`block text-[10px] font-medium mb-1 ${styles.textSub}`}>Sampai Tanggal</label>
                <input
                  type="date"
                  value={mutationDateTo}
                  onChange={e => setMutationDateTo(e.target.value)}
                  className={`text-xs px-3 py-2 rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300'}`}
                />
              </div>
              {(mutationDateFrom || mutationDateTo) && (
                <button
                  onClick={() => { setMutationDateFrom(''); setMutationDateTo(''); }}
                  className={`text-xs px-3 py-2 rounded-lg ${isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  Reset Filter
                </button>
              )}
              <button
                onClick={handleExportMutations}
                className="ml-auto flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
              >
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <div className={`${isDark ? 'border-slate-800' : 'border-slate-200'} border rounded-xl overflow-hidden`}>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} sticky top-0`}>
                      <tr>
                        <th className="p-3">Tanggal</th>
                        <th className="p-3">Keterangan</th>
                        <th className="p-3">Referensi</th>
                        <th className="p-3 text-right">Masuk</th>
                        <th className="p-3 text-right">Keluar</th>
                        <th className="p-3 text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {mutationLoading ? (
                        <tr><td colSpan="6" className={`p-8 text-center ${styles.textSub}`}>Memuat riwayat mutasi...</td></tr>
                      ) : getFilteredMutationRows().length === 0 ? (
                        <tr><td colSpan="6" className={`p-8 text-center ${styles.textSub}`}>Belum ada mutasi pada rentang tanggal ini.</td></tr>
                      ) : (
                        getFilteredMutationRows().map(r => (
                          <tr key={r.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                            <td className={`p-3 whitespace-nowrap ${styles.textSub}`}>{formatDateDDMMYYYY(r.createdAt)}</td>
                            <td className={`p-3 ${styles.textTitle}`}>{r.description || '-'}</td>
                            <td className={`p-3 ${styles.textSub}`}>{r.reference || '-'}</td>
                            <td className="p-3 text-right font-medium text-emerald-500">{r.type === 'in' ? `Rp ${Number(r.amount).toLocaleString('id-ID')}` : '-'}</td>
                            <td className="p-3 text-right font-medium text-rose-500">{r.type === 'out' ? `Rp ${Number(r.amount).toLocaleString('id-ID')}` : '-'}</td>
                            <td className={`p-3 text-right font-bold ${styles.textTitle}`}>Rp {Number(r.balanceAfter).toLocaleString('id-ID')}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden space-y-3 p-3">
                  {mutationLoading ? (
                    <p className={`p-8 text-center text-xs ${styles.textSub}`}>Memuat riwayat mutasi...</p>
                  ) : getFilteredMutationRows().length === 0 ? (
                    <p className={`p-8 text-center text-xs ${styles.textSub}`}>Belum ada mutasi pada rentang tanggal ini.</p>
                  ) : (
                    getFilteredMutationRows().map(r => (
                      <div key={r.id} className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-2`}>
                        <div className={`font-semibold ${styles.textTitle}`}>{formatDateDDMMYYYY(r.createdAt)}</div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Keterangan</span>
                          <div className={styles.textTitle}>{r.description || '-'}</div>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Referensi</span>
                          <div className={styles.textSub}>{r.reference || '-'}</div>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Masuk</span>
                          <div className="font-medium text-emerald-500">{r.type === 'in' ? `Rp ${Number(r.amount).toLocaleString('id-ID')}` : '-'}</div>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Keluar</span>
                          <div className="font-medium text-rose-500">{r.type === 'out' ? `Rp ${Number(r.amount).toLocaleString('id-ID')}` : '-'}</div>
                        </div>
                        <div>
                          <span className="text-[10px] opacity-60 uppercase">Saldo</span>
                          <div className={`font-bold ${styles.textTitle}`}>Rp {Number(r.balanceAfter).toLocaleString('id-ID')}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
