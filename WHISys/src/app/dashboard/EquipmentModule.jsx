'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc, setDoc,
  query, where, increment
} from 'firebase/firestore';
import {
  PackageCheck, Plus, Edit, Trash2, X, PackagePlus, PackageMinus,
  AlertCircle, CheckCircle, Truck, ClipboardList
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

// Modul Perlengkapan Jamaah — 3 hal:
// 1. Data Master Barang + Stok (equipment_items) — jenis perlengkapan yang
//    disediakan (koper, seragam, ihram/mukena, tas, dst) beserta stok gudang.
//    Sengaja flat tanpa varian ukuran, sesuai konfirmasi user.
// 2. Distribusi per Jamaah per Keberangkatan (equipment_distribution) — buat
//    tiap paket keberangkatan, checklist barang apa aja yang udah/belum
//    diserahkan ke tiap jamaah aktifnya. Toggle checklist otomatis
//    nyesuain stok gudang (dikurangi pas dikasih, dibalikin kalau di-uncheck).
// 3. Rekap Kebutuhan — ringkasan per keberangkatan: total jamaah aktif vs
//    yang udah dikasih vs stok yang tersedia, biar kelihatan kalau stoknya
//    kurang buat proses pengadaan.
export default function EquipmentModule({ theme = 'dark' }) {
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

  const [activeTab, setActiveTab] = useState('distribution'); // 'distribution' | 'master'
  const [loading, setLoading] = useState(true);

  const [itemsList, setItemsList] = useState([]);
  const [packagesList, setPackagesList] = useState([]);

  const fetchItems = async () => {
    const snap = await getDocs(collection(db, 'equipment_items'));
    setItemsList(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
  };

  const fetchPackages = async () => {
    const snap = await getDocs(collection(db, 'packages'));
    setPackagesList(
      snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(a.departureDate || 0) - new Date(b.departureDate || 0))
    );
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchItems(), fetchPackages()]);
    } catch (err) {
      console.error('Gagal mengambil data perlengkapan:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // ============ 1. DATA MASTER BARANG + STOK ============

  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemForm, setItemForm] = useState({ name: '', unit: 'pcs', stock: '', notes: '' });

  const handleOpenAddItem = () => {
    setEditingItemId(null);
    setItemForm({ name: '', unit: 'pcs', stock: '', notes: '' });
    setShowItemModal(true);
  };

  const handleOpenEditItem = (item) => {
    setEditingItemId(item.id);
    setItemForm({ name: item.name || '', unit: item.unit || 'pcs', stock: String(item.stock ?? 0), notes: item.notes || '' });
    setShowItemModal(true);
  };

  const handleItemSubmit = async (e) => {
    e.preventDefault();
    if (!itemForm.name.trim()) {
      alert('Nama barang wajib diisi.');
      return;
    }
    try {
      if (editingItemId) {
        // Stok cuma bisa diubah lewat "Sesuaikan Stok" (biar ada jejak
        // penambahan/pengurangannya) — di sini cuma nama/satuan/catatan.
        await updateDoc(doc(db, 'equipment_items', editingItemId), {
          name: itemForm.name.trim(),
          unit: itemForm.unit,
          notes: itemForm.notes || '',
          updatedAt: new Date().toISOString()
        });
      } else {
        await addDoc(collection(db, 'equipment_items'), {
          name: itemForm.name.trim(),
          unit: itemForm.unit,
          stock: Number(itemForm.stock) || 0,
          notes: itemForm.notes || '',
          createdAt: new Date().toISOString()
        });
      }
      setShowItemModal(false);
      fetchItems();
    } catch (err) {
      alert('Gagal menyimpan data barang: ' + err.message);
    }
  };

  const handleDeleteItem = async (item) => {
    // Jaga-jaga 1: stok yang masih ada isinya jangan kehapus gitu aja —
    // begitu dihapus, jejak barangnya ilang padahal fisiknya masih ada.
    if (Number(item.stock || 0) !== 0) {
      alert(`Stok "${item.name}" masih ada ${item.stock} ${item.unit || ''}. Kosongkan dulu stoknya lewat "Sesuaikan Stok" sebelum dihapus.`);
      return;
    }
    // Jaga-jaga 2: barang yang udah pernah didistribusikan ke jamaah tetep
    // diwanti-wanti, biar staff sadar riwayat distribusinya bakal nggak
    // nyambung ke barang manapun lagi kalau ini dihapus.
    try {
      const distQ = query(collection(db, 'equipment_distribution'), where('itemId', '==', item.id), where('given', '==', true));
      const distSnap = await getDocs(distQ);
      if (!distSnap.empty) {
        if (!confirm(`"${item.name}" udah pernah dikasih ke ${distSnap.size} jamaah (stoknya sekarang emang 0). Riwayat itu nggak ikut kehapus, cuma jadi nggak nyambung ke barang manapun lagi. Tetap hapus?`)) return;
      } else {
        if (!confirm(`Hapus barang "${item.name}"?`)) return;
      }
      await deleteDoc(doc(db, 'equipment_items', item.id));
      fetchItems();
    } catch (err) {
      alert('Gagal menghapus barang: ' + err.message);
    }
  };

  const [showStockModal, setShowStockModal] = useState(false);
  const [adjustingItem, setAdjustingItem] = useState(null);
  const [stockForm, setStockForm] = useState({ type: 'in', qty: '', notes: '' });

  const handleOpenStockAdjust = (item) => {
    setAdjustingItem(item);
    setStockForm({ type: 'in', qty: '', notes: '' });
    setShowStockModal(true);
  };

  const handleStockAdjustSubmit = async (e) => {
    e.preventDefault();
    if (!adjustingItem) return;
    const qty = Number(stockForm.qty) || 0;
    if (qty <= 0) {
      alert('Isi jumlah yang valid.');
      return;
    }
    if (stockForm.type === 'out' && qty > Number(adjustingItem.stock || 0)) {
      alert(`Stok "${adjustingItem.name}" cuma tersisa ${adjustingItem.stock}. Nggak bisa dikurangi ${qty}.`);
      return;
    }
    try {
      const delta = stockForm.type === 'in' ? qty : -qty;
      await updateDoc(doc(db, 'equipment_items', adjustingItem.id), { stock: increment(delta) });
      await addDoc(collection(db, 'equipment_stock_log'), {
        itemId: adjustingItem.id,
        itemName: adjustingItem.name,
        delta,
        notes: stockForm.notes || (stockForm.type === 'in' ? 'Penambahan stok' : 'Pengurangan stok'),
        createdAt: new Date().toISOString()
      });
      setShowStockModal(false);
      fetchItems();
    } catch (err) {
      alert('Gagal menyesuaikan stok: ' + err.message);
    }
  };

  // ============ 2 & 3. DISTRIBUSI PER KEBERANGKATAN + REKAP KEBUTUHAN ============

  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [bookingsForPackage, setBookingsForPackage] = useState([]);
  const [distributionRows, setDistributionRows] = useState([]); // equipment_distribution docs utk paket terpilih
  const [loadingDistribution, setLoadingDistribution] = useState(false);

  const fetchDistributionData = async (packageId) => {
    if (!packageId) { setBookingsForPackage([]); setDistributionRows([]); return; }
    setLoadingDistribution(true);
    try {
      const bookingsQ = query(collection(db, 'bookings'), where('packageId', '==', packageId));
      const bookingsSnap = await getDocs(bookingsQ);
      const activeBookings = bookingsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(b => (b.status || 'active') === 'active')
        .sort((a, b) => (Number(a.groupPaxIndex) || 0) - (Number(b.groupPaxIndex) || 0));
      setBookingsForPackage(activeBookings);

      const distQ = query(collection(db, 'equipment_distribution'), where('packageId', '==', packageId));
      const distSnap = await getDocs(distQ);
      setDistributionRows(distSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Gagal mengambil data distribusi:', err);
    }
    setLoadingDistribution(false);
  };

  useEffect(() => {
    fetchDistributionData(selectedPackageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPackageId]);

  const selectedPackage = packagesList.find(p => p.id === selectedPackageId);

  // Lookup cepat: sudah dikasih atau belum, untuk kombinasi booking+item.
  const getDistRow = (bookingId, itemId) => distributionRows.find(r => r.bookingId === bookingId && r.itemId === itemId);

  const handleToggleGiven = async (booking, item) => {
    const existing = getDistRow(booking.id, item.id);
    const isGiven = existing?.given === true;
    const distId = `${booking.id}_${item.id}`;

    try {
      if (!isGiven) {
        // Mau ditandai "sudah dikasih" — cek stok dulu.
        if (Number(item.stock || 0) < 1) {
          alert(`Stok "${item.name}" habis. Tambah stok dulu lewat menu Data Master Barang.`);
          return;
        }
        await setDoc(doc(db, 'equipment_distribution', distId), {
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          jamaahName: booking.jamaahName,
          groupBookingCode: booking.groupBookingCode || booking.bookingCode,
          packageId: booking.packageId,
          packageName: booking.packageName,
          itemId: item.id,
          itemName: item.name,
          qty: 1,
          given: true,
          givenAt: new Date().toISOString()
        }, { merge: true });
        await updateDoc(doc(db, 'equipment_items', item.id), { stock: increment(-1) });
      } else {
        // Di-uncheck — balikin lagi stoknya.
        await setDoc(doc(db, 'equipment_distribution', distId), {
          given: false,
          givenAt: null
        }, { merge: true });
        await updateDoc(doc(db, 'equipment_items', item.id), { stock: increment(1) });
      }
      await Promise.all([fetchItems(), fetchDistributionData(selectedPackageId)]);
    } catch (err) {
      alert('Gagal mengubah status distribusi: ' + err.message);
    }
  };

  const rekapKebutuhan = itemsList.map(item => {
    const totalJamaah = bookingsForPackage.length;
    const totalDiberikan = distributionRows.filter(r => r.itemId === item.id && r.given).length;
    const sisaKebutuhan = Math.max(0, totalJamaah - totalDiberikan);
    const stokCukup = Number(item.stock || 0) >= sisaKebutuhan;
    return { item, totalJamaah, totalDiberikan, sisaKebutuhan, stokCukup };
  });

  if (loading) {
    return (
      <div className={`${styles.cardBg} border rounded-xl p-12 text-center ${styles.textSub}`}>
        Memuat data perlengkapan jamaah...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={`${styles.cardBg} border rounded-2xl p-6`}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <div>
            <h3 className={`text-lg font-bold ${styles.textTitle} flex items-center gap-2`}>
              <PackageCheck className="w-5 h-5 text-emerald-500" /> Perlengkapan Jamaah
            </h3>
            <p className={`text-xs ${styles.textSub}`}>Data master barang, distribusi per keberangkatan, & rekap kebutuhan.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setActiveTab('distribution')}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'distribution' ? `${styles.tabActive} text-emerald-500 border` : `${styles.textSub} hover:${styles.textTitle}`
            }`}
          >
            <Truck className="w-3.5 h-3.5" /> Distribusi & Rekap Kebutuhan
          </button>
          <button
            onClick={() => setActiveTab('master')}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'master' ? `${styles.tabActive} text-blue-500 border` : `${styles.textSub} hover:${styles.textTitle}`
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5" /> Data Master Barang ({itemsList.length})
          </button>
        </div>

        {/* ============ TAB DATA MASTER BARANG ============ */}
        {activeTab === 'master' && (
          <div>
            <div className="flex justify-end mb-3">
              <button
                onClick={handleOpenAddItem}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah Barang
              </button>
            </div>
            {itemsList.length === 0 ? (
              <div className={`${styles.innerBg} border rounded-xl p-8 text-center text-xs ${styles.textSub}`}>
                Belum ada data master barang. Tambah dulu jenis perlengkapannya.
              </div>
            ) : (
              <>
                <div className={`${styles.innerBg} border rounded-xl overflow-hidden hidden md:block`}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                        <tr>
                          <th className="p-4">Nama Barang</th>
                          <th className="p-4">Satuan</th>
                          <th className="p-4 text-right">Stok Tersedia</th>
                          <th className="p-4">Catatan</th>
                          <th className="p-4 text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${styles.tableRowBorder}`}>
                        {itemsList.map(item => (
                          <tr key={item.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                            <td className={`p-4 font-semibold ${styles.textTitle}`}>{item.name}</td>
                            <td className={`p-4 ${styles.textSub}`}>{item.unit}</td>
                            <td className={`p-4 text-right font-bold ${Number(item.stock || 0) === 0 ? 'text-rose-500' : styles.textTitle}`}>
                              {Number(item.stock || 0).toLocaleString('id-ID')}
                            </td>
                            <td className={`p-4 ${styles.textSub}`}>{item.notes || '-'}</td>
                            <td className="p-4">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => handleOpenStockAdjust(item)}
                                  className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                                  title="Sesuaikan Stok"
                                >
                                  <PackagePlus className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleOpenEditItem(item)}
                                  className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                                  title="Edit Barang"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteItem(item)}
                                  className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                                  title="Hapus Barang"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile card view */}
                <div className="md:hidden space-y-3">
                  {itemsList.map(item => (
                    <div key={item.id} className={`${styles.innerBg} border rounded-xl p-4`}>
                      <p className={`text-sm font-bold ${styles.textTitle}`}>{item.name}</p>
                      <div className="mt-2 space-y-1.5">
                        <div>
                          <p className={`text-[10px] uppercase ${styles.textSub}`}>Satuan</p>
                          <p className={`text-xs ${styles.textTitle}`}>{item.unit}</p>
                        </div>
                        <div>
                          <p className={`text-[10px] uppercase ${styles.textSub}`}>Stok Tersedia</p>
                          <p className={`text-xs font-bold ${Number(item.stock || 0) === 0 ? 'text-rose-500' : styles.textTitle}`}>
                            {Number(item.stock || 0).toLocaleString('id-ID')}
                          </p>
                        </div>
                        <div>
                          <p className={`text-[10px] uppercase ${styles.textSub}`}>Catatan</p>
                          <p className={`text-xs ${styles.textSub}`}>{item.notes || '-'}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button
                          onClick={() => handleOpenStockAdjust(item)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                          title="Sesuaikan Stok"
                        >
                          <PackagePlus className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleOpenEditItem(item)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                          title="Edit Barang"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                          title="Hapus Barang"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ============ TAB DISTRIBUSI & REKAP KEBUTUHAN ============ */}
        {activeTab === 'distribution' && (
          <div className="space-y-4">
            <div>
              <label className={`block mb-1 text-xs font-medium ${styles.textSub}`}>Pilih Keberangkatan</label>
              <select
                className={`w-full sm:w-96 ${styles.inputBg} rounded-lg p-2.5 text-xs`}
                value={selectedPackageId}
                onChange={e => setSelectedPackageId(e.target.value)}
              >
                <option value="">-- Pilih Paket Travel & Tanggal Keberangkatan --</option>
                {packagesList.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code}) - {formatDateDDMMYYYY(p.departureDate)}
                  </option>
                ))}
              </select>
            </div>

            {!selectedPackageId ? (
              <div className={`${styles.innerBg} border rounded-xl p-8 text-center text-xs ${styles.textSub}`}>
                Pilih keberangkatan dulu buat lihat rekap kebutuhan & checklist distribusi perlengkapan jamaahnya.
              </div>
            ) : loadingDistribution ? (
              <div className={`${styles.innerBg} border rounded-xl p-8 text-center text-xs ${styles.textSub}`}>Memuat data...</div>
            ) : itemsList.length === 0 ? (
              <div className={`${styles.innerBg} border rounded-xl p-8 text-center text-xs ${styles.textSub}`}>
                Belum ada data master barang. Tambah dulu jenis perlengkapan di tab "Data Master Barang".
              </div>
            ) : bookingsForPackage.length === 0 ? (
              <div className={`${styles.innerBg} border rounded-xl p-8 text-center text-xs ${styles.textSub}`}>
                Belum ada jamaah aktif di keberangkatan ini.
              </div>
            ) : (
              <>
                {/* REKAP KEBUTUHAN */}
                <div>
                  <p className={`text-xs font-bold ${styles.textTitle} mb-2 flex items-center gap-1.5`}>
                    <ClipboardList className="w-3.5 h-3.5 text-emerald-500" /> Rekap Kebutuhan — {selectedPackage?.name} ({bookingsForPackage.length} Jamaah Aktif)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {rekapKebutuhan.map(({ item, totalJamaah, totalDiberikan, sisaKebutuhan, stokCukup }) => (
                      <div key={item.id} className={`${styles.innerBg} border rounded-xl p-3`}>
                        <p className={`text-xs font-semibold ${styles.textTitle} mb-1`}>{item.name}</p>
                        <p className={`text-[11px] ${styles.textSub}`}>Sudah dikasih: <strong className={styles.textTitle}>{totalDiberikan}/{totalJamaah}</strong></p>
                        {sisaKebutuhan > 0 ? (
                          <p className={`text-[11px] mt-1 flex items-center gap-1 ${stokCukup ? 'text-amber-500' : 'text-rose-500'}`}>
                            <AlertCircle className="w-3 h-3" /> Butuh {sisaKebutuhan} lagi • Stok: {item.stock || 0} {!stokCukup && '(kurang!)'}
                          </p>
                        ) : (
                          <p className="text-[11px] mt-1 flex items-center gap-1 text-emerald-500">
                            <CheckCircle className="w-3 h-3" /> Sudah lengkap semua
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* CHECKLIST DISTRIBUSI PER JAMAAH */}
                <div>
                  <p className={`text-xs font-bold ${styles.textTitle} mb-2 flex items-center gap-1.5`}>
                    <Truck className="w-3.5 h-3.5 text-emerald-500" /> Checklist Distribusi per Jamaah
                  </p>
                  <div className={`${styles.innerBg} border rounded-xl overflow-hidden hidden md:block`}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                          <tr>
                            <th className="p-3">Jamaah</th>
                            <th className="p-3">Kode</th>
                            {itemsList.map(item => (
                              <th key={item.id} className="p-3 text-center whitespace-nowrap">{item.name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${styles.tableRowBorder}`}>
                          {bookingsForPackage.map(booking => (
                            <tr key={booking.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                              <td className={`p-3 font-semibold ${styles.textTitle} whitespace-nowrap`}>{booking.jamaahName}</td>
                              <td className={`p-3 font-mono text-emerald-500 whitespace-nowrap`}>{booking.bookingCode}</td>
                              {itemsList.map(item => {
                                const isGiven = getDistRow(booking.id, item.id)?.given === true;
                                return (
                                  <td key={item.id} className="p-3 text-center">
                                    <button
                                      onClick={() => handleToggleGiven(booking, item)}
                                      title={isGiven ? `Sudah dikasih ${item.name} — klik buat batalkan` : `Belum dikasih ${item.name} — klik buat tandai sudah`}
                                      className={`w-6 h-6 rounded-md border flex items-center justify-center mx-auto transition-colors ${
                                        isGiven
                                          ? 'bg-emerald-500 border-emerald-500 text-white'
                                          : `${isDark ? 'border-slate-700 hover:border-emerald-500' : 'border-slate-300 hover:border-emerald-500'}`
                                      }`}
                                    >
                                      {isGiven && <CheckCircle className="w-4 h-4" />}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mobile card view */}
                  <div className="md:hidden space-y-3">
                    {bookingsForPackage.map(booking => (
                      <div key={booking.id} className={`${styles.innerBg} border rounded-xl p-4`}>
                        <p className={`text-sm font-bold ${styles.textTitle}`}>{booking.jamaahName}</p>
                        <p className={`text-xs font-mono text-emerald-500 mt-0.5`}>{booking.bookingCode}</p>
                        <div className="mt-3 space-y-2">
                          {itemsList.map(item => {
                            const isGiven = getDistRow(booking.id, item.id)?.given === true;
                            return (
                              <div key={item.id} className="flex items-center justify-between gap-2">
                                <span className={`text-xs ${styles.textSub}`}>{item.name}</span>
                                <button
                                  onClick={() => handleToggleGiven(booking, item)}
                                  title={isGiven ? `Sudah dikasih ${item.name} — klik buat batalkan` : `Belum dikasih ${item.name} — klik buat tandai sudah`}
                                  className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${
                                    isGiven
                                      ? 'bg-emerald-500 border-emerald-500 text-white'
                                      : `${isDark ? 'border-slate-700 hover:border-emerald-500' : 'border-slate-300 hover:border-emerald-500'}`
                                  }`}
                                >
                                  {isGiven && <CheckCircle className="w-4 h-4" />}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* MODAL TAMBAH/EDIT BARANG */}
      {showItemModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowItemModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <PackageCheck className="w-5 h-5 text-emerald-500" /> {editingItemId ? 'Edit' : 'Tambah'} Barang Perlengkapan
            </h3>
            <form onSubmit={handleItemSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Nama Barang</label>
                <input
                  type="text" required
                  placeholder="Misal: Koper, Seragam, Ihram, Mukena, Tas"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={itemForm.name}
                  onChange={e => setItemForm({ ...itemForm, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Satuan</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={itemForm.unit}
                    onChange={e => setItemForm({ ...itemForm, unit: e.target.value })}
                  >
                    <option value="pcs">Pcs</option>
                    <option value="set">Set</option>
                    <option value="unit">Unit</option>
                    <option value="buah">Buah</option>
                  </select>
                </div>
                {!editingItemId && (
                  <div>
                    <label className="block mb-1 font-medium">Stok Awal</label>
                    <input
                      type="number" min="0"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={itemForm.stock}
                      onChange={e => setItemForm({ ...itemForm, stock: e.target.value })}
                    />
                  </div>
                )}
              </div>
              {editingItemId && (
                <p className={`${styles.innerBg} p-2.5 rounded-lg border text-[10.5px]`}>
                  Stok cuma bisa diubah lewat tombol "Sesuaikan Stok" di tabel, biar ada jejak penambahan/pengurangannya.
                </p>
              )}
              <div>
                <label className="block mb-1 font-medium">Catatan (opsional)</label>
                <input
                  type="text"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={itemForm.notes}
                  onChange={e => setItemForm({ ...itemForm, notes: e.target.value })}
                />
              </div>
              <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg transition-colors">
                {editingItemId ? 'Simpan Perubahan' : 'Tambah Barang'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL SESUAIKAN STOK */}
      {showStockModal && adjustingItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowStockModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <PackagePlus className="w-5 h-5 text-emerald-500" /> Sesuaikan Stok
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              {adjustingItem.name} • Stok saat ini: <strong className={styles.textTitle}>{adjustingItem.stock || 0} {adjustingItem.unit}</strong>
            </p>
            <form onSubmit={handleStockAdjustSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setStockForm({ ...stockForm, type: 'in' })}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border font-medium transition-colors ${
                    stockForm.type === 'in' ? 'bg-emerald-600 border-emerald-600 text-white' : `${styles.inputBg}`
                  }`}
                >
                  <PackagePlus className="w-3.5 h-3.5" /> Tambah Stok
                </button>
                <button
                  type="button"
                  onClick={() => setStockForm({ ...stockForm, type: 'out' })}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border font-medium transition-colors ${
                    stockForm.type === 'out' ? 'bg-rose-600 border-rose-600 text-white' : `${styles.inputBg}`
                  }`}
                >
                  <PackageMinus className="w-3.5 h-3.5" /> Kurangi Stok
                </button>
              </div>
              <div>
                <label className="block mb-1 font-medium">Jumlah</label>
                <input
                  type="number" required min="1"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={stockForm.qty}
                  onChange={e => setStockForm({ ...stockForm, qty: e.target.value })}
                />
              </div>
              <div>
                <label className="block mb-1 font-medium">Catatan</label>
                <input
                  type="text"
                  placeholder={stockForm.type === 'in' ? 'Misal: Pembelian baru dari supplier' : 'Misal: Barang rusak/hilang'}
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={stockForm.notes}
                  onChange={e => setStockForm({ ...stockForm, notes: e.target.value })}
                />
              </div>
              <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg transition-colors">
                Simpan
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
