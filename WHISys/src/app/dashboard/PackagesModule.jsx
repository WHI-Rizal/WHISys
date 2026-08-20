'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { Package, Plus, Search, Calendar, Edit, Trash2, Filter, Plane, MapPin, RefreshCw, X, ListOrdered, ChevronUp, ChevronDown, Printer, MessageSquare, Utensils, BedDouble } from 'lucide-react';
import DateFieldID from '@/components/DateFieldID';

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

export default function PackagesModule({ theme = 'dark', userRole = '' }) {
  const isDark = theme === 'dark';

  // Cuma Super Admin & Operational yang boleh kelola katalog paket (buat,
  // edit, hapus, atur itinerary). Sales & Finance tetap boleh lihat katalog
  // (butuh buat proses booking), tapi nggak boleh ubah data paketnya.
  const roleLower = (userRole || '').toLowerCase();
  const canManagePackages = roleLower.includes('super') || roleLower === 'admin' || roleLower === 'operational';

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

  // State Modal Itinerary
  const [showItineraryModal, setShowItineraryModal] = useState(false);
  const [selectedPackageForItinerary, setSelectedPackageForItinerary] = useState(null);
  const [itineraryDays, setItineraryDays] = useState([]);
  const [savingItinerary, setSavingItinerary] = useState(false);

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

  // Kode paket sekuensial & rapi, pola sama kayak Kode Unik Customer
  // (CST000001) di Data Master Jamaah — biar nggak ada risiko tabrakan
  // kode kayak format lama yang diambil dari 4 digit terakhir timestamp.
  const getNextPackageCode = () => {
    let maxNum = 0;

    packagesList.forEach((p) => {
      if (p.code && p.code.startsWith('PKG-')) {
        const numPart = parseInt(p.code.replace('PKG-', ''), 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    });

    const nextNum = maxNum + 1;
    const padded = String(nextNum).padStart(6, '0');
    return `PKG-${padded}`;
  };

  const handleOpenAdd = () => {
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh menambah paket.");
      return;
    }
    setEditingPackageId(null);
    setFormData({
      code: getNextPackageCode(),
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
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh mengedit paket.");
      return;
    }
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
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh menghapus paket.");
      return;
    }
    try {
      const bookingQ = query(collection(db, 'bookings'), where('packageId', '==', pkg.id));
      const bookingSnap = await getDocs(bookingQ);

      if (!bookingSnap.empty) {
        alert(`Paket "${pkg.name}" tidak dapat dihapus karena masih memiliki ${bookingSnap.size} data booking jamaah.\n\nSilakan pindahkan/hapus dulu booking-nya di menu Booking & Manifest sebelum menghapus paket ini.`);
        return;
      }

      // Cek biaya vendor terkait paket ini. Collection ini cuma boleh dibaca
      // Finance & Super Admin (aturan modul Keuangan) — kalau yang hapus
      // paket adalah Operational, query ini bakal ditolak Firestore Rules.
      // Itu wajar (bukan bug), jadi kita lewatin pengecekan ini khusus buat
      // role yang memang nggak punya akses ke data Keuangan.
      try {
        const vendorQ = query(collection(db, 'payments_vendor'), where('packageId', '==', pkg.id));
        const vendorSnap = await getDocs(vendorQ);

        if (!vendorSnap.empty) {
          alert(`Paket "${pkg.name}" tidak dapat dihapus karena masih memiliki ${vendorSnap.size} riwayat biaya vendor tercatat di modul Keuangan.\n\nSilakan hapus dulu biaya vendor terkait paket ini di menu Keuangan sebelum menghapus paketnya.`);
          return;
        }
      } catch (vendorErr) {
        if (vendorErr.code !== 'permission-denied') throw vendorErr;
        // Role ini nggak punya akses baca data Keuangan — lanjut ke
        // pengecekan booking di atas sebagai pengaman utama.
      }

      if (!confirm(`Apakah Anda yakin ingin menghapus paket "${pkg.name}"?`)) return;

      await deleteDoc(doc(db, 'packages', pkg.id));
      fetchData();
    } catch (err) {
      alert("Gagal menghapus paket: " + err.message);
    }
  };

  // ============ ITINERARY PAKET ============

  const handleOpenItinerary = (pkg) => {
    setSelectedPackageForItinerary(pkg);
    const existing = Array.isArray(pkg.itinerary) ? pkg.itinerary : [];
    setItineraryDays(existing.length > 0 ? existing : [
      { title: '', description: '', meals: '', hotel: '' }
    ]);
    setShowItineraryModal(true);
  };

  const handleAddDay = () => {
    setItineraryDays(prev => [...prev, { title: '', description: '', meals: '', hotel: '' }]);
  };

  const handleRemoveDay = (idx) => {
    setItineraryDays(prev => prev.filter((_, i) => i !== idx));
  };

  const handleMoveDay = (idx, direction) => {
    setItineraryDays(prev => {
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const updated = [...prev];
      [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
      return updated;
    });
  };

  const handleDayFieldChange = (idx, field, value) => {
    setItineraryDays(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  };

  const handleSaveItinerary = async () => {
    if (!selectedPackageForItinerary) return;
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh mengubah itinerary.");
      return;
    }
    setSavingItinerary(true);
    try {
      await updateDoc(doc(db, 'packages', selectedPackageForItinerary.id), {
        itinerary: itineraryDays,
        updatedAt: new Date().toISOString()
      });
      setShowItineraryModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal menyimpan itinerary: " + err.message);
    }
    setSavingItinerary(false);
  };

  // Format itinerary jadi teks rapi buat dikirim CS/TC ke customer via WhatsApp
  const buildItineraryText = (pkg, days) => {
    const header = `*ITINERARY PERJALANAN*\n*${pkg.name}*\n${pkg.code} • ${pkg.durationDays || '-'} • Berangkat ${formatDateDDMMYYYY(pkg.departureDate)}\n--------------------------------------------------`;
    const body = days.map((d, idx) => {
      const lines = [`\n*Hari ke-${idx + 1}${d.title ? ': ' + d.title : ''}*`];
      if (d.description) lines.push(d.description);
      if (d.hotel) lines.push(`🏨 Hotel: ${d.hotel}`);
      if (d.meals) lines.push(`🍽️ Makan: ${d.meals}`);
      return lines.join('\n');
    }).join('\n');
    return `${header}\n${body}`;
  };

  const handleShareItineraryWA = (pkg, days) => {
    if (!days || days.length === 0 || days.every(d => !d.title && !d.description)) {
      alert("Itinerary paket ini masih kosong. Isi dulu sebelum dibagikan.");
      return;
    }
    const text = buildItineraryText(pkg, days);
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handlePrintItinerary = (pkg, days) => {
    const dayRowsHtml = days.map((d, idx) => `
      <div style="margin-bottom:18px;padding-bottom:14px;border-bottom:1px dashed #e2e8f0;">
        <h3 style="margin:0 0 6px 0;font-size:13px;color:#065f46;">Hari ke-${idx + 1}${d.title ? ' &mdash; ' + d.title : ''}</h3>
        <p style="margin:0 0 6px 0;font-size:12px;color:#334155;white-space:pre-wrap;">${d.description || '-'}</p>
        <div style="font-size:11px;color:#64748b;">
          ${d.hotel ? `🏨 Hotel: <strong>${d.hotel}</strong><br/>` : ''}
          ${d.meals ? `🍽️ Makan: <strong>${d.meals}</strong>` : ''}
        </div>
      </div>
    `).join('');

    const docContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Itinerary - ${pkg.name}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#1e293b; padding:35px; }
            h1 { font-size:20px; color:#065f46; margin-bottom:2px; }
            p.sub { font-size:11px; color:#64748b; margin-top:0; margin-bottom:20px; }
          </style>
        </head>
        <body>
          <h1>Itinerary Perjalanan</h1>
          <p class="sub">${pkg.name} (${pkg.code}) &bull; ${pkg.durationDays || '-'} &bull; Berangkat ${formatDateDDMMYYYY(pkg.departureDate)}</p>
          ${dayRowsHtml || '<p style="color:#94a3b8;">Belum ada itinerary.</p>'}
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh menyimpan data paket.");
      return;
    }
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
        // Kalau Kuota Total diubah, sesuaikan Sisa Kuota dengan selisihnya —
        // supaya jumlah seat yang udah kepake (booking existing) tetap
        // konsisten, bukan malah ke-reset balik penuh.
        const originalPkg = packagesList.find(p => p.id === editingPackageId);
        if (originalPkg) {
          const oldTotal = Number(originalPkg.quotaTotal || 0);
          const oldRemaining = Number(originalPkg.quotaRemaining ?? originalPkg.quotaTotal ?? 0);
          const delta = payload.quotaTotal - oldTotal;
          payload.quotaRemaining = Math.max(0, oldRemaining + delta);
        }
        await updateDoc(doc(db, 'packages', editingPackageId), payload);
      } else {
        // Paket baru: Sisa Kuota harus diisi penuh sama dengan Kuota Total
        // saat dibuat — kalau nggak, field ini kosong (undefined) dan semua
        // booking ke paket ini bakal ditolak sistem karena dianggap 0 seat.
        payload.quotaRemaining = payload.quotaTotal;
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
        {canManagePackages && (
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/10"
          >
            <Plus className="w-4 h-4" /> Buat Paket Baru
          </button>
        )}
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
                            onClick={() => handleOpenItinerary(pkg)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-purple-500 rounded-lg transition-colors relative`}
                            title="Itinerary Perjalanan"
                          >
                            <ListOrdered className="w-4 h-4" />
                            {Array.isArray(pkg.itinerary) && pkg.itinerary.length > 0 && (
                              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-purple-500 text-white text-[8px] rounded-full flex items-center justify-center font-bold">
                                {pkg.itinerary.length}
                              </span>
                            )}
                          </button>
                          {canManagePackages && (
                            <>
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
                    type="text" readOnly required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 font-mono font-bold text-emerald-500 opacity-80 cursor-not-allowed`}
                    value={formData.code}
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
                  <DateFieldID
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    nativeClassName={`[color-scheme:${theme}]`}
                    value={formData.departureDate}
                    onChange={(val) => setFormData({ ...formData, departureDate: val })}
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

      {/* MODAL ITINERARY PERJALANAN */}
      {showItineraryModal && selectedPackageForItinerary && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowItineraryModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <ListOrdered className="w-5 h-5 text-purple-500" /> Itinerary Perjalanan
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              <strong className={styles.textTitle}>{selectedPackageForItinerary.name}</strong> ({selectedPackageForItinerary.code}) &bull; {selectedPackageForItinerary.durationDays || '-'}
              <br />Susun jadwal harian biar CS/TC gampang jelasin ke customer.
            </p>

            <div className="space-y-4 mb-4">
              {itineraryDays.map((d, idx) => (
                <div key={idx} className={`${styles.innerBg} p-4 rounded-xl border space-y-2.5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-500">Hari ke-{idx + 1}</span>
                    {canManagePackages && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleMoveDay(idx, -1)} disabled={idx === 0} className={`p-1 rounded ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'} disabled:opacity-30`} title="Pindah ke atas">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => handleMoveDay(idx, 1)} disabled={idx === itineraryDays.length - 1} className={`p-1 rounded ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'} disabled:opacity-30`} title="Pindah ke bawah">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => handleRemoveDay(idx)} className="p-1 rounded text-rose-500 hover:bg-rose-500/10" title="Hapus hari ini">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <input
                    type="text"
                    placeholder="Judul singkat, cth: Jakarta - Jeddah - Madinah"
                    className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs font-medium disabled:opacity-70`}
                    value={d.title}
                    disabled={!canManagePackages}
                    onChange={e => handleDayFieldChange(idx, 'title', e.target.value)}
                  />
                  <textarea
                    rows={2}
                    placeholder="Rincian kegiatan hari ini..."
                    className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs disabled:opacity-70`}
                    value={d.description}
                    disabled={!canManagePackages}
                    onChange={e => handleDayFieldChange(idx, 'description', e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="relative">
                      <BedDouble className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder="Hotel (opsional)"
                        className={`w-full ${styles.inputBg} rounded-lg pl-8 pr-2 py-2 text-xs disabled:opacity-70`}
                        value={d.hotel}
                        disabled={!canManagePackages}
                        onChange={e => handleDayFieldChange(idx, 'hotel', e.target.value)}
                      />
                    </div>
                    <div className="relative">
                      <Utensils className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder="Makan (opsional)"
                        className={`w-full ${styles.inputBg} rounded-lg pl-8 pr-2 py-2 text-xs disabled:opacity-70`}
                        value={d.meals}
                        disabled={!canManagePackages}
                        onChange={e => handleDayFieldChange(idx, 'meals', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {canManagePackages && (
              <button
                type="button"
                onClick={handleAddDay}
                className={`w-full flex items-center justify-center gap-1.5 py-2.5 mb-5 border-2 border-dashed ${isDark ? 'border-slate-700 hover:border-purple-500 text-slate-400' : 'border-slate-300 hover:border-purple-500 text-slate-500'} hover:text-purple-500 rounded-xl text-xs font-semibold transition-colors`}
              >
                <Plus className="w-4 h-4" /> Tambah Hari
              </button>
            )}

            <div className={`pt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleShareItineraryWA(selectedPackageForItinerary, itineraryDays)}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-500 hover:text-white rounded-lg text-xs font-medium transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Bagikan WA
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintItinerary(selectedPackageForItinerary, itineraryDays)}
                  className={`flex items-center justify-center gap-1.5 px-3.5 py-2 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} rounded-lg text-xs font-medium transition-colors`}
                >
                  <Printer className="w-3.5 h-3.5" /> Cetak
                </button>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowItineraryModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}>
                  {canManagePackages ? 'Batal' : 'Tutup'}
                </button>
                {canManagePackages && (
                  <button
                    type="button"
                    onClick={handleSaveItinerary}
                    disabled={savingItinerary}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium"
                  >
                    {savingItinerary ? 'Menyimpan...' : 'Simpan Itinerary'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
