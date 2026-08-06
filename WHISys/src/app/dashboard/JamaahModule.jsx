'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { Users, Plus, Search, Edit, Trash2, X, FileText, Calendar } from 'lucide-react';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

export default function JamaahModule() {
  const [jamaahList, setJamaahList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingJamaahId, setEditingJamaahId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [formData, setFormData] = useState({
    fullName: '',
    nik: '',
    gender: 'Laki-laki',
    birthPlace: '',
    birthDate: '',
    phone: '',
    address: '',
    passportNumber: '',
    passportName: '',
    passportExpiry: '',
    passportIssuingOffice: ''
  });

  const fetchJamaah = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'jamaah'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setJamaahList(list);
    } catch (err) {
      console.error("Gagal mengambil data jamaah:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchJamaah();
  }, []);

  const handleOpenAddModal = () => {
    setEditingJamaahId(null);
    resetForm();
    setShowModal(true);
  };

  const handleOpenEditModal = (item) => {
    setEditingJamaahId(item.id);
    setFormData({
      fullName: item.fullName || '',
      nik: item.nik || '',
      gender: item.gender || 'Laki-laki',
      birthPlace: item.birthPlace || '',
      birthDate: item.birthDate || '',
      phone: item.phone || '',
      address: item.address || '',
      passportNumber: item.passportNumber || '',
      passportName: item.passportName || '',
      passportExpiry: item.passportExpiry || '',
      passportIssuingOffice: item.passportIssuingOffice || ''
    });
    setShowModal(true);
  };

  const handleDeleteJamaah = async (id, name) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus data jamaah ${name}?`)) return;
    try {
      await deleteDoc(doc(db, 'jamaah', id));
      fetchJamaah();
    } catch (err) {
      alert("Gagal menghapus jamaah: " + err.message);
    }
  };

  const resetForm = () => {
    setFormData({
      fullName: '', nik: '', gender: 'Laki-laki', birthPlace: '', birthDate: '',
      phone: '', address: '', passportNumber: '', passportName: '', passportExpiry: '', passportIssuingOffice: ''
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingJamaahId) {
        // Update data jamaah eksisting
        await updateDoc(doc(db, 'jamaah', editingJamaahId), {
          ...formData,
          updatedAt: new Date().toISOString()
        });
      } else {
        // Tambah jamaah baru
        await addDoc(collection(db, 'jamaah'), {
          ...formData,
          createdAt: new Date().toISOString()
        });
      }

      setShowModal(false);
      resetForm();
      fetchJamaah();
    } catch (err) {
      alert("Gagal menyimpan data jamaah: " + err.message);
    }
  };

  const filteredJamaah = jamaahList.filter(j =>
    j.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    j.nik?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    j.passportNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" /> Master Data Jamaah
          </h3>
          <p className="text-xs text-slate-400 mt-1">Database identitas KTP, kontak, dan dokumen paspor jamaah.</p>
        </div>
        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/30"
        >
          <Plus className="w-4 h-4" /> Registrasi Jamaah Baru
        </button>
      </div>

      <div className="flex items-center gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Cari Nama Jamaah, NIK, atau Nomor Paspor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 text-slate-200 pl-9 pr-4 py-2 rounded-lg border border-slate-800 text-xs focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-4">Nama & NIK</th>
                <th className="p-4">Gender & Kontak</th>
                <th className="p-4">TTL</th>
                <th className="p-4">Paspor & Nama Paspor</th>
                <th className="p-4">Expired Paspor</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400">Memuat database jamaah...</td></tr>
              ) : filteredJamaah.length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400">Belum ada data jamaah.</td></tr>
              ) : (
                filteredJamaah.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="p-4 font-semibold text-white">
                      {item.fullName}
                      <span className="block text-[10px] text-slate-400 font-mono">NIK: {item.nik || '-'}</span>
                    </td>
                    <td className="p-4">
                      <span className="inline-block bg-slate-800 px-2 py-0.5 rounded text-[10px] mr-1">{item.gender}</span>
                      <span className="block text-[10px] text-slate-400">{item.phone || '-'}</span>
                    </td>
                    <td className="p-4">
                      {item.birthPlace ? `${item.birthPlace}, ` : ''}{formatDateDDMMYYYY(item.birthDate)}
                    </td>
                    <td className="p-4">
  <span className="block font-bold text-white mb-0.5">
    {item.passportName || '-'}
  </span>
  <span className="block font-mono text-[10px] text-emerald-400">
    {item.passportNumber || 'Belum Ada Paspor'}
  </span>
</td>
                    <td className="p-4 text-slate-400">
                      {formatDateDDMMYYYY(item.passportExpiry)}
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleOpenEditModal(item)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg transition-colors"
                          title="Edit Jamaah"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteJamaah(item.id, item.fullName)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-rose-400 rounded-lg transition-colors"
                          title="Hapus Jamaah"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Form Tambah/Edit Jamaah */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-400" /> {editingJamaahId ? 'Edit Data Jamaah' : 'Registrasi Jamaah Baru'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Nama Lengkap (Sesuai KTP)</label>
                  <input
                    type="text" required placeholder="Ahmad Abdullah"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.fullName} onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">NIK (16 Digit)</label>
                  <input
                    type="text" required placeholder="3271234567890001"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.nik} onChange={e => setFormData({ ...formData, nik: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Jenis Kelamin</label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.gender} onChange={e => setFormData({ ...formData, gender: e.target.value })}
                  >
                    <option value="Laki-laki">Laki-laki</option>
                    <option value="Perempuan">Perempuan</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Tempat Lahir</label>
                  <input
                    type="text" placeholder="Jakarta"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.birthPlace} onChange={e => setFormData({ ...formData, birthPlace: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Tanggal Lahir</label>
                  <input
                    type="date"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white cursor-pointer [&::-webkit-calendar-picker-indicator]:brightness-0 [&::-webkit-calendar-picker-indicator]:invert"
                    value={formData.birthDate} onChange={e => setFormData({ ...formData, birthDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">No. Telepon / WhatsApp</label>
                  <input
                    type="text" placeholder="08123456789"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Alamat Tinggal</label>
                  <input
                    type="text" placeholder="Jl. Merdeka No. 10"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
              </div>

              {/* SECTION PASPOR */}
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
                <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Dokumen Paspor (Opsional / Bisa Menyusul)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 font-medium">Nomor Paspor</label>
                    <input
                      type="text" placeholder="X1234567"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono"
                      value={formData.passportNumber} onChange={e => setFormData({ ...formData, passportNumber: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Nama Paspor (3 Kata)</label>
                    <input
                      type="text" placeholder="AHMAD ABDULLAH HASAN"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                      value={formData.passportName} onChange={e => setFormData({ ...formData, passportName: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 font-medium">Tgl Kadaluarsa Paspor</label>
                    <input
                      type="date"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white cursor-pointer [&::-webkit-calendar-picker-indicator]:brightness-0 [&::-webkit-calendar-picker-indicator]:invert"
                      value={formData.passportExpiry} onChange={e => setFormData({ ...formData, passportExpiry: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Kantor Imigrasi Penerbit</label>
                    <input
                      type="text" placeholder="Imigrasi Jakarta Selatan"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                      value={formData.passportIssuingOffice} onChange={e => setFormData({ ...formData, passportIssuingOffice: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  {editingJamaahId ? 'Simpan Perubahan' : 'Simpan Jamaah'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
