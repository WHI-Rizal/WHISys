'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import SearchableSelect from '@/components/SearchableSelect';
import DateFieldID from '@/components/DateFieldID';
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  query, where, increment
} from 'firebase/firestore';
import {
  UserCheck, Plus, Edit, Trash2, X, Link2, Wallet, History,
  AlertCircle, Building2
} from 'lucide-react';
import { postPartnerCommissionPayment, deleteJournalEntriesBySource } from '../../lib/journal';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const todayDateStr = () => new Date().toISOString().slice(0, 10);
const resolvePaymentCreatedAt = (dateStr) => {
  if (!dateStr) return new Date().toISOString();
  const now = new Date();
  const d = new Date(dateStr);
  d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return d.toISOString();
};

// Modul Mitra & Agen — khusus mitra/agen travel EKSTERNAL (reseller paket
// kita), bukan staf Sales internal. 3 bagian:
// 1. Data Master Mitra/Agen (partners) — profil + % komisi default.
// 2. Tracking Komisi per Booking (partner_bookings) — hubungkan booking yang
//    closing-nya lewat mitra tertentu, komisi dihitung dari % x totalAmount
//    booking itu. Sengaja "hubungkan manual" (bukan field di form booking),
//    biar modul ini berdiri sendiri tanpa perlu ubah BookingsModule.jsx yang
//    sudah sangat besar — booking mana aja (yang belum terhubung ke mitra
//    lain) bisa dipilih dari sini kapan saja.
// 3. Pembayaran Komisi ke Mitra (partner_commission_payments) — mirip
//    Riwayat Bayar Vendor, ngurangin saldo Kas/Bank & nyatet ke
//    account_mutations biar tetap konsisten sama rekap mutasi bank.
export default function AgentsModule({ theme = 'dark', userRole = '', currentUser = null }) {
  const isDark = theme === 'dark';

  // Menu Mitra & Agen sengaja tetap bisa DIBUKA & DILIHAT sama semua role
  // yang login (Sales/Operational sering perlu ngecek data mitra/komisi
  // juga). Tapi nulis datanya (tambah/edit/hapus mitra, hubungkan/lepas
  // booking ke mitra, catat/hapus pembayaran komisi) cuma boleh Finance &
  // Super Admin — sama persis kayak Firestore Rules-nya (isFinanceOrAdmin).
  // Tanpa pengecekan ini, role lain bisa aja mencet tombolnya tapi ujung-
  // ujungnya cuma ketimpuk error "Missing or insufficient permissions" dari
  // Firestore, jadi mending tombolnya disembunyikan dari awal.
  const roleLower = (userRole || '').toLowerCase();
  const canManagePartners = roleLower.includes('super') || roleLower === 'admin' || roleLower === 'finance';

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

  const [activeTab, setActiveTab] = useState('partners'); // 'partners' | 'bookings' | 'payments'
  const [loading, setLoading] = useState(true);

  const [partnersList, setPartnersList] = useState([]);
  const [partnerBookings, setPartnerBookings] = useState([]);
  const [commissionPayments, setCommissionPayments] = useState([]);
  const [bookingsList, setBookingsList] = useState([]);
  const [financialAccounts, setFinancialAccounts] = useState([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [partnersSnap, pbSnap, paySnap, bookingsSnap, accSnap] = await Promise.all([
        getDocs(collection(db, 'partners')),
        getDocs(collection(db, 'partner_bookings')),
        getDocs(collection(db, 'partner_commission_payments')),
        getDocs(collection(db, 'bookings')),
        getDocs(collection(db, 'financial_accounts'))
      ]);
      setPartnersList(partnersSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setPartnerBookings(pbSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCommissionPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
      setBookingsList(bookingsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setFinancialAccounts(accSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Gagal mengambil data mitra & agen:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // Ledger mutasi Kas/Bank — pola sama persis dengan modul Keuangan, biar
  // pembayaran komisi ke mitra ikut muncul di rekap Mutasi Bank & bisa
  // direkonsiliasi.
  const adjustAccountBalance = async (accountId, delta, meta = {}) => {
    await updateDoc(doc(db, 'financial_accounts', accountId), { balance: increment(delta) });
    const acc = financialAccounts.find(a => a.id === accountId);
    await addDoc(collection(db, 'account_mutations'), {
      accountId,
      accountName: acc?.name || meta.accountName || '',
      type: delta >= 0 ? 'in' : 'out',
      amount: Math.abs(delta),
      description: meta.description || '',
      reference: meta.reference || '',
      source: meta.source || 'partner_commission',
      sourceDocId: meta.sourceDocId || '',
      createdAt: meta.date || new Date().toISOString()
    });
  };

  // Hapus baris account_mutations yang berasal dari SATU dokumen pembayaran
  // komisi (dicari lewat sourceDocId) — dipake pas pembayarannya dihapus,
  // biar baris "Bayar Komisi Mitra" ikut hilang dari Riwayat Mutasi (bukan
  // nambah baris "Koreksi Hapus" baru). Saldo akun tetap disesuaikan
  // langsung lewat increment, pola sama persis dengan modul Keuangan & Booking.
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

  // Cek apakah pembayaran komisi ini (lewat account_mutations yang nempel ke
  // sourceDocId tertentu) udah "dicocokkan" (matched) ke salah satu baris
  // Rekonsiliasi Bank. Dipake buat NGEBLOK hapus pembayaran yang udah
  // direkon, biar link matchedMutationId di bank_statement_lines nggak
  // ujug-ujug nyantol ke mutasi yang udah kehapus. Staff harus lepas
  // kecocokannya dulu lewat Laporan Keuangan > Rekonsiliasi Bank.
  const isAccountMutationReconciled = async (accountId, sourceDocIds) => {
    const ids = Array.from(new Set((Array.isArray(sourceDocIds) ? sourceDocIds : [sourceDocIds]).filter(Boolean)));
    if (!accountId || ids.length === 0) return false;
    const mutationIds = new Set();
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      const mutQ = query(collection(db, 'account_mutations'), where('accountId', '==', accountId), where('sourceDocId', 'in', chunk));
      const mutSnap = await getDocs(mutQ);
      mutSnap.docs.forEach(d => mutationIds.add(d.id));
    }
    if (mutationIds.size === 0) return false;
    const mutationIdList = Array.from(mutationIds);
    for (let i = 0; i < mutationIdList.length; i += 10) {
      const chunk = mutationIdList.slice(i, i + 10);
      const bslQ = query(collection(db, 'bank_statement_lines'), where('matchedMutationId', 'in', chunk), where('matchStatus', '==', 'matched'));
      const bslSnap = await getDocs(bslQ);
      if (!bslSnap.empty) return true;
    }
    return false;
  };

  const RECON_BLOCK_MSG = 'Transaksi ini sudah "dicocokkan" (rekonsiliasi) dengan salah satu baris mutasi bank. Lepas dulu kecocokannya lewat menu Laporan Keuangan > Rekonsiliasi Bank, baru transaksi ini bisa dihapus/diedit.';

  // ============ 1. DATA MASTER MITRA & AGEN ============

  // Jenis mitra bawaan — tapi nggak dikunci cuma ini doang. User bisa nambah
  // jenis baru sendiri (misal Reseller, Referral, dst) lewat "+ Tambah Jenis
  // Baru" di dropdown, dan jenis baru itu otomatis nempel jadi pilihan lagi
  // di dropdown begitu ada minimal 1 mitra yang pakai jenis tersebut.
  const DEFAULT_PARTNER_TYPES = ['Mitra', 'Agen', 'Reseller', 'Referral'];

  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [editingPartnerId, setEditingPartnerId] = useState(null);
  const [partnerForm, setPartnerForm] = useState({ name: '', type: 'Mitra', contactPerson: '', phone: '', commissionType: 'percent', commissionValue: '', notes: '', active: true });
  const [customTypeInput, setCustomTypeInput] = useState('');

  // Daftar jenis yang muncul di dropdown = bawaan + semua jenis unik yang
  // udah pernah dipakai mitra manapun (termasuk yang tadinya diketik manual).
  const partnerTypeOptions = Array.from(new Set([
    ...DEFAULT_PARTNER_TYPES,
    ...partnersList.map(p => p.type).filter(Boolean)
  ]));

  // Label komisi siap-tampil, dipakai di tabel & dropdown — otomatis nyesuain
  // format persen atau nominal rupiah.
  const formatCommission = (type, value) => {
    const v = Number(value) || 0;
    return type === 'fixed' ? `Rp ${v.toLocaleString('id-ID')}` : `${v}%`;
  };

  const handleOpenAddPartner = () => {
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh menambah data Mitra/Agen.");
      return;
    }
    setEditingPartnerId(null);
    setPartnerForm({ name: '', type: 'Mitra', contactPerson: '', phone: '', commissionType: 'percent', commissionValue: '', notes: '', active: true });
    setCustomTypeInput('');
    setShowPartnerModal(true);
  };

  const handleOpenEditPartner = (p) => {
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh mengedit data Mitra/Agen.");
      return;
    }
    setEditingPartnerId(p.id);
    setPartnerForm({
      name: p.name || '', type: p.type || 'Mitra', contactPerson: p.contactPerson || '',
      phone: p.phone || '', commissionType: p.commissionType || 'percent', commissionValue: String(p.commissionValue ?? ''), notes: p.notes || '',
      active: p.active !== false
    });
    setCustomTypeInput('');
    setShowPartnerModal(true);
  };

  const handlePartnerSubmit = async (e) => {
    e.preventDefault();
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh menyimpan data Mitra/Agen.");
      return;
    }
    if (!partnerForm.name.trim()) { alert('Nama mitra/agen wajib diisi.'); return; }
    if (partnerForm.type === '__new__' && !customTypeInput.trim()) {
      alert('Isi nama jenis mitra yang baru dulu.');
      return;
    }
    const resolvedType = partnerForm.type === '__new__' ? customTypeInput.trim() : partnerForm.type;
    try {
      const payload = {
        name: partnerForm.name.trim(),
        type: resolvedType,
        contactPerson: partnerForm.contactPerson || '',
        phone: partnerForm.phone || '',
        commissionType: partnerForm.commissionType === 'fixed' ? 'fixed' : 'percent',
        commissionValue: Number(partnerForm.commissionValue) || 0,
        notes: partnerForm.notes || '',
        active: !!partnerForm.active
      };
      if (editingPartnerId) {
        await updateDoc(doc(db, 'partners', editingPartnerId), { ...payload, updatedAt: new Date().toISOString() });
      } else {
        await addDoc(collection(db, 'partners'), { ...payload, createdAt: new Date().toISOString() });
      }
      setShowPartnerModal(false);
      fetchData();
    } catch (err) {
      alert('Gagal menyimpan data mitra: ' + err.message);
    }
  };

  // Accrued/paid sekarang dihitung dari flag `paid` per-booking (bukan
  // lagi lump-sum dibandingkan total pembayaran), sejak Bayar Komisi
  // diubah jadi pilih pemesanan spesifik yang dibayar — lihat handlePaySubmit.
  // Ini juga yang bikin komisi bisa dialokasikan akurat ke HPP paket yang
  // benar per pemesanan (bukan cuma total gelondongan per mitra).
  const getPartnerSummary = (partnerId) => {
    const bookings = partnerBookings.filter(pb => pb.partnerId === partnerId);
    const accrued = bookings.reduce((acc, pb) => acc + (Number(pb.commissionAmount) || 0), 0);
    const paid = bookings.filter(pb => pb.paid).reduce((acc, pb) => acc + (Number(pb.commissionAmount) || 0), 0);
    return { accrued, paid, outstanding: accrued - paid };
  };

  const handleDeletePartner = async (p) => {
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh menghapus data Mitra/Agen.");
      return;
    }
    const { outstanding } = getPartnerSummary(p.id);
    if (outstanding !== 0) {
      alert(`Mitra "${p.name}" masih punya sisa komisi ${outstanding > 0 ? 'belum dibayar' : 'lebih bayar'} sebesar Rp ${Math.abs(outstanding).toLocaleString('id-ID')}. Beresin dulu sebelum dihapus.`);
      return;
    }
    const hasHistory = partnerBookings.some(pb => pb.partnerId === p.id) || commissionPayments.some(pay => pay.partnerId === p.id);
    if (hasHistory) {
      if (!confirm(`Mitra "${p.name}" udah punya riwayat booking/pembayaran komisi (saldonya sekarang emang 0). Riwayat itu nggak ikut kehapus, cuma jadi nggak nyambung ke mitra manapun lagi. Tetap hapus?`)) return;
    } else {
      if (!confirm(`Hapus mitra "${p.name}"?`)) return;
    }
    try {
      await deleteDoc(doc(db, 'partners', p.id));
      fetchData();
    } catch (err) {
      alert('Gagal menghapus mitra: ' + err.message);
    }
  };

  // ============ 2. TRACKING KOMISI PER BOOKING (per PEMESANAN, bukan per pax) ============
  // Satu "pemesanan" = satu kode booking (kalau rombongan, groupBookingCode-nya
  // sama buat semua pax). Dihubungkan sekaligus jadi 1 record komisi yang
  // ngitung dari TOTAL nominal seluruh pax aktif dalam pemesanan itu, bukan
  // satu-satu per pax — jadi mitra yang closing 1 booking rombongan cukup
  // dihubungkan sekali aja.

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkForm, setLinkForm] = useState({ partnerId: '', groupCode: '', commissionType: 'percent', commissionValue: '' });

  const assignedGroupCodes = new Set(partnerBookings.map(pb => pb.groupBookingCode));

  // Kelompokkan booking aktif per kode pemesanan (groupBookingCode kalau
  // rombongan, atau bookingCode kalau single), lalu buang yang udah
  // terhubung ke mitra manapun.
  const availableGroups = (() => {
    const map = {};
    bookingsList
      .filter(b => (b.status || 'active') === 'active')
      .forEach(b => {
        const code = b.groupBookingCode || b.bookingCode;
        if (!map[code]) map[code] = [];
        map[code].push(b);
      });
    return Object.entries(map)
      .map(([code, items]) => {
        const primary = items.sort((a, b) => (Number(a.groupPaxIndex) || 0) - (Number(b.groupPaxIndex) || 0))[0];
        return {
          code,
          items,
          primary,
          paxCount: items.length,
          bookingIds: items.map(b => b.id),
          totalAmount: items.reduce((acc, b) => acc + (Number(b.totalAmount) || 0), 0)
        };
      })
      .filter(g => !assignedGroupCodes.has(g.code))
      .sort((a, b) => new Date(b.primary?.createdAt || 0) - new Date(a.primary?.createdAt || 0));
  })();

  // Ngitung nominal komisi sesuai jenisnya — persentase dari TOTAL pemesanan,
  // atau flat rupiah berapapun total tagihannya (flat berlaku per pemesanan,
  // bukan dikali jumlah pax).
  const computeCommissionAmount = (type, value, totalAmount) => {
    const v = Number(value) || 0;
    return type === 'fixed' ? v : (Number(totalAmount) || 0) * v / 100;
  };

  const handleOpenLinkModal = () => {
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh menghubungkan booking ke Mitra/Agen.");
      return;
    }
    if (partnersList.length === 0) {
      alert('Tambah dulu data mitra/agen di tab "Data Mitra & Agen".');
      return;
    }
    setLinkForm({ partnerId: '', groupCode: '', commissionType: 'percent', commissionValue: '' });
    setShowLinkModal(true);
  };

  const handlePartnerChangeInLink = (partnerId) => {
    const p = partnersList.find(x => x.id === partnerId);
    setLinkForm({
      ...linkForm,
      partnerId,
      commissionType: p?.commissionType || 'percent',
      commissionValue: p ? String(p.commissionValue ?? '') : ''
    });
  };

  const handleLinkSubmit = async (e) => {
    e.preventDefault();
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh menghubungkan booking ke Mitra/Agen.");
      return;
    }
    const partner = partnersList.find(p => p.id === linkForm.partnerId);
    const group = availableGroups.find(g => g.code === linkForm.groupCode);
    if (!partner) { alert('Pilih mitra/agen dulu.'); return; }
    if (!group) { alert('Pilih pemesanan yang mau dihubungkan.'); return; }
    const commissionType = linkForm.commissionType === 'fixed' ? 'fixed' : 'percent';
    const commissionValue = Number(linkForm.commissionValue) || 0;
    const commissionAmount = computeCommissionAmount(commissionType, commissionValue, group.totalAmount);
    try {
      await addDoc(collection(db, 'partner_bookings'), {
        partnerId: partner.id,
        partnerName: partner.name,
        groupBookingCode: group.code,
        bookingIds: group.bookingIds,
        bookingCode: group.primary.bookingCode,
        jamaahName: group.primary.jamaahName,
        paxCount: group.paxCount,
        // packageId disimpen mulai sekarang biar komisi booking ini bisa
        // dialokasikan ke HPP paket yang bener pas dibayar (lihat
        // handlePaySubmit) — booking yang di-link SEBELUM field ini ada
        // otomatis jadi '' (nggak dialokasikan ke paket manapun, komisinya
        // tetap kecatet tapi sebagai Beban Operasional biasa).
        packageId: group.primary.packageId || '',
        packageName: group.primary.packageName,
        totalAmount: group.totalAmount,
        commissionType,
        commissionValue,
        commissionAmount,
        paid: false,
        createdAt: new Date().toISOString()
      });
      setShowLinkModal(false);
      fetchData();
    } catch (err) {
      alert('Gagal menghubungkan booking ke mitra: ' + err.message);
    }
  };

  const handleUnlinkBooking = async (pb) => {
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh memutuskan hubungan booking ke Mitra/Agen.");
      return;
    }
    const label = pb.paxCount > 1 ? `${pb.jamaahName} dkk (${pb.paxCount} pax)` : pb.jamaahName;
    const commissionAmount = Number(pb.commissionAmount) || 0;
    // Sejak Bayar Komisi milih pemesanan spesifik (bukan lump-sum lagi),
    // status lunas per booking kecatet jelas lewat flag `paid` — jadi kita
    // BISA tau pasti (bukan nebak) kalau komisi booking ini udah pernah
    // dibayar & kejurnal. Unlink booking yang udah lunas nggak boleh
    // dilakukan diam-diam (jurnal & pembayarannya masih ada tapi bookingnya
    // udah putus) — staf harus hapus/koreksi pembayarannya dulu di tab
    // "Pembayaran Komisi" baru unlink.
    if (pb.paid) {
      alert(`Komisi pemesanan ${pb.groupBookingCode} (${label}) sebesar Rp ${commissionAmount.toLocaleString('id-ID')} udah pernah DIBAYAR & kejurnal ke mitra "${pb.partnerName}". Nggak bisa di-unlink langsung — hapus dulu riwayat pembayaran komisi yang mencakup pemesanan ini di tab "Pembayaran Komisi", baru unlink boleh dilakukan.`);
      return;
    }
    if (!confirm(`Putuskan hubungan pemesanan ${pb.groupBookingCode} (${label}) dari mitra "${pb.partnerName}"? Komisi Rp ${commissionAmount.toLocaleString('id-ID')} dari pemesanan ini nggak akan dihitung lagi.`)) return;
    try {
      await deleteDoc(doc(db, 'partner_bookings', pb.id));
      fetchData();
    } catch (err) {
      alert('Gagal memutuskan hubungan: ' + err.message);
    }
  };

  const [filterPartnerId, setFilterPartnerId] = useState('');
  const visiblePartnerBookings = filterPartnerId ? partnerBookings.filter(pb => pb.partnerId === filterPartnerId) : partnerBookings;

  // ============ 3. PEMBAYARAN KOMISI KE MITRA ============

  const [showPayModal, setShowPayModal] = useState(false);
  // `selectedBookingIds` gantiin `amount` bebas — staf milih pemesanan mana
  // aja yang lagi dibayar komisinya (bisa lebih dari satu), nominal total
  // ke-hitung otomatis dari situ. Ini yang bikin tiap pembayaran bisa
  // dialokasikan akurat ke HPP paket masing-masing (lewat packageId di
  // partner_bookings), bukan cuma nominal gelondongan tanpa keterangan
  // pemesanan mana aja yang tercakup.
  const [payForm, setPayForm] = useState({ partnerId: '', accountId: '', notes: '', paymentDate: todayDateStr(), selectedBookingIds: [] });
  // Nge-guard submit/hapus pembayaran biar nggak keklik dobel — tiap aksi
  // di sini motong/ngembaliin saldo Kas/Bank beneran, jadi kalau kepencet
  // dua kali sebelum request pertama kelar, saldo bisa kepotong/kebalikin
  // dua kali juga. ID payment yang lagi diproses disimpen di sini, atau
  // 'new' pas lagi nyimpen pembayaran baru.
  const [processingPaymentId, setProcessingPaymentId] = useState(null);

  const handleOpenPayModal = () => {
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh mencatat pembayaran komisi Mitra/Agen.");
      return;
    }
    if (partnersList.length === 0) {
      alert('Tambah dulu data mitra/agen di tab "Data Mitra & Agen".');
      return;
    }
    setPayForm({ partnerId: '', accountId: '', notes: 'Pembayaran Komisi', paymentDate: todayDateStr(), selectedBookingIds: [] });
    setShowPayModal(true);
  };

  // Pemesanan mitra yang lagi dipilih di form Bayar Komisi, dan total
  // nominalnya — dipakai baik buat render checklist maupun buat submit.
  const payFormUnpaidBookings = partnerBookings.filter(pb => pb.partnerId === payForm.partnerId && !pb.paid);
  const payFormSelectedBookings = payFormUnpaidBookings.filter(pb => payForm.selectedBookingIds.includes(pb.id));
  const payFormTotal = payFormSelectedBookings.reduce((acc, pb) => acc + (Number(pb.commissionAmount) || 0), 0);
  const togglePayFormBooking = (bookingId) => {
    setPayForm(prev => ({
      ...prev,
      selectedBookingIds: prev.selectedBookingIds.includes(bookingId)
        ? prev.selectedBookingIds.filter(id => id !== bookingId)
        : [...prev.selectedBookingIds, bookingId]
    }));
  };

  const handlePaySubmit = async (e) => {
    e.preventDefault();
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh mencatat pembayaran komisi Mitra/Agen.");
      return;
    }
    if (processingPaymentId) return; // udah ada request lagi jalan, cegah dobel klik
    const partner = partnersList.find(p => p.id === payForm.partnerId);
    if (!partner) { alert('Pilih mitra/agen dulu.'); return; }
    if (!payForm.accountId) { alert('Pilih akun Kas/Bank yang dipakai bayar komisi ini.'); return; }
    if (payFormSelectedBookings.length === 0) { alert('Pilih minimal 1 pemesanan yang mau dibayar komisinya.'); return; }
    const amount = payFormTotal;
    if (amount <= 0) { alert('Total komisi pemesanan yang dipilih harus lebih dari 0.'); return; }
    const account = financialAccounts.find(a => a.id === payForm.accountId);
    // Pisah porsi yang ketaut ke paket (packageId keisi) dari yang nggak —
    // porsi pertama dialokasikan jadi HPP paket itu, sisanya tetap Beban
    // Operasional biasa. Lihat postPartnerCommissionPayment di journal.js.
    const allocatedItems = payFormSelectedBookings.filter(pb => pb.packageId);
    const unallocatedItems = payFormSelectedBookings.filter(pb => !pb.packageId);
    const allocatedAmount = allocatedItems.reduce((acc, pb) => acc + (Number(pb.commissionAmount) || 0), 0);
    const unallocatedAmount = unallocatedItems.reduce((acc, pb) => acc + (Number(pb.commissionAmount) || 0), 0);
    setProcessingPaymentId('new');
    try {
      const payRef = await addDoc(collection(db, 'partner_commission_payments'), {
        partnerId: partner.id,
        partnerName: partner.name,
        amount,
        accountId: payForm.accountId,
        accountName: account?.name || '',
        notes: payForm.notes || '',
        createdAt: resolvePaymentCreatedAt(payForm.paymentDate),
        // bookingIds dipakai buat ngembaliin flag `paid` pas pembayaran ini
        // dihapus. allocations dipakai LaporanKeuanganModule.jsx buat
        // ngitung berapa komisi yang udah kealokasi ke HPP tiap paket pas
        // paketnya "Akui Pendapatan".
        bookingIds: payFormSelectedBookings.map(pb => pb.id),
        allocations: payFormSelectedBookings.map(pb => ({
          partnerBookingId: pb.id,
          groupBookingCode: pb.groupBookingCode,
          packageId: pb.packageId || '',
          packageName: pb.packageName || '',
          commissionAmount: Number(pb.commissionAmount) || 0
        }))
      });
      // Porsi yang NGGAK ketaut ke paket manapun tetap ikut kecatat sebagai
      // "Biaya Operasional Kantor" (expenses_operational) — biar Saldo Kas
      // Bersih Operasional di dashboard Keuangan tetap sinkron. Porsi yang
      // ketaut ke paket SENGAJA nggak masuk sini, karena itu bukan lagi
      // biaya operasional umum — dia jadi bagian HPP paket yang bersangkutan.
      let expenseRef = null;
      if (unallocatedAmount > 0) {
        expenseRef = await addDoc(collection(db, 'expenses_operational'), {
          category: 'Komisi Mitra/Agen',
          amount: unallocatedAmount,
          accountId: payForm.accountId,
          accountName: account?.name || '',
          notes: `Komisi ${partner.name}${payForm.notes ? ' - ' + payForm.notes : ''} (pemesanan tanpa paket terhubung)`,
          expenseDate: payForm.paymentDate || todayDateStr(),
          createdAt: resolvePaymentCreatedAt(payForm.paymentDate),
          source: 'partner_commission_payment',
          sourcePartnerPaymentId: payRef.id
        });
        await updateDoc(doc(db, 'partner_commission_payments', payRef.id), { operationalExpenseId: expenseRef.id });
      }
      await adjustAccountBalance(payForm.accountId, -amount, {
        description: `Bayar Komisi Mitra - ${partner.name}`,
        reference: partner.name,
        source: 'partner_commission_payment',
        date: resolvePaymentCreatedAt(payForm.paymentDate),
        sourceDocId: payRef.id
      });
      await postPartnerCommissionPayment({
        paymentId: payRef.id, partnerName: partner.name,
        allocatedAmount, unallocatedAmount,
        accountId: payForm.accountId, accountName: account?.name || '',
        date: resolvePaymentCreatedAt(payForm.paymentDate),
        createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
      }).catch(err => {
        console.error('Gagal posting jurnal komisi mitra:', err);
        alert(`Pembayaran komisi tersimpan, TAPI jurnalnya GAGAL diposting (${err.message}). Neraca/Buku Besar untuk transaksi ini belum akurat sampai dikoreksi — segera lapor ke tim IT/Finance.`);
      });
      // Tandain semua pemesanan yang dibayar barusan jadi lunas, biar nggak
      // muncul lagi di checklist Bayar Komisi berikutnya & getPartnerSummary
      // ke-update otomatis.
      await Promise.all(payFormSelectedBookings.map(pb => updateDoc(doc(db, 'partner_bookings', pb.id), {
        paid: true,
        paidPaymentId: payRef.id,
        paidAt: resolvePaymentCreatedAt(payForm.paymentDate)
      })));
      setShowPayModal(false);
      fetchData();
    } catch (err) {
      alert('Gagal mencatat pembayaran komisi: ' + err.message);
    } finally {
      setProcessingPaymentId(null);
    }
  };

  const handleDeletePayment = async (pay) => {
    if (!canManagePartners) {
      alert("Cuma Finance & Super Admin yang boleh menghapus riwayat pembayaran komisi Mitra/Agen.");
      return;
    }
    if (processingPaymentId) return; // udah ada request lagi jalan, cegah dobel klik
    if (pay.accountId && await isAccountMutationReconciled(pay.accountId, [pay.id])) {
      alert(RECON_BLOCK_MSG);
      return;
    }
    if (!confirm(`Hapus riwayat pembayaran komisi Rp ${Number(pay.amount).toLocaleString('id-ID')} ke "${pay.partnerName}"? Saldo Kas/Bank akan dikembalikan.`)) return;
    setProcessingPaymentId(pay.id);
    try {
      if (pay.accountId) {
        // Baris "Bayar Komisi Mitra" di Riwayat Mutasi ikut dihapus sekalian
        // (bukan nambah baris "Koreksi Hapus" baru) — saldo akun dikembalikan
        // lewat increment, riwayatnya jadi bersih seolah pembayaran ini
        // memang belum pernah dicatat.
        await removeAccountMutationBySource(pay.accountId, pay.id, Number(pay.amount) || 0);
      }
      // Ikut hapus catatan "Biaya Operasional Kantor" yang otomatis dibikin
      // pas pembayaran ini dicatat (kalau ada porsi yang nggak ketaut ke
      // paket manapun), biar nggak ada jejak biaya yang ketinggalan.
      if (pay.operationalExpenseId) {
        await deleteDoc(doc(db, 'expenses_operational', pay.operationalExpenseId));
      }
      // Jurnal (HPP paket + Beban Operasional, digabung 1 entry) dihapus
      // lewat source pembayaran ini sendiri — lihat postPartnerCommissionPayment.
      await deleteJournalEntriesBySource('partner_commission_payment', pay.id);
      // Balikin semua pemesanan yang tercakup pembayaran ini jadi belum
      // lunas lagi, biar komisinya bisa dibayar ulang / muncul lagi di
      // checklist Bayar Komisi. Pembayaran lama (sebelum fitur alokasi
      // paket) nggak punya bookingIds — dilewatin aja, nggak ada yang perlu
      // dibalikin.
      if (Array.isArray(pay.bookingIds) && pay.bookingIds.length > 0) {
        await Promise.all(pay.bookingIds.map(bookingId => updateDoc(doc(db, 'partner_bookings', bookingId), {
          paid: false,
          paidPaymentId: null,
          paidAt: null
        }).catch(() => null)));
      }
      await deleteDoc(doc(db, 'partner_commission_payments', pay.id));
      fetchData();
    } catch (err) {
      alert('Gagal menghapus riwayat pembayaran: ' + err.message);
    } finally {
      setProcessingPaymentId(null);
    }
  };

  if (loading) {
    return (
      <div className={`${styles.cardBg} border rounded-xl p-12 text-center ${styles.textSub}`}>
        Memuat data mitra & agen...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={`${styles.cardBg} border rounded-2xl p-6`}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <div>
            <h3 className={`text-lg font-bold ${styles.textTitle} flex items-center gap-2`}>
              <UserCheck className="w-5 h-5 text-emerald-500" /> Mitra & Agen
            </h3>
            <p className={`text-xs ${styles.textSub}`}>Data mitra/agen travel eksternal, komisi per booking, & pembayaran komisi.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setActiveTab('partners')}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'partners' ? `${styles.tabActive} text-emerald-500 border` : `${styles.textSub} hover:${styles.textTitle}`
            }`}
          >
            <Building2 className="w-3.5 h-3.5" /> Data Mitra & Agen ({partnersList.length})
          </button>
          <button
            onClick={() => setActiveTab('bookings')}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'bookings' ? `${styles.tabActive} text-blue-500 border` : `${styles.textSub} hover:${styles.textTitle}`
            }`}
          >
            <Link2 className="w-3.5 h-3.5" /> Komisi per Booking ({partnerBookings.length})
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'payments' ? `${styles.tabActive} text-rose-500 border` : `${styles.textSub} hover:${styles.textTitle}`
            }`}
          >
            <Wallet className="w-3.5 h-3.5" /> Pembayaran Komisi ({commissionPayments.length})
          </button>
        </div>

        {/* ============ TAB DATA MITRA & AGEN ============ */}
        {activeTab === 'partners' && (
          <div>
            {canManagePartners && (
              <div className="flex justify-end mb-3">
                <button
                  onClick={handleOpenAddPartner}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah Mitra/Agen
                </button>
              </div>
            )}
            <div className={`${styles.innerBg} border rounded-xl overflow-hidden`}>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                    <tr>
                      <th className="p-4">Nama</th>
                      <th className="p-4">Jenis</th>
                      <th className="p-4">Kontak</th>
                      <th className="p-4 text-right">Komisi Default</th>
                      <th className="p-4 text-center">Status</th>
                      <th className="p-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${styles.tableRowBorder}`}>
                    {partnersList.length === 0 ? (
                      <tr><td colSpan="6" className={`p-8 text-center ${styles.textSub}`}>Belum ada data mitra/agen. Tambah dulu profilnya.</td></tr>
                    ) : (
                      partnersList.map(p => {
                        return (
                          <tr key={p.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                            <td className={`p-4 font-semibold ${styles.textTitle}`}>{p.name}</td>
                            <td className={`p-4 ${styles.textSub}`}>{p.type}</td>
                            <td className={`p-4 ${styles.textSub}`}>
                              {p.contactPerson || '-'}{p.phone ? ` • ${p.phone}` : ''}
                            </td>
                            <td className={`p-4 text-right ${styles.textTitle}`}>{formatCommission(p.commissionType, p.commissionValue)}</td>
                            <td className="p-4 text-center">
                              {p.active !== false ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Aktif</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">Nonaktif</span>
                              )}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center justify-center gap-1.5">
                                {canManagePartners ? (
                                  <>
                                    <button
                                      onClick={() => handleOpenEditPartner(p)}
                                      className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                                      title="Edit Mitra"
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDeletePartner(p)}
                                      className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                                      title="Hapus Mitra"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : (
                                  <span className={`text-[10px] ${styles.textSub}`}>-</span>
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
              <div className="md:hidden space-y-3 p-3">
                {partnersList.length === 0 ? (
                  <div className={`p-8 text-center ${styles.textSub}`}>Belum ada data mitra/agen. Tambah dulu profilnya.</div>
                ) : (
                  partnersList.map(p => (
                    <div key={p.id} className={`${styles.cardBg} border rounded-xl p-4 space-y-2`}>
                      <div className={`font-semibold ${styles.textTitle}`}>{p.name}</div>
                      <div>
                        <span className="text-xs opacity-60">Jenis</span>
                        <div className={styles.textSub}>{p.type}</div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Kontak</span>
                        <div className={styles.textSub}>{p.contactPerson || '-'}{p.phone ? ` • ${p.phone}` : ''}</div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Komisi Default</span>
                        <div className={styles.textTitle}>{formatCommission(p.commissionType, p.commissionValue)}</div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Status</span>
                        <div>
                          {p.active !== false ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Aktif</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">Nonaktif</span>
                          )}
                        </div>
                      </div>
                      {canManagePartners && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            onClick={() => handleOpenEditPartner(p)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                            title="Edit Mitra"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeletePartner(p)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                            title="Hapus Mitra"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============ TAB KOMISI PER BOOKING ============ */}
        {activeTab === 'bookings' && (
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-3">
              <div className="w-full sm:w-72">
                <SearchableSelect
                  isDark={isDark}
                  inputClassName={`${styles.inputBg} rounded-lg p-2.5 text-xs`}
                  placeholder="Semua Mitra/Agen"
                  emptyOptionLabel="Semua Mitra/Agen"
                  value={filterPartnerId}
                  onChange={(val) => setFilterPartnerId(val)}
                  options={partnersList.map(p => ({ value: p.id, label: p.name }))}
                />
              </div>
              {canManagePartners && (
                <button
                  onClick={handleOpenLinkModal}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  <Link2 className="w-3.5 h-3.5" /> Hubungkan Pemesanan ke Mitra
                </button>
              )}
            </div>

            {/* Ringkasan komisi mitra terpilih — pindah dari tabel Data Mitra
                & Agen ke sini, biar nempel langsung sama rincian booking yang
                jadi sumber hitungannya. */}
            {filterPartnerId && (() => {
              const partner = partnersList.find(p => p.id === filterPartnerId);
              if (!partner) return null;
              const { accrued, paid, outstanding } = getPartnerSummary(filterPartnerId);
              return (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div className={`${styles.innerBg} border rounded-xl p-3`}>
                    <p className={`text-[11px] ${styles.textSub} mb-1`}>Total Komisi — {partner.name}</p>
                    <p className={`text-sm font-bold ${styles.textTitle}`}>Rp {accrued.toLocaleString('id-ID')}</p>
                  </div>
                  <div className={`${styles.innerBg} border rounded-xl p-3`}>
                    <p className={`text-[11px] ${styles.textSub} mb-1`}>Sudah Dibayar</p>
                    <p className="text-sm font-bold text-emerald-500">Rp {paid.toLocaleString('id-ID')}</p>
                  </div>
                  <div className={`${styles.innerBg} border rounded-xl p-3`}>
                    <p className={`text-[11px] ${styles.textSub} mb-1`}>Sisa Komisi Belum Dibayar</p>
                    <p className={`text-sm font-bold ${outstanding > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>Rp {outstanding.toLocaleString('id-ID')}</p>
                  </div>
                </div>
              );
            })()}

            <div className={`${styles.innerBg} border rounded-xl overflow-hidden`}>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                    <tr>
                      <th className="p-4">Kode Pemesanan</th>
                      <th className="p-4">Jamaah</th>
                      <th className="p-4">Paket</th>
                      <th className="p-4">Mitra/Agen</th>
                      <th className="p-4 text-right">Total Pemesanan</th>
                      <th className="p-4 text-right">Komisi</th>
                      <th className="p-4 text-center">Status</th>
                      <th className="p-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${styles.tableRowBorder}`}>
                    {visiblePartnerBookings.length === 0 ? (
                      <tr><td colSpan="8" className={`p-8 text-center ${styles.textSub}`}>Belum ada pemesanan yang dihubungkan ke mitra/agen.</td></tr>
                    ) : (
                      visiblePartnerBookings.map(pb => (
                        <tr key={pb.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                          <td className={`p-4 font-mono text-emerald-500`}>{pb.groupBookingCode}</td>
                          <td className={`p-4 ${styles.textTitle}`}>
                            {pb.jamaahName}{pb.paxCount > 1 ? ` dkk (${pb.paxCount} pax)` : ''}
                          </td>
                          <td className={`p-4 ${styles.textSub}`}>{pb.packageName}</td>
                          <td className={`p-4 ${styles.textTitle}`}>{pb.partnerName}</td>
                          <td className={`p-4 text-right ${styles.textTitle}`}>Rp {Number(pb.totalAmount || 0).toLocaleString('id-ID')}</td>
                          <td className="p-4 text-right font-bold text-emerald-500">
                            Rp {Number(pb.commissionAmount || 0).toLocaleString('id-ID')}
                            <span className={`block text-[10px] font-normal ${styles.textSub}`}>
                              {pb.commissionType === 'fixed' ? 'Flat' : formatCommission('percent', pb.commissionValue)}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <span className={`px-2 py-1 rounded-full text-[10px] font-medium ${pb.paid ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                              {pb.paid ? 'Lunas' : 'Belum Dibayar'}
                            </span>
                            {!pb.packageId && (
                              <span className={`block text-[9.5px] mt-1 ${styles.textSub}`}>di luar HPP paket</span>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            {canManagePartners ? (
                              <button
                                onClick={() => handleUnlinkBooking(pb)}
                                className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                                title="Putuskan Hubungan"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <span className={`text-[10px] ${styles.textSub}`}>-</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-3 p-3">
                {visiblePartnerBookings.length === 0 ? (
                  <div className={`p-8 text-center ${styles.textSub}`}>Belum ada pemesanan yang dihubungkan ke mitra/agen.</div>
                ) : (
                  visiblePartnerBookings.map(pb => (
                    <div key={pb.id} className={`${styles.cardBg} border rounded-xl p-4 space-y-2`}>
                      <div className={`font-semibold font-mono text-emerald-500`}>{pb.groupBookingCode}</div>
                      <div>
                        <span className="text-xs opacity-60">Jamaah</span>
                        <div className={styles.textTitle}>{pb.jamaahName}{pb.paxCount > 1 ? ` dkk (${pb.paxCount} pax)` : ''}</div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Paket</span>
                        <div className={styles.textSub}>{pb.packageName}</div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Mitra/Agen</span>
                        <div className={styles.textTitle}>{pb.partnerName}</div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Total Pemesanan</span>
                        <div className={styles.textTitle}>Rp {Number(pb.totalAmount || 0).toLocaleString('id-ID')}</div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Komisi</span>
                        <div className="font-bold text-emerald-500">
                          Rp {Number(pb.commissionAmount || 0).toLocaleString('id-ID')}
                          <span className={`block text-[10px] font-normal ${styles.textSub}`}>
                            {pb.commissionType === 'fixed' ? 'Flat' : formatCommission('percent', pb.commissionValue)}
                          </span>
                        </div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Status</span>
                        <div>
                          <span className={`px-2 py-1 rounded-full text-[10px] font-medium ${pb.paid ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                            {pb.paid ? 'Lunas' : 'Belum Dibayar'}
                          </span>
                          {!pb.packageId && (
                            <span className={`block text-[9.5px] mt-1 ${styles.textSub}`}>di luar HPP paket</span>
                          )}
                        </div>
                      </div>
                      {canManagePartners && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            onClick={() => handleUnlinkBooking(pb)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                            title="Putuskan Hubungan"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============ TAB PEMBAYARAN KOMISI ============ */}
        {activeTab === 'payments' && (
          <div>
            {canManagePartners && (
              <div className="flex justify-end mb-3">
                <button
                  onClick={handleOpenPayModal}
                  className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  <Wallet className="w-3.5 h-3.5" /> Bayar Komisi
                </button>
              </div>
            )}
            <div className={`${styles.innerBg} border rounded-xl overflow-hidden`}>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                    <tr>
                      <th className="p-4">Mitra/Agen</th>
                      <th className="p-4">Akun & Catatan</th>
                      <th className="p-4">Tanggal</th>
                      <th className="p-4 text-right">Nominal</th>
                      <th className="p-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${styles.tableRowBorder}`}>
                    {commissionPayments.length === 0 ? (
                      <tr><td colSpan="5" className={`p-8 text-center ${styles.textSub}`}>Belum ada riwayat pembayaran komisi.</td></tr>
                    ) : (
                      commissionPayments.map(pay => (
                        <tr key={pay.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                          <td className={`p-4 font-semibold ${styles.textTitle}`}>{pay.partnerName}</td>
                          <td className="p-4">
                            <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] mr-1`}>{pay.accountName}</span>
                            <span className={styles.textSub}>{pay.notes}</span>
                          </td>
                          <td className={`p-4 ${styles.textSub}`}>{formatDateDDMMYYYY(pay.createdAt)}</td>
                          <td className="p-4 text-right font-bold text-rose-500">- Rp {Number(pay.amount || 0).toLocaleString('id-ID')}</td>
                          <td className="p-4 text-center">
                            {canManagePartners ? (
                              <button
                                onClick={() => handleDeletePayment(pay)}
                                disabled={!!processingPaymentId}
                                className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
                                title="Hapus Riwayat"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <span className={`text-[10px] ${styles.textSub}`}>-</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-3 p-3">
                {commissionPayments.length === 0 ? (
                  <div className={`p-8 text-center ${styles.textSub}`}>Belum ada riwayat pembayaran komisi.</div>
                ) : (
                  commissionPayments.map(pay => (
                    <div key={pay.id} className={`${styles.cardBg} border rounded-xl p-4 space-y-2`}>
                      <div className={`font-semibold ${styles.textTitle}`}>{pay.partnerName}</div>
                      <div>
                        <span className="text-xs opacity-60">Akun & Catatan</span>
                        <div>
                          <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] mr-1`}>{pay.accountName}</span>
                          <span className={styles.textSub}>{pay.notes}</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Tanggal</span>
                        <div className={styles.textSub}>{formatDateDDMMYYYY(pay.createdAt)}</div>
                      </div>
                      <div>
                        <span className="text-xs opacity-60">Nominal</span>
                        <div className="font-bold text-rose-500">- Rp {Number(pay.amount || 0).toLocaleString('id-ID')}</div>
                      </div>
                      {canManagePartners && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            onClick={() => handleDeletePayment(pay)}
                            disabled={!!processingPaymentId}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
                            title="Hapus Riwayat"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL TAMBAH/EDIT MITRA */}
      {showPartnerModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowPartnerModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <UserCheck className="w-5 h-5 text-emerald-500" /> {editingPartnerId ? 'Edit' : 'Tambah'} Mitra/Agen
            </h3>
            <form onSubmit={handlePartnerSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Nama Mitra/Agen</label>
                <input
                  type="text" required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={partnerForm.name}
                  onChange={e => setPartnerForm({ ...partnerForm, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Jenis</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={partnerForm.type}
                    onChange={e => setPartnerForm({ ...partnerForm, type: e.target.value })}
                  >
                    {partnerTypeOptions.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    <option value="__new__">➕ Tambah Jenis Baru</option>
                  </select>
                  {partnerForm.type === '__new__' && (
                    <input
                      type="text"
                      placeholder="Misal: Reseller, Referral, dst"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5 mt-2`}
                      value={customTypeInput}
                      onChange={e => setCustomTypeInput(e.target.value)}
                    />
                  )}
                </div>
              </div>
              <div>
                <label className="block mb-1 font-medium">Komisi Default</label>
                <div className="flex gap-2">
                  <select
                    className={`w-20 shrink-0 ${styles.inputBg} rounded-lg p-2.5`}
                    value={partnerForm.commissionType}
                    onChange={e => setPartnerForm({ ...partnerForm, commissionType: e.target.value })}
                  >
                    <option value="percent">%</option>
                    <option value="fixed">Rp</option>
                  </select>
                  <input
                    type="number" min="0" max={partnerForm.commissionType === 'percent' ? 100 : undefined} step={partnerForm.commissionType === 'percent' ? 0.1 : 1000}
                    placeholder={partnerForm.commissionType === 'percent' ? 'Misal: 5 (artinya 5%)' : 'Misal: 500000 (flat per booking)'}
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={partnerForm.commissionValue}
                    onChange={e => setPartnerForm({ ...partnerForm, commissionValue: e.target.value })}
                  />
                </div>
                <p className="text-[10.5px] mt-1">
                  {partnerForm.commissionType === 'percent'
                    ? 'Komisi dihitung dari % x total tagihan tiap booking yang terhubung ke mitra ini.'
                    : 'Komisi flat Rp segini per booking, berapapun total tagihannya.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Nama Kontak (opsional)</label>
                  <input
                    type="text"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={partnerForm.contactPerson}
                    onChange={e => setPartnerForm({ ...partnerForm, contactPerson: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">No. HP / WhatsApp</label>
                  <input
                    type="text"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={partnerForm.phone}
                    onChange={e => setPartnerForm({ ...partnerForm, phone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block mb-1 font-medium">Catatan (opsional)</label>
                <input
                  type="text"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={partnerForm.notes}
                  onChange={e => setPartnerForm({ ...partnerForm, notes: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={partnerForm.active}
                  onChange={e => setPartnerForm({ ...partnerForm, active: e.target.checked })}
                />
                <span>Mitra/Agen aktif (masih bisa dipilih buat booking baru)</span>
              </label>
              <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg transition-colors">
                {editingPartnerId ? 'Simpan Perubahan' : 'Tambah Mitra/Agen'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL HUBUNGKAN BOOKING KE MITRA */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowLinkModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Link2 className="w-5 h-5 text-emerald-500" /> Hubungkan Pemesanan ke Mitra
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Komisi dihitung dari total keseluruhan pemesanan yang dipilih (semua pax dalam kode booking yang sama, kalau rombongan). Pemesanan yang udah terhubung ke mitra lain nggak muncul di daftar.
            </p>
            <form onSubmit={handleLinkSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Mitra/Agen</label>
                <SearchableSelect
                  isDark={isDark}
                  inputClassName={`${styles.inputBg} rounded-lg p-2.5`}
                  placeholder="-- Pilih Mitra/Agen --"
                  value={linkForm.partnerId}
                  onChange={(val) => handlePartnerChangeInLink(val)}
                  options={partnersList.map(p => ({
                    value: p.id,
                    label: `${p.name} (${p.type})`,
                    sublabel: formatCommission(p.commissionType, p.commissionValue),
                  }))}
                />
              </div>
              <div>
                <label className="block mb-1 font-medium">Pemesanan</label>
                <SearchableSelect
                  isDark={isDark}
                  inputClassName={`${styles.inputBg} rounded-lg p-2.5`}
                  placeholder="-- Pilih Kode Booking / Jamaah --"
                  value={linkForm.groupCode}
                  onChange={(val) => setLinkForm({ ...linkForm, groupCode: val })}
                  options={availableGroups.map(g => ({
                    value: g.code,
                    label: `${g.code} - ${g.primary.jamaahName}${g.paxCount > 1 ? ` dkk (${g.paxCount} pax)` : ''}`,
                    sublabel: `${g.primary.packageName} - Rp ${g.totalAmount.toLocaleString('id-ID')}`,
                  }))}
                />
                <p className="text-[10.5px] mt-1">
                  Kalau pemesanan ini rombongan, semua pax di kode booking yang sama ikut terhubung sekaligus — komisi dihitung dari total keseluruhan pemesanan, bukan per pax.
                </p>
                {availableGroups.length === 0 && (
                  <p className="text-[10.5px] mt-1">Semua pemesanan aktif udah terhubung ke mitra masing-masing.</p>
                )}
              </div>
              <div>
                <label className="block mb-1 font-medium">Jenis Komisi — bisa disesuaikan dari default mitra</label>
                <div className="flex gap-2">
                  <select
                    className={`w-20 shrink-0 ${styles.inputBg} rounded-lg p-2.5`}
                    value={linkForm.commissionType}
                    onChange={e => setLinkForm({ ...linkForm, commissionType: e.target.value })}
                  >
                    <option value="percent">%</option>
                    <option value="fixed">Rp</option>
                  </select>
                  <input
                    type="number" min="0" max={linkForm.commissionType === 'percent' ? 100 : undefined} step={linkForm.commissionType === 'percent' ? 0.1 : 1000} required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={linkForm.commissionValue}
                    onChange={e => setLinkForm({ ...linkForm, commissionValue: e.target.value })}
                  />
                </div>
              </div>
              {linkForm.groupCode && (
                <div className={`${styles.innerBg} p-3 rounded-lg border`}>
                  Preview Komisi: <strong className={styles.textTitle}>
                    Rp {computeCommissionAmount(
                      linkForm.commissionType,
                      linkForm.commissionValue,
                      availableGroups.find(g => g.code === linkForm.groupCode)?.totalAmount
                    ).toLocaleString('id-ID')}
                  </strong>
                </div>
              )}
              <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg transition-colors">
                Hubungkan
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL BAYAR KOMISI */}
      {showPayModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowPayModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <Wallet className="w-5 h-5 text-rose-500" /> Bayar Komisi Mitra
            </h3>
            <form onSubmit={handlePaySubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Mitra/Agen</label>
                <SearchableSelect
                  isDark={isDark}
                  inputClassName={`${styles.inputBg} rounded-lg p-2.5`}
                  placeholder="-- Pilih Mitra/Agen --"
                  value={payForm.partnerId}
                  onChange={(val) => setPayForm({ ...payForm, partnerId: val, selectedBookingIds: [] })}
                  options={partnersList.map(p => {
                    const { outstanding } = getPartnerSummary(p.id);
                    return { value: p.id, label: p.name, sublabel: `Sisa: Rp ${outstanding.toLocaleString('id-ID')}` };
                  })}
                />
              </div>
              {payForm.partnerId && (
                <div>
                  <label className="block mb-1 font-medium">Pemesanan yang Dibayar</label>
                  {payFormUnpaidBookings.length === 0 ? (
                    <p className={`p-3 rounded-lg border ${styles.innerBg} text-[11px] italic`}>
                      Mitra ini nggak punya pemesanan dengan komisi yang belum dibayar.
                    </p>
                  ) : (
                    <div className={`rounded-lg border ${styles.innerBg} divide-y ${styles.tableRowBorder} max-h-52 overflow-y-auto`}>
                      {payFormUnpaidBookings.map(pb => {
                        const checked = payForm.selectedBookingIds.includes(pb.id);
                        const label = pb.paxCount > 1 ? `${pb.jamaahName} dkk (${pb.paxCount} pax)` : pb.jamaahName;
                        return (
                          <label key={pb.id} className="flex items-start gap-2.5 p-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              onChange={() => togglePayFormBooking(pb.id)}
                            />
                            <span className="flex-1">
                              <span className={`block font-medium ${styles.textTitle}`}>{pb.groupBookingCode} — {label}</span>
                              <span className="block text-[10.5px] opacity-70">
                                {pb.packageName || 'Tanpa paket terhubung'}{!pb.packageId && ' (di luar HPP paket)'}
                              </span>
                            </span>
                            <span className={`font-medium ${styles.textTitle} whitespace-nowrap`}>Rp {Number(pb.commissionAmount || 0).toLocaleString('id-ID')}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <div className={`flex justify-between items-center mt-2 p-2.5 rounded-lg border ${styles.innerBg}`}>
                    <span className="font-medium">Total Dibayar</span>
                    <span className={`font-bold ${styles.textTitle}`}>Rp {payFormTotal.toLocaleString('id-ID')}</span>
                  </div>
                </div>
              )}
              <div>
                <label className="block mb-1 font-medium">Akun Kas/Bank</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={payForm.accountId}
                  onChange={e => setPayForm({ ...payForm, accountId: e.target.value })}
                >
                  <option value="">-- Pilih Akun --</option>
                  {financialAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} - Rp {Number(a.balance || 0).toLocaleString('id-ID')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium">Tanggal Pembayaran</label>
                <DateFieldID
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={payForm.paymentDate}
                  onChange={(val) => setPayForm({ ...payForm, paymentDate: val })}
                />
              </div>
              <div>
                <label className="block mb-1 font-medium">Catatan</label>
                <input
                  type="text"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={payForm.notes}
                  onChange={e => setPayForm({ ...payForm, notes: e.target.value })}
                />
              </div>
              <button
                type="submit"
                disabled={!!processingPaymentId || payFormSelectedBookings.length === 0}
                className="w-full bg-rose-600 hover:bg-rose-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processingPaymentId === 'new' ? 'Memproses...' : `Bayar Komisi${payFormSelectedBookings.length > 0 ? ` (Rp ${payFormTotal.toLocaleString('id-ID')})` : ''}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
