'use client';

import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, addDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { Plus, Plane, Hotel, Calendar, Users, X } from 'lucide-react';

export default function PackagesModule() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    category: 'Umrah Reguler',
    departureDate: '',
    airline: '',
    hotelMakkah: '',
    hotelMadinah: '',
    quotaTotal: 45,
    priceQuad: '',
    priceTriple: '',
    priceDouble: '',
  });

  // Fetch Packages dari Firestore
  const fetchPackages = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'packages'), orderBy('departureDate', 'asc'));
      const querySnapshot = await getDocs(q);
      const list = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPackages(list);
    } catch (err) {
      console.error("Error fetching packages:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPackages();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'packages'), {
        ...formData,
        quotaTotal: Number(formData.quotaTotal),
        quotaRemaining: Number(formData.quotaTotal),
        priceQuad: Number(formData.priceQuad),
        priceTriple: Number(formData.priceTriple),
        priceDouble: Number(formData.priceDouble),
        createdAt: new Date().toISOString()
      });
      setShowModal(false);
      setFormData({
        code: '', name: '', category: 'Umrah Reguler', departureDate: '',
        airline: '', hotelMakkah: '', hotelMadinah: '', quotaTotal: 45,
        priceQuad: '', priceTriple: '', priceDouble: ''
      });
      fetchPackages();
    } catch (err) {
      alert("Gagal menyimpan paket: " + err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex justify-between items-center bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Plane className="w-5 h-5 text-emerald-400" /> Katalog Paket Travel & LA
          </h3>
          <p className="text-xs text-slate-400 mt-1">Kelola program keberangkatan, harga, dan alokasi kuota seat.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
        >
          <Plus className="w-4 h-4" /> Tambah Paket Baru
        </button>
      </div>

      {/* Grid Daftar Paket */}
      {loading ? (
        <p className="text-slate-400 text-sm">Memuat data paket...</p>
      ) : packages.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          Belum ada paket travel yang dibuat. Klik tombol di atas untuk membuat paket pertama.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {packages.map((pkg) => (
            <div key={pkg.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-emerald-500/50 transition-all flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded border border-emerald-500/20">
                    {pkg.category}
                  </span>
                  <span className="text-xs font-semibold text-slate-400">{pkg.code}</span>
                </div>
                <h4 className="font-bold text-lg text-white mb-4">{pkg.name}</h4>

                <div className="space-y-2 text-xs text-slate-300 mb-6">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Keberangkatan: <strong>{pkg.departureDate}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Plane className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Maskapai: {pkg.airline}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Hotel className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Makkah: {pkg.hotelMakkah} | Madinah: {pkg.hotelMadinah}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Sisa Kuota: <strong className="text-emerald-400">{pkg.quotaRemaining} / {pkg.quotaTotal} Seat</strong></span>
                  </div>
                </div>
              </div>

              {/* Price Footer */}
              <div className="pt-4 border-t border-slate-800 flex justify-between items-center text-xs">
                <span className="text-slate-400">Harga Quad:</span>
                <span className="text-base font-bold text-emerald-400">
                  Rp {pkg.priceQuad?.toLocaleString('id-ID')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Form Tambah Paket */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4">Buat Program Paket Travel Baru</h3>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Kode Paket</label>
                  <input
                    type="text" required placeholder="Contoh: UMR-VIP-DEC26"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Kategori</label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}
                  >
                    <option value="Umrah Reguler">Umrah Reguler</option>
                    <option value="Umrah Plus">Umrah Plus</option>
                    <option value="Haji Furoda">Haji Furoda</option>
                    <option value="Wisata Halal">Wisata Halal</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nama Paket</label>
                <input
                  type="text" required placeholder="Contoh: Umrah Akhir Tahun 12 Hari VIP"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tanggal Keberangkatan</label>
                  <input
                    type="date" required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.departureDate} onChange={e => setFormData({ ...formData, departureDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Maskapai Penerbangan</label>
                  <input
                    type="text" required placeholder="Saudi Airlines / Garuda"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.airline} onChange={e => setFormData({ ...formData, airline: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Hotel Makkah</label>
                  <input
                    type="text" required placeholder="Pullman Zamzam"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.hotelMakkah} onChange={e => setFormData({ ...formData, hotelMakkah: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Hotel Madinah</label>
                  <input
                    type="text" required placeholder="Frontel Al Harithia"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.hotelMadinah} onChange={e => setFormData({ ...formData, hotelMadinah: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Total Kuota Seat</label>
                  <input
                    type="number" required placeholder="45"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.quotaTotal} onChange={e => setFormData({ ...formData, quotaTotal: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 border-t border-slate-800 pt-3">
                <div>
                  <label className="block mb-1 font-medium">Harga Quad (4 Orang)</label>
                  <input
                    type="number" required placeholder="32000000"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.priceQuad} onChange={e => setFormData({ ...formData, priceQuad: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Harga Triple (3 Orang)</label>
                  <input
                    type="number" required placeholder="34500000"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.priceTriple} onChange={e => setFormData({ ...formData, priceTriple: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Harga Double (2 Orang)</label>
                  <input
                    type="number" required placeholder="37000000"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.priceDouble} onChange={e => setFormData({ ...formData, priceDouble: e.target.value })}
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  Simpan Paket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
