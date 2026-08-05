'use client';

import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import { BookOpen, Plus, Search, Calendar, Users, Hotel, Bus, X, CheckCircle, Clock } from 'lucide-react';

export default function BookingsModule() {
  const [bookings, setBookings] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [jamaahList, setJamaahList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Form State
  const [formData, setFormData] = useState({
    packageId: '',
    jamaahId: '',
    roomType: 'Quad',
    busGroup: 'Bus 1',
    paymentStatus: 'DP Paid',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Packages
      const pkgSnap = await getDocs(query(collection(db, 'packages'), orderBy('name', 'asc')));
      const pkgs = pkgSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setPackagesList(pkgs);

      // 2. Fetch Jamaah
      const jmhSnap = await getDocs(query(collection(db, 'jamaah'), orderBy('fullName', 'asc')));
      const jmhs = jmhSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setJamaahList(jmhs);

      // 3. Fetch Bookings
      const bkSnap = await getDocs(query(collection(db, 'bookings'), orderBy('createdAt', 'desc')));
      const bks = bkSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setBookings(bks);
    } catch (err) {
      console.error("Gagal mengambil data booking:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.packageId || !formData.jamaahId) {
      alert("Silakan pilih Paket Travel dan Jamaah.");
      return;
    }

    try {
      const selectedPkg = packagesList.find(p => p.id === formData.packageId);
      const selectedJamaah = jamaahList.find(j => j.id === formData.jamaahId);

      if (selectedPkg.quotaRemaining <= 0) {
        alert("Kuota paket ini sudah habis!");
        return;
      }

      // Hitung Total Tagihan Berdasarkan Tipe Kamar
      let price = selectedPkg.priceQuad || 0;
      if (formData.roomType === 'Triple') price = selectedPkg.priceTriple || price;
      if (formData.roomType === 'Double') price = selectedPkg.priceDouble || price;

      const bookingCode = `BK-${Date.now().toString().slice(-6)}`;

      // 1. Simpan Ke Collection Bookings
      await addDoc(collection(db, 'bookings'), {
        bookingCode,
        packageId: selectedPkg.id,
        packageName: selectedPkg.name,
        packageCode: selectedPkg.code,
        departureDate: selectedPkg.departureDate,
        jamaahId: selectedJamaah.id,
        jamaahName: selectedJamaah.fullName,
        passportNumber: selectedJamaah.passportNumber || '-',
        roomType: formData.roomType,
        busGroup: formData.busGroup,
        totalAmount: price,
        paymentStatus: formData.paymentStatus,
        createdAt: new Date().toISOString()
      });

      // 2. Potong Kuota Package di Firestore
      const pkgRef = doc(db, 'packages', selectedPkg.id);
      await updateDoc(pkgRef, {
        quotaRemaining: Number(selectedPkg.quotaRemaining) - 1
      });

      setShowModal(false);
      setFormData({ packageId: '', jamaahId: '', roomType: 'Quad', busGroup: 'Bus 1', paymentStatus: 'DP Paid' });
      fetchData();
    } catch (err) {
      alert("Gagal memproses booking: " + err.message);
    }
  };

  const filteredBookings = bookings.filter(b => 
    b.jamaahName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.packageName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.bookingCode?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" /> Booking & Manifest Group
          </h3>
          <p className="text-xs text-slate-400 mt-1">Plotting jamaah ke paket keberangkatan, alokasi bus, dan status manifes.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/30"
        >
          <Plus className="w-4 h-4" /> Tambah Booking Baru
        </button>
      </div>

      {/* Filter Search */}
      <div className="flex items-center gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Cari Kode Booking, Nama Jamaah, atau Nama Paket..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 text-slate-200 pl-9 pr-4 py-2 rounded-lg border border-slate-800 text-xs focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Tabel Data Manifest */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-4">Kode / Jamaah</th>
                <th className="p-4">Paket & Keberangkatan</th>
                <th className="p-4">No. Paspor</th>
                <th className="p-4">Kamar & Bus</th>
                <th className="p-4">Total Biaya</th>
                <th className="p-4">Status Pembayaran</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-400">Memuat data manifest...</td>
                </tr>
              ) : filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-400">Belum ada booking terdaftar. Klik 'Tambah Booking Baru' untuk mendaftar.</td>
                </tr>
              ) : (
                filteredBookings.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="p-4 font-semibold text-white">
                      {item.jamaahName}
                      <span className="block text-[10px] text-emerald-400 font-mono">{item.bookingCode}</span>
                    </td>
                    <td className="p-4">
                      {item.packageName}
                      <span className="block text-[10px] text-slate-400">{item.departureDate}</span>
                    </td>
                    <td className="p-4 font-mono">{item.passportNumber}</td>
                    <td className="p-4">
                      <span className="inline-block bg-slate-800 px-2 py-0.5 rounded text-[10px] mr-1">{item.roomType}</span>
                      <span className="inline-block bg-slate-800 px-2 py-0.5 rounded text-[10px]">{item.busGroup}</span>
                    </td>
                    <td className="p-4 font-bold text-slate-100">
                      Rp {item.totalAmount?.toLocaleString('id-ID')}
                    </td>
                    <td className="p-4">
                      {item.paymentStatus === 'Full Payment' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-semibold">
                          <CheckCircle className="w-3 h-3" /> Lunas
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-semibold">
                          <Clock className="w-3 h-3" /> DP / Cicilan
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Form Tambah Booking */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 relative">
            <button onClick={() => setShowModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-400" /> Registrasi Booking Jamaah
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs text-slate-300">
              <div>
                <label className="block mb-1 font-medium">Pilih Paket Travel</label>
                <select
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={formData.packageId}
                  onChange={e => setFormData({ ...formData, packageId: e.target.value })}
                >
                  <option value="">-- Pilih Program Keberangkatan --</option>
                  {packagesList.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code}) - Sisa Seat: {p.quotaRemaining}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1 font-medium">Pilih Jamaah</label>
                <select
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={formData.jamaahId}
                  onChange={e => setFormData({ ...formData, jamaahId: e.target.value })}
                >
                  <option value="">-- Pilih Data Master Jamaah --</option>
                  {jamaahList.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.fullName} - Paspor: {j.passportNumber || 'Belum Ada'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tipe Kamar</label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.busGroup}
                    onChange={e => setFormData({ ...formData, busGroup: e.target.value })}
                  >
                    <option value="Bus 1">Bus 1</option>
                    <option value="Bus 2">Bus 2</option>
                    <option value="Bus 3">Bus 3</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Status Pembayaran Awal</label>
                <select
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={formData.paymentStatus}
                  onChange={e => setFormData({ ...formData, paymentStatus: e.target.value })}
                >
                  <option value="DP Paid">DP Paid (Uang Muka)</option>
                  <option value="Full Payment">Full Payment (Lunas)</option>
                </select>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  Proses Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
