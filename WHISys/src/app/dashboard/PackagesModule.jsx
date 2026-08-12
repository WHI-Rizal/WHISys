'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Package, Plus, Search, Calendar, Edit, Trash2, Filter, Plane, MapPin, RefreshCw, X } from 'lucide-react';

// Helper Format Tanggal dd/mm/yyyy
const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

// Helper Format Bulan & Tahun
const formatMonthYear = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
};

export default function PackagesModule({ theme = 'dark' }) {
  const isDark = theme === 'dark';

  // Config Style Adaptif Tema
  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    tableHeaderBg: isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-slate-100 text-slate-500',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    tableRowBorder: isDark ? 'divide-slate-800/60' : 'divide-slate-200',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
  };

  const [packagesList, setPackagesList] = useState([]);
  const [bookingsList, setBookingsList] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // State Filter & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [selectedDestination, setSelectedDestination] = useState('');
  const [selectedAirline, setSelectedAirline] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingPackageId, setEditingPackageId] = useState(null);

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    type: 'Umroh Regular',
    departureDate: '',
    durationDays: '9 Hari',
    airline: 'Saudi Arabian Airlines',
    hotelMakkah: 'Pullman Zamzam',
    hotelMadinah: 'Front Taiba',
    destinationCity: 'Korea Selatan (Seoul & Nami)',
    hotelTour: 'Hotel Bintang 4 / Setaraf',
    laScope: 'Bus, Mutawwif, Handling, Visas',
    quotaTotal: 45,
    priceMain: '',
    priceTriple: '',
    priceDouble: '',
    priceChild: ''
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const pkgSnap = await getDocs(collection(db, 'packages'));
      const pkgs = pkgSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const bkSnap = await getDocs(collection(db, 'bookings'));
      const bks = bkSnap.docs.map(d => d.data());

      setBookingsList(bks);
      setPackagesList(pkgs);
    } catch (err) {
      console.error("Gagal mengambil data paket:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenAdd = () => {
    setEditingPackageId(null);
    setFormData({
      code: `PK-${Date.now().toString().slice(-4)}`,
      name: '',
      type: 'Umroh Regular',
      departureDate: '',
      durationDays: '9 Hari',
      airline: 'Saudi Arabian Airlines',
      hotelMakkah: 'Pullman Zamzam',
      hotelMadinah: 'Front Taiba',
      destinationCity: 'Korea Selatan / Jepang',
      hotelTour: 'Hotel Bintang 4 / Setaraf',
      laScope: 'Transport, Hotel, Handling LA',
      quotaTotal: 45,
      priceMain: '',
      priceTriple: '',
      priceDouble: '',
      priceChild: ''
    });
    setShowModal(true);
  };

  const handleOpenEdit = (pkg) => {
    setEditingPackageId(pkg.id);
    setFormData({
      code: pkg.code || '',
      name: pkg.name || '',
      type: pkg.type || 'Umroh Regular',
      departureDate: pkg.departureDate || '',
      durationDays: pkg.durationDays || '9 Hari',
      airline: pkg.airline || '',
      hotelMakkah: pkg.hotelMakkah || '',
      hotelMadinah: pkg.hotelMadinah || '',
      destinationCity: pkg.destinationCity || '',
      hotelTour: pkg.hotelTour || '',
      laScope: pkg.laScope || '',
      quotaTotal: pkg.quotaTotal || 45,
      priceMain: pkg.priceMain || pkg.priceQuad || '',
      priceTriple: pkg.priceTriple || '',
      priceDouble: pkg.priceDouble || '',
      priceChild: pkg.priceChild || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (pkg) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus paket "${pkg.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'packages', pkg.id));
      fetchData();
    } catch (err) {
      alert("Gagal menghapus paket: " + err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        code: formData.code,
        name: formData.name,
        type: formData.type,
        departureDate: formData.departureDate,
        durationDays: formData.durationDays,
        airline: formData.airline,
        hotelMakkah: formData.hotelMakkah,
        hotelMadinah: formData.hotelMadinah,
        destinationCity: formData.destinationCity,
        hotelTour: formData.hotelTour,
        laScope: formData.laScope,
        quotaTotal: Number(formData.quotaTotal),
        priceMain: Number(formData.priceMain || 0),
        priceQuad: Number(formData.priceMain || 0),
        priceTriple: Number(formData.priceTriple || 0),
        priceDouble: Number(formData.priceDouble || 0),
        priceChild: Number(formData.priceChild || 0),
        updatedAt: new Date().toISOString()
      };

      if (editingPackageId) {
        await updateDoc(doc(db, 'packages', editingPackageId), payload);
      } else {
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'packages'), payload);
      }

      setShowModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal menyimpan paket: " + err.message);
    }
  };

  // Extract Maskapai & Periode
  const availableAirlines = Array.from(new Set(packagesList.map(p => p.airline).filter(Boolean)));
  const availablePeriods = Array.from(new Set(packagesList.map(p => formatMonthYear(p.departureDate)).filter(Boolean)));

  // Logika Filter
  const filteredPackages = packagesList.filter((pkg) => {
    const matchesSearch = 
      (pkg.name && pkg.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (pkg.code && pkg.code.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (pkg.destinationCity && pkg.destinationCity.toLowerCase().includes(searchTerm.toLowerCase()));

    const pkgPeriod = formatMonthYear(pkg.departureDate);
    const matchesPeriod = !selectedPeriod || pkgPeriod === selectedPeriod;
    const matchesDestination = !selectedDestination || pkg.type === selectedDestination;
    const matchesAirline = !selectedAirline || pkg.airline === selectedAirline;

    return matchesSearch && matchesPeriod && matchesDestination && matchesAirline;
  });

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedPeriod('');
    setSelectedDestination('');
    setSelectedAirline('');
  };

  const isTourOrLA = formData.type === 'Wisata Halal Internasional' || formData.type === 'Land Arrangement (LA) Only';
  const isLAOnly = formData.type === 'Land Arrangement (LA) Only';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Package className="w-5 h-5 text-emerald-500" /> Katalog Paket Travel & LA
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Kelola program keberangkatan, akomodasi, dan harga paket secara adaptif.</p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/10"
        >
          <Plus className="w-4 h-4" /> Buat Paket Baru
        </button>
      </div>

      {/* FILTER BAR */}
      <div className={`${styles.cardBg} p-4 rounded-xl border space-y-3`}>
        <div className={`flex items-center justify-between gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-3`}>
          <span className={`text-xs font-bold ${styles.textTitle} flex items-center gap-1.5`}>
            <Filter className="w-4 h-4 text-emerald-500" /> Filter Data Keberangkatan
          </span>
          {(searchTerm || selectedPeriod || selectedDestination || selectedAirline) && (
            <button onClick={resetFilters} className="text-[11px] text-rose-500 hover:underline flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Reset Filter
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Cari Nama / Kode / Destinasi..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            />
          </div>

          <div className="relative">
            <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            >
              <option value="">-- Semua Periode --</option>
              {availablePeriods.map((period, idx) => (
                <option key={idx} value={period}>{period}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <select
              value={selectedDestination}
              onChange={(e) => setSelectedDestination(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            >
              <option value="">-- Semua Destinasi / Jenis --</option>
              <option value="Umroh Regular">Umroh Regular</option>
              <option value="Umroh VIP / Plus">Umroh VIP / Plus</option>
              <option value="Haji Khusus / Furoda">Haji Khusus / Furoda</option>
              <option value="Wisata Halal Internasional">Wisata Halal Internasional</option>
              <option value="Land Arrangement (LA) Only">Land Arrangement (LA) Only</option>
            </select>
          </div>

          <div className="relative">
            <Plane className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <select
              value={selectedAirline}
              onChange={(e) => setSelectedAirline(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            >
              <option value="">-- Semua Maskapai --</option>
              {availableAirlines.map((airline, idx) => (
                <option key={idx} value={airline}>{airline}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* TABEL DATA PAKET */}
      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`${styles.tableHeaderBg} uppercase tracking-wider border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <tr>
                <th className="p-4">Kode & Nama Paket</th>
                <th className="p-4">Jenis & Maskapai</th>
                <th className="p-4">Tgl Keberangkatan</th>
                <th className="p-4">Akomodasi / Destinasi</th>
                <th className="p-4">Harga Utama / Pax</th>
                <th className="p-4 text-center">Sisa Seat</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {loading ? (
                <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Memuat katalog paket...</td></tr>
              ) : filteredPackages.length === 0 ? (
                <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Tidak ada paket yang sesuai dengan filter pencarian.</td></tr>
              ) : (
                filteredPackages.map((pkg) => {
                  const isTourPkg = pkg.type === 'Wisata Halal Internasional' || pkg.type === 'Land Arrangement (LA) Only';
                  
                  const bookedSeatsCount = bookingsList.filter(
                    b => b.packageId === pkg.id || b.packageName === pkg.name
                  ).length;

                  const totalQuota = Number(pkg.quotaTotal) || 0;
                  const remainingQuota = Math.max(0, totalQuota - bookedSeatsCount);

                  return (
                    <tr key={pkg.id} className={`${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'} transition-colors`}>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>
                        {pkg.name}
                        <span className="block text-[10px] text-emerald-500 font-mono">{pkg.code} • {pkg.durationDays || '9 Hari'}</span>
                      </td>
                      <td className="p-4">
                        <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] block w-fit mb-1 font-medium`}>{pkg.type}</span>
                        <span className={`${styles.textSub} text-[11px] flex items-center gap-1`}>
                          <Plane className="w-3 h-3 text-blue-500" /> {pkg.airline || '-'}
                        </span>
                      </td>
                      <td className={`p-4 font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        {formatDateDDMMYYYY(pkg.departureDate)}
                      </td>
                      <td className={`p-4 ${styles.textSub} text-[11px]`}>
                        {isTourPkg ? (
                          <>
                            <div>Destinasi: <span className={`${styles.textTitle} font-medium`}>{pkg.destinationCity || '-'}</span></div>
                            <div>Fasilitas: <span className={styles.textTitle}>{pkg.hotelTour || pkg.laScope || '-'}</span></div>
                          </>
                        ) : (
                          <>
                            <div>Makkah: <span className={styles.textTitle}>{pkg.hotelMakkah || '-'}</span></div>
                            <div>Madinah: <span className={styles.textTitle}>{pkg.hotelMadinah || '-'}</span></div>
                          </>
                        )}
                      </td>
                      <td className="p-4 font-bold text-emerald-500">
                        Rp {(pkg.priceMain || pkg.priceQuad) ? Number(pkg.priceMain || pkg.priceQuad).toLocaleString('id-ID') : '0'}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap inline-block ${
                          remainingQuota > 5 
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                            : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                        }`}>
                          {remainingQuota} / {totalQuota}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleOpenEdit(pkg)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                            title="Edit Paket"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(pkg)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                            title="Hapus Paket"
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

      {/* MODAL ADAPTIF */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <Package className="w-5 h-5 text-emerald-500" /> {editingPackageId ? 'Edit Program Paket' : 'Buat Program Paket Baru'}
            </h3>

            <form onSubmit={handleSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Kode Paket</label>
                  <input
                    type="text" required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 font-mono`}
                    value={formData.code}
                    onChange={e => setFormData({ ...formData, code: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Jenis / Kategori Program</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 font-semibold text-emerald-500`}
                    value={formData.type}
                    onChange={e => setFormData({ ...formData, type: e.target.value })}
                  >
                    <option value="Umroh Regular">Umroh Regular</option>
                    <option value="Umroh VIP / Plus">Umroh VIP / Plus</option>
                    <option value="Haji Khusus / Furoda">Haji Khusus / Furoda</option>
                    <option value="Wisata Halal Internasional">Wisata Halal Internasional</option>
                    <option value="Land Arrangement (LA) Only">Land Arrangement (LA) Only</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nama Program Paket</label>
                <input
                  type="text" required 
                  placeholder={isTourOrLA ? "Contoh: Korea School Holiday 30 Juni - 06 Juli 2027" : "Contoh: Umroh Regular 9D Januari 2027"}
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block mb-1 font-medium">Tgl Keberangkatan</label>
                  <input
                    type="date" required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 [color-scheme:${theme}]`}
                    value={formData.departureDate}
                    onChange={e => setFormData({ ...formData, departureDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Durasi Program</label>
                  <input
                    type="text" placeholder="7 Hari / 9 Hari"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.durationDays}
                    onChange={e => setFormData({ ...formData, durationDays: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Total Kuota Seat</label>
                  <input
                    type="number" required placeholder="30"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.quotaTotal}
                    onChange={e => setFormData({ ...formData, quotaTotal: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Maskapai Penerbangan / Transportasi</label>
                <input
                  type="text" placeholder="Garuda Indonesia / Korean Air / Land Transport"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={formData.airline}
                  onChange={e => setFormData({ ...formData, airline: e.target.value })}
                />
              </div>

              {/* DYNAMIC FIELD */}
              {isTourOrLA ? (
                <div className={`grid grid-cols-2 gap-4 ${styles.innerBg} p-3 rounded-xl border`}>
                  <div>
                    <label className="block mb-1 font-medium text-emerald-500">Destinasi / Kota Tujuan</label>
                    <input
                      type="text" placeholder="Contoh: Korea Selatan (Seoul & Nami)"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={formData.destinationCity}
                      onChange={e => setFormData({ ...formData, destinationCity: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium text-emerald-500">
                      {isLAOnly ? "Cakupan Layanan LA" : "Akomodasi Hotel Tour"}
                    </label>
                    <input
                      type="text" placeholder={isLAOnly ? "Bus, Visa, Handling, Guide" : "Hotel Bintang 4 / Setaraf"}
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={isLAOnly ? formData.laScope : formData.hotelTour}
                      onChange={e => isLAOnly 
                        ? setFormData({ ...formData, laScope: e.target.value })
                        : setFormData({ ...formData, hotelTour: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1 font-medium">Hotel Makkah</label>
                    <input
                      type="text" placeholder="Pullman Zamzam / Setaraf"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={formData.hotelMakkah}
                      onChange={e => setFormData({ ...formData, hotelMakkah: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Hotel Madinah</label>
                    <input
                      type="text" placeholder="Front Taiba / Setaraf"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={formData.hotelMadinah}
                      onChange={e => setFormData({ ...formData, hotelMadinah: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* DYNAMIC HARGA */}
              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">
                  Harga Paket per Pax (Rp)
                </p>
                {isTourOrLA ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block mb-1 font-medium">Harga Utama / Dewasa</label>
                      <input
                        type="number" required placeholder="25000000"
                        className={`w-full ${styles.inputBg} rounded-lg p-2 font-bold`}
                        value={formData.priceMain}
                        onChange={e => setFormData({ ...formData, priceMain: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Harga Anak (Child)</label>
                      <input
                        type="number" placeholder="22000000 (Opsional)"
                        className={`w-full ${styles.inputBg} rounded-lg p-2`}
                        value={formData.priceChild}
                        onChange={e => setFormData({ ...formData, priceChild: e.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block mb-1 font-medium">Harga Quad (4 Orang)</label>
                      <input
                        type="number" required placeholder="29900000"
                        className={`w-full ${styles.inputBg} rounded-lg p-2`}
                        value={formData.priceMain}
                        onChange={e => setFormData({ ...formData, priceMain: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Harga Triple (3 Orang)</label>
                      <input
                        type="number" placeholder="31500000"
                        className={`w-full ${styles.inputBg} rounded-lg p-2`}
                        value={formData.priceTriple}
                        onChange={e => setFormData({ ...formData, priceTriple: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Harga Double (2 Orang)</label>
                      <input
                        type="number" placeholder="33500000"
                        className={`w-full ${styles.inputBg} rounded-lg p-2`}
                        value={formData.priceDouble}
                        onChange={e => setFormData({ ...formData, priceDouble: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  {editingPackageId ? 'Simpan Perubahan' : 'Terbitkan Paket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
