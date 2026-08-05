'use client';

import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, addDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { Users, Plus, Search, AlertTriangle, CheckCircle, X, ShieldAlert, FileText } from 'lucide-react';

export default function JamaahModule() {
  const [jamaahList, setJamaahList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Form State Jamaah
  const [formData, setFormData] = useState({
    nik: '',
    fullName: '',
    passportName: '',
    passportNumber: '',
    passportExpiry: '',
    phone: '',
    gender: 'L',
    vaccineStatus: 'Belum Vaksin',
  });

  const fetchJamaah = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'jamaah'), orderBy('fullName', 'asc'));
      const querySnapshot = await getDocs(q);
      const list = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setJamaahList(list);
    } catch (err) {
      console.error("Error fetching jamaah:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchJamaah();
  }, []);

  // Helper Cek Masa Berlaku Paspor < 6 Bulan dari Hari Ini
  const isPassportExpiringSoon = (expiryDateStr) => {
    if (!expiryDateStr) return false;
    const expiryDate = new Date(expiryDateStr);
    const today = new Date();
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(today.getMonth() + 6);
    return expiryDate < sixMonthsFromNow;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'jamaah'), {
        ...formData,
        createdAt: new Date().toISOString()
      });
      setShowModal(false);
      setFormData({
        nik: '', fullName: '', passportName: '', passportNumber: '',
        passportExpiry: '', phone: '', gender: 'L', vaccineStatus: 'Belum Vaksin'
      });
      fetchJamaah();
    } catch (err) {
      alert("Gagal mendaftarkan jamaah: " + err.message);
    }
  };

  const filteredJamaah = jamaahList.filter(j => 
    j.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    j.passportNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    j.nik?.includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" /> Database Master Data Jamaah
          </h3>
          <p className="text-xs text-slate-400 mt-1">Kelola biodata, identitas paspor, & verifikasi kelengkapan dokumen.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/30"
        >
          <Plus className="w-4 h-4" /> Register Jamaah Baru
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex items-center gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Cari Nama Jamaah, Nomor Paspor, atau NIK..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 text-slate-200 pl-9 pr-4 py-2 rounded-lg border border-slate-800 text-xs focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Tabel Data Jamaah */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-4">Nama Lengkap & NIK</th>
                <th className="p-4">Nama Paspor</th>
                <th className="p-4">No. Paspor</th>
                <th className="p-4">Expiry Paspor</th>
                <th className="p-4">No. Telephone</th>
                <th className="p-4">Status Paspor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-400">Memuat data jamaah...</td>
                </tr>
              ) : filteredJamaah.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-400">Belum ada data jamaah. Klik 'Register Jamaah Baru' untuk menambah.</td>
                </tr>
              ) : (
                filteredJamaah.map((item) => {
                  const isExpiring = isPassportExpiringSoon(item.passportExpiry);
                  return (
                    <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-4 font-semibold text-white">
                        {item.fullName}
                        <span className="block text-[10px] text-slate-400 font-normal">NIK: {item.nik || '-'}</span>
                      </td>
                      <td className="p-4">{item.passportName || item.fullName}</td>
                      <td className="p-4 font-mono text-emerald-400">{item.passportNumber || '-'}</td>
                      <td className="p-4 font-medium">{item.passportExpiry || '-'}</td>
                      <td className="p-4">{item.phone || '-'}</td>
                      <td className="p-4">
                        {isExpiring ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5" /> Expired &lt; 6 Bln
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-semibold">
                            <CheckCircle className="w-3.5 h-3.5" /> Valid
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Form Register Jamaah Baru */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-400" /> Registrasi Master Jamaah Baru
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">NIK (KTP)</label>
                  <input
                    type="text" required placeholder="3201..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.nik} onChange={e => setFormData({ ...formData, nik: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Jenis Kelamin</label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.gender} onChange={e => setFormData({ ...formData, gender: e.target.value })}
                  >
                    <option value="L">Laki-Laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nama Lengkap (Sesuai KTP)</label>
                <input
                  type="text" required placeholder="Ahmad Abdullah"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={formData.fullName} onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Nama Paspor (3 Kata)</label>
                  <input
                    type="text" placeholder="Ahmad Abdullah Mansur"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.passportName} onChange={e => setFormData({ ...formData, passportName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Nomor Paspor</label>
                  <input
                    type="text" placeholder="X1234567"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.passportNumber} onChange={e => setFormData({ ...formData, passportNumber: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tanggal Kadaluarsa Paspor</label>
                  <input
                    type="date"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.passportExpiry} onChange={e => setFormData({ ...formData, passportExpiry: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">No. WhatsApp / HP</label>
                  <input
                    type="text" required placeholder="08123456789"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  Simpan Master Data Jamaah
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
