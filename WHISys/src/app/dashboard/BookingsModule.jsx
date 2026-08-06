'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc, query, where } from 'firebase/firestore';
import { BookOpen, Plus, Search, CheckCircle, Clock, X, Edit, Trash2, Wallet, History, Printer, FileCheck, Check, AlertCircle, MessageSquare } from 'lucide-react';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

// Daftar Dokumen Persyaratan Standard Travel (8 Dokumen)
const REQUIRED_DOCUMENTS = [
  { key: 'passport', label: 'Paspor Asli (Min. 6 Bln)' },
  { key: 'ktp_foto', label: 'Fotocopy KTP & Pasfoto 4x6' },
  { key: 'family_cert', label: 'Buku Nikah / Akta Lahir / KK' },
  { key: 'sponsor_letter', label: 'Surat Sponsor' },
  { key: 'bank_statement', label: 'Rekening Koran / Referensi Bank' },
  { key: 'vaccine_cert', label: 'Sertifikat Vaksin Meningitis' },
  { key: 'visa', label: 'Visa Umrah / Tour Issued' },
  { key: 'ticket', label: 'Tiket Pesawat (Penerbitan Issued)' }
];

export default function BookingsModule({ targetBookingId, theme = 'dark' }) {
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

  const [bookings, setBookings] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [jamaahList, setJamaahList] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [showModal, setShowModal] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // State Riwayat Setoran
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedBookingForHistory, setSelectedBookingForHistory] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [editingPaymentId, setEditingPaymentId] = useState(null);

  // State Monitoring Dokumen
  const [showDocModal, setShowDocModal] = useState(false);
  const [selectedBookingForDoc, setSelectedBookingForDoc] = useState(null);
  const [docChecklist, setDocChecklist] = useState({
    passport: false,
    ktp_foto: false,
    family_cert: false,
    sponsor_letter: false,
    bank_statement: false,
    vaccine_cert: false,
    visa: false,
    ticket: false
  });

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

  // HELPER FORMAT & KIRIM PESAN WHATSAPP
  const sendWhatsAppNotification = (booking) => {
    const jamaahData = jamaahList.find(j => j.id === booking.jamaahId || j.fullName === booking.jamaahName);
    
    if (!jamaahData || !jamaahData.phone) {
      alert("Nomor HP/WhatsApp jamaah tidak ditemukan pada Data Master Jamaah.");
      return;
    }

    let cleanPhone = jamaahData.phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.slice(1);
    }

    const isLunas = booking.paymentStatus === 'Full Payment';
    const totalAmount = Number(booking.totalAmount || 0).toLocaleString('id-ID');
    const totalPaid = Number(booking.totalPaid || 0).toLocaleString('id-ID');
    const sisa = (Number(booking.totalAmount || 0) - Number(booking.totalPaid || 0)).toLocaleString('id-ID');

    const message = `*KONFIRMASI BOOKING PROGRAM TRAVEL*
*PT. WISATA HALAL INTERNASIONAL*
--------------------------------------------------
Assalamu'alaikum Wr. Wb.
Yth. Bpk/Ibu *${booking.jamaahName}* (${jamaahData.customerCode || 'CST'}),

Terima kasih telah mendaftar program perjalanan ibadah bersama kami. Berikut rincian booking Anda:

📋 *DETAIL BOOKING & MANIFEST:*
• *Kode Booking:* ${booking.bookingCode}
• *Program Paket:* ${booking.packageName}
• *Tgl Keberangkatan:* ${formatDateDDMMYYYY(booking.departureDate)}
• *Tipe Kamar / Bus:* ${booking.roomType} / ${booking.busGroup}

💰 *RINGKASAN KEUANGAN:*
• *Total Tagihan:* Rp ${totalAmount}
• *Setoran Diterima:* Rp ${totalPaid}
• *Sisa Tagihan / Saldo:* Rp ${sisa}
• *Status Pembayaran:* ${isLunas ? '✅ LUNAS' : '⏳ DP Paid'}

📌 *CATATAN BERKAS DOKUMEN:*
Mohon melengkapi 8 berkas dokumen (Paspor, KTP/Foto, Buku Nikah, Surat Sponsor, Rekening Koran, Vaksin Meningitis, Visa, & Tiket).

Apabila ada pertanyaan lebih lanjut, silakan hubungi tim kami.
Wassalamu'alaikum Wr. Wb.`;

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMessage}`, '_blank');
  };

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

  const handleOpenDocModal = (item) => {
    setSelectedBookingForDoc(item);
    setDocChecklist({
      passport: item.documents?.passport || false,
      ktp_foto: item.documents?.ktp_foto || false,
      family_cert: item.documents?.family_cert || false,
      sponsor_letter: item.documents?.sponsor_letter || false,
      bank_statement: item.documents?.bank_statement || false,
      vaccine_cert: item.documents?.vaccine_cert || false,
      visa: item.documents?.visa || false,
      ticket: item.documents?.ticket || false
    });
    setShowDocModal(true);
  };

  const handleSaveDocChecklist = async () => {
    if (!selectedBookingForDoc) return;
    try {
      await updateDoc(doc(db, 'bookings', selectedBookingForDoc.id), {
        documents: docChecklist,
        updatedAt: new Date().toISOString()
      });
      setShowDocModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal memperbarui status dokumen: " + err.message);
    }
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
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', item.id));
      const paySnap = await getDocs(q);

      if (!paySnap.empty) {
        alert(`Booking ${item.bookingCode} tidak dapat dihapus karena masih memiliki ${paySnap.size} riwayat transaksi pembayaran di Arus Kas.\n\nSilakan hapus semua riwayat pembayaran jamaah ini terlebih dahulu di menu Arus Kas/Riwayat Setoran.`);
        return;
      }

      if (!confirm(`Apakah Anda yakin ingin menghapus booking ${item.bookingCode}?`)) return;

      await deleteDoc(doc(db, 'bookings', item.id));

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

  const handlePrintInvoice = async (booking) => {
    const isLunas = booking.paymentStatus === 'Full Payment';
    const totalAmount = Number(booking.totalAmount) || 0;
    
    let payments = [];
    try {
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', booking.id));
      const snap = await getDocs(q);
      payments = snap.docs.map(d => d.data());
    } catch (err) {
      console.error("Gagal mengambil riwayat setoran untuk invoice:", err);
    }

    const totalPaid = payments.length > 0 
      ? payments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      : (Number(booking.totalPaid) || 0);
      
    const sisaTagihan = totalAmount - totalPaid;

    const paymentRowsHtml = payments.length > 0
      ? payments.map((pay, idx) => `
          <tr style="background-color: #f8fafc; font-size: 11px; color: #475569;">
            <td style="padding: 6px 12px; border-bottom: 1px solid #f1f5f9;">
              • Setoran #${idx + 1} (${formatDateDDMMYYYY(pay.createdAt)}) - <span style="font-style: italic;">${pay.paymentMethod || 'Transfer'} (${pay.notes || 'Setoran'})</span>
            </td>
            <td style="text-align: right; padding: 6px 12px; font-weight: 600; color: #059669; border-bottom: 1px solid #f1f5f9; white-space: nowrap;">
              + Rp ${Number(pay.amount || 0).toLocaleString('id-ID')}
            </td>
          </tr>
        `).join('')
      : `
          <tr style="background-color: #f8fafc; font-size: 11px; color: #94a3b8;">
            <td style="padding: 6px 12px;" colspan="2">• Belum ada catatan setoran masuk</td>
          </tr>
        `;

    const docContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${isLunas ? 'INVOICE' : 'PROFORMA INVOICE'} - ${booking.bookingCode}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 40px; background-color: #fff; }
            .invoice-box { max-width: 800px; margin: auto; border: 1px solid #e2e8f0; padding: 35px; border-radius: 12px; }
            .kop-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #059669; padding-bottom: 20px; margin-bottom: 25px; }
            .company-logo-title { font-size: 22px; font-weight: 800; color: #065f46; letter-spacing: -0.5px; margin: 0; }
            .company-sub { font-size: 11px; color: #047857; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin: 2px 0 8px 0; }
            .company-address { font-size: 11px; color: #475569; line-height: 1.5; margin: 0; }
            .invoice-type { font-size: 20px; font-weight: 800; text-transform: uppercase; color: ${isLunas ? '#059669' : '#d97706'}; text-align: right; }
            .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: bold; margin-top: 5px; background-color: ${isLunas ? '#d1fae5' : '#fef3c7'}; color: ${isLunas ? '#065f46' : '#92400e'}; }
            .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px; }
            .meta-card { background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #f1f5f9; }
            .meta-card h4 { margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; color: #059669; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
            .meta-card p { margin: 3px 0; font-size: 12px; color: #334155; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th { background-color: #f1f5f9; text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
            td { padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
            .summary-table { width: 100%; max-width: 500px; margin-left: auto; margin-bottom: 30px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
            .summary-table td { padding: 8px 12px; }
            .summary-header-row { background-color: #f1f5f9; font-weight: bold; }
            .summary-table .total-row { font-size: 14px; font-weight: bold; color: #0f172a; background-color: #f8fafc; border-top: 2px solid #cbd5e1; }
            .footer-section { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 20px; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 10px; }
            .bank-info { background-color: #f0fdf4; border: 1px dashed #a7f3d0; padding: 12px 15px; border-radius: 8px; font-size: 11px; color: #065f46; }
            .bank-info h5 { margin: 0 0 6px 0; font-size: 12px; color: #047857; text-transform: uppercase; letter-spacing: 0.5px; }
            .signature-box { text-align: center; font-size: 11px; color: #64748b; }
            .signature-space { height: 50px; }
            .footer-note { text-align: center; font-size: 10px; color: #94a3b8; margin-top: 25px; border-top: 1px solid #f1f5f9; padding-top: 10px; }
            @media print { body { padding: 0; } .invoice-box { border: none; padding: 0; } }
          </style>
        </head>
        <body>
          <div class="invoice-box">
            <div class="kop-header">
              <div>
                <h1 class="company-logo-title">PT. WISATA HALAL INTERNASIONAL</h1>
                <p class="company-sub">Penyelenggara Perjalanan Ibadah Umrah, Haji & Wisata Halal</p>
                <p class="company-address">
                  Ruko Graha Cirendeu No.1C Jl. Cirendeu Raya, Tangerang Selatan, Banten, Indonesia, 15445<br>
                  Telp/WA: +62 812-0000-0000 | Email: admin@wisatahalalindonesia.id
                </p>
              </div>
              <div>
                <div class="invoice-type">${isLunas ? 'INVOICE' : 'PROFORMA INVOICE'}</div>
                <div class="badge">${isLunas ? 'LUNAS / PAID' : 'BELUM LUNAS / UNPAID'}</div>
              </div>
            </div>

            <div class="meta-grid">
              <div class="meta-card">
                <h4>Ditagihkan Kepada (Customer):</h4>
                <p>Nama Lengkap: <strong>${booking.jamaahName || '-'}</strong></p>
                <p>No. Telepon / WA: <strong>${booking.jamaahPhone || booking.phone || '-'}</strong></p>
                <p>NPWP: <strong>${booking.jamaahNpwp || booking.npwp || '-'}</strong></p>
                <p>Alamat: <strong>${booking.jamaahAddress || booking.address || '-'}</strong></p>
              </div>
              <div class="meta-card">
                <h4>Rincian Dokumen:</h4>
                <p>Kode Booking: <strong style="color: #059669; font-family: monospace;">${booking.bookingCode}</strong></p>
                <p>Tanggal Terbit: <strong>${new Date().toLocaleDateString('id-ID')}</strong></p>
                <p>Status Setoran: <strong>${booking.paymentStatus || 'DP Paid'}</strong></p>
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
                  <td style="text-align: right; font-weight: bold; white-space: nowrap;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
                </tr>
              </tbody>
            </table>

            <table class="summary-table">
              <tr class="summary-header-row">
                <td>Total Harga Paket:</td>
                <td style="text-align: right; font-weight: bold; white-space: nowrap;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
              </tr>
              <tr style="background-color: #f1f5f9; border-top: 1px solid #e2e8f0;">
                <td colspan="2" style="font-weight: bold; font-size: 11px; color: #047857; text-transform: uppercase;">
                  Rincian Setoran Pembayaran Diterima:
                </td>
              </tr>
              ${paymentRowsHtml}
              <tr style="border-top: 1px dashed #cbd5e1;">
                <td style="font-weight: bold;">Total Terbayar:</td>
                <td style="text-align: right; font-weight: bold; color: #059669; white-space: nowrap;">
                  Rp ${totalPaid.toLocaleString('id-ID')}
                </td>
              </tr>
              <tr class="total-row">
                <td>Sisa Tagihan / Saldo:</td>
                <td style="text-align: right; color: ${sisaTagihan > 0 ? '#d97706' : '#059669'}; white-space: nowrap;">
                  Rp ${sisaTagihan.toLocaleString('id-ID')}
                </td>
              </tr>
            </table>

            <div class="footer-section">
              <div class="bank-info">
                <h5>Informasi Pembayaran / Transfer:</h5>
                <div>Silakan lakukan pembayaran melalui rekening resmi perusahaan:</div>
                <div class="bank-details">
                  Bank: <strong>Bank Syariah Indonesia (BSI)</strong><br>
                  No. Rekening: <strong>788-9900-112</strong><br>
                  A.N: <strong>PT. Wisata Halal Internasional</strong>
                </div>
              </div>
              <div class="signature-box">
                <p>Jakarta, ${new Date().toLocaleDateString('id-ID')}<br>Finance & Billing Dept.</p>
                <div class="signature-space"></div>
                <p><strong>( PT. Wisata Halal Internasional )</strong></p>
              </div>
            </div>

            <div class="footer-note">
              <p>Terima kasih atas kepercayaan Anda. Dokumen ini sah dan diterbitkan secara otomatis oleh sistem ERP WHISys.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(docContent);
    doc.close();

    iframe.contentWindow.focus();
    setTimeout(() => {
      iframe.contentWindow.print();
      document.body.removeChild(iframe);
    }, 500);
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
          documents: {
            passport: false,
            ktp_foto: false,
            family_cert: false,
            sponsor_letter: false,
            bank_statement: false,
            vaccine_cert: false,
            visa: false,
            ticket: false
          },
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
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <BookOpen className="w-5 h-5 text-emerald-500" /> Booking & Manifest Group
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Plotting jamaah, kelengkapan berkas/dokumen, dan setoran pembayaran.</p>
        </div>
        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg"
        >
          <Plus className="w-4 h-4" /> Tambah Booking Baru
        </button>
      </div>

      <div className={`${styles.cardBg} p-4 rounded-xl border flex items-center gap-4`}>
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Cari Kode Booking, Nama Jamaah, atau Nama Paket..."
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
                <th className="p-4">Kode / Jamaah</th>
                <th className="p-4">Paket & Tgl</th>
                <th className="p-4">Kamar & Bus</th>
                <th className="p-4">Kelengkapan Dokumen</th>
                <th className="p-4">Tagihan & Setor</th>
                <th className="p-4">Status Bayar</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {loading ? (
                <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Memuat data manifest...</td></tr>
              ) : filteredBookings.length === 0 ? (
                <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Belum ada data booking.</td></tr>
              ) : (
                filteredBookings.map((item) => {
                  const docs = item.documents || {};
                  const collectedCount = REQUIRED_DOCUMENTS.filter(d => docs[d.key]).length;
                  const docPercent = Math.round((collectedCount / REQUIRED_DOCUMENTS.length) * 100);
                  const isDocComplete = collectedCount === REQUIRED_DOCUMENTS.length;

                  return (
                    <tr key={item.id} className={`${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'} transition-colors`}>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>
                        {item.jamaahName || '-'}
                        <span className="block text-[10px] text-emerald-500 font-mono">{item.bookingCode}</span>
                      </td>
                      <td className="p-4">
                        <span className={styles.textTitle}>{item.packageName || '-'}</span>
                        <span className={`block text-[10px] ${styles.textSub}`}>
                          {formatDateDDMMYYYY(item.departureDate)}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-block ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] mr-1`}>{item.roomType}</span>
                        <span className={`inline-block ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px]`}>{item.busGroup}</span>
                      </td>
                      
                      <td className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold ${isDocComplete ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {collectedCount}/{REQUIRED_DOCUMENTS.length} Berkas ({docPercent}%)
                          </span>
                        </div>
                        <div className={`w-28 h-1.5 ${isDark ? 'bg-slate-800' : 'bg-slate-200'} rounded-full overflow-hidden`}>
                          <div 
                            className={`h-full ${isDocComplete ? 'bg-emerald-500' : 'bg-amber-500'} transition-all`} 
                            style={{ width: `${docPercent}%` }}
                          />
                        </div>
                      </td>

                      <td className="p-4">
                        <div className={`font-bold ${styles.textTitle}`}>
                          Rp {item.totalAmount ? Number(item.totalAmount).toLocaleString('id-ID') : '0'}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-500">
                          Setor: Rp {item.totalPaid ? Number(item.totalPaid).toLocaleString('id-ID') : '0'}
                        </div>
                      </td>
                      <td className="p-4">
                        {item.paymentStatus === 'Full Payment' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full font-semibold">
                            <CheckCircle className="w-3 h-3" /> Lunas
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full font-semibold">
                            <Clock className="w-3 h-3" /> DP / Cicilan
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* TOMBOL WHATSAPP (IKON HIJAU) */}
                          <button
                            onClick={() => sendWhatsAppNotification(item)}
                            className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-lg transition-colors"
                            title="Kirim Konfirmasi via WhatsApp"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>

                          {/* TOMBOL MONITORING DOKUMEN */}
                          <button
                            onClick={() => handleOpenDocModal(item)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-purple-500 rounded-lg transition-colors`}
                            title="Monitoring Kelengkapan Berkas Dokumen"
                          >
                            <FileCheck className="w-4 h-4" />
                          </button>
                          
                          {/* TOMBOL RIWAYAT PEMBAYARAN */}
                          <button
                            onClick={() => handleOpenHistory(item)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-blue-500 rounded-lg transition-colors`}
                            title="Riwayat & Setoran Pembayaran"
                          >
                            <Wallet className="w-4 h-4" />
                          </button>

                          {/* TOMBOL PRINT INVOICE */}
                          <button
                            onClick={() => handlePrintInvoice(item)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-amber-500 rounded-lg transition-colors`}
                            title="Cetak Invoice / Proforma Invoice"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {/* TOMBOL EDIT BOOKING */}
                          <button
                            onClick={() => handleOpenEditModal(item)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                            title="Edit Booking"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          {/* TOMBOL HAPUS BOOKING */}
                          <button
                            onClick={() => handleDeleteBooking(item)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                            title="Hapus Booking"
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

      {/* MODAL CHECKLIST MONITORING DOKUMEN JAMAAH */}
      {showDocModal && selectedBookingForDoc && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowDocModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <FileCheck className="w-5 h-5 text-purple-500" /> Checklist Dokumen Jamaah
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Jamaah: <strong className={styles.textTitle}>{selectedBookingForDoc.jamaahName}</strong> • Kode: <span className="font-mono text-emerald-500">{selectedBookingForDoc.bookingCode}</span>
            </p>

            <div className="space-y-2.5 mb-6">
              {REQUIRED_DOCUMENTS.map((docItem) => {
                const isChecked = docChecklist[docItem.key] || false;
                return (
                  <label
                    key={docItem.key}
                    onClick={() => setDocChecklist({ ...docChecklist, [docItem.key]: !isChecked })}
                    className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${
                      isChecked 
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' 
                        : `${styles.innerBg} text-slate-400`
                    }`}
                  >
                    <span className="text-xs font-semibold">{docItem.label}</span>
                    <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all ${
                      isChecked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-500'
                    }`}>
                      {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className={`pt-4 flex justify-between items-center border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" /> Centang berkas yang telah diserahkan
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDocModal(false)}
                  className={`px-3.5 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}
                >
                  Batal
                </button>
                <button
                  onClick={handleSaveDocChecklist}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium"
                >
                  Simpan Status Dokumen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FORM BOOKING */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <BookOpen className="w-5 h-5 text-emerald-500" /> {editingBookingId ? 'Edit Booking & Tambah Setoran' : 'Registrasi Booking Baru'}
            </h3>

            <form onSubmit={handleSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Pilih Paket Travel</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
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
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={formData.jamaahId}
                  onChange={e => setFormData({ ...formData, jamaahId: e.target.value })}
                >
                  <option value="">-- Pilih Data Master Jamaah --</option>
                  {jamaahList.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.fullName} - {j.customerCode || 'CST'} - Paspor: {j.passportNumber || 'Belum Ada'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Tipe Kamar</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
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
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.busGroup}
                    onChange={e => setFormData({ ...formData, busGroup: e.target.value })}
                  >
                    <option value="Bus 1">Bus 1</option>
                    <option value="Bus 2">Bus 2</option>
                    <option value="Bus 3">Bus 3</option>
                  </select>
                </div>
              </div>

              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" /> Pembayaran / Setoran {editingBookingId ? 'Tambahan' : 'Awal'}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 font-medium">Nominal Bayar (Rp)</label>
                    <input
                      type="number" placeholder="5000000 (Kosongkan jika 0)"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={formData.initialPayment}
                      onChange={e => setFormData({ ...formData, initialPayment: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Metode Bayar</label>
                    <select
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
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
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.paymentNotes}
                    onChange={e => setFormData({ ...formData, paymentNotes: e.target.value })}
                  />
                </div>
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
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

      {/* MODAL RIWAYAT PEMBAYARAN */}
      {showHistoryModal && selectedBookingForHistory && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-2xl p-6 relative`}>
            <button onClick={() => setShowHistoryModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <History className="w-5 h-5 text-emerald-500" /> Riwayat Pembayaran Jamaah
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Jamaah: <strong className={styles.textTitle}>{selectedBookingForHistory.jamaahName}</strong> • Kode: <span className="font-mono text-emerald-500">{selectedBookingForHistory.bookingCode}</span>
            </p>

            <div className={`overflow-x-auto max-h-60 overflow-y-auto mb-4 border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg`}>
              <table className="w-full text-left text-xs">
                <thead className={`${styles.tableHeaderBg} uppercase`}>
                  <tr>
                    <th className="p-3">Tanggal</th>
                    <th className="p-3">Metode & Catatan</th>
                    <th className="p-3">Nominal</th>
                    <th className="p-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${styles.tableRowBorder}`}>
                  {paymentHistory.length === 0 ? (
                    <tr><td colSpan="4" className={`p-6 text-center ${styles.textSub}`}>Belum ada riwayat setoran pembayaran.</td></tr>
                  ) : (
                    paymentHistory.map(pay => (
                      <tr key={pay.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                        {editingPaymentId === pay.id ? (
                          <>
                            <td className="p-2" colSpan="3">
                              <div className="grid grid-cols-3 gap-2">
                                <input
                                  type="number"
                                  className={`${styles.inputBg} p-1.5 rounded`}
                                  value={paymentEditForm.amount}
                                  onChange={e => setPaymentEditForm({ ...paymentEditForm, amount: e.target.value })}
                                />
                                <select
                                  className={`${styles.inputBg} p-1.5 rounded`}
                                  value={paymentEditForm.paymentMethod}
                                  onChange={e => setPaymentEditForm({ ...paymentEditForm, paymentMethod: e.target.value })}
                                >
                                  <option value="Transfer Bank">Transfer Bank</option>
                                  <option value="Cash / Tunai">Cash / Tunai</option>
                                  <option value="EDC / Kartu">EDC / Kartu</option>
                                </select>
                                <input
                                  type="text"
                                  className={`${styles.inputBg} p-1.5 rounded`}
                                  value={paymentEditForm.notes}
                                  onChange={e => setPaymentEditForm({ ...paymentEditForm, notes: e.target.value })}
                                />
                              </div>
                            </td>
                            <td className="p-2 text-center">
                              <button onClick={() => handleSavePaymentEdit(pay.id)} className="px-2 py-1 bg-emerald-600 text-white text-[10px] rounded mr-1">
                                Simpan
                              </button>
                              <button onClick={() => setEditingPaymentId(null)} className={`px-2 py-1 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'} text-[10px] rounded`}>
                                Batal
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className={`p-3 ${styles.textSub}`}>
                              {formatDateDDMMYYYY(pay.createdAt)}
                            </td>
                            <td className="p-3">
                              <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-1.5 py-0.5 rounded text-[10px] mr-1`}>{pay.paymentMethod}</span>
                              <span className={styles.textSub}>{pay.notes}</span>
                            </td>
                            <td className="p-3 font-bold text-emerald-500">
                              Rp {Number(pay.amount).toLocaleString('id-ID')}
                            </td>
                            <td className="p-3 text-center">
                              <button
                                onClick={() => {
                                  setEditingPaymentId(pay.id);
                                  setPaymentEditForm({ amount: pay.amount, paymentMethod: pay.paymentMethod, notes: pay.notes });
                                }}
                                className="text-emerald-500 hover:underline mr-2"
                              >
                                Edit
                              </button>
                              <button onClick={() => handleDeletePayment(pay.id)} className="text-rose-500 hover:underline">
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

            <div className={`flex justify-between items-center pt-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'} text-xs`}>
              <span className={styles.textSub}>Total Tagihan: <strong className={styles.textTitle}>Rp {Number(selectedBookingForHistory.totalAmount).toLocaleString('id-ID')}</strong></span>
              <button onClick={() => setShowHistoryModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
