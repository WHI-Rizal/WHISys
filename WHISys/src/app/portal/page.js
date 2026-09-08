'use client';

import { useEffect, useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, runTransaction
} from 'firebase/firestore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  LogIn, LogOut, Loader2, AlertTriangle, Plane, Wallet, FileCheck, CheckCircle2,
  XCircle, Ban, RotateCcw, Clock, ShieldCheck, Download, Gauge, Upload, Eye
} from 'lucide-react';
import DateFieldID from '@/components/DateFieldID';

// ============================================================================
// PORTAL CUSTOMER — Tahap 2 (view + progress Kesiapan Berangkat + download
// kwitansi PDF)
//
// Login pakai Kode Jamaah (customerCode) + Tanggal Lahir, TANPA password,
// TANPA akun staf. Sengaja dibikin nggak percaya apapun dari input customer
// begitu aja — data ditampilin cuma kalau kombinasi kode + tanggal lahirnya
// beneran cocok sama data di Firestore (mirip pola verifikasi di halaman
// feedback publik /feedback/[bookingCode] yang udah jalan).
//
// Rate-limit percobaan login (biar nggak gampang di-brute-force, soalnya
// Kode Jamaah formatnya berurutan/gampang ditebak) disimpan di collection
// terpisah 'portalLoginAttempts', dikunci per Kode Jamaah — BUKAN nyimpen
// data sensitif apapun, cuma counter + waktu kunci.
//
// Upload dokumen dari customer (paspor/KTP/dll) DISIMPEN KE GOOGLE DRIVE,
// bukan Firebase Storage — sengaja, biar nggak perlu upgrade project
// Firebase ke plan Blaze (yang butuh kartu kredit). Caranya: file dikirim
// dari browser customer ke sebuah Google Apps Script Web App (jembatan
// yang jalan atas nama akun Drive milik WHISys sendiri, jadi customer
// nggak perlu login Google), yang nyimpen filenya ke folder Drive lalu
// balikin link-nya buat disimpen ke Firestore. Kode Apps Script-nya ada di
// file terpisah 'Code.gs' (dikirim bareng file ini) — WAJIB di-deploy
// dulu di script.google.com, baru tempel URL deployment-nya ke
// APPS_SCRIPT_URL di bawah sebelum fitur upload ini bisa jalan.
//
// CATATAN buat yang pegang Firebase Console: halaman ini butuh Firestore
// Security Rules tambahan (baca collection 'jamaah' & 'bookings' publik,
// baca-tulis 'portalLoginAttempts' publik, DAN update terbatas ke
// 'bookings' — cuma boleh nyentuh field 'documents'/'documentFiles'/
// 'updatedAt' — lihat firestore.rules yang udah pernah dikirim). Nggak
// butuh Storage Security Rules sama sekali di skema Google Drive ini.
// ============================================================================

const ATTEMPT_LIMIT = 5;
const LOCK_MINUTES = 15;
const SESSION_KEY = 'whi_portal_session';

const DOC_LABELS = {
  passport: 'Paspor',
  ktp_foto: 'Foto KTP',
  family_cert: 'Kartu Keluarga',
  sponsor_letter: 'Surat Sponsor',
  bank_statement: 'Rekening Koran',
  vaccine_cert: 'Sertifikat Vaksin',
  visa: 'Visa',
  ticket: 'Tiket',
};
const DOC_KEYS = Object.keys(DOC_LABELS);

// GANTI dengan URL Web App hasil deploy Code.gs (lihat instruksi di
// komentar atas file ini / Code.gs). Selama masih placeholder di bawah
// ini, tombol upload bakal langsung nolak dengan pesan yang jelas —
// nggak diem-diem gagal.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzsFlrrSlyfCc7lYx-9mdshwTMT0Ykde5KcsYHzl6v9BWFKMJ8ggX-g3GeSPY44ovHu/exec';

// Batas upload dokumen dari Portal Customer — jaga-jaga biar nggak ada yang
// ngirim file gede/aneh-aneh (foto kamera HP jaman sekarang bisa belasan
// MB). PDF & foto biasa udah lebih dari cukup di bawah batas ini.
const MAX_UPLOAD_MB = 8;
const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

// Ubah File jadi base64 murni (tanpa prefix "data:...;base64,") — format
// yang dipahami Code.gs di sisi Apps Script buat di-decode balik jadi file.
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    const base64 = result.includes(',') ? result.split(',')[1] : result;
    resolve(base64);
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// Kop surat buat PDF Kwitansi — pola & helper-nya sama persis kayak yang
// dipakai FinanceModule buat Laporan Laba Rugi, sengaja diduplikat di sini
// (bukan di-share) biar halaman portal customer ini tetap berdiri sendiri
// tanpa nyeret dependency ke modul dashboard staf.
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

// Bandingin tanggal lahir dengan aman — beberapa data jamaah lama bisa aja
// kesimpen dalam format yang beda-beda dikit (ada spasi nyasar, atau ada
// embel-embel waktu "T00:00:00.000Z" dari proses import/migrasi lama),
// padahal maksudnya tanggal yang sama persis. Kalau dibandingin string mentah
// (===) begitu aja, kasus-kasus kayak gini bikin customer nggak bisa login
// padahal Kode Jamaah & Tanggal Lahir yang mereka masukin udah benar.
// Fungsi ini nyari pola YYYY-MM-DD di depan string-nya dulu (paling umum &
// paling aman, nggak lewat objek Date sama sekali jadi nggak kena geser zona
// waktu) baru fallback ke parsing Date kalau formatnya beda banget.
const normalizeDateOnly = (val) => {
  if (!val) return '';
  const s = String(val).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatRupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
const formatTanggal = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
};

const checkPortalLoginAllowed = async (code) => {
  const snap = await getDoc(doc(db, 'portalLoginAttempts', code));
  if (snap.exists()) {
    const data = snap.data();
    if (data.lockedUntil && new Date(data.lockedUntil).getTime() > Date.now()) {
      const remainingMin = Math.max(1, Math.ceil((new Date(data.lockedUntil).getTime() - Date.now()) / 60000));
      throw new Error(`Terlalu banyak percobaan gagal buat kode ini. Coba lagi dalam ${remainingMin} menit, atau hubungi kami kalau butuh bantuan.`);
    }
  }
};

// Transaction biar aman dari race condition kalau ada 2 percobaan gagal
// hampir bersamaan dari kode jamaah yang sama.
const recordPortalLoginFailure = async (code) => {
  const ref = doc(db, 'portalLoginAttempts', code);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const prevCount = snap.exists() ? (Number(snap.data().count) || 0) : 0;
    const count = prevCount + 1;
    const payload = { count, updatedAt: new Date().toISOString() };
    if (count >= ATTEMPT_LIMIT) {
      payload.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
      payload.count = 0; // reset — jendela kunci di atas yang jadi penghalangnya
    }
    transaction.set(ref, payload, { merge: true });
  });
};

const resetPortalLoginAttempts = async (code) => {
  try {
    await setDoc(doc(db, 'portalLoginAttempts', code), { count: 0, updatedAt: new Date().toISOString() }, { merge: true });
  } catch {
    // Gagal reset counter bukan hal fatal — nggak perlu ganggu customer yang udah berhasil login.
  }
};

const statusBadge = (status) => {
  const s = status || 'active';
  if (s === 'cancelled') return { label: 'Dibatalkan', className: 'bg-rose-500/15 text-rose-400', Icon: Ban };
  if (s === 'rescheduled') return { label: 'Dipindah Jadwal', className: 'bg-amber-500/15 text-amber-400', Icon: RotateCcw };
  return { label: 'Aktif', className: 'bg-emerald-500/15 text-emerald-400', Icon: CheckCircle2 };
};

export default function PortalPage() {
  const [session, setSession] = useState(null);
  const [restoringSession, setRestoringSession] = useState(true);

  const [loginForm, setLoginForm] = useState({ customerCode: '', birthDate: '' });
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  const [companyProfile, setCompanyProfile] = useState(DEFAULT_COMPANY_PROFILE);
  const [generatingReceiptId, setGeneratingReceiptId] = useState(null);
  // Key-nya "{bookingId}-{docKey}" — biar tiap tombol upload independen,
  // nggak saling ngunci kalau customer upload 2 dokumen beda booking/jenis
  // hampir bersamaan.
  const [uploadingKey, setUploadingKey] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const fileInputRefs = useRef({});

  // Pulihkan sesi dari sessionStorage (hilang otomatis kalau tab ditutup) —
  // biar customer nggak perlu login ulang tiap kali refresh halaman.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) setSession(JSON.parse(raw));
    } catch {
      // ignore
    }
    setRestoringSession(false);
  }, []);

  const fetchBookings = async (jamaahId) => {
    setLoadingBookings(true);
    try {
      const q = query(collection(db, 'bookings'), where('jamaahId', '==', jamaahId));
      const snap = await getDocs(q);
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      setBookings(list);
    } catch (err) {
      console.error('Gagal ambil data booking portal:', err);
    }
    setLoadingBookings(false);
  };

  useEffect(() => {
    if (!session?.id) return;
    fetchBookings(session.id);
  }, [session?.id]);

  // Profil perusahaan (kop surat) — dipakai buat header PDF Kwitansi. Cukup
  // diambil sekali begitu login, sama kayak yang FinanceModule lakuin di
  // dashboard staf. Kalau gagal/belum di-setting, tetap jalan pakai
  // DEFAULT_COMPANY_PROFILE (nggak bikin gagal fitur download kwitansi-nya).
  useEffect(() => {
    if (!session?.id) return;
    const fetchCompanyProfile = async () => {
      try {
        const profileSnap = await getDoc(doc(db, 'settings', 'company_profile'));
        if (profileSnap.exists() && profileSnap.data().company) {
          setCompanyProfile({ ...DEFAULT_COMPANY_PROFILE, ...profileSnap.data().company });
        }
      } catch (err) {
        console.error('Gagal ambil profil perusahaan buat kwitansi:', err);
      }
    };
    fetchCompanyProfile();
  }, [session?.id]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    const code = loginForm.customerCode.trim().toUpperCase();
    if (!code || !loginForm.birthDate) {
      setLoginError('Isi Kode Jamaah dan Tanggal Lahir dulu ya.');
      return;
    }

    setLoggingIn(true);
    try {
      await checkPortalLoginAllowed(code);

      // CATATAN: idealnya Kode Jamaah unik per orang, tapi ada data lama yang
      // ternyata sempat kesimpen dobel dengan customerCode yang sama persis
      // (kejadian sebelum penomoran kode dipindah ke counter atomik). Makanya
      // di sini kita nggak boleh cuma ambil SATU dokumen pertama (limit(1))
      // terus langsung dianggap itu orangnya — kalau kebetulan yang ke-ambil
      // itu dokumen "kembar"-nya yang beda orang, customer yang datanya bener
      // jadi nggak akan pernah bisa cocok. Jadi di sini kita cek SEMUA
      // dokumen yang punya kode itu, siapa tau salah satunya beneran cocok.
      const q = query(collection(db, 'jamaah'), where('customerCode', '==', code));
      const snap = await getDocs(q);

      if (snap.size > 1) {
        console.warn(`[Portal] Kode Jamaah "${code}" dipakai lebih dari satu data jamaah (${snap.size}) — perlu dibenerin di Data Master Jamaah biar unik lagi.`);
      }

      let matched = null;
      snap.forEach((docSnap) => {
        if (matched) return;
        const data = docSnap.data();
        if (data.birthDate && normalizeDateOnly(data.birthDate) === normalizeDateOnly(loginForm.birthDate)) {
          matched = { id: docSnap.id, customerCode: data.customerCode, fullName: data.fullName || '' };
        }
      });

      if (!matched) {
        await recordPortalLoginFailure(code);
        // Pesan sengaja nggak nyebut "kode salah" atau "tanggal salah" secara
        // spesifik — biar orang luar nggak bisa nebak-nebak kode jamaah mana
        // yang valid cuma dari respons error-nya.
        setLoginError('Kode Jamaah atau Tanggal Lahir belum cocok. Coba cek lagi, atau hubungi tim kami kalau butuh bantuan.');
        setLoggingIn(false);
        return;
      }

      await resetPortalLoginAttempts(code);
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(matched));
      } catch {
        // ignore — kalau browser blokir sessionStorage, login tetap jalan buat sesi ini
      }
      setSession(matched);
    } catch (err) {
      setLoginError(err.message || 'Gagal memproses login, coba lagi sebentar lagi.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setSession(null);
    setBookings([]);
    setLoginForm({ customerCode: '', birthDate: '' });
    setUploadError('');
  };

  // Upload dokumen dari customer sendiri (paspor, KTP, dll) langsung dari
  // Portal — nggak perlu lagi kirim manual ke staf lewat WhatsApp. File
  // dikirim ke Google Apps Script (Code.gs) yang nyimpen ke Google Drive
  // dan balikin link-nya. Begitu sukses, checklist "documents.{key}"
  // langsung ke-centang otomatis (uploadnya itu sendiri YANG jadi bukti
  // dokumennya udah "diserahkan"), dan link file-nya kesimpen di
  // documentFiles.{key} biar staf bisa buka & verifikasi dari dashboard
  // (lihat modal Checklist Dokumen di Booking & Manifest).
  //
  // Dikirim sebagai body string TANPA header Content-Type eksplisit (jadi
  // browser default-nya text/plain) — SENGAJA, bukan lupa. Kalau pakai
  // 'application/json', browser bakal ngirim preflight OPTIONS duluan, dan
  // Google Apps Script Web App nggak nanganin preflight itu (bakal gagal
  // CORS). Dengan text/plain, request-nya dianggap "simple request" jadi
  // nggak butuh preflight — sisi Code.gs tetap parse isinya sebagai JSON.
  const handleUploadDocument = async (booking, docKey, file) => {
    if (!file) return;
    setUploadError('');

    if (APPS_SCRIPT_URL.startsWith('GANTI_DENGAN')) {
      setUploadError('Fitur upload belum aktif — URL Google Apps Script belum dipasang di kode (lihat komentar di atas file portal/page.js).');
      return;
    }
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      setUploadError(`File "${DOC_LABELS[docKey]}" harus berupa foto (JPG/PNG/HEIC) atau PDF.`);
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(`File "${DOC_LABELS[docKey]}" kebesaran (maks ${MAX_UPLOAD_MB}MB). Coba kompres/foto ulang dulu.`);
      return;
    }

    const stateKey = `${booking.id}-${docKey}`;
    setUploadingKey(stateKey);
    try {
      const base64Data = await fileToBase64(file);

      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({
          bookingId: booking.id,
          bookingCode: booking.bookingCode || '',
          docKey,
          fileName: file.name,
          mimeType: file.type,
          base64Data,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server upload merespons status ${res.status}.`);
      }
      const result = await res.json();
      if (!result.success || !result.url) {
        throw new Error(result.error || 'Upload gagal tanpa keterangan.');
      }

      await updateDoc(doc(db, 'bookings', booking.id), {
        [`documents.${docKey}`]: true,
        [`documentFiles.${docKey}`]: {
          url: result.url,
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'portal_customer',
        },
        updatedAt: new Date().toISOString(),
      });

      await fetchBookings(session.id);
    } catch (err) {
      console.error('Gagal upload dokumen dari portal:', err);
      setUploadError(`Gagal upload "${DOC_LABELS[docKey]}": ${err.message || 'coba lagi sebentar lagi.'}`);
    }
    setUploadingKey(null);
  };

  // Kwitansi PDF — kop surat & gaya tabelnya sengaja disamain sama pola PDF
  // yang dipakai FinanceModule (Laporan Laba Rugi) di dashboard staf, biar
  // dokumen yang keluar dari sistem WHISys konsisten look-nya, walau
  // generate-nya independen dari sisi Portal Customer ini.
  const handleDownloadReceipt = async (booking) => {
    setGeneratingReceiptId(booking.id);
    try {
      const payQ = query(collection(db, 'payments_income'), where('bookingId', '==', booking.id));
      const paySnap = await getDocs(payQ);
      const payments = paySnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

      const totalAmount = Number(booking.totalAmount) || 0;
      const totalPaid = Number(booking.totalPaid) || 0;
      const sisaTagihan = Math.max(0, totalAmount - totalPaid);

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

      // Judul
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(12);
      docPdf.text('KWITANSI PEMBAYARAN', pageWidth / 2, cursorY, { align: 'center' });
      cursorY += 5;
      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(8);
      docPdf.setTextColor(120);
      docPdf.text(`Dicetak: ${formatTanggal(new Date().toISOString())}`, pageWidth / 2, cursorY, { align: 'center' });
      docPdf.setTextColor(0);
      cursorY += 8;

      // Info jamaah & booking
      autoTable(docPdf, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        theme: 'plain',
        body: [
          ['Kode Jamaah', booking.jamaahId ? (session.customerCode || '-') : '-', 'Kode Booking', booking.bookingCode || '-'],
          ['Nama Jamaah', session.fullName || '-', 'Paket', booking.packageName || '-'],
          ['Tanggal Keberangkatan', formatTanggal(booking.departureDate), 'Status', (booking.status || 'active') === 'active' ? 'Aktif' : booking.status],
        ],
        styles: { fontSize: 8.5, cellPadding: 1 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 40 },
          2: { fontStyle: 'bold', cellWidth: 35 },
        },
      });

      cursorY = docPdf.lastAutoTable.finalY + 8;

      // Rincian setoran
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(10);
      docPdf.text('Rincian Setoran', marginX, cursorY);
      cursorY += 4;

      if (payments.length === 0) {
        docPdf.setFont('helvetica', 'italic');
        docPdf.setFontSize(9);
        docPdf.text('Belum ada setoran tercatat.', marginX, cursorY + 4);
        cursorY += 10;
      } else {
        autoTable(docPdf, {
          startY: cursorY,
          margin: { left: marginX, right: marginX },
          head: [['Tanggal', 'Metode', 'Catatan', 'Nominal (Rp)']],
          body: payments.map((p) => [
            formatTanggal(p.createdAt),
            p.paymentMethod || '-',
            p.notes || '-',
            (Number(p.amount) || 0).toLocaleString('id-ID'),
          ]),
          styles: { fontSize: 8.5, cellPadding: 2 },
          headStyles: { fillColor: [15, 23, 42] },
          columnStyles: { 3: { halign: 'right' } },
        });
        cursorY = docPdf.lastAutoTable.finalY + 8;
      }

      // Ringkasan total
      autoTable(docPdf, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        theme: 'plain',
        body: [
          ['Total Harga Paket', `Rp ${totalAmount.toLocaleString('id-ID')}`],
          ['Total Sudah Dibayar', `Rp ${totalPaid.toLocaleString('id-ID')}`],
          ['Sisa Tagihan', `Rp ${sisaTagihan.toLocaleString('id-ID')}`],
        ],
        styles: { fontSize: 9.5, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right', fontStyle: 'bold' } },
        didParseCell: (data) => {
          if (data.row.index === 2 && data.section === 'body') {
            data.cell.styles.textColor = sisaTagihan > 0 ? [217, 119, 6] : [16, 185, 129];
          }
        },
      });
      cursorY = docPdf.lastAutoTable.finalY + 10;

      docPdf.setFont('helvetica', 'italic');
      docPdf.setFontSize(7.5);
      docPdf.setTextColor(140);
      docPdf.text(
        'Kwitansi ini digenerate otomatis lewat Portal Jamaah dan sah tanpa tanda tangan basah.',
        pageWidth / 2, cursorY, { align: 'center' }
      );

      docPdf.save(`Kwitansi-${booking.bookingCode || booking.id}.pdf`);
    } catch (err) {
      console.error('Gagal bikin PDF kwitansi:', err);
      alert('Gagal membuat kwitansi: ' + (err.message || 'coba lagi sebentar lagi.'));
    }
    setGeneratingReceiptId(null);
  };

  if (restoringSession) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
      </div>
    );
  }

  // ================= HALAMAN LOGIN =================
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-emerald-600/15 flex items-center justify-center mx-auto mb-3">
              <Plane className="w-7 h-7 text-emerald-500" />
            </div>
            <h1 className="text-xl font-bold text-white">Portal Jamaah</h1>
            <p className="text-xs text-slate-400 mt-1">Wisata Halal Indonesia</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block mb-1 text-xs font-medium text-slate-300">Kode Jamaah</label>
              <input
                type="text"
                required
                placeholder="Contoh: CST002001"
                className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded-lg p-2.5 text-sm font-mono focus:outline-none focus:border-emerald-500"
                value={loginForm.customerCode}
                onChange={(e) => setLoginForm({ ...loginForm, customerCode: e.target.value })}
              />
              <p className="text-[10px] text-slate-500 mt-1">Kode ini ada di bukti booking / dikirim tim kami lewat WhatsApp.</p>
            </div>
            <div>
              <label className="block mb-1 text-xs font-medium text-slate-300">Tanggal Lahir</label>
              <DateFieldID
                className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded-lg p-2.5 text-sm"
                nativeClassName="[color-scheme:dark]"
                value={loginForm.birthDate}
                onChange={(val) => setLoginForm({ ...loginForm, birthDate: val })}
              />
            </div>

            {loginError && (
              <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {loggingIn ? 'Memeriksa...' : 'Masuk'}
            </button>
          </form>

          <div className="flex items-start gap-2 text-[10px] text-slate-500 mt-6">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Belum pernah dapat Kode Jamaah, atau tanggal lahir belum terdaftar? Hubungi tim kami lewat WhatsApp buat dibantu.</span>
          </div>
        </div>
      </div>
    );
  }

  // ================= HALAMAN DASHBOARD (VIEW-ONLY) =================
  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Selamat datang,</p>
            <h1 className="text-lg font-bold text-white">{session.fullName || session.customerCode}</h1>
            <p className="text-[11px] font-mono text-emerald-500">{session.customerCode}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-3 py-2 rounded-lg text-xs"
          >
            <LogOut className="w-3.5 h-3.5" /> Keluar
          </button>
        </div>

        {uploadError && (
          <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{uploadError}</span>
          </div>
        )}

        {loadingBookings ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Memuat data booking...
          </div>
        ) : bookings.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-sm">
            Belum ada data booking atas nama Anda di sistem kami.
          </div>
        ) : (
          bookings.map((bk) => {
            const badge = statusBadge(bk.status);
            const totalAmount = Number(bk.totalAmount) || 0;
            const totalPaid = Number(bk.totalPaid) || 0;
            const sisaTagihan = Math.max(0, totalAmount - totalPaid);
            const docs = bk.documents || {};
            const docFiles = bk.documentFiles || {};
            const readyCount = DOC_KEYS.filter((key) => docs[key]).length;
            const readyPercent = Math.round((readyCount / DOC_KEYS.length) * 100);
            const isReadyComplete = readyCount === DOC_KEYS.length;

            return (
              <div key={bk.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="p-5 border-b border-slate-800 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-mono text-slate-500">{bk.bookingCode}</p>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2 mt-0.5">
                      <Plane className="w-4 h-4 text-emerald-500" /> {bk.packageName || '-'}
                    </h2>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> Keberangkatan: {formatTanggal(bk.departureDate)}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${badge.className}`}>
                    <badge.Icon className="w-3 h-3" /> {badge.label}
                  </span>
                </div>

                {/* KESIAPAN BERANGKAT — persentase kelengkapan dokumen, biar
                    jamaah langsung ngerti seberapa "siap" dia berangkat
                    tanpa harus nge-scroll & itung-itung sendiri satu-satu. */}
                <div className="px-5 py-4 border-b border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                      <Gauge className="w-3.5 h-3.5 text-emerald-500" /> Kesiapan Berangkat
                    </p>
                    <span className={`text-xs font-bold ${isReadyComplete ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {readyPercent}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isReadyComplete ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${readyPercent}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5">{readyCount} dari {DOC_KEYS.length} dokumen sudah lengkap.</p>
                </div>

                <div className="p-5 border-b border-slate-800">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-emerald-500" /> Status Pembayaran
                    </p>
                    <button
                      type="button"
                      onClick={() => handleDownloadReceipt(bk)}
                      disabled={generatingReceiptId === bk.id}
                      className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {generatingReceiptId === bk.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                      Kwitansi
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-[10px] text-slate-500">Total Paket</p>
                      <p className="text-xs font-bold text-white">{formatRupiah(totalAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Sudah Dibayar</p>
                      <p className="text-xs font-bold text-emerald-500">{formatRupiah(totalPaid)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Sisa Tagihan</p>
                      <p className={`text-xs font-bold ${sisaTagihan > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{formatRupiah(sisaTagihan)}</p>
                    </div>
                  </div>
                </div>

                <div className="p-5">
                  <p className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-3">
                    <FileCheck className="w-3.5 h-3.5 text-emerald-500" /> Kelengkapan Dokumen
                  </p>
                  <p className="text-[10px] text-slate-500 -mt-2 mb-3">
                    Belum sempat kirim dokumen ke kami? Upload langsung di sini aja (foto/PDF, maks {MAX_UPLOAD_MB}MB).
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {DOC_KEYS.map((key) => {
                      const label = DOC_LABELS[key];
                      const done = !!docs[key];
                      const fileInfo = docFiles[key];
                      const stateKey = `${bk.id}-${key}`;
                      const isUploading = uploadingKey === stateKey;
                      return (
                        <div key={key} className={`flex items-center justify-between gap-2 text-[11px] rounded-lg px-2.5 py-2 ${done ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800/60 text-slate-500'}`}>
                          <span className="flex items-center gap-1.5 min-w-0">
                            {done ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                            <span className="truncate">{label}</span>
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            {fileInfo?.url && (
                              <a
                                href={fileInfo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Lihat file yang sudah diupload (Google Drive)"
                                className="flex items-center gap-1 bg-slate-950/40 hover:bg-slate-950/70 px-1.5 py-1 rounded text-[10px] font-medium"
                              >
                                <Eye className="w-3 h-3" /> Lihat
                              </a>
                            )}
                            <button
                              type="button"
                              disabled={isUploading}
                              onClick={() => fileInputRefs.current[stateKey]?.click()}
                              title={fileInfo ? 'Ganti file' : 'Upload file'}
                              className="flex items-center gap-1 bg-slate-950/40 hover:bg-slate-950/70 px-1.5 py-1 rounded text-[10px] font-medium disabled:opacity-60"
                            >
                              {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                              {fileInfo ? 'Ganti' : 'Upload'}
                            </button>
                            <input
                              ref={(el) => { fileInputRefs.current[stateKey] = el; }}
                              type="file"
                              accept={ALLOWED_UPLOAD_TYPES.join(',')}
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = ''; // biar bisa pilih file yg sama lagi kalau perlu re-upload
                                handleUploadDocument(bk, key, file);
                              }}
                            />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
