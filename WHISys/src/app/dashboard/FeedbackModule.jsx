'use client';

import React, { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { Star, MessageSquareHeart, Plus, X, Trash2, User, Bot, Search, Filter } from 'lucide-react';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '-';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

function StarPicker({ value, onChange, size = 'w-6 h-6' }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          onClick={() => onChange(n)}
          className="transition-transform hover:scale-110"
        >
          <Star className={`${size} ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-500'}`} />
        </button>
      ))}
    </div>
  );
}

function StarDisplay({ value, size = 'w-3.5 h-3.5' }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`${size} ${n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
      ))}
    </div>
  );
}

export default function FeedbackModule({ theme = 'dark' }) {
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

  const [feedbackList, setFeedbackList] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [jamaahList, setJamaahList] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterPackageId, setFilterPackageId] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({ packageId: '', jamaahName: '', rating: 5, comment: '' });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const fbSnap = await getDocs(query(collection(db, 'feedback'), orderBy('createdAt', 'desc')));
      setFeedbackList(fbSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const pkgSnap = await getDocs(collection(db, 'packages'));
      setPackagesList(pkgSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const jmhSnap = await getDocs(collection(db, 'jamaah'));
      setJamaahList(jmhSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Gagal mengambil data feedback:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenAdd = () => {
    setForm({ packageId: '', jamaahName: '', rating: 5, comment: '' });
    setShowAddModal(true);
  };

  const handleSubmitManual = async (e) => {
    e.preventDefault();
    if (!form.jamaahName.trim()) {
      alert('Isi nama jamaah.');
      return;
    }
    setSaving(true);
    try {
      const pkg = packagesList.find(p => p.id === form.packageId);
      await addDoc(collection(db, 'feedback'), {
        packageId: form.packageId || null,
        packageName: pkg?.name || 'Umum / Tidak Terkait Paket',
        bookingCode: null,
        jamaahName: form.jamaahName.trim(),
        rating: form.rating,
        comment: form.comment.trim(),
        source: 'staff',
        submittedByStaff: auth.currentUser?.email || 'Staff',
        createdAt: new Date().toISOString()
      });
      setShowAddModal(false);
      fetchData();
    } catch (err) {
      alert('Gagal menyimpan feedback: ' + err.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Hapus feedback ini?')) return;
    try {
      await deleteDoc(doc(db, 'feedback', id));
      fetchData();
    } catch (err) {
      alert('Gagal menghapus: ' + err.message);
    }
  };

  const filteredFeedback = feedbackList.filter(f => {
    const matchesSearch =
      (f.jamaahName && f.jamaahName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (f.packageName && f.packageName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (f.comment && f.comment.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesPackage = !filterPackageId || f.packageId === filterPackageId;
    return matchesSearch && matchesPackage;
  });

  const totalFeedback = feedbackList.length;
  const avgRating = totalFeedback > 0
    ? (feedbackList.reduce((acc, f) => acc + (Number(f.rating) || 0), 0) / totalFeedback)
    : 0;
  const selfCount = feedbackList.filter(f => f.source === 'self').length;
  const staffCount = feedbackList.filter(f => f.source === 'staff').length;

  // Ringkasan rata-rata rating per paket, diurutkan dari yang paling rendah
  // (biar paket/vendor yang bermasalah kelihatan duluan)
  const packageSummary = Object.values(
    feedbackList.reduce((acc, f) => {
      const key = f.packageId || f.packageName;
      if (!acc[key]) acc[key] = { packageName: f.packageName, total: 0, count: 0 };
      acc[key].total += Number(f.rating) || 0;
      acc[key].count += 1;
      return acc;
    }, {})
  ).map(p => ({ ...p, avg: p.total / p.count })).sort((a, b) => a.avg - b.avg);

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <MessageSquareHeart className="w-5 h-5 text-amber-500" /> Feedback & Ulasan Jamaah
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Kumpulan ulasan pasca-trip dari jamaah langsung maupun catatan staf, buat evaluasi vendor & kualitas layanan.</p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg"
        >
          <Plus className="w-4 h-4" /> Tambah Feedback Manual
        </button>
      </div>

      {/* RINGKASAN */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className={`${styles.cardBg} p-4 rounded-xl border`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Total Feedback Masuk</p>
          <h4 className={`text-2xl font-bold ${styles.textTitle}`}>{totalFeedback}</h4>
        </div>
        <div className={`${styles.cardBg} p-4 rounded-xl border`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Rata-rata Rating</p>
          <div className="flex items-center gap-2">
            <h4 className="text-2xl font-bold text-amber-500">{avgRating.toFixed(1)}</h4>
            <StarDisplay value={avgRating} />
          </div>
        </div>
        <div className={`${styles.cardBg} p-4 rounded-xl border`}>
          <p className={`text-xs ${styles.textSub} mb-1 flex items-center gap-1`}><User className="w-3 h-3" /> Dari Jamaah Langsung</p>
          <h4 className="text-2xl font-bold text-emerald-500">{selfCount}</h4>
        </div>
        <div className={`${styles.cardBg} p-4 rounded-xl border`}>
          <p className={`text-xs ${styles.textSub} mb-1 flex items-center gap-1`}><Bot className="w-3 h-3" /> Input Staff</p>
          <h4 className="text-2xl font-bold text-blue-500">{staffCount}</h4>
        </div>
      </div>

      {/* RATING PER PAKET */}
      {packageSummary.length > 0 && (
        <div className={`${styles.cardBg} border rounded-xl p-5`}>
          <h4 className={`text-sm font-bold ${styles.textTitle} mb-3`}>Rata-rata Rating per Paket</h4>
          <div className="space-y-2">
            {packageSummary.map((p, idx) => (
              <div key={idx} className={`flex items-center justify-between p-2.5 rounded-lg ${styles.innerBg} border text-xs`}>
                <span className={styles.textTitle}>{p.packageName}</span>
                <div className="flex items-center gap-2">
                  <StarDisplay value={p.avg} />
                  <span className="font-bold text-amber-500">{p.avg.toFixed(1)}</span>
                  <span className={styles.textSub}>({p.count} ulasan)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FILTER */}
      <div className={`${styles.cardBg} p-4 rounded-xl border flex flex-col sm:flex-row gap-3`}>
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Cari nama jamaah, paket, atau isi komentar..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full ${styles.inputBg} pl-9 pr-4 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
          />
        </div>
        <div className="relative">
          <Filter className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <select
            value={filterPackageId}
            onChange={(e) => setFilterPackageId(e.target.value)}
            className={`w-full sm:w-64 ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
          >
            <option value="">-- Semua Paket --</option>
            {packagesList.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* LIST FEEDBACK */}
      <div className="space-y-3">
        {loading ? (
          <div className={`${styles.cardBg} border rounded-xl p-8 text-center ${styles.textSub} text-xs`}>Memuat feedback...</div>
        ) : filteredFeedback.length === 0 ? (
          <div className={`${styles.cardBg} border rounded-xl p-8 text-center ${styles.textSub} text-xs`}>Belum ada feedback yang masuk.</div>
        ) : (
          filteredFeedback.map((f) => (
            <div key={f.id} className={`${styles.cardBg} border rounded-xl p-4`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`font-semibold text-sm ${styles.textTitle}`}>{f.jamaahName}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                      f.source === 'self'
                        ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                        : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                    }`}>
                      {f.source === 'self' ? '✓ Jamaah Langsung' : `Input Staff${f.submittedByStaff ? ' • ' + f.submittedByStaff : ''}`}
                    </span>
                  </div>
                  <p className={`text-[11px] ${styles.textSub} mb-2`}>{f.packageName || '-'} {f.bookingCode ? `• ${f.bookingCode}` : ''} • {formatDateDDMMYYYY(f.createdAt)}</p>
                  <StarDisplay value={f.rating} />
                  {f.comment && <p className={`text-xs ${styles.textSub} mt-2 leading-relaxed`}>{f.comment}</p>}
                </div>
                <button
                  onClick={() => handleDelete(f.id)}
                  className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                  title="Hapus Feedback"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL TAMBAH FEEDBACK MANUAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowAddModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <MessageSquareHeart className="w-5 h-5 text-amber-500" /> Tambah Feedback Manual
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>Buat catatan feedback yang didapat dari WA/telpon/ketemu langsung dengan jamaah.</p>

            <form onSubmit={handleSubmitManual} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Nama Jamaah</label>
                <input
                  type="text" required
                  list="feedback-jamaah-suggestions"
                  placeholder="Nama lengkap jamaah"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={form.jamaahName}
                  onChange={e => setForm({ ...form, jamaahName: e.target.value })}
                />
                <datalist id="feedback-jamaah-suggestions">
                  {jamaahList.map(j => <option key={j.id} value={j.fullName} />)}
                </datalist>
              </div>

              <div>
                <label className="block mb-1 font-medium">Paket Terkait (opsional)</label>
                <select
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={form.packageId}
                  onChange={e => setForm({ ...form, packageId: e.target.value })}
                >
                  <option value="">-- Tidak Terkait Paket Tertentu --</option>
                  {packagesList.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1 font-medium">Rating</label>
                <StarPicker value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} />
              </div>

              <div>
                <label className="block mb-1 font-medium">Catatan / Komentar</label>
                <textarea
                  rows={3}
                  placeholder="Rangkuman feedback dari jamaah..."
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={form.comment}
                  onChange={e => setForm({ ...form, comment: e.target.value })}
                />
              </div>

              <div className={`pt-3 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowAddModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white rounded-lg font-medium">
                  {saving ? 'Menyimpan...' : 'Simpan Feedback'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
