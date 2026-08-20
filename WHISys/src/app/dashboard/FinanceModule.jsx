'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, getDoc, deleteDoc, doc, updateDoc, query, where } from 'firebase/firestore';
import { Wallet, ArrowDownLeft, ArrowUpRight, X, Trash2, TrendingUp, BarChart3, Eye, Building2, CheckCircle2, RotateCcw, Clock, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import DateFieldID from '@/components/DateFieldID';

const DEFAULT_COMPANY_PROFILE = {
  name: 'PT. WISATA HALAL INTERNASIONAL',
  ppiuNumber: '',
  address: '',
  phone: '',
  email: ''
};

const loadImageAsDataURL = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    } catch (err) {
      reject(err);
    }
  };
  img.onerror = reject;
  img.src = src;
});

const OPERATIONAL_CATEGORIES = [
  'Sewa Kantor',
  'Gaji Staff',
  'Listrik & Internet',
  'ATK',
  'Marketing',
  'Lain-lain'
];

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const todayISODate = () => new Date().toISOString().slice(0, 10);

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const getPeriodKey = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const formatPeriodLabel = (periodKey) => {
  if (!periodKey || periodKey === 'all') return 'Semua Periode';
  const [year, month] = periodKey.split('-');
  return `${MONTH_NAMES_ID[Number(month) - 1]} ${year}`;
};

export default function FinanceModule({ onSelectBooking, theme = 'dark' }) {
  const isDark = theme === 'dark';

  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    tableHeaderBg: isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-slate-100 text-slate-500',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    tableRowBorder: isDark ? 'divide-slate-800/60' : 'divide-slate-200',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
    tabActive: isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-300 text-slate-900 font-bold',
  };

  const [transactions, setTransactions] = useState([]);
  const [vendorPayments, setVendorPayments] = useState([]);
  const [operationalExpenses, setOperationalExpenses] = useState([]);
  const [bookingsList, setBookingsList] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [showOperationalModal, setShowOperationalModal] = useState(false);
  const [activeTab, setActiveTab] = useState('income');

  const [showProfitDetailModal, setShowProfitDetailModal] = useState(false);
  const [selectedPackageForDetail, setSelectedPackageForDetail] = useState(null);

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

  const [operationalForm, setOperationalForm] = useState({
    category: OPERATIONAL_CATEGORIES[0],
    amount: '',
    notes: '',
    expenseDate: todayISODate()
  });

  const [plPeriod, setPlPeriod] = useState('all');
  const [companyProfile, setCompanyProfile] = useState(DEFAULT_COMPANY_PROFILE);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [showRecognizeModal, setShowRecognizeModal] = useState(false);
  const [pkgToRecognize, setPkgToRecognize] = useState(null);
  const [recognizeDateInput, setRecognizeDateInput] = useState(todayISODate());

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

      const opSnap = await getDocs(collection(db, 'expenses_operational'));
      setOperationalExpenses(opSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const profileSnap = await getDoc(doc(db, 'settings', 'company_profile'));
      if (profileSnap.exists() && profileSnap.data().company) {
        setCompanyProfile({ ...DEFAULT_COMPANY_PROFILE, ...profileSnap.data().company });
      }
    } catch (err) {
      console.error("Gagal mengambil data keuangan:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const syncBookingTotalPaid = async (bookingId) => {
    if (!bookingId) return;
    try {
      const q = query(collection(db, 'payments_income'), where('bookingId', '==', bookingId));
      const snap = await getDocs(q);
      const totalPaidReal = snap.docs.reduce((acc, curr) => acc + (Number(curr.data().amount) || 0), 0);

      const bkSnap = await getDocs(collection(db, 'bookings'));
      const targetBk = bkSnap.docs.find(d => d.id === bookingId);
      
      if (targetBk) {
        const totalAmount = Number(targetBk.data().totalAmount) || 0;
        const status = totalPaidReal >= totalAmount ? 'Full Payment' : 'DP Paid';

        await updateDoc(doc(db, 'bookings', bookingId), {
          totalPaid: totalPaidReal,
          paymentStatus: status
        });
      }
    } catch (err) {
      console.error("Gagal sinkronisasi data booking:", err);
    }
  };

  const handleDeleteIncome = async (txId, bookingId) => {
    if (!confirm("Apakah Anda yakin ingin menghapus catatan transaksi setoran ini?")) return;
    try {
      await deleteDoc(doc(db, 'payments_income', txId));
      if (bookingId) {
        await syncBookingTotalPaid(bookingId);
      }
      fetchData();
    } catch (err) {
      alert("Gagal menghapus transaksi: " + err.message);
    }
  };

  const handleDeleteVendorPayment = async (vpId) => {
    if (!confirm("Apakah Anda yakin ingin menghapus catatan pengeluaran vendor ini?")) return;
    try {
      await deleteDoc(doc(db, 'payments_vendor', vpId));
      fetchData();
    } catch (err) {
      alert("Gagal menghapus pembayaran vendor: " + err.message);
    }
  };

  const handleDeleteOperationalExpense = async (opId) => {
    if (!confirm("Apakah Anda yakin ingin menghapus catatan biaya operasional ini?")) return;
    try {
      await deleteDoc(doc(db, 'expenses_operational', opId));
      fetchData();
    } catch (err) {
      alert("Gagal menghapus biaya operasional: " + err.message);
    }
  };

  const handleUnrecognizeRevenue = async (pkg) => {
    const confirmMsg = `Batalkan pengakuan pendapatan untuk paket "${pkg.name}"? Omset & HPP paket ini akan kembali berstatus Diterima/Dibayar Dimuka dan keluar dari Laporan P&L.`;
    if (!confirm(confirmMsg)) return;

    try {
      await updateDoc(doc(db, 'packages', pkg.id), {
        revenueRecognized: false,
        recognizedAt: null
      });
      await fetchData();
      setSelectedPackageForDetail(prev =>
        prev && prev.id === pkg.id ? { ...prev, revenueRecognized: false, recognizedAt: null } : prev
      );
    } catch (err) {
      alert("Gagal membatalkan pengakuan pendapatan: " + err.message);
    }
  };

  const openRecognizeModal = (pkg) => {
    const parsedDeparture = pkg.departureDate ? new Date(pkg.departureDate) : null;
    const defaultDate = parsedDeparture && !isNaN(parsedDeparture.getTime())
      ? parsedDeparture.toISOString().slice(0, 10)
      : todayISODate();

    setPkgToRecognize(pkg);
    setRecognizeDateInput(defaultDate);
    setShowRecognizeModal(true);
  };

  const handleConfirmRecognizeRevenue = async (e) => {
    e.preventDefault();
    if (!pkgToRecognize) return;

    try {
      const isoDate = new Date(recognizeDateInput).toISOString();
      await updateDoc(doc(db, 'packages', pkgToRecognize.id), {
        revenueRecognized: true,
        recognizedAt: isoDate
      });
      await fetchData();
      setSelectedPackageForDetail(prev =>
        prev && prev.id === pkgToRecognize.id ? { ...prev, revenueRecognized: true, recognizedAt: isoDate } : prev
      );
      setShowRecognizeModal(false);
      setPkgToRecognize(null);
    } catch (err) {
      alert("Gagal mengakui pendapatan: " + err.message);
    }
  };

  const handleIncomeSubmit = async (e) => {
    e.preventDefault();
    try {
      const selectedBooking = bookingsList.find(b => b.id === incomeForm.bookingId);
      if (!selectedBooking) return;

      const amountVal = Number(incomeForm.amount);

      await addDoc(collection(db, 'payments_income'), {
        bookingId: selectedBooking.id,
        bookingCode: selectedBooking.bookingCode,
        jamaahName: selectedBooking.jamaahName,
        packageId: selectedBooking.packageId,
        packageName: selectedBooking.packageName,
        amount: amountVal,
        paymentMethod: incomeForm.paymentMethod,
        notes: incomeForm.notes,
        createdAt: new Date().toISOString()
      });

      await syncBookingTotalPaid(selectedBooking.id);

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
      if (!selectedPkg) {
        alert("Pilih paket keberangkatan terkait dulu. Kalau ini biaya kantor yang bukan buat trip tertentu, catat lewat tombol \"Biaya Operasional Kantor\", bukan di sini.");
        return;
      }

      await addDoc(collection(db, 'payments_vendor'), {
        packageId: selectedPkg.id,
        packageName: selectedPkg.name,
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

  const handleOperationalSubmit = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'expenses_operational'), {
        category: operationalForm.category,
        amount: Number(operationalForm.amount),
        notes: operationalForm.notes,
        expenseDate: operationalForm.expenseDate || todayISODate(),
        createdAt: new Date().toISOString()
      });

      setShowOperationalModal(false);
      setOperationalForm({ category: OPERATIONAL_CATEGORIES[0], amount: '', notes: '', expenseDate: todayISODate() });
      fetchData();
    } catch (err) {
      alert("Gagal mencatat biaya operasional: " + err.message);
    }
  };

  const totalIncome = transactions.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalVendorPaid = vendorPayments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalOperational = operationalExpenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const netCashflow = totalIncome - totalVendorPaid - totalOperational;

  // Paket terkait suatu setoran/pembayaran vendor, dipakai buat cek status pengakuan pendapatan.
  // Prioritas cari lewat packageId (akurat, nggak ambigu). packageName cuma
  // fallback buat setoran lama yang dicatat sebelum field packageId ada —
  // matching pakai nama rawan salah kalau ada 2 paket dengan nama sama persis.
  const findPackageForIncome = (tx) => {
    if (tx.packageId) {
      const byId = packagesList.find(p => p.id === tx.packageId);
      if (byId) return byId;
    }
    return packagesList.find(p => p.name === tx.packageName) || null;
  };
  const findPackageForVendor = (vp) => {
    if (!vp.packageId || vp.packageId === 'GLOBAL') return null;
    return packagesList.find(p => p.id === vp.packageId) || packagesList.find(p => p.name === vp.packageName) || null;
  };

  // Kalau transaksi nggak nempel ke paket manapun (mis. biaya vendor umum / paket sudah dihapus),
  // dianggap langsung diakui — nggak ada tombol pengakuan yang bisa diklik buat itu.
  const isIncomeRecognized = (tx) => {
    const pkg = findPackageForIncome(tx);
    return pkg ? !!pkg.revenueRecognized : true;
  };
  const isVendorRecognized = (vp) => {
    const pkg = findPackageForVendor(vp);
    return pkg ? !!pkg.revenueRecognized : true;
  };

  const recognizedPeriodForIncome = (tx) => {
    const pkg = findPackageForIncome(tx);
    return pkg?.recognizedAt ? getPeriodKey(pkg.recognizedAt) : getPeriodKey(tx.createdAt);
  };
  const recognizedPeriodForVendor = (vp) => {
    const pkg = findPackageForVendor(vp);
    return pkg?.recognizedAt ? getPeriodKey(pkg.recognizedAt) : getPeriodKey(vp.createdAt);
  };

  const recognizedTransactions = transactions.filter(isIncomeRecognized);
  const recognizedVendorPayments = vendorPayments.filter(isVendorRecognized);
  const unrecognizedTransactions = transactions.filter(tx => !isIncomeRecognized(tx));
  const unrecognizedVendorPayments = vendorPayments.filter(vp => !isVendorRecognized(vp));

  const totalDeferredRevenue = unrecognizedTransactions.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalPrepaidExpense = unrecognizedVendorPayments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

  const availablePeriods = Array.from(new Set([
    ...recognizedTransactions.map(recognizedPeriodForIncome),
    ...recognizedVendorPayments.map(recognizedPeriodForVendor),
    ...operationalExpenses.map(op => getPeriodKey(op.expenseDate || op.createdAt))
  ].filter(Boolean))).sort().reverse();

  const incomeInPeriod = plPeriod === 'all'
    ? recognizedTransactions
    : recognizedTransactions.filter(tx => recognizedPeriodForIncome(tx) === plPeriod);

  const vendorInPeriod = plPeriod === 'all'
    ? recognizedVendorPayments
    : recognizedVendorPayments.filter(vp => recognizedPeriodForVendor(vp) === plPeriod);

  const operationalInPeriod = plPeriod === 'all'
    ? operationalExpenses
    : operationalExpenses.filter(op => getPeriodKey(op.expenseDate || op.createdAt) === plPeriod);

  const plOmset = incomeInPeriod.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const plHpp = vendorInPeriod.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const plLabaKotor = plOmset - plHpp;
  const plOpex = operationalInPeriod.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const plLabaBersih = plLabaKotor - plOpex;

  const selectedPkgIncomes = selectedPackageForDetail
    ? transactions.filter(tx => tx.packageId === selectedPackageForDetail.id || (!tx.packageId && tx.packageName === selectedPackageForDetail.name))
    : [];

  const selectedPkgVendorCosts = selectedPackageForDetail
    ? vendorPayments.filter(vp => vp.packageId === selectedPackageForDetail.id || (!vp.packageId && vp.packageName === selectedPackageForDetail.name))
    : [];

  const totalSelectedPkgIncome = selectedPkgIncomes.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalSelectedPkgVendorCost = selectedPkgVendorCosts.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const selectedPkgProfit = totalSelectedPkgIncome - totalSelectedPkgVendorCost;

  // Paket yang sudah diakui pendapatannya & masuk hitungan periode P&L yang lagi difilter — dipakai buat laporan PDF.
  const recognizedPackagesInPeriod = packagesList.filter(pkg => {
    if (!pkg.revenueRecognized) return false;
    if (plPeriod === 'all') return true;
    return getPeriodKey(pkg.recognizedAt) === plPeriod;
  }).map(pkg => {
    const pkgIncome = transactions
      .filter(tx => tx.packageId === pkg.id || (!tx.packageId && tx.packageName === pkg.name))
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const pkgVendorCost = vendorPayments
      .filter(vp => vp.packageId === pkg.id || (!vp.packageId && vp.packageName === pkg.name))
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    return { pkg, pkgIncome, pkgVendorCost, profit: pkgIncome - pkgVendorCost };
  });

  const handleDownloadProfitLossPDF = async () => {
    setGeneratingPdf(true);
    try {
      const docPdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageWidth = docPdf.internal.pageSize.getWidth();
      const marginX = 14;
      let cursorY = 16;

      // Kop surat
      try {
        const logoDataUrl = await loadImageAsDataURL('/logo.png');
        docPdf.addImage(logoDataUrl, 'PNG', marginX, cursorY - 4, 18, 18);
      } catch (err) {
        console.warn('Logo tidak berhasil dimuat untuk PDF:', err);
      }

      const textStartX = marginX + 22;
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(13);
      docPdf.text(companyProfile.name || DEFAULT_COMPANY_PROFILE.name, textStartX, cursorY);

      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(8.5);
      let subY = cursorY + 5;
      if (companyProfile.ppiuNumber) {
        docPdf.text(companyProfile.ppiuNumber, textStartX, subY);
        subY += 4;
      }
      if (companyProfile.address) {
        docPdf.text(companyProfile.address, textStartX, subY, { maxWidth: pageWidth - textStartX - marginX });
        subY += 4;
      }
      const contactLine = [companyProfile.phone, companyProfile.email].filter(Boolean).join('  •  ');
      if (contactLine) {
        docPdf.text(contactLine, textStartX, subY);
        subY += 4;
      }

      cursorY = Math.max(cursorY + 18, subY) + 2;
      docPdf.setDrawColor(180);
      docPdf.line(marginX, cursorY, pageWidth - marginX, cursorY);
      cursorY += 8;

      // Judul laporan
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(12);
      docPdf.text('LAPORAN LABA RUGI (PROFIT & LOSS)', pageWidth / 2, cursorY, { align: 'center' });
      cursorY += 6;
      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(9);
      docPdf.text(`Periode: ${formatPeriodLabel(plPeriod)}`, pageWidth / 2, cursorY, { align: 'center' });
      cursorY += 4.5;
      docPdf.setFontSize(8);
      docPdf.setTextColor(120);
      docPdf.text(`Dicetak: ${formatDateDDMMYYYY(new Date().toISOString())}`, pageWidth / 2, cursorY, { align: 'center' });
      docPdf.setTextColor(0);
      cursorY += 8;

      // Ringkasan P&L
      autoTable(docPdf, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Komponen', 'Nominal (Rp)']],
        body: [
          ['Omset (Pendapatan Diakui)', plOmset.toLocaleString('id-ID')],
          ['HPP / Biaya Vendor', `(${plHpp.toLocaleString('id-ID')})`],
          ['Laba Kotor', plLabaKotor.toLocaleString('id-ID')],
          ['Biaya Operasional Kantor', `(${plOpex.toLocaleString('id-ID')})`],
          ['Laba Bersih', plLabaBersih.toLocaleString('id-ID')]
        ],
        styles: { fontSize: 9, cellPadding: 2.5 },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 1: { halign: 'right' } },
        didParseCell: (data) => {
          if (data.row.index === 4 && data.section === 'body') {
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });

      cursorY = docPdf.lastAutoTable.finalY + 8;

      // Breakdown per paket (yang sudah diakui, sesuai periode terpilih)
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(10);
      docPdf.text('Rincian Margin per Paket (Pendapatan Sudah Diakui)', marginX, cursorY);
      cursorY += 4;

      if (recognizedPackagesInPeriod.length === 0) {
        docPdf.setFont('helvetica', 'italic');
        docPdf.setFontSize(9);
        docPdf.text('Belum ada paket dengan pendapatan diakui pada periode ini.', marginX, cursorY + 4);
        cursorY += 10;
      } else {
        autoTable(docPdf, {
          startY: cursorY + 2,
          margin: { left: marginX, right: marginX },
          head: [['Nama Paket', 'Omset', 'HPP Vendor', 'Laba/Margin']],
          body: recognizedPackagesInPeriod.map(({ pkg, pkgIncome, pkgVendorCost, profit }) => [
            `${pkg.name}${pkg.code ? ` (${pkg.code})` : ''}`,
            pkgIncome.toLocaleString('id-ID'),
            pkgVendorCost.toLocaleString('id-ID'),
            profit.toLocaleString('id-ID')
          ]),
          styles: { fontSize: 8.5, cellPadding: 2.5 },
          headStyles: { fillColor: [15, 23, 42] },
          columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
        });
        cursorY = docPdf.lastAutoTable.finalY + 10;
      }

      // Blok tanda tangan
      if (cursorY > 250) {
        docPdf.addPage();
        cursorY = 20;
      }
      const signColWidth = (pageWidth - marginX * 2) / 2;
      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(9);
      docPdf.text('Dibuat oleh,', marginX, cursorY);
      docPdf.text('Mengetahui,', marginX + signColWidth, cursorY);
      cursorY += 22;
      docPdf.text('( ______________________ )', marginX, cursorY);
      docPdf.text('( ______________________ )', marginX + signColWidth, cursorY);
      cursorY += 4.5;
      docPdf.setFontSize(8);
      docPdf.setTextColor(120);
      docPdf.text('Finance / Admin', marginX, cursorY);
      docPdf.text('Direktur', marginX + signColWidth, cursorY);
      docPdf.setTextColor(0);

      const fileSuffix = plPeriod === 'all' ? 'semua-periode' : plPeriod;
      docPdf.save(`Laporan-Laba-Rugi-WHISys-${fileSuffix}.pdf`);
    } catch (err) {
      console.error('Gagal membuat PDF laporan:', err);
      alert('Gagal membuat PDF laporan: ' + err.message);
    }
    setGeneratingPdf(false);
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Wallet className="w-5 h-5 text-emerald-500" /> Arus Kas Operasional & Payments
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Pencatatan setoran jamaah dan pembayaran deposit/pelunasan vendor.</p>
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
          <button
            onClick={() => setShowOperationalModal(true)}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
          >
            <Building2 className="w-4 h-4" /> + Biaya Operasional Kantor
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className={`${styles.cardBg} border p-5 rounded-xl`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Total Kas Masuk (Jamaah)</p>
          <h3 className="text-2xl font-bold text-emerald-500">Rp {totalIncome.toLocaleString('id-ID')}</h3>
        </div>
        <div className={`${styles.cardBg} border p-5 rounded-xl`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Total Keluar (Vendor & Flight)</p>
          <h3 className="text-2xl font-bold text-rose-500">Rp {totalVendorPaid.toLocaleString('id-ID')}</h3>
        </div>
        <div className={`${styles.cardBg} border p-5 rounded-xl`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Total Biaya Operasional Kantor</p>
          <h3 className="text-2xl font-bold text-amber-500">Rp {totalOperational.toLocaleString('id-ID')}</h3>
        </div>
        <div className={`${styles.cardBg} border p-5 rounded-xl`}>
          <p className={`text-xs ${styles.textSub} mb-1`}>Saldo Kas Bersih Operasional</p>
          <h3 className={`text-2xl font-bold ${netCashflow >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>
            Rp {netCashflow.toLocaleString('id-ID')}
          </h3>
        </div>
      </div>

      <div className={`flex gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-2`}>
        <button
          onClick={() => setActiveTab('income')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'income' ? `${styles.tabActive} text-emerald-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          Riwayat Setoran Jamaah ({transactions.length})
        </button>
        <button
          onClick={() => setActiveTab('vendor')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'vendor' ? `${styles.tabActive} text-rose-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          Riwayat Bayar Vendor ({vendorPayments.length})
        </button>
        <button
          onClick={() => setActiveTab('operational')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'operational' ? `${styles.tabActive} text-amber-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          Biaya Operasional Kantor ({operationalExpenses.length})
        </button>
        <button
          onClick={() => setActiveTab('profit_loss')}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
            activeTab === 'profit_loss' ? `${styles.tabActive} text-amber-500 border` : `${styles.textSub} hover:${styles.textTitle}`
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" /> Laporan Keuangan (P&L)
        </button>
      </div>

      {activeTab === 'income' && (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <tr>
                  <th className="p-4">Kode Booking / Jamaah</th>
                  <th className="p-4">Paket Travel</th>
                  <th className="p-4">Metode & Catatan</th>
                  <th className="p-4">Tanggal Setor</th>
                  <th className="p-4 text-right">Nominal Masuk</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan="6" className={`p-8 text-center ${styles.textSub}`}>Belum ada transaksi setoran jamaah.</td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>
                        {tx.jamaahName}
                        <button
                          type="button"
                          onClick={() => {
                            if (onSelectBooking && tx.bookingId) {
                              onSelectBooking(tx.bookingId);
                            }
                          }}
                          className="block text-[10px] text-emerald-500 font-mono hover:underline text-left cursor-pointer"
                        >
                          {tx.bookingCode} ↗
                        </button>
                      </td>
                      <td className={`p-4 ${styles.textTitle}`}>{tx.packageName}</td>
                      <td className="p-4">
                        <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] mr-1`}>{tx.paymentMethod}</span>
                        <span className={styles.textSub}>{tx.notes}</span>
                      </td>
                      <td className={`p-4 ${styles.textSub}`}>{formatDateDDMMYYYY(tx.createdAt)}</td>
                      <td className="p-4 text-right font-bold text-emerald-500">
                        + Rp {Number(tx.amount).toLocaleString('id-ID')}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleDeleteIncome(tx.id, tx.bookingId)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                          title="Hapus Transaksi Setoran"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <tr>
                  <th className="p-4">Nama Vendor / Supplier</th>
                  <th className="p-4">Kategori Layanan</th>
                  <th className="p-4">Paket Terkait</th>
                  <th className="p-4">Catatan & Tanggal</th>
                  <th className="p-4 text-right">Nominal Dibayar</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {vendorPayments.length === 0 ? (
                  <tr>
                    <td colSpan="6" className={`p-8 text-center ${styles.textSub}`}>Belum ada riwayat pembayaran vendor.</td>
                  </tr>
                ) : (
                  vendorPayments.map((vp) => (
                    <tr key={vp.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>{vp.vendorName}</td>
                      <td className="p-4">
                        <span className="bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2.5 py-1 rounded-full font-medium">
                          {vp.category}
                        </span>
                      </td>
                      <td className={`p-4 ${styles.textTitle}`}>
                        {vp.packageName}
                        {vp.packageId === 'GLOBAL' && (
                          <span className="block text-[10px] text-amber-500 font-medium mt-0.5">
                            ⚠ Data lama tanpa paket — review manual
                          </span>
                        )}
                      </td>
                      <td className={`p-4 ${styles.textSub}`}>
                        {vp.notes}
                        <span className="block text-[10px] text-slate-400">{formatDateDDMMYYYY(vp.createdAt)}</span>
                      </td>
                      <td className="p-4 text-right font-bold text-rose-500">
                        - Rp {Number(vp.amount).toLocaleString('id-ID')}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleDeleteVendorPayment(vp.id)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                          title="Hapus Pembayaran Vendor"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'operational' && (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <tr>
                  <th className="p-4">Kategori</th>
                  <th className="p-4">Catatan & Tanggal</th>
                  <th className="p-4 text-right">Nominal Keluar</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {operationalExpenses.length === 0 ? (
                  <tr>
                    <td colSpan="4" className={`p-8 text-center ${styles.textSub}`}>Belum ada catatan biaya operasional kantor.</td>
                  </tr>
                ) : (
                  operationalExpenses.map((op) => (
                    <tr key={op.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                      <td className="p-4">
                        <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-1 rounded-full font-medium">
                          {op.category}
                        </span>
                      </td>
                      <td className={`p-4 ${styles.textSub}`}>
                        {op.notes || '-'}
                        <span className="block text-[10px] text-slate-400">{formatDateDDMMYYYY(op.expenseDate || op.createdAt)}</span>
                      </td>
                      <td className="p-4 text-right font-bold text-amber-500">
                        - Rp {Number(op.amount).toLocaleString('id-ID')}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleDeleteOperationalExpense(op.id)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                          title="Hapus Biaya Operasional"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'profit_loss' && (
        <div className="space-y-4">
          <div className={`${styles.cardBg} border rounded-xl overflow-hidden p-4`}>
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-4">
              <div>
                <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
                  <TrendingUp className="w-4 h-4 text-amber-500" /> Laporan Laba Rugi (P&L) Perusahaan
                </h4>
                <p className={`text-xs ${styles.textSub} mt-1`}>
                  Omset seluruh jamaah dikurangi HPP vendor dan biaya operasional kantor — {formatPeriodLabel(plPeriod)}.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className={`${styles.inputBg} rounded-lg p-2 text-xs border`}
                  value={plPeriod}
                  onChange={e => setPlPeriod(e.target.value)}
                >
                  <option value="all">Semua Periode</option>
                  {availablePeriods.map(p => (
                    <option key={p} value={p}>{formatPeriodLabel(p)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleDownloadProfitLossPDF}
                  disabled={generatingPdf}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" /> {generatingPdf ? 'Membuat PDF...' : 'Download Laporan (PDF)'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Omset (Pemasukan)</span>
                <p className="text-sm font-bold text-emerald-500 mt-1">Rp {plOmset.toLocaleString('id-ID')}</p>
              </div>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>HPP Vendor</span>
                <p className="text-sm font-bold text-rose-500 mt-1">Rp {plHpp.toLocaleString('id-ID')}</p>
              </div>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Laba Kotor</span>
                <p className={`text-sm font-bold mt-1 ${plLabaKotor >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>Rp {plLabaKotor.toLocaleString('id-ID')}</p>
              </div>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Biaya Operasional</span>
                <p className="text-sm font-bold text-amber-500 mt-1">Rp {plOpex.toLocaleString('id-ID')}</p>
              </div>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Laba Bersih</span>
                <p className={`text-sm font-bold mt-1 ${plLabaBersih >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>Rp {plLabaBersih.toLocaleString('id-ID')}</p>
              </div>
            </div>

            <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg border ${isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                <p className={`text-[11px] ${styles.textSub}`}>
                  <span className={`font-bold ${styles.textTitle}`}>Pendapatan Diterima Dimuka: Rp {totalDeferredRevenue.toLocaleString('id-ID')}</span><br/>
                  Setoran jamaah yang paketnya belum diklik "Akui Pendapatan" — belum masuk P&L.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                <p className={`text-[11px] ${styles.textSub}`}>
                  <span className={`font-bold ${styles.textTitle}`}>Biaya Dibayar Dimuka: Rp {totalPrepaidExpense.toLocaleString('id-ID')}</span><br/>
                  Pembayaran vendor yang paketnya belum diklik "Akui Pendapatan" — belum masuk P&L.
                </p>
              </div>
            </div>
          </div>

          <div className={`${styles.cardBg} border rounded-xl overflow-hidden p-4`}>
            <h4 className={`text-sm font-bold ${styles.textTitle} mb-2 flex items-center gap-2`}>
              <BarChart3 className="w-4 h-4 text-amber-500" /> Analisis Margin Laba Operasional per Program Paket
            </h4>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Membandingkan total setoran jamaah yang masuk (Omset Real) terhadap realisasi pembayaran biaya vendor (HPP). Klik <strong>Akui Pendapatan</strong> pada paket yang jasanya sudah terealisasi (mis. jamaah sudah berangkat) biar omset & HPP-nya masuk ke Laporan P&L. Sebelum diklik, nilainya tercatat sebagai Pendapatan/Biaya Dibayar Dimuka.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className={`${styles.tableHeaderBg} uppercase border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <tr>
                    <th className="p-4">Nama Program Paket</th>
                    <th className="p-4 text-right">Pemasukan (Omset)</th>
                    <th className="p-4 text-right">HPP / Biaya Vendor</th>
                    <th className="p-4 text-right">Laba / Margin Bersih</th>
                    <th className="p-4 text-center">Status Margin</th>
                    <th className="p-4 text-center">Status Pengakuan</th>
                    <th className="p-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${styles.tableRowBorder}`}>
                  {packagesList.length === 0 ? (
                    <tr>
                      <td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Belum ada paket perjalanan terdaftar.</td>
                    </tr>
                  ) : (
                    packagesList.map((pkg) => {
                      const pkgIncome = transactions
                        .filter(tx => tx.packageId === pkg.id || (!tx.packageId && tx.packageName === pkg.name))
                        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

                      const pkgVendorCost = vendorPayments
                        .filter(vp => vp.packageId === pkg.id || (!vp.packageId && vp.packageName === pkg.name))
                        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

                      const profit = pkgIncome - pkgVendorCost;
                      const isProfit = profit >= 0;

                      return (
                        <tr key={pkg.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                          <td className={`p-4 font-semibold ${styles.textTitle}`}>
                            {pkg.name}
                            <span className={`block text-[10px] ${styles.textSub} font-mono`}>{pkg.code} • Keberangkatan: {formatDateDDMMYYYY(pkg.departureDate)}</span>
                          </td>
                          <td className="p-4 text-right font-bold text-emerald-500">
                            Rp {pkgIncome.toLocaleString('id-ID')}
                          </td>
                          <td className="p-4 text-right font-bold text-rose-500">
                            Rp {pkgVendorCost.toLocaleString('id-ID')}
                          </td>
                          <td className={`p-4 text-right font-extrabold ${isProfit ? 'text-blue-500' : 'text-amber-500'}`}>
                            Rp {profit.toLocaleString('id-ID')}
                          </td>
                          <td className="p-4 text-center">
                            {isProfit ? (
                              <span className="inline-block px-2.5 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full font-bold text-[10px]">
                                PROFIT
                              </span>
                            ) : (
                              <span className="inline-block px-2.5 py-1 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-full font-bold text-[10px]">
                                DEFISIT
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            {pkg.revenueRecognized ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-bold text-[10px]">
                                  <CheckCircle2 className="w-3 h-3" /> DIAKUI
                                </span>
                                <span className="text-[10px] text-slate-400">{formatDateDDMMYYYY(pkg.recognizedAt)}</span>
                                <button
                                  type="button"
                                  onClick={() => handleUnrecognizeRevenue(pkg)}
                                  className="text-[10px] text-slate-400 hover:text-rose-500 inline-flex items-center gap-1 underline"
                                >
                                  <RotateCcw className="w-3 h-3" /> Batalkan
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-500/10 text-slate-400 border border-slate-500/20 rounded-full font-bold text-[10px]">
                                  <Clock className="w-3 h-3" /> DITERIMA DIMUKA
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openRecognizeModal(pkg)}
                                  className="mt-0.5 px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-[10px] font-medium inline-flex items-center gap-1"
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Akui Pendapatan
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            <button
                              onClick={() => {
                                setSelectedPackageForDetail(pkg);
                                setShowProfitDetailModal(true);
                              }}
                              className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-amber-500 rounded-lg transition-colors inline-flex items-center gap-1`}
                              title="Lihat Rincian Laba Rugi Paket Ini"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showProfitDetailModal && selectedPackageForDetail && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-3xl p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button 
              onClick={() => setShowProfitDetailModal(false)} 
              className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <BarChart3 className="w-5 h-5 text-amber-500" /> Breakdown Laba Rugi Program Paket
            </h3>
            <p className={`text-xs ${styles.textSub} mb-3`}>
              Paket: <strong className={styles.textTitle}>{selectedPackageForDetail.name}</strong> • Kode: <span className="font-mono text-emerald-500">{selectedPackageForDetail.code}</span>
            </p>

            <div className="mb-4">
              {selectedPackageForDetail.revenueRecognized ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-bold text-[10px]">
                    <CheckCircle2 className="w-3 h-3" /> PENDAPATAN SUDAH DIAKUI ({formatDateDDMMYYYY(selectedPackageForDetail.recognizedAt)})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleUnrecognizeRevenue(selectedPackageForDetail)}
                    className="text-[10px] text-slate-400 hover:text-rose-500 inline-flex items-center gap-1 underline"
                  >
                    <RotateCcw className="w-3 h-3" /> Batalkan Pengakuan
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-500/10 text-slate-400 border border-slate-500/20 rounded-full font-bold text-[10px]">
                    <Clock className="w-3 h-3" /> DITERIMA / DIBAYAR DIMUKA — BELUM MASUK P&L
                  </span>
                  <button
                    type="button"
                    onClick={() => openRecognizeModal(selectedPackageForDetail)}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-[10px] font-medium inline-flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Akui Pendapatan Sekarang
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Total Omset (Setoran)</span>
                <p className="text-sm font-bold text-emerald-500 mt-1">Rp {totalSelectedPkgIncome.toLocaleString('id-ID')}</p>
              </div>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Total Biaya Vendor (HPP)</span>
                <p className="text-sm font-bold text-rose-500 mt-1">Rp {totalSelectedPkgVendorCost.toLocaleString('id-ID')}</p>
              </div>
              <div className={`${styles.innerBg} p-3 rounded-lg border text-center`}>
                <span className={`text-[10px] ${styles.textSub} uppercase`}>Margin Laba Bersih</span>
                <p className={`text-sm font-bold mt-1 ${selectedPkgProfit >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                  Rp {selectedPkgProfit.toLocaleString('id-ID')}
                </p>
              </div>
            </div>

            <div className="space-y-6 text-xs">
              <div>
                <h5 className="font-bold text-emerald-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                  <ArrowDownLeft className="w-4 h-4" /> Rincian Pemasukan Setoran Jamaah ({selectedPkgIncomes.length})
                </h5>
                <div className={`overflow-x-auto border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg`}>
                  <table className="w-full text-left">
                    <thead className={`${styles.tableHeaderBg} uppercase`}>
                      <tr>
                        <th className="p-2.5">Tanggal</th>
                        <th className="p-2.5">Jamaah & Booking</th>
                        <th className="p-2.5">Metode & Catatan</th>
                        <th className="p-2.5 text-right">Nominal</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {selectedPkgIncomes.length === 0 ? (
                        <tr><td colSpan="4" className={`p-4 text-center ${styles.textSub}`}>Belum ada setoran jamaah untuk paket ini.</td></tr>
                      ) : (
                        selectedPkgIncomes.map((tx) => (
                          <tr key={tx.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                            <td className={`p-2.5 ${styles.textSub}`}>{formatDateDDMMYYYY(tx.createdAt)}</td>
                            <td className={`p-2.5 font-semibold ${styles.textTitle}`}>
                              {tx.jamaahName}
                              <span className="block text-[10px] text-emerald-500 font-mono">{tx.bookingCode}</span>
                            </td>
                            <td className="p-2.5">
                              <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-1.5 py-0.5 rounded text-[10px] mr-1`}>{tx.paymentMethod}</span>
                              <span className={styles.textSub}>{tx.notes}</span>
                            </td>
                            <td className="p-2.5 text-right font-bold text-emerald-500">+ Rp {Number(tx.amount).toLocaleString('id-ID')}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h5 className="font-bold text-rose-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                  <ArrowUpRight className="w-4 h-4" /> Rincian Pengeluaran HPP Vendor ({selectedPkgVendorCosts.length})
                </h5>
                <div className={`overflow-x-auto border ${isDark ? 'border-slate-800' : 'border-slate-200'} rounded-lg`}>
                  <table className="w-full text-left">
                    <thead className={`${styles.tableHeaderBg} uppercase`}>
                      <tr>
                        <th className="p-2.5">Tanggal</th>
                        <th className="p-2.5">Vendor & Kategori</th>
                        <th className="p-2.5">Catatan Pengeluaran</th>
                        <th className="p-2.5 text-right">Nominal HPP</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${styles.tableRowBorder}`}>
                      {selectedPkgVendorCosts.length === 0 ? (
                        <tr><td colSpan="4" className={`p-4 text-center ${styles.textSub}`}>Belum ada biaya vendor untuk paket ini.</td></tr>
                      ) : (
                        selectedPkgVendorCosts.map((vp) => (
                          <tr key={vp.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                            <td className={`p-2.5 ${styles.textSub}`}>{formatDateDDMMYYYY(vp.createdAt)}</td>
                            <td className={`p-2.5 font-semibold ${styles.textTitle}`}>
                              {vp.vendorName}
                              <span className="block text-[10px] text-rose-500">{vp.category}</span>
                            </td>
                            <td className={`p-2.5 ${styles.textSub}`}>{vp.notes}</td>
                            <td className="p-2.5 text-right font-bold text-rose-500">- Rp {Number(vp.amount).toLocaleString('id-ID')}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className={`flex justify-end pt-4 mt-6 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <button 
                onClick={() => setShowProfitDetailModal(false)} 
                className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}
              >
                Tutup Detail
              </button>
            </div>
          </div>
        </div>
      )}

      {showIncomeModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
            <button onClick={() => setShowIncomeModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <ArrowDownLeft className="w-5 h-5 text-emerald-500" /> Catat Setoran Pembayaran Jamaah
            </h3>

            <form onSubmit={handleIncomeSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Pilih Booking Jamaah</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
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
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={incomeForm.amount}
                  onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Metode</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
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
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={incomeForm.notes}
                    onChange={e => setIncomeForm({ ...incomeForm, notes: e.target.value })}
                  />
                </div>
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowIncomeModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
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

      {showVendorModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
            <button onClick={() => setShowVendorModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <ArrowUpRight className="w-5 h-5 text-rose-500" /> Catat Pembayaran Vendor / Supplier
            </h3>

            <form onSubmit={handleVendorSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Paket Keberangkatan Terkait</label>
                <select
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorForm.packageId}
                  onChange={e => setVendorForm({ ...vendorForm, packageId: e.target.value })}
                >
                  <option value="">-- Pilih Paket --</option>
                  {packagesList.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                  ))}
                </select>
                <p className={`text-[10.5px] ${styles.textSub} mt-1`}>
                  Biaya kantor yang bukan buat trip tertentu (sewa, gaji, listrik, dll) dicatat lewat tombol <strong>"+ Biaya Operasional Kantor"</strong>, bukan di sini.
                </p>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nama Vendor / Perusahaan</label>
                <input
                  type="text" required placeholder="Contoh: Saudi Airlines / Hotel Pullman Makkah"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorForm.vendorName}
                  onChange={e => setVendorForm({ ...vendorForm, vendorName: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Kategori Pengeluaran</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
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
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={vendorForm.amount}
                    onChange={e => setVendorForm({ ...vendorForm, amount: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Keterangan Catatan</label>
                <input
                  type="text" placeholder="DP Deposit 50% Tiket Group"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={vendorForm.notes}
                  onChange={e => setVendorForm({ ...vendorForm, notes: e.target.value })}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowVendorModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
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

      {showOperationalModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
            <button onClick={() => setShowOperationalModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <Building2 className="w-5 h-5 text-amber-500" /> Catat Biaya Operasional Kantor
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Khusus buat pengeluaran yang bukan biaya trip/vendor — misalnya sewa kantor, gaji staff, listrik, ATK, dll.
            </p>

            <form onSubmit={handleOperationalSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Kategori Biaya</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={operationalForm.category}
                    onChange={e => setOperationalForm({ ...operationalForm, category: e.target.value })}
                  >
                    {OPERATIONAL_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Nominal (Rp)</label>
                  <input
                    type="number" required placeholder="2500000"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={operationalForm.amount}
                    onChange={e => setOperationalForm({ ...operationalForm, amount: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Tanggal Biaya</label>
                <DateFieldID
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={operationalForm.expenseDate}
                  onChange={(val) => setOperationalForm({ ...operationalForm, expenseDate: val })}
                />
              </div>

              <div>
                <label className="block mb-1 font-medium">Keterangan Catatan</label>
                <input
                  type="text" placeholder="Contoh: Sewa kantor bulan Agustus 2026"
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={operationalForm.notes}
                  onChange={e => setOperationalForm({ ...operationalForm, notes: e.target.value })}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowOperationalModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium">
                  Simpan Biaya Operasional
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRecognizeModal && pkgToRecognize && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
            <button
              onClick={() => { setShowRecognizeModal(false); setPkgToRecognize(null); }}
              className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <CheckCircle2 className="w-5 h-5 text-blue-500" /> Akui Pendapatan Paket
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              Paket: <strong className={styles.textTitle}>{pkgToRecognize.name}</strong>. Pilih tanggal pengakuan pendapatan — biasanya tanggal keberangkatan atau tanggal jasa benar-benar terealisasi. Omset & HPP paket ini akan masuk Laporan P&L di periode sesuai tanggal ini, bukan tanggal kamu klik tombol ini.
            </p>

            <form onSubmit={handleConfirmRecognizeRevenue} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Tanggal Pengakuan Pendapatan</label>
                <DateFieldID
                  required
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={recognizeDateInput}
                  onChange={(val) => setRecognizeDateInput(val)}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button
                  type="button"
                  onClick={() => { setShowRecognizeModal(false); setPkgToRecognize(null); }}
                  className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}
                >
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium">
                  Konfirmasi & Akui Pendapatan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
