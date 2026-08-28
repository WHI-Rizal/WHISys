'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { Users, Plus, Search, Edit, Trash2, X, AlertCircle, UserCheck } from 'lucide-react';
import DateFieldID from '@/components/DateFieldID';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
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

  // 3 tab dalam 1 halaman — biar nggak nambah menu baru di sidebar: Data
  // Jamaah (customer), TC/Sales (Data Master), Komisi TC/Sales (tracking +
  // pembayaran, dihitung dari field closingSourceType/closingCommissionAmount
  // yang diisi pas registrasi booking di modul Booking & Manifest).
  const [activeTab, setActiveTab] = useState('jamaah');

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

  // ============ DATA MASTER TC / SALES ============
  // Perhitungan & pembayaran komisi TC/Sales SENGAJA ditiadakan di sistem
  // (nominal komisi TC bersifat rahasia) — modul ini cuma nyimpen identitas
  // TC/Sales, dipakai buat catetan "Sumber Closing" pas registrasi booking.
  const [tcList, setTcList] = useState([]);
  const [bookingsList, setBookingsList] = useState([]);
  const [tcLoading, setTcLoading] = useState(true);

  const [showTcModal, setShowTcModal] = useState(false);
  const [editingTcId, setEditingTcId] = useState(null);
  const [tcForm, setTcForm] = useState({ name: '', phone: '', notes: '', active: true });

  const fetchTcData = async () => {
    setTcLoading(true);
    try {
      const tcSnap = await getDocs(collection(db, 'tc_sales'));
      setTcList(tcSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const bkSnap = await getDocs(collection(db, 'bookings'));
      setBookingsList(bkSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Gagal mengambil data TC/Sales:', err);
    }
    setTcLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'tc') fetchTcData();
  }, [activeTab]);

  const handleOpenAddTc = () => {
    setEditingTcId(null);
    setTcForm({ name: '', phone: '', notes: '', active: true });
    setShowTcModal(true);
  };
  const handleOpenEditTc = (item) => {
    setEditingTcId(item.id);
    setTcForm({ name: item.name || '', phone: item.phone || '', notes: item.notes || '', active: item.active !== false });
    setShowTcModal(true);
  };
  const handleTcSubmit = async (e) => {
    e.preventDefault();
    if (!tcForm.name.trim()) { alert('Isi nama TC/Sales dulu.'); return; }
    try {
      const payload = { name: tcForm.name.trim(), phone: tcForm.phone || '', notes: tcForm.notes || '', active: !!tcForm.active };
      if (editingTcId) {
        await updateDoc(doc(db, 'tc_sales', editingTcId), payload);
      } else {
        await addDoc(collection(db, 'tc_sales'), { ...payload, createdAt: new Date().toISOString() });
      }
      setShowTcModal(false);
      fetchTcData();
    } catch (err) {
      alert('Gagal menyimpan data TC/Sales: ' + err.message);
    }
  };
  const handleDeleteTc = async (tc) => {
    const hasHistory = bookingsList.some(b => b.closingSourceType === 'tc' && b.closingSourceId === tc.id);
    const msg = hasHistory
      ? `Data TC/Sales "${tc.name}" masih tercatat sebagai Sumber Closing di beberapa pemesanan. Menghapusnya cuma menghilangkan datanya dari daftar (catatan closing lama tetap ada di booking-nya). Lanjutkan?`
      : `Hapus data TC/Sales "${tc.name}"?`;
    if (!confirm(msg)) return;
    try {
      await deleteDoc(doc(db, 'tc_sales', tc.id));
      fetchTcData();
    } catch (err) {
      alert('Gagal menghapus data TC/Sales: ' + err.message);
    }
  };

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

  // FUNGSI RUNNING NUMBER UNIK (AUTO INCREMENT DIMULAI DARI CST002001)
  const getNextCustomerCode = () => {
    let maxNum = 2000; // Base start di angka 2000

    jamaahList.forEach((j) => {
      if (j.customerCode && j.customerCode.startsWith('CST')) {
        const numPart = parseInt(j.customerCode.replace('CST', ''), 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    });

    const nextNum = maxNum + 1;
    const padded = String(nextNum).padStart(6, '0');
    return `CST${padded}`;
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData({
      customerCode: getNextCustomerCode(),
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
      customerCode: item.customerCode || getNextCustomerCode(),
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

  const handleDelete = async (item) => {
    const id = item.id;
    const name = item.fullName;
    try {
      // Jaga-jaga 1: saldo deposit yang belum nol nggak boleh ikut kehapus
      // gitu aja — itu duit customer yang masih "dititipin" di sistem
      // (dicatat via +Tambah Deposit di modul Keuangan). Kalau langsung
      // dihapus, saldonya ilang dari data padahal kewajiban ke customer-nya
      // masih ada.
      if (Number(item.depositBalance || 0) !== 0) {
        const bal = Number(item.depositBalance || 0);
        alert(`Data jamaah "${name || ''}" masih punya saldo deposit ${bal > 0 ? 'sebesar' : 'minus'} Rp ${Math.abs(bal).toLocaleString('id-ID')}.\n\nBeresin dulu saldo depositnya (tarik/pindahkan) lewat menu Keuangan sebelum data jamaah ini dihapus.`);
        return;
      }

      // Cek dobel: berdasarkan jamaahId (cara normal, dia jadi PESERTA
      // booking) DAN berdasarkan nama (jaga-jaga buat data booking lama yang
      // jamaahId-nya sempat nggak sinkron — sama kayak logika fallback yang
      // sudah dipakai di modul Booking buat mencocokkan data jamaah). Dicek
      // juga sebagai ordererId — orang ini bisa aja berperan sebagai
      // "Pemesan" suatu booking/grup tanpa pernah jadi peserta (jamaahId)-nya
      // sendiri, dan booking manapun nyimpen ordererId/ordererName buat
      // atribusi setoran & refund — kalau nggak dicek, booking2 itu bakal
      // nyisa nunjuk ke jamaah yang udah nggak ada.
      const qById = query(collection(db, 'bookings'), where('jamaahId', '==', id));
      const qByOrdererId = query(collection(db, 'bookings'), where('ordererId', '==', id));
      const [byIdSnap, byOrdererIdSnap] = await Promise.all([getDocs(qById), getDocs(qByOrdererId)]);

      let byNameSnap = { empty: true, size: 0, docs: [] };
      if (name) {
        const qByName = query(collection(db, 'bookings'), where('jamaahName', '==', name));
        byNameSnap = await getDocs(qByName);
      }

      const relatedIds = new Set([
        ...byIdSnap.docs.map(d => d.id),
        ...byOrdererIdSnap.docs.map(d => d.id),
        ...byNameSnap.docs.map(d => d.id)
      ]);

      if (relatedIds.size > 0) {
        alert(`Data jamaah "${name || ''}" tidak dapat dihapus karena masih memiliki ${relatedIds.size} data booking di sistem (sebagai peserta dan/atau Pemesan).\n\nSilakan hapus/selesaikan dulu booking-nya di menu Booking & Manifest sebelum menghapus data jamaah ini.`);
        return;
      }

      if (!confirm('Apakah Anda yakin ingin menghapus data jamaah ini?')) return;

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
      <div className={`flex gap-2 ${styles.cardBg} p-2 rounded-xl border w-fit`}>
        <button
          onClick={() => setActiveTab('jamaah')}
          className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 ${activeTab === 'jamaah' ? styles.tabActive || 'bg-emerald-600 text-white' : styles.textSub}`}
        >
          <Users className="w-3.5 h-3.5" /> Data Jamaah
        </button>
        <button
          onClick={() => setActiveTab('tc')}
          className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 ${activeTab === 'tc' ? styles.tabActive || 'bg-emerald-600 text-white' : styles.textSub}`}
        >
          <UserCheck className="w-3.5 h-3.5" /> TC / Sales
        </button>
      </div>

      {activeTab === 'jamaah' && (
      <>
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
                        {item.customerCode || 'CST002001'}
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
                            onClick={() => handleDelete(item)}
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
                  <DateFieldID
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    nativeClassName={`[color-scheme:${theme}]`}
                    value={formData.passportExpiry}
                    onChange={(val) => setFormData({ ...formData, passportExpiry: val })}
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
      </>
      )}

      {activeTab === 'tc' && (
      <>
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <UserCheck className="w-5 h-5 text-emerald-500" /> Data Master TC / Sales
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Daftar TC/CS internal yang handel closing customer — dipakai buat catetan "Sumber Closing" pas registrasi booking.</p>
        </div>
        <button
          onClick={handleOpenAddTc}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg"
        >
          <Plus className="w-4 h-4" /> Tambah TC / Sales
        </button>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`${styles.tableHeaderBg} uppercase tracking-wider border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <tr>
                <th className="p-4">Nama</th>
                <th className="p-4">Kontak</th>
                <th className="p-4">Catatan</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {tcLoading ? (
                <tr><td colSpan="5" className={`p-8 text-center ${styles.textSub}`}>Memuat data TC/Sales...</td></tr>
              ) : tcList.length === 0 ? (
                <tr><td colSpan="5" className={`p-8 text-center ${styles.textSub}`}>Belum ada data TC/Sales.</td></tr>
              ) : (
                tcList.map(tc => (
                  <tr key={tc.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                    <td className={`p-4 font-semibold ${styles.textTitle}`}>{tc.name}</td>
                    <td className={`p-4 ${styles.textSub}`}>{tc.phone || '-'}</td>
                    <td className={`p-4 ${styles.textSub}`}>{tc.notes || '-'}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tc.active !== false ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-500/10 text-slate-400'}`}>
                        {tc.active !== false ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => handleOpenEditTc(tc)} className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg`} title="Edit">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteTc(tc)} className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg`} title="Hapus">
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

      {showTcModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
            <button onClick={() => setShowTcModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <UserCheck className="w-5 h-5 text-emerald-500" /> {editingTcId ? 'Edit TC / Sales' : 'Tambah TC / Sales'}
            </h3>
            <form onSubmit={handleTcSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Nama TC / Sales</label>
                <input
                  type="text" required placeholder="Contoh: Rina"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={tcForm.name}
                  onChange={e => setTcForm({ ...tcForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block mb-1 font-medium">No. Telepon / WhatsApp</label>
                <input
                  type="text" placeholder="08123456789"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={tcForm.phone}
                  onChange={e => setTcForm({ ...tcForm, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="block mb-1 font-medium">Catatan</label>
                <input
                  type="text" placeholder="Opsional"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={tcForm.notes}
                  onChange={e => setTcForm({ ...tcForm, notes: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={tcForm.active} onChange={e => setTcForm({ ...tcForm, active: e.target.checked })} />
                Aktif (muncul di dropdown Sumber Closing)
              </label>
              <div className={`pt-3 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowTcModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>Batal</button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">{editingTcId ? 'Simpan Perubahan' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      </>
      )}

    </div>
  );
}
