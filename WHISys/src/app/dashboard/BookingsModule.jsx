'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc, query, where } from 'firebase/firestore';
import { BookOpen, Plus, Search, CheckCircle, Clock, X, Edit, Trash2, Wallet, History, Printer } from 'lucide-react';

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

export default function BookingsModule({ targetBookingId }) {
  const [bookings, setBookings] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [jamaahList, setJamaahList] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [showModal, setShowModal] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedBookingForHistory, setSelectedBookingForHistory] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [editingPaymentId, setEditingPaymentId] = useState(null);

  const [formData, setFormData] = useState({
    packageId: '',
    jamaahId: '',
    roomType: 'Quad',
    busGroup: 'Bus 1',
    initialPayment: '',
    paymentMethod: 'Transfer Bank',
    paymentNotes: 'Setoran Pembayaran'
  });

  const [paymentEditForm, setPaymentEditForm] = useState({
    amount: '',
    paymentMethod: 'Transfer Bank',
    notes: ''
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const pkgSnap = await getDocs(collection(db, 'packages'));
      setPackagesList(pkgSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const jmhSnap = await getDocs(collection(db, 'jamaah'));
      setJamaahList(jmhSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const bkSnap = await getDocs(collection(db, 'bookings'));
      setBookings(bkSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Gagal mengambil data booking:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (targetBookingId && bookings.length > 0) {
      const found = bookings.find(b => b.id === targetBookingId);
      if (found) {
        handleOpenHistory(found);
      }
    }
  }, [targetBookingId, bookings]);

  const syncBookingTotalPaid = async (bookingId, totalTagihan) => {
    try {
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', bookingId));
      const snap = await getDocs(q);
      const totalPaidReal = snap.docs.reduce((acc, curr) => acc + (Number(curr.data().amount) || 0), 0);
      const status = totalPaidReal >= totalTagihan ? 'Full Payment' : 'DP Paid';

      await updateDoc(doc(db, 'bookings', bookingId), {
        totalPaid: totalPaidReal,
        paymentStatus: status
      });
      return { totalPaidReal, status };
    } catch (err) {
      console.error("Gagal sinkronisasi pembayaran:", err);
    }
  };

  const fetchPaymentHistory = async (bookingId) => {
    try {
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', bookingId));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setPaymentHistory(list);
      return list;
    } catch (err) {
      console.error("Gagal mengambil riwayat pembayaran:", err);
      return [];
    }
  };

  const handleOpenHistory = async (item) => {
    setSelectedBookingForHistory(item);
    await fetchPaymentHistory(item.id);
    await syncBookingTotalPaid(item.id, item.totalAmount);
    setShowHistoryModal(true);
  };

  const handleDeletePayment = async (payId) => {
    if (!confirm("Apakah Anda yakin ingin menghapus catatan pembayaran ini?")) return;
    try {
      await deleteDoc(doc(db, 'payments_income', payId));
      await syncBookingTotalPaid(selectedBookingForHistory.id, selectedBookingForHistory.totalAmount);
      await fetchPaymentHistory(selectedBookingForHistory.id);
      fetchData();
    } catch (err) {
      alert("Gagal menghapus pembayaran: " + err.message);
    }
  };

  const handleSavePaymentEdit = async (payId) => {
    try {
      await updateDoc(doc(db, 'payments_income', payId), {
        amount: Number(paymentEditForm.amount),
        paymentMethod: paymentEditForm.paymentMethod,
        notes: paymentEditForm.notes
      });

      setEditingPaymentId(null);
      await syncBookingTotalPaid(selectedBookingForHistory.id, selectedBookingForHistory.totalAmount);
      await fetchPaymentHistory(selectedBookingForHistory.id);
      fetchData();
    } catch (err) {
      alert("Gagal memperbarui pembayaran: " + err.message);
    }
  };

  const handleOpenAddModal = () => {
    setEditingBookingId(null);
    setFormData({ packageId: '', jamaahId: '', roomType: 'Quad', busGroup: 'Bus 1', initialPayment: '', paymentMethod: 'Transfer Bank', paymentNotes: 'DP Pendaftaran' });
    setShowModal(true);
  };

  const handleOpenEditModal = (item) => {
    setEditingBookingId(item.id);
    setFormData({
      packageId: item.packageId || '',
      jamaahId: item.jamaahId || '',
      roomType: item.roomType || 'Quad',
      busGroup: item.busGroup || 'Bus 1',
      initialPayment: '',
      paymentMethod: 'Transfer Bank',
      paymentNotes: 'Setoran Tambahan'
    });
    setShowModal(true);
  };

  const handleDeleteBooking = async (item) => {
    try {
      // 1. Cek ketersediaan riwayat pembayaran untuk booking ini
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', item.id));
      const paySnap = await getDocs(q);

      if (!paySnap.empty) {
        alert(`Booking ${item.bookingCode} tidak dapat dihapus karena masih memiliki ${paySnap.size} riwayat transaksi pembayaran di Arus Kas.\n\nSilakan hapus semua riwayat pembayaran jamaah ini terlebih dahulu di menu Arus Kas/Riwayat Setoran.`);
        return;
      }

      // 2. Jika riwayat pembayaran sudah kosong, jalankan konfirmasi dan hapus booking
      if (!confirm(`Apakah Anda yakin ingin menghapus booking ${item.bookingCode}?`)) return;

      await deleteDoc(doc(db, 'bookings', item.id));

      // 3. Kembalikan kuota seat paket
      if (item.packageId) {
        const pkgRef = doc(db, 'packages', item.packageId);
        const pkgSnap = await getDoc(pkgRef);
        if (pkgSnap.exists()) {
          const currentQuota = pkgSnap.data().quotaRemaining ?? 0;
          await updateDoc(pkgRef, { quotaRemaining: Number(currentQuota) + 1 });
        }
      }

      fetchData();
    } catch (err) {
      alert("Gagal menghapus booking: " + err.message);
    }
  };

  const handlePrintInvoice = (booking) => {
    const isLunas = booking.paymentStatus === 'Full Payment';
    const totalAmount = Number(booking.totalAmount) || 0;
    const totalPaid = Number(booking.totalPaid) || 0;
    const sisaTagihan = totalAmount - totalPaid;

    const printWindow = window.open('', '_blank');
    const docContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${isLunas ? 'INVOICE' : 'PROFORMA INVOICE'} - ${booking.bookingCode}</title>
          <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📄</text></svg>">
          
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 40px; background-color: #fff; }
            .invoice-box { max-width: 800px; margin: auto; border: 1px solid #e2e8f0; padding: 30px; border-radius: 12px; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #059669; padding-bottom: 20px; margin-bottom: 30px; }
            .company-title { font-size: 24px; font-weight: bold; color: #065f46; margin: 0; }
            .invoice-type { font-size: 20px; font-weight: 800; text-transform: uppercase; color: ${isLunas ? '#059669' : '#d97706'}; text-align: right; }
            .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-top: 5px; background-color: ${isLunas ? '#d1fae5' : '#fef3c7'}; color: ${isLunas ? '#065f46' : '#92400e'}; }
            .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
            .meta-card { background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #f1f5f9; }
            .meta-card h4 { margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
            .meta-card p { margin: 2px 0; font-size: 13px; font-weight: 600; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            th { background-color: #f1f5f9; text-align: left; padding: 12px; font-size: 12px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
            td { padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
            .summary-table { width: 300px; margin-left: auto; margin-bottom: 40px; }
            .summary-table td { padding: 6px 12px; }
            .summary-table .total-row { font-size: 16px; font-weight: bold; color: #0f172a; border-top: 2px solid #0284c7; }
            .footer { text-align: center; border-top: 1px solid #e2e8f0; pt-20px; padding-top: 20px; font-size: 11px; color: #94a3b8; }
            @media print {
              body { padding: 0; }
              .invoice-box { border: none; padding: 0; }
            }
          </style>
        </head>
        <body>
          <div class="invoice-box">
            <div class="header">
              <div>
                <h1 class="company-title">WHISys Executive Travel</h1>
                <p style="margin: 3px 0 0 0; font-size: 12px; color: #64748b;">Layanan Penyelenggara Umrah, Haji & Wisata Halal</p>
              </div>
              <div>
                <div class="invoice-type">${isLunas ? 'INVOICE' : 'PROFORMA INVOICE'}</div>
                <div class="badge">${isLunas ? 'LUNAS / PAID' : 'BELUM LUNAS / UNPAID'}</div>
              </div>
            </div>

            <div class="meta-grid">
              <div class="meta-card">
                <h4>Ditagihkan Kepada:</h4>
                <p style="font-size: 15px; color: #0f172a;">${booking.jamaahName || '-'}</p>
                <p style="color: #64748b; font-weight: normal;">No. Paspor: ${booking.passportNumber || '-'}</p>
              </div>
              <div class="meta-card">
                <h4>Rincian Tagihan:</h4>
                <p>Kode Booking: <span style="color: #059669; font-family: monospace;">${booking.bookingCode}</span></p>
                <p>Tanggal Diterbitkan: ${new Date().toLocaleDateString('id-ID')}</p>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Program Paket Travel</th>
                  <th>Tgl Keberangkatan</th>
                  <th>Kamar / Bus</th>
                  <th style="text-align: right;">Jumlah Tagihan</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>${booking.packageName || '-'}</strong></td>
                  <td>${formatDateDDMMYYYY(booking.departureDate)}</td>
                  <td>${booking.roomType} / ${booking.busGroup}</td>
                  <td style="text-align: right; font-weight: bold;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
                </tr>
              </tbody>
            </table>

            <table class="summary-table">
              <tr>
                <td>Total Tagihan:</td>
                <td style="text-align: right; font-weight: bold;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
              </tr>
              <tr>
                <td>Total Diterima (DP):</td>
                <td style="text-align: right; font-weight: bold; color: #059669;">Rp ${totalPaid.toLocaleString('id-ID')}</td>
              </tr>
              <tr class="total-row">
                <td>Sisa Pembayaran:</td>
                <td style="text-align: right; color: ${sisaTagihan > 0 ? '#d97706' : '#059669'};">
                  Rp ${sisaTagihan.toLocaleString('id-ID')}
                </td>
              </tr>
            </table>

            <div class="footer">
              <p>Terima kasih atas kepercayaan Anda memilih jasa perjalanan ibadah bersama kami.</p>
              <p>Dokumen ini dicetak otomatis oleh sistem ERP WHISys pada ${new Date().toLocaleString('id-ID')}.</p>
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(docContent);
    printWindow.document.close();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.packageId || !formData.jamaahId) {
      alert("Pilih Paket Travel dan Jamaah.");
      return;
    }

    try {
      const selectedPkg = packagesList.find(p => p.id === formData.packageId);
      const selectedJamaah = jamaahList.find(j => j.id === formData.jamaahId);

      let price = Number(selectedPkg.priceQuad || selectedPkg.priceMain || 0);
      if (formData.roomType === 'Triple') price = Number(selectedPkg.priceTriple || price);
      if (formData.roomType === 'Double') price = Number(selectedPkg.priceDouble || price);

      const paymentVal = Number(formData.initialPayment || 0);

      if (editingBookingId) {
        const currentBooking = bookings.find(b => b.id === editingBookingId);

        await updateDoc(doc(db, 'bookings', editingBookingId), {
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
          updatedAt: new Date().toISOString()
        });

        if (paymentVal > 0) {
          await addDoc(collection(db, 'payments_income'), {
            bookingId: editingBookingId,
            bookingCode: currentBooking.bookingCode,
            jamaahName: selectedJamaah.fullName,
            packageName: selectedPkg.name,
            amount: paymentVal,
            paymentMethod: formData.paymentMethod,
            notes: formData.paymentNotes,
            createdAt: new Date().toISOString()
          });
        }

        await syncBookingTotalPaid(editingBookingId, price);

      } else {
        if (Number(selectedPkg.quotaRemaining || 0) <= 0) {
          alert("Kuota paket ini sudah habis!");
          return;
        }

        const bookingCode = `BK-${Date.now().toString().slice(-6)}`;

        const newBookingRef = await addDoc(collection(db, 'bookings'), {
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
          totalPaid: paymentVal,
          paymentStatus: paymentVal >= price ? 'Full Payment' : 'DP Paid',
          createdAt: new Date().toISOString()
        });

        if (paymentVal > 0) {
          await addDoc(collection(db, 'payments_income'), {
            bookingId: newBookingRef.id,
            bookingCode: bookingCode,
            jamaahName: selectedJamaah.fullName,
            packageName: selectedPkg.name,
            amount: paymentVal,
            paymentMethod: formData.paymentMethod,
            notes: formData.paymentNotes,
            createdAt: new Date().toISOString()
          });
        }

        const pkgRef = doc(db, 'packages', selectedPkg.id);
        await updateDoc(pkgRef, { quotaRemaining: Number(selectedPkg.quotaRemaining || 1) - 1 });
      }

      setShowModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal memproses booking: " + err.message);
    }
  };

  const filteredBookings = bookings.filter(b => 
    (b.jamaahName && b.jamaahName.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (b.packageName && b.packageName.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (b.bookingCode && b.bookingCode.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" /> Booking & Manifest Group
          </h3>
          <p className="text-xs text-slate-400 mt-1">Plotting jamaah, alokasi bus, dan pembayaran setoran langsung.</p>
        </div>
        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/30"
        >
          <Plus className="w-4 h-4" /> Tambah Booking Baru
        </button>
      </div>

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

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-4">Kode / Jamaah</th>
                <th className="p-4">Paket & Tgl</th>
                <th className="p-4">Kamar & Bus</th>
                <th className="p-4">Total Tagihan</th>
                <th className="p-4">Total Terbayar</th>
                <th className="p-4">Status Pembayaran</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr><td colSpan="7" className="p-8 text-center text-slate-400">Memuat data manifest...</td></tr>
              ) : filteredBookings.length === 0 ? (
                <tr><td colSpan="7" className="p-8 text-center text-slate-400">Belum ada data booking.</td></tr>
              ) : (
                filteredBookings.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="p-4 font-semibold text-white">
                      {item.jamaahName || '-'}
                      <span className="block text-[10px] text-emerald-400 font-mono">{item.bookingCode}</span>
                    </td>
                    <td className="p-4">
                      {item.packageName || '-'}
                      <span className="block text-[10px] text-slate-400">
                        {formatDateDDMMYYYY(item.departureDate)}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="inline-block bg-slate-800 px-2 py-0.5 rounded text-[10px] mr-1">{item.roomType}</span>
                      <span className="inline-block bg-slate-800 px-2 py-0.5 rounded text-[10px]">{item.busGroup}</span>
                    </td>
                    <td className="p-4 font-bold text-slate-100">
                      Rp {item.totalAmount ? Number(item.totalAmount).toLocaleString('id-ID') : '0'}
                    </td>
                    <td className="p-4 font-bold text-emerald-400">
                      Rp {item.totalPaid ? Number(item.totalPaid).toLocaleString('id-ID') : '0'}
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
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleOpenHistory(item)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-blue-400 rounded-lg transition-colors"
                          title="Riwayat & Setoran Pembayaran"
                        >
                          <Wallet className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handlePrintInvoice(item)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg transition-colors"
                          title="Cetak Invoice / Proforma Invoice"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(item)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg transition-colors"
                          title="Edit Booking"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteBooking(item)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-rose-400 rounded-lg transition-colors"
                          title="Hapus Booking"
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

      {/* Modal Form Booking */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-400" /> {editingBookingId ? 'Edit Booking & Tambah Setoran' : 'Registrasi Booking Baru'}
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
                      {p.name} ({p.code}) - Sisa Seat: {p.quotaRemaining ?? p.quotaTotal}
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

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-3">
                <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" /> Pembayaran / Setoran {editingBookingId ? 'Tambahan' : 'Awal'}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 font-medium">Nominal Bayar (Rp)</label>
                    <input
                      type="number" placeholder="5000000 (Kosongkan jika 0)"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                      value={formData.initialPayment}
                      onChange={e => setFormData({ ...formData, initialPayment: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Metode Bayar</label>
                    <select
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                      value={formData.paymentMethod}
                      onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}
                    >
                      <option value="Transfer Bank">Transfer Bank</option>
                      <option value="Cash / Tunai">Cash / Tunai</option>
                      <option value="EDC / Kartu">EDC / Kartu</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Catatan Pembayaran</label>
                  <input
                    type="text" placeholder="Catatan setoran..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={formData.paymentNotes}
                    onChange={e => setFormData({ ...formData, paymentNotes: e.target.value })}
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  {editingBookingId ? 'Simpan Perubahan' : 'Proses Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal History & Edit Pembayaran */}
      {showHistoryModal && selectedBookingForHistory && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 relative">
            <button onClick={() => setShowHistoryModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <History className="w-5 h-5 text-emerald-400" /> Riwayat Pembayaran Jamaah
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Jamaah: <strong className="text-white">{selectedBookingForHistory.jamaahName}</strong> • Kode: <span className="font-mono text-emerald-400">{selectedBookingForHistory.bookingCode}</span>
            </p>

            <div className="overflow-x-auto max-h-60 overflow-y-auto mb-4 border border-slate-800 rounded-lg">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-800/80 text-slate-400 uppercase">
                  <tr>
                    <th className="p-3">Tanggal</th>
                    <th className="p-3">Metode & Catatan</th>
                    <th className="p-3">Nominal</th>
                    <th className="p-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {paymentHistory.length === 0 ? (
                    <tr><td colSpan="4" className="p-6 text-center text-slate-500">Belum ada riwayat setoran pembayaran.</td></tr>
                  ) : (
                    paymentHistory.map(pay => (
                      <tr key={pay.id} className="hover:bg-slate-800/30">
                        {editingPaymentId === pay.id ? (
                          <>
                            <td className="p-2" colSpan="3">
                              <div className="grid grid-cols-3 gap-2">
                                <input
                                  type="number"
                                  className="bg-slate-950 border border-slate-700 p-1.5 rounded text-white"
                                  value={paymentEditForm.amount}
                                  onChange={e => setPaymentEditForm({ ...paymentEditForm, amount: e.target.value })}
                                />
                                <select
                                  className="bg-slate-950 border border-slate-700 p-1.5 rounded text-white"
                                  value={paymentEditForm.paymentMethod}
                                  onChange={e => setPaymentEditForm({ ...paymentEditForm, paymentMethod: e.target.value })}
                                >
                                  <option value="Transfer Bank">Transfer Bank</option>
                                  <option value="Cash / Tunai">Cash / Tunai</option>
                                  <option value="EDC / Kartu">EDC / Kartu</option>
                                </select>
                                <input
                                  type="text"
                                  className="bg-slate-950 border border-slate-700 p-1.5 rounded text-white"
                                  value={paymentEditForm.notes}
                                  onChange={e => setPaymentEditForm({ ...paymentEditForm, notes: e.target.value })}
                                />
                              </div>
                            </td>
                            <td className="p-2 text-center">
                              <button onClick={() => handleSavePaymentEdit(pay.id)} className="px-2 py-1 bg-emerald-600 text-white text-[10px] rounded mr-1">
                                Simpan
                              </button>
                              <button onClick={() => setEditingPaymentId(null)} className="px-2 py-1 bg-slate-800 text-slate-300 text-[10px] rounded">
                                Batal
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="p-3 text-slate-400">
                              {formatDateDDMMYYYY(pay.createdAt)}
                            </td>
                            <td className="p-3">
                              <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[10px] mr-1">{pay.paymentMethod}</span>
                              <span className="text-slate-400">{pay.notes}</span>
                            </td>
                            <td className="p-3 font-bold text-emerald-400">
                              Rp {Number(pay.amount).toLocaleString('id-ID')}
                            </td>
                            <td className="p-3 text-center">
                              <button
                                onClick={() => {
                                  setEditingPaymentId(pay.id);
                                  setPaymentEditForm({ amount: pay.amount, paymentMethod: pay.paymentMethod, notes: pay.notes });
                                }}
                                className="text-emerald-400 hover:underline mr-2"
                              >
                                Edit
                              </button>
                              <button onClick={() => handleDeletePayment(pay.id)} className="text-rose-400 hover:underline">
                                Hapus
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-800 text-xs">
              <span className="text-slate-400">Total Tagihan: <strong className="text-white">Rp {Number(selectedBookingForHistory.totalAmount).toLocaleString('id-ID')}</strong></span>
              <button onClick={() => setShowHistoryModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
