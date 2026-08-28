'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  query, where, increment
} from 'firebase/firestore';
import {
  UserCheck, Plus, Edit, Trash2, X, Link2, Wallet, History,
  AlertCircle, Building2
} from 'lucide-react';

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
export default function AgentsModule({ theme = 'dark' }) {
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
    setEditingPartnerId(null);
    setPartnerForm({ name: '', type: 'Mitra', contactPerson: '', phone: '', commissionType: 'percent', commissionValue: '', notes: '', active: true });
    setCustomTypeInput('');
    setShowPartnerModal(true);
  };

  const handleOpenEditPartner = (p) => {
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

  const getPartnerSummary = (partnerId) => {
    const accrued = partnerBookings.filter(pb => pb.partnerId === partnerId).reduce((acc, pb) => acc + (Number(pb.commissionAmount) || 0), 0);
    const paid = commissionPayments.filter(p => p.partnerId === partnerId).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    return { accrued, paid, outstanding: accrued - paid };
  };

  const handleDeletePartner = async (p) => {
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
        packageName: group.primary.packageName,
        totalAmount: group.totalAmount,
        commissionType,
        commissionValue,
        commissionAmount,
        createdAt: new Date().toISOString()
      });
      setShowLinkModal(false);
      fetchData();
    } catch (err) {
      alert('Gagal menghubungkan booking ke mitra: ' + err.message);
    }
  };

  const handleUnlinkBooking = async (pb) => {
    const label = pb.paxCount > 1 ? `${pb.jamaahName} dkk (${pb.paxCount} pax)` : pb.jamaahName;
    if (!confirm(`Putuskan hubungan pemesanan ${pb.groupBookingCode} (${label}) dari mitra "${pb.partnerName}"? Komisi Rp ${Number(pb.commissionAmount).toLocaleString('id-ID')} dari pemesanan ini nggak akan dihitung lagi.`)) return;
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
  const [payForm, setPayForm] = useState({ partnerId: '', amount: '', accountId: '', notes: '', paymentDate: todayDateStr() });

  const handleOpenPayModal = () => {
    if (partnersList.length === 0) {
      alert('Tambah dulu data mitra/agen di tab "Data Mitra & Agen".');
      return;
    }
    setPayForm({ partnerId: '', amount: '', accountId: '', notes: 'Pembayaran Komisi', paymentDate: todayDateStr() });
    setShowPayModal(true);
  };

  const handlePaySubmit = async (e) => {
    e.preventDefault();
    const partner = partnersList.find(p => p.id === payForm.partnerId);
    if (!partner) { alert('Pilih mitra/agen dulu.'); return; }
    if (!payForm.accountId) { alert('Pilih akun Kas/Bank yang dipakai bayar komisi ini.'); return; }
    const amount = Number(payForm.amount) || 0;
    if (amount <= 0) { alert('Isi nominal yang valid.'); return; }
    const { outstanding } = getPartnerSummary(partner.id);
    if (amount > outstanding) {
      alert(`Nominal melebihi sisa komisi yang belum dibayar. Sisa komisi "${partner.name}": Rp ${outstanding.toLocaleString('id-ID')}.`);
      return;
    }
    const account = financialAccounts.find(a => a.id === payForm.accountId);
    try {
      const payRef = await addDoc(collection(db, 'partner_commission_payments'), {
        partnerId: partner.id,
        partnerName: partner.name,
        amount,
        accountId: payForm.accountId,
        accountName: account?.name || '',
        notes: payForm.notes || '',
        createdAt: resolvePaymentCreatedAt(payForm.paymentDate)
      });
      // Ikut kecatat sebagai "Biaya Operasional Kantor" (expenses_operational)
      // juga — biar Saldo Kas Bersih Operasional di dashboard Keuangan ikut
      // kepotong dan tetap sinkron sama saldo Kas/Bank yang sebenarnya,
      // bukan cuma kepotong di sisi mutasi bank doang.
      const expenseRef = await addDoc(collection(db, 'expenses_operational'), {
        category: 'Komisi Mitra/Agen',
        amount,
        accountId: payForm.accountId,
        accountName: account?.name || '',
        notes: `Komisi ${partner.name}${payForm.notes ? ' - ' + payForm.notes : ''}`,
        expenseDate: payForm.paymentDate || todayDateStr(),
        createdAt: resolvePaymentCreatedAt(payForm.paymentDate),
        source: 'partner_commission_payment',
        sourcePartnerPaymentId: payRef.id
      });
      await updateDoc(doc(db, 'partner_commission_payments', payRef.id), { operationalExpenseId: expenseRef.id });
      await adjustAccountBalance(payForm.accountId, -amount, {
        description: `Bayar Komisi Mitra - ${partner.name}`,
        reference: partner.name,
        source: 'partner_commission_payment',
        date: resolvePaymentCreatedAt(payForm.paymentDate),
        sourceDocId: payRef.id
      });
      setShowPayModal(false);
      fetchData();
    } catch (err) {
      alert('Gagal mencatat pembayaran komisi: ' + err.message);
    }
  };

  const handleDeletePayment = async (pay) => {
    if (!confirm(`Hapus riwayat pembayaran komisi Rp ${Number(pay.amount).toLocaleString('id-ID')} ke "${pay.partnerName}"? Saldo Kas/Bank akan dikembalikan.`)) return;
    try {
      if (pay.accountId) {
        await adjustAccountBalance(pay.accountId, Number(pay.amount) || 0, {
          description: `Koreksi Hapus Pembayaran Komisi - ${pay.partnerName}`,
          reference: pay.partnerName,
          source: 'partner_commission_payment_delete',
          sourceDocId: pay.id
        });
      }
      // Ikut hapus catatan "Biaya Operasional Kantor" yang otomatis dibikin
      // pas pembayaran ini dicatat, biar nggak ada jejak biaya yang ketinggalan.
      if (pay.operationalExpenseId) {
        await deleteDoc(doc(db, 'expenses_operational', pay.operationalExpenseId));
      }
      await deleteDoc(doc(db, 'partner_commission_payments', pay.id));
      fetchData();
    } catch (err) {
      alert('Gagal menghapus riwayat pembayaran: ' + err.message);
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
            <div className="flex justify-end mb-3">
              <button
                onClick={handleOpenAddPartner}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah Mitra/Agen
              </button>
            </div>
            <div className={`${styles.innerBg} border rounded-xl overflow-hidden`}>
              <div className="overflow-x-auto">
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
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ============ TAB KOMISI PER BOOKING ============ */}
        {activeTab === 'bookings' && (
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-3">
              <select
                className={`w-full sm:w-72 ${styles.inputBg} rounded-lg p-2.5 text-xs`}
                value={filterPartnerId}
                onChange={e => setFilterPartnerId(e.target.value)}
              >
                <option value="">Semua Mitra/Agen</option>
                {partnersList.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={handleOpenLinkModal}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" /> Hubungkan Pemesanan ke Mitra
              </button>
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
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                    <tr>
                      <th className="p-4">Kode Pemesanan</th>
                      <th className="p-4">Jamaah</th>
                      <th className="p-4">Paket</th>
                      <th className="p-4">Mitra/Agen</th>
                      <th className="p-4 text-right">Total Pemesanan</th>
                      <th className="p-4 text-right">Komisi</th>
                      <th className="p-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${styles.tableRowBorder}`}>
                    {visiblePartnerBookings.length === 0 ? (
                      <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Belum ada pemesanan yang dihubungkan ke mitra/agen.</td></tr>
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
                            <button
                              onClick={() => handleUnlinkBooking(pb)}
                              className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                              title="Putuskan Hubungan"
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
            </div>
          </div>
        )}

        {/* ============ TAB PEMBAYARAN KOMISI ============ */}
        {activeTab === 'payments' && (
          <div>
            <div className="flex justify-end mb-3">
              <button
                onClick={handleOpenPayModal}
                className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <Wallet className="w-3.5 h-3.5" /> Bayar Komisi
              </button>
            </div>
            <div className={`${styles.innerBg} border rounded-xl overflow-hidden`}>
              <div className="overflow-x-auto">
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
                            <button
                              onClick={() => handleDeletePayment(pay)}
                              className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                              title="Hapus Riwayat"
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
            </div>
          </div>
        )}
      </div>

      {/* MODAL TAMBAH/EDIT MITRA */}
      {showPartnerModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
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
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative`}>
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
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={linkForm.partnerId}
                  onChange={e => handlePartnerChangeInLink(e.target.value)}
                >
                  <option value="">-- Pilih Mitra/Agen --</option>
                  {partnersList.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.type}) - {formatCommission(p.commissionType, p.commissionValue)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium">Pemesanan</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={linkForm.groupCode}
                  onChange={e => setLinkForm({ ...linkForm, groupCode: e.target.value })}
                >
                  <option value="">-- Pilih Kode Booking / Jamaah --</option>
                  {availableGroups.map(g => (
                    <option key={g.code} value={g.code}>
                      {g.code} - {g.primary.jamaahName}{g.paxCount > 1 ? ` dkk (${g.paxCount} pax)` : ''} - {g.primary.packageName} - Rp {g.totalAmount.toLocaleString('id-ID')}
                    </option>
                  ))}
                </select>
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
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
            <button onClick={() => setShowPayModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <Wallet className="w-5 h-5 text-rose-500" /> Bayar Komisi Mitra
            </h3>
            <form onSubmit={handlePaySubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Mitra/Agen</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={payForm.partnerId}
                  onChange={e => setPayForm({ ...payForm, partnerId: e.target.value })}
                >
                  <option value="">-- Pilih Mitra/Agen --</option>
                  {partnersList.map(p => {
                    const { outstanding } = getPartnerSummary(p.id);
                    return (
                      <option key={p.id} value={p.id}>{p.name} - Sisa: Rp {outstanding.toLocaleString('id-ID')}</option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium">Nominal Pembayaran (Rp)</label>
                <input
                  type="number" required min="1"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={payForm.amount}
                  onChange={e => setPayForm({ ...payForm, amount: e.target.value })}
                />
              </div>
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
                <input
                  type="date"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={payForm.paymentDate}
                  onChange={e => setPayForm({ ...payForm, paymentDate: e.target.value })}
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
              <button type="submit" className="w-full bg-rose-600 hover:bg-rose-500 text-white font-medium py-2.5 rounded-lg transition-colors">
                Bayar Komisi
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
