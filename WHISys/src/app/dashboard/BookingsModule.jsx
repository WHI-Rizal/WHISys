'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc, query, where, increment } from 'firebase/firestore';
import { BookOpen, Plus, Search, CheckCircle, Clock, X, Edit, Trash2, Wallet, History, Printer, FileCheck, Check, AlertCircle, MessageSquare, Ban, RotateCcw, DoorOpen, Wand2, Filter, MoreHorizontal, Star } from 'lucide-react';

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
    paymentNotes: 'Setoran Pembayaran',
    // Tanggal setoran (bisa diubah staff kalau nyatet setoran yg telat
    // diinput) — default hari ini. Nilai awalnya di-inline (bukan panggil
    // todayDateStr()) soalnya helper itu dideklarasikan belakangan di bawah.
    paymentDate: new Date().toISOString().slice(0, 10)
  });

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
    notes: '',
    date: ''
  });

  // State Filter Tampilan (Aktif / Semua / Dibatalkan / Reschedule)
  const [viewFilter, setViewFilter] = useState('active');

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
    notes: 'Setoran Tambahan',
    // Sama kayak formData.paymentDate — nilai awalnya di-inline (bukan
    // panggil todayDateStr()) soalnya helper itu dideklarasikan belakangan.
    date: new Date().toISOString().slice(0, 10)
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

  useEffect(() => {
    if (targetBookingId && bookings.length > 0) {
      const found = bookings.find(b => b.id === targetBookingId);
      if (found) {
        handleOpenHistory(found);
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
      await deleteDoc(doc(db, 'payments_income', payId));
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
    try {
      await updateDoc(doc(db, 'payments_income', payId), {
        amount: Number(paymentEditForm.amount),
        paymentMethod: paymentEditForm.paymentMethod,
        notes: paymentEditForm.notes,
        // Kalau field tanggalnya dikosongin, biarin createdAt lama (jangan
        // dipaksa ke waktu sekarang) — cuma di-update kalau staff emang
        // sengaja ganti tanggalnya.
        ...(paymentEditForm.date ? { createdAt: resolvePaymentCreatedAt(paymentEditForm.date) } : {})
      });

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
      initialPayment: '', paymentMethod: 'Transfer Bank', paymentNotes: 'DP Pendaftaran',
      paymentDate: todayDateStr()
    });
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
      paymentNotes: 'Setoran Tambahan',
      paymentDate: todayDateStr()
    });
    setNewOrdererForm({ fullName: item.ordererName || '', phone: '', nik: '', passportNumber: '' });
    setShowModal(true);
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

  const handleCancelSubmit = async (e) => {
    e.preventDefault();
    if (!selectedBookingForAction) return;
    if (!canManageBookings) {
      alert("Cuma Finance & Super Admin yang boleh memproses pembatalan/refund.");
      return;
    }

    try {
      await updateDoc(doc(db, 'bookings', selectedBookingForAction.id), {
        status: 'cancelled',
        cancelReason: cancelForm.reason || '-',
        refundAmount: Number(cancelForm.refundAmount || 0),
        refundMethod: cancelForm.refundMethod,
        cancelledAt: new Date().toISOString()
      });

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
    setGroupPaymentForm({ amount: '', paymentMethod: 'Transfer Bank', notes: 'Setoran Tambahan', date: todayDateStr() });
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

    try {
      // Urutan pax dalam grup harus sama kayak pas grup ini pertama kali
      // dibuat (biar sisa pembagian tetap konsisten jatuh ke pax pertama) —
      // urutkan berdasarkan groupPaxIndex kalau ada, fallback ke urutan array asli.
      const groupItems = [...groupPaymentTarget.items].sort((a, b) => {
        if (a.groupPaxIndex != null && b.groupPaxIndex != null) return a.groupPaxIndex - b.groupPaxIndex;
        return 0;
      });
      const paxCount = groupItems.length;

      // Bagi rata nominal setoran ke semua pax (sisa pembagian masuk ke pax pertama)
      // — pola yang sama persis dengan pembagian DP awal pas registrasi grup baru.
      const baseShare = Math.floor(amount / paxCount);
      const remainder = amount - (baseShare * paxCount);

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
            notes: `${groupPaymentForm.notes} (Grup ${groupPaymentTarget.code})`,
            createdAt: resolvePaymentCreatedAt(groupPaymentForm.date)
          });
        }

        // Sinkronkan totalPaid/paymentStatus tiap pax dari data payments_income
        // asli — dijalankan utk semua pax di grup, bukan cuma yang kebagian
        // setoran nonzero, biar tetap konsisten kalau ada penyesuaian rounding.
        await syncBookingTotalPaid(item.id, item.totalAmount);
      }

      setShowGroupPaymentModal(false);
      setGroupPaymentForm({ amount: '', paymentMethod: 'Transfer Bank', notes: 'Setoran Tambahan', date: todayDateStr() });
      fetchData();
    } catch (err) {
      alert("Gagal mencatat setoran grup: " + err.message);
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
  const buildInvoiceBoxHtml = (booking, payments) => {
    const isLunas = booking.paymentStatus === 'Full Payment';
    const totalAmount = Number(booking.totalAmount) || 0;

    // Variabel Dinamis Profil Perusahaan & Bank
    const compName = companyInfo?.name || 'PT. WISATA HALAL INTERNASIONAL';
    const compAddress = companyInfo?.address || 'Ruko Graha Cirendeu No.1C Jl. Cirendeu Raya, Tangerang Selatan, Banten, Indonesia, 15445';
    const compPpiu = companyInfo?.ppiuNumber || 'PPIU No. U.123 / 2024';
    const compPhone = companyInfo?.phone || '+62 812-0000-0000';
    const compEmail = companyInfo?.email || 'admin@wisatahalalindonesia.id';
    const bankName = companyInfo?.bankName || 'Bank Syariah Indonesia (BSI)';
    const bankAccount = companyInfo?.bankAccount || '788-9900-112 a.n. PT. Wisata Halal Internasional';

    const totalPaid = payments.length > 0
      ? payments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      : (Number(booking.totalPaid) || 0);

    const sisaTagihan = totalAmount - totalPaid;

    const paymentRowsHtml = payments.length > 0
      ? payments.map((pay, idx) => `
          <tr style="background-color: #f8fafc; font-size: 11px; color: #475569;">
            <td style="padding: 6px 12px; border-bottom: 1px solid #f1f5f9;">
              • Setoran #${idx + 1} (${formatDateDDMMYYYY(pay.createdAt)}) - <span style="font-style: italic;">${pay.paymentMethod || 'Transfer'} (${pay.notes || 'Setoran'})</span>
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
            <td>Total Harga Paket:</td>
            <td style="text-align: right; font-weight: bold; white-space: nowrap;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
          </tr>
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

  // Cetak invoice SEMUA pax dlm 1 grup booking sekaligus — digabung jadi 1
  // dokumen (1 invoice per halaman, page-break di antaranya) & 1x print
  // dialog, bukan pax-per-pax kayak sebelumnya. Dipanggil dari tombol Cetak
  // yang ada di header grup (bukan lagi di baris masing-masing peserta).
  const handlePrintGroupInvoices = async (items) => {
    if (!items || items.length === 0) return;
    try {
      const boxes = await Promise.all(items.map(async (booking, idx) => {
        const payments = await fetchPaymentsForBooking(booking.id);
        const boxHtml = buildInvoiceBoxHtml(booking, payments);
        return idx < items.length - 1 ? `<div style="page-break-after: always;">${boxHtml}</div>` : boxHtml;
      }));
      const first = items[0];
      const title = items.length > 1
        ? `Invoice Grup - ${first.groupBookingCode || first.bookingCode}`
        : `Invoice - ${first.bookingCode}`;
      const docContent = wrapInvoiceDocument(title, boxes.join(''));
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

      let paymentVal = Number(formData.initialPayment || 0);
      if (paymentVal > 0 && !canRecordPayment) {
        // Jaga-jaga: role yang nggak boleh nyatet setoran (mis. Operational)
        // tetap bisa proses booking-nya, tapi setorannya diabaikan di sini.
        paymentVal = 0;
      }

      if (editingBookingId) {
        if (!canManageBookings) {
          alert("Cuma Finance & Super Admin yang boleh mengedit booking.");
          return;
        }
        const currentBooking = bookings.find(b => b.id === editingBookingId);

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
          totalAmount: price,
          updatedAt: new Date().toISOString()
        });

        if (paymentVal > 0) {
          await addDoc(collection(db, 'payments_income'), {
            bookingId: editingBookingId,
            bookingCode: currentBooking.bookingCode,
            jamaahName: selectedJamaah.fullName,
            packageId: selectedPkg.id,
            packageName: selectedPkg.name,
            amount: paymentVal,
            paymentMethod: formData.paymentMethod,
            notes: formData.paymentNotes,
            createdAt: resolvePaymentCreatedAt(formData.paymentDate)
          });
        }

        await syncBookingTotalPaid(editingBookingId, price);

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
            totalAmount: price,
            totalPaid: paymentVal,
            paymentStatus: paymentVal >= price ? 'Full Payment' : 'DP Paid',
            documents: emptyDocChecklist,
            createdAt: new Date().toISOString()
          });

          if (paymentVal > 0) {
            await addDoc(collection(db, 'payments_income'), {
              bookingId: newBookingRef.id,
              bookingCode: bookingCode,
              jamaahName: selectedJamaah.fullName,
              packageId: selectedPkg.id,
              packageName: selectedPkg.name,
              amount: paymentVal,
              paymentMethod: formData.paymentMethod,
              notes: formData.paymentNotes,
              createdAt: resolvePaymentCreatedAt(formData.paymentDate)
            });
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

          for (let i = 0; i < paxList.length; i++) {
            const pax = paxList[i];
            const paxShare = baseShare + (i === 0 ? remainder : 0);
            const bookingCode = `${groupBookingCode}-${i + 1}`;

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
              totalAmount: price,
              totalPaid: paxShare,
              paymentStatus: paxShare >= price ? 'Full Payment' : 'DP Paid',
              documents: emptyDocChecklist,
              createdAt: new Date().toISOString()
            });

            if (paxShare > 0) {
              await addDoc(collection(db, 'payments_income'), {
                bookingId: newBookingRef.id,
                bookingCode,
                jamaahName: pax.jamaahName,
                packageId: selectedPkg.id,
                packageName: selectedPkg.name,
                amount: paxShare,
                paymentMethod: formData.paymentMethod,
                notes: `${formData.paymentNotes} (Grup ${groupBookingCode}, ${paxCount} pax)`,
                createdAt: resolvePaymentCreatedAt(formData.paymentDate)
              });
            }
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
    );

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
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        {activeGroupCode ? (
        <>
        <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <button
            onClick={() => setActiveGroupCode(null)}
            className={`flex items-center gap-1.5 text-xs font-semibold ${isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            ‹ Kembali ke Ringkasan Booking
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-emerald-500">Grup: {activeGroupCode}</span>
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
                <th className="p-4">% Bayar</th>
                <th className="p-4 text-center">Setor</th>
                <th className="p-4 text-center">Opsi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {loading ? (
                <tr><td colSpan="10" className={`p-8 text-center ${styles.textSub}`}>Memuat data manifest...</td></tr>
              ) : groupedBookingSummary.length === 0 ? (
                <tr><td colSpan="10" className={`p-8 text-center ${styles.textSub}`}>Belum ada data booking.</td></tr>
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
                    <td className="p-4">{renderStatusBadge(group.primary)}</td>
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
                const totalPreview = unitPrice * (formData.paxCount || 1);
                return (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl text-[11px] flex justify-between items-center">
                    <span className="text-emerald-500 font-medium">
                      Rp {unitPrice.toLocaleString('id-ID')} / pax {formData.paxCount > 1 ? `x ${formData.paxCount} pax` : ''}
                    </span>
                    <span className="font-bold text-emerald-500">Total: Rp {totalPreview.toLocaleString('id-ID')}</span>
                  </div>
                );
              })()}

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
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Tanggal Setoran</label>
                      <input
                        type="date"
                        className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                        value={formData.paymentDate}
                        onChange={e => setFormData({ ...formData, paymentDate: e.target.value })}
                      />
                      <p className="text-[10px] mt-1 opacity-70">Ganti tanggalnya kalau setoran ini sebenarnya diterima di hari lain (misal telat diinput ke sistem).</p>
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
                              <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-1.5 py-0.5 rounded text-[10px] mr-1`}>{pay.paymentMethod}</span>
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
                                      setPaymentEditForm({ amount: pay.amount, paymentMethod: pay.paymentMethod, notes: pay.notes, date: (pay.createdAt || '').slice(0, 10) });
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
                  </select>
                </div>
              </div>
              <div>
                <label className="block mb-1 font-medium">Tanggal Setoran</label>
                <input
                  type="date"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={groupPaymentForm.date}
                  onChange={e => setGroupPaymentForm({ ...groupPaymentForm, date: e.target.value })}
                />
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
