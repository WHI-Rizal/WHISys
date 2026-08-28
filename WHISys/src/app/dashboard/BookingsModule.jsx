'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc, query, where, increment } from 'firebase/firestore';
import { BookOpen, Plus, Search, CheckCircle, Clock, X, Edit, Trash2, Wallet, History, Printer, FileCheck, Check, AlertCircle, MessageSquare, Ban, RotateCcw, DoorOpen, Wand2, Filter, MoreHorizontal, Star, UserPlus } from 'lucide-react';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

// Nama bulan Indonesia, dipakai buat format tanggal+jam "Waktu Transaksi" di ringkasan grup
const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const formatDateTimeID = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '-';
  const day = date.getDate();
  const month = MONTHS_ID[date.getMonth()];
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
};

// Format persentase gaya Indonesia (koma desimal), mis. 16,70%
const formatPercentID = (value) => {
  const num = isFinite(value) ? value : 0;
  return `${num.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
};

// Geser sebuah tanggal (ISO string / Date) sejumlah hari (boleh negatif),
// hasilnya string ISO 'YYYY-MM-DD' — dipakai buat hitung due date invoice.
const shiftDateByDays = (dateInput, days) => {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// Due Date Pelunasan = H-40 sebelum tanggal keberangkatan.
const getDueDatePelunasan = (booking) => shiftDateByDays(booking?.departureDate, -40);

// Due Date DP 2 = H+30 setelah DP pertama. DP pertama dianggap sama
// dengan tanggal booking ini pertama kali dicatat (createdAt booking selalu
// diisi dari tanggal setoran DP awal, lihat komentar di alur handleSubmit).
const getDueDateDP2 = (booking) => shiftDateByDays(booking?.createdAt, 30);

// true kalau tanggal due date (ISO 'YYYY-MM-DD') sudah lewat hari ini.
const isOverdue = (dueDateStr) => {
  if (!dueDateStr) return false;
  return dueDateStr < new Date().toISOString().slice(0, 10);
};

// Bungkus 1 baris "transaksi" hasil gabungan sejumlah dokumen payments_income
// (bisa 1 dokumen doang / beberapa dokumen hasil split ke banyak pax).
const buildTransactionRow = (docs, isFallbackMerge) => {
  const totalAmount = docs.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
  const first = docs[0];
  const isMerged = docs.length > 1;
  let notes = first.notes || '';
  if (isMerged) {
    notes = `${notes} (Dibagi ke ${docs.length} peserta)`;
    if (isFallbackMerge) notes += ' (digabung otomatis, estimasi)';
  }
  return {
    key: isMerged ? `merged_${docs.map(d => d.id).join('_')}` : first.id,
    docs,
    isMerged,
    amount: totalAmount,
    paymentMethod: first.paymentMethod,
    accountName: first.accountName || '',
    notes,
    createdAt: first.createdAt
  };
};

// Gabungkan seluruh payments_income yang keambil (lintas semua peserta dalam 1
// grup) jadi baris TRANSAKSI seperti yang aslinya dialami staff yang nyetor —
// bukan per-pax hasil split. Dokumen yang share `groupTransactionId` yang sama
// digabung sebagai 1 transaksi (akurat — field ini ditulis pas app benar-benar
// nge-split 1 setoran jadi beberapa dokumen). Buat data lama sebelum field ini
// ada (`groupTransactionId` kosong), dicoba fallback heuristik: dokumen yang
// metode & catatannya sama PERSIS dan createdAt-nya jatuh di menit yang sama
// dianggap 1 transaksi juga — tapi ini cuma tebakan (nggak ada bukti pasti),
// makanya ditandai jelas "(digabung otomatis, estimasi)" di catatannya.
const buildMergedGroupTransactions = (paymentsFlat) => {
  const withGtx = paymentsFlat.filter(p => p.groupTransactionId);
  const withoutGtx = paymentsFlat.filter(p => !p.groupTransactionId);

  const rows = [];

  // 1. Gabungan AKURAT — sama groupTransactionId
  const gtxMap = {};
  withGtx.forEach(p => {
    if (!gtxMap[p.groupTransactionId]) gtxMap[p.groupTransactionId] = [];
    gtxMap[p.groupTransactionId].push(p);
  });
  Object.values(gtxMap).forEach(docs => rows.push(buildTransactionRow(docs, false)));

  // 2. Fallback heuristik buat data lama tanpa groupTransactionId — sama
  // metode+catatan persis & createdAt di menit yang sama (slice 0,16 dari ISO
  // string) dianggap 1 transaksi. Kalau cuma ketemu 1 dokumen yang cocok
  // (nggak ada pasangannya), tetap ditampilkan berdiri sendiri sebagai
  // transaksi tunggal biasa — nggak dipaksa gabung.
  const fallbackMap = {};
  withoutGtx.forEach(p => {
    const key = `${p.paymentMethod || ''}||${p.notes || ''}||${(p.createdAt || '').slice(0, 16)}`;
    if (!fallbackMap[key]) fallbackMap[key] = [];
    fallbackMap[key].push(p);
  });
  Object.values(fallbackMap).forEach(docs => {
    if (docs.length >= 2) {
      rows.push(buildTransactionRow(docs, true));
    } else {
      docs.forEach(p => rows.push(buildTransactionRow([p], false)));
    }
  });

  return rows.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
};

// Bagi rata 1 nominal FLAT (biaya visa/tipping/diskon per kode booking, bukan
// per pax) ke N booking dalam 1 grup — sisa pembagian jatuh ke pax pertama,
// pola sama persis dengan pembagian setoran pembayaran. Dipakai biar jumlah
// totalAmount seluruh pax di grup tetap match sama total harga keseluruhan
// pemesanan pas dijumlah balik di ringkasan/invoice.
const splitFlatAmount = (amount, count) => {
  if (!count || count <= 0) return [];
  const baseShare = Math.floor(amount / count);
  const remainder = amount - (baseShare * count);
  return Array.from({ length: count }, (_, i) => baseShare + (i === 0 ? remainder : 0));
};

// Gabungkan balik daftar Biaya Tambahan / Potongan Harga dari seluruh booking
// dalam 1 grup jadi 1 daftar flat lagi — tiap booking nyimpen porsi hasil
// split-nya sendiri (array of {id, name, amount, notes}), dicocokkan lewat
// `id` yang sama biar nominalnya kejumlah balik ke nilai flat aslinya waktu
// mau ditampilkan/diedit ulang (mis. buka modal Edit Grup).
const mergeExtraLists = (items, key) => {
  const map = {};
  const order = [];
  (items || []).forEach(b => {
    (b[key] || []).forEach(entry => {
      if (!map[entry.id]) {
        map[entry.id] = { id: entry.id, name: entry.name || '', notes: entry.notes || '', amount: 0 };
        order.push(entry.id);
      }
      map[entry.id].amount += Number(entry.amount) || 0;
    });
  });
  return order.map(id => map[id]);
};

// Kapasitas orang per tipe kamar (dipakai untuk Rooming List)
const ROOM_CAPACITY = { Quad: 4, Triple: 3, Double: 2 };

// Daftar Dokumen Persyaratan Standard Travel (8 Dokumen)
const REQUIRED_DOCUMENTS = [
  { key: 'passport', label: 'Paspor Asli (Min. 6 Bln)' },
  { key: 'ktp_foto', label: 'Fotocopy KTP & Pasfoto 4x6' },
  { key: 'family_cert', label: 'Buku Nikah / Akta Lahir / KK' },
  { key: 'sponsor_letter', label: 'Surat Sponsor' },
  { key: 'bank_statement', label: 'Rekening Koran / Referensi Bank' },
  { key: 'vaccine_cert', label: 'Sertifikat Vaksin Meningitis' },
  { key: 'visa', label: 'Visa Umrah / Tour Issued' },
  { key: 'ticket', label: 'Tiket Pesawat (Penerbitan Issued)' }
];

export default function BookingsModule({ targetBookingId, theme = 'dark', userRole = '' }) {
  // Sinkron sama Firestore Rules: cuma Finance & Super Admin yang boleh edit/hapus
  // riwayat setoran yang udah tercatat. Semua staf tetap boleh lihat & catat DP baru.
  const roleLower = (userRole || '').toLowerCase();
  const isSales = roleLower === 'sales';
  const isOperational = roleLower === 'operational';
  const canManagePayments = roleLower.includes('super') || roleLower === 'admin' || roleLower === 'finance';
  // Edit Booking, Batalkan/Refund, dan Hapus Booking cuma boleh Finance & Super
  // Admin — ini yang megang keputusan soal uang customer.
  const canManageBookings = canManagePayments;
  // Reschedule tetap dibatasin ke Finance & Super Admin doang — Operational
  // & Sales nggak boleh.
  const canReschedule = canManageBookings;
  // Nyatet setoran DP awal boleh semua staf yang login — Operational sering
  // yang input booking + DP awal jamaah di lapangan, baru setoran berikutnya
  // dilanjutin tim Finance lewat Edit Booking (yang emang udah dibatasin
  // Finance & Super Admin doang di atas).
  const canRecordPayment = true;

  const isDark = theme === 'dark';

  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    tableHeaderBg: isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-slate-100 text-slate-500',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    tableRowBorder: isDark ? 'divide-slate-800/60' : 'divide-slate-200',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
  };

  const [bookings, setBookings] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [jamaahList, setJamaahList] = useState([]);
  const [financialAccounts, setFinancialAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // State Profil Perusahaan dari Settings
  const [companyInfo, setCompanyInfo] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // State Riwayat Setoran
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedBookingForHistory, setSelectedBookingForHistory] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [editingPaymentId, setEditingPaymentId] = useState(null);

  // State Monitoring Dokumen
  const [showDocModal, setShowDocModal] = useState(false);
  const [selectedBookingForDoc, setSelectedBookingForDoc] = useState(null);
  const [docChecklist, setDocChecklist] = useState({
    passport: false,
    ktp_foto: false,
    family_cert: false,
    sponsor_letter: false,
    bank_statement: false,
    vaccine_cert: false,
    visa: false,
    ticket: false
  });

  const [formData, setFormData] = useState({
    packageId: '',
    ordererId: '',
    // Daftar Peserta: array of { jamaahId: '' | '__new__' | <jamaah doc id>, newJamaah: { fullName, phone, nik, passportNumber } }.
    // Panjang list ini SELALU sama dengan paxCount (Pax 1 nggak lagi field terpisah).
    pesertaList: [{ jamaahId: '', newJamaah: { fullName: '', phone: '', nik: '', passportNumber: '' } }],
    roomType: 'Quad',
    busGroup: 'Bus 1',
    paxCount: 1,
    initialPayment: '',
    paymentMethod: 'Transfer Bank',
    // Akun Kas/Bank yang nerima setoran ini — cuma kepake kalau paymentMethod
    // BUKAN "Saldo Deposit" (itu bukan uang baru masuk kas, cuma mindahin
    // saldo titipan customer).
    accountId: '',
    paymentNotes: 'Setoran Pembayaran',
    // Tanggal setoran (bisa diubah staff kalau nyatet setoran yg telat
    // diinput) — default hari ini. Nilai awalnya di-inline (bukan panggil
    // todayDateStr()) soalnya helper itu dideklarasikan belakangan di bawah.
    paymentDate: new Date().toISOString().slice(0, 10),
    // Biaya Tambahan & Potongan Harga — masing2 daftar BEBAS (bisa nambah
    // berapa pun baris, nama & keterangan sendiri2, mis. Visa, Tipping,
    // Asuransi). Tiap baris nominalnya FLAT per 1 kode booking (bukan per
    // pax), otomatis dibagi rata ke semua peserta kalau booking-nya rombongan
    // (lihat splitFlatAmount & mergeExtraLists di atas). Bentuk tiap entry:
    // { id, name, amount, notes }.
    extraCharges: [],
    extraDiscounts: []
  });

  // Draft form buat nambah/edit 1 baris di tabel "Biaya Tambahan" & "Potongan
  // Harga" pada modal Registrasi/Edit Booking — dipisah dari formData karena
  // ini cuma state sementara pas lagi isi 1 baris, belum masuk ke daftar.
  const [chargeDraft, setChargeDraft] = useState({ name: '', amount: '', notes: '' });
  const [editingChargeId, setEditingChargeId] = useState(null);
  const [discountDraft, setDiscountDraft] = useState({ name: '', amount: '', notes: '' });
  const [editingDiscountId, setEditingDiscountId] = useState(null);

  // State form Pemesan (orderer) baru yang ditambahkan langsung dari modal Booking.
  // Pemesan cuma metadata booking (siapa yang mendaftarkan), bukan otomatis ikut
  // sebagai peserta/jamaah yang berangkat — makanya form-nya dipisah dari peserta.
  const [newOrdererForm, setNewOrdererForm] = useState({
    fullName: '', phone: '', nik: '', passportNumber: ''
  });

  // State grup mana yang lagi dibuka detailnya di Booking & Manifest (null = tampilan ringkasan grup)
  const [activeGroupCode, setActiveGroupCode] = useState(null);

  const [paymentEditForm, setPaymentEditForm] = useState({
    amount: '',
    paymentMethod: 'Transfer Bank',
    accountId: '',
    notes: '',
    date: ''
  });

  // State Filter Tampilan (Aktif / Semua / Dibatalkan / Reschedule)
  const [viewFilter, setViewFilter] = useState('active');

  // Filter berdasarkan Jatuh Tempo (DP 2 / Pelunasan) — dipakai buat nyari
  // booking yang perlu ditagih. 'all' = nggak difilter.
  const [dueDateFilter, setDueDateFilter] = useState('all');
  const DUE_SOON_DAYS = 7;

  // State baris mana yang lagi diperluas aksinya (kolom Aksi diminimalkan by default)
  const [expandedActionsId, setExpandedActionsId] = useState(null);

  // State Modal Batalkan / Reschedule Booking
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionMode, setActionMode] = useState('cancel'); // 'cancel' | 'reschedule'
  const [selectedBookingForAction, setSelectedBookingForAction] = useState(null);
  const [cancelForm, setCancelForm] = useState({
    refundAmount: '',
    refundMethod: 'Transfer Bank',
    reason: ''
  });
  const [rescheduleForm, setRescheduleForm] = useState({
    newPackageId: '',
    roomType: 'Quad',
    busGroup: 'Bus 1'
  });

  // State Modal Setoran Grup — catat 1 pembayaran buat 1 grup booking sekaligus,
  // nominalnya dibagi rata ke semua pax dalam grup (sama kayak alur DP awal pas
  // registrasi grup baru).
  const [showGroupPaymentModal, setShowGroupPaymentModal] = useState(false);
  const [groupPaymentTarget, setGroupPaymentTarget] = useState(null);
  const [groupPaymentForm, setGroupPaymentForm] = useState({
    amount: '',
    paymentMethod: 'Transfer Bank',
    accountId: '',
    notes: 'Setoran Tambahan',
    // Sama kayak formData.paymentDate — nilai awalnya di-inline (bukan
    // panggil todayDateStr()) soalnya helper itu dideklarasikan belakangan.
    date: new Date().toISOString().slice(0, 10)
  });

  // State Modal Riwayat & Setoran Pembayaran GRUP — agregator kenyamanan yang
  // nampilin riwayat setoran SEMUA peserta dalam 1 grup sekaligus (per orang
  // tetap punya subsection sendiri, nominalnya nggak digabung/dijumlah jadi 1).
  const [showGroupHistoryModal, setShowGroupHistoryModal] = useState(false);
  const [groupHistoryItems, setGroupHistoryItems] = useState([]);
  // Riwayat setoran per booking, di-keyed by bookingId: { [bookingId]: payment[] }
  const [groupHistoryPayments, setGroupHistoryPayments] = useState({});
  const [editingGroupPaymentId, setEditingGroupPaymentId] = useState(null);

  // State Modal Edit Booking GRUP — modal kecil terpisah dari modal registrasi
  // besar, cuma buat field yang emang shared ke SELURUH grup (Paket, Pemesan,
  // Tipe Kamar, Alokasi Bus). Identitas peserta TETAP cuma bisa diubah lewat
  // Edit Booking per-peserta di "Aksi Lainnya".
  const [showGroupEditModal, setShowGroupEditModal] = useState(false);
  const [groupEditTarget, setGroupEditTarget] = useState(null);
  const [groupEditForm, setGroupEditForm] = useState({
    packageId: '',
    ordererId: '',
    roomType: 'Quad',
    busGroup: 'Bus 1',
    // Bagian "Tambah Setoran" opsional — kalau diisi, dibagi rata ke semua
    // pax aktif di grup ini (pola sama persis kayak modal Setoran Grup).
    addPaymentAmount: '',
    addPaymentMethod: 'Transfer Bank',
    addAccountId: '',
    addPaymentNotes: 'Setoran Tambahan',
    addPaymentDate: new Date().toISOString().slice(0, 10),
    // Biaya Tambahan & Potongan Harga — daftar bebas, flat per kode booking
    // rombongan, dibagi rata ke semua pax aktif (sama pola kayak
    // splitFlatAmount/mergeExtraLists di form registrasi).
    extraCharges: [],
    extraDiscounts: []
  });
  const [groupChargeDraft, setGroupChargeDraft] = useState({ name: '', amount: '', notes: '' });
  const [editingGroupChargeId, setEditingGroupChargeId] = useState(null);
  const [groupDiscountDraft, setGroupDiscountDraft] = useState({ name: '', amount: '', notes: '' });
  const [editingGroupDiscountId, setEditingGroupDiscountId] = useState(null);
  const [groupEditNewOrdererForm, setGroupEditNewOrdererForm] = useState({
    fullName: '', phone: '', nik: '', passportNumber: ''
  });

  // "Tambah Peserta Baru" di dalam modal Edit Grup — buat peserta yang nyusul
  // belakangan ke grup booking yang sudah ada (bahkan yang udah ada riwayat
  // pembayaran). Sengaja dipisah dari form Edit Grup utama (bukan bagian dari
  // handleGroupEditSubmit) biar nggak nyampur sama logika ganti paket/kamar
  // yang berlaku ke SEMUA pax — nambah 1 peserta baru itu aksi independen.
  const [addPaxForm, setAddPaxForm] = useState({
    jamaahId: '',
    newJamaah: { fullName: '', phone: '', nik: '', passportNumber: '' },
    roomType: 'Quad'
  });

  // State Modal Reschedule GRUP — reschedule SEMUA pax aktif dalam grup
  // sekaligus ke 1 paket tujuan yang sama, jadi 1 grup baru.
  const [showGroupRescheduleModal, setShowGroupRescheduleModal] = useState(false);
  const [groupRescheduleTarget, setGroupRescheduleTarget] = useState(null);
  const [groupRescheduleForm, setGroupRescheduleForm] = useState({
    newPackageId: '',
    roomType: 'Quad',
    busGroup: 'Bus 1'
  });

  // State Modal Batalkan / Refund GRUP — nominal refund total dibagi rata ke
  // semua pax aktif di grup (pola sama kayak Setoran Grup / DP awal grup).
  const [showGroupCancelModal, setShowGroupCancelModal] = useState(false);
  const [groupCancelTarget, setGroupCancelTarget] = useState(null);
  const [groupCancelForm, setGroupCancelForm] = useState({
    refundAmount: '',
    refundMethod: 'Transfer Bank',
    reason: ''
  });

  // State Modal Rooming List
  const [showRoomingModal, setShowRoomingModal] = useState(false);
  const [roomingPackageId, setRoomingPackageId] = useState('');

  // State Modal Kirim Feedback Massal
  const [showBulkFeedbackModal, setShowBulkFeedbackModal] = useState(false);
  const [bulkFeedbackPackageId, setBulkFeedbackPackageId] = useState('');
  const [sentFeedbackIds, setSentFeedbackIds] = useState([]);

  // Ambil Data Pengaturan Perusahaan Dinamis dari Firestore
  useEffect(() => {
    const fetchCompanyInfo = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'settings', 'company_profile'));
        if (docSnap.exists()) {
          setCompanyInfo(docSnap.data().company);
        }
      } catch (err) {
        console.error("Gagal mengambil data profil perusahaan untuk invoice:", err);
      }
    };
    fetchCompanyInfo();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const pkgSnap = await getDocs(collection(db, 'packages'));
      setPackagesList(pkgSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const jmhSnap = await getDocs(collection(db, 'jamaah'));
      setJamaahList(jmhSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const accSnap = await getDocs(collection(db, 'financial_accounts'));
      setFinancialAccounts(accSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const bkSnap = await getDocs(collection(db, 'bookings'));
      setBookings(bkSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Gagal mengambil data booking:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Dipicu dari modul lain (mis. link "Kode Booking" di modul Keuangan) —
  // langsung buka layar detail GRUP (tombol Opsi: Riwayat Pembayaran, Edit,
  // Reschedule, Batalkan, Hapus, Cetak Invoice) berdasarkan kode booking,
  // bukan langsung ke modal Riwayat Pembayaran per-peserta yang lama.
  useEffect(() => {
    if (targetBookingId && bookings.length > 0) {
      const found = bookings.find(b => b.id === targetBookingId);
      if (found) {
        setActiveGroupCode(found.groupBookingCode || found.bookingCode);
      }
    }
  }, [targetBookingId, bookings]);

  // HELPER FORMAT & KIRIM PESAN WHATSAPP
  const sendWhatsAppNotification = (booking) => {
    const jamaahData = jamaahList.find(j => j.id === booking.jamaahId || j.fullName === booking.jamaahName);
    
    if (!jamaahData || !jamaahData.phone) {
      alert("Nomor HP/WhatsApp jamaah tidak ditemukan pada Data Master Jamaah.");
      return;
    }

    let cleanPhone = jamaahData.phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.slice(1);
    }

    const isLunas = booking.paymentStatus === 'Full Payment';
    const totalAmount = Number(booking.totalAmount || 0).toLocaleString('id-ID');
    const totalPaid = Number(booking.totalPaid || 0).toLocaleString('id-ID');
    const sisa = (Number(booking.totalAmount || 0) - Number(booking.totalPaid || 0)).toLocaleString('id-ID');

    const companyName = companyInfo?.name || 'PT. WISATA HALAL INTERNASIONAL';

    const message = `*KONFIRMASI BOOKING PROGRAM TRAVEL*
*${companyName.toUpperCase()}*
--------------------------------------------------
Assalamu'alaikum Wr. Wb.
Yth. Bpk/Ibu *${booking.jamaahName}* (${jamaahData.customerCode || 'CST'}),

Terima kasih telah mendaftar program perjalanan ibadah bersama kami. Berikut rincian booking Anda:

📋 *DETAIL BOOKING & MANIFEST:*
• *Kode Booking:* ${booking.bookingCode}
• *Program Paket:* ${booking.packageName}
• *Tgl Keberangkatan:* ${formatDateDDMMYYYY(booking.departureDate)}
• *Tipe Kamar / Bus:* ${booking.roomType} / ${booking.busGroup}

💰 *RINGKASAN KEUANGAN:*
• *Total Tagihan:* Rp ${totalAmount}
• *Setoran Diterima:* Rp ${totalPaid}
• *Sisa Tagihan / Saldo:* Rp ${sisa}
• *Status Pembayaran:* ${isLunas ? '✅ LUNAS' : '⏳ DP Paid'}

📌 *CATATAN BERKAS DOKUMEN:*
Mohon melengkapi 8 berkas dokumen (Paspor, KTP/Foto, Buku Nikah, Surat Sponsor, Rekening Koran, Vaksin Meningitis, Visa, & Tiket).

Apabila ada pertanyaan lebih lanjut, silakan hubungi tim kami.
Terima kasih.`;

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMessage}`, '_blank');
  };

  // Kirim link form feedback pasca-trip ke jamaah via WhatsApp (tanpa perlu login WHISys)
  const handleShareFeedbackLink = (booking) => {
    const jamaahData = jamaahList.find(j => j.id === booking.jamaahId || j.fullName === booking.jamaahName);

    if (!jamaahData || !jamaahData.phone) {
      alert("Nomor HP/WhatsApp jamaah tidak ditemukan pada Data Master Jamaah.");
      return;
    }

    let cleanPhone = jamaahData.phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.slice(1);
    }

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const feedbackUrl = `${baseUrl}/feedback/${booking.bookingCode}?j=${encodeURIComponent(booking.jamaahName || '')}&p=${encodeURIComponent(booking.packageName || '')}&pid=${encodeURIComponent(booking.packageId || '')}`;

    const message = `Assalamu'alaikum Wr. Wb.
Yth. Bpk/Ibu *${booking.jamaahName}*,

Terima kasih telah mempercayakan perjalanan Anda bersama kami. Kami sangat menghargai kalau Bapak/Ibu berkenan meluangkan waktu sebentar buat memberi ulasan pengalaman perjalanan lewat link berikut:

${feedbackUrl}

Masukan dari Bapak/Ibu sangat berarti buat kami terus meningkatkan kualitas layanan. Terima kasih 🙏`;

    window.open(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`, '_blank');
  };

  // Tanggal hari ini dlm format yyyy-mm-dd, dipakai sebagai default value
  // field input tanggal setoran (type="date") di berbagai form pembayaran.
  const todayDateStr = () => new Date().toISOString().slice(0, 10);

  // Gabungin tanggal yang dipilih staff (dari field <input type="date">) sama
  // jam-menit-detik SEKARANG, jadi field createdAt di payments_income tetap
  // bisa diurutkan kronologis dgn wajar meski tanggalnya di-set mundur/maju
  // (misal nyatet setoran yg baru ketauan/telat diinput). Kalau field
  // tanggalnya kosong/invalid, fallback ke waktu sekarang penuh.
  const resolvePaymentCreatedAt = (dateStr) => {
    if (!dateStr) return new Date().toISOString();
    const now = new Date();
    const timePart = now.toTimeString().slice(0, 8); // HH:MM:SS
    const combined = new Date(`${dateStr}T${timePart}`);
    return isNaN(combined.getTime()) ? now.toISOString() : combined.toISOString();
  };

  // Tanggal setoran (DP maupun tambahan) nggak boleh diisi SEBELUM tanggal
  // pemesanan/booking-nya sendiri dibuat — nggak masuk akal ada uang masuk
  // sebelum bookingnya ada. Ambil bagian yyyy-mm-dd doang dari createdAt biar
  // perbandingannya adil (createdAt aslinya nyimpen jam-menit-detik juga).
  const getBookingMinDate = (createdAt) => (createdAt ? String(createdAt).slice(0, 10) : '');
  const isPaymentDateBeforeBooking = (paymentDateStr, bookingCreatedAt) => {
    const minDate = getBookingMinDate(bookingCreatedAt);
    return !!(paymentDateStr && minDate && paymentDateStr < minDate);
  };

  const syncBookingTotalPaid = async (bookingId, totalTagihan) => {
    try {
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', bookingId));
      const snap = await getDocs(q);
      const totalPaidReal = snap.docs.reduce((acc, curr) => acc + (Number(curr.data().amount) || 0), 0);
      const status = totalPaidReal >= totalTagihan ? 'Full Payment' : 'DP Paid';

      await updateDoc(doc(db, 'bookings', bookingId), {
        totalPaid: totalPaidReal,
        paymentStatus: status
      });
      return { totalPaidReal, status };
    } catch (err) {
      console.error("Gagal sinkronisasi pembayaran:", err);
    }
  };

  const fetchPaymentHistory = async (bookingId) => {
    try {
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', bookingId));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setPaymentHistory(list);
      return list;
    } catch (err) {
      console.error("Gagal mengambil riwayat pembayaran:", err);
      return [];
    }
  };

  const handleOpenHistory = async (item) => {
    setSelectedBookingForHistory(item);
    await fetchPaymentHistory(item.id);
    await syncBookingTotalPaid(item.id, item.totalAmount);
    setShowHistoryModal(true);
  };

  const handleOpenDocModal = (item) => {
    setSelectedBookingForDoc(item);
    setDocChecklist({
      passport: item.documents?.passport || false,
      ktp_foto: item.documents?.ktp_foto || false,
      family_cert: item.documents?.family_cert || false,
      sponsor_letter: item.documents?.sponsor_letter || false,
      bank_statement: item.documents?.bank_statement || false,
      vaccine_cert: item.documents?.vaccine_cert || false,
      visa: item.documents?.visa || false,
      ticket: item.documents?.ticket || false
    });
    setShowDocModal(true);
  };

  const handleSaveDocChecklist = async () => {
    if (!selectedBookingForDoc) return;
    try {
      await updateDoc(doc(db, 'bookings', selectedBookingForDoc.id), {
        documents: docChecklist,
        updatedAt: new Date().toISOString()
      });
      setShowDocModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal memperbarui status dokumen: " + err.message);
    }
  };

  const handleDeletePayment = async (payId) => {
    if (!canManagePayments) {
      alert("Cuma Finance & Super Admin yang boleh menghapus riwayat pembayaran.");
      return;
    }
    if (!confirm("Apakah Anda yakin ingin menghapus catatan pembayaran ini?")) return;
    try {
      const oldPay = paymentHistory.find(p => p.id === payId);
      await deleteDoc(doc(db, 'payments_income', payId));
      // Balikin lagi saldo akun Kas/Bank asalnya (kalau bukan dibayar pakai
      // Saldo Deposit — itu nggak nyentuh akun sama sekali).
      if (oldPay?.accountId) await removeAccountMutationBySource(oldPay.accountId, payId, -(Number(oldPay.amount) || 0));
      await syncBookingTotalPaid(selectedBookingForHistory.id, selectedBookingForHistory.totalAmount);
      await fetchPaymentHistory(selectedBookingForHistory.id);
      fetchData();
    } catch (err) {
      alert("Gagal menghapus pembayaran: " + err.message);
    }
  };

  const handleSavePaymentEdit = async (payId) => {
    if (!canManagePayments) {
      alert("Cuma Finance & Super Admin yang boleh mengedit riwayat pembayaran.");
      return;
    }
    const oldPay = paymentHistory.find(p => p.id === payId);
    if (oldPay && (oldPay.paymentMethod === 'Saldo Deposit') !== (paymentEditForm.paymentMethod === 'Saldo Deposit')) {
      alert("Ganti Metode Bayar ke/dari \"Saldo Deposit\" nggak bisa lewat edit ini (biar saldo deposit & akun Kas/Bank tetap akurat). Hapus catatan ini, terus catat ulang lewat \"+Bayar\".");
      return;
    }
    if (paymentEditForm.date && isPaymentDateBeforeBooking(paymentEditForm.date, selectedBookingForHistory?.createdAt)) {
      const minDate = getBookingMinDate(selectedBookingForHistory?.createdAt);
      alert(`Tanggal setoran nggak boleh sebelum tanggal pemesanan ${selectedBookingForHistory?.bookingCode || ''} dibuat (${minDate.split('-').reverse().join('/')}).`);
      return;
    }
    try {
      await updateDoc(doc(db, 'payments_income', payId), {
        amount: Number(paymentEditForm.amount),
        paymentMethod: paymentEditForm.paymentMethod,
        notes: paymentEditForm.notes,
        ...(paymentEditForm.paymentMethod !== 'Saldo Deposit' ? { accountId: paymentEditForm.accountId, accountName: financialAccounts.find(a => a.id === paymentEditForm.accountId)?.name || '' } : {}),
        // Kalau field tanggalnya dikosongin, biarin createdAt lama (jangan
        // dipaksa ke waktu sekarang) — cuma di-update kalau staff emang
        // sengaja ganti tanggalnya.
        ...(paymentEditForm.date ? { createdAt: resolvePaymentCreatedAt(paymentEditForm.date) } : {})
      });

      // Selisih nominal lama vs baru disesuaikan ke akun yang sama (edit ini
      // nggak dukung pindah akun sekaligus ganti nominal, biar simpel).
      if (oldPay?.accountId && paymentEditForm.paymentMethod !== 'Saldo Deposit') {
        const delta = Number(paymentEditForm.amount) - (Number(oldPay.amount) || 0);
        await updateAccountMutationAmount(oldPay.accountId, payId, Number(paymentEditForm.amount), delta);
      }

      setEditingPaymentId(null);
      await syncBookingTotalPaid(selectedBookingForHistory.id, selectedBookingForHistory.totalAmount);
      await fetchPaymentHistory(selectedBookingForHistory.id);
      fetchData();
    } catch (err) {
      alert("Gagal memperbarui pembayaran: " + err.message);
    }
  };

  // Bikin satu slot kosong Daftar Peserta (dipakai pas nambah pax / buka modal Tambah Booking)
  const emptyPesertaEntry = () => ({ jamaahId: '', newJamaah: { fullName: '', phone: '', nik: '', passportNumber: '' } });

  const handleOpenAddModal = () => {
    setEditingBookingId(null);
    setFormData({
      packageId: '', ordererId: '', pesertaList: [emptyPesertaEntry()],
      roomType: 'Quad', busGroup: 'Bus 1', paxCount: 1,
      initialPayment: '', paymentMethod: 'Transfer Bank', accountId: '', paymentNotes: 'DP Pendaftaran',
      paymentDate: todayDateStr(),
      extraCharges: [], extraDiscounts: []
    });
    setChargeDraft({ name: '', amount: '', notes: '' });
    setEditingChargeId(null);
    setDiscountDraft({ name: '', amount: '', notes: '' });
    setEditingDiscountId(null);
    setNewOrdererForm({ fullName: '', phone: '', nik: '', passportNumber: '' });
    setShowModal(true);
  };

  const handleOpenEditModal = (item) => {
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh mengedit booking.");
      return;
    }
    setEditingBookingId(item.id);
    setFormData({
      packageId: item.packageId || '',
      // Booking lama belum punya field Pemesan. Kalau ada namanya tapi ID-nya
      // kosong, arahkan ke opsi "Tambah Pemesan Baru" & prefill namanya biar
      // Finance/Admin gampang lengkapi datanya lewat Edit Booking.
      ordererId: item.ordererId || (item.ordererName ? '__new__' : ''),
      // Edit selalu berkaitan sama 1 booking/pax existing — Daftar Peserta cuma 1
      // entry, di-preselect ke jamaahId booking ini, tapi tetap bisa diganti.
      pesertaList: [{ jamaahId: item.jamaahId || '', newJamaah: { fullName: '', phone: '', nik: '', passportNumber: '' } }],
      roomType: item.roomType || 'Quad',
      busGroup: item.busGroup || 'Bus 1',
      paxCount: 1,
      initialPayment: '',
      paymentMethod: 'Transfer Bank',
      accountId: '',
      paymentNotes: 'Setoran Tambahan',
      paymentDate: todayDateStr(),
      // Prefill Biaya Tambahan & Potongan Harga booking ini kalau sebelumnya
      // udah pernah diisi.
      extraCharges: item.extraCharges || [],
      extraDiscounts: item.extraDiscounts || []
    });
    setChargeDraft({ name: '', amount: '', notes: '' });
    setEditingChargeId(null);
    setDiscountDraft({ name: '', amount: '', notes: '' });
    setEditingDiscountId(null);
    setNewOrdererForm({ fullName: item.ordererName || '', phone: '', nik: '', passportNumber: '' });
    setShowModal(true);
  };

  // ===== Handler baris dinamis Biaya Tambahan & Potongan Harga — Form Registrasi/Edit Booking =====
  const handleSaveChargeRow = () => {
    const name = (chargeDraft.name || '').trim();
    const amount = Number(chargeDraft.amount) || 0;
    if (!name) { alert('Nama biaya wajib diisi.'); return; }
    setFormData(prev => {
      const list = prev.extraCharges || [];
      if (editingChargeId) {
        return { ...prev, extraCharges: list.map(c => c.id === editingChargeId ? { ...c, name, amount, notes: chargeDraft.notes || '' } : c) };
      }
      const newRow = { id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, amount, notes: chargeDraft.notes || '' };
      return { ...prev, extraCharges: [...list, newRow] };
    });
    setChargeDraft({ name: '', amount: '', notes: '' });
    setEditingChargeId(null);
  };
  const handleEditChargeRow = (row) => {
    setEditingChargeId(row.id);
    setChargeDraft({ name: row.name || '', amount: row.amount ?? '', notes: row.notes || '' });
  };
  const handleCancelChargeEdit = () => {
    setEditingChargeId(null);
    setChargeDraft({ name: '', amount: '', notes: '' });
  };
  const handleDeleteChargeRow = (id) => {
    setFormData(prev => ({ ...prev, extraCharges: (prev.extraCharges || []).filter(c => c.id !== id) }));
    if (editingChargeId === id) handleCancelChargeEdit();
  };

  const handleSaveDiscountRow = () => {
    const name = (discountDraft.name || '').trim();
    const amount = Number(discountDraft.amount) || 0;
    if (!name) { alert('Nama diskon wajib diisi.'); return; }
    setFormData(prev => {
      const list = prev.extraDiscounts || [];
      if (editingDiscountId) {
        return { ...prev, extraDiscounts: list.map(d => d.id === editingDiscountId ? { ...d, name, amount, notes: discountDraft.notes || '' } : d) };
      }
      const newRow = { id: `dsc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, amount, notes: discountDraft.notes || '' };
      return { ...prev, extraDiscounts: [...list, newRow] };
    });
    setDiscountDraft({ name: '', amount: '', notes: '' });
    setEditingDiscountId(null);
  };
  const handleEditDiscountRow = (row) => {
    setEditingDiscountId(row.id);
    setDiscountDraft({ name: row.name || '', amount: row.amount ?? '', notes: row.notes || '' });
  };
  const handleCancelDiscountEdit = () => {
    setEditingDiscountId(null);
    setDiscountDraft({ name: '', amount: '', notes: '' });
  };
  const handleDeleteDiscountRow = (id) => {
    setFormData(prev => ({ ...prev, extraDiscounts: (prev.extraDiscounts || []).filter(d => d.id !== id) }));
    if (editingDiscountId === id) handleCancelDiscountEdit();
  };

  // ===== Handler baris dinamis Biaya Tambahan & Potongan Harga — Modal Edit Grup =====
  const handleSaveGroupChargeRow = () => {
    const name = (groupChargeDraft.name || '').trim();
    const amount = Number(groupChargeDraft.amount) || 0;
    if (!name) { alert('Nama biaya wajib diisi.'); return; }
    setGroupEditForm(prev => {
      const list = prev.extraCharges || [];
      if (editingGroupChargeId) {
        return { ...prev, extraCharges: list.map(c => c.id === editingGroupChargeId ? { ...c, name, amount, notes: groupChargeDraft.notes || '' } : c) };
      }
      const newRow = { id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, amount, notes: groupChargeDraft.notes || '' };
      return { ...prev, extraCharges: [...list, newRow] };
    });
    setGroupChargeDraft({ name: '', amount: '', notes: '' });
    setEditingGroupChargeId(null);
  };
  const handleEditGroupChargeRow = (row) => {
    setEditingGroupChargeId(row.id);
    setGroupChargeDraft({ name: row.name || '', amount: row.amount ?? '', notes: row.notes || '' });
  };
  const handleCancelGroupChargeEdit = () => {
    setEditingGroupChargeId(null);
    setGroupChargeDraft({ name: '', amount: '', notes: '' });
  };
  const handleDeleteGroupChargeRow = (id) => {
    setGroupEditForm(prev => ({ ...prev, extraCharges: (prev.extraCharges || []).filter(c => c.id !== id) }));
    if (editingGroupChargeId === id) handleCancelGroupChargeEdit();
  };

  const handleSaveGroupDiscountRow = () => {
    const name = (groupDiscountDraft.name || '').trim();
    const amount = Number(groupDiscountDraft.amount) || 0;
    if (!name) { alert('Nama diskon wajib diisi.'); return; }
    setGroupEditForm(prev => {
      const list = prev.extraDiscounts || [];
      if (editingGroupDiscountId) {
        return { ...prev, extraDiscounts: list.map(d => d.id === editingGroupDiscountId ? { ...d, name, amount, notes: groupDiscountDraft.notes || '' } : d) };
      }
      const newRow = { id: `dsc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, amount, notes: groupDiscountDraft.notes || '' };
      return { ...prev, extraDiscounts: [...list, newRow] };
    });
    setGroupDiscountDraft({ name: '', amount: '', notes: '' });
    setEditingGroupDiscountId(null);
  };
  const handleEditGroupDiscountRow = (row) => {
    setEditingGroupDiscountId(row.id);
    setGroupDiscountDraft({ name: row.name || '', amount: row.amount ?? '', notes: row.notes || '' });
  };
  const handleCancelGroupDiscountEdit = () => {
    setEditingGroupDiscountId(null);
    setGroupDiscountDraft({ name: '', amount: '', notes: '' });
  };
  const handleDeleteGroupDiscountRow = (id) => {
    setGroupEditForm(prev => ({ ...prev, extraDiscounts: (prev.extraDiscounts || []).filter(d => d.id !== id) }));
    if (editingGroupDiscountId === id) handleCancelGroupDiscountEdit();
  };

  // Sesuaikan panjang Daftar Peserta saat Jumlah Pax berubah: nambah -> tambah
  // slot kosong di akhir, ngurangin -> potong dari akhir, minimal tetap 1.
  const handlePaxCountChange = (value) => {
    const count = Math.max(1, Math.min(20, Number(value) || 1));
    setFormData(prev => {
      const currentList = prev.pesertaList || [];
      let newList;
      if (count > currentList.length) {
        const additions = Array.from({ length: count - currentList.length }, () => emptyPesertaEntry());
        newList = [...currentList, ...additions];
      } else {
        newList = currentList.slice(0, Math.max(1, count));
      }
      return { ...prev, paxCount: count, pesertaList: newList };
    });
  };

  // Ganti pilihan jamaah (existing / __new__) utk satu slot Daftar Peserta
  const handlePesertaJamaahIdChange = (idx, value) => {
    setFormData(prev => {
      const updated = [...prev.pesertaList];
      updated[idx] = { ...updated[idx], jamaahId: value };
      return { ...prev, pesertaList: updated };
    });
  };

  // Ganti isian form "Tambah Jamaah Baru" utk satu slot Daftar Peserta
  const handlePesertaNewJamaahChange = (idx, field, value) => {
    setFormData(prev => {
      const updated = [...prev.pesertaList];
      updated[idx] = { ...updated[idx], newJamaah: { ...updated[idx].newJamaah, [field]: value } };
      return { ...prev, pesertaList: updated };
    });
  };

  // Generate kode customer baru mengikuti pola CSTxxxxxx (sama seperti di Data Master Jamaah)
  const generateNextCustomerCode = (existingList) => {
    let maxNum = 2000;
    existingList.forEach(j => {
      if (j.customerCode && j.customerCode.startsWith('CST')) {
        const numPart = parseInt(j.customerCode.replace('CST', ''), 10);
        if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
      }
    });
    return `CST${String(maxNum + 1).padStart(6, '0')}`;
  };

  const handleDeleteBooking = async (item) => {
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh menghapus booking.");
      return;
    }
    try {
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', item.id));
      const paySnap = await getDocs(q);

      if (!paySnap.empty) {
        alert(`Booking ${item.bookingCode} tidak dapat dihapus karena masih memiliki ${paySnap.size} riwayat transaksi pembayaran di Arus Kas.\n\nSilakan hapus semua riwayat pembayaran jamaah ini terlebih dahulu di menu Arus Kas/Riwayat Setoran.`);
        return;
      }

      if (!confirm(`Apakah Anda yakin ingin menghapus booking ${item.bookingCode}?`)) return;

      await deleteDoc(doc(db, 'bookings', item.id));

      if (item.packageId) {
        // Pakai increment() (atomic di server) — bukan baca-lalu-tulis dari
        // client — supaya nggak salah hitung kalau ada aksi lain yang
        // barengan ubah kuota paket yang sama. Dibungkus try/catch sendiri:
        // booking-nya udah kehapus duluan, jangan sampai gagal nambah balik
        // kuota (mis. paketnya udah kehapus juga) bikin proses ini error.
        try {
          await updateDoc(doc(db, 'packages', item.packageId), { quotaRemaining: increment(1) });
        } catch (quotaErr) {
          console.error('Gagal mengembalikan kuota paket:', quotaErr);
        }
      }

      fetchData();
    } catch (err) {
      alert("Gagal menghapus booking: " + err.message);
    }
  };

  // ============ ALUR BATALKAN / RESCHEDULE BOOKING ============

  const handleOpenActionModal = (item, mode) => {
    if (mode === 'reschedule' && !canReschedule) {
      alert("Cuma Finance & Super Admin yang boleh reschedule booking.");
      return;
    }
    if (mode === 'cancel' && !canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh membatalkan booking & proses refund.");
      return;
    }
    setSelectedBookingForAction(item);
    setActionMode(mode);
    setCancelForm({
      refundAmount: item.totalPaid || 0,
      refundMethod: 'Transfer Bank',
      reason: ''
    });
    setRescheduleForm({
      newPackageId: '',
      roomType: item.roomType || 'Quad',
      busGroup: item.busGroup || 'Bus 1'
    });
    setShowActionModal(true);
  };

  // Melepas kembali kuota seat ke paket terkait (dipakai saat batal/reschedule).
  // Pakai increment() (atomic di server), bukan baca-lalu-tulis dari client,
  // supaya nggak salah hitung kalau ada booking lain yang barengan ubah
  // kuota paket yang sama.
  const releaseQuotaToPackage = async (packageId) => {
    if (!packageId) return;
    try {
      await updateDoc(doc(db, 'packages', packageId), { quotaRemaining: increment(1) });
    } catch (quotaErr) {
      console.error('Gagal mengembalikan kuota paket:', quotaErr);
    }
  };

  // Saldo Deposit nempel ke Pemesan (data di collection 'jamaah'), bukan ke
  // booking. delta positif = nambah saldo (top up / konversi refund batal),
  // delta negatif = pakai saldo buat bayar. Tiap perubahan juga dicatat ke
  // 'deposit_ledger' biar ada riwayatnya.
  const adjustDepositBalance = async (customerId, customerName, delta, type, notes, bookingCode) => {
    if (!customerId || !delta) return;
    await updateDoc(doc(db, 'jamaah', customerId), { depositBalance: increment(delta) });
    await addDoc(collection(db, 'deposit_ledger'), {
      customerId,
      customerName: customerName || '-',
      type,
      amount: delta,
      notes: notes || '',
      bookingCode: bookingCode || '',
      createdAt: new Date().toISOString()
    });
  };

  // Saldo tiap akun Kas/Bank (collection 'financial_accounts') — delta
  // positif = uang beneran masuk (setoran jamaah), delta negatif = keluar.
  // Metode Bayar "Saldo Deposit" SENGAJA nggak lewat sini — itu cuma
  // mindahin saldo titipan customer, bukan uang baru yang masuk ke kas.
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
      // sourceDocId = ID dokumen transaksi asal (payments_income/dst) —
      // dipakai buat nemuin & ngapus/nyesuain baris ini lagi kalau
      // transaksinya diedit/dihapus, biar riwayat mutasi nggak numpuk
      // baris "koreksi" tiap ada perubahan.
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

  // Update NOMINAL baris account_mutations yang berasal dari satu dokumen
  // transaksi (dicari lewat sourceDocId) — dipake pas transaksi asalnya
  // diedit nominalnya, biar riwayat mutasi tetap 1 baris per transaksi
  // (bukan nambah baris "koreksi edit"). Saldo akun disesuaikan pakai delta.
  const updateAccountMutationAmount = async (accountId, sourceDocId, newAmount, delta) => {
    if (!accountId) return;
    if (delta) {
      await updateDoc(doc(db, 'financial_accounts', accountId), { balance: increment(delta) });
    }
    if (!sourceDocId) return;
    try {
      const q = query(collection(db, 'account_mutations'), where('accountId', '==', accountId), where('sourceDocId', '==', sourceDocId));
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map(d => updateDoc(d.ref, { amount: Math.abs(newAmount) })));
    } catch (err) {
      console.error('Gagal memperbarui riwayat mutasi terkait:', err);
    }
  };

  const handleCancelSubmit = async (e) => {
    e.preventDefault();
    if (!selectedBookingForAction) return;
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh memproses pembatalan/refund.");
      return;
    }

    try {
      const refundAmountVal = Number(cancelForm.refundAmount || 0);
      await updateDoc(doc(db, 'bookings', selectedBookingForAction.id), {
        status: 'cancelled',
        cancelReason: cancelForm.reason || '-',
        refundAmount: refundAmountVal,
        refundMethod: cancelForm.refundMethod,
        cancelledAt: new Date().toISOString()
      });

      // Kalau refund-nya dipindah jadi Saldo Deposit (bukan ditransfer balik
      // ke rekening customer), saldo Pemesan booking ini ditambah otomatis.
      if (cancelForm.refundMethod === 'Deposit / Saldo Akun' && refundAmountVal > 0 && selectedBookingForAction.ordererId) {
        await adjustDepositBalance(
          selectedBookingForAction.ordererId,
          selectedBookingForAction.ordererName,
          refundAmountVal,
          'refund_conversion',
          `Konversi refund pembatalan booking ${selectedBookingForAction.bookingCode}`,
          selectedBookingForAction.bookingCode
        );
      }

      // Kuota seat yang dibatalkan dikembalikan ke paket
      await releaseQuotaToPackage(selectedBookingForAction.packageId);

      setShowActionModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal memproses pembatalan: " + err.message);
    }
  };

  const handleRescheduleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedBookingForAction) return;
    if (!canReschedule) {
      alert("Cuma Finance & Super Admin yang boleh memproses reschedule.");
      return;
    }
    if (!rescheduleForm.newPackageId) {
      alert("Pilih paket/keberangkatan tujuan reschedule.");
      return;
    }

    try {
      const oldBooking = selectedBookingForAction;
      const newPkg = packagesList.find(p => p.id === rescheduleForm.newPackageId);
      if (!newPkg) return;

      if (Number(newPkg.quotaRemaining || 0) <= 0) {
        alert("Kuota paket tujuan sudah habis!");
        return;
      }

      let newPrice = Number(newPkg.priceQuad || newPkg.priceMain || 0);
      if (rescheduleForm.roomType === 'Triple') newPrice = Number(newPkg.priceTriple || newPrice);
      if (rescheduleForm.roomType === 'Double') newPrice = Number(newPkg.priceDouble || newPrice);

      const carryOverAmount = Number(oldBooking.totalPaid || 0);
      const newBookingCode = `BK-${Date.now().toString().slice(-6)}`;

      // 1. Buat booking baru di paket tujuan
      const newBookingRef = await addDoc(collection(db, 'bookings'), {
        bookingCode: newBookingCode,
        packageId: newPkg.id,
        packageName: newPkg.name,
        packageCode: newPkg.code,
        departureDate: newPkg.departureDate,
        jamaahId: oldBooking.jamaahId,
        jamaahName: oldBooking.jamaahName,
        passportNumber: oldBooking.passportNumber || '-',
        // Bawa terus data Pemesan dari booking lama ke booking hasil reschedule
        ordererId: oldBooking.ordererId || null,
        ordererName: oldBooking.ordererName || '',
        roomType: rescheduleForm.roomType,
        busGroup: rescheduleForm.busGroup,
        totalAmount: newPrice,
        totalPaid: carryOverAmount,
        paymentStatus: carryOverAmount >= newPrice ? 'Full Payment' : 'DP Paid',
        documents: oldBooking.documents || {
          passport: false, ktp_foto: false, family_cert: false, sponsor_letter: false,
          bank_statement: false, vaccine_cert: false, visa: false, ticket: false
        },
        rescheduledFromBookingId: oldBooking.id,
        rescheduledFromBookingCode: oldBooking.bookingCode,
        createdAt: new Date().toISOString()
      });

      // 2. Pindahkan setoran yang sudah dibayar sebagai carry-over ke booking baru
      if (carryOverAmount > 0) {
        await addDoc(collection(db, 'payments_income'), {
          bookingId: newBookingRef.id,
          bookingCode: newBookingCode,
          jamaahName: oldBooking.jamaahName,
          packageId: newPkg.id,
          packageName: newPkg.name,
          amount: carryOverAmount,
          paymentMethod: 'Carry-Over Reschedule',
          notes: `Pindahan setoran dari booking ${oldBooking.bookingCode} (reschedule)`,
          createdAt: new Date().toISOString()
        });
      }

      // 3. Tandai booking lama sebagai rescheduled & kembalikan kuota paket lama
      await updateDoc(doc(db, 'bookings', oldBooking.id), {
        status: 'rescheduled',
        rescheduledAt: new Date().toISOString(),
        rescheduledToBookingId: newBookingRef.id,
        rescheduledToBookingCode: newBookingCode
      });
      await releaseQuotaToPackage(oldBooking.packageId);

      // 4. Kurangi kuota paket tujuan (atomic, bukan baca-lalu-tulis)
      await updateDoc(doc(db, 'packages', newPkg.id), {
        quotaRemaining: increment(-1)
      });

      setShowActionModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal memproses reschedule: " + err.message);
    }
  };

  // ============ SETORAN GRUP (BAYAR SEKALIGUS UTK 1 GRUP BOOKING) ============

  const handleOpenGroupPaymentModal = (group) => {
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh mencatat setoran tambahan lewat sini.");
      return;
    }
    setGroupPaymentTarget(group);
    setGroupPaymentForm({ amount: '', paymentMethod: 'Transfer Bank', accountId: '', notes: 'Setoran Tambahan', date: todayDateStr() });
    setShowGroupPaymentModal(true);
  };

  const handleGroupPaymentSubmit = async (e) => {
    e.preventDefault();
    if (!groupPaymentTarget) return;
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh mencatat setoran tambahan lewat sini.");
      return;
    }

    const amount = Number(groupPaymentForm.amount || 0);
    if (amount <= 0) {
      alert("Isi nominal setoran yang valid (lebih dari 0).");
      return;
    }
    if (isPaymentDateBeforeBooking(groupPaymentForm.date, groupPaymentTarget.primary?.createdAt)) {
      const minDate = getBookingMinDate(groupPaymentTarget.primary?.createdAt);
      alert(`Tanggal setoran nggak boleh sebelum tanggal pemesanan kode ${groupPaymentTarget.code} dibuat (${minDate.split('-').reverse().join('/')}).`);
      return;
    }

    const groupOrdererId = groupPaymentTarget.primary?.ordererId;
    const groupOrdererName = groupPaymentTarget.primary?.ordererName;
    if (groupPaymentForm.paymentMethod === 'Saldo Deposit') {
      const ordererData = jamaahList.find(j => j.id === groupOrdererId);
      const currentBalance = Number(ordererData?.depositBalance || 0);
      if (amount > currentBalance) {
        alert(`Saldo Deposit Pemesan tidak cukup. Saldo saat ini: Rp ${currentBalance.toLocaleString('id-ID')}, dibutuhkan: Rp ${amount.toLocaleString('id-ID')}.`);
        return;
      }
    } else if (!groupPaymentForm.accountId) {
      alert("Pilih akun Kas/Bank yang nerima setoran ini dulu.");
      return;
    }

    try {
      // Urutan pax dalam grup harus sama kayak pas grup ini pertama kali
      // dibuat (biar sisa pembagian tetap konsisten jatuh ke pax pertama) —
      // urutkan berdasarkan groupPaxIndex kalau ada, fallback ke urutan array asli.
      const groupItems = [...groupPaymentTarget.items].sort((a, b) => {
        if (a.groupPaxIndex != null && b.groupPaxIndex != null) return a.groupPaxIndex - b.groupPaxIndex;
        return 0;
      });
      const paxCount = groupItems.length;
      const groupPaymentAccount = financialAccounts.find(a => a.id === groupPaymentForm.accountId);

      // Bagi rata nominal setoran ke semua pax (sisa pembagian masuk ke pax pertama)
      // — pola yang sama persis dengan pembagian DP awal pas registrasi grup baru.
      const baseShare = Math.floor(amount / paxCount);
      const remainder = amount - (baseShare * paxCount);

      // Semua dokumen payments_income yang lahir dari 1 kali submit setoran
      // grup ini ditandai groupTransactionId yang SAMA, biar nanti bisa
      // digabung balik jadi 1 baris transaksi pas ditampilkan di modal
      // Riwayat Pembayaran (yang dilihat staff = nominal aslinya, bukan
      // pecahan per-pax hasil split).
      const groupTransactionId = `gtx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      for (let i = 0; i < groupItems.length; i++) {
        const item = groupItems[i];
        const paxShare = baseShare + (i === 0 ? remainder : 0);

        if (paxShare > 0) {
          await addDoc(collection(db, 'payments_income'), {
            bookingId: item.id,
            bookingCode: item.bookingCode,
            jamaahName: item.jamaahName,
            packageId: item.packageId,
            packageName: item.packageName,
            amount: paxShare,
            paymentMethod: groupPaymentForm.paymentMethod,
            ...(groupPaymentForm.paymentMethod !== 'Saldo Deposit' ? { accountId: groupPaymentForm.accountId, accountName: groupPaymentAccount?.name || '' } : {}),
            notes: `${groupPaymentForm.notes} (Grup ${groupPaymentTarget.code})`,
            createdAt: resolvePaymentCreatedAt(groupPaymentForm.date),
            groupTransactionId
          });
        }

        // Sinkronkan totalPaid/paymentStatus tiap pax dari data payments_income
        // asli — dijalankan utk semua pax di grup, bukan cuma yang kebagian
        // setoran nonzero, biar tetap konsisten kalau ada penyesuaian rounding.
        await syncBookingTotalPaid(item.id, item.totalAmount);
      }

      // Mutasi Kas/Bank dicatat SATU KALI per transaksi setoran grup (bukan
      // per pecahan pax) — biar "Riwayat Mutasi" persis sama jumlah uang yang
      // beneran masuk ke rekening, gampang direkonsiliasi sama mutasi bank
      // aslinya, dan pas transaksinya dihapus cuma perlu hapus 1 baris (lihat
      // handleDeleteMergedGroupPayment). Rincian per-peserta tetap ada di
      // payments_income, dicari lewat groupTransactionId yang sama.
      if (groupPaymentForm.paymentMethod !== 'Saldo Deposit' && amount > 0) {
        await adjustAccountBalance(groupPaymentForm.accountId, amount, {
          description: `Setoran Grup ${groupPaymentTarget.code} (${paxCount} peserta)`,
          reference: groupPaymentTarget.code,
          source: 'group_payment',
          date: resolvePaymentCreatedAt(groupPaymentForm.date),
          sourceDocId: groupTransactionId
        });
      }

      if (groupPaymentForm.paymentMethod === 'Saldo Deposit') {
        await adjustDepositBalance(groupOrdererId, groupOrdererName, -amount, 'usage', `Bayar setoran grup ${groupPaymentTarget.code}`, groupPaymentTarget.code);
      }

      setShowGroupPaymentModal(false);
      setGroupPaymentForm({ amount: '', paymentMethod: 'Transfer Bank', accountId: '', notes: 'Setoran Tambahan', date: todayDateStr() });
      fetchData();
    } catch (err) {
      alert("Gagal mencatat setoran grup: " + err.message);
    }
  };

  // ============ 5 AKSI UTAMA LEVEL GRUP (Riwayat, Edit, Reschedule, Batalkan, Hapus) ============
  // Owner sekarang mikirin "1 booking" itu ya 1 GRUP (kode di kolom Kode ringkasan),
  // bukan per baris peserta. 5 aksi di bawah ini jadi versi PRIMER level grup dari
  // aksi yang UDAH ADA per-peserta di dropdown "Aksi Lainnya" tiap baris — versi
  // per-peserta itu TETAP ada & TETAP jalan apa adanya, buat kasus cuma 1 orang
  // dalam grup yang perlu ditangani sendirian.

  // ---- 1. Riwayat Pembayaran ----
  // Ambil dulu SEMUA payments_income lintas tiap peserta dalam grup, di-keyed
  // by bookingId (dipakai jg buat cari booking mana yang perlu disinkronkan
  // pas edit/hapus). Data mentah ini baru digabung jadi baris TRANSAKSI (bukan
  // per-pax) pas dirender — lihat buildMergedGroupTransactions di atas.
  const fetchGroupHistoryPayments = async (items) => {
    const entries = await Promise.all(items.map(async (b) => {
      try {
        const q = query(collection(db, 'payments_income'), where('bookingId', '==', b.id));
        const snap = await getDocs(q);
        return [b.id, snap.docs.map(d => ({ id: d.id, ...d.data() }))];
      } catch (err) {
        console.error('Gagal mengambil riwayat setoran grup:', err);
        return [b.id, []];
      }
    }));
    const map = {};
    entries.forEach(([bid, list]) => { map[bid] = list; });
    setGroupHistoryPayments(map);
  };

  const handleOpenGroupHistory = async (items) => {
    setGroupHistoryItems(items);
    setEditingGroupPaymentId(null);
    setShowGroupHistoryModal(true);
    await fetchGroupHistoryPayments(items);
  };

  // Adaptasi kecil dari handleDeletePayment/handleSavePaymentEdit: di modal grup
  // nggak ada 1 "selectedBookingForHistory" tunggal (isinya beberapa booking
  // sekaligus), jadi booking mana yang perlu di-syncBookingTotalPaid ditentukan
  // dari field bookingId yang emang udah nempel di tiap dokumen payments_income.
  const handleDeleteGroupPayment = async (pay) => {
    if (!canManagePayments) {
      alert("Cuma Finance & Super Admin yang boleh menghapus riwayat pembayaran.");
      return;
    }
    if (!confirm("Apakah Anda yakin ingin menghapus catatan pembayaran ini?")) return;
    try {
      await deleteDoc(doc(db, 'payments_income', pay.id));
      if (pay.accountId) await removeAccountMutationBySource(pay.accountId, pay.id, -(Number(pay.amount) || 0));
      const bookingItem = groupHistoryItems.find(b => b.id === pay.bookingId);
      if (bookingItem) await syncBookingTotalPaid(bookingItem.id, bookingItem.totalAmount);
      await fetchGroupHistoryPayments(groupHistoryItems);
      fetchData();
    } catch (err) {
      alert("Gagal menghapus pembayaran: " + err.message);
    }
  };

  const handleSaveGroupPaymentEdit = async (pay) => {
    if (!canManagePayments) {
      alert("Cuma Finance & Super Admin yang boleh mengedit riwayat pembayaran.");
      return;
    }
    if ((pay.paymentMethod === 'Saldo Deposit') !== (paymentEditForm.paymentMethod === 'Saldo Deposit')) {
      alert("Ganti Metode Bayar ke/dari \"Saldo Deposit\" nggak bisa lewat edit ini (biar saldo deposit & akun Kas/Bank tetap akurat). Hapus catatan ini, terus catat ulang lewat \"+Bayar\".");
      return;
    }
    const bookingItemForDate = groupHistoryItems.find(b => b.id === pay.bookingId);
    if (paymentEditForm.date && isPaymentDateBeforeBooking(paymentEditForm.date, bookingItemForDate?.createdAt)) {
      const minDate = getBookingMinDate(bookingItemForDate?.createdAt);
      alert(`Tanggal setoran nggak boleh sebelum tanggal pemesanan ${bookingItemForDate?.bookingCode || ''} dibuat (${minDate.split('-').reverse().join('/')}).`);
      return;
    }
    try {
      await updateDoc(doc(db, 'payments_income', pay.id), {
        amount: Number(paymentEditForm.amount),
        paymentMethod: paymentEditForm.paymentMethod,
        notes: paymentEditForm.notes,
        ...(paymentEditForm.paymentMethod !== 'Saldo Deposit' ? { accountId: paymentEditForm.accountId, accountName: financialAccounts.find(a => a.id === paymentEditForm.accountId)?.name || '' } : {}),
        ...(paymentEditForm.date ? { createdAt: resolvePaymentCreatedAt(paymentEditForm.date) } : {})
      });

      if (pay.accountId && paymentEditForm.paymentMethod !== 'Saldo Deposit') {
        const delta = Number(paymentEditForm.amount) - (Number(pay.amount) || 0);
        await updateAccountMutationAmount(pay.accountId, pay.id, Number(paymentEditForm.amount), delta);
      }

      setEditingGroupPaymentId(null);
      const bookingItem = groupHistoryItems.find(b => b.id === pay.bookingId);
      if (bookingItem) await syncBookingTotalPaid(bookingItem.id, bookingItem.totalAmount);
      await fetchGroupHistoryPayments(groupHistoryItems);
      fetchData();
    } catch (err) {
      alert("Gagal memperbarui pembayaran: " + err.message);
    }
  };

  // Hapus 1 baris TRANSAKSI GABUNGAN (hasil split ke beberapa pax sekaligus)
  // dari modal Riwayat Pembayaran — semua dokumen payments_income yang
  // digabung jadi baris itu ikut kehapus, terus totalPaid/paymentStatus tiap
  // booking yang kena dampak disinkronkan ulang. Baris gabungan sengaja nggak
  // punya opsi Edit (redistribusi ulang totalnya ke N porsi berisiko salah
  // hitung) — kalau perlu dikoreksi, hapus di sini terus catat ulang lewat "+Bayar".
  const handleDeleteMergedGroupPayment = async (docs) => {
    if (!canManagePayments) {
      alert("Cuma Finance & Super Admin yang boleh menghapus riwayat pembayaran.");
      return;
    }
    if (!confirm(`Apakah Anda yakin ingin menghapus transaksi setoran ini? ${docs.length} catatan pembagian ke peserta akan ikut terhapus.`)) return;
    try {
      const totalAmount = docs.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
      await Promise.all(docs.map(d => deleteDoc(doc(db, 'payments_income', d.id))));
      // Setoran grup yang dicatat lewat "Terima Setoran Jamaah" di modul
      // Keuangan cuma punya SATU baris mutasi buat seluruh transaksi
      // (sourceDocId = groupTransactionId, lihat FinanceModule.jsx) — jadi
      // dicoba cari & hapus itu dulu. Kalau nggak ketemu (transaksi lama /
      // dicatat lewat "Catat Setoran Grup" yang masih 1 baris mutasi per
      // pecahan pax), baru fallback hapus satu-satu lewat id doc aslinya.
      const mutationAccountId = docs.find(d => d.accountId)?.accountId;
      if (mutationAccountId) {
        const mergedSourceDocId = docs.find(d => d.groupTransactionId)?.groupTransactionId;
        let foundMerged = false;
        if (mergedSourceDocId) {
          const mutQ = query(collection(db, 'account_mutations'), where('accountId', '==', mutationAccountId), where('sourceDocId', '==', mergedSourceDocId));
          const mutSnap = await getDocs(mutQ);
          if (mutSnap.docs.length > 0) {
            foundMerged = true;
            await Promise.all(mutSnap.docs.map(d => deleteDoc(d.ref)));
            await updateDoc(doc(db, 'financial_accounts', mutationAccountId), { balance: increment(-totalAmount) });
          }
        }
        if (!foundMerged) {
          // Tiap doc balikin porsinya sendiri ke saldo akun Kas/Bank asalnya, dan
          // baris mutasinya masing-masing ikut hilang dari riwayat (doc yang
          // dibayar pakai Saldo Deposit dilewati — nggak punya accountId).
          await Promise.all(docs.map(d => d.accountId ? removeAccountMutationBySource(d.accountId, d.id, -(Number(d.amount) || 0)) : Promise.resolve()));
        }
      }

      // Sinkronkan totalPaid/paymentStatus tiap booking unik yang kena dampak
      const uniqueBookingIds = [...new Set(docs.map(d => d.bookingId))];
      await Promise.all(uniqueBookingIds.map(bid => {
        const bookingItem = groupHistoryItems.find(b => b.id === bid);
        return bookingItem ? syncBookingTotalPaid(bookingItem.id, bookingItem.totalAmount) : Promise.resolve();
      }));

      await fetchGroupHistoryPayments(groupHistoryItems);
      fetchData();
    } catch (err) {
      alert("Gagal menghapus transaksi setoran: " + err.message);
    }
  };

  // ---- 2. Edit Booking (Grup) ----
  // Modal kecil TERPISAH dari modal registrasi besar — sengaja nggak dipakai
  // ulang biar nggak keruwetan sama alur single/multi-pax & Edit per-peserta
  // yang udah jalan. Cuma edit field yang emang shared se-grup: Paket, Pemesan,
  // Tipe Kamar, Alokasi Bus. Identitas peserta TETAP di Edit per-peserta.
  const handleOpenGroupEditModal = (group) => {
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh mengedit booking.");
      return;
    }
    setGroupEditTarget(group);
    // Prefill Biaya Tambahan & Potongan Harga dari gabungan seluruh pax di
    // grup ini — karena tiap booking nyimpen porsi hasil split-nya sendiri,
    // digabung balik (mergeExtraLists) jadi daftar flat aslinya.
    setGroupEditForm({
      packageId: group.primary?.packageId || '',
      ordererId: group.primary?.ordererId || (group.primary?.ordererName ? '__new__' : ''),
      roomType: group.primary?.roomType || 'Quad',
      busGroup: group.primary?.busGroup || 'Bus 1',
      addPaymentAmount: '',
      addPaymentMethod: 'Transfer Bank',
      addAccountId: '',
      addPaymentNotes: 'Setoran Tambahan',
      addPaymentDate: todayDateStr(),
      extraCharges: mergeExtraLists(group.items || [], 'extraCharges'),
      extraDiscounts: mergeExtraLists(group.items || [], 'extraDiscounts')
    });
    setGroupChargeDraft({ name: '', amount: '', notes: '' });
    setEditingGroupChargeId(null);
    setGroupDiscountDraft({ name: '', amount: '', notes: '' });
    setEditingGroupDiscountId(null);
    setGroupEditNewOrdererForm({ fullName: group.primary?.ordererName || '', phone: '', nik: '', passportNumber: '' });
    setAddPaxForm({
      jamaahId: '',
      newJamaah: { fullName: '', phone: '', nik: '', passportNumber: '' },
      roomType: group.primary?.roomType || 'Quad'
    });
    setShowGroupEditModal(true);
  };

  // ---- 2b. Tambah Peserta Baru ke grup yang sudah ada (nyusul belakangan) ----
  const handleAddPaxToGroup = async () => {
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh mengedit booking.");
      return;
    }
    if (!groupEditTarget) return;
    if (!addPaxForm.jamaahId) {
      alert("Pilih Data Master Jamaah untuk peserta baru ini, atau tambah jamaah baru.");
      return;
    }
    if (addPaxForm.jamaahId === '__new__' && !addPaxForm.newJamaah.fullName.trim()) {
      alert("Isi nama lengkap peserta baru terlebih dahulu.");
      return;
    }

    try {
      const pkg = packagesList.find(p => p.id === groupEditTarget.primary?.packageId);
      if (!pkg) {
        alert("Paket travel grup ini tidak ditemukan.");
        return;
      }
      if (Number(pkg.quotaRemaining || 0) < 1) {
        alert(`Kuota paket ini sudah habis. Sisa seat: ${pkg.quotaRemaining || 0}.`);
        return;
      }

      let newJamaahData;
      if (addPaxForm.jamaahId === '__new__') {
        const newCode = generateNextCustomerCode(jamaahList);
        const newJamaahRef = await addDoc(collection(db, 'jamaah'), {
          customerCode: newCode,
          fullName: addPaxForm.newJamaah.fullName.trim(),
          nik: addPaxForm.newJamaah.nik || '',
          gender: 'L',
          phone: addPaxForm.newJamaah.phone || '',
          passportNumber: addPaxForm.newJamaah.passportNumber || '',
          passportExpiry: '',
          address: '',
          createdAt: new Date().toISOString()
        });
        newJamaahData = { id: newJamaahRef.id, fullName: addPaxForm.newJamaah.fullName.trim(), passportNumber: addPaxForm.newJamaah.passportNumber || '-' };
      } else {
        const existing = jamaahList.find(j => j.id === addPaxForm.jamaahId);
        if (!existing) { alert("Data jamaah tidak ditemukan."); return; }
        newJamaahData = { id: existing.id, fullName: existing.fullName, passportNumber: existing.passportNumber || '-' };
      }

      let price = Number(pkg.priceQuad || pkg.priceMain || 0);
      if (addPaxForm.roomType === 'Triple') price = Number(pkg.priceTriple || price);
      if (addPaxForm.roomType === 'Double') price = Number(pkg.priceDouble || price);

      const existingIndexes = groupEditTarget.items.map(b => Number(b.groupPaxIndex) || 0);
      const newIndex = (existingIndexes.length > 0 ? Math.max(...existingIndexes) : groupEditTarget.items.length) + 1;
      const newTotalPax = groupEditTarget.items.length + 1;
      const bookingCode = `${groupEditTarget.code}-${newIndex}`;

      const emptyDocChecklist = {
        passport: false, ktp_foto: false, family_cert: false, sponsor_letter: false,
        bank_statement: false, vaccine_cert: false, visa: false, ticket: false
      };

      await addDoc(collection(db, 'bookings'), {
        bookingCode,
        groupBookingCode: groupEditTarget.code,
        groupPaxIndex: newIndex,
        groupTotalPax: newTotalPax,
        packageId: pkg.id,
        packageName: pkg.name,
        packageCode: pkg.code,
        departureDate: pkg.departureDate,
        jamaahId: newJamaahData.id,
        jamaahName: newJamaahData.fullName,
        passportNumber: newJamaahData.passportNumber || '-',
        ordererId: groupEditTarget.primary?.ordererId || null,
        ordererName: groupEditTarget.primary?.ordererName || '',
        roomType: addPaxForm.roomType,
        busGroup: groupEditTarget.primary?.busGroup || 'Bus 1',
        extraCharges: [],
        extraDiscounts: [],
        totalAmount: price,
        totalPaid: 0,
        paymentStatus: 'Belum Bayar',
        documents: emptyDocChecklist,
        createdAt: new Date().toISOString()
      });

      // Sinkronkan groupTotalPax ke semua booking lain di grup ini juga,
      // biar badge "Grup X/Y" di tiap baris peserta tetap akurat.
      await Promise.all(groupEditTarget.items.map(item =>
        updateDoc(doc(db, 'bookings', item.id), { groupTotalPax: newTotalPax })
      ));

      await updateDoc(doc(db, 'packages', pkg.id), { quotaRemaining: increment(-1) });

      alert(`Peserta baru "${newJamaahData.fullName}" berhasil ditambahkan ke grup ${groupEditTarget.code}. Setoran untuk peserta ini bisa dicatat lewat "Catat Setoran Grup" atau riwayat pembayaran per-peserta.`);
      setShowGroupEditModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal menambahkan peserta baru: " + err.message);
    }
  };

  const handleGroupEditSubmit = async (e) => {
    e.preventDefault();
    if (!groupEditTarget) return;
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh mengedit booking.");
      return;
    }
    if (!groupEditForm.packageId) {
      alert("Pilih Paket Travel.");
      return;
    }
    if (!groupEditForm.ordererId) {
      alert("Pilih atau isi data Pemesan (yang melakukan pemesanan).");
      return;
    }
    if (groupEditForm.ordererId === '__new__' && !groupEditNewOrdererForm.fullName.trim()) {
      alert("Isi nama lengkap pemesan baru terlebih dahulu.");
      return;
    }

    try {
      // Cuma booking yang statusnya masih 'active' yang kena edit/quota math —
      // yang udah cancelled/rescheduled dibiarin apa adanya (histori lama).
      const activeItems = groupEditTarget.items.filter(b => (b.status || 'active') === 'active');
      if (activeItems.length === 0) {
        alert("Tidak ada booking aktif di grup ini yang bisa diedit.");
        return;
      }

      const newPkg = packagesList.find(p => p.id === groupEditForm.packageId);
      if (!newPkg) return;

      // Resolusi Pemesan — pola sama persis dgn Pemesan di form registrasi/edit per-peserta
      let selectedOrderer = null;
      if (groupEditForm.ordererId === '__new__') {
        const newOrdererCode = generateNextCustomerCode(jamaahList);
        const newOrdererRef = await addDoc(collection(db, 'jamaah'), {
          customerCode: newOrdererCode,
          fullName: groupEditNewOrdererForm.fullName.trim(),
          nik: groupEditNewOrdererForm.nik || '',
          gender: 'L',
          phone: groupEditNewOrdererForm.phone || '',
          passportNumber: groupEditNewOrdererForm.passportNumber || '',
          passportExpiry: '',
          address: '',
          createdAt: new Date().toISOString()
        });
        selectedOrderer = { id: newOrdererRef.id, fullName: groupEditNewOrdererForm.fullName.trim() };
      } else {
        selectedOrderer = jamaahList.find(j => j.id === groupEditForm.ordererId) || null;
      }
      const ordererId = selectedOrderer?.id || null;
      const ordererName = selectedOrderer?.fullName || '';

      let price = Number(newPkg.priceQuad || newPkg.priceMain || 0);
      if (groupEditForm.roomType === 'Triple') price = Number(newPkg.priceTriple || price);
      if (groupEditForm.roomType === 'Double') price = Number(newPkg.priceDouble || price);

      const oldPackageId = groupEditTarget.primary?.packageId;
      const packageChanged = newPkg.id !== oldPackageId;

      if (packageChanged && Number(newPkg.quotaRemaining || 0) < activeItems.length) {
        alert(`Kuota paket tujuan tidak cukup. Sisa seat: ${newPkg.quotaRemaining || 0}, dibutuhkan: ${activeItems.length}.`);
        return;
      }

      // Urutan pax dipertahankan sama kayak pas grup ini pertama kali dibuat —
      // dipakai buat pembagian biaya tambahan/diskon (sisa ke pax pertama).
      const sortedActiveForExtra = [...activeItems].sort((a, b) => {
        if (a.groupPaxIndex != null && b.groupPaxIndex != null) return a.groupPaxIndex - b.groupPaxIndex;
        return 0;
      });
      // Biaya Tambahan & Potongan Harga — daftar bebas, flat per kode booking
      // rombongan ini. Tiap baris (charge/discount) dibagi rata sendiri2 ke
      // semua pax aktif (sisa ke pax pertama), lalu di-"transpose" jadi
      // daftar per-pax (perPaxExtras[i]) yang isinya sama nama/keterangan
      // tapi nominal udah jadi porsi masing2.
      const chargesList = groupEditForm.extraCharges || [];
      const discountsList = groupEditForm.extraDiscounts || [];
      const chargeSharesPerItem = chargesList.map(c => splitFlatAmount(Number(c.amount) || 0, sortedActiveForExtra.length));
      const discountSharesPerItem = discountsList.map(d => splitFlatAmount(Number(d.amount) || 0, sortedActiveForExtra.length));
      const perPaxExtras = sortedActiveForExtra.map((item, i) => {
        const paxCharges = chargesList.map((c, idx) => ({ id: c.id, name: c.name, notes: c.notes || '', amount: chargeSharesPerItem[idx][i] || 0 }));
        const paxDiscounts = discountsList.map((d, idx) => ({ id: d.id, name: d.name, notes: d.notes || '', amount: discountSharesPerItem[idx][i] || 0 }));
        const chargeTotal = paxCharges.reduce((acc, c) => acc + c.amount, 0);
        const discountTotal = paxDiscounts.reduce((acc, d) => acc + d.amount, 0);
        return { paxCharges, paxDiscounts, totalAmount: price + chargeTotal - discountTotal };
      });

      // Update field2 yang emang shared ke SEMUA booking aktif di grup ini —
      // identitas peserta (jamaahId/jamaahName/dst) SENGAJA nggak disentuh.
      // totalAmount tiap pax = harga paket + porsi biaya tambahan/diskon
      // hasil bagi rata di atas.
      await Promise.all(sortedActiveForExtra.map((item, i) => updateDoc(doc(db, 'bookings', item.id), {
        packageId: newPkg.id,
        packageName: newPkg.name,
        packageCode: newPkg.code,
        departureDate: newPkg.departureDate,
        ordererId,
        ordererName,
        roomType: groupEditForm.roomType,
        busGroup: groupEditForm.busGroup,
        extraCharges: perPaxExtras[i].paxCharges,
        extraDiscounts: perPaxExtras[i].paxDiscounts,
        totalAmount: perPaxExtras[i].totalAmount,
        updatedAt: new Date().toISOString()
      })));

      if (packageChanged) {
        // 1 updateDoc per paket pakai increment(activeItems.length) — lebih
        // efisien drpd loop +1/-1 per pax kayak alur hapus per-booking.
        if (oldPackageId) {
          await updateDoc(doc(db, 'packages', oldPackageId), { quotaRemaining: increment(activeItems.length) });
        }
        await updateDoc(doc(db, 'packages', newPkg.id), { quotaRemaining: increment(-activeItems.length) });
      }

      // Bagian "Tambah Setoran" opsional — dibagi rata ke activeItems, pola
      // baseShare/remainder yang sama persis dgn handleGroupPaymentSubmit.
      const addAmount = Number(groupEditForm.addPaymentAmount || 0);
      if (addAmount > 0) {
        if (groupEditForm.addPaymentMethod === 'Saldo Deposit') {
          const ordererData = jamaahList.find(j => j.id === ordererId);
          const currentBalance = Number(ordererData?.depositBalance || 0);
          if (addAmount > currentBalance) {
            alert(`Saldo Deposit Pemesan tidak cukup. Saldo saat ini: Rp ${currentBalance.toLocaleString('id-ID')}, dibutuhkan: Rp ${addAmount.toLocaleString('id-ID')}.`);
            return;
          }
        } else if (!groupEditForm.addAccountId) {
          alert("Pilih akun Kas/Bank yang nerima setoran ini dulu.");
          return;
        }
        const groupEditAccount = financialAccounts.find(a => a.id === groupEditForm.addAccountId);
        const sortedActive = [...activeItems].sort((a, b) => {
          if (a.groupPaxIndex != null && b.groupPaxIndex != null) return a.groupPaxIndex - b.groupPaxIndex;
          return 0;
        });
        const baseShare = Math.floor(addAmount / sortedActive.length);
        const remainder = addAmount - (baseShare * sortedActive.length);
        // Sama kayak handleGroupPaymentSubmit — tandai seluruh dokumen split
        // dari 1 kali submit setoran ini dgn groupTransactionId yang sama,
        // biar bisa digabung balik jadi 1 baris di modal Riwayat Pembayaran.
        const groupTransactionId = `gtx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        for (let i = 0; i < sortedActive.length; i++) {
          const item = sortedActive[i];
          const share = baseShare + (i === 0 ? remainder : 0);
          if (share > 0) {
            const payRef = await addDoc(collection(db, 'payments_income'), {
              bookingId: item.id,
              bookingCode: item.bookingCode,
              jamaahName: item.jamaahName,
              packageId: newPkg.id,
              packageName: newPkg.name,
              amount: share,
              paymentMethod: groupEditForm.addPaymentMethod,
              ...(groupEditForm.addPaymentMethod !== 'Saldo Deposit' ? { accountId: groupEditForm.addAccountId, accountName: groupEditAccount?.name || '' } : {}),
              notes: `${groupEditForm.addPaymentNotes} (Grup ${groupEditTarget.code})`,
              createdAt: resolvePaymentCreatedAt(groupEditForm.addPaymentDate),
              groupTransactionId
            });
            if (groupEditForm.addPaymentMethod !== 'Saldo Deposit') {
              await adjustAccountBalance(groupEditForm.addAccountId, share, {
                description: `Setoran Grup (Edit) ${groupEditTarget.code} - ${item.jamaahName || item.bookingCode}`,
                reference: item.bookingCode,
                source: 'group_edit_payment',
                date: resolvePaymentCreatedAt(groupEditForm.addPaymentDate),
                sourceDocId: payRef.id
              });
            }
          }
        }

        if (groupEditForm.addPaymentMethod === 'Saldo Deposit') {
          await adjustDepositBalance(ordererId, ordererName, -addAmount, 'usage', `Bayar setoran grup ${groupEditTarget.code}`, groupEditTarget.code);
        }
      }

      // Sinkronkan totalPaid/paymentStatus tiap booking aktif dari data
      // payments_income asli (totalAmount-nya bisa aja berubah kalau paket/kamar
      // ganti, atau kalau biaya tambahan/diskonnya baru diubah).
      await Promise.all(sortedActiveForExtra.map((item, i) =>
        syncBookingTotalPaid(item.id, perPaxExtras[i].totalAmount)
      ));

      setShowGroupEditModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal mengedit booking grup: " + err.message);
    }
  };

  // ---- 3. Reschedule (Grup) ----
  const handleOpenGroupRescheduleModal = (group) => {
    if (!canReschedule) {
      alert("Cuma Finance & Super Admin yang boleh reschedule booking.");
      return;
    }
    setGroupRescheduleTarget(group);
    setGroupRescheduleForm({
      newPackageId: '',
      roomType: group.primary?.roomType || 'Quad',
      busGroup: group.primary?.busGroup || 'Bus 1'
    });
    setShowGroupRescheduleModal(true);
  };

  const handleGroupRescheduleSubmit = async (e) => {
    e.preventDefault();
    if (!groupRescheduleTarget) return;
    if (!canReschedule) {
      alert("Cuma Finance & Super Admin yang boleh memproses reschedule.");
      return;
    }
    if (!groupRescheduleForm.newPackageId) {
      alert("Pilih paket/keberangkatan tujuan reschedule.");
      return;
    }

    try {
      const activeItems = groupRescheduleTarget.items.filter(b => (b.status || 'active') === 'active');
      if (activeItems.length === 0) {
        alert("Tidak ada booking aktif di grup ini yang bisa di-reschedule.");
        return;
      }
      // Urutan pax dipertahankan sama kayak pas grup ini pertama kali dibuat
      // (groupPaxIndex), biar pax 1 tetap pax 1 di grup hasil reschedule.
      const sortedActive = [...activeItems].sort((a, b) => {
        if (a.groupPaxIndex != null && b.groupPaxIndex != null) return a.groupPaxIndex - b.groupPaxIndex;
        return 0;
      });

      const newPkg = packagesList.find(p => p.id === groupRescheduleForm.newPackageId);
      if (!newPkg) return;

      if (Number(newPkg.quotaRemaining || 0) < sortedActive.length) {
        alert(`Kuota paket tujuan tidak cukup. Sisa seat: ${newPkg.quotaRemaining || 0}, dibutuhkan: ${sortedActive.length}.`);
        return;
      }

      let newPrice = Number(newPkg.priceQuad || newPkg.priceMain || 0);
      if (groupRescheduleForm.roomType === 'Triple') newPrice = Number(newPkg.priceTriple || newPrice);
      if (groupRescheduleForm.roomType === 'Double') newPrice = Number(newPkg.priceDouble || newPrice);

      const newGroupBookingCode = `GRP-${Date.now().toString().slice(-6)}`;
      const nowIso = new Date().toISOString();

      for (let i = 0; i < sortedActive.length; i++) {
        const oldBooking = sortedActive[i];
        // Setoran yg udah dibayar pax ini dibawa APA ADANYA (nggak dibagi rata
        // ulang) — persis kayak alur reschedule per-peserta yang udah jalan.
        const carryOverAmount = Number(oldBooking.totalPaid || 0);
        const newBookingCode = `${newGroupBookingCode}-${i + 1}`;

        const newBookingRef = await addDoc(collection(db, 'bookings'), {
          bookingCode: newBookingCode,
          groupBookingCode: newGroupBookingCode,
          groupPaxIndex: i + 1,
          groupTotalPax: sortedActive.length,
          packageId: newPkg.id,
          packageName: newPkg.name,
          packageCode: newPkg.code,
          departureDate: newPkg.departureDate,
          jamaahId: oldBooking.jamaahId,
          jamaahName: oldBooking.jamaahName,
          passportNumber: oldBooking.passportNumber || '-',
          ordererId: oldBooking.ordererId || null,
          ordererName: oldBooking.ordererName || '',
          roomType: groupRescheduleForm.roomType,
          busGroup: groupRescheduleForm.busGroup,
          totalAmount: newPrice,
          totalPaid: carryOverAmount,
          paymentStatus: carryOverAmount >= newPrice ? 'Full Payment' : 'DP Paid',
          documents: oldBooking.documents || {
            passport: false, ktp_foto: false, family_cert: false, sponsor_letter: false,
            bank_statement: false, vaccine_cert: false, visa: false, ticket: false
          },
          rescheduledFromBookingId: oldBooking.id,
          rescheduledFromBookingCode: oldBooking.bookingCode,
          createdAt: nowIso
        });

        if (carryOverAmount > 0) {
          await addDoc(collection(db, 'payments_income'), {
            bookingId: newBookingRef.id,
            bookingCode: newBookingCode,
            jamaahName: oldBooking.jamaahName,
            packageId: newPkg.id,
            packageName: newPkg.name,
            amount: carryOverAmount,
            paymentMethod: 'Carry-Over Reschedule',
            notes: `Pindahan setoran dari booking ${oldBooking.bookingCode} (reschedule grup ${groupRescheduleTarget.code})`,
            createdAt: nowIso
          });
        }

        await updateDoc(doc(db, 'bookings', oldBooking.id), {
          status: 'rescheduled',
          rescheduledAt: nowIso,
          rescheduledToBookingId: newBookingRef.id,
          rescheduledToBookingCode: newBookingCode
        });
      }

      // Lepas kuota dari paket lama & kurangi dari paket baru — 1 updateDoc
      // per paket (bukan loop +1/-1 per pax).
      const oldPackageId = groupRescheduleTarget.primary?.packageId;
      if (oldPackageId) {
        await updateDoc(doc(db, 'packages', oldPackageId), { quotaRemaining: increment(sortedActive.length) });
      }
      await updateDoc(doc(db, 'packages', newPkg.id), { quotaRemaining: increment(-sortedActive.length) });

      setShowGroupRescheduleModal(false);
      // Grup lama udah nggak aktif lagi (semua pax-nya pindah ke grup baru) —
      // balik ke tampilan ringkasan, bukan nyoba nampilin grup lama yang kosong.
      setActiveGroupCode(null);
      fetchData();
    } catch (err) {
      alert("Gagal memproses reschedule grup: " + err.message);
    }
  };

  // ---- 4. Batalkan / Refund (Grup) ----
  const handleOpenGroupCancelModal = (group) => {
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh membatalkan booking & proses refund.");
      return;
    }
    const activeItems = group.items.filter(b => (b.status || 'active') === 'active');
    setGroupCancelTarget(group);
    setGroupCancelForm({
      refundAmount: activeItems.reduce((acc, b) => acc + Number(b.totalPaid || 0), 0),
      refundMethod: 'Transfer Bank',
      reason: ''
    });
    setShowGroupCancelModal(true);
  };

  const handleGroupCancelSubmit = async (e) => {
    e.preventDefault();
    if (!groupCancelTarget) return;
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh memproses pembatalan/refund.");
      return;
    }

    try {
      const activeItems = groupCancelTarget.items.filter(b => (b.status || 'active') === 'active');
      if (activeItems.length === 0) {
        alert("Tidak ada booking aktif di grup ini yang bisa dibatalkan.");
        return;
      }
      const sortedActive = [...activeItems].sort((a, b) => {
        if (a.groupPaxIndex != null && b.groupPaxIndex != null) return a.groupPaxIndex - b.groupPaxIndex;
        return 0;
      });

      // Nominal refund total dibagi rata ke semua pax aktif (sisa pembagian
      // masuk ke pax pertama) — pola sama persis dgn Setoran Grup/DP awal grup.
      const totalRefund = Number(groupCancelForm.refundAmount || 0);
      const baseShare = Math.floor(totalRefund / sortedActive.length);
      const remainder = totalRefund - (baseShare * sortedActive.length);
      const nowIso = new Date().toISOString();

      await Promise.all(sortedActive.map((item, i) => {
        const share = baseShare + (i === 0 ? remainder : 0);
        return updateDoc(doc(db, 'bookings', item.id), {
          status: 'cancelled',
          cancelReason: groupCancelForm.reason || '-',
          refundAmount: share,
          refundMethod: groupCancelForm.refundMethod,
          cancelledAt: nowIso
        });
      }));

      // Kalau refund-nya dipindah jadi Saldo Deposit, saldo Pemesan grup ini
      // ditambah nilai TOTAL refund sekaligus (bukan per-pax) — satu grup
      // cuma punya 1 Pemesan yang sama.
      if (groupCancelForm.refundMethod === 'Deposit / Saldo Akun' && totalRefund > 0 && groupCancelTarget.primary?.ordererId) {
        await adjustDepositBalance(
          groupCancelTarget.primary.ordererId,
          groupCancelTarget.primary.ordererName,
          totalRefund,
          'refund_conversion',
          `Konversi refund pembatalan grup ${groupCancelTarget.code}`,
          groupCancelTarget.code
        );
      }

      // Kuota seat yang dibatalkan dikembalikan ke paket — 1 updateDoc pakai
      // increment(sortedActive.length), bukan loop +1 per pax.
      const oldPackageId = groupCancelTarget.primary?.packageId;
      if (oldPackageId) {
        await updateDoc(doc(db, 'packages', oldPackageId), { quotaRemaining: increment(sortedActive.length) });
      }

      setShowGroupCancelModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal memproses pembatalan grup: " + err.message);
    }
  };

  // ---- 5. Hapus Booking (Grup) ----
  const handleGroupDeleteBooking = async (group) => {
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh menghapus booking.");
      return;
    }
    try {
      // Pengecekan riwayat pembayaran pakai SELURUH booking di grup (bukan cuma
      // yang aktif) — booking yang udah cancelled/rescheduled pun bisa aja masih
      // nyisain riwayat transaksi yang perlu dibersihin dulu.
      const allItems = group.items;
      const ids = allItems.map(b => b.id);
      if (ids.length === 0) return;

      // 1 query pakai where(..., 'in', ids) drpd loop query per booking satu-satu
      // — Firestore 'in' support s.d. 30 value, jauh lebih dari cukup buat 1 grup travel.
      const q = query(collection(db, 'payments_income'), where('bookingId', 'in', ids));
      const paySnap = await getDocs(q);

      if (!paySnap.empty) {
        const bookingIdsWithPayments = new Set(paySnap.docs.map(d => d.data().bookingId));
        alert(`Grup ${group.code} tidak dapat dihapus karena ${bookingIdsWithPayments.size} dari ${allItems.length} booking di grup ini masih memiliki riwayat transaksi pembayaran di Arus Kas.\n\nSilakan hapus semua riwayat pembayaran jamaah-jamaah tsb terlebih dahulu di menu Arus Kas/Riwayat Setoran.`);
        return;
      }

      if (!confirm(`Apakah Anda yakin ingin menghapus SELURUH ${allItems.length} booking dalam grup ${group.code}?`)) return;

      await Promise.all(allItems.map(item => deleteDoc(doc(db, 'bookings', item.id))));

      // Kuota cuma dilepas buat booking yang statusnya masih 'active' — yang
      // udah cancelled/rescheduled sebelumnya udah dilepas kuotanya duluan,
      // jangan sampai di-double release di sini.
      const activeCount = allItems.filter(b => (b.status || 'active') === 'active').length;
      const packageId = group.primary?.packageId;
      if (packageId && activeCount > 0) {
        try {
          await updateDoc(doc(db, 'packages', packageId), { quotaRemaining: increment(activeCount) });
        } catch (quotaErr) {
          console.error('Gagal mengembalikan kuota paket:', quotaErr);
        }
      }

      setActiveGroupCode(null);
      fetchData();
    } catch (err) {
      alert("Gagal menghapus booking grup: " + err.message);
    }
  };

  // ============ ROOMING LIST ============

  const handleSaveRoomLabel = async (bookingId, roomLabel) => {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { roomLabel });
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, roomLabel } : b));
    } catch (err) {
      alert("Gagal menyimpan nomor kamar: " + err.message);
    }
  };

  const handleAutoAssignRooms = async (roomingBookings) => {
    try {
      const byRoomType = {};
      roomingBookings.forEach(b => {
        const rt = b.roomType || 'Quad';
        if (!byRoomType[rt]) byRoomType[rt] = [];
        byRoomType[rt].push(b);
      });

      const updates = [];
      Object.entries(byRoomType).forEach(([roomType, list]) => {
        const capacity = ROOM_CAPACITY[roomType] || 4;
        list.forEach((b, idx) => {
          const roomNumber = Math.floor(idx / capacity) + 1;
          const roomLabel = `${roomType.charAt(0)}${roomNumber}`;
          updates.push(updateDoc(doc(db, 'bookings', b.id), { roomLabel }));
        });
      });

      await Promise.all(updates);
      fetchData();
    } catch (err) {
      alert("Gagal auto-assign kamar: " + err.message);
    }
  };

  const handlePrintRoomingList = (roomingBookings, pkg) => {
    const grouped = {};
    roomingBookings.forEach(b => {
      const label = b.roomLabel || 'Belum Ditentukan';
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(b);
    });

    const roomRowsHtml = Object.entries(grouped).map(([label, members]) => `
      <tr>
        <td style="padding:8px 12px;font-weight:700;border-bottom:1px solid #f1f5f9;">${label}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;">${members[0]?.roomType || '-'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;">
          ${members.map((m, i) => `${i + 1}. ${m.jamaahName} (${m.passportNumber || '-'})`).join('<br/>')}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;">${members.length}</td>
      </tr>
    `).join('');

    const docContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Rooming List - ${pkg?.name || ''}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#1e293b; padding:30px; }
            h1 { font-size:18px; color:#065f46; margin-bottom:2px; }
            p.sub { font-size:11px; color:#64748b; margin-top:0; }
            table { width:100%; border-collapse:collapse; margin-top:16px; }
            th { background:#f1f5f9; text-align:left; padding:8px 12px; font-size:11px; text-transform:uppercase; color:#475569; }
          </style>
        </head>
        <body>
          <h1>Rooming List</h1>
          <p class="sub">${pkg?.name || '-'} (${pkg?.code || '-'}) &bull; Keberangkatan: ${formatDateDDMMYYYY(pkg?.departureDate)}</p>
          <table>
            <thead><tr><th>Kamar</th><th>Tipe</th><th>Anggota Kamar</th><th style="text-align:center;">Jml</th></tr></thead>
            <tbody>${roomRowsHtml || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8;">Belum ada data.</td></tr>'}</tbody>
          </table>
        </body>
      </html>
    `;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc2 = iframe.contentWindow.document;
    doc2.open();
    doc2.write(docContent);
    doc2.close();

    iframe.contentWindow.focus();
    setTimeout(() => {
      iframe.contentWindow.print();
      document.body.removeChild(iframe);
    }, 500);
  };

  // Bangun HTML "kotak invoice" utk SATU booking/pax (dipanggil baik dari cetak
  // 1 invoice doang, maupun dari cetak invoice sekaligus 1 grup — hasilnya
  // digabung jadi beberapa halaman dlm 1 dokumen print).
  // Variabel Dinamis Profil Perusahaan & Bank — dipakai bareng-bareng oleh
  // invoice per-pax maupun invoice gabungan 1 grup, biar konsisten.
  const getCompanyInvoiceVars = () => ({
    compName: companyInfo?.name || 'PT. WISATA HALAL INTERNASIONAL',
    compAddress: companyInfo?.address || 'Ruko Graha Cirendeu No.1C Jl. Cirendeu Raya, Tangerang Selatan, Banten, Indonesia, 15445',
    compPpiu: companyInfo?.ppiuNumber || 'PPIU No. U.123 / 2024',
    compPhone: companyInfo?.phone || '+62 812-0000-0000',
    compEmail: companyInfo?.email || 'admin@wisatahalalindonesia.id',
    bankName: companyInfo?.bankName || 'Bank Syariah Indonesia (BSI)',
    bankAccount: companyInfo?.bankAccount || '788-9900-112 a.n. PT. Wisata Halal Internasional'
  });

  // Baris "Jatuh Tempo" di invoice — cuma dimunculkan selama booking belum
  // lunas. Tanggal yang udah lewat ditandai merah biar kelihatan.
  const buildDueDatesHtml = (booking) => {
    if (booking.paymentStatus === 'Full Payment') return '';
    const dueDP2 = getDueDateDP2(booking);
    const duePelunasan = getDueDatePelunasan(booking);
    const rows = [];
    if (dueDP2) {
      rows.push(`<p>Jatuh Tempo DP 2: <strong style="${isOverdue(dueDP2) ? 'color:#e11d48;' : ''}">${formatDateDDMMYYYY(dueDP2)}${isOverdue(dueDP2) ? ' (lewat)' : ''}</strong></p>`);
    }
    if (duePelunasan) {
      rows.push(`<p>Jatuh Tempo Pelunasan: <strong style="${isOverdue(duePelunasan) ? 'color:#e11d48;' : ''}">${formatDateDDMMYYYY(duePelunasan)}${isOverdue(duePelunasan) ? ' (lewat)' : ''}</strong></p>`);
    }
    return rows.join('');
  };

  const buildInvoiceBoxHtml = (booking, payments) => {
    const isLunas = booking.paymentStatus === 'Full Payment';
    const totalAmount = Number(booking.totalAmount) || 0;
    // Biaya Tambahan & Potongan Harga (daftar bebas) disimpan flat di tiap
    // dokumen booking — harga paket murni dihitung mundur dari totalAmount
    // biar rinciannya tetap akurat walau nggak ada field harga dasar terpisah.
    const chargesList = booking.extraCharges || [];
    const discountsList = booking.extraDiscounts || [];
    const chargesTotal = chargesList.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
    const discountsTotal = discountsList.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    const hasExtras = chargesList.length > 0 || discountsList.length > 0;
    const basePackagePrice = totalAmount - chargesTotal + discountsTotal;
    const chargeRowsHtml = chargesList.map(c => `
          <tr>
            <td>${c.name || 'Biaya Tambahan'}${c.notes ? ` <span style="font-weight: 400; font-style: italic; color: #64748b;">(${c.notes})</span>` : ''}:</td>
            <td style="text-align: right; white-space: nowrap;">Rp ${Number(c.amount || 0).toLocaleString('id-ID')}</td>
          </tr>`).join('');
    const discountRowsHtml = discountsList.map(d => `
          <tr>
            <td>${d.name || 'Diskon'}${d.notes ? ` <span style="font-weight: 400; font-style: italic; color: #64748b;">(${d.notes})</span>` : ''}:</td>
            <td style="text-align: right; color: #d97706; white-space: nowrap;">- Rp ${Number(d.amount || 0).toLocaleString('id-ID')}</td>
          </tr>`).join('');
    const { compName, compAddress, compPpiu, compPhone, compEmail, bankName, bankAccount } = getCompanyInvoiceVars();

    const totalPaid = payments.length > 0
      ? payments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      : (Number(booking.totalPaid) || 0);

    const sisaTagihan = totalAmount - totalPaid;

    const paymentRowsHtml = payments.length > 0
      ? payments.map((pay, idx) => `
          <tr style="background-color: #f8fafc; font-size: 11px; color: #475569;">
            <td style="padding: 6px 12px; border-bottom: 1px solid #f1f5f9;">
              • Setoran #${idx + 1} (${formatDateDDMMYYYY(pay.createdAt)}) - <span style="font-style: italic;">${pay.paymentMethod || 'Transfer'}${pay.accountName ? ' - ' + pay.accountName : ''} (${pay.notes || 'Setoran'})</span>
            </td>
            <td style="text-align: right; padding: 6px 12px; font-weight: 600; color: #059669; border-bottom: 1px solid #f1f5f9; white-space: nowrap;">
              + Rp ${Number(pay.amount || 0).toLocaleString('id-ID')}
            </td>
          </tr>
        `).join('')
      : `
          <tr style="background-color: #f8fafc; font-size: 11px; color: #94a3b8;">
            <td style="padding: 6px 12px;" colspan="2">• Belum ada catatan setoran masuk</td>
          </tr>
        `;

    return `
      <div class="invoice-box">
        <div class="kop-header">
          <div>
            <h1 class="company-logo-title">${compName}</h1>
            <p class="company-sub">Penyelenggara Perjalanan Ibadah Umrah, Haji & Wisata Halal • ${compPpiu}</p>
            <p class="company-address">
              ${compAddress}<br>
              Telp/WA: ${compPhone} | Email: ${compEmail}
            </p>
          </div>
          <div>
            <div class="invoice-type" style="color: ${isLunas ? '#059669' : '#d97706'};">${isLunas ? 'INVOICE' : 'PROFORMA INVOICE'}</div>
            <div class="badge" style="background-color: ${isLunas ? '#d1fae5' : '#fef3c7'}; color: ${isLunas ? '#065f46' : '#92400e'};">${isLunas ? 'LUNAS / PAID' : 'BELUM LUNAS / UNPAID'}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-card">
            <h4>Ditagihkan Kepada (Customer):</h4>
            <p>Nama Lengkap: <strong>${booking.jamaahName || '-'}</strong></p>
            <p>No. Telepon / WA: <strong>${booking.jamaahPhone || booking.phone || '-'}</strong></p>
            <p>NPWP: <strong>${booking.jamaahNpwp || booking.npwp || '-'}</strong></p>
            <p>Alamat: <strong>${booking.jamaahAddress || booking.address || '-'}</strong></p>
          </div>
          <div class="meta-card">
            <h4>Rincian Dokumen:</h4>
            <p>Kode Booking: <strong style="color: #059669; font-family: monospace;">${booking.groupBookingCode || booking.bookingCode}</strong></p>
            <p>Tanggal Terbit: <strong>${new Date().toLocaleDateString('id-ID')}</strong></p>
            <p>Status Setoran: <strong>${booking.paymentStatus || 'DP Paid'}</strong></p>
            ${buildDueDatesHtml(booking)}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Program Paket Travel</th>
              <th>Tgl Keberangkatan</th>
              <th>Kamar / Bus</th>
              <th style="text-align: right;">Jumlah Tagihan</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>${booking.packageName || '-'}</strong></td>
              <td>${formatDateDDMMYYYY(booking.departureDate)}</td>
              <td>${booking.roomType} / ${booking.busGroup}</td>
              <td style="text-align: right; font-weight: bold; white-space: nowrap;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
            </tr>
          </tbody>
        </table>

        <table class="summary-table">
          <tr class="summary-header-row">
            <td>${hasExtras ? 'Harga Paket:' : 'Total Harga Paket:'}</td>
            <td style="text-align: right; font-weight: bold; white-space: nowrap;">Rp ${basePackagePrice.toLocaleString('id-ID')}</td>
          </tr>
          ${chargeRowsHtml}
          ${discountRowsHtml}
          ${hasExtras ? `
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td style="font-weight: bold;">Total Harga Keseluruhan Pemesanan:</td>
            <td style="text-align: right; font-weight: bold; white-space: nowrap;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
          </tr>` : ''}
          <tr style="background-color: #f1f5f9; border-top: 1px solid #e2e8f0;">
            <td colspan="2" style="font-weight: bold; font-size: 11px; color: #047857; text-transform: uppercase;">
              Rincian Setoran Pembayaran Diterima:
            </td>
          </tr>
          ${paymentRowsHtml}
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td style="font-weight: bold;">Total Terbayar:</td>
            <td style="text-align: right; font-weight: bold; color: #059669; white-space: nowrap;">
              Rp ${totalPaid.toLocaleString('id-ID')}
            </td>
          </tr>
          <tr class="total-row">
            <td>Sisa Tagihan / Saldo:</td>
            <td style="text-align: right; color: ${sisaTagihan > 0 ? '#d97706' : '#059669'}; white-space: nowrap;">
              Rp ${sisaTagihan.toLocaleString('id-ID')}
            </td>
          </tr>
        </table>

        <div class="footer-section">
          <div class="bank-info">
            <h5>Informasi Pembayaran / Transfer:</h5>
            <div>Silakan lakukan pembayaran melalui rekening resmi perusahaan:</div>
            <div class="bank-details" style="margin-top: 6px;">
              Bank: <strong>${bankName}</strong><br>
              No. Rekening & A.N: <strong>${bankAccount}</strong>
            </div>
          </div>
          <div class="signature-box">
            <p>Jakarta, ${new Date().toLocaleDateString('id-ID')}<br>Finance & Billing Dept.</p>
            <div class="signature-space"></div>
            <p><strong>( ${compName} )</strong></p>
          </div>
        </div>

        <div class="footer-note">
          <p>Terima kasih atas kepercayaan Anda. Dokumen ini sah dan diterbitkan secara otomatis oleh sistem ERP WHISys.</p>
        </div>
      </div>
    `;
  };

  // Bungkus 1 atau lebih "kotak invoice" jadi 1 dokumen HTML lengkap siap print.
  const wrapInvoiceDocument = (title, bodyHtml) => `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 40px; background-color: #fff; }
            .invoice-box { max-width: 800px; margin: auto; border: 1px solid #e2e8f0; padding: 35px; border-radius: 12px; }
            .kop-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #059669; padding-bottom: 20px; margin-bottom: 25px; }
            .company-logo-title { font-size: 22px; font-weight: 800; color: #065f46; letter-spacing: -0.5px; margin: 0; }
            .company-sub { font-size: 11px; color: #047857; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin: 2px 0 8px 0; }
            .company-address { font-size: 11px; color: #475569; line-height: 1.5; margin: 0; }
            .invoice-type { font-size: 20px; font-weight: 800; text-transform: uppercase; text-align: right; }
            .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: bold; margin-top: 5px; }
            .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px; }
            .meta-card { background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #f1f5f9; }
            .meta-card h4 { margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; color: #059669; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
            .meta-card p { margin: 3px 0; font-size: 12px; color: #334155; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th { background-color: #f1f5f9; text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
            td { padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
            .summary-table { width: 100%; max-width: 500px; margin-left: auto; margin-bottom: 30px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
            .summary-table td { padding: 8px 12px; }
            .summary-header-row { background-color: #f1f5f9; font-weight: bold; }
            .summary-table .total-row { font-size: 14px; font-weight: bold; color: #0f172a; background-color: #f8fafc; border-top: 2px solid #cbd5e1; }
            .footer-section { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 20px; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 10px; }
            .bank-info { background-color: #f0fdf4; border: 1px dashed #a7f3d0; padding: 12px 15px; border-radius: 8px; font-size: 11px; color: #065f46; }
            .bank-info h5 { margin: 0 0 6px 0; font-size: 12px; color: #047857; text-transform: uppercase; letter-spacing: 0.5px; }
            .signature-box { text-align: center; font-size: 11px; color: #64748b; }
            .signature-space { height: 50px; }
            .footer-note { text-align: center; font-size: 10px; color: #94a3b8; margin-top: 25px; border-top: 1px solid #f1f5f9; padding-top: 10px; }
            @media print { body { padding: 0; } .invoice-box { border: none; padding: 0; } }
          </style>
        </head>
        <body>
          ${bodyHtml}
        </body>
      </html>
    `;

  // Cetak 1 dokumen HTML lewat iframe tersembunyi (dipakai bareng-bareng buat
  // cetak invoice 1 pax maupun invoice sekaligus 1 grup).
  const printHtmlDocument = (docContent) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(docContent);
    doc.close();

    iframe.contentWindow.focus();
    setTimeout(() => {
      iframe.contentWindow.print();
      document.body.removeChild(iframe);
    }, 500);
  };

  const fetchPaymentsForBooking = async (bookingId) => {
    try {
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', bookingId));
      const snap = await getDocs(q);
      return snap.docs.map(d => d.data());
    } catch (err) {
      console.error("Gagal mengambil riwayat setoran untuk invoice:", err);
      return [];
    }
  };

  const handlePrintInvoice = async (booking) => {
    const isLunas = booking.paymentStatus === 'Full Payment';
    const payments = await fetchPaymentsForBooking(booking.id);
    const boxHtml = buildInvoiceBoxHtml(booking, payments);
    const docContent = wrapInvoiceDocument(`${isLunas ? 'INVOICE' : 'PROFORMA INVOICE'} - ${booking.bookingCode}`, boxHtml);
    printHtmlDocument(docContent);
  };

  // Bangun HTML invoice GABUNGAN buat 1 grup booking — beda dari
  // buildInvoiceBoxHtml (yang per-pax): di sini nominalnya dijumlah jadi 1
  // (kode booking rombongan, total pax, & total harga keseluruhan pemesanan),
  // bukan 1 invoice terpisah per peserta. Daftar nama peserta tetap
  // ditampilkan sebagai rincian, tapi cuma jadi 1 baris tabel per orang di
  // DALAM 1 invoice yang sama, bukan halaman terpisah-pisah.
  const buildGroupInvoiceBoxHtml = (items, allPayments) => {
    const first = items[0];
    const groupCode = first.groupBookingCode || first.bookingCode;
    const totalAmount = items.reduce((acc, b) => acc + (Number(b.totalAmount) || 0), 0);
    const totalPaid = allPayments.length > 0
      ? allPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
      : items.reduce((acc, b) => acc + (Number(b.totalPaid) || 0), 0);
    const sisaTagihan = totalAmount - totalPaid;
    const isLunas = sisaTagihan <= 0;
    // Biaya Tambahan & Potongan Harga (daftar bebas) digabung balik dari
    // porsi tiap pax (mergeExtraLists) — hasilnya daftar flat aslinya yang
    // diinput staff.
    const chargesList = mergeExtraLists(items, 'extraCharges');
    const discountsList = mergeExtraLists(items, 'extraDiscounts');
    const chargesTotal = chargesList.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
    const discountsTotal = discountsList.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    const hasExtras = chargesList.length > 0 || discountsList.length > 0;
    const basePackagePrice = totalAmount - chargesTotal + discountsTotal;
    const chargeRowsHtml = chargesList.map(c => `
          <tr>
            <td>${c.name || 'Biaya Tambahan'}${c.notes ? ` <span style="font-weight: 400; font-style: italic; color: #64748b;">(${c.notes})</span>` : ''}:</td>
            <td style="text-align: right; white-space: nowrap;">Rp ${Number(c.amount || 0).toLocaleString('id-ID')}</td>
          </tr>`).join('');
    const discountRowsHtml = discountsList.map(d => `
          <tr>
            <td>${d.name || 'Diskon'}${d.notes ? ` <span style="font-weight: 400; font-style: italic; color: #64748b;">(${d.notes})</span>` : ''}:</td>
            <td style="text-align: right; color: #d97706; white-space: nowrap;">- Rp ${Number(d.amount || 0).toLocaleString('id-ID')}</td>
          </tr>`).join('');
    const { compName, compAddress, compPpiu, compPhone, compEmail, bankName, bankAccount } = getCompanyInvoiceVars();

    const pesertaRowsHtml = items.map((b, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${b.jamaahName || '-'}</td>
        <td>${b.roomType || '-'} / ${b.busGroup || '-'}</td>
        <td style="text-align: right; white-space: nowrap;">Rp ${Number(b.totalAmount || 0).toLocaleString('id-ID')}</td>
      </tr>
    `).join('');

    // Gabungan semua setoran dari SELURUH pax dlm grup ini jadi baris
    // TRANSAKSI (pakai logika gabung yang sama dengan modal Riwayat
    // Pembayaran) — jadi 1x setoran DP yang otomatis kesplit ke N peserta
    // tetap muncul sebagai 1 baris nominal gabungan, bukan N baris per pax.
    const mergedTransactions = buildMergedGroupTransactions(allPayments);
    const paymentRowsHtml = mergedTransactions.length > 0
      ? mergedTransactions.map((tx, idx) => `
          <tr style="background-color: #f8fafc; font-size: 11px; color: #475569;">
            <td style="padding: 6px 12px; border-bottom: 1px solid #f1f5f9;">
              • Setoran #${idx + 1} (${formatDateDDMMYYYY(tx.createdAt)}) - <span style="font-style: italic;">${tx.paymentMethod || 'Transfer'}${tx.accountName ? ' - ' + tx.accountName : ''} (${tx.notes || 'Setoran'})</span>
            </td>
            <td style="text-align: right; padding: 6px 12px; font-weight: 600; color: #059669; border-bottom: 1px solid #f1f5f9; white-space: nowrap;">
              + Rp ${Number(tx.amount || 0).toLocaleString('id-ID')}
            </td>
          </tr>
        `).join('')
      : `
          <tr style="background-color: #f8fafc; font-size: 11px; color: #94a3b8;">
            <td style="padding: 6px 12px;" colspan="2">• Belum ada catatan setoran masuk</td>
          </tr>
        `;

    return `
      <div class="invoice-box">
        <div class="kop-header">
          <div>
            <h1 class="company-logo-title">${compName}</h1>
            <p class="company-sub">Penyelenggara Perjalanan Ibadah Umrah, Haji & Wisata Halal • ${compPpiu}</p>
            <p class="company-address">
              ${compAddress}<br>
              Telp/WA: ${compPhone} | Email: ${compEmail}
            </p>
          </div>
          <div>
            <div class="invoice-type" style="color: ${isLunas ? '#059669' : '#d97706'};">${isLunas ? 'INVOICE' : 'PROFORMA INVOICE'}</div>
            <div class="badge" style="background-color: ${isLunas ? '#d1fae5' : '#fef3c7'}; color: ${isLunas ? '#065f46' : '#92400e'};">${isLunas ? 'LUNAS / PAID' : 'BELUM LUNAS / UNPAID'}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-card">
            <h4>Ditagihkan Kepada (Pemesan):</h4>
            <p>Nama Pemesan: <strong>${first.ordererName || '-'}</strong></p>
            <p>Jumlah Peserta: <strong>${items.length} Pax</strong></p>
          </div>
          <div class="meta-card">
            <h4>Rincian Pemesanan:</h4>
            <p>Kode Booking (Rombongan): <strong style="color: #059669; font-family: monospace;">${groupCode}</strong></p>
            <p>Tanggal Terbit: <strong>${new Date().toLocaleDateString('id-ID')}</strong></p>
            <p>Status Setoran: <strong>${isLunas ? 'Lunas' : 'DP Paid / Cicilan'}</strong></p>
            ${buildDueDatesHtml({
              departureDate: first.departureDate,
              createdAt: items.reduce((earliest, b) => (!earliest || new Date(b.createdAt) < new Date(earliest)) ? b.createdAt : earliest, null),
              paymentStatus: isLunas ? 'Full Payment' : 'DP Paid'
            })}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Program Paket Travel</th>
              <th>Tgl Keberangkatan</th>
              <th>Jumlah Pax</th>
              <th style="text-align: right;">Total Harga Pemesanan</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>${first.packageName || '-'}</strong></td>
              <td>${formatDateDDMMYYYY(first.departureDate)}</td>
              <td>${items.length} Pax</td>
              <td style="text-align: right; font-weight: bold; white-space: nowrap;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
            </tr>
          </tbody>
        </table>

        <table>
          <thead>
            <tr>
              <th>No</th>
              <th>Nama Peserta</th>
              <th>Kamar / Bus</th>
              <th style="text-align: right;">Tagihan Peserta</th>
            </tr>
          </thead>
          <tbody>
            ${pesertaRowsHtml}
          </tbody>
        </table>

        <table class="summary-table">
          <tr class="summary-header-row">
            <td>${hasExtras ? 'Harga Paket (Seluruh Peserta):' : 'Total Harga Keseluruhan Pemesanan:'}</td>
            <td style="text-align: right; font-weight: bold; white-space: nowrap;">Rp ${basePackagePrice.toLocaleString('id-ID')}</td>
          </tr>
          ${chargeRowsHtml}
          ${discountRowsHtml}
          ${hasExtras ? `
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td style="font-weight: bold;">Total Harga Keseluruhan Pemesanan:</td>
            <td style="text-align: right; font-weight: bold; white-space: nowrap;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
          </tr>` : ''}
          <tr style="background-color: #f1f5f9; border-top: 1px solid #e2e8f0;">
            <td colspan="2" style="font-weight: bold; font-size: 11px; color: #047857; text-transform: uppercase;">
              Rincian Setoran Pembayaran Diterima (Seluruh Peserta):
            </td>
          </tr>
          ${paymentRowsHtml}
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td style="font-weight: bold;">Total Terbayar:</td>
            <td style="text-align: right; font-weight: bold; color: #059669; white-space: nowrap;">
              Rp ${totalPaid.toLocaleString('id-ID')}
            </td>
          </tr>
          <tr class="total-row">
            <td>Sisa Tagihan / Saldo:</td>
            <td style="text-align: right; color: ${sisaTagihan > 0 ? '#d97706' : '#059669'}; white-space: nowrap;">
              Rp ${sisaTagihan.toLocaleString('id-ID')}
            </td>
          </tr>
        </table>

        <div class="footer-section">
          <div class="bank-info">
            <h5>Informasi Pembayaran / Transfer:</h5>
            <div>Silakan lakukan pembayaran melalui rekening resmi perusahaan:</div>
            <div class="bank-details" style="margin-top: 6px;">
              Bank: <strong>${bankName}</strong><br>
              No. Rekening & A.N: <strong>${bankAccount}</strong>
            </div>
          </div>
          <div class="signature-box">
            <p>Jakarta, ${new Date().toLocaleDateString('id-ID')}<br>Finance & Billing Dept.</p>
            <div class="signature-space"></div>
            <p><strong>( ${compName} )</strong></p>
          </div>
        </div>

        <div class="footer-note">
          <p>Terima kasih atas kepercayaan Anda. Dokumen ini sah dan diterbitkan secara otomatis oleh sistem ERP WHISys.</p>
        </div>
      </div>
    `;
  };

  // Cetak invoice buat 1 grup booking — HASILNYA 1 INVOICE AJA (bukan
  // per-pax/per-halaman), nominalnya udah ditotal: kode booking rombongan,
  // total pax, & total harga keseluruhan pemesanan. Dipanggil dari tombol
  // Cetak di header grup (bukan lagi dari baris masing-masing peserta).
  const handlePrintGroupInvoices = async (items) => {
    if (!items || items.length === 0) return;
    try {
      const paymentsPerBooking = await Promise.all(items.map(b => fetchPaymentsForBooking(b.id)));
      const allPayments = paymentsPerBooking.flat();
      const boxHtml = buildGroupInvoiceBoxHtml(items, allPayments);
      const first = items[0];
      const title = `Invoice - ${first.groupBookingCode || first.bookingCode}`;
      const docContent = wrapInvoiceDocument(title, boxHtml);
      printHtmlDocument(docContent);
    } catch (err) {
      alert("Gagal menyiapkan invoice: " + err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.packageId) {
      alert("Pilih Paket Travel.");
      return;
    }
    if (!formData.ordererId) {
      alert("Pilih atau isi data Pemesan (yang melakukan pemesanan).");
      return;
    }
    if (formData.ordererId === '__new__' && !newOrdererForm.fullName.trim()) {
      alert("Isi nama lengkap pemesan baru terlebih dahulu.");
      return;
    }
    const pesertaEntries = formData.pesertaList || [];
    if (pesertaEntries.length === 0) {
      alert("Tambahkan minimal 1 peserta.");
      return;
    }
    for (let i = 0; i < pesertaEntries.length; i++) {
      const entry = pesertaEntries[i];
      if (!entry.jamaahId) {
        alert(`Pilih atau isi data Peserta ${i + 1}.`);
        return;
      }
      if (entry.jamaahId === '__new__' && !(entry.newJamaah?.fullName || '').trim()) {
        alert(`Isi nama lengkap Peserta ${i + 1} (Jamaah Baru) terlebih dahulu.`);
        return;
      }
    }

    try {
      const selectedPkg = packagesList.find(p => p.id === formData.packageId);

      // Salinan kerja data jamaah — dipakai buat generate kode customer baru
      // (utk Pemesan maupun tiap entry Daftar Peserta) tanpa tabrakan kode
      // kalau lebih dari satu sama-sama "Tambah Baru" dalam satu submit yang sama.
      let workingJamaahList = [...jamaahList];

      // Resolusi data Pemesan (orderer) — independen dari peserta/jamaah yang
      // berangkat. Pemesan cuma metadata pada booking (siapa yang melakukan
      // pemesanan), BUKAN entry pax/manifest — jadi nggak pernah didorong ke
      // documents/participant array manapun.
      let selectedOrderer = null;
      if (formData.ordererId === '__new__') {
        const newOrdererCode = generateNextCustomerCode(workingJamaahList);
        const newOrdererRef = await addDoc(collection(db, 'jamaah'), {
          customerCode: newOrdererCode,
          fullName: newOrdererForm.fullName.trim(),
          nik: newOrdererForm.nik || '',
          gender: 'L',
          phone: newOrdererForm.phone || '',
          passportNumber: newOrdererForm.passportNumber || '',
          passportExpiry: '',
          address: '',
          createdAt: new Date().toISOString()
        });
        selectedOrderer = {
          id: newOrdererRef.id,
          customerCode: newOrdererCode,
          fullName: newOrdererForm.fullName.trim()
        };
        workingJamaahList = [...workingJamaahList, selectedOrderer];
      } else {
        selectedOrderer = jamaahList.find(j => j.id === formData.ordererId) || null;
      }
      const ordererId = selectedOrderer?.id || null;
      const ordererName = selectedOrderer?.fullName || '';

      // Resolusi tiap entry Daftar Peserta — pola sama persis dengan Pemesan:
      // pilih jamaah existing, atau bikin baru kalau "__new__". Nggak ada lagi
      // fuzzy name-matching (findJamaahByName) — tiap peserta eksplisit dipilih
      // dari Data Master Jamaah, atau eksplisit dibuatkan data barunya.
      const paxList = [];
      for (const entry of pesertaEntries) {
        if (entry.jamaahId === '__new__') {
          const newCode = generateNextCustomerCode(workingJamaahList);
          const newJamaahRef = await addDoc(collection(db, 'jamaah'), {
            customerCode: newCode,
            fullName: entry.newJamaah.fullName.trim(),
            nik: entry.newJamaah.nik || '',
            gender: 'L',
            phone: entry.newJamaah.phone || '',
            passportNumber: entry.newJamaah.passportNumber || '',
            passportExpiry: '',
            address: '',
            createdAt: new Date().toISOString()
          });
          const newJamaahData = {
            id: newJamaahRef.id,
            customerCode: newCode,
            fullName: entry.newJamaah.fullName.trim(),
            phone: entry.newJamaah.phone || '',
            passportNumber: entry.newJamaah.passportNumber || ''
          };
          workingJamaahList = [...workingJamaahList, newJamaahData];
          paxList.push({ jamaahId: newJamaahData.id, jamaahName: newJamaahData.fullName, passportNumber: newJamaahData.passportNumber || '-' });
        } else {
          const existing = workingJamaahList.find(j => j.id === entry.jamaahId);
          if (!existing) {
            throw new Error('Data jamaah peserta tidak ditemukan. Silakan pilih ulang.');
          }
          paxList.push({ jamaahId: existing.id, jamaahName: existing.fullName, passportNumber: existing.passportNumber || '-' });
        }
      }

      // Pax pertama di Daftar Peserta dipakai sebagai "selectedJamaah" utk alur
      // edit & registrasi 1 pax (perilaku sama seperti field "Pilih Jamaah" lama).
      const primaryPax = paxList[0];
      const selectedJamaah = { id: primaryPax.jamaahId, fullName: primaryPax.jamaahName, passportNumber: primaryPax.passportNumber };

      let price = Number(selectedPkg.priceQuad || selectedPkg.priceMain || 0);
      if (formData.roomType === 'Triple') price = Number(selectedPkg.priceTriple || price);
      if (formData.roomType === 'Double') price = Number(selectedPkg.priceDouble || price);

      // Biaya Tambahan & Potongan Harga — daftar bebas, nominalnya FLAT per
      // kode booking ini (bukan per pax). Buat booking rombongan, tiap baris
      // dibagi rata ke semua peserta pas ditulis ke masing-masing dokumen
      // booking (lihat splitFlatAmount), biar totalAmount tiap pax pas
      // dijumlah balik tetap sama dgn total harga keseluruhan pemesanan.
      const formCharges = formData.extraCharges || [];
      const formDiscounts = formData.extraDiscounts || [];
      const chargesTotalInput = formCharges.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
      const discountsTotalInput = formDiscounts.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);

      let paymentVal = Number(formData.initialPayment || 0);
      if (paymentVal > 0 && !canRecordPayment) {
        // Jaga-jaga: role yang nggak boleh nyatet setoran (mis. Operational)
        // tetap bisa proses booking-nya, tapi setorannya diabaikan di sini.
        paymentVal = 0;
      }

      // Kalau bayarnya pakai Saldo Deposit, pastikan saldo Pemesan cukup
      // dulu sebelum lanjut — validasi di sini, potongan aktualnya baru
      // dieksekusi (adjustDepositBalance) setelah booking/pembayaran berhasil dicatat.
      // Selain Saldo Deposit, wajib pilih akun Kas/Bank yang nerima uangnya.
      const orderer_ForDeposit = jamaahList.find(j => j.id === formData.ordererId);
      if (paymentVal > 0 && formData.paymentMethod === 'Saldo Deposit') {
        const currentBalance = Number(orderer_ForDeposit?.depositBalance || 0);
        if (paymentVal > currentBalance) {
          alert(`Saldo Deposit Pemesan tidak cukup. Saldo saat ini: Rp ${currentBalance.toLocaleString('id-ID')}, dibutuhkan: Rp ${paymentVal.toLocaleString('id-ID')}.`);
          return;
        }
      } else if (paymentVal > 0 && !formData.accountId) {
        alert("Pilih akun Kas/Bank yang nerima setoran ini dulu.");
        return;
      }
      const payAccount = financialAccounts.find(a => a.id === formData.accountId);

      if (editingBookingId) {
        if (!canManageBookings) {
          alert("Cuma Finance & Super Admin yang boleh mengedit booking.");
          return;
        }
        const currentBooking = bookings.find(b => b.id === editingBookingId);
        if (paymentVal > 0 && isPaymentDateBeforeBooking(formData.paymentDate, currentBooking?.createdAt)) {
          const minDate = getBookingMinDate(currentBooking?.createdAt);
          alert(`Tanggal setoran tambahan nggak boleh sebelum tanggal pemesanan ${currentBooking?.bookingCode || ''} dibuat (${minDate.split('-').reverse().join('/')}).`);
          return;
        }
        // Edit selalu 1 booking/pax (paxCount dipaksa 1 di handleOpenEditModal),
        // jadi daftar biaya/diskonnya langsung dipakai apa adanya (nggak
        // perlu dibagi rata splitFlatAmount — itu cuma buat registrasi rombongan baru).
        const editedTotalAmount = price + chargesTotalInput - discountsTotalInput;

        await updateDoc(doc(db, 'bookings', editingBookingId), {
          packageId: selectedPkg.id,
          packageName: selectedPkg.name,
          packageCode: selectedPkg.code,
          departureDate: selectedPkg.departureDate,
          jamaahId: selectedJamaah.id,
          jamaahName: selectedJamaah.fullName,
          passportNumber: selectedJamaah.passportNumber || '-',
          ordererId,
          ordererName,
          roomType: formData.roomType,
          busGroup: formData.busGroup,
          extraCharges: formCharges,
          extraDiscounts: formDiscounts,
          totalAmount: editedTotalAmount,
          updatedAt: new Date().toISOString()
        });

        if (paymentVal > 0) {
          const payRef = await addDoc(collection(db, 'payments_income'), {
            bookingId: editingBookingId,
            bookingCode: currentBooking.bookingCode,
            jamaahName: selectedJamaah.fullName,
            packageId: selectedPkg.id,
            packageName: selectedPkg.name,
            amount: paymentVal,
            paymentMethod: formData.paymentMethod,
            ...(formData.paymentMethod !== 'Saldo Deposit' ? { accountId: formData.accountId, accountName: payAccount?.name || '' } : {}),
            notes: formData.paymentNotes,
            createdAt: resolvePaymentCreatedAt(formData.paymentDate)
          });
          if (formData.paymentMethod === 'Saldo Deposit') {
            await adjustDepositBalance(ordererId, ordererName, -paymentVal, 'usage', `Bayar setoran booking ${currentBooking.bookingCode}`, currentBooking.bookingCode);
          } else {
            await adjustAccountBalance(formData.accountId, paymentVal, {
              description: `Setoran Booking ${currentBooking.bookingCode} - an. ${selectedJamaah.fullName || '-'}`,
              reference: currentBooking.bookingCode,
              source: 'booking_edit_payment',
              date: resolvePaymentCreatedAt(formData.paymentDate),
              sourceDocId: payRef.id
            });
          }
        }

        await syncBookingTotalPaid(editingBookingId, editedTotalAmount);

      } else {
        // paxCount diambil dari paxList yang sudah diresolusi di atas (Daftar
        // Peserta) — bukan dari formData.paxCount lagi, biar selalu akurat
        // sesuai jumlah entry peserta yang benar-benar berhasil diresolusi.
        const paxCount = paxList.length;

        if (Number(selectedPkg.quotaRemaining || 0) < paxCount) {
          alert(`Kuota paket ini tidak cukup. Sisa seat: ${selectedPkg.quotaRemaining || 0}, dibutuhkan: ${paxCount}.`);
          return;
        }

        const emptyDocChecklist = {
          passport: false, ktp_foto: false, family_cert: false, sponsor_letter: false,
          bank_statement: false, vaccine_cert: false, visa: false, ticket: false
        };

        if (paxCount === 1) {
          // ===== REGISTRASI 1 PAX (alur normal, tidak berubah) =====
          const bookingCode = `BK-${Date.now().toString().slice(-6)}`;
          const singleTotalAmount = price + chargesTotalInput - discountsTotalInput;

          const newBookingRef = await addDoc(collection(db, 'bookings'), {
            bookingCode,
            packageId: selectedPkg.id,
            packageName: selectedPkg.name,
            packageCode: selectedPkg.code,
            departureDate: selectedPkg.departureDate,
            jamaahId: selectedJamaah.id,
            jamaahName: selectedJamaah.fullName,
            passportNumber: selectedJamaah.passportNumber || '-',
            ordererId,
            ordererName,
            roomType: formData.roomType,
            busGroup: formData.busGroup,
            extraCharges: formCharges,
            extraDiscounts: formDiscounts,
            totalAmount: singleTotalAmount,
            totalPaid: paymentVal,
            paymentStatus: paymentVal >= singleTotalAmount ? 'Full Payment' : 'DP Paid',
            documents: emptyDocChecklist,
            // Waktu Transaksi booking ikut field tanggal yang diisi staff pas
            // registrasi/DP awal (formData.paymentDate) — bukan jam submit
            // sistem, biar bisa tetap akurat kalau input booking dilakukan
            // belakangan dari tanggal transaksi aslinya.
            createdAt: resolvePaymentCreatedAt(formData.paymentDate)
          });

          if (paymentVal > 0) {
            const payRef = await addDoc(collection(db, 'payments_income'), {
              bookingId: newBookingRef.id,
              bookingCode: bookingCode,
              jamaahName: selectedJamaah.fullName,
              packageId: selectedPkg.id,
              packageName: selectedPkg.name,
              amount: paymentVal,
              paymentMethod: formData.paymentMethod,
              ...(formData.paymentMethod !== 'Saldo Deposit' ? { accountId: formData.accountId, accountName: payAccount?.name || '' } : {}),
              notes: formData.paymentNotes,
              createdAt: resolvePaymentCreatedAt(formData.paymentDate)
            });
            if (formData.paymentMethod === 'Saldo Deposit') {
              await adjustDepositBalance(ordererId, ordererName, -paymentVal, 'usage', `Bayar DP booking ${bookingCode}`, bookingCode);
            } else {
              await adjustAccountBalance(formData.accountId, paymentVal, {
                description: `DP Booking ${bookingCode} - an. ${selectedJamaah.fullName || '-'}`,
                reference: bookingCode,
                source: 'booking_new_payment',
                date: resolvePaymentCreatedAt(formData.paymentDate),
                sourceDocId: payRef.id
              });
            }
          }

          await updateDoc(doc(db, 'packages', selectedPkg.id), { quotaRemaining: increment(-1) });

        } else {
          // ===== REGISTRASI GROUP / MULTI-PAX (jadi 1 manifest, kode grup sama) =====
          // paxList udah lengkap & final dari hasil resolusi Daftar Peserta di
          // atas (semua entry, termasuk Pax 1) — nggak perlu disusun ulang di sini.
          const groupBookingCode = `GRP-${Date.now().toString().slice(-6)}`;

          // Bagi rata setoran awal ke semua pax (sisa pembagian masuk ke pax pertama)
          const baseShare = Math.floor(paymentVal / paxCount);
          const remainder = paymentVal - (baseShare * paxCount);
          // Tandai seluruh dokumen payments_income hasil split DP awal grup ini
          // dgn groupTransactionId yang sama, biar bisa digabung balik jadi 1
          // baris transaksi pas ditampilkan di modal Riwayat Pembayaran.
          const groupTransactionId = `gtx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

          // Biaya tambahan (visa, tipping) & diskon flat per kode booking
          // rombongan ini — dibagi rata ke semua pax (sisa ke pax pertama),
          // pola sama persis dgn pembagian setoran awal di atas.
          const chargeSharesPerItem = formCharges.map(c => splitFlatAmount(Number(c.amount) || 0, paxCount));
          const discountSharesPerItem = formDiscounts.map(d => splitFlatAmount(Number(d.amount) || 0, paxCount));

          for (let i = 0; i < paxList.length; i++) {
            const pax = paxList[i];
            const paxShare = baseShare + (i === 0 ? remainder : 0);
            const bookingCode = `${groupBookingCode}-${i + 1}`;
            const paxCharges = formCharges.map((c, idx) => ({ id: c.id, name: c.name, notes: c.notes || '', amount: chargeSharesPerItem[idx][i] || 0 }));
            const paxDiscounts = formDiscounts.map((d, idx) => ({ id: d.id, name: d.name, notes: d.notes || '', amount: discountSharesPerItem[idx][i] || 0 }));
            const paxChargeTotal = paxCharges.reduce((acc, c) => acc + c.amount, 0);
            const paxDiscountTotal = paxDiscounts.reduce((acc, d) => acc + d.amount, 0);
            const paxTotalAmount = price + paxChargeTotal - paxDiscountTotal;

            const newBookingRef = await addDoc(collection(db, 'bookings'), {
              bookingCode,
              groupBookingCode,
              groupPaxIndex: i + 1,
              groupTotalPax: paxCount,
              packageId: selectedPkg.id,
              packageName: selectedPkg.name,
              packageCode: selectedPkg.code,
              departureDate: selectedPkg.departureDate,
              jamaahId: pax.jamaahId,
              jamaahName: pax.jamaahName,
              passportNumber: pax.passportNumber,
              // Semua pax dalam satu grup berbagi Pemesan yang sama — Pemesan
              // cuma metadata, bukan entry pax.
              ordererId,
              ordererName,
              roomType: formData.roomType,
              busGroup: formData.busGroup,
              extraCharges: paxCharges,
              extraDiscounts: paxDiscounts,
              totalAmount: paxTotalAmount,
              totalPaid: paxShare,
              paymentStatus: paxShare >= paxTotalAmount ? 'Full Payment' : 'DP Paid',
              documents: emptyDocChecklist,
              // Sama kayak alur 1 pax — Waktu Transaksi ikut field tanggal
              // yang diisi staff, bukan jam submit sistem.
              createdAt: resolvePaymentCreatedAt(formData.paymentDate)
            });

            if (paxShare > 0) {
              const payRef = await addDoc(collection(db, 'payments_income'), {
                bookingId: newBookingRef.id,
                bookingCode,
                jamaahName: pax.jamaahName,
                packageId: selectedPkg.id,
                packageName: selectedPkg.name,
                amount: paxShare,
                paymentMethod: formData.paymentMethod,
                ...(formData.paymentMethod !== 'Saldo Deposit' ? { accountId: formData.accountId, accountName: payAccount?.name || '' } : {}),
                notes: `${formData.paymentNotes} (Grup ${groupBookingCode}, ${paxCount} pax)`,
                createdAt: resolvePaymentCreatedAt(formData.paymentDate),
                groupTransactionId
              });
              if (formData.paymentMethod !== 'Saldo Deposit') {
                await adjustAccountBalance(formData.accountId, paxShare, {
                  description: `DP Booking Grup ${groupBookingCode} - ${pax.jamaahName || bookingCode}`,
                  reference: bookingCode,
                  source: 'booking_group_new_payment',
                  date: resolvePaymentCreatedAt(formData.paymentDate),
                  sourceDocId: payRef.id
                });
              }
            }
          }

          if (formData.paymentMethod === 'Saldo Deposit' && paymentVal > 0) {
            await adjustDepositBalance(ordererId, ordererName, -paymentVal, 'usage', `Bayar DP booking grup ${groupBookingCode}`, groupBookingCode);
          }

          await updateDoc(doc(db, 'packages', selectedPkg.id), { quotaRemaining: increment(-paxCount) });
        }
      }

      setShowModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal memproses booking: " + err.message);
    }
  };

  const filteredBookings = bookings
    .filter(b => {
      const status = b.status || 'active';
      if (viewFilter === 'active') return status === 'active';
      if (viewFilter === 'cancelled') return status === 'cancelled';
      if (viewFilter === 'rescheduled') return status === 'rescheduled';
      return true; // 'all'
    })
    .filter(b =>
      (b.jamaahName && b.jamaahName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (b.packageName && b.packageName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (b.bookingCode && b.bookingCode.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (b.groupBookingCode && b.groupBookingCode.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (b.ordererName && b.ordererName.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .filter(b => {
      if (dueDateFilter === 'all') return true;
      // Booking yang udah lunas/batal/reschedule nggak punya due date yang
      // relevan lagi (sama kayak renderDueDates di tabel).
      if (b.status === 'cancelled' || b.status === 'rescheduled' || b.paymentStatus === 'Full Payment') return false;
      const dueDP2 = getDueDateDP2(b);
      const duePelunasan = getDueDatePelunasan(b);
      const soonThreshold = shiftDateByDays(new Date().toISOString().slice(0, 10), DUE_SOON_DAYS);
      if (dueDateFilter === 'overdue_dp2') return dueDP2 && isOverdue(dueDP2);
      if (dueDateFilter === 'overdue_pelunasan') return duePelunasan && isOverdue(duePelunasan);
      if (dueDateFilter === 'overdue_any') return (dueDP2 && isOverdue(dueDP2)) || (duePelunasan && isOverdue(duePelunasan));
      if (dueDateFilter === 'upcoming_dp2') return dueDP2 && !isOverdue(dueDP2) && dueDP2 <= soonThreshold;
      if (dueDateFilter === 'upcoming_pelunasan') return duePelunasan && !isOverdue(duePelunasan) && duePelunasan <= soonThreshold;
      return true;
    });

  // ============ RINGKASAN GRUP UNTUK TAMPILAN DEFAULT BOOKING & MANIFEST ============
  // Kelompokkan booking berdasarkan groupBookingCode; booking single-pax (tanpa
  // groupBookingCode) diperlakukan sebagai grup isi 1 orang sendiri.
  const groupedBookingSummary = (() => {
    const map = {};
    filteredBookings.forEach(b => {
      const code = b.groupBookingCode || b.bookingCode;
      if (!map[code]) map[code] = [];
      map[code].push(b);
    });

    return Object.entries(map).map(([code, items]) => {
      const primary = items[0];
      const totalAmount = items.reduce((acc, i) => acc + (Number(i.totalAmount) || 0), 0);
      const totalPaid = items.reduce((acc, i) => acc + (Number(i.totalPaid) || 0), 0);
      const percentBayar = totalAmount > 0 ? (totalPaid / totalAmount) * 100 : 0;

      // Waktu Transaksi grup = createdAt paling awal di antara pax-pax dalam grup
      const earliestCreatedAt = items.reduce((earliest, i) => {
        if (!i.createdAt) return earliest;
        if (!earliest) return i.createdAt;
        return new Date(i.createdAt) < new Date(earliest) ? i.createdAt : earliest;
      }, null);

      return { code, items, primary, paxCount: items.length, totalAmount, totalPaid, percentBayar, earliestCreatedAt };
    }).sort((a, b) => new Date(b.earliestCreatedAt || 0) - new Date(a.earliestCreatedAt || 0));
  })();

  // Daftar booking per-pax (tampilan detail lama) untuk grup yang lagi dibuka
  const activeGroupBookings = activeGroupCode
    ? filteredBookings.filter(b => (b.groupBookingCode || b.bookingCode) === activeGroupCode)
    : [];

  // Objek "group" ad-hoc buat grup yang lagi dibuka di tampilan detail — bentuknya
  // disamain kayak entry groupedBookingSummary (code/items/primary/paxCount) biar
  // ke-5 handler aksi level grup bisa dipakai dari header manapun (ringkasan / detail).
  const activeGroupSummary = {
    code: activeGroupCode,
    items: activeGroupBookings,
    primary: activeGroupBookings[0] || {},
    paxCount: activeGroupBookings.length
  };
  // Subset pax yang statusnya masih aktif di grup yang lagi dibuka — dipakai buat
  // nentuin kapan tombol Reschedule/Batalkan Grup muncul & buat kuota math-nya.
  const activeGroupItems = activeGroupBookings.filter(b => (b.status || 'active') === 'active');

  const roomingBookingsForPackage = bookings.filter(
    b => b.packageId === roomingPackageId && (b.status || 'active') === 'active'
  );
  const roomingPackage = packagesList.find(p => p.id === roomingPackageId);

  const bulkFeedbackBookings = bookings.filter(
    b => b.packageId === bulkFeedbackPackageId && (b.status || 'active') === 'active'
  );

  // Badge status booking — dipakai di ringkasan grup maupun tabel detail per-pax,
  // reuse logic/label/warna yang sama persis (Aktif = Lunas/DP, Dibatalkan, Reschedule).
  const renderStatusBadge = (item) => {
    if (item.status === 'cancelled') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-full font-semibold whitespace-nowrap">
          <Ban className="w-3 h-3" /> Dibatalkan
        </span>
      );
    }
    if (item.status === 'rescheduled') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-semibold whitespace-nowrap">
          <RotateCcw className="w-3 h-3" /> Reschedule
        </span>
      );
    }
    if (item.paymentStatus === 'Full Payment') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full font-semibold whitespace-nowrap">
          <CheckCircle className="w-3 h-3" /> Lunas
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full font-semibold whitespace-nowrap">
        <Clock className="w-3 h-3" /> DP / Cicilan
      </span>
    );
  };

  // Due date pembayaran — dipakai di tabel dashboard & invoice. Cuma
  // relevan selama status masih aktif & belum lunas (booking yang udah
  // lunas/batal/reschedule nggak perlu diingetin lagi).
  // - Due Date DP 2: H+30 dari DP pertama (createdAt booking).
  // - Due Date Pelunasan: H-40 sebelum tanggal keberangkatan.
  const renderDueDates = (item) => {
    if (item.status === 'cancelled' || item.status === 'rescheduled' || item.paymentStatus === 'Full Payment') return null;
    const dueDP2 = getDueDateDP2(item);
    const duePelunasan = getDueDatePelunasan(item);
    return (
      <div className="mt-1 space-y-0.5">
        {dueDP2 && (
          <div className={`text-[10px] ${isOverdue(dueDP2) ? 'text-rose-500 font-semibold' : 'text-slate-400'}`}>
            Jatuh Tempo DP 2: {formatDateDDMMYYYY(dueDP2)}{isOverdue(dueDP2) ? ' — lewat!' : ''}
          </div>
        )}
        {duePelunasan && (
          <div className={`text-[10px] ${isOverdue(duePelunasan) ? 'text-rose-500 font-semibold' : 'text-slate-400'}`}>
            Jatuh Tempo Pelunasan: {formatDateDDMMYYYY(duePelunasan)}{isOverdue(duePelunasan) ? ' — lewat!' : ''}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <BookOpen className="w-5 h-5 text-emerald-500" /> Booking & Manifest Group
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Plotting jamaah, kelengkapan berkas/dokumen, dan setoran pembayaran.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setRoomingPackageId(''); setShowRoomingModal(true); }}
            className={`flex items-center gap-2 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} px-4 py-2 rounded-lg text-sm font-medium transition-all`}
          >
            <DoorOpen className="w-4 h-4" /> Rooming List
          </button>
          <button
            onClick={() => { setBulkFeedbackPackageId(''); setSentFeedbackIds([]); setShowBulkFeedbackModal(true); }}
            className={`flex items-center gap-2 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} px-4 py-2 rounded-lg text-sm font-medium transition-all`}
          >
            <Star className="w-4 h-4" /> Kirim Feedback Massal
          </button>
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg"
          >
            <Plus className="w-4 h-4" /> Tambah Booking Baru
          </button>
        </div>
      </div>

      <div className={`${styles.cardBg} p-4 rounded-xl border flex flex-col sm:flex-row items-stretch sm:items-center gap-3`}>
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Cari Kode Booking, Nama Jamaah, atau Nama Paket..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full ${styles.inputBg} pl-9 pr-4 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className={`w-3.5 h-3.5 ${styles.textSub}`} />
          {[
            { key: 'active', label: 'Aktif' },
            { key: 'cancelled', label: 'Dibatalkan' },
            { key: 'rescheduled', label: 'Reschedule' },
            { key: 'all', label: 'Semua' }
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setViewFilter(f.key)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                viewFilter === f.key
                  ? 'bg-emerald-600 text-white'
                  : `${isDark ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className={`w-3.5 h-3.5 ${styles.textSub}`} />
          <select
            value={dueDateFilter}
            onChange={e => setDueDateFilter(e.target.value)}
            className={`${styles.inputBg} px-2.5 py-1.5 rounded-lg text-[11px] font-semibold focus:outline-none`}
          >
            <option value="all">Semua Jatuh Tempo</option>
            <option value="overdue_any">Lewat Jatuh Tempo (DP 2 / Pelunasan)</option>
            <option value="overdue_dp2">DP 2 — Lewat Jatuh Tempo</option>
            <option value="upcoming_dp2">DP 2 — Jatuh Tempo {DUE_SOON_DAYS} Hari Lagi</option>
            <option value="overdue_pelunasan">Pelunasan — Lewat Jatuh Tempo</option>
            <option value="upcoming_pelunasan">Pelunasan — Jatuh Tempo {DUE_SOON_DAYS} Hari Lagi</option>
          </select>
        </div>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        {activeGroupCode ? (
        <>
        <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <button
            onClick={() => setActiveGroupCode(null)}
            className={`flex items-center gap-1.5 text-xs font-semibold ${isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            ‹ Kembali ke Ringkasan Booking
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-emerald-500 mr-1">Grup: {activeGroupCode}</span>

            {/* 5 AKSI UTAMA LEVEL GRUP — versi primer/menonjol dari aksi yang
                udah ada per-peserta di dropdown "Aksi Lainnya" tiap baris.
                Aksi per-peserta TETAP ada & TETAP jalan, ini cuma tambahan
                supaya nangani grup sekaligus nggak perlu buka baris satu-satu. */}

            {/* 1. RIWAYAT PEMBAYARAN — selalu tampil, kayak tombol Riwayat
                per-peserta yang juga nggak digembok permission. Nampilin
                transaksi setoran ASLI (udah digabung balik), bukan pecahan
                per-pax hasil split. */}
            <button
              onClick={() => handleOpenGroupHistory(activeGroupBookings)}
              className={`flex items-center gap-1.5 px-3 py-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} rounded-lg text-[11px] font-medium transition-colors`}
              title="Riwayat Pembayaran Pemesanan Ini"
            >
              <History className="w-3.5 h-3.5" /> Riwayat Pembayaran
            </button>

            {/* 2. EDIT BOOKING (GRUP) */}
            {canManageBookings && (
              <button
                onClick={() => handleOpenGroupEditModal(activeGroupSummary)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-medium transition-colors"
                title="Edit Data Bersama Seluruh Peserta di Grup Ini"
              >
                <Edit className="w-3.5 h-3.5" /> Edit
              </button>
            )}

            {/* 3. RESCHEDULE (GRUP) — cuma muncul kalau masih ada pax aktif */}
            {activeGroupItems.length > 0 && canReschedule && (
              <button
                onClick={() => handleOpenGroupRescheduleModal(activeGroupSummary)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[11px] font-medium transition-colors"
                title="Reschedule Seluruh Peserta Aktif di Grup Ini"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reschedule Grup
              </button>
            )}

            {/* 4. BATALKAN / REFUND (GRUP) — cuma muncul kalau masih ada pax aktif */}
            {activeGroupItems.length > 0 && canManageBookings && (
              <button
                onClick={() => handleOpenGroupCancelModal(activeGroupSummary)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-medium transition-colors"
                title="Batalkan & Refund Seluruh Peserta Aktif di Grup Ini"
              >
                <Ban className="w-3.5 h-3.5" /> Batalkan
              </button>
            )}

            {/* 5. HAPUS BOOKING (GRUP) */}
            {canManageBookings && (
              <button
                onClick={() => handleGroupDeleteBooking(activeGroupSummary)}
                className={`flex items-center gap-1.5 px-3 py-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg text-[11px] font-medium transition-colors`}
                title="Hapus Seluruh Booking di Grup Ini"
              >
                <Trash2 className="w-3.5 h-3.5" /> Hapus
              </button>
            )}

            {/* TOMBOL CETAK — dipindah ke sini (level kode booking/grup), cetak
                sekaligus semua invoice pax dlm grup ini jadi 1 dokumen, bukan
                tombol print terpisah per baris peserta kayak sebelumnya. */}
            <button
              onClick={() => handlePrintGroupInvoices(activeGroupBookings)}
              className={`flex items-center gap-1.5 px-3 py-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} rounded-lg text-[11px] font-medium transition-colors`}
              title="Cetak Invoice Semua Peserta di Grup Ini"
            >
              <Printer className="w-3.5 h-3.5" /> Cetak Invoice
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`${styles.tableHeaderBg} uppercase tracking-wider border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <tr>
                <th className="p-4">Kode / Jamaah</th>
                <th className="p-4">Paket & Tgl</th>
                <th className="p-4">Kamar & Bus</th>
                <th className="p-4">Kelengkapan Dokumen</th>
                <th className="p-4">Tagihan & Setor</th>
                <th className="p-4">Status Bayar</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {loading ? (
                <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Memuat data manifest...</td></tr>
              ) : activeGroupBookings.length === 0 ? (
                <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Belum ada data booking.</td></tr>
              ) : (
                activeGroupBookings.map((item) => {
                  const docs = item.documents || {};
                  const collectedCount = REQUIRED_DOCUMENTS.filter(d => docs[d.key]).length;
                  const docPercent = Math.round((collectedCount / REQUIRED_DOCUMENTS.length) * 100);
                  const isDocComplete = collectedCount === REQUIRED_DOCUMENTS.length;

                  return (
                    <tr key={item.id} className={`${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'} transition-colors`}>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>
                        {item.jamaahName || '-'}
                        <span className="block text-[10px] text-emerald-500 font-mono">{item.bookingCode}</span>
                        {item.groupBookingCode && (
                          <span className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold ${isDark ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-purple-50 text-purple-600 border border-purple-200'}`}>
                            👥 Grup {item.groupPaxIndex}/{item.groupTotalPax}
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className={styles.textTitle}>{item.packageName || '-'}</span>
                        <span className={`block text-[10px] ${styles.textSub}`}>
                          {formatDateDDMMYYYY(item.departureDate)}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-block ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] mr-1`}>{item.roomType}</span>
                        <span className={`inline-block ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px]`}>{item.busGroup}</span>
                      </td>
                      
                      {/* KOLOM KELENGKAPAN DOKUMEN */}
                      <td className="p-4">
                        <button
                          onClick={() => handleOpenDocModal(item)}
                          className="group text-left p-1.5 -ml-1.5 rounded-lg hover:bg-slate-800/40 transition-all cursor-pointer"
                          title="Klik untuk kelola checklist dokumen"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-bold group-hover:underline ${isDocComplete ? 'text-emerald-500' : 'text-amber-500'}`}>
                              {collectedCount}/{REQUIRED_DOCUMENTS.length} Berkas ({docPercent}%) ↗
                            </span>
                          </div>
                          <div className={`w-28 h-1.5 ${isDark ? 'bg-slate-800' : 'bg-slate-200'} rounded-full overflow-hidden`}>
                            <div 
                              className={`h-full ${isDocComplete ? 'bg-emerald-500' : 'bg-amber-500'} transition-all`} 
                              style={{ width: `${docPercent}%` }}
                            />
                          </div>
                        </button>
                      </td>

                      <td className="p-4">
                        <div className={`font-bold ${styles.textTitle}`}>
                          Rp {item.totalAmount ? Number(item.totalAmount).toLocaleString('id-ID') : '0'}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-500">
                          Setor: Rp {item.totalPaid ? Number(item.totalPaid).toLocaleString('id-ID') : '0'}
                        </div>
                      </td>
                      <td className="p-4">
                        {renderStatusBadge(item)}
                        {item.status === 'cancelled' && (
                          <div className="text-[10px] text-rose-400 mt-1">Refund: Rp {Number(item.refundAmount || 0).toLocaleString('id-ID')}</div>
                        )}
                        {item.status === 'rescheduled' && (
                          <div className="text-[10px] text-blue-400 mt-1">Ke: {item.rescheduledToBookingCode || '-'}</div>
                        )}
                        {renderDueDates(item)}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* TOMBOL RIWAYAT PEMBAYARAN - selalu tampil, paling sering dipakai */}
                          <button
                            onClick={() => handleOpenHistory(item)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                            title="Riwayat & Setoran Pembayaran"
                          >
                            <Wallet className="w-4 h-4" />
                          </button>

                          {/* TOMBOL MAXIMIZE/MINIMIZE AKSI LAINNYA */}
                          <button
                            onClick={() => setExpandedActionsId(expandedActionsId === item.id ? null : item.id)}
                            className={`p-1.5 ${expandedActionsId === item.id ? 'bg-emerald-600 text-white' : (isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600')} rounded-lg transition-colors`}
                            title={expandedActionsId === item.id ? 'Sembunyikan Aksi Lainnya' : 'Tampilkan Aksi Lainnya'}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>

                          {expandedActionsId === item.id && (
                            <>
                              {/* TOMBOL WHATSAPP */}
                              <button
                                onClick={() => sendWhatsAppNotification(item)}
                                className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-lg transition-colors"
                                title="Kirim Konfirmasi via WhatsApp"
                              >
                                <MessageSquare className="w-4 h-4" />
                              </button>

                              {/* TOMBOL EDIT PEMBAYARAN — cetak invoice udah dipindah ke
                                  header grup (satu tombol buat semua pax), jadi slot ini
                                  diisi akses cepat buat catat/edit setoran booking INI
                                  doang (tanpa dibagi rata ke pax lain kayak tombol Setoran
                                  Grup di ringkasan). Pakai modal & handler yang sama dgn
                                  Setoran Grup, cuma "grup"-nya di-isi 1 booking ini aja. */}
                              {canManageBookings && (
                                <button
                                  onClick={() => handleOpenGroupPaymentModal({
                                    code: item.bookingCode,
                                    items: [item],
                                    primary: item,
                                    paxCount: 1
                                  })}
                                  className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-500 hover:text-white rounded-lg transition-colors"
                                  title="Edit / Catat Pembayaran Booking Ini"
                                >
                                  <Wallet className="w-4 h-4" />
                                </button>
                              )}

                              {canManageBookings && (
                                <>
                                  {/* TOMBOL EDIT BOOKING */}
                                  <button
                                    onClick={() => handleOpenEditModal(item)}
                                    className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                                    title="Edit Booking"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </button>
                                </>
                              )}

                              {(item.status || 'active') === 'active' && (
                                <>
                                  {canReschedule && (
                                    <>
                                      {/* TOMBOL RESCHEDULE */}
                                      <button
                                        onClick={() => handleOpenActionModal(item, 'reschedule')}
                                        className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                                        title="Reschedule ke Paket Lain"
                                      >
                                        <RotateCcw className="w-4 h-4" />
                                      </button>
                                    </>
                                  )}

                                  {canManageBookings && (
                                    <>
                                      {/* TOMBOL BATALKAN / REFUND */}
                                      <button
                                        onClick={() => handleOpenActionModal(item, 'cancel')}
                                        className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                                        title="Batalkan Booking & Proses Refund"
                                      >
                                        <Ban className="w-4 h-4" />
                                      </button>
                                    </>
                                  )}
                                </>
                              )}

                              {canManageBookings && (
                                <>
                                  {/* TOMBOL HAPUS BOOKING */}
                                  <button
                                    onClick={() => handleDeleteBooking(item)}
                                    className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                                    title="Hapus Booking"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        </>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`${styles.tableHeaderBg} uppercase tracking-wider border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <tr>
                <th className="p-4">Kode</th>
                <th className="p-4">Paket Wisata</th>
                <th className="p-4">Pemesan</th>
                <th className="p-4">Keberangkatan</th>
                <th className="p-4">Jumlah Pax</th>
                <th className="p-4">Waktu Transaksi</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Kekurangan</th>
                <th className="p-4">% Bayar</th>
                <th className="p-4 text-center">Setor</th>
                <th className="p-4 text-center">Opsi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {loading ? (
                <tr><td colSpan="11" className={`p-8 text-center ${styles.textSub}`}>Memuat data manifest...</td></tr>
              ) : groupedBookingSummary.length === 0 ? (
                <tr><td colSpan="11" className={`p-8 text-center ${styles.textSub}`}>Belum ada data booking.</td></tr>
              ) : (
                groupedBookingSummary.map((group) => (
                  <tr
                    key={group.code}
                    onClick={() => setActiveGroupCode(group.code)}
                    className={`${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'} transition-colors cursor-pointer`}
                  >
                    <td className="p-4 font-mono text-emerald-500 font-semibold whitespace-nowrap">{group.code}</td>
                    <td className={`p-4 ${styles.textTitle}`}>{group.primary.packageName || '-'}</td>
                    <td className={`p-4 ${styles.textTitle}`}>{group.primary.ordererName || '-'}</td>
                    <td className={`p-4 ${styles.textSub}`}>{formatDateDDMMYYYY(group.primary.departureDate)}</td>
                    <td className={`p-4 ${styles.textTitle}`}>{group.paxCount} Pax</td>
                    <td className={`p-4 ${styles.textSub}`}>{formatDateTimeID(group.earliestCreatedAt)}</td>
                    <td className="p-4">
                      {renderStatusBadge(group.primary)}
                      {renderDueDates({ ...group.primary, createdAt: group.earliestCreatedAt })}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className={`text-[10px] ${styles.textSub}`}>
                        Tagihan: Rp {Number(group.totalAmount || 0).toLocaleString('id-ID')}
                      </div>
                      {(() => {
                        const kekurangan = Number(group.totalAmount || 0) - Number(group.totalPaid || 0);
                        if (group.primary.status === 'cancelled' || group.primary.status === 'rescheduled') {
                          return <span className={styles.textSub}>-</span>;
                        }
                        if (kekurangan <= 0) {
                          return <span className="font-semibold text-emerald-500">Lunas</span>;
                        }
                        return <span className="font-bold text-amber-500">Rp {kekurangan.toLocaleString('id-ID')}</span>;
                      })()}
                    </td>
                    <td className={`p-4 font-semibold ${styles.textTitle}`}>{formatPercentID(group.percentBayar)}</td>
                    <td className="p-4 text-center">
                      {canManageBookings ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenGroupPaymentModal(group); }}
                          className="inline-flex items-center justify-center p-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-500 hover:text-white rounded-lg transition-colors"
                          title="Catat Setoran Grup"
                        >
                          <Wallet className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className={styles.textSub}>—</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveGroupCode(group.code); }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-medium"
                      >
                        Opsi ›
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* MODAL CHECKLIST MONITORING DOKUMEN JAMAAH */}
      {showDocModal && selectedBookingForDoc && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowDocModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <FileCheck className="w-5 h-5 text-purple-500" /> Checklist Dokumen Jamaah
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Jamaah: <strong className={styles.textTitle}>{selectedBookingForDoc.jamaahName}</strong> • Kode: <span className="font-mono text-emerald-500">{selectedBookingForDoc.bookingCode}</span>
            </p>

            <div className="space-y-2.5 mb-6">
              {REQUIRED_DOCUMENTS.map((docItem) => {
                const isChecked = docChecklist[docItem.key] || false;
                return (
                  <label
                    key={docItem.key}
                    onClick={() => setDocChecklist({ ...docChecklist, [docItem.key]: !isChecked })}
                    className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${
                      isChecked 
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' 
                        : `${styles.innerBg} text-slate-400`
                    }`}
                  >
                    <span className="text-xs font-semibold">{docItem.label}</span>
                    <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all ${
                      isChecked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-500'
                    }`}>
                      {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className={`pt-4 flex justify-between items-center border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" /> Centang berkas yang telah diserahkan
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDocModal(false)}
                  className={`px-3.5 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}
                >
                  Batal
                </button>
                <button
                  onClick={handleSaveDocChecklist}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium"
                >
                  Simpan Status Dokumen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FORM BOOKING */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <BookOpen className="w-5 h-5 text-emerald-500" /> {editingBookingId ? 'Edit Booking & Tambah Setoran' : 'Registrasi Booking Baru'}
            </h3>

            <form onSubmit={handleSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Pilih Paket Travel</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={formData.packageId}
                  onChange={e => setFormData({ ...formData, packageId: e.target.value })}
                >
                  <option value="">-- Pilih Program Keberangkatan --</option>
                  {packagesList.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code}) - Sisa Seat: {p.quotaRemaining ?? p.quotaTotal}
                    </option>
                  ))}
                </select>
              </div>

              {/* PEMESAN (ORDERER) — siapa yang melakukan pemesanan, belum tentu ikut
                  berangkat. Integrasi ke Data Master Jamaah, pola UX-nya sama persis
                  dengan Daftar Peserta di bawah: pilih existing atau Tambah Baru. */}
              <div>
                <label className="block mb-1 font-medium">Pemesan (Yang Melakukan Pemesanan)</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={formData.ordererId}
                  onChange={e => setFormData({ ...formData, ordererId: e.target.value })}
                >
                  <option value="">-- Pilih Data Master Jamaah --</option>
                  <option value="__new__">➕ Tambah Pemesan Baru (Belum Terdaftar)</option>
                  {jamaahList.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.fullName} - {j.customerCode || 'CST'} - Paspor: {j.passportNumber || 'Belum Ada'}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] mt-1 opacity-70">
                  Pemesan bukan otomatis peserta. Kalau Pemesan juga ikut berangkat, pilih/ketik lagi namanya di bagian Peserta di bawah.
                </p>
              </div>

              {formData.ordererId === '__new__' && (
                <div className={`${styles.innerBg} p-3 rounded-xl border space-y-2.5`}>
                  <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">Data Pemesan Baru</p>
                  <input
                    type="text" required
                    placeholder="Nama Lengkap (wajib)"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={newOrdererForm.fullName}
                    onChange={e => setNewOrdererForm({ ...newOrdererForm, fullName: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      placeholder="No. HP / WhatsApp"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={newOrdererForm.phone}
                      onChange={e => setNewOrdererForm({ ...newOrdererForm, phone: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="NIK"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={newOrdererForm.nik}
                      onChange={e => setNewOrdererForm({ ...newOrdererForm, nik: e.target.value })}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="No. Paspor (opsional)"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={newOrdererForm.passportNumber}
                    onChange={e => setNewOrdererForm({ ...newOrdererForm, passportNumber: e.target.value })}
                  />
                  <p className="text-[10px] opacity-70">Data lengkap lainnya (KTP, alamat, dll) bisa dilengkapi belakangan di menu Data Master Jamaah.</p>
                </div>
              )}

              {!editingBookingId && (
                <div>
                  <label className="block mb-1 font-medium">Jumlah Pax</label>
                  <input
                    type="number" min="1" max="20"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.paxCount}
                    onChange={e => handlePaxCountChange(e.target.value)}
                  />
                  <p className="text-[10px] mt-1 opacity-70">Kalau daftar bareng lebih dari 1 orang (keluarga/rombongan), isi jumlahnya di sini.</p>
                </div>
              )}

              {/* DAFTAR PESERTA — tiap slot pakai pola select + quick-add persis
                  seperti Pemesan di atas: pilih jamaah existing dari Data Master
                  Jamaah, atau "Tambah Jamaah Baru". Peserta = orang yang beneran
                  berangkat & masuk manifest/dokumen — independen dari Pemesan.
                  Panjang list ini selalu = Jumlah Pax (Pax 1 bukan field terpisah lagi). */}
              <div className="space-y-3">
                <label className="block font-medium">
                  Daftar Peserta {formData.pesertaList.length > 1 ? `(${formData.pesertaList.length} orang)` : ''}
                </label>
                {formData.pesertaList.map((entry, idx) => (
                  <div key={idx} className={`${styles.innerBg} p-3 rounded-xl border space-y-2.5`}>
                    <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">
                      Peserta {idx + 1}{idx === 0 && formData.pesertaList.length > 1 ? ' (Penanggung Jawab Rombongan)' : ''}
                    </p>
                    <select
                      required
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={entry.jamaahId}
                      onChange={e => handlePesertaJamaahIdChange(idx, e.target.value)}
                    >
                      <option value="">-- Pilih Data Master Jamaah --</option>
                      <option value="__new__">➕ Tambah Jamaah Baru (Belum Terdaftar)</option>
                      {jamaahList.map(j => (
                        <option key={j.id} value={j.id}>
                          {j.fullName} - {j.customerCode || 'CST'} - Paspor: {j.passportNumber || 'Belum Ada'}
                        </option>
                      ))}
                    </select>

                    {entry.jamaahId === '__new__' && (
                      <div className="space-y-2.5">
                        <input
                          type="text" required
                          placeholder="Nama Lengkap (wajib)"
                          className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                          value={entry.newJamaah.fullName}
                          onChange={e => handlePesertaNewJamaahChange(idx, 'fullName', e.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-2.5">
                          <input
                            type="text"
                            placeholder="No. HP / WhatsApp"
                            className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                            value={entry.newJamaah.phone}
                            onChange={e => handlePesertaNewJamaahChange(idx, 'phone', e.target.value)}
                          />
                          <input
                            type="text"
                            placeholder="NIK"
                            className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                            value={entry.newJamaah.nik}
                            onChange={e => handlePesertaNewJamaahChange(idx, 'nik', e.target.value)}
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="No. Paspor (opsional)"
                          className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                          value={entry.newJamaah.passportNumber}
                          onChange={e => handlePesertaNewJamaahChange(idx, 'passportNumber', e.target.value)}
                        />
                        <p className="text-[10px] opacity-70">Data lengkap lainnya (KTP, alamat, dll) bisa dilengkapi belakangan di menu Data Master Jamaah.</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tipe Kamar</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.roomType}
                    onChange={e => setFormData({ ...formData, roomType: e.target.value })}
                  >
                    <option value="Quad">Quad (4 Orang)</option>
                    <option value="Triple">Triple (3 Orang)</option>
                    <option value="Double">Double (2 Orang)</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Alokasi Bus</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.busGroup}
                    onChange={e => setFormData({ ...formData, busGroup: e.target.value })}
                  >
                    <option value="Bus 1">Bus 1</option>
                    <option value="Bus 2">Bus 2</option>
                    <option value="Bus 3">Bus 3</option>
                  </select>
                </div>
              </div>

              {!editingBookingId && formData.packageId && (() => {
                const pkgPreview = packagesList.find(p => p.id === formData.packageId);
                if (!pkgPreview) return null;
                let unitPrice = Number(pkgPreview.priceQuad || pkgPreview.priceMain || 0);
                if (formData.roomType === 'Triple') unitPrice = Number(pkgPreview.priceTriple || unitPrice);
                if (formData.roomType === 'Double') unitPrice = Number(pkgPreview.priceDouble || unitPrice);
                const packageTotalPreview = unitPrice * (formData.paxCount || 1);
                const extraNet = (formData.extraCharges || []).reduce((acc, c) => acc + (Number(c.amount) || 0), 0) - (formData.extraDiscounts || []).reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
                const grandTotalPreview = packageTotalPreview + extraNet;
                return (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl text-[11px] space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-emerald-500 font-medium">
                        Rp {unitPrice.toLocaleString('id-ID')} / pax {formData.paxCount > 1 ? `x ${formData.paxCount} pax` : ''}
                      </span>
                      <span className="font-bold text-emerald-500">Rp {packageTotalPreview.toLocaleString('id-ID')}</span>
                    </div>
                    {extraNet !== 0 && (
                      <div className="flex justify-between items-center opacity-80">
                        <span className="text-emerald-500">Biaya tambahan & diskon (flat)</span>
                        <span className="font-semibold text-emerald-500">{extraNet >= 0 ? '+ ' : '- '}Rp {Math.abs(extraNet).toLocaleString('id-ID')}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-1 border-t border-emerald-500/20">
                      <span className="font-bold text-emerald-500">Total Harga Keseluruhan Pemesanan</span>
                      <span className="font-bold text-emerald-500">Rp {grandTotalPreview.toLocaleString('id-ID')}</span>
                    </div>
                  </div>
                );
              })()}

              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" /> Biaya Tambahan
                </p>
                {formData.paxCount > 1 && (
                  <p className="text-[10px] opacity-70 -mt-2">Tiap nominal dianggap total keseluruhan pemesanan ini, otomatis dibagi rata ke {formData.paxCount} pax.</p>
                )}
                {(formData.extraCharges || []).length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="opacity-70 text-left">
                          <th className="pb-1 pr-2 w-6">No</th>
                          <th className="pb-1 pr-2">Nama Biaya</th>
                          <th className="pb-1 pr-2">Jumlah</th>
                          <th className="pb-1 pr-2">Keterangan</th>
                          <th className="pb-1 w-14">Opsi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {formData.extraCharges.map((c, idx) => (
                          <tr key={c.id} className="border-t border-white/10">
                            <td className="py-1.5 pr-2">{idx + 1}</td>
                            <td className="py-1.5 pr-2">{c.name}</td>
                            <td className="py-1.5 pr-2 whitespace-nowrap">Rp {Number(c.amount || 0).toLocaleString('id-ID')}</td>
                            <td className="py-1.5 pr-2 opacity-70">{c.notes || '-'}</td>
                            <td className="py-1.5">
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => handleEditChargeRow(c)} className="text-blue-400 hover:text-blue-300"><Edit className="w-3.5 h-3.5" /></button>
                                <button type="button" onClick={() => handleDeleteChargeRow(c.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <label className="block mb-1 font-medium">Nama Biaya</label>
                    <input
                      type="text" placeholder="Contoh: Visa, Tipping, Asuransi"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={chargeDraft.name}
                      onChange={e => setChargeDraft({ ...chargeDraft, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Jumlah (Rp)</label>
                    <input
                      type="number" placeholder="0"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={chargeDraft.amount}
                      onChange={e => setChargeDraft({ ...chargeDraft, amount: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Keterangan</label>
                    <input
                      type="text" placeholder="Opsional"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={chargeDraft.notes}
                      onChange={e => setChargeDraft({ ...chargeDraft, notes: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleSaveChargeRow} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-amber-500 text-white text-[11px] font-medium hover:bg-amber-600">
                    <Plus className="w-3.5 h-3.5" /> {editingChargeId ? 'Simpan Perubahan' : 'Tambah Biaya'}
                  </button>
                  {editingChargeId && (
                    <button type="button" onClick={handleCancelChargeEdit} className="px-3 py-2 rounded-lg text-[11px] font-medium opacity-70 hover:opacity-100">Batal</button>
                  )}
                </div>
              </div>

              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-orange-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" /> Potongan Harga
                </p>
                {formData.paxCount > 1 && (
                  <p className="text-[10px] opacity-70 -mt-2">Tiap nominal dianggap total keseluruhan pemesanan ini, otomatis dibagi rata ke {formData.paxCount} pax.</p>
                )}
                {(formData.extraDiscounts || []).length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="opacity-70 text-left">
                          <th className="pb-1 pr-2 w-6">No</th>
                          <th className="pb-1 pr-2">Nama Diskon</th>
                          <th className="pb-1 pr-2">Jumlah</th>
                          <th className="pb-1 pr-2">Keterangan</th>
                          <th className="pb-1 w-14">Opsi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {formData.extraDiscounts.map((d, idx) => (
                          <tr key={d.id} className="border-t border-white/10">
                            <td className="py-1.5 pr-2">{idx + 1}</td>
                            <td className="py-1.5 pr-2">{d.name}</td>
                            <td className="py-1.5 pr-2 whitespace-nowrap text-orange-500">- Rp {Number(d.amount || 0).toLocaleString('id-ID')}</td>
                            <td className="py-1.5 pr-2 opacity-70">{d.notes || '-'}</td>
                            <td className="py-1.5">
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => handleEditDiscountRow(d)} className="text-blue-400 hover:text-blue-300"><Edit className="w-3.5 h-3.5" /></button>
                                <button type="button" onClick={() => handleDeleteDiscountRow(d.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <label className="block mb-1 font-medium">Nama Diskon</label>
                    <input
                      type="text" placeholder="Contoh: Diskon Early Bird"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={discountDraft.name}
                      onChange={e => setDiscountDraft({ ...discountDraft, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Jumlah (Rp)</label>
                    <input
                      type="number" placeholder="0"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={discountDraft.amount}
                      onChange={e => setDiscountDraft({ ...discountDraft, amount: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Keterangan</label>
                    <input
                      type="text" placeholder="Opsional"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={discountDraft.notes}
                      onChange={e => setDiscountDraft({ ...discountDraft, notes: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleSaveDiscountRow} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-orange-500 text-white text-[11px] font-medium hover:bg-orange-600">
                    <Plus className="w-3.5 h-3.5" /> {editingDiscountId ? 'Simpan Perubahan' : 'Tambah Diskon'}
                  </button>
                  {editingDiscountId && (
                    <button type="button" onClick={handleCancelDiscountEdit} className="px-3 py-2 rounded-lg text-[11px] font-medium opacity-70 hover:opacity-100">Batal</button>
                  )}
                </div>
              </div>

              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" /> Pembayaran / Setoran {editingBookingId ? 'Tambahan' : 'Awal'}
                </p>
                {canRecordPayment ? (
                  <>
                    {formData.paxCount > 1 && (
                      <p className="text-[10px] opacity-70 -mt-2">Nominal di bawah akan dibagi rata otomatis ke {formData.paxCount} pax.</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block mb-1 font-medium">Nominal Bayar (Rp)</label>
                        <input
                          type="number" placeholder="5000000 (Kosongkan jika 0)"
                          className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                          value={formData.initialPayment}
                          onChange={e => setFormData({ ...formData, initialPayment: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block mb-1 font-medium">Metode Bayar</label>
                        <select
                          className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                          value={formData.paymentMethod}
                          onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}
                        >
                          <option value="Transfer Bank">Transfer Bank</option>
                          <option value="Cash / Tunai">Cash / Tunai</option>
                          <option value="EDC / Kartu">EDC / Kartu</option>
                          <option value="Saldo Deposit">Saldo Deposit</option>
                        </select>
                      </div>
                    </div>
                    {formData.paymentMethod !== 'Saldo Deposit' && (
                      <div>
                        <label className="block mb-1 font-medium">Masuk ke Akun Kas/Bank</label>
                        <select
                          className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                          value={formData.accountId}
                          onChange={e => setFormData({ ...formData, accountId: e.target.value })}
                        >
                          <option value="">-- Pilih Akun --</option>
                          {financialAccounts.map(a => (
                            <option key={a.id} value={a.id}>{a.name} (Saldo: Rp {Number(a.balance || 0).toLocaleString('id-ID')})</option>
                          ))}
                        </select>
                        {financialAccounts.length === 0 && (
                          <p className="text-[10px] mt-1 text-amber-500">Belum ada akun Kas/Bank. Tambahkan dulu lewat tab "Kas & Bank" di menu Keuangan.</p>
                        )}
                      </div>
                    )}
                    {formData.paymentMethod === 'Saldo Deposit' && (() => {
                      const ordererData = jamaahList.find(j => j.id === formData.ordererId);
                      const balance = Number(ordererData?.depositBalance || 0);
                      return (
                        <p className={`text-[11px] p-2 rounded-lg ${balance > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                          Saldo Deposit {ordererData ? ordererData.fullName : 'Pemesan'} saat ini: Rp {balance.toLocaleString('id-ID')}
                        </p>
                      );
                    })()}
                    <div>
                      <label className="block mb-1 font-medium">Tanggal Setoran</label>
                      <input
                        type="date"
                        min={editingBookingId ? getBookingMinDate(bookings.find(b => b.id === editingBookingId)?.createdAt) : undefined}
                        className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                        value={formData.paymentDate}
                        onChange={e => setFormData({ ...formData, paymentDate: e.target.value })}
                      />
                      <p className="text-[10px] mt-1 opacity-70">
                        {editingBookingId
                          ? `Ganti tanggalnya kalau setoran ini sebenarnya diterima di hari lain (misal telat diinput ke sistem). Nggak bisa sebelum tanggal pemesanan dibuat.`
                          : `Ganti tanggalnya kalau setoran ini sebenarnya diterima di hari lain (misal telat diinput ke sistem).`}
                      </p>
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Catatan Pembayaran</label>
                      <input
                        type="text" placeholder="Catatan setoran..."
                        className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                        value={formData.paymentNotes}
                        onChange={e => setFormData({ ...formData, paymentNotes: e.target.value })}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] italic opacity-70">
                    Role kamu nggak bisa mencatat setoran pembayaran di sini. Booking akan diproses tanpa setoran awal — nanti Sales/Finance yang catat pembayarannya.
                  </p>
                )}
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  {editingBookingId ? 'Simpan Perubahan' : 'Proses Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL RIWAYAT PEMBAYARAN */}
      {showHistoryModal && selectedBookingForHistory && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-2xl p-6 relative`}>
            <button onClick={() => setShowHistoryModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <History className="w-5 h-5 text-emerald-500" /> Riwayat Pembayaran Jamaah
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Jamaah: <strong className={styles.textTitle}>{selectedBookingForHistory.jamaahName}</strong> • Kode: <span className="font-mono text-emerald-500">{selectedBookingForHistory.bookingCode}</span>
            </p>

            <div className={`overflow-x-auto max-h-60 overflow-y-auto mb-4 border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg`}>
              <table className="w-full text-left text-xs">
                <thead className={`${styles.tableHeaderBg} uppercase`}>
                  <tr>
                    <th className="p-3">Tanggal</th>
                    <th className="p-3">Metode & Catatan</th>
                    <th className="p-3">Nominal</th>
                    <th className="p-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${styles.tableRowBorder}`}>
                  {paymentHistory.length === 0 ? (
                    <tr><td colSpan="4" className={`p-6 text-center ${styles.textSub}`}>Belum ada riwayat setoran pembayaran.</td></tr>
                  ) : (
                    paymentHistory.map(pay => (
                      <tr key={pay.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                        {editingPaymentId === pay.id && canManagePayments ? (
                          <>
                            <td className="p-2" colSpan="3">
                              {/* Susunan 3 kolom ini sengaja disamain sama urutan header tabel
                                  (Tanggal | Metode & Catatan | Nominal) — Metode & Catatan digabung
                                  jadi 1 sel biar nggak geser posisi kolom Nominal di sebelahnya. */}
                              <div className="grid grid-cols-3 gap-2">
                                <input
                                  type="date"
                                  min={getBookingMinDate(selectedBookingForHistory?.createdAt)}
                                  className={`${styles.inputBg} p-1.5 rounded`}
                                  value={paymentEditForm.date}
                                  onChange={e => setPaymentEditForm({ ...paymentEditForm, date: e.target.value })}
                                />
                                <div className="flex gap-1">
                                  <select
                                    className={`${styles.inputBg} p-1.5 rounded w-1/2`}
                                    value={paymentEditForm.paymentMethod}
                                    onChange={e => setPaymentEditForm({ ...paymentEditForm, paymentMethod: e.target.value })}
                                  >
                                    <option value="Transfer Bank">Transfer Bank</option>
                                    <option value="Cash / Tunai">Cash / Tunai</option>
                                    <option value="EDC / Kartu">EDC / Kartu</option>
                                  </select>
                                  <input
                                    type="text"
                                    placeholder="Catatan"
                                    className={`${styles.inputBg} p-1.5 rounded w-1/2`}
                                    value={paymentEditForm.notes}
                                    onChange={e => setPaymentEditForm({ ...paymentEditForm, notes: e.target.value })}
                                  />
                                </div>
                                <input
                                  type="number"
                                  placeholder="Nominal"
                                  className={`${styles.inputBg} p-1.5 rounded`}
                                  value={paymentEditForm.amount}
                                  onChange={e => setPaymentEditForm({ ...paymentEditForm, amount: e.target.value })}
                                />
                              </div>
                              {paymentEditForm.paymentMethod !== 'Saldo Deposit' && (
                                <select
                                  className={`${styles.inputBg} p-1.5 rounded w-full mt-2`}
                                  value={paymentEditForm.accountId}
                                  onChange={e => setPaymentEditForm({ ...paymentEditForm, accountId: e.target.value })}
                                >
                                  <option value="">-- Akun Kas/Bank --</option>
                                  {financialAccounts.map(a => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="p-2 text-center">
                              <button onClick={() => handleSavePaymentEdit(pay.id)} className="px-2 py-1 bg-emerald-600 text-white text-[10px] rounded mr-1">
                                Simpan
                              </button>
                              <button onClick={() => setEditingPaymentId(null)} className={`px-2 py-1 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'} text-[10px] rounded`}>
                                Batal
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className={`p-3 ${styles.textSub}`}>
                              {formatDateDDMMYYYY(pay.createdAt)}
                            </td>
                            <td className="p-3">
                              <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-1.5 py-0.5 rounded text-[10px] mr-1`}>{pay.paymentMethod}{pay.accountName ? ` - ${pay.accountName}` : ''}</span>
                              <span className={styles.textSub}>{pay.notes}</span>
                            </td>
                            <td className="p-3 font-bold text-emerald-500">
                              Rp {Number(pay.amount).toLocaleString('id-ID')}
                            </td>
                            <td className="p-3 text-center">
                              {canManagePayments ? (
                                <>
                                  <button
                                    onClick={() => {
                                      setEditingPaymentId(pay.id);
                                      setPaymentEditForm({ amount: pay.amount, paymentMethod: pay.paymentMethod, accountId: pay.accountId || '', notes: pay.notes, date: (pay.createdAt || '').slice(0, 10) });
                                    }}
                                    className="text-emerald-500 hover:underline mr-2"
                                  >
                                    Edit
                                  </button>
                                  <button onClick={() => handleDeletePayment(pay.id)} className="text-rose-500 hover:underline">
                                    Hapus
                                  </button>
                                </>
                              ) : (
                                <span className={styles.textSub}>—</span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className={`flex justify-between items-center pt-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'} text-xs`}>
              <span className={styles.textSub}>Total Tagihan: <strong className={styles.textTitle}>Rp {Number(selectedBookingForHistory.totalAmount).toLocaleString('id-ID')}</strong></span>
              <button onClick={() => setShowHistoryModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL BATALKAN / RESCHEDULE BOOKING */}
      {showActionModal && selectedBookingForAction && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowActionModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              {actionMode === 'cancel' ? (
                <><Ban className="w-5 h-5 text-rose-500" /> Batalkan Booking & Refund</>
              ) : (
                <><RotateCcw className="w-5 h-5 text-blue-500" /> Reschedule ke Paket Lain</>
              )}
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Jamaah: <strong className={styles.textTitle}>{selectedBookingForAction.jamaahName}</strong> • Kode: <span className="font-mono text-emerald-500">{selectedBookingForAction.bookingCode}</span>
            </p>

            {/* Tab switch cancel / reschedule */}
            <div className={`flex gap-1.5 p-1 mb-4 rounded-lg ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
              <button
                onClick={() => setActionMode('cancel')}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${actionMode === 'cancel' ? 'bg-rose-600 text-white' : styles.textSub}`}
              >
                Batalkan / Refund
              </button>
              <button
                onClick={() => setActionMode('reschedule')}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${actionMode === 'reschedule' ? 'bg-blue-600 text-white' : styles.textSub}`}
              >
                Reschedule
              </button>
            </div>

            {actionMode === 'cancel' ? (
              <form onSubmit={handleCancelSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
                <div className={`${styles.innerBg} p-3 rounded-lg border text-[11px]`}>
                  Total sudah disetor: <strong className={styles.textTitle}>Rp {Number(selectedBookingForAction.totalPaid || 0).toLocaleString('id-ID')}</strong>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Nominal Refund (Rp)</label>
                  <input
                    type="number" required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={cancelForm.refundAmount}
                    onChange={e => setCancelForm({ ...cancelForm, refundAmount: e.target.value })}
                  />
                  <p className="text-[10px] mt-1 opacity-70">Boleh kurang dari total setoran kalau ada potongan/biaya pembatalan.</p>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Metode Refund</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={cancelForm.refundMethod}
                    onChange={e => setCancelForm({ ...cancelForm, refundMethod: e.target.value })}
                  >
                    <option value="Transfer Bank">Transfer Bank</option>
                    <option value="Cash / Tunai">Cash / Tunai</option>
                    <option value="Deposit / Saldo Akun">Deposit / Saldo Akun</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Alasan Pembatalan</label>
                  <textarea
                    required rows={3}
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    placeholder="Contoh: Sakit, kendala visa, ganti jadwal keluarga, dll."
                    value={cancelForm.reason}
                    onChange={e => setCancelForm({ ...cancelForm, reason: e.target.value })}
                  />
                </div>
                <div className={`pt-3 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <button type="button" onClick={() => setShowActionModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                    Batal
                  </button>
                  <button type="submit" className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-medium">
                    Proses Pembatalan & Refund
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRescheduleSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
                <div className={`${styles.innerBg} p-3 rounded-lg border text-[11px]`}>
                  Setoran sebesar <strong className={styles.textTitle}>Rp {Number(selectedBookingForAction.totalPaid || 0).toLocaleString('id-ID')}</strong> akan otomatis dipindah (carry-over) ke booking baru.
                </div>
                <div>
                  <label className="block mb-1 font-medium">Paket / Keberangkatan Tujuan</label>
                  <select
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={rescheduleForm.newPackageId}
                    onChange={e => setRescheduleForm({ ...rescheduleForm, newPackageId: e.target.value })}
                  >
                    <option value="">-- Pilih Program Keberangkatan Baru --</option>
                    {packagesList.filter(p => p.id !== selectedBookingForAction.packageId).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code}) - Sisa Seat: {p.quotaRemaining ?? p.quotaTotal}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1 font-medium">Tipe Kamar</label>
                    <select
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={rescheduleForm.roomType}
                      onChange={e => setRescheduleForm({ ...rescheduleForm, roomType: e.target.value })}
                    >
                      <option value="Quad">Quad (4 Orang)</option>
                      <option value="Triple">Triple (3 Orang)</option>
                      <option value="Double">Double (2 Orang)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Alokasi Bus</label>
                    <select
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={rescheduleForm.busGroup}
                      onChange={e => setRescheduleForm({ ...rescheduleForm, busGroup: e.target.value })}
                    >
                      <option value="Bus 1">Bus 1</option>
                      <option value="Bus 2">Bus 2</option>
                      <option value="Bus 3">Bus 3</option>
                    </select>
                  </div>
                </div>
                <div className={`pt-3 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <button type="button" onClick={() => setShowActionModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                    Batal
                  </button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium">
                    Proses Reschedule
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL SETORAN GRUP — catat 1 setoran buat 1 grup booking sekaligus,
          nominalnya dibagi rata otomatis ke semua pax di grup itu. */}
      {showGroupPaymentModal && groupPaymentTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
            <button onClick={() => setShowGroupPaymentModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Wallet className="w-5 h-5 text-emerald-500" /> Catat Setoran Grup
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Kode: <span className="font-mono text-emerald-500">{groupPaymentTarget.code}</span> • Paket: <strong className={styles.textTitle}>{groupPaymentTarget.primary?.packageName || '-'}</strong>
            </p>

            <div className={`${styles.innerBg} p-3 rounded-lg border text-[11px] mb-4 space-y-1`}>
              <div>Pemesan: <strong className={styles.textTitle}>{groupPaymentTarget.primary?.ordererName || '-'}</strong></div>
              <div>Jumlah Pax: <strong className={styles.textTitle}>{groupPaymentTarget.paxCount} Pax</strong></div>
              <div className="opacity-70 mt-1">Nominal setoran di bawah akan dibagi rata otomatis ke {groupPaymentTarget.paxCount} pax dalam grup ini.</div>
            </div>

            <form onSubmit={handleGroupPaymentSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-medium">Nominal Setoran (Rp)</label>
                  <input
                    type="number" required min="1"
                    placeholder="5000000"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupPaymentForm.amount}
                    onChange={e => setGroupPaymentForm({ ...groupPaymentForm, amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Metode Bayar</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupPaymentForm.paymentMethod}
                    onChange={e => setGroupPaymentForm({ ...groupPaymentForm, paymentMethod: e.target.value })}
                  >
                    <option value="Transfer Bank">Transfer Bank</option>
                    <option value="Cash / Tunai">Cash / Tunai</option>
                    <option value="EDC / Kartu">EDC / Kartu</option>
                    <option value="Saldo Deposit">Saldo Deposit</option>
                  </select>
                </div>
              </div>
              {groupPaymentForm.paymentMethod !== 'Saldo Deposit' && (
                <div>
                  <label className="block mb-1 font-medium">Masuk ke Akun Kas/Bank</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupPaymentForm.accountId}
                    onChange={e => setGroupPaymentForm({ ...groupPaymentForm, accountId: e.target.value })}
                  >
                    <option value="">-- Pilih Akun --</option>
                    {financialAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} (Saldo: Rp {Number(a.balance || 0).toLocaleString('id-ID')})</option>
                    ))}
                  </select>
                </div>
              )}
              {groupPaymentForm.paymentMethod === 'Saldo Deposit' && (() => {
                const ordererData = jamaahList.find(j => j.id === groupPaymentTarget.primary?.ordererId);
                const balance = Number(ordererData?.depositBalance || 0);
                return (
                  <p className={`text-[11px] p-2 rounded-lg ${balance > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                    Saldo Deposit {groupPaymentTarget.primary?.ordererName || 'Pemesan'} saat ini: Rp {balance.toLocaleString('id-ID')}
                  </p>
                );
              })()}
              <div>
                <label className="block mb-1 font-medium">Tanggal Setoran</label>
                <input
                  type="date"
                  min={getBookingMinDate(groupPaymentTarget.primary?.createdAt)}
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={groupPaymentForm.date}
                  onChange={e => setGroupPaymentForm({ ...groupPaymentForm, date: e.target.value })}
                />
                <p className="text-[10px] mt-1 opacity-70">
                  Nggak bisa sebelum tanggal pemesanan dibuat ({getBookingMinDate(groupPaymentTarget.primary?.createdAt).split('-').reverse().join('/')}).
                </p>
              </div>
              <div>
                <label className="block mb-1 font-medium">Catatan Pembayaran</label>
                <input
                  type="text" placeholder="Catatan setoran..."
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={groupPaymentForm.notes}
                  onChange={e => setGroupPaymentForm({ ...groupPaymentForm, notes: e.target.value })}
                />
              </div>
              <div className={`pt-3 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowGroupPaymentModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium">
                  Simpan Setoran
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL RIWAYAT PEMBAYARAN — nampilin TRANSAKSI setoran seperti yang
          aslinya dialami staff yang nyetor (mis. sekali setor 9 juta buat 3
          pax = 1 baris "Rp 9.000.000"), bukan pecahan per-pax hasil split yang
          kesimpen di payments_income. Baris yang beneran gabungan dari
          beberapa dokumen ditandai "(Dibagi ke N peserta)" di catatannya. */}
      {showGroupHistoryModal && (() => {
        const paymentsFlat = Object.values(groupHistoryPayments).flat();
        const transactions = buildMergedGroupTransactions(paymentsFlat);
        return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => { setShowGroupHistoryModal(false); setEditingGroupPaymentId(null); }} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <History className="w-5 h-5 text-emerald-500" /> Riwayat Pembayaran
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Riwayat transaksi setoran masuk untuk pemesanan ini.
            </p>

            <div className={`overflow-x-auto max-h-[60vh] overflow-y-auto mb-4 border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg`}>
              <table className="w-full text-left text-xs">
                <thead className={`${styles.tableHeaderBg} uppercase`}>
                  <tr>
                    <th className="p-3">Tanggal</th>
                    <th className="p-3">Metode & Catatan</th>
                    <th className="p-3">Nominal</th>
                    <th className="p-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${styles.tableRowBorder}`}>
                  {transactions.length === 0 ? (
                    <tr><td colSpan="4" className={`p-6 text-center ${styles.textSub}`}>Belum ada riwayat setoran pembayaran.</td></tr>
                  ) : (
                    transactions.map(tx => {
                      const singlePay = !tx.isMerged ? tx.docs[0] : null;
                      const isEditingThis = singlePay && editingGroupPaymentId === singlePay.id;
                      return (
                        <tr key={tx.key} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                          {isEditingThis && canManagePayments ? (
                            <>
                              <td className="p-2" colSpan="3">
                                <div className="grid grid-cols-3 gap-2">
                                  <input
                                    type="date"
                                    min={getBookingMinDate(groupHistoryItems.find(b => b.id === singlePay.bookingId)?.createdAt)}
                                    className={`${styles.inputBg} p-1.5 rounded`}
                                    value={paymentEditForm.date}
                                    onChange={e => setPaymentEditForm({ ...paymentEditForm, date: e.target.value })}
                                  />
                                  <div className="flex gap-1">
                                    <select
                                      className={`${styles.inputBg} p-1.5 rounded w-1/2`}
                                      value={paymentEditForm.paymentMethod}
                                      onChange={e => setPaymentEditForm({ ...paymentEditForm, paymentMethod: e.target.value })}
                                    >
                                      <option value="Transfer Bank">Transfer Bank</option>
                                      <option value="Cash / Tunai">Cash / Tunai</option>
                                      <option value="EDC / Kartu">EDC / Kartu</option>
                                    </select>
                                    <input
                                      type="text"
                                      placeholder="Catatan"
                                      className={`${styles.inputBg} p-1.5 rounded w-1/2`}
                                      value={paymentEditForm.notes}
                                      onChange={e => setPaymentEditForm({ ...paymentEditForm, notes: e.target.value })}
                                    />
                                  </div>
                                  <input
                                    type="number"
                                    placeholder="Nominal"
                                    className={`${styles.inputBg} p-1.5 rounded`}
                                    value={paymentEditForm.amount}
                                    onChange={e => setPaymentEditForm({ ...paymentEditForm, amount: e.target.value })}
                                  />
                                </div>
                                {paymentEditForm.paymentMethod !== 'Saldo Deposit' && (
                                  <select
                                    className={`${styles.inputBg} p-1.5 rounded w-full mt-2`}
                                    value={paymentEditForm.accountId}
                                    onChange={e => setPaymentEditForm({ ...paymentEditForm, accountId: e.target.value })}
                                  >
                                    <option value="">-- Akun Kas/Bank --</option>
                                    {financialAccounts.map(a => (
                                      <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td className="p-2 text-center">
                                <button onClick={() => handleSaveGroupPaymentEdit(singlePay)} className="px-2 py-1 bg-emerald-600 text-white text-[10px] rounded mr-1">
                                  Simpan
                                </button>
                                <button onClick={() => setEditingGroupPaymentId(null)} className={`px-2 py-1 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'} text-[10px] rounded`}>
                                  Batal
                                </button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className={`p-3 ${styles.textSub}`}>
                                {formatDateDDMMYYYY(tx.createdAt)}
                              </td>
                              <td className="p-3">
                                <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-1.5 py-0.5 rounded text-[10px] mr-1`}>{tx.paymentMethod}{tx.accountName ? ` - ${tx.accountName}` : ''}</span>
                                <span className={styles.textSub}>{tx.notes}</span>
                              </td>
                              <td className="p-3 font-bold text-emerald-500">
                                Rp {Number(tx.amount).toLocaleString('id-ID')}
                              </td>
                              <td className="p-3 text-center">
                                {canManagePayments ? (
                                  tx.isMerged ? (
                                    // Transaksi gabungan cuma bisa dihapus (bukan diedit) — redistribusi
                                    // ulang totalnya ke N porsi peserta berisiko salah hitung.
                                    <button onClick={() => handleDeleteMergedGroupPayment(tx.docs)} className="text-rose-500 hover:underline">
                                      Hapus
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => {
                                          setEditingGroupPaymentId(singlePay.id);
                                          setPaymentEditForm({ amount: singlePay.amount, paymentMethod: singlePay.paymentMethod, accountId: singlePay.accountId || '', notes: singlePay.notes, date: (singlePay.createdAt || '').slice(0, 10) });
                                        }}
                                        className="text-emerald-500 hover:underline mr-2"
                                      >
                                        Edit
                                      </button>
                                      <button onClick={() => handleDeleteGroupPayment(singlePay)} className="text-rose-500 hover:underline">
                                        Hapus
                                      </button>
                                    </>
                                  )
                                ) : (
                                  <span className={styles.textSub}>—</span>
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className={`flex justify-end pt-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'} text-xs`}>
              <button onClick={() => { setShowGroupHistoryModal(false); setEditingGroupPaymentId(null); }} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                Tutup
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* MODAL EDIT BOOKING GRUP — cuma field yang emang shared se-grup (Paket,
          Pemesan, Tipe Kamar, Alokasi Bus) + opsional Tambah Setoran. Identitas
          peserta TETAP di Edit Booking per-peserta ("Aksi Lainnya"). */}
      {showGroupEditModal && groupEditTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowGroupEditModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Edit className="w-5 h-5 text-emerald-500" /> Edit Booking Grup
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Kode: <span className="font-mono text-emerald-500">{groupEditTarget.code}</span> • {groupEditTarget.paxCount} Pax
            </p>
            <div className={`${styles.innerBg} p-3 rounded-lg border text-[11px] mb-4`}>
              Perubahan di sini berlaku ke SEMUA peserta yang statusnya masih aktif di grup ini. Identitas peserta (nama/jamaah) nggak diubah dari sini — pakai Edit Booking per-peserta kalau cuma 1 orang yang perlu diganti datanya.
            </div>

            {/* TAMBAH PESERTA BARU — buat peserta yang nyusul belakangan, biar
                nggak perlu bikin kode booking baru terpisah. Tetap bisa dipakai
                meski grup ini udah ada riwayat setoran, karena ini aksi
                independen (nambah 1 pax baru), bukan bagian dari form edit di
                bawah yang cuma ngubah data shared pax yang sudah ada. */}
            <div className={`${styles.innerBg} p-3 rounded-xl border space-y-2.5 mb-4`}>
              <p className={`text-[11px] font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5`}>
                <UserPlus className="w-3.5 h-3.5" /> Tambah Peserta Baru (Nyusul)
              </p>
              <select
                className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                value={addPaxForm.jamaahId}
                onChange={e => setAddPaxForm({ ...addPaxForm, jamaahId: e.target.value })}
              >
                <option value="">-- Pilih Data Master Jamaah --</option>
                <option value="__new__">➕ Tambah Jamaah Baru (Belum Terdaftar)</option>
                {jamaahList.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.fullName} - {j.customerCode || 'CST'} - Paspor: {j.passportNumber || 'Belum Ada'}
                  </option>
                ))}
              </select>

              {addPaxForm.jamaahId === '__new__' && (
                <div className="space-y-2.5">
                  <input
                    type="text"
                    placeholder="Nama Lengkap (wajib)"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={addPaxForm.newJamaah.fullName}
                    onChange={e => setAddPaxForm({ ...addPaxForm, newJamaah: { ...addPaxForm.newJamaah, fullName: e.target.value } })}
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      placeholder="No. HP / WhatsApp"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={addPaxForm.newJamaah.phone}
                      onChange={e => setAddPaxForm({ ...addPaxForm, newJamaah: { ...addPaxForm.newJamaah, phone: e.target.value } })}
                    />
                    <input
                      type="text"
                      placeholder="NIK"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={addPaxForm.newJamaah.nik}
                      onChange={e => setAddPaxForm({ ...addPaxForm, newJamaah: { ...addPaxForm.newJamaah, nik: e.target.value } })}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="No. Paspor (opsional)"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={addPaxForm.newJamaah.passportNumber}
                    onChange={e => setAddPaxForm({ ...addPaxForm, newJamaah: { ...addPaxForm.newJamaah, passportNumber: e.target.value } })}
                  />
                </div>
              )}

              <div>
                <label className="block mb-1 font-medium">Tipe Kamar Peserta Ini</label>
                <select
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={addPaxForm.roomType}
                  onChange={e => setAddPaxForm({ ...addPaxForm, roomType: e.target.value })}
                >
                  <option value="Quad">Quad (4 Orang)</option>
                  <option value="Triple">Triple (3 Orang)</option>
                  <option value="Double">Double (2 Orang)</option>
                </select>
              </div>

              <p className="text-[10px] opacity-70">
                Paket, tanggal keberangkatan & Pemesan otomatis ikut grup ini. Setelah ditambahkan, setoran peserta ini bisa dicatat lewat "Catat Setoran Grup" atau riwayat pembayaran per-peserta.
              </p>

              <button
                type="button"
                onClick={handleAddPaxToGroup}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-medium transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" /> Tambah Peserta Ini ke Grup
              </button>
            </div>

            <form onSubmit={handleGroupEditSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Pilih Paket Travel</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={groupEditForm.packageId}
                  onChange={e => setGroupEditForm({ ...groupEditForm, packageId: e.target.value })}
                >
                  <option value="">-- Pilih Program Keberangkatan --</option>
                  {packagesList.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code}) - Sisa Seat: {p.quotaRemaining ?? p.quotaTotal}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1 font-medium">Pemesan (Yang Melakukan Pemesanan)</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={groupEditForm.ordererId}
                  onChange={e => setGroupEditForm({ ...groupEditForm, ordererId: e.target.value })}
                >
                  <option value="">-- Pilih Data Master Jamaah --</option>
                  <option value="__new__">➕ Tambah Pemesan Baru (Belum Terdaftar)</option>
                  {jamaahList.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.fullName} - {j.customerCode || 'CST'} - Paspor: {j.passportNumber || 'Belum Ada'}
                    </option>
                  ))}
                </select>
              </div>

              {groupEditForm.ordererId === '__new__' && (
                <div className={`${styles.innerBg} p-3 rounded-xl border space-y-2.5`}>
                  <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">Data Pemesan Baru</p>
                  <input
                    type="text" required
                    placeholder="Nama Lengkap (wajib)"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupEditNewOrdererForm.fullName}
                    onChange={e => setGroupEditNewOrdererForm({ ...groupEditNewOrdererForm, fullName: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      placeholder="No. HP / WhatsApp"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupEditNewOrdererForm.phone}
                      onChange={e => setGroupEditNewOrdererForm({ ...groupEditNewOrdererForm, phone: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="NIK"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupEditNewOrdererForm.nik}
                      onChange={e => setGroupEditNewOrdererForm({ ...groupEditNewOrdererForm, nik: e.target.value })}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="No. Paspor (opsional)"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupEditNewOrdererForm.passportNumber}
                    onChange={e => setGroupEditNewOrdererForm({ ...groupEditNewOrdererForm, passportNumber: e.target.value })}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tipe Kamar</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupEditForm.roomType}
                    onChange={e => setGroupEditForm({ ...groupEditForm, roomType: e.target.value })}
                  >
                    <option value="Quad">Quad (4 Orang)</option>
                    <option value="Triple">Triple (3 Orang)</option>
                    <option value="Double">Double (2 Orang)</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Alokasi Bus</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupEditForm.busGroup}
                    onChange={e => setGroupEditForm({ ...groupEditForm, busGroup: e.target.value })}
                  >
                    <option value="Bus 1">Bus 1</option>
                    <option value="Bus 2">Bus 2</option>
                    <option value="Bus 3">Bus 3</option>
                  </select>
                </div>
              </div>

              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" /> Biaya Tambahan
                </p>
                <p className="text-[10px] opacity-70 -mt-2">Tiap nominal dianggap total keseluruhan grup ini, otomatis dibagi rata ke seluruh peserta aktif.</p>
                {(groupEditForm.extraCharges || []).length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="opacity-70 text-left">
                          <th className="pb-1 pr-2 w-6">No</th>
                          <th className="pb-1 pr-2">Nama Biaya</th>
                          <th className="pb-1 pr-2">Jumlah</th>
                          <th className="pb-1 pr-2">Keterangan</th>
                          <th className="pb-1 w-14">Opsi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupEditForm.extraCharges.map((c, idx) => (
                          <tr key={c.id} className="border-t border-white/10">
                            <td className="py-1.5 pr-2">{idx + 1}</td>
                            <td className="py-1.5 pr-2">{c.name}</td>
                            <td className="py-1.5 pr-2 whitespace-nowrap">Rp {Number(c.amount || 0).toLocaleString('id-ID')}</td>
                            <td className="py-1.5 pr-2 opacity-70">{c.notes || '-'}</td>
                            <td className="py-1.5">
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => handleEditGroupChargeRow(c)} className="text-blue-400 hover:text-blue-300"><Edit className="w-3.5 h-3.5" /></button>
                                <button type="button" onClick={() => handleDeleteGroupChargeRow(c.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <label className="block mb-1 font-medium">Nama Biaya</label>
                    <input
                      type="text" placeholder="Contoh: Visa, Tipping, Asuransi"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupChargeDraft.name}
                      onChange={e => setGroupChargeDraft({ ...groupChargeDraft, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Jumlah (Rp)</label>
                    <input
                      type="number" placeholder="0"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupChargeDraft.amount}
                      onChange={e => setGroupChargeDraft({ ...groupChargeDraft, amount: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Keterangan</label>
                    <input
                      type="text" placeholder="Opsional"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupChargeDraft.notes}
                      onChange={e => setGroupChargeDraft({ ...groupChargeDraft, notes: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleSaveGroupChargeRow} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-amber-500 text-white text-[11px] font-medium hover:bg-amber-600">
                    <Plus className="w-3.5 h-3.5" /> {editingGroupChargeId ? 'Simpan Perubahan' : 'Tambah Biaya'}
                  </button>
                  {editingGroupChargeId && (
                    <button type="button" onClick={handleCancelGroupChargeEdit} className="px-3 py-2 rounded-lg text-[11px] font-medium opacity-70 hover:opacity-100">Batal</button>
                  )}
                </div>
              </div>

              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-orange-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" /> Potongan Harga
                </p>
                <p className="text-[10px] opacity-70 -mt-2">Tiap nominal dianggap total keseluruhan grup ini, otomatis dibagi rata ke seluruh peserta aktif.</p>
                {(groupEditForm.extraDiscounts || []).length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="opacity-70 text-left">
                          <th className="pb-1 pr-2 w-6">No</th>
                          <th className="pb-1 pr-2">Nama Diskon</th>
                          <th className="pb-1 pr-2">Jumlah</th>
                          <th className="pb-1 pr-2">Keterangan</th>
                          <th className="pb-1 w-14">Opsi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupEditForm.extraDiscounts.map((d, idx) => (
                          <tr key={d.id} className="border-t border-white/10">
                            <td className="py-1.5 pr-2">{idx + 1}</td>
                            <td className="py-1.5 pr-2">{d.name}</td>
                            <td className="py-1.5 pr-2 whitespace-nowrap text-orange-500">- Rp {Number(d.amount || 0).toLocaleString('id-ID')}</td>
                            <td className="py-1.5 pr-2 opacity-70">{d.notes || '-'}</td>
                            <td className="py-1.5">
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => handleEditGroupDiscountRow(d)} className="text-blue-400 hover:text-blue-300"><Edit className="w-3.5 h-3.5" /></button>
                                <button type="button" onClick={() => handleDeleteGroupDiscountRow(d.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <label className="block mb-1 font-medium">Nama Diskon</label>
                    <input
                      type="text" placeholder="Contoh: Diskon Early Bird"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupDiscountDraft.name}
                      onChange={e => setGroupDiscountDraft({ ...groupDiscountDraft, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Jumlah (Rp)</label>
                    <input
                      type="number" placeholder="0"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupDiscountDraft.amount}
                      onChange={e => setGroupDiscountDraft({ ...groupDiscountDraft, amount: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Keterangan</label>
                    <input
                      type="text" placeholder="Opsional"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupDiscountDraft.notes}
                      onChange={e => setGroupDiscountDraft({ ...groupDiscountDraft, notes: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleSaveGroupDiscountRow} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-orange-500 text-white text-[11px] font-medium hover:bg-orange-600">
                    <Plus className="w-3.5 h-3.5" /> {editingGroupDiscountId ? 'Simpan Perubahan' : 'Tambah Diskon'}
                  </button>
                  {editingGroupDiscountId && (
                    <button type="button" onClick={handleCancelGroupDiscountEdit} className="px-3 py-2 rounded-lg text-[11px] font-medium opacity-70 hover:opacity-100">Batal</button>
                  )}
                </div>
              </div>

              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" /> Tambah Setoran (Opsional)
                </p>
                <p className="text-[10px] opacity-70 -mt-2">Kalau diisi, nominal di bawah dibagi rata otomatis ke seluruh peserta aktif di grup ini.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 font-medium">Nominal Setoran (Rp)</label>
                    <input
                      type="number" placeholder="5000000 (Kosongkan jika 0)"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupEditForm.addPaymentAmount}
                      onChange={e => setGroupEditForm({ ...groupEditForm, addPaymentAmount: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Metode Bayar</label>
                    <select
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupEditForm.addPaymentMethod}
                      onChange={e => setGroupEditForm({ ...groupEditForm, addPaymentMethod: e.target.value })}
                    >
                      <option value="Transfer Bank">Transfer Bank</option>
                      <option value="Cash / Tunai">Cash / Tunai</option>
                      <option value="EDC / Kartu">EDC / Kartu</option>
                      <option value="Saldo Deposit">Saldo Deposit</option>
                    </select>
                  </div>
                </div>
                {groupEditForm.addPaymentMethod !== 'Saldo Deposit' && (
                  <div>
                    <label className="block mb-1 font-medium">Masuk ke Akun Kas/Bank</label>
                    <select
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={groupEditForm.addAccountId}
                      onChange={e => setGroupEditForm({ ...groupEditForm, addAccountId: e.target.value })}
                    >
                      <option value="">-- Pilih Akun --</option>
                      {financialAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name} (Saldo: Rp {Number(a.balance || 0).toLocaleString('id-ID')})</option>
                      ))}
                    </select>
                  </div>
                )}
                {groupEditForm.addPaymentMethod === 'Saldo Deposit' && (() => {
                  const ordererData = jamaahList.find(j => j.id === groupEditForm.ordererId);
                  const balance = Number(ordererData?.depositBalance || 0);
                  return (
                    <p className={`text-[11px] p-2 rounded-lg ${balance > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                      Saldo Deposit {ordererData ? ordererData.fullName : 'Pemesan'} saat ini: Rp {balance.toLocaleString('id-ID')}
                    </p>
                  );
                })()}
                <div>
                  <label className="block mb-1 font-medium">Tanggal Setoran</label>
                  <input
                    type="date"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupEditForm.addPaymentDate}
                    onChange={e => setGroupEditForm({ ...groupEditForm, addPaymentDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Catatan Pembayaran</label>
                  <input
                    type="text" placeholder="Catatan setoran..."
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupEditForm.addPaymentNotes}
                    onChange={e => setGroupEditForm({ ...groupEditForm, addPaymentNotes: e.target.value })}
                  />
                </div>
              </div>

              <div className={`pt-3 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowGroupEditModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium">
                  Simpan Perubahan Grup
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL RESCHEDULE GRUP */}
      {showGroupRescheduleModal && groupRescheduleTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowGroupRescheduleModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <RotateCcw className="w-5 h-5 text-blue-500" /> Reschedule Grup ke Paket Lain
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Kode: <span className="font-mono text-emerald-500">{groupRescheduleTarget.code}</span>
            </p>

            <form onSubmit={handleGroupRescheduleSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-[11px]`}>
                Setoran yang udah dibayar masing-masing peserta akan otomatis dipindah (carry-over) apa adanya ke booking barunya masing-masing — nggak dibagi rata ulang.
              </div>
              <div>
                <label className="block mb-1 font-medium">Paket / Keberangkatan Tujuan</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={groupRescheduleForm.newPackageId}
                  onChange={e => setGroupRescheduleForm({ ...groupRescheduleForm, newPackageId: e.target.value })}
                >
                  <option value="">-- Pilih Program Keberangkatan Baru --</option>
                  {packagesList.filter(p => p.id !== groupRescheduleTarget.primary?.packageId).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code}) - Sisa Seat: {p.quotaRemaining ?? p.quotaTotal}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tipe Kamar</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupRescheduleForm.roomType}
                    onChange={e => setGroupRescheduleForm({ ...groupRescheduleForm, roomType: e.target.value })}
                  >
                    <option value="Quad">Quad (4 Orang)</option>
                    <option value="Triple">Triple (3 Orang)</option>
                    <option value="Double">Double (2 Orang)</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Alokasi Bus</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={groupRescheduleForm.busGroup}
                    onChange={e => setGroupRescheduleForm({ ...groupRescheduleForm, busGroup: e.target.value })}
                  >
                    <option value="Bus 1">Bus 1</option>
                    <option value="Bus 2">Bus 2</option>
                    <option value="Bus 3">Bus 3</option>
                  </select>
                </div>
              </div>
              <div className={`pt-3 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowGroupRescheduleModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium">
                  Proses Reschedule Grup
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL BATALKAN / REFUND GRUP */}
      {showGroupCancelModal && groupCancelTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowGroupCancelModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Ban className="w-5 h-5 text-rose-500" /> Batalkan Grup & Refund
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Kode: <span className="font-mono text-emerald-500">{groupCancelTarget.code}</span>
            </p>

            <form onSubmit={handleGroupCancelSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-[11px]`}>
                Total sudah disetor (seluruh peserta aktif): <strong className={styles.textTitle}>Rp {groupCancelTarget.items.filter(b => (b.status || 'active') === 'active').reduce((acc, b) => acc + Number(b.totalPaid || 0), 0).toLocaleString('id-ID')}</strong>
              </div>
              <div>
                <label className="block mb-1 font-medium">Nominal Refund Total (Rp)</label>
                <input
                  type="number" required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={groupCancelForm.refundAmount}
                  onChange={e => setGroupCancelForm({ ...groupCancelForm, refundAmount: e.target.value })}
                />
                <p className="text-[10px] mt-1 opacity-70">Nominal total ini akan dibagi rata otomatis ke seluruh peserta aktif di grup ini. Boleh kurang dari total setoran kalau ada potongan/biaya pembatalan.</p>
              </div>
              <div>
                <label className="block mb-1 font-medium">Metode Refund</label>
                <select
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={groupCancelForm.refundMethod}
                  onChange={e => setGroupCancelForm({ ...groupCancelForm, refundMethod: e.target.value })}
                >
                  <option value="Transfer Bank">Transfer Bank</option>
                  <option value="Cash / Tunai">Cash / Tunai</option>
                  <option value="Deposit / Saldo Akun">Deposit / Saldo Akun</option>
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium">Alasan Pembatalan</label>
                <textarea
                  required rows={3}
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  placeholder="Contoh: Sakit, kendala visa, ganti jadwal keluarga, dll."
                  value={groupCancelForm.reason}
                  onChange={e => setGroupCancelForm({ ...groupCancelForm, reason: e.target.value })}
                />
              </div>
              <div className={`pt-3 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowGroupCancelModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-medium">
                  Proses Pembatalan & Refund Grup
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ROOMING LIST */}
      {showRoomingModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-3xl p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowRoomingModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <DoorOpen className="w-5 h-5 text-emerald-500" /> Rooming List
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>Kelompokkan jamaah ke dalam kamar per program keberangkatan.</p>

            <div className="mb-4">
              <label className="block mb-1 text-xs font-medium">Pilih Program Keberangkatan</label>
              <select
                className={`w-full ${styles.inputBg} rounded-lg p-2.5 text-xs`}
                value={roomingPackageId}
                onChange={e => setRoomingPackageId(e.target.value)}
              >
                <option value="">-- Pilih Paket --</option>
                {packagesList.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </select>
            </div>

            {roomingPackageId && (
              <>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="text-[11px] flex flex-wrap gap-2">
                    {Object.entries(ROOM_CAPACITY).map(([rt, cap]) => {
                      const count = roomingBookingsForPackage.filter(b => (b.roomType || 'Quad') === rt).length;
                      return (
                        <span key={rt} className={`px-2.5 py-1 rounded-full ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
                          {rt}: {count} orang ({Math.ceil(count / cap)} kamar)
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAutoAssignRooms(roomingBookingsForPackage)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-medium"
                    >
                      <Wand2 className="w-3.5 h-3.5" /> Auto-Isi Kamar
                    </button>
                    <button
                      onClick={() => handlePrintRoomingList(roomingBookingsForPackage, roomingPackage)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} rounded-lg text-[11px] font-medium`}
                    >
                      <Printer className="w-3.5 h-3.5" /> Cetak
                    </button>
                  </div>
                </div>

                <div className={`border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg overflow-hidden`}>
                  <table className="w-full text-left text-xs">
                    <thead className={`${styles.tableHeaderBg} uppercase`}>
                      <tr>
                        <th className="p-3">Jamaah</th>
                        <th className="p-3">Tipe Kamar</th>
                        <th className="p-3">No. Kamar</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {roomingBookingsForPackage.length === 0 ? (
                        <tr><td colSpan="3" className={`p-6 text-center ${styles.textSub}`}>Belum ada jamaah aktif di paket ini.</td></tr>
                      ) : (
                        roomingBookingsForPackage.map(b => (
                          <tr key={b.id}>
                            <td className={`p-3 font-medium ${styles.textTitle}`}>{b.jamaahName}</td>
                            <td className="p-3">{b.roomType}</td>
                            <td className="p-3">
                              <input
                                type="text"
                                defaultValue={b.roomLabel || ''}
                                placeholder="Cth: Q1"
                                onBlur={(e) => handleSaveRoomLabel(b.id, e.target.value)}
                                className={`w-24 ${styles.inputBg} rounded-lg p-1.5 text-xs`}
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MODAL KIRIM FEEDBACK MASSAL */}
      {showBulkFeedbackModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowBulkFeedbackModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Star className="w-5 h-5 text-amber-500" /> Kirim Feedback Massal
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>Pilih program keberangkatan yang udah pulang, terus kirim link review ke tiap jamaah satu-satu dari daftar ini.</p>

            <div className="mb-4">
              <label className="block mb-1 text-xs font-medium">Pilih Program Keberangkatan</label>
              <select
                className={`w-full ${styles.inputBg} rounded-lg p-2.5 text-xs`}
                value={bulkFeedbackPackageId}
                onChange={e => { setBulkFeedbackPackageId(e.target.value); setSentFeedbackIds([]); }}
              >
                <option value="">-- Pilih Paket --</option>
                {packagesList.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </select>
            </div>

            {bulkFeedbackPackageId && (
              <>
                <div className="flex items-center justify-between mb-2 text-[11px]">
                  <span className={styles.textSub}>{bulkFeedbackBookings.length} jamaah di paket ini</span>
                  <span className="text-emerald-500 font-semibold">{sentFeedbackIds.length} sudah dikirim</span>
                </div>

                <div className={`border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg divide-y ${styles.tableRowBorder} overflow-hidden`}>
                  {bulkFeedbackBookings.length === 0 ? (
                    <div className={`p-6 text-center ${styles.textSub} text-xs`}>Belum ada jamaah aktif di paket ini.</div>
                  ) : (
                    bulkFeedbackBookings.map(b => {
                      const jamaahData = jamaahList.find(j => j.id === b.jamaahId || j.fullName === b.jamaahName);
                      const hasPhone = !!jamaahData?.phone;
                      const isSent = sentFeedbackIds.includes(b.id);
                      return (
                        <div key={b.id} className="flex items-center justify-between p-3 text-xs">
                          <div>
                            <p className={`font-medium ${styles.textTitle}`}>{b.jamaahName}</p>
                            <p className={styles.textSub}>{hasPhone ? jamaahData.phone : 'No. HP belum diisi'}</p>
                          </div>
                          <button
                            onClick={() => {
                              handleShareFeedbackLink(b);
                              setSentFeedbackIds(prev => prev.includes(b.id) ? prev : [...prev, b.id]);
                            }}
                            disabled={!hasPhone}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                              isSent
                                ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                : hasPhone
                                  ? 'bg-amber-500 hover:bg-amber-400 text-white'
                                  : `${isDark ? 'bg-slate-800 text-slate-600' : 'bg-slate-100 text-slate-400'} cursor-not-allowed`
                            }`}
                          >
                            {isSent ? <><Check className="w-3.5 h-3.5" /> Terkirim</> : <><Star className="w-3.5 h-3.5" /> Kirim</>}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
