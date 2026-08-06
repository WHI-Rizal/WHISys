'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { Plane, Plus, Search, Calendar, Users, Hotel, DollarSign, Trash2, X, MapPin } from 'lucide-react';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

export default function PackagesModule() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Form State
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    category: 'Umrah Reguler', // Umrah Reguler, Umrah Plus, Haji Furoda, Wisata Halal
    departureDate: '',
    airline: '',
    quotaTotal: '',
    // Field Khusus Umrah & Haji
    hotelMakkah: '',
    hotelMadinah: '',
    priceQuad: '',
    priceTriple: '',
    priceDouble: '',
    // Field Khusus Wisata Halal
    destination: '',
    hotelMain: '',
    priceMain: '',
    priceSingleSupp: '',
  });

  const fetchPackages = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'packages'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const list = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setPackages(list);
    } catch (err) {
      console.error("Gagal memuat paket:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPackages();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const isWisataHalal = formData.category === 'Wisata Halal';
      
      const payload = {
        code: formData.code,
        name: formData.name,
        category: formData.category,
        departureDate: formData.departureDate,
        airline: formData.airline,
        quotaTotal: Number(formData.quotaTotal),
        quotaRemaining: Number(formData.quotaTotal),
        createdAt: new Date().toISOString()
      };

      if (isWisataHalal) {
        payload.destination = formData.destination;
        payload.hotelMain = formData.hotelMain;
        payload.priceMain = Number(formData.priceMain);
        payload.priceSingleSupp = Number(formData.priceSingleSupp || 0);
      } else {
        payload.hotelMakkah = formData.hotelMakkah;
        payload.hotelMadinah = formData.hotelMadinah;
        payload.priceQuad = Number(formData.priceQuad);
        payload.priceTriple = Number(formData.priceTriple || 0);
        payload.priceDouble = Number(formData.priceDouble || 0);
      }

      await addDoc(collection(db, 'packages'), payload);
      setShowModal(false);
      resetForm();
      fetchPackages();
    } catch (err) {
      alert("Gagal menambah paket: " + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (confirm("Apakah Anda yakin ingin menghapus paket travel ini?")) {
      try {
        await deleteDoc(doc(db, 'packages', id));
        fetchPackages();
      } catch (err) {
        alert("Gagal menghapus: " + err.message);
      }
    }
  };

  const resetForm = () => {
    setFormData({
      code: '', name: '', category: 'Umrah Reguler', departureDate: '', airline: '', quotaTotal: '',
      hotelMakkah: '', hotelMadinah: '', priceQuad: '', priceTriple: '', priceDouble: '',
      destination: '', hotelMain: '', priceMain: '', priceSingleSupp: ''
    });
  };

  const filteredPackages = packages.filter(p => 
    p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.code?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Plane className="w-5 h-5 text-emerald-400" /> Katalog Paket Travel & LA
          </h3>
          <p className="text-xs text-slate-400 mt-1">Kelola program Umrah, Haji Furoda, & Wisata Halal Mancanegara.</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/30"
        >
          <Plus className="w-4 h-4" /> Buat Paket Baru
        </button>
      </div>

      {/* Filter & Search */}
      <div className="flex items-center gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Cari Nama Paket / Kode Program..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 text-slate-200 pl-9 pr-4 py-2 rounded-lg border border-slate-800 text-xs focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Grid Katalog Paket */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full p-12 text-center text-slate-500 text-xs">Memuat katalog paket...</div>
        ) : filteredPackages.length === 0 ? (
          <div className="col-span-full p-12 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
            Belum ada paket travel. Klik 'Buat Paket Baru' untuk membuat program keberangkatan.
          </div>
        ) : (
          filteredPackages.map((item) => (
            <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-slate-700 transition-all">
              <div>
                <div className="flex justify-between items-start mb-3">
                  <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold rounded-full uppercase">
                    {item.category}
                  </span>
                  <button onClick={() => handleDelete(item.id)} className="text-slate-500 hover:text-rose-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <h4 className="font-bold text-white text-base mb-1">{item.name}</h4>
                <p className="text-xs font-mono text-emerald-400 mb-4">{item.code}</p>

                <div className="space-y-2 text-xs text-slate-300 border-t border-slate-800/80 pt-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Keberangkatan: <strong className="text-white">{formatDateDDMMYYYY(item.departureDate)}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Plane className="w-3.5 h-3.5 text-slate-400" />
                    <span>Airlines: <strong className="text-white">{item.airline}</strong></span>
                  </div>

                  {item.category === 'Wisata Halal' ? (
                    <>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>Destinasi: <strong className="text-white">{item.destination || '-'}</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Hotel className="w-3.5 h-3.5 text-slate-400" />
                        <span>Hotel: <strong className="text-white">{item.hotelMain || '-'}</strong></span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Hotel className="w-3.5 h-3.5 text-slate-400" />
                        <span>Hotel: <strong className="text-white">{item.hotelMakkah} / {item.hotelMadinah}</strong></span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block">Harga Mulai</span>
                  <p className="font-bold text-emerald-400 text-sm">
                    Rp {(item.category === 'Wisata Halal' ? item.priceMain : item.priceQuad)?.toLocaleString('id-ID')}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">Sisa Seat</span>
                  <span className="font-bold text-white text-xs">{item.quotaRemaining ?? item.quotaTotal} / {item.quotaTotal}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal Form Buat Program Paket Travel */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Plane className="w-5 h-5 text-emerald-400" /> Buat Program Paket Travel Baru
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Kode Paket</label>
                  <input
                    type="text" required placeholder="Contoh: UMR-VIP-DEC26 atau HAL-TURK-OCT26"
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
                  type="text" required placeholder="Contoh: Wisata Halal Turki 10D / Umrah Akhir Tahun VIP"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tgl Keberangkatan</label>
                  <input
                    type="date" required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white scheme-dark cursor-pointer"
                    value={formData.departureDate} onChange={e => setFormData({ ...formData, departureDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Maskapai Penerbangan</label>
                  <input
                    type="text" required placeholder="Saudi / Turkish / Garuda"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.airline} onChange={e => setFormData({ ...formData, airline: e.target.value })}
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

              {/* DYNAMIC FIELD: JIKA KATEGORI WISATA HALAL */}
              {formData.category === 'Wisata Halal' ? (
                <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-4">
                  <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Konfigurasi Wisata Halal</p>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block mb-1 font-medium">Destinasi / Negara Tujuan</label>
                      <input
                        type="text" required placeholder="Contoh: Turki / Jepang / Balkan"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                        value={formData.destination} onChange={e => setFormData({ ...formData, destination: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Hotel Utama / Bintang</label>
                      <input
                        type="text" required placeholder="Contoh: Hotel Bintang 4/5 Setaraf"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                        value={formData.hotelMain} onChange={e => setFormData({ ...formData, hotelMain: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block mb-1 font-medium">Harga Paket Utama (Twin Sharing)</label>
                      <input
                        type="number" required placeholder="28500000"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                        value={formData.priceMain} onChange={e => setFormData({ ...formData, priceMain: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Single Supplement (Biaya Kamar Sendiri)</label>
                      <input
                        type="number" placeholder="5000000"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                        value={formData.priceSingleSupp} onChange={e => setFormData({ ...formData, priceSingleSupp: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* DYNAMIC FIELD: JIKA KATEGORI UMRAH & HAJI */
                <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-4">
                  <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Akomodasi & Skema Harga Umrah/Haji</p>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block mb-1 font-medium">Hotel Makkah</label>
                      <input
                        type="text" required placeholder="Pullman Zamzam"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                        value={formData.hotelMakkah} onChange={e => setFormData({ ...formData, hotelMakkah: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Hotel Madinah</label>
                      <input
                        type="text" required placeholder="Frontel Al Harithia"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                        value={formData.hotelMadinah} onChange={e => setFormData({ ...formData, hotelMadinah: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block mb-1 font-medium">Harga Quad (4 Orang)</label>
                      <input
                        type="number" required placeholder="32000000"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                        value={formData.priceQuad} onChange={e => setFormData({ ...formData, priceQuad: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Harga Triple (3 Orang)</label>
                      <input
                        type="number" placeholder="34500000"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                        value={formData.priceTriple} onChange={e => setFormData({ ...formData, priceTriple: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Harga Double (2 Orang)</label>
                      <input
                        type="number" placeholder="37000000"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                        value={formData.priceDouble} onChange={e => setFormData({ ...formData, priceDouble: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
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
