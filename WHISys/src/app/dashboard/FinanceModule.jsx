'use client';

import React, { useState, useEffect } from 'react';
import { db } from '../../../lib/firebase';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import { Wallet, ArrowDownLeft, ArrowUpRight, X } from 'lucide-react';

export default function FinanceModule({ onSelectBooking }) {
  const [transactions, setTransactions] = useState([]);
  const [vendorPayments, setVendorPayments] = useState([]);
  const [bookingsList, setBookingsList] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [activeTab, setActiveTab] = useState('income');

  const [incomeForm, setIncomeForm] = useState({
    bookingId: '',
    amount: '',
    paymentMethod: 'Transfer Bank',
    notes: 'DP Keberangkatan'
  });

  const [vendorForm, setVendorForm] = useState({
    packageId: '',
    vendorName: '',
    category: 'Tiket Pesawat',
    amount: '',
    notes: 'DP Booking Seat'
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const bkSnap = await getDocs(collection(db, 'bookings'));
      setBookingsList(bkSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const pkgSnap = await getDocs(collection(db, 'packages'));
      setPackagesList(pkgSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const txSnap = await getDocs(collection(db, 'payments_income'));
      setTransactions(txSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const vpSnap = await getDocs(collection(db, 'payments_vendor'));
      setVendorPayments(vpSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Gagal mengambil data keuangan:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleIncomeSubmit = async (e) => {
    e.preventDefault();
    try {
      const selectedBooking = bookingsList.find(b => b.id === incomeForm.bookingId);
      if (!selectedBooking) return;

      await addDoc(collection(db, 'payments_income'), {
        bookingId: selectedBooking.id,
        bookingCode: selectedBooking.bookingCode,
        jamaahName: selectedBooking.jamaahName,
        packageName: selectedBooking.packageName,
        amount: Number(incomeForm.amount),
        paymentMethod: incomeForm.paymentMethod,
        notes: incomeForm.notes,
        createdAt: new Date().toISOString()
      });

      setShowIncomeModal(false);
      setIncomeForm({ bookingId: '', amount: '', paymentMethod: 'Transfer Bank', notes: 'DP Keberangkatan' });
      fetchData();
    } catch (err) {
      alert("Gagal mencatat pembayaran: " + err.message);
    }
  };

  const handleVendorSubmit = async (e) => {
    e.preventDefault();
    try {
      const selectedPkg = packagesList.find(p => p.id === vendorForm.packageId);

      await addDoc(collection(db, 'payments_vendor'), {
        packageId: selectedPkg?.id || 'GLOBAL',
        packageName: selectedPkg?.name || 'Operasional Umum',
        vendorName: vendorForm.vendorName,
        category: vendorForm.category,
        amount: Number(vendorForm.amount),
        notes: vendorForm.notes,
        createdAt: new Date().toISOString()
      });

      setShowVendorModal(false);
      setVendorForm({ packageId: '', vendorName: '', category: 'Tiket Pesawat', amount: '', notes: 'DP Booking Seat' });
      fetchData();
    } catch (err) {
      alert("Gagal mencatat pembayaran vendor: " + err.message);
    }
  };

  const totalIncome = transactions.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalVendorPaid = vendorPayments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const netCashflow = totalIncome - totalVendorPaid;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-400" /> Arus Kas Operasional & Payments
          </h3>
          <p className="text-xs text-slate-400 mt-1">Pencatatan setoran jamaah dan pembayaran deposit/pelunasan vendor.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowIncomeModal(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
          >
            <ArrowDownLeft className="w-4 h-4" /> + Terima Setoran Jamaah
          </button>
          <button
            onClick={() => setShowVendorModal(true)}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
          >
            <ArrowUpRight className="w-4 h-4" /> + Bayar Vendor
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs text-slate-400 mb-1">Total Kas Masuk (Jamaah)</p>
          <h3 className="text-2xl font-bold text-emerald-400">Rp {totalIncome.toLocaleString('id-ID')}</h3>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs text-slate-400 mb-1">Total Keluar (Vendor & Flight)</p>
          <h3 className="text-2xl font-bold text-rose-400">Rp {totalVendorPaid.toLocaleString('id-ID')}</h3>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs text-slate-400 mb-1">Saldo Kas Bersih Operasional</p>
          <h3 className={`text-2xl font-bold ${netCashflow >= 0 ? 'text-blue-400' : 'text-amber-400'}`}>
            Rp {netCashflow.toLocaleString('id-ID')}
          </h3>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('income')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'income' ? 'bg-slate-800 text-emerald-400 border border-slate-700' : 'text-slate-400 hover:text-white'
          }`}
        >
          Riwayat Setoran Jamaah ({transactions.length})
        </button>
        <button
          onClick={() => setActiveTab('vendor')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'vendor' ? 'bg-slate-800 text-rose-400 border border-slate-700' : 'text-slate-400 hover:text-white'
          }`}
        >
          Riwayat Bayar Vendor ({vendorPayments.length})
        </button>
      </div>

      {activeTab === 'income' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/60 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-4">Kode Booking / Jamaah</th>
                  <th className="p-4">Paket Travel</th>
                  <th className="p-4">Metode & Catatan</th>
                  <th className="p-4">Tanggal Setor</th>
                  <th className="p-4 text-right">Nominal Masuk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-slate-500">Belum ada transaksi setoran jamaah.</td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-800/30">
                      <td className="p-4 font-semibold text-white">
                        {tx.jamaahName}
                        {/* LINK KLIK KODE BOOKING */}
                        <button
                          onClick={() => onSelectBooking && onSelectBooking(tx.bookingId)}
                          className="block text-[10px] text-emerald-400 font-mono hover:underline text-left cursor-pointer"
                          title="Klik untuk membuka riwayat booking ini"
                        >
                          {tx.bookingCode} ↗
                        </button>
                      </td>
                      <td className="p-4">{tx.packageName}</td>
                      <td className="p-4">
                        <span className="bg-slate-800 px-2 py-0.5 rounded text-[10px] mr-1">{tx.paymentMethod}</span>
                        <span className="text-slate-400">{tx.notes}</span>
                      </td>
                      <td className="p-4 text-slate-400">{new Date(tx.createdAt).toLocaleDateString('id-ID')}</td>
                      <td className="p-4 text-right font-bold text-emerald-400">
                        + Rp {Number(tx.amount).toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'vendor' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/60 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-4">Nama Vendor / Supplier</th>
                  <th className="p-4">Kategori Layanan</th>
                  <th className="p-4">Paket Terkait</th>
                  <th className="p-4">Catatan</th>
                  <th className="p-4 text-right">Nominal Dibayar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {vendorPayments.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-slate-500">Belum ada riwayat pembayaran vendor.</td>
                  </tr>
                ) : (
                  vendorPayments.map((vp) => (
                    <tr key={vp.id} className="hover:bg-slate-800/30">
                      <td className="p-4 font-semibold text-white">{vp.vendorName}</td>
                      <td className="p-4">
                        <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2.5 py-1 rounded-full font-medium">
                          {vp.category}
                        </span>
                      </td>
                      <td className="p-4">{vp.packageName}</td>
                      <td className="p-4 text-slate-400">{vp.notes}</td>
                      <td className="p-4 text-right font-bold text-rose-400">
                        - Rp {Number(vp.amount).toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Income */}
      {showIncomeModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 relative">
            <button onClick={() => setShowIncomeModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <ArrowDownLeft className="w-5 h-5 text-emerald-400" /> Catat Setoran Pembayaran Jamaah
            </h3>

            <form onSubmit={handleIncomeSubmit} className="space-y-4 text-xs text-slate-300">
              <div>
                <label className="block mb-1 font-medium">Pilih Booking Jamaah</label>
                <select
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={incomeForm.bookingId}
                  onChange={e => setIncomeForm({ ...incomeForm, bookingId: e.target.value })}
                >
                  <option value="">-- Pilih Kode Booking / Jamaah --</option>
                  {bookingsList.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.bookingCode} - {b.jamaahName} ({b.packageName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nominal Setoran (Rp)</label>
                <input
                  type="number" required placeholder="5000000"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={incomeForm.amount}
                  onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Metode</label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={incomeForm.paymentMethod}
                    onChange={e => setIncomeForm({ ...incomeForm, paymentMethod: e.target.value })}
                  >
                    <option value="Transfer Bank">Transfer Bank</option>
                    <option value="Cash / Tunai">Cash / Tunai</option>
                    <option value="EDC / Kartu">EDC / Kartu</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Keterangan</label>
                  <input
                    type="text" placeholder="DP 1 / Pelunasan"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={incomeForm.notes}
                    onChange={e => setIncomeForm({ ...incomeForm, notes: e.target.value })}
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
                <button type="button" onClick={() => setShowIncomeModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium">
                  Simpan Pembayaran
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Vendor */}
      {showVendorModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 relative">
            <button onClick={() => setShowVendorModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <ArrowUpRight className="w-5 h-5 text-rose-400" /> Catat Pembayaran Vendor / Supplier
            </h3>

            <form onSubmit={handleVendorSubmit} className="space-y-4 text-xs text-slate-300">
              <div>
                <label className="block mb-1 font-medium">Paket Keberangkatan Terkait</label>
                <select
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={vendorForm.packageId}
                  onChange={e => setVendorForm({ ...vendorForm, packageId: e.target.value })}
                >
                  <option value="">-- Bebas / Operasional Umum --</option>
                  {packagesList.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nama Vendor / Perusahaan</label>
                <input
                  type="text" required placeholder="Contoh: Saudi Airlines / Hotel Pullman Makkah"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={vendorForm.vendorName}
                  onChange={e => setVendorForm({ ...vendorForm, vendorName: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Kategori Pengeluaran</label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={vendorForm.category}
                    onChange={e => setVendorForm({ ...vendorForm, category: e.target.value })}
                  >
                    <option value="Tiket Pesawat">Tiket Pesawat</option>
                    <option value="Hotel Makkah">Hotel Makkah</option>
                    <option value="Hotel Madinah">Hotel Madinah</option>
                    <option value="Visa & Siskopatuh">Visa & Siskopatuh</option>
                    <option value="LA & Bus Transport">LA & Bus Transport</option>
                    <option value="Perlengkapan Koper">Perlengkapan Koper</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Nominal Bayar (Rp)</label>
                  <input
                    type="number" required placeholder="50000000"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                    value={vendorForm.amount}
                    onChange={e => setVendorForm({ ...vendorForm, amount: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Keterangan Catatan</label>
                <input
                  type="text" placeholder="DP Deposit 50% Tiket Group"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  value={vendorForm.notes}
                  onChange={e => setVendorForm({ ...vendorForm, notes: e.target.value })}
                />
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
                <button type="button" onClick={() => setShowVendorModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-rose-600 text-white rounded-lg font-medium">
                  Simpan Pengeluaran Vendor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
