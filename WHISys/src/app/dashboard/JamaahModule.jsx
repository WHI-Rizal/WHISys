'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Users, Plus, Search, Edit, Trash2, X, AlertCircle } from 'lucide-react';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

// Helper Generasi Kode Unik CST
const generateCustomerCode = () => {
  const randomDigits = Math.floor(100000 + Math.random() * 900000);
  return `CST${randomDigits}`;
};

export default function JamaahModule({ theme = 'dark' }) {
  const isDark = theme === 'dark';

  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    tableHeaderBg: isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-slate-100 text-slate-500',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    tableRowBorder: isDark ? 'divide-slate-800/60' : 'divide-slate-200',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
  };

  const [jamaahList, setJamaahList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [formData, setFormData] = useState({
    customerCode: '',
    fullName: '',
    nik: '',
    gender: 'L',
    phone: '',
    passportNumber: '',
    passportExpiry: '',
    address: '',
  });

  const fetchJamaah = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'jamaah'));
      setJamaahList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Gagal mengambil data jamaah:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchJamaah();
  }, []);

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData({
      customerCode: generateCustomerCode(),
      fullName: '',
      nik: '',
      gender: 'L',
      phone: '',
      passportNumber: '',
      passportExpiry: '',
      address: '',
    });
    setShowModal(true);
  };

  const handleOpenEdit = (item) => {
    setEditingId(item.id);
    setFormData({
      customerCode: item.customerCode || generateCustomerCode(),
      fullName: item.fullName || '',
      nik: item.nik || '',
      gender: item.gender || 'L',
      phone: item.phone || '',
      passportNumber: item.passportNumber || '',
      passportExpiry: item.passportExpiry || '',
      address: item.address || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Apakah Anda yakin ingin menghapus data jamaah ini?')) return;
    try {
      await deleteDoc(doc(db, 'jamaah', id));
      fetchJamaah();
    } catch (err) {
      alert('Gagal menghapus jamaah: ' + err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateDoc(doc(db, 'jamaah', editingId), {
          ...formData,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await addDoc(collection(db, 'jamaah'), {
          ...formData,
          createdAt: new Date().toISOString(),
        });
      }
      setShowModal(false);
      fetchJamaah();
    } catch (err) {
      alert('Gagal menyimpan jamaah: ' + err.message);
    }
  };

  const filteredList = jamaahList.filter(
    (j) =>
      (j.customerCode && j.customerCode.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (j.fullName && j.fullName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (j.nik && j.nik.includes(searchTerm)) ||
      (j.passportNumber && j.passportNumber.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Users className="w-5 h-5 text-emerald-500" /> Data Master Jamaah
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Database identitas KTP, kode unik customer, kontak, dan dokumen paspor jamaah.</p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg"
        >
          <Plus className="w-4 h-4" /> Registrasi Jamaah Baru
        </button>
      </div>

      <div className={`${styles.cardBg} p-4 rounded-xl border flex items-center gap-4`}>
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Cari Kode (CST), Nama Jamaah, NIK, atau Nomor Paspor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full ${styles.inputBg} pl-9 pr-4 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
          />
        </div>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`${styles.tableHeaderBg} uppercase tracking-wider border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <tr>
                <th className="p-4">Kode CST</th>
                <th className="p-4">Nama Lengkap & NIK</th>
                <th className="p-4">Gender & Kontak</th>
                <th className="p-4">Paspor & Expiry</th>
                <th className="p-4">Alamat</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {loading ? (
                <tr>
                  <td colSpan="6" className={`p-8 text-center ${styles.textSub}`}>Memuat data jamaah...</td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan="6" className={`p-8 text-center ${styles.textSub}`}>Belum ada data jamaah.</td>
                </tr>
              ) : (
                filteredList.map((item) => {
                  const isExpiringSoon = item.passportExpiry && new Date(item.passportExpiry) < new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
                  return (
                    <tr key={item.id} className={`${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'} transition-colors`}>
                      <td className="p-4 font-mono font-bold text-emerald-500">
                        {item.customerCode || 'CST-000000'}
                      </td>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>
                        {item.fullName}
                        <span className={`block text-[10px] ${styles.textSub} font-mono`}>NIK: {item.nik || '-'}</span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-block ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] mr-2 font-bold`}>
                          {item.gender === 'L' ? 'Laki-Laki' : 'Perempuan'}
                        </span>
                        <span className={styles.textSub}>{item.phone || '-'}</span>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-emerald-500 font-mono block">{item.passportNumber || 'Belum Ada'}</span>
                        {item.passportExpiry && (
                          <span className={`text-[10px] flex items-center gap-1 ${isExpiringSoon ? 'text-amber-500 font-bold' : styles.textSub}`}>
                            {isExpiringSoon && <AlertCircle className="w-3 h-3" />}
                            Exp: {formatDateDDMMYYYY(item.passportExpiry)}
                          </span>
                        )}
                      </td>
                      <td className={`p-4 ${styles.textSub}`}>{item.address || '-'}</td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleOpenEdit(item)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                            title="Edit Data Jamaah"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                            title="Hapus Jamaah"
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

      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative`}>
            <button onClick={() => setShowModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <Users className="w-5 h-5 text-emerald-500" /> {editingId ? 'Edit Data Jamaah' : 'Registrasi Jamaah Baru'}
            </h3>

            <form onSubmit={handleSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Kode Unik Customer</label>
                  <input
                    type="text" readOnly required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 font-mono font-bold text-emerald-500 opacity-80 cursor-not-allowed`}
                    value={formData.customerCode}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">NIK (KTP)</label>
                  <input
                    type="text"
                    placeholder="32010..."
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 font-mono`}
                    value={formData.nik}
                    onChange={(e) => setFormData({ ...formData, nik: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nama Lengkap (sesuai KTP/Paspor)</label>
                <input
                  type="text" required placeholder="Contoh: Ibrahim Khalil"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Jenis Kelamin</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  >
                    <option value="L">Laki-Laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">No. Telepon / WhatsApp</label>
                  <input
                    type="text" required placeholder="08123456789"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Nomor Paspor</label>
                  <input
                    type="text" placeholder="X1234567"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 font-mono`}
                    value={formData.passportNumber}
                    onChange={(e) => setFormData({ ...formData, passportNumber: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Tanggal Expired Paspor</label>
                  <input
                    type="date"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 [color-scheme:${theme}]`}
                    value={formData.passportExpiry}
                    onChange={(e) => setFormData({ ...formData, passportExpiry: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Alamat Tempat Tinggal</label>
                <textarea
                  rows="2" placeholder="Jl. Raya Utama No. 12..."
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                ></textarea>
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  {editingId ? 'Simpan Perubahan' : 'Simpan Jamaah'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
