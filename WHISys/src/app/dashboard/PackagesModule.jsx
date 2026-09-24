'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { Package, Plus, Search, Calendar, Edit, Trash2, Filter, Plane, MapPin, Globe, RefreshCw, X, ListOrdered, ChevronUp, ChevronDown, Printer, MessageSquare, Utensils, BedDouble, ArrowUpDown, Settings, List, LayoutGrid, CalendarRange, Eye, EyeOff, ExternalLink } from 'lucide-react';
import DateFieldID from '@/components/DateFieldID';
import { logActivity } from '../../lib/activityLog';
import { postJournalEntry, ACC } from '../../lib/journal';
import { addPPN } from '../../lib/ppn';
import { printItineraryDocument } from '../../lib/itineraryPrintDoc';

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

// Helper Format Bulan & Tahun
const formatMonthYear = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
};

// Kompres & ubah file gambar (flyer promosi paket) jadi data URL base64,
// disimpen LANGSUNG di dokumen Firestore paket (bukan Firebase Storage —
// WHISys belum pakai Storage sama sekali di manapun, jadi biar konsisten
// & nggak nambah setup baru, gambar disimpen inline kayak logo PDF Kwitansi
// yang juga di-encode ke data URL). Dikecilkan dulu ke maks 1000px lebar +
// dikompres JPEG kualitas 0.72 biar ukurannya aman jauh di bawah limit 1MB
// per dokumen Firestore (termasuk field lain kayak itinerary/budget items).
const compressImageToDataUrl = (file, maxWidth = 1000, quality = 0.72) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = reject;
  reader.onload = () => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// Daftar default Destinasi/Kota Tujuan (paket Wisata Halal & LA Only) —
// dibuat jadi kategori baku (bisa ditambah/diedit lewat "Kelola Kategori")
// biar penulisannya seragam, nggak ada lagi yang nulis "Japan" vs "Jepang".
const DESTINATION_CATEGORIES = [
  'Korea Selatan',
  'Jepang',
  'Turki',
  'Dubai (UAE)',
  'Malaysia',
  'Thailand',
  'Lainnya'
];

// ID dokumen konfigurasi daftar Destinasi yang bisa diedit user — disamarkan
// sebagai salah satu dokumen di collection 'packages' sendiri (bukan
// collection terpisah), persis pola yang sama kayak Kategori Vendor di
// FinanceModule.jsx — biar hak akses tulisnya otomatis ikut aturan Firestore
// Rules yang udah ada buat kelola katalog paket (Super Admin & Operational),
// tanpa perlu minta perubahan rules baru.
const DESTINATION_CATEGORY_CONFIG_ID = '_destination_categories_config';

// Daftar default Kategori Maskapai/Transportasi — dibikin baku sama persis
// kayak Destinasi/Kota Tujuan di atas, biar penulisannya seragam ("Saudi
// Arabian Airlines" vs "Saudia" vs "Garuda Indonesia" dst nggak lagi ngasal),
// jadi pas tarik data / filter berdasarkan maskapai hasilnya konsisten.
const AIRLINE_CATEGORIES = [
  'Saudi Arabian Airlines',
  'Garuda Indonesia',
  'Lion Air / Batik Air',
  'Etihad Airways',
  'Emirates',
  'Qatar Airways',
  'Korean Air',
  'Transportasi Darat (Bus/LA)',
  'Lainnya'
];

// Pola & alasan penyamaran ID dokumen konfigurasi sama persis kayak
// DESTINATION_CATEGORY_CONFIG_ID di atas.
const AIRLINE_CATEGORY_CONFIG_ID = '_airline_categories_config';

// Item default Rencana Anggaran (Planning Cost) — label cuma starting point,
// staf bebas tambah/edit/hapus baris per paket. Dipisah 2 kelompok niru
// struktur costing manual yang dulu dipakai tim (Fixed Cost = biaya pokok
// per paket, Variable Cost TL = biaya yang nempel ke Tour Leader/rombongan).
const DEFAULT_BUDGET_FIXED_COST_ITEMS = [
  { label: 'Tiket Pesawat', amount: '' },
  { label: 'Land Tour', amount: '' },
  { label: 'City Tour', amount: '' },
  { label: 'Hotel Transit', amount: '' }
];
const DEFAULT_BUDGET_VARIABLE_COST_ITEMS = [
  { label: 'Tiket TL', amount: '' },
  { label: 'Fee TL', amount: '' },
  { label: 'Banner', amount: '' },
  { label: 'Insurance', amount: '' },
  { label: 'Lain-lain', amount: '' }
];

// Item default "Harga Termasuk" (Fasilitas & Layanan) — dipakai buat
// dokumen "DETAIL PAKET WISATA" (kop surat + fasilitas + deskripsi flight),
// staf bebas tambah/edit/hapus baris per paket, sama persis pola-nya kayak
// Rencana Anggaran di atas (array of strings biasa, nggak butuh nominal).
const DEFAULT_PRICE_INCLUDES = [
  'Tiket Pesawat PP',
  'Hotel Sesuai Program',
  'Private Bus AC',
  'Tiket Wisata sesuai program',
  'Makan sesuai program',
  'Tour Leader Muslim',
  'Lokal Guide'
];

// Item default "Harga Tidak Termasuk" — beda dari Harga Termasuk, tiap baris
// BISA punya nominal (opsional, biar bisa nulis baris polos kayak "PPN 1.1%"
// tanpa nominal, atau baris berharga kayak "Tipping 750.000/pax") + catatan
// bebas (opsional, buat keterangan kayak "(Optional)" atau syarat tertentu).
const DEFAULT_PRICE_EXCLUDES = [
  { label: 'Tipping', amount: '', note: '/pax' },
  { label: 'Kelebihan Bagasi (bila ada)', amount: '', note: '' },
  { label: 'PPN 1.1%', amount: '', note: '' }
];

// Item default rincian penerbangan (buat halaman "Deskripsi Paket") — 1
// baris per leg/segmen (biasanya ada transit, jadi 1 paket bisa 2-4 baris).
const DEFAULT_FLIGHT_SEGMENTS = [
  { flightNumber: '', date: '', route: '', depTime: '', arrTime: '' }
];

export default function PackagesModule({ theme = 'dark', userRole = '', currentUser = null }) {
  const isDark = theme === 'dark';

  // Cuma Super Admin & Operational yang boleh kelola katalog paket (buat,
  // edit, hapus, atur itinerary). Sales & Finance tetap boleh lihat katalog
  // (butuh buat proses booking), tapi nggak boleh ubah data paketnya.
  const roleLower = (userRole || '').toLowerCase();
  const canManagePackages = roleLower.includes('super') || roleLower === 'admin' || roleLower === 'operational';

  // Config Style Adaptif Tema
  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    tableHeaderBg: isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-slate-100 text-slate-500',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    tableRowBorder: isDark ? 'divide-slate-800/60' : 'divide-slate-200',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
  };

  const [packagesList, setPackagesList] = useState([]);
  const [bookingsList, setBookingsList] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // State Filter & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [selectedDestination, setSelectedDestination] = useState('');
  const [selectedDestinationCity, setSelectedDestinationCity] = useState('');
  const [selectedAirline, setSelectedAirline] = useState('');
  const [sortBy, setSortBy] = useState('');

  // Mode Tampilan: 'list' (tabel/kartu biasa, urutan sesuai filter/sort) atau
  // 'monthly' (dikelompokkan per bulan keberangkatan) — dibuat biar tim CS
  // gampang mencocokkan paket yang udah dibuat di sistem sama daftar
  // rencana di sheet "Cek Seat" yang juga disusun per bulan.
  const [viewMode, setViewMode] = useState('list');

  const [showModal, setShowModal] = useState(false);
  const [editingPackageId, setEditingPackageId] = useState(null);

  // Kategori Destinasi/Kota Tujuan sekarang bisa ditambah/diedit sendiri
  // lewat tombol "Kelola Kategori" — pola & alasannya sama persis kayak
  // Kelola Kategori Vendor di FinanceModule.jsx.
  const [destinationCategories, setDestinationCategories] = useState(DESTINATION_CATEGORIES);
  const [showDestinationCategoryModal, setShowDestinationCategoryModal] = useState(false);
  const [destinationCategoryDraft, setDestinationCategoryDraft] = useState([]);
  const [newDestinationCategoryText, setNewDestinationCategoryText] = useState('');
  const [savingDestinationCategories, setSavingDestinationCategories] = useState(false);

  // Kategori Maskapai/Transportasi — pola & alasannya sama persis kayak
  // Kategori Destinasi di atas.
  const [airlineCategories, setAirlineCategories] = useState(AIRLINE_CATEGORIES);
  const [showAirlineCategoryModal, setShowAirlineCategoryModal] = useState(false);
  const [airlineCategoryDraft, setAirlineCategoryDraft] = useState([]);
  const [newAirlineCategoryText, setNewAirlineCategoryText] = useState('');
  const [savingAirlineCategories, setSavingAirlineCategories] = useState(false);

  // State Modal Itinerary
  const [showItineraryModal, setShowItineraryModal] = useState(false);
  const [selectedPackageForItinerary, setSelectedPackageForItinerary] = useState(null);
  const [itineraryDays, setItineraryDays] = useState([]);
  const [savingItinerary, setSavingItinerary] = useState(false);

  // Perbaikan 17 Sep 2026 (temuan audit CRITICAL) — guard anti double-submit
  // buat form Edit/Tambah Paket. Tanpa ini, double-klik "Simpan Perubahan"
  // (atau koneksi lambat) bisa bikin handleSubmit kepanggil 2x paralel, dan
  // karena bagian "Sinkron Revisi Harga Paket ke Booking Existing" di bawah
  // posting jurnal booking_edit_adjustment secara ADITIF (bukan hapus-lalu-
  // posting-ulang), tiap booking aktif yang tersentuh bisa dapet 2 baris
  // jurnal dengan delta identik — dobel catat Piutang Jamaah & Pendapatan
  // Diterima Dimuka di Neraca. Sama polanya kayak isSavingGroupEdit di
  // BookingsModule.jsx (kasus GRP-606826).
  const [savingPackage, setSavingPackage] = useState(false);

  // Kop surat (nama PT, alamat, telepon, email) buat dokumen "Detail Paket
  // Wisata" — sumbernya sama persis kayak Invoice di BookingsModule.jsx
  // (settings/company_profile, diatur dari menu Pengaturan > Identitas PT),
  // biar semua dokumen yang keluar dari WHISys konsisten kop suratnya.
  const [companyInfo, setCompanyInfo] = useState(null);
  useEffect(() => {
    const fetchCompanyInfo = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'settings', 'company_profile'));
        if (docSnap.exists()) setCompanyInfo(docSnap.data().company);
      } catch (err) {
        console.error('Gagal mengambil data profil perusahaan untuk Detail Paket:', err);
      }
    };
    fetchCompanyInfo();
  }, []);

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    type: 'Umroh Regular',
    departureDate: '',
    durationDays: '9 Hari',
    airline: AIRLINE_CATEGORIES[0],
    hotelMakkah: 'Pullman Zamzam',
    hotelMadinah: 'Front Taiba',
    destinationCity: DESTINATION_CATEGORIES[0],
    hotelTour: 'Hotel Bintang 4 / Setaraf',
    laScope: 'Bus, Mutawwif, Handling, Visas',
    quotaTotal: 45,
    priceMain: '',
    priceTriple: '',
    priceDouble: '',
    priceChild: '',
    // Rencana Anggaran (Planning Cost) — dipisah Fixed Cost & Variable Cost
    // TL, niru struktur costing manual yang dulu dipakai tim di Google
    // Sheet, tapi disimpen lump sum per paket (bukan per-pax) biar apple-to-
    // apple sama cara payments_vendor/vendor_bills disimpen sekarang. Dipakai
    // buat itung "Margin Planning" (target margin di awal, sebelum paket
    // dijual) vs "Margin Realisasi" (angka riil pas Akui Pendapatan) di tab
    // Analisa Margin — lihat LaporanKeuanganModule.jsx.
    budgetFixedCostItems: DEFAULT_BUDGET_FIXED_COST_ITEMS,
    budgetVariableCostItems: DEFAULT_BUDGET_VARIABLE_COST_ITEMS,
    // Fasilitas & Layanan + rincian penerbangan — buat dokumen "Detail Paket
    // Wisata" (kop surat, harga termasuk/tidak termasuk, deskripsi flight).
    priceIncludes: DEFAULT_PRICE_INCLUDES,
    priceExcludes: DEFAULT_PRICE_EXCLUDES,
    flightSegments: DEFAULT_FLIGHT_SEGMENTS,
    specialNote: '',
    // Flyer promosi paket (opsional) — dipakai di halaman 1 dokumen Detail
    // Paket Wisata, disimpen sebagai data URL base64 (lihat compressImageToDataUrl).
    flyerImageDataUrl: '',
    // Status Aktif/Nonaktif — nentuin apakah paket ini tampil di Katalog
    // Produk publik (wisatahalalindonesia.com, lewat endpoint
    // /api/public/catalog). Default TRUE biar paket baru otomatis tayang.
    // Ini CUMA soal visibilitas di katalog publik — nggak mempengaruhi
    // booking/SO yang udah ada, staf tetap bisa lihat & kelola paket
    // nonaktif seperti biasa di dashboard internal.
    isActive: true
  });
  const [uploadingFlyer, setUploadingFlyer] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const pkgSnap = await getDocs(collection(db, 'packages'));
      const pkgDocs = pkgSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const destinationConfigDoc = pkgDocs.find(p => p.id === DESTINATION_CATEGORY_CONFIG_ID);
      const airlineConfigDoc = pkgDocs.find(p => p.id === AIRLINE_CATEGORY_CONFIG_ID);
      const pkgs = pkgDocs.filter(p => p.id !== DESTINATION_CATEGORY_CONFIG_ID && p.id !== AIRLINE_CATEGORY_CONFIG_ID);
      if (destinationConfigDoc && Array.isArray(destinationConfigDoc.categories) && destinationConfigDoc.categories.length > 0) {
        setDestinationCategories(destinationConfigDoc.categories);
      }
      if (airlineConfigDoc && Array.isArray(airlineConfigDoc.categories) && airlineConfigDoc.categories.length > 0) {
        setAirlineCategories(airlineConfigDoc.categories);
      }

      const bkSnap = await getDocs(collection(db, 'bookings'));
      const bks = bkSnap.docs.map(d => d.data());

      setBookingsList(bks);
      setPackagesList(pkgs);
    } catch (err) {
      console.error("Gagal mengambil data paket:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Kode paket sekuensial & rapi, pola sama kayak Kode Unik Customer
  // (CST000001) di Data Master Jamaah — biar nggak ada risiko tabrakan
  // kode kayak format lama yang diambil dari 4 digit terakhir timestamp.
  const getNextPackageCode = () => {
    let maxNum = 0;

    packagesList.forEach((p) => {
      if (p.code && p.code.startsWith('PKG-')) {
        const numPart = parseInt(p.code.replace('PKG-', ''), 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    });

    const nextNum = maxNum + 1;
    const padded = String(nextNum).padStart(6, '0');
    return `PKG-${padded}`;
  };

  const handleOpenAdd = () => {
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh menambah paket.");
      return;
    }
    setEditingPackageId(null);
    setFormData({
      code: getNextPackageCode(),
      name: '',
      type: 'Umroh Regular',
      departureDate: '',
      durationDays: '9 Hari',
      airline: airlineCategories[0],
      hotelMakkah: 'Pullman Zamzam',
      hotelMadinah: 'Front Taiba',
      destinationCity: destinationCategories[0],
      hotelTour: 'Hotel Bintang 4 / Setaraf',
      laScope: 'Transport, Hotel, Handling LA',
      quotaTotal: 45,
      priceMain: '',
      priceTriple: '',
      priceDouble: '',
      priceChild: '',
      budgetFixedCostItems: DEFAULT_BUDGET_FIXED_COST_ITEMS,
      budgetVariableCostItems: DEFAULT_BUDGET_VARIABLE_COST_ITEMS,
      priceIncludes: DEFAULT_PRICE_INCLUDES,
      priceExcludes: DEFAULT_PRICE_EXCLUDES,
      flightSegments: DEFAULT_FLIGHT_SEGMENTS,
      specialNote: '',
      flyerImageDataUrl: '',
      isActive: true
    });
    setShowModal(true);
  };

  const handleOpenEdit = (pkg) => {
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh mengedit paket.");
      return;
    }
    setEditingPackageId(pkg.id);
    setFormData({
      code: pkg.code || '',
      name: pkg.name || '',
      type: pkg.type || 'Umroh Regular',
      departureDate: pkg.departureDate || '',
      durationDays: pkg.durationDays || '9 Hari',
      airline: pkg.airline || '',
      hotelMakkah: pkg.hotelMakkah || '',
      hotelMadinah: pkg.hotelMadinah || '',
      destinationCity: pkg.destinationCity || '',
      hotelTour: pkg.hotelTour || '',
      laScope: pkg.laScope || '',
      quotaTotal: pkg.quotaTotal || 45,
      priceMain: pkg.priceMain || pkg.priceQuad || '',
      priceTriple: pkg.priceTriple || '',
      priceDouble: pkg.priceDouble || '',
      priceChild: pkg.priceChild || '',
      // Paket lama (dibuat sebelum fitur Rencana Anggaran ada) belum punya
      // field ini sama sekali — fallback ke daftar default biar formnya
      // tetap kepakai wajar (bukan array kosong tanpa baris apa-apa).
      budgetFixedCostItems: (Array.isArray(pkg.budgetFixedCostItems) && pkg.budgetFixedCostItems.length > 0)
        ? pkg.budgetFixedCostItems : DEFAULT_BUDGET_FIXED_COST_ITEMS,
      budgetVariableCostItems: (Array.isArray(pkg.budgetVariableCostItems) && pkg.budgetVariableCostItems.length > 0)
        ? pkg.budgetVariableCostItems : DEFAULT_BUDGET_VARIABLE_COST_ITEMS,
      // Paket lama (dibuat sebelum fitur Fasilitas & Layanan / Flight ada)
      // belum punya field ini — fallback ke daftar default, sama pola-nya
      // kayak Rencana Anggaran di atas.
      priceIncludes: (Array.isArray(pkg.priceIncludes) && pkg.priceIncludes.length > 0)
        ? pkg.priceIncludes : DEFAULT_PRICE_INCLUDES,
      priceExcludes: (Array.isArray(pkg.priceExcludes) && pkg.priceExcludes.length > 0)
        ? pkg.priceExcludes : DEFAULT_PRICE_EXCLUDES,
      flightSegments: (Array.isArray(pkg.flightSegments) && pkg.flightSegments.length > 0)
        ? pkg.flightSegments : DEFAULT_FLIGHT_SEGMENTS,
      specialNote: pkg.specialNote || '',
      flyerImageDataUrl: pkg.flyerImageDataUrl || '',
      // Paket lama belum punya field ini sama sekali — default-nya TETAP
      // aktif (bukan tiba-tiba ilang dari katalog cuma gara-gara field-nya
      // belum pernah diisi).
      isActive: pkg.isActive !== false
    });
    setShowModal(true);
  };

  // ============ Sinkronisasi Katalog Produk Publik (`public_catalog`) ============
  // Endpoint publik /api/public/catalog (dipanggil situs wisatahalalindonesia.com)
  // TIDAK bisa pakai Firebase Admin SDK, karena pembuatan Service Account Key
  // diblokir Org Policy Google Workspace punya perusahaan (lihat catatan di
  // src/lib/firebaseAdmin.js). Sebagai gantinya, endpoint itu baca collection
  // terpisah `public_catalog` (1 dokumen per paket AKTIF, doc ID = ID paket)
  // yang ditulis di sini pakai Client SDK — sesi staf yang udah login lewat
  // dashboard ini — tiap kali data paket yang relevan buat katalog berubah.
  // Firestore Rules perlu dibuka PUBLIC READ ONLY khusus buat collection
  // `public_catalog` ini (BUKAN collection `packages` asli yang berisi data
  // internal/margin) — instruksi rule-nya udah dikasih terpisah ke user.
  // Field yang disalin ke sini WAJIB lewat whitelist `PUBLIC_CATALOG_FIELDS`
  // di bawah — JANGAN PERNAH taro field budget/margin/internal
  // (budgetFixedCostItems, budgetCostTotal, revenueRecognized, dst) di sini.
  const PUBLIC_CATALOG_FIELDS = [
    'code', 'name', 'type', 'departureDate', 'durationDays', 'airline',
    'hotelMakkah', 'hotelMadinah', 'destinationCity', 'hotelTour', 'laScope',
    'quotaTotal', 'quotaRemaining', 'priceMain', 'priceQuad', 'priceTriple',
    'priceDouble', 'priceChild', 'priceIncludes', 'priceExcludes',
    'flightSegments', 'itinerary', 'specialNote', 'flyerImageDataUrl',
  ];

  const buildPublicCatalogDoc = (data) => {
    const out = {};
    PUBLIC_CATALOG_FIELDS.forEach((k) => { out[k] = data[k]; });
    out.quotaTotal = Number(data.quotaTotal) || 0;
    out.quotaRemaining = Number(data.quotaRemaining ?? data.quotaTotal ?? 0);
    out.priceMain = Number(data.priceMain || data.priceQuad) || 0;
    out.priceQuad = Number(data.priceQuad || data.priceMain) || 0;
    out.priceTriple = Number(data.priceTriple) || 0;
    out.priceDouble = Number(data.priceDouble) || 0;
    out.priceChild = Number(data.priceChild) || 0;
    out.priceIncludes = Array.isArray(data.priceIncludes) ? data.priceIncludes : [];
    out.priceExcludes = Array.isArray(data.priceExcludes) ? data.priceExcludes : [];
    out.flightSegments = Array.isArray(data.flightSegments) ? data.flightSegments : [];
    out.itinerary = Array.isArray(data.itinerary) ? data.itinerary : [];
    out.code = data.code || '';
    out.name = data.name || '';
    out.type = data.type || '';
    out.departureDate = data.departureDate || '';
    out.durationDays = data.durationDays || '';
    out.airline = data.airline || '';
    out.hotelMakkah = data.hotelMakkah || '';
    out.hotelMadinah = data.hotelMadinah || '';
    out.destinationCity = data.destinationCity || '';
    out.hotelTour = data.hotelTour || '';
    out.laScope = data.laScope || '';
    out.specialNote = data.specialNote || '';
    out.flyerImageDataUrl = data.flyerImageDataUrl || '';
    out.updatedAt = new Date().toISOString();
    return out;
  };

  // Dipanggil tiap kali field yang relevan buat katalog publik berubah:
  // simpan/hapus dokumen cermin di `public_catalog`, sesuai status
  // Aktif/Nonaktif-nya. Sengaja NGGAK dibikin fatal kalau gagal (mis.
  // Firestore Rules-nya belum sempat di-update user) — data paket utama
  // tetap kesimpen normal, cuma katalog publiknya yang telat kesinkron;
  // errornya dicatat di console biar ketauan pas debug.
  const syncPublicCatalog = async (pkgId, data) => {
    try {
      if (!pkgId) return;
      if (data.isActive === false) {
        await deleteDoc(doc(db, 'public_catalog', pkgId));
      } else {
        await setDoc(doc(db, 'public_catalog', pkgId), buildPublicCatalogDoc(data));
      }
    } catch (err) {
      console.error('Gagal menyinkronkan Katalog Produk publik:', err);
    }
  };

  // Toggle cepat Aktif/Nonaktif tanpa perlu buka modal Edit lengkap — dipakai
  // dari tombol mata (Eye/EyeOff) di daftar paket. Nonaktif = paket tetap
  // ada & tetap bisa dikelola normal di dashboard internal (booking lama
  // nggak kena efek apa-apa), cuma nggak ikut ditampilin di Katalog Produk
  // publik (wisatahalalindonesia.com) lewat endpoint /api/public/catalog.
  const handleToggleActive = async (pkg) => {
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh mengubah status paket.");
      return;
    }
    const nextActive = !(pkg.isActive !== false);
    try {
      await updateDoc(doc(db, 'packages', pkg.id), { isActive: nextActive, updatedAt: new Date().toISOString() });
      await syncPublicCatalog(pkg.id, { ...pkg, isActive: nextActive });
      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'update',
        module: 'Paket Perjalanan',
        targetLabel: pkg.name,
        details: `Mengubah status paket "${pkg.name}" (${pkg.code || '-'}) jadi ${nextActive ? 'AKTIF' : 'NONAKTIF'} di Katalog Produk publik.`
      });
      fetchData();
    } catch (err) {
      alert("Gagal mengubah status paket: " + err.message);
    }
  };

  const handleDelete = async (pkg) => {
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh menghapus paket.");
      return;
    }
    try {
      const bookingQ = query(collection(db, 'bookings'), where('packageId', '==', pkg.id));
      const bookingSnap = await getDocs(bookingQ);

      if (!bookingSnap.empty) {
        alert(`Paket "${pkg.name}" tidak dapat dihapus karena masih memiliki ${bookingSnap.size} data booking jamaah.\n\nSilakan pindahkan/hapus dulu booking-nya di menu Booking & Manifest sebelum menghapus paket ini.`);
        return;
      }

      // Cek biaya vendor terkait paket ini. Collection ini cuma boleh dibaca
      // Finance & Super Admin (aturan modul Keuangan) — kalau yang hapus
      // paket adalah Operational, query ini bakal ditolak Firestore Rules.
      // Itu wajar (bukan bug), jadi kita lewatin pengecekan ini khusus buat
      // role yang memang nggak punya akses ke data Keuangan.
      try {
        const vendorQ = query(collection(db, 'payments_vendor'), where('packageId', '==', pkg.id));
        const vendorSnap = await getDocs(vendorQ);

        if (!vendorSnap.empty) {
          alert(`Paket "${pkg.name}" tidak dapat dihapus karena masih memiliki ${vendorSnap.size} riwayat biaya vendor tercatat di modul Keuangan.\n\nSilakan hapus dulu biaya vendor terkait paket ini di menu Keuangan sebelum menghapus paketnya.`);
          return;
        }
      } catch (vendorErr) {
        if (vendorErr.code !== 'permission-denied') throw vendorErr;
        // Role ini nggak punya akses baca data Keuangan — lanjut ke
        // pengecekan booking di atas sebagai pengaman utama.
      }

      if (!confirm(`Apakah Anda yakin ingin menghapus paket "${pkg.name}"?`)) return;

      await deleteDoc(doc(db, 'packages', pkg.id));
      // Ikut hapus cermin katalog publiknya juga — jangan sampai paket yang
      // udah dihapus dari sistem masih nongol di wisatahalalindonesia.com.
      await deleteDoc(doc(db, 'public_catalog', pkg.id)).catch((err) => {
        console.error('Gagal menghapus dari Katalog Produk publik:', err);
      });

      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'delete',
        module: 'Paket Perjalanan',
        targetLabel: pkg.name,
        details: `Menghapus paket "${pkg.name}" (${pkg.code || '-'}) dari katalog.`
      });

      fetchData();
    } catch (err) {
      alert("Gagal menghapus paket: " + err.message);
    }
  };

  // ============ Kelola Kategori Destinasi/Kota Tujuan (Tambah/Edit/Hapus) ============

  const openDestinationCategoryModal = () => {
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh kelola kategori destinasi.");
      return;
    }
    setDestinationCategoryDraft(destinationCategories.map((c, i) => ({ key: `existing-${i}`, original: c, value: c })));
    setNewDestinationCategoryText('');
    setShowDestinationCategoryModal(true);
  };

  const handleAddDestinationCategoryDraft = () => {
    const text = newDestinationCategoryText.trim();
    if (!text) return;
    const isDuplicate = destinationCategoryDraft.some(c => c.value.trim().toLowerCase() === text.toLowerCase());
    if (isDuplicate) {
      alert(`Destinasi "${text}" udah ada di daftar.`);
      return;
    }
    setDestinationCategoryDraft(prev => [...prev, { key: `new-${Date.now()}`, original: null, value: text }]);
    setNewDestinationCategoryText('');
  };

  const handleRenameDestinationCategoryDraft = (key, value) => {
    setDestinationCategoryDraft(prev => prev.map(c => c.key === key ? { ...c, value } : c));
  };

  const handleRemoveDestinationCategoryDraft = (key) => {
    const target = destinationCategoryDraft.find(c => c.key === key);
    if (!target) return;
    if (target.original) {
      const usedCount = packagesList.filter(p => p.destinationCity === target.original).length;
      if (usedCount > 0) {
        if (!confirm(`Destinasi "${target.original}" masih dipakai oleh ${usedCount} paket. Kalau dihapus dari daftar, paket-paket itu tetap tersimpan datanya (nggak ikut kehapus/kereset), cuma nggak muncul lagi di pilihan dropdown. Tetap hapus dari daftar?`)) return;
      }
    }
    setDestinationCategoryDraft(prev => prev.filter(c => c.key !== key));
  };

  const handleSaveDestinationCategories = async () => {
    const finalValues = destinationCategoryDraft.map(c => c.value.trim()).filter(Boolean);
    if (finalValues.length === 0) {
      alert("Minimal harus ada 1 destinasi.");
      return;
    }
    const lowerSet = new Set();
    for (const v of finalValues) {
      const lower = v.toLowerCase();
      if (lowerSet.has(lower)) {
        alert(`Ada destinasi yang namanya sama: "${v}". Gabungkan atau ganti dulu salah satunya.`);
        return;
      }
      lowerSet.add(lower);
    }

    setSavingDestinationCategories(true);
    try {
      // Rename: destinasi lama yang namanya diubah (bukan yang baru ditambah)
      // ikut disesuaikan ke semua paket yang masih pakai nama lama itu, biar
      // data paket existing tetap konsisten sama daftar destinasi terbaru.
      const renames = destinationCategoryDraft.filter(c => c.original && c.value.trim() && c.value.trim() !== c.original);
      for (const r of renames) {
        const affected = packagesList.filter(p => p.destinationCity === r.original);
        await Promise.all(affected.map(p => updateDoc(doc(db, 'packages', p.id), { destinationCity: r.value.trim() })));
      }

      await setDoc(doc(db, 'packages', DESTINATION_CATEGORY_CONFIG_ID), {
        isCategoryConfig: true,
        categories: finalValues,
        updatedAt: new Date().toISOString()
      });

      setDestinationCategories(finalValues);
      setShowDestinationCategoryModal(false);
      await fetchData();
    } catch (err) {
      alert("Gagal menyimpan daftar destinasi: " + err.message);
    }
    setSavingDestinationCategories(false);
  };

  // ============ Kelola Kategori Maskapai/Transportasi (Tambah/Edit/Hapus) ============
  // Pola & alasannya identik sama Kelola Kategori Destinasi di atas.

  const openAirlineCategoryModal = () => {
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh kelola kategori maskapai.");
      return;
    }
    setAirlineCategoryDraft(airlineCategories.map((c, i) => ({ key: `existing-${i}`, original: c, value: c })));
    setNewAirlineCategoryText('');
    setShowAirlineCategoryModal(true);
  };

  const handleAddAirlineCategoryDraft = () => {
    const text = newAirlineCategoryText.trim();
    if (!text) return;
    const isDuplicate = airlineCategoryDraft.some(c => c.value.trim().toLowerCase() === text.toLowerCase());
    if (isDuplicate) {
      alert(`Maskapai "${text}" udah ada di daftar.`);
      return;
    }
    setAirlineCategoryDraft(prev => [...prev, { key: `new-${Date.now()}`, original: null, value: text }]);
    setNewAirlineCategoryText('');
  };

  const handleRenameAirlineCategoryDraft = (key, value) => {
    setAirlineCategoryDraft(prev => prev.map(c => c.key === key ? { ...c, value } : c));
  };

  const handleRemoveAirlineCategoryDraft = (key) => {
    const target = airlineCategoryDraft.find(c => c.key === key);
    if (!target) return;
    if (target.original) {
      const usedCount = packagesList.filter(p => p.airline === target.original).length;
      if (usedCount > 0) {
        if (!confirm(`Maskapai "${target.original}" masih dipakai oleh ${usedCount} paket. Kalau dihapus dari daftar, paket-paket itu tetap tersimpan datanya (nggak ikut kehapus/kereset), cuma nggak muncul lagi di pilihan dropdown. Tetap hapus dari daftar?`)) return;
      }
    }
    setAirlineCategoryDraft(prev => prev.filter(c => c.key !== key));
  };

  const handleSaveAirlineCategories = async () => {
    const finalValues = airlineCategoryDraft.map(c => c.value.trim()).filter(Boolean);
    if (finalValues.length === 0) {
      alert("Minimal harus ada 1 maskapai.");
      return;
    }
    const lowerSet = new Set();
    for (const v of finalValues) {
      const lower = v.toLowerCase();
      if (lowerSet.has(lower)) {
        alert(`Ada maskapai yang namanya sama: "${v}". Gabungkan atau ganti dulu salah satunya.`);
        return;
      }
      lowerSet.add(lower);
    }

    setSavingAirlineCategories(true);
    try {
      // Rename: maskapai lama yang namanya diubah (bukan yang baru ditambah)
      // ikut disesuaikan ke semua paket yang masih pakai nama lama itu, biar
      // data paket existing tetap konsisten sama daftar maskapai terbaru.
      const renames = airlineCategoryDraft.filter(c => c.original && c.value.trim() && c.value.trim() !== c.original);
      for (const r of renames) {
        const affected = packagesList.filter(p => p.airline === r.original);
        await Promise.all(affected.map(p => updateDoc(doc(db, 'packages', p.id), { airline: r.value.trim() })));
      }

      await setDoc(doc(db, 'packages', AIRLINE_CATEGORY_CONFIG_ID), {
        isCategoryConfig: true,
        categories: finalValues,
        updatedAt: new Date().toISOString()
      });

      setAirlineCategories(finalValues);
      setShowAirlineCategoryModal(false);
      await fetchData();
    } catch (err) {
      alert("Gagal menyimpan daftar maskapai: " + err.message);
    }
    setSavingAirlineCategories(false);
  };

  // ============ ITINERARY PAKET ============

  const handleOpenItinerary = (pkg) => {
    setSelectedPackageForItinerary(pkg);
    const existing = Array.isArray(pkg.itinerary) ? pkg.itinerary : [];
    setItineraryDays(existing.length > 0 ? existing : [
      { title: '', description: '', meals: '', hotel: '' }
    ]);
    setShowItineraryModal(true);
  };

  const handleAddDay = () => {
    setItineraryDays(prev => [...prev, { title: '', description: '', meals: '', hotel: '' }]);
  };

  const handleRemoveDay = (idx) => {
    setItineraryDays(prev => prev.filter((_, i) => i !== idx));
  };

  const handleMoveDay = (idx, direction) => {
    setItineraryDays(prev => {
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const updated = [...prev];
      [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
      return updated;
    });
  };

  const handleDayFieldChange = (idx, field, value) => {
    setItineraryDays(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  };

  const handleSaveItinerary = async () => {
    if (!selectedPackageForItinerary) return;
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh mengubah itinerary.");
      return;
    }
    setSavingItinerary(true);
    try {
      await updateDoc(doc(db, 'packages', selectedPackageForItinerary.id), {
        itinerary: itineraryDays,
        updatedAt: new Date().toISOString()
      });
      // Itinerary ikut ditampilin di Katalog Produk publik, jadi cermin
      // `public_catalog`-nya perlu disinkron juga di sini.
      await syncPublicCatalog(selectedPackageForItinerary.id, { ...selectedPackageForItinerary, itinerary: itineraryDays });
      setShowItineraryModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal menyimpan itinerary: " + err.message);
    }
    setSavingItinerary(false);
  };

  // Format itinerary jadi teks rapi buat dikirim CS/TC ke customer via WhatsApp
  const buildItineraryText = (pkg, days) => {
    const header = `*ITINERARY PERJALANAN*\n*${pkg.name}*\n${pkg.code} • ${pkg.durationDays || '-'} • Berangkat ${formatDateDDMMYYYY(pkg.departureDate)}\n--------------------------------------------------`;
    const body = days.map((d, idx) => {
      const lines = [`\n*Hari ke-${idx + 1}${d.title ? ': ' + d.title : ''}*`];
      if (d.description) lines.push(d.description);
      if (d.hotel) lines.push(`🏨 Hotel: ${d.hotel}`);
      if (d.meals) lines.push(`🍽️ Makan: ${d.meals}`);
      return lines.join('\n');
    }).join('\n');
    return `${header}\n${body}`;
  };

  const handleShareItineraryWA = (pkg, days) => {
    if (!days || days.length === 0 || days.every(d => !d.title && !d.description)) {
      alert("Itinerary paket ini masih kosong. Isi dulu sebelum dibagikan.");
      return;
    }
    const text = buildItineraryText(pkg, days);
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  // Dokumen "Detail Paket Wisata" lengkap (3 halaman): (1) kop surat + info
  // paket + harga + Fasilitas & Layanan (Harga Termasuk/Tidak Termasuk) +
  // Informasi Pemesanan, (2) Deskripsi Paket + rincian penerbangan, (3)
  // Itinerary Program hari-per-hari. Dulu HTML/CSS dokumen ini ditulis ulang
  // manual di sini (dan nyaris kembar di halaman katalog publik) — sekarang
  // dipanggil dari satu fungsi bersama di src/lib/itineraryPrintDoc.js biar
  // kalau format cetakan diubah, dua-duanya (dashboard & publik) otomatis
  // ikut sinkron.
  const handlePrintItinerary = (pkg, days) => {
    printItineraryDocument(pkg, days, { companyInfo, logoSize: 165 });
  };

  // ============ Rencana Anggaran (Planning Cost) — tambah/edit/hapus baris ============
  // Pola array-of-rows yang sama kayak editor Itinerary — bedanya ini nggak
  // lewat updateDoc terpisah, cuma state form biasa yang ikut ke-submit
  // bareng field lain pas Simpan.

  const handleBudgetItemChange = (kind, idx, field, value) => {
    setFormData(prev => ({
      ...prev,
      [kind]: prev[kind].map((item, i) => i === idx ? { ...item, [field]: value } : item)
    }));
  };

  const handleAddBudgetItem = (kind) => {
    setFormData(prev => ({ ...prev, [kind]: [...prev[kind], { label: '', amount: '' }] }));
  };

  const handleRemoveBudgetItem = (kind, idx) => {
    setFormData(prev => ({ ...prev, [kind]: prev[kind].filter((_, i) => i !== idx) }));
  };

  // ============ Fasilitas & Layanan (Harga Termasuk/Tidak Termasuk) + Rincian Penerbangan ============
  // Pola array-of-rows sama persis kayak Rencana Anggaran di atas — bedanya
  // "priceIncludes" array of string polos (nggak butuh nominal), sedangkan
  // "priceExcludes" & "flightSegments" array of object (beberapa kolom).

  const handleIncludeItemChange = (idx, value) => {
    setFormData(prev => ({ ...prev, priceIncludes: prev.priceIncludes.map((v, i) => i === idx ? value : v) }));
  };
  const handleAddIncludeItem = () => {
    setFormData(prev => ({ ...prev, priceIncludes: [...prev.priceIncludes, ''] }));
  };
  const handleRemoveIncludeItem = (idx) => {
    setFormData(prev => ({ ...prev, priceIncludes: prev.priceIncludes.filter((_, i) => i !== idx) }));
  };

  const handleExcludeItemChange = (idx, field, value) => {
    setFormData(prev => ({ ...prev, priceExcludes: prev.priceExcludes.map((it, i) => i === idx ? { ...it, [field]: value } : it) }));
  };
  const handleAddExcludeItem = () => {
    setFormData(prev => ({ ...prev, priceExcludes: [...prev.priceExcludes, { label: '', amount: '', note: '' }] }));
  };
  const handleRemoveExcludeItem = (idx) => {
    setFormData(prev => ({ ...prev, priceExcludes: prev.priceExcludes.filter((_, i) => i !== idx) }));
  };

  const handleFlightSegmentChange = (idx, field, value) => {
    setFormData(prev => ({ ...prev, flightSegments: prev.flightSegments.map((it, i) => i === idx ? { ...it, [field]: value } : it) }));
  };
  const handleAddFlightSegment = () => {
    setFormData(prev => ({ ...prev, flightSegments: [...prev.flightSegments, { flightNumber: '', date: '', route: '', depTime: '', arrTime: '' }] }));
  };
  const handleRemoveFlightSegment = (idx) => {
    setFormData(prev => ({ ...prev, flightSegments: prev.flightSegments.filter((_, i) => i !== idx) }));
  };

  // ============ Flyer Promosi Paket (opsional) ============
  const handleFlyerFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // biar bisa pilih file yang sama lagi kalau mau ganti ulang
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('File harus berupa gambar (JPG/PNG/dll).');
      return;
    }
    setUploadingFlyer(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      // Firestore batasin 1 dokumen maks ~1MB — dijaga jauh di bawah itu
      // (500KB) biar masih ada ruang buat field lain (itinerary, budget
      // items, dll) di dokumen paket yang sama.
      if (dataUrl.length > 500 * 1024) {
        alert('Gambar masih terlalu besar walau udah dikompres. Coba pakai foto lain yang lebih sederhana/resolusi lebih rendah.');
      } else {
        setFormData(prev => ({ ...prev, flyerImageDataUrl: dataUrl }));
      }
    } catch (err) {
      console.error('Gagal memproses flyer:', err);
      alert('Gagal memproses gambar flyer: ' + err.message);
    }
    setUploadingFlyer(false);
  };

  const handleRemoveFlyer = () => {
    setFormData(prev => ({ ...prev, flyerImageDataUrl: '' }));
  };

  // Dipakai buat preview live di modal DAN buat hitung budgetCostTotal yang
  // disimpen ke Firestore pas Simpan.
  const sumBudgetItems = (items) => (items || []).reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
  const budgetFixedCostTotal = sumBudgetItems(formData.budgetFixedCostItems);
  const budgetVariableCostTotal = sumBudgetItems(formData.budgetVariableCostItems);
  const budgetCostTotalPreview = budgetFixedCostTotal + budgetVariableCostTotal;
  const budgetPlanningSellingTotal = Number(formData.priceMain || 0) * Number(formData.quotaTotal || 0);
  const budgetPlanningMarginTotal = budgetPlanningSellingTotal - budgetCostTotalPreview;
  const budgetPlanningMarginPerPax = Number(formData.priceMain || 0) - (Number(formData.quotaTotal) > 0 ? budgetCostTotalPreview / Number(formData.quotaTotal) : 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canManagePackages) {
      alert("Cuma Super Admin & Operational yang boleh menyimpan data paket.");
      return;
    }
    if (savingPackage) return; // guard anti double-submit — lihat catatan di state savingPackage
    setSavingPackage(true);
    try {
      const cleanedFixedCostItems = (formData.budgetFixedCostItems || [])
        .filter(it => (it.label && it.label.trim()) || Number(it.amount) > 0)
        .map(it => ({ label: it.label || '', amount: Number(it.amount) || 0 }));
      const cleanedVariableCostItems = (formData.budgetVariableCostItems || [])
        .filter(it => (it.label && it.label.trim()) || Number(it.amount) > 0)
        .map(it => ({ label: it.label || '', amount: Number(it.amount) || 0 }));
      const cleanedPriceIncludes = (formData.priceIncludes || []).map(v => (v || '').trim()).filter(Boolean);
      const cleanedPriceExcludes = (formData.priceExcludes || [])
        .filter(it => it.label && it.label.trim())
        .map(it => ({ label: it.label.trim(), amount: Number(it.amount) || 0, note: (it.note || '').trim() }));
      const cleanedFlightSegments = (formData.flightSegments || [])
        .filter(it => (it.flightNumber && it.flightNumber.trim()) || (it.route && it.route.trim()))
        .map(it => ({
          flightNumber: (it.flightNumber || '').trim(), date: it.date || '',
          route: (it.route || '').trim(), depTime: (it.depTime || '').trim(), arrTime: (it.arrTime || '').trim()
        }));
      const payload = {
        code: formData.code,
        name: formData.name,
        type: formData.type,
        departureDate: formData.departureDate,
        durationDays: formData.durationDays,
        airline: formData.airline,
        hotelMakkah: formData.hotelMakkah,
        hotelMadinah: formData.hotelMadinah,
        destinationCity: formData.destinationCity,
        hotelTour: formData.hotelTour,
        laScope: formData.laScope,
        quotaTotal: Number(formData.quotaTotal),
        priceMain: Number(formData.priceMain || 0),
        priceQuad: Number(formData.priceMain || 0),
        priceTriple: Number(formData.priceTriple || 0),
        priceDouble: Number(formData.priceDouble || 0),
        priceChild: Number(formData.priceChild || 0),
        budgetFixedCostItems: cleanedFixedCostItems,
        budgetVariableCostItems: cleanedVariableCostItems,
        budgetCostTotal: sumBudgetItems(cleanedFixedCostItems) + sumBudgetItems(cleanedVariableCostItems),
        priceIncludes: cleanedPriceIncludes,
        priceExcludes: cleanedPriceExcludes,
        flightSegments: cleanedFlightSegments,
        specialNote: formData.specialNote || '',
        flyerImageDataUrl: formData.flyerImageDataUrl || '',
        isActive: formData.isActive !== false,
        updatedAt: new Date().toISOString()
      };

      if (editingPackageId) {
        // Kalau Kuota Total diubah, sesuaikan Sisa Kuota dengan selisihnya —
        // supaya jumlah seat yang udah kepake (booking existing) tetap
        // konsisten, bukan malah ke-reset balik penuh.
        const originalPkg = packagesList.find(p => p.id === editingPackageId);
        if (originalPkg) {
          const oldTotal = Number(originalPkg.quotaTotal || 0);
          const oldRemaining = Number(originalPkg.quotaRemaining ?? originalPkg.quotaTotal ?? 0);
          const delta = payload.quotaTotal - oldTotal;
          payload.quotaRemaining = Math.max(0, oldRemaining + delta);
        }
        await updateDoc(doc(db, 'packages', editingPackageId), payload);
        // Sinkron cermin Katalog Produk publik — gabungin data paket lama
        // (itinerary, dll yang nggak ikut di-touch payload form ini) sama
        // field yang baru aja diubah, biar public_catalog tetap lengkap &
        // up to date.
        await syncPublicCatalog(editingPackageId, { ...originalPkg, ...payload });

        // Sinkronkan revisi harga jual ke SEMUA booking AKTIF yang masih
        // pakai paket ini. Booking nyimpen harga sendiri sebagai SNAPSHOT
        // (field `totalAmount`, dihitung dari harga paket + biaya tambahan
        // - diskon + PPN, dibekukan pas booking dibuat) — kalau nggak
        // disinkronkan di sini, revisi harga paket master nggak bakal
        // kebawa ke SO/tagihan customer yang udah ada, dan piutang jamaah
        // di Laporan Keuangan tetap pakai harga lama selamanya. Booking
        // yang statusnya bukan 'active' (batal/reschedule) dilewatin —
        // harga mereka udah nggak relevan lagi.
        let syncedBookingCount = 0;
        const priceChanged = ['priceMain', 'priceQuad', 'priceTriple', 'priceDouble'].some(
          k => Number(originalPkg?.[k] || 0) !== Number(payload[k] || 0)
        );
        if (originalPkg && priceChanged) {
          try {
            const bookingsSnap = await getDocs(query(collection(db, 'bookings'), where('packageId', '==', editingPackageId)));
            const activeBookings = bookingsSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(b => (b.status || 'active') === 'active');
            const nowIso = new Date().toISOString();
            for (const b of activeBookings) {
              let newBasePrice = Number(payload.priceQuad || payload.priceMain || 0);
              if (b.roomType === 'Triple') newBasePrice = Number(payload.priceTriple || newBasePrice);
              if (b.roomType === 'Double') newBasePrice = Number(payload.priceDouble || newBasePrice);
              const chargesTotal = (b.extraCharges || []).reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
              const discountsTotal = (b.extraDiscounts || []).reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
              const newTotalAmount = addPPN(newBasePrice + chargesTotal - discountsTotal).total;
              const delta = newTotalAmount - Number(b.totalAmount || 0);
              if (delta === 0) continue;
              await updateDoc(doc(db, 'bookings', b.id), { totalAmount: newTotalAmount, updatedAt: nowIso });
              // Piutang Jamaah & Pendapatan Diterima Dimuka disesuaikan
              // sebesar selisihnya doang — akun ini balance-sheet-only,
              // nggak nyentuh akun Pendapatan (4101) yang udah "Diakui" di
              // P&L (kalaupun paketnya udah "Akui Pendapatan", itu dihitung
              // dari uang yang beneran disetor, bukan dari totalAmount ini
              // — jadi aman disinkronkan kapan pun).
              await postJournalEntry({
                date: nowIso,
                description: `Sinkron Revisi Harga Paket "${payload.name}" - ${b.bookingCode || b.id}`,
                source: 'booking_edit_adjustment', sourceDocId: b.id, reference: b.bookingCode || '',
                lines: delta > 0 ? [
                  { accountCode: ACC.PIUTANG_JAMAAH, accountName: 'Piutang Jamaah', debit: delta, credit: 0 },
                  { accountCode: ACC.PENDAPATAN_DITERIMA_DIMUKA, accountName: 'Pendapatan Diterima Dimuka', debit: 0, credit: delta },
                ] : [
                  { accountCode: ACC.PENDAPATAN_DITERIMA_DIMUKA, accountName: 'Pendapatan Diterima Dimuka', debit: -delta, credit: 0 },
                  { accountCode: ACC.PIUTANG_JAMAAH, accountName: 'Piutang Jamaah', debit: 0, credit: -delta },
                ],
                createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
              }).catch(err => {
                console.error('Gagal posting jurnal sinkron revisi harga paket:', err);
              });
              syncedBookingCount++;
            }
            if (syncedBookingCount > 0) {
              alert(`Harga paket "${payload.name}" berhasil diperbarui. ${syncedBookingCount} booking aktif yang masih pakai paket ini otomatis ikut disesuaikan tagihan & jurnalnya.`);
            }
          } catch (syncErr) {
            console.error('Gagal menyinkronkan revisi harga ke booking existing:', syncErr);
            alert(`Harga paket tersimpan, TAPI GAGAL menyinkronkan ke booking yang udah ada (${syncErr.message}). Tagihan/piutang booking lama mungkin masih pakai harga lama — cek manual di Booking & Manifest, atau lapor ke tim IT.`);
          }
        }

        logActivity({
          userId: currentUser?.uid,
          userName: currentUser?.fullName || currentUser?.email,
          userRole: currentUser?.role,
          action: 'update',
          module: 'Paket Perjalanan',
          targetLabel: payload.name,
          details: `Mengubah data paket "${payload.name}" (${payload.code || '-'})${syncedBookingCount > 0 ? ` — ${syncedBookingCount} booking aktif ikut disesuaikan harga/tagihannya` : ''}.`
        });
      } else {
        // Paket baru: Sisa Kuota harus diisi penuh sama dengan Kuota Total
        // saat dibuat — kalau nggak, field ini kosong (undefined) dan semua
        // booking ke paket ini bakal ditolak sistem karena dianggap 0 seat.
        payload.quotaRemaining = payload.quotaTotal;
        payload.createdAt = new Date().toISOString();
        const newPkgRef = await addDoc(collection(db, 'packages'), payload);
        // Paket baru langsung disinkron ke Katalog Produk publik kalau
        // statusnya Aktif (default-nya memang Aktif, lihat formData.isActive).
        await syncPublicCatalog(newPkgRef.id, payload);

        logActivity({
          userId: currentUser?.uid,
          userName: currentUser?.fullName || currentUser?.email,
          userRole: currentUser?.role,
          action: 'create',
          module: 'Paket Perjalanan',
          targetLabel: payload.name,
          details: `Membuat paket baru "${payload.name}" (${payload.code || '-'}).`
        });
      }

      setShowModal(false);
      fetchData();
    } catch (err) {
      alert("Gagal menyimpan paket: " + err.message);
    } finally {
      setSavingPackage(false);
    }
  };

  // Extract Periode. Maskapai buat filter sekarang ambil dari daftar
  // Kategori Maskapai yang udah dibakukan (airlineCategories), bukan lagi
  // nge-scan nilai mentah dari packagesList — biar seragam sama pola
  // Destinasi/Kota Tujuan (dan nggak nampilin varian penulisan lama yang
  // beda-beda kalau ada data legacy sebelum kategori ini dibuat).
  const availablePeriods = Array.from(new Set(packagesList.map(p => formatMonthYear(p.departureDate)).filter(Boolean)));

  // Sisa Seat dihitung dari Kuota Total dikurangi booking yang statusnya
  // masih 'active' — yang udah dibatalkan/di-reschedule kuotanya udah
  // dikembalikan ke paket (lihat BookingsModule.jsx). Dipisah jadi helper
  // biar dipakai bareng buat tampilan tabel/kartu dan buat sorting.
  const getPackageSeatInfo = (pkg) => {
    const bookedSeatsCount = bookingsList.filter(
      b => (b.packageId === pkg.id || b.packageName === pkg.name) && (b.status || 'active') === 'active'
    ).length;
    const totalQuota = Number(pkg.quotaTotal) || 0;
    const remainingQuota = Math.max(0, totalQuota - bookedSeatsCount);
    return { totalQuota, remainingQuota };
  };

  // Logika Filter
  const filteredPackages = packagesList.filter((pkg) => {
    const matchesSearch =
      (pkg.name && pkg.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (pkg.code && pkg.code.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (pkg.destinationCity && pkg.destinationCity.toLowerCase().includes(searchTerm.toLowerCase()));

    const pkgPeriod = formatMonthYear(pkg.departureDate);
    const matchesPeriod = !selectedPeriod || pkgPeriod === selectedPeriod;
    const matchesDestination = !selectedDestination || pkg.type === selectedDestination;
    const matchesDestinationCity = !selectedDestinationCity || pkg.destinationCity === selectedDestinationCity;
    const matchesAirline = !selectedAirline || pkg.airline === selectedAirline;

    return matchesSearch && matchesPeriod && matchesDestination && matchesDestinationCity && matchesAirline;
  });

  // Logika Sort — dipisah dari filter biar urutan aslinya (createdAt) tetap
  // jadi default kalau user belum pilih opsi sort apapun.
  const sortedPackages = [...filteredPackages].sort((a, b) => {
    switch (sortBy) {
      case 'name_asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name_desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'date_asc':
        return new Date(a.departureDate || 0) - new Date(b.departureDate || 0);
      case 'date_desc':
        return new Date(b.departureDate || 0) - new Date(a.departureDate || 0);
      case 'price_asc':
        return Number(a.priceMain || a.priceQuad || 0) - Number(b.priceMain || b.priceQuad || 0);
      case 'price_desc':
        return Number(b.priceMain || b.priceQuad || 0) - Number(a.priceMain || a.priceQuad || 0);
      case 'seat_asc':
        return getPackageSeatInfo(a).remainingQuota - getPackageSeatInfo(b).remainingQuota;
      case 'seat_desc':
        return getPackageSeatInfo(b).remainingQuota - getPackageSeatInfo(a).remainingQuota;
      default:
        return 0;
    }
  });

  // Pengelompokan per Bulan Keberangkatan — dipakai buat Tampilan "Per
  // Bulan", biar polanya mirip sheet "Cek Seat" (yang disusun per bulan:
  // JANUARI, FEBRUARI, dst) sehingga gampang dicocokkan paket mana yang
  // udah dibuat di sistem. Dikelompokkan dari sortedPackages (jadi ikut
  // filter & pencarian yang aktif), lalu urutan grup bulannya dibikin
  // kronologis berdasarkan tanggal keberangkatan paling awal di grup itu —
  // bukan abjad — biar bulan terdekat selalu muncul duluan.
  const packagesByMonth = (() => {
    const groupsMap = {};
    const order = [];
    sortedPackages.forEach((pkg) => {
      const label = formatMonthYear(pkg.departureDate) || 'Tanpa Tanggal Keberangkatan';
      if (!groupsMap[label]) {
        groupsMap[label] = { label, packages: [], earliestDate: pkg.departureDate ? new Date(pkg.departureDate) : null };
        order.push(label);
      }
      groupsMap[label].packages.push(pkg);
      const pkgDate = pkg.departureDate ? new Date(pkg.departureDate) : null;
      if (pkgDate && !isNaN(pkgDate.getTime())) {
        if (!groupsMap[label].earliestDate || isNaN(groupsMap[label].earliestDate.getTime()) || pkgDate < groupsMap[label].earliestDate) {
          groupsMap[label].earliestDate = pkgDate;
        }
      }
    });
    return order
      .map((label) => groupsMap[label])
      .sort((a, b) => {
        // Grup tanpa tanggal keberangkatan yang valid selalu ditaruh paling
        // akhir, apapun urutan sort yang aktif.
        if (!a.earliestDate || isNaN(a.earliestDate.getTime())) return 1;
        if (!b.earliestDate || isNaN(b.earliestDate.getTime())) return -1;
        return sortBy === 'date_desc'
          ? b.earliestDate - a.earliestDate
          : a.earliestDate - b.earliestDate;
      });
  })();

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedPeriod('');
    setSelectedDestination('');
    setSelectedDestinationCity('');
    setSelectedAirline('');
    setSortBy('');
  };

  const isTourOrLA = formData.type === 'Wisata Halal Internasional' || formData.type === 'Land Arrangement (LA) Only';
  const isLAOnly = formData.type === 'Land Arrangement (LA) Only';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Package className="w-5 h-5 text-emerald-500" /> Katalog Paket Travel & LA
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Kelola program keberangkatan, akomodasi, dan harga paket secara adaptif.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tombol kecil buka Katalog Publik (/katalog) di tab baru — biar staf
              gampang cek langsung tampilan katalog yang keliatan calon customer,
              tanpa perlu ngetik URL manual. Link ini nggak butuh login khusus
              karena /katalog memang halaman publik (lihat src/app/katalog/page.js). */}
          <a
            href="/katalog"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
              isDark
                ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
            title="Buka halaman Katalog Publik di tab baru"
          >
            <ExternalLink className="w-4 h-4" /> Lihat Katalog Publik
          </a>
          {canManagePackages && (
            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/10"
            >
              <Plus className="w-4 h-4" /> Buat Paket Baru
            </button>
          )}
        </div>
      </div>

      {/* FILTER BAR */}
      <div className={`${styles.cardBg} p-4 rounded-xl border space-y-3`}>
        <div className={`flex items-center justify-between gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-3`}>
          <span className={`text-xs font-bold ${styles.textTitle} flex items-center gap-1.5`}>
            <Filter className="w-4 h-4 text-emerald-500" /> Filter Data Keberangkatan
          </span>
          <div className="flex items-center gap-3">
            {(searchTerm || selectedPeriod || selectedDestination || selectedDestinationCity || selectedAirline || sortBy) && (
              <button onClick={resetFilters} className="text-[11px] text-rose-500 hover:underline flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Reset Filter
              </button>
            )}
            <div className={`flex items-center rounded-lg border ${isDark ? 'border-slate-700' : 'border-slate-200'} overflow-hidden text-[11px] font-medium`}>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                title="Tampilan List"
                className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-emerald-600 text-white'
                    : `${isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white text-slate-600 hover:bg-slate-100'}`
                }`}
              >
                <List className="w-3.5 h-3.5" /> List
              </button>
              <button
                type="button"
                onClick={() => setViewMode('monthly')}
                title="Tampilan Per Bulan Keberangkatan"
                className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors border-l ${isDark ? 'border-slate-700' : 'border-slate-200'} ${
                  viewMode === 'monthly'
                    ? 'bg-emerald-600 text-white'
                    : `${isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white text-slate-600 hover:bg-slate-100'}`
                }`}
              >
                <CalendarRange className="w-3.5 h-3.5" /> Per Bulan
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Cari Nama / Kode / Destinasi..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            />
          </div>

          <div className="relative">
            <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            >
              <option value="">-- Semua Periode --</option>
              {availablePeriods.map((period, idx) => (
                <option key={idx} value={period}>{period}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <select
              value={selectedDestination}
              onChange={(e) => setSelectedDestination(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            >
              <option value="">-- Semua Destinasi / Jenis --</option>
              <option value="Umroh Regular">Umroh Regular</option>
              <option value="Umroh VIP / Plus">Umroh VIP / Plus</option>
              <option value="Haji Khusus / Furoda">Haji Khusus / Furoda</option>
              <option value="Wisata Halal Internasional">Wisata Halal Internasional</option>
              <option value="Land Arrangement (LA) Only">Land Arrangement (LA) Only</option>
            </select>
          </div>

          <div className="relative">
            <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <select
              value={selectedDestinationCity}
              onChange={(e) => setSelectedDestinationCity(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            >
              <option value="">-- Semua Destinasi/Kota --</option>
              {destinationCategories.map((dest, idx) => (
                <option key={idx} value={dest}>{dest}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <Plane className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <select
              value={selectedAirline}
              onChange={(e) => setSelectedAirline(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            >
              <option value="">-- Semua Maskapai --</option>
              {airlineCategories.map((airline, idx) => (
                <option key={idx} value={airline}>{airline}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <ArrowUpDown className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
            >
              <option value="">-- Urutan Default --</option>
              <option value="date_asc">Keberangkatan (Terdekat)</option>
              <option value="date_desc">Keberangkatan (Terjauh)</option>
              <option value="name_asc">Nama Paket (A-Z)</option>
              <option value="name_desc">Nama Paket (Z-A)</option>
              <option value="price_asc">Harga (Termurah)</option>
              <option value="price_desc">Harga (Termahal)</option>
              <option value="seat_asc">Sisa Seat (Tersedikit)</option>
              <option value="seat_desc">Sisa Seat (Terbanyak)</option>
            </select>
          </div>
        </div>
      </div>

      {/* TABEL DATA PAKET (Tampilan List) */}
      {viewMode === 'list' && (
      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`${styles.tableHeaderBg} uppercase tracking-wider border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <tr>
                <th className="p-4">Kode & Nama Paket</th>
                <th className="p-4">Jenis & Maskapai</th>
                <th className="p-4">Tgl Keberangkatan</th>
                <th className="p-4">Akomodasi / Destinasi</th>
                <th className="p-4">Harga Utama / Pax</th>
                <th className="p-4 text-center">Sisa Seat</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {loading ? (
                <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Memuat katalog paket...</td></tr>
              ) : sortedPackages.length === 0 ? (
                <tr><td colSpan="7" className={`p-8 text-center ${styles.textSub}`}>Tidak ada paket yang sesuai dengan filter pencarian.</td></tr>
              ) : (
                sortedPackages.map((pkg) => {
                  const isTourPkg = pkg.type === 'Wisata Halal Internasional' || pkg.type === 'Land Arrangement (LA) Only';
                  const { totalQuota, remainingQuota } = getPackageSeatInfo(pkg);

                  return (
                    <tr key={pkg.id} className={`${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'} transition-colors`}>
                      <td className={`p-4 font-semibold ${styles.textTitle}`}>
                        {pkg.name}
                        <span className="block text-[10px] text-emerald-500 font-mono">{pkg.code} • {pkg.durationDays || '9 Hari'}</span>
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          pkg.isActive !== false
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                            : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                        }`}>
                          {pkg.isActive !== false ? 'Aktif di Katalog' : 'Nonaktif di Katalog'}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] block w-fit mb-1 font-medium`}>{pkg.type}</span>
                        <span className={`${styles.textSub} text-[11px] flex items-center gap-1`}>
                          <Plane className="w-3 h-3 text-blue-500" /> {pkg.airline || '-'}
                        </span>
                      </td>
                      <td className={`p-4 font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        {formatDateDDMMYYYY(pkg.departureDate)}
                      </td>
                      <td className={`p-4 ${styles.textSub} text-[11px]`}>
                        {isTourPkg ? (
                          <>
                            <div>Destinasi: <span className={`${styles.textTitle} font-medium`}>{pkg.destinationCity || '-'}</span></div>
                            <div>Fasilitas: <span className={styles.textTitle}>{pkg.hotelTour || pkg.laScope || '-'}</span></div>
                          </>
                        ) : (
                          <>
                            <div>Makkah: <span className={styles.textTitle}>{pkg.hotelMakkah || '-'}</span></div>
                            <div>Madinah: <span className={styles.textTitle}>{pkg.hotelMadinah || '-'}</span></div>
                          </>
                        )}
                      </td>
                      <td className="p-4 font-bold text-emerald-500">
                        Rp {(pkg.priceMain || pkg.priceQuad) ? Number(pkg.priceMain || pkg.priceQuad).toLocaleString('id-ID') : '0'}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap inline-block ${
                          remainingQuota > 5 
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                            : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                        }`}>
                          {remainingQuota} / {totalQuota}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleOpenItinerary(pkg)}
                            className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-purple-500 rounded-lg transition-colors relative`}
                            title="Itinerary Perjalanan"
                          >
                            <ListOrdered className="w-4 h-4" />
                            {Array.isArray(pkg.itinerary) && pkg.itinerary.length > 0 && (
                              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-purple-500 text-white text-[8px] rounded-full flex items-center justify-center font-bold">
                                {pkg.itinerary.length}
                              </span>
                            )}
                          </button>
                          {canManagePackages && (
                            <>
                              <button
                                onClick={() => handleToggleActive(pkg)}
                                className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} ${pkg.isActive !== false ? 'text-amber-500' : 'text-slate-400'} rounded-lg transition-colors`}
                                title={pkg.isActive !== false ? 'Nonaktifkan dari Katalog Produk' : 'Aktifkan di Katalog Produk'}
                              >
                                {pkg.isActive !== false ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => handleOpenEdit(pkg)}
                                className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                                title="Edit Paket"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(pkg)}
                                className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                                title="Hapus Paket"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-3 p-4">
          {loading ? (
            <div className={`p-8 text-center text-xs ${styles.textSub}`}>Memuat katalog paket...</div>
          ) : sortedPackages.length === 0 ? (
            <div className={`p-8 text-center text-xs ${styles.textSub}`}>Tidak ada paket yang sesuai dengan filter pencarian.</div>
          ) : (
            sortedPackages.map((pkg) => {
              const isTourPkg = pkg.type === 'Wisata Halal Internasional' || pkg.type === 'Land Arrangement (LA) Only';
              const { totalQuota, remainingQuota } = getPackageSeatInfo(pkg);

              return (
                <div key={pkg.id} className={`${styles.innerBg} border rounded-xl p-4 text-xs space-y-2`}>
                  <div>
                    <div className={`font-semibold ${styles.textTitle}`}>{pkg.name}</div>
                    <div className="text-[10px] text-emerald-500 font-mono">{pkg.code} • {pkg.durationDays || '9 Hari'}</div>
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                      pkg.isActive !== false
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                        : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}>
                      {pkg.isActive !== false ? 'Aktif di Katalog' : 'Nonaktif di Katalog'}
                    </span>
                  </div>

                  <div className={`space-y-1 ${styles.textSub}`}>
                    <div>
                      Jenis: <span className={`${styles.textTitle} font-medium`}>{pkg.type}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      Maskapai: <Plane className="w-3 h-3 text-blue-500" /> <span className={styles.textTitle}>{pkg.airline || '-'}</span>
                    </div>
                    <div>
                      Tgl Keberangkatan: <span className={styles.textTitle}>{formatDateDDMMYYYY(pkg.departureDate)}</span>
                    </div>
                    {isTourPkg ? (
                      <>
                        <div>Destinasi: <span className={`${styles.textTitle} font-medium`}>{pkg.destinationCity || '-'}</span></div>
                        <div>Fasilitas: <span className={styles.textTitle}>{pkg.hotelTour || pkg.laScope || '-'}</span></div>
                      </>
                    ) : (
                      <>
                        <div>Makkah: <span className={styles.textTitle}>{pkg.hotelMakkah || '-'}</span></div>
                        <div>Madinah: <span className={styles.textTitle}>{pkg.hotelMadinah || '-'}</span></div>
                      </>
                    )}
                    <div>
                      Harga Utama / Pax: <span className="font-bold text-emerald-500">
                        Rp {(pkg.priceMain || pkg.priceQuad) ? Number(pkg.priceMain || pkg.priceQuad).toLocaleString('id-ID') : '0'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      Sisa Seat:
                      <span className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap inline-block ${
                        remainingQuota > 5
                          ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                      }`}>
                        {remainingQuota} / {totalQuota}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      onClick={() => handleOpenItinerary(pkg)}
                      className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-purple-500 rounded-lg transition-colors relative`}
                      title="Itinerary Perjalanan"
                    >
                      <ListOrdered className="w-4 h-4" />
                      {Array.isArray(pkg.itinerary) && pkg.itinerary.length > 0 && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-purple-500 text-white text-[8px] rounded-full flex items-center justify-center font-bold">
                          {pkg.itinerary.length}
                        </span>
                      )}
                    </button>
                    {canManagePackages && (
                      <>
                        <button
                          onClick={() => handleToggleActive(pkg)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} ${pkg.isActive !== false ? 'text-amber-500' : 'text-slate-400'} rounded-lg transition-colors`}
                          title={pkg.isActive !== false ? 'Nonaktifkan dari Katalog Produk' : 'Aktifkan di Katalog Produk'}
                        >
                          {pkg.isActive !== false ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleOpenEdit(pkg)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                          title="Edit Paket"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(pkg)}
                          className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg transition-colors`}
                          title="Hapus Paket"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      )}

      {/* TAMPILAN PER BULAN KEBERANGKATAN — buat cocokkan sama sheet "Cek Seat" */}
      {viewMode === 'monthly' && (
        <div className="space-y-4">
          {loading ? (
            <div className={`${styles.cardBg} border rounded-xl p-8 text-center text-xs ${styles.textSub}`}>Memuat katalog paket...</div>
          ) : packagesByMonth.length === 0 ? (
            <div className={`${styles.cardBg} border rounded-xl p-8 text-center text-xs ${styles.textSub}`}>Tidak ada paket yang sesuai dengan filter pencarian.</div>
          ) : (
            packagesByMonth.map((group) => {
              const groupSeatTotals = group.packages.reduce((acc, pkg) => {
                const { totalQuota, remainingQuota } = getPackageSeatInfo(pkg);
                acc.total += totalQuota;
                acc.remaining += remainingQuota;
                return acc;
              }, { total: 0, remaining: 0 });

              return (
                <div key={group.label} className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
                  <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b ${isDark ? 'border-slate-800 bg-slate-800/40' : 'border-slate-200 bg-slate-50'}`}>
                    <span className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
                      <Calendar className="w-4 h-4 text-emerald-500" /> {group.label}
                      <span className={`text-[11px] font-normal ${styles.textSub}`}>({group.packages.length} paket)</span>
                    </span>
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                      groupSeatTotals.remaining > 0
                        ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                    }`}>
                      Sisa Seat: {groupSeatTotals.remaining} / {groupSeatTotals.total}
                    </span>
                  </div>

                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className={`${styles.tableHeaderBg} uppercase tracking-wider border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                        <tr>
                          <th className="p-3">Kode & Nama Paket</th>
                          <th className="p-3">Jenis & Maskapai</th>
                          <th className="p-3">Tgl Keberangkatan</th>
                          <th className="p-3">Destinasi/Kota</th>
                          <th className="p-3 text-center">Sisa Seat</th>
                          <th className="p-3 text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${styles.tableRowBorder}`}>
                        {group.packages.map((pkg) => {
                          const { totalQuota, remainingQuota } = getPackageSeatInfo(pkg);
                          return (
                            <tr key={pkg.id} className={`${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'} transition-colors`}>
                              <td className={`p-3 font-semibold ${styles.textTitle}`}>
                                {pkg.name}
                                <span className="block text-[10px] text-emerald-500 font-mono">{pkg.code}</span>
                              </td>
                              <td className="p-3">
                                <span className={`${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded text-[10px] block w-fit mb-1 font-medium`}>{pkg.type}</span>
                                <span className={`${styles.textSub} text-[11px] flex items-center gap-1`}>
                                  <Plane className="w-3 h-3 text-blue-500" /> {pkg.airline || '-'}
                                </span>
                              </td>
                              <td className={`p-3 font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                                {formatDateDDMMYYYY(pkg.departureDate)}
                              </td>
                              <td className={`p-3 ${styles.textSub}`}>{pkg.destinationCity || '-'}</td>
                              <td className="p-3 text-center">
                                <span className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap inline-block ${
                                  remainingQuota > 5
                                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                    : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                }`}>
                                  {remainingQuota} / {totalQuota}
                                </span>
                              </td>
                              <td className="p-3 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => handleOpenItinerary(pkg)}
                                    className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-purple-500 rounded-lg transition-colors`}
                                    title="Itinerary Perjalanan"
                                  >
                                    <ListOrdered className="w-4 h-4" />
                                  </button>
                                  {canManagePackages && (
                                    <button
                                      onClick={() => handleOpenEdit(pkg)}
                                      className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                                      title="Edit Paket"
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="md:hidden space-y-3 p-4">
                    {group.packages.map((pkg) => {
                      const { totalQuota, remainingQuota } = getPackageSeatInfo(pkg);
                      return (
                        <div key={pkg.id} className={`${styles.innerBg} border rounded-xl p-4 text-xs space-y-2`}>
                          <div>
                            <div className={`font-semibold ${styles.textTitle}`}>{pkg.name}</div>
                            <div className="text-[10px] text-emerald-500 font-mono">{pkg.code}</div>
                          </div>
                          <div className={`space-y-1 ${styles.textSub}`}>
                            <div>Jenis: <span className={`${styles.textTitle} font-medium`}>{pkg.type}</span></div>
                            <div className="flex items-center gap-1">Maskapai: <Plane className="w-3 h-3 text-blue-500" /> <span className={styles.textTitle}>{pkg.airline || '-'}</span></div>
                            <div>Tgl Keberangkatan: <span className={styles.textTitle}>{formatDateDDMMYYYY(pkg.departureDate)}</span></div>
                            <div>Destinasi/Kota: <span className={styles.textTitle}>{pkg.destinationCity || '-'}</span></div>
                            <div className="flex items-center gap-2">
                              Sisa Seat:
                              <span className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap inline-block ${
                                remainingQuota > 5
                                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                              }`}>
                                {remainingQuota} / {totalQuota}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 pt-2">
                            <button
                              onClick={() => handleOpenItinerary(pkg)}
                              className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-purple-500 rounded-lg transition-colors`}
                              title="Itinerary Perjalanan"
                            >
                              <ListOrdered className="w-4 h-4" />
                            </button>
                            {canManagePackages && (
                              <button
                                onClick={() => handleOpenEdit(pkg)}
                                className={`p-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-emerald-500 rounded-lg transition-colors`}
                                title="Edit Paket"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* MODAL ADAPTIF */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4 flex items-center gap-2`}>
              <Package className="w-5 h-5 text-emerald-500" /> {editingPackageId ? 'Edit Program Paket' : 'Buat Program Paket Baru'}
            </h3>

            <form onSubmit={handleSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div className={`${styles.innerBg} border rounded-lg p-3 flex items-center justify-between gap-3`}>
                <div>
                  <label className="block font-medium">Status Katalog Produk</label>
                  <p className={`text-[10px] ${styles.textSub} mt-0.5`}>
                    Nonaktifkan kalau paket ini nggak mau tampil di Katalog Produk publik (wisatahalalindonesia.com) — booking/SO yang udah ada TETAP jalan normal, ini cuma soal visibilitas di katalog.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, isActive: !(formData.isActive !== false) })}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                    formData.isActive !== false
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                      : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  }`}
                >
                  {formData.isActive !== false ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {formData.isActive !== false ? 'Aktif' : 'Nonaktif'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Kode Paket</label>
                  <input
                    type="text" readOnly required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 font-mono font-bold text-emerald-500 opacity-80 cursor-not-allowed`}
                    value={formData.code}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Jenis / Kategori Program</label>
                  <select
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5 font-semibold text-emerald-500`}
                    value={formData.type}
                    onChange={e => setFormData({ ...formData, type: e.target.value })}
                  >
                    <option value="Umroh Regular">Umroh Regular</option>
                    <option value="Umroh VIP / Plus">Umroh VIP / Plus</option>
                    <option value="Haji Khusus / Furoda">Haji Khusus / Furoda</option>
                    <option value="Wisata Halal Internasional">Wisata Halal Internasional</option>
                    <option value="Land Arrangement (LA) Only">Land Arrangement (LA) Only</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium">Nama Program Paket</label>
                <input
                  type="text" required 
                  placeholder={isTourOrLA ? "Contoh: Korea School Holiday 30 Juni - 06 Juli 2027" : "Contoh: Umroh Regular 9D Januari 2027"}
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block mb-1 font-medium">Flyer Promosi Paket (opsional)</label>
                <p className="text-[10.5px] opacity-60 mb-2">Kalau diisi, gambar ini bakal muncul di halaman pertama dokumen "Cetak Detail Paket" — persis kayak poster promosi di sisi kiri contoh dokumen.</p>
                {formData.flyerImageDataUrl ? (
                  <div className="flex items-start gap-3">
                    <img src={formData.flyerImageDataUrl} alt="Preview flyer" className="w-32 h-32 object-cover rounded-lg border" />
                    <div className="flex flex-col gap-2">
                      <label className={`px-3 py-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} rounded-lg text-[11px] font-medium cursor-pointer text-center`}>
                        {uploadingFlyer ? 'Memproses...' : 'Ganti Gambar'}
                        <input type="file" accept="image/*" className="hidden" disabled={uploadingFlyer} onChange={handleFlyerFileChange} />
                      </label>
                      <button type="button" onClick={handleRemoveFlyer} className="px-3 py-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg text-[11px] font-medium">
                        Hapus Flyer
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className={`flex items-center justify-center gap-1.5 py-3 border-2 border-dashed ${isDark ? 'border-slate-700 hover:border-emerald-500 text-slate-400' : 'border-slate-300 hover:border-emerald-500 text-slate-500'} hover:text-emerald-500 rounded-xl text-xs font-semibold transition-colors cursor-pointer`}>
                    {uploadingFlyer ? 'Memproses gambar...' : (<><Plus className="w-4 h-4" /> Upload Flyer</>)}
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingFlyer} onChange={handleFlyerFileChange} />
                  </label>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block mb-1 font-medium">Tgl Keberangkatan</label>
                  <DateFieldID
                    required
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    nativeClassName={`[color-scheme:${theme}]`}
                    value={formData.departureDate}
                    onChange={(val) => setFormData({ ...formData, departureDate: val })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Durasi Program</label>
                  <input
                    type="text" placeholder="7 Hari / 9 Hari"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.durationDays}
                    onChange={e => setFormData({ ...formData, durationDays: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Total Kuota Seat</label>
                  <input
                    type="number" required placeholder="30"
                    className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                    value={formData.quotaTotal}
                    onChange={e => setFormData({ ...formData, quotaTotal: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium">Maskapai Penerbangan / Transportasi</label>
                  <button
                    type="button"
                    onClick={openAirlineCategoryModal}
                    className="text-[10px] text-emerald-500 hover:underline flex items-center gap-1"
                  >
                    <Settings className="w-3 h-3" /> Kelola
                  </button>
                </div>
                <select
                  className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                  value={formData.airline}
                  onChange={e => setFormData({ ...formData, airline: e.target.value })}
                >
                  {formData.airline && !airlineCategories.includes(formData.airline) && (
                    <option value={formData.airline}>{formData.airline} (nilai lama)</option>
                  )}
                  {airlineCategories.map(airline => (
                    <option key={airline} value={airline}>{airline}</option>
                  ))}
                </select>
              </div>

              {/* RINCIAN PENERBANGAN — sengaja ditaruh persis di bawah field
                  Maskapai (bukan deket bagian Harga) biar jelas nyambung:
                  ini rincian jadwal/segmen penerbangan dari maskapai yang
                  dipilih di atas. Dipakai buat halaman "Deskripsi Paket" di
                  dokumen Detail Paket. 1 kartu per leg/segmen penerbangan
                  (biasanya ada transit, jadi bisa 2-4 kartu per paket). */}
              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-sky-500 uppercase tracking-wider">
                  Rincian Penerbangan (Maskapai di atas) — buat Dokumen Detail Paket
                </p>
                <div className="space-y-2.5">
                  {formData.flightSegments.map((seg, idx) => (
                    <div key={`flt-${idx}`} className={`${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} p-3 rounded-lg border space-y-2`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10.5px] font-bold text-sky-500">Segmen ke-{idx + 1}</span>
                        <button type="button" onClick={() => handleRemoveFlightSegment(idx)} className="text-rose-500 hover:text-rose-400 p-1" title="Hapus segmen ini">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block mb-1 text-[10px] font-medium opacity-60">No. Flight</label>
                          <input
                            type="text" placeholder="cth: MH 716"
                            className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                            value={seg.flightNumber}
                            onChange={e => handleFlightSegmentChange(idx, 'flightNumber', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block mb-1 text-[10px] font-medium opacity-60">Tanggal</label>
                          <DateFieldID
                            className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                            value={seg.date}
                            onChange={(val) => handleFlightSegmentChange(idx, 'date', val)}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-medium opacity-60">Rute</label>
                        <input
                          type="text" placeholder="cth: CGK-KUL (Jakarta - Kuala Lumpur)"
                          className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                          value={seg.route}
                          onChange={e => handleFlightSegmentChange(idx, 'route', e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block mb-1 text-[10px] font-medium opacity-60">Jam Berangkat</label>
                          <input
                            type="text" placeholder="cth: 12:15"
                            className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                            value={seg.depTime}
                            onChange={e => handleFlightSegmentChange(idx, 'depTime', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block mb-1 text-[10px] font-medium opacity-60">Jam Tiba</label>
                          <input
                            type="text" placeholder="cth: 15:20"
                            className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                            value={seg.arrTime}
                            onChange={e => handleFlightSegmentChange(idx, 'arrTime', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={handleAddFlightSegment} className="text-[11px] text-emerald-500 hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Tambah Segmen Penerbangan
                  </button>
                </div>

                <div>
                  <label className="block mb-1 text-[11px] font-semibold opacity-70">Catatan Khusus (opsional)</label>
                  <textarea
                    rows={2}
                    placeholder={'cth: No bed with meals: disc 500.000\nUsia di bawah 23 bulan no bed (Infant with Basinet): Disc 50%'}
                    className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                    value={formData.specialNote}
                    onChange={e => setFormData({ ...formData, specialNote: e.target.value })}
                  />
                </div>
              </div>

              {/* DYNAMIC FIELD */}
              {isTourOrLA ? (
                <div className={`grid grid-cols-2 gap-4 ${styles.innerBg} p-3 rounded-xl border`}>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block font-medium text-emerald-500">Destinasi / Kota Tujuan</label>
                      <button
                        type="button"
                        onClick={openDestinationCategoryModal}
                        className="text-[10px] text-emerald-500 hover:underline flex items-center gap-1"
                      >
                        <Settings className="w-3 h-3" /> Kelola
                      </button>
                    </div>
                    <select
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={formData.destinationCity}
                      onChange={e => setFormData({ ...formData, destinationCity: e.target.value })}
                    >
                      {formData.destinationCity && !destinationCategories.includes(formData.destinationCity) && (
                        <option value={formData.destinationCity}>{formData.destinationCity} (nilai lama)</option>
                      )}
                      {destinationCategories.map(dest => (
                        <option key={dest} value={dest}>{dest}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 font-medium text-emerald-500">
                      {isLAOnly ? "Cakupan Layanan LA" : "Akomodasi Hotel Tour"}
                    </label>
                    <input
                      type="text" placeholder={isLAOnly ? "Bus, Visa, Handling, Guide" : "Hotel Bintang 4 / Setaraf"}
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={isLAOnly ? formData.laScope : formData.hotelTour}
                      onChange={e => isLAOnly 
                        ? setFormData({ ...formData, laScope: e.target.value })
                        : setFormData({ ...formData, hotelTour: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1 font-medium">Hotel Makkah</label>
                    <input
                      type="text" placeholder="Pullman Zamzam / Setaraf"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={formData.hotelMakkah}
                      onChange={e => setFormData({ ...formData, hotelMakkah: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium">Hotel Madinah</label>
                    <input
                      type="text" placeholder="Front Taiba / Setaraf"
                      className={`w-full ${styles.inputBg} rounded-lg p-2.5`}
                      value={formData.hotelMadinah}
                      onChange={e => setFormData({ ...formData, hotelMadinah: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* DYNAMIC HARGA */}
              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">
                  Harga Paket per Pax (Rp)
                </p>
                {isTourOrLA ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block mb-1 font-medium">Harga Utama / Dewasa</label>
                      <input
                        type="number" required placeholder="25000000"
                        className={`w-full ${styles.inputBg} rounded-lg p-2 font-bold`}
                        value={formData.priceMain}
                        onChange={e => setFormData({ ...formData, priceMain: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Harga Anak (Child)</label>
                      <input
                        type="number" placeholder="22000000 (Opsional)"
                        className={`w-full ${styles.inputBg} rounded-lg p-2`}
                        value={formData.priceChild}
                        onChange={e => setFormData({ ...formData, priceChild: e.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block mb-1 font-medium">Harga Quad (4 Orang)</label>
                      <input
                        type="number" required placeholder="29900000"
                        className={`w-full ${styles.inputBg} rounded-lg p-2`}
                        value={formData.priceMain}
                        onChange={e => setFormData({ ...formData, priceMain: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Harga Triple (3 Orang)</label>
                      <input
                        type="number" placeholder="31500000"
                        className={`w-full ${styles.inputBg} rounded-lg p-2`}
                        value={formData.priceTriple}
                        onChange={e => setFormData({ ...formData, priceTriple: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-medium">Harga Double (2 Orang)</label>
                      <input
                        type="number" placeholder="33500000"
                        className={`w-full ${styles.inputBg} rounded-lg p-2`}
                        value={formData.priceDouble}
                        onChange={e => setFormData({ ...formData, priceDouble: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* FASILITAS & LAYANAN (Harga Termasuk/Tidak Termasuk) — dipakai
                  buat dokumen "Detail Paket Wisata" (kop surat), lihat tombol
                  Cetak di modal Itinerary Perjalanan. */}
              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">
                  Fasilitas & Layanan — buat Dokumen Detail Paket
                </p>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold opacity-70">Harga Termasuk</p>
                  {formData.priceIncludes.map((val, idx) => (
                    <div key={`inc-${idx}`} className="flex gap-2 items-center">
                      <input
                        type="text" placeholder="cth: Tiket Pesawat PP"
                        className={`flex-1 ${styles.inputBg} rounded-lg p-2 text-xs`}
                        value={val}
                        onChange={e => handleIncludeItemChange(idx, e.target.value)}
                      />
                      <button type="button" onClick={() => handleRemoveIncludeItem(idx)} className="text-rose-500 hover:text-rose-400 p-1">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={handleAddIncludeItem} className="text-[11px] text-emerald-500 hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Tambah Item Harga Termasuk
                  </button>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold opacity-70">Harga Tidak Termasuk</p>
                  <p className="text-[10px] opacity-60">Nominal & catatan (mis. "/pax" atau "(Optional)") boleh dikosongkan kalau baris ini nggak butuh angka, cth: "PPN 1.1%".</p>
                  {formData.priceExcludes.map((item, idx) => (
                    <div key={`exc-${idx}`} className="flex gap-2 items-center">
                      <input
                        type="text" placeholder="Nama item, cth: Tipping"
                        className={`flex-1 ${styles.inputBg} rounded-lg p-2 text-xs`}
                        value={item.label}
                        onChange={e => handleExcludeItemChange(idx, 'label', e.target.value)}
                      />
                      <input
                        type="number" placeholder="Nominal (ops.)"
                        className={`w-28 ${styles.inputBg} rounded-lg p-2 text-xs`}
                        value={item.amount}
                        onChange={e => handleExcludeItemChange(idx, 'amount', e.target.value)}
                      />
                      <input
                        type="text" placeholder="Catatan (ops.)"
                        className={`w-32 ${styles.inputBg} rounded-lg p-2 text-xs`}
                        value={item.note}
                        onChange={e => handleExcludeItemChange(idx, 'note', e.target.value)}
                      />
                      <button type="button" onClick={() => handleRemoveExcludeItem(idx)} className="text-rose-500 hover:text-rose-400 p-1">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={handleAddExcludeItem} className="text-[11px] text-emerald-500 hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Tambah Item Harga Tidak Termasuk
                  </button>
                </div>
              </div>

              {/* RENCANA ANGGARAN (PLANNING COST) — buat itung Margin Planning
                  di awal, sebelum paket dijual. Lihat tab "Analisa Margin"
                  di Laporan Keuangan buat perbandingan sama Margin Realisasi. */}
              <div className={`${styles.innerBg} p-4 rounded-xl border space-y-3`}>
                <p className="text-[11px] font-bold text-amber-500 uppercase tracking-wider">
                  Rencana Anggaran (Planning Cost) — Total per Paket
                </p>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold opacity-70">Fixed Cost</p>
                  {formData.budgetFixedCostItems.map((item, idx) => (
                    <div key={`fixed-${idx}`} className="flex gap-2 items-center">
                      <input
                        type="text" placeholder="Nama item biaya"
                        className={`flex-1 ${styles.inputBg} rounded-lg p-2 text-xs`}
                        value={item.label}
                        onChange={e => handleBudgetItemChange('budgetFixedCostItems', idx, 'label', e.target.value)}
                      />
                      <input
                        type="number" placeholder="0"
                        className={`w-36 ${styles.inputBg} rounded-lg p-2 text-xs`}
                        value={item.amount}
                        onChange={e => handleBudgetItemChange('budgetFixedCostItems', idx, 'amount', e.target.value)}
                      />
                      <button type="button" onClick={() => handleRemoveBudgetItem('budgetFixedCostItems', idx)} className="text-rose-500 hover:text-rose-400 p-1">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => handleAddBudgetItem('budgetFixedCostItems')} className="text-[11px] text-emerald-500 hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Tambah Item Fixed Cost
                  </button>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold opacity-70">Variable Cost (TL/Rombongan)</p>
                  {formData.budgetVariableCostItems.map((item, idx) => (
                    <div key={`var-${idx}`} className="flex gap-2 items-center">
                      <input
                        type="text" placeholder="Nama item biaya"
                        className={`flex-1 ${styles.inputBg} rounded-lg p-2 text-xs`}
                        value={item.label}
                        onChange={e => handleBudgetItemChange('budgetVariableCostItems', idx, 'label', e.target.value)}
                      />
                      <input
                        type="number" placeholder="0"
                        className={`w-36 ${styles.inputBg} rounded-lg p-2 text-xs`}
                        value={item.amount}
                        onChange={e => handleBudgetItemChange('budgetVariableCostItems', idx, 'amount', e.target.value)}
                      />
                      <button type="button" onClick={() => handleRemoveBudgetItem('budgetVariableCostItems', idx)} className="text-rose-500 hover:text-rose-400 p-1">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => handleAddBudgetItem('budgetVariableCostItems')} className="text-[11px] text-emerald-500 hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Tambah Item Variable Cost
                  </button>
                </div>

                <div className={`pt-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'} grid grid-cols-2 gap-2 text-xs`}>
                  <div>Total Planning Cost</div>
                  <div className="text-right font-bold">Rp {budgetCostTotalPreview.toLocaleString('id-ID')}</div>
                  <div>Estimasi Total Jual (Harga Utama × Kuota)</div>
                  <div className="text-right font-bold">Rp {budgetPlanningSellingTotal.toLocaleString('id-ID')}</div>
                  <div className="font-bold">Estimasi Margin Planning</div>
                  <div className={`text-right font-bold ${budgetPlanningMarginTotal >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    Rp {budgetPlanningMarginTotal.toLocaleString('id-ID')}
                  </div>
                  <div className="opacity-70">Margin per Pax (estimasi)</div>
                  <div className={`text-right ${budgetPlanningMarginPerPax >= 0 ? 'text-emerald-500' : 'text-rose-500'} opacity-90`}>
                    Rp {Math.round(budgetPlanningMarginPerPax).toLocaleString('id-ID')}
                  </div>
                </div>
                <p className="text-[10px] opacity-60 italic">
                  * Estimasi ini asumsi semua pax ambil Harga Utama — angka riil belakangan bisa beda tergantung campuran tipe kamar (Quad/Triple/Double) yang beneran dibooking. Bandingkan sama Margin Realisasi di menu Laporan Keuangan → Analisa Margin setelah paket ini "Akui Pendapatan".
                </p>
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>
                  Batal
                </button>
                <button type="submit" disabled={savingPackage} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium disabled:opacity-60 disabled:cursor-not-allowed">
                  {savingPackage ? 'Menyimpan...' : (editingPackageId ? 'Simpan Perubahan' : 'Terbitkan Paket')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL KELOLA KATEGORI DESTINASI/KOTA TUJUAN */}
      {showDestinationCategoryModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowDestinationCategoryModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Globe className="w-5 h-5 text-emerald-500" /> Kelola Kategori Destinasi
            </h3>
            <p className={`text-[11px] ${styles.textSub} mb-4`}>
              Ubah nama destinasi yang udah ada, hapus yang nggak kepake, atau tambah destinasi baru. Perubahan ini langsung kepakai di dropdown Destinasi/Kota Tujuan dan filter pencarian.
            </p>

            <div className="space-y-2 mb-4">
              {destinationCategoryDraft.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <input
                    type="text"
                    className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                    value={c.value}
                    onChange={e => handleRenameDestinationCategoryDraft(c.key, e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveDestinationCategoryDraft(c.key)}
                    className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                    title="Hapus destinasi ini"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {destinationCategoryDraft.length === 0 && (
                <p className={`text-xs ${styles.textSub}`}>Belum ada destinasi. Tambahkan minimal 1 di bawah.</p>
              )}
            </div>

            <div className="flex items-center gap-2 mb-5">
              <input
                type="text"
                placeholder="Nama destinasi baru, cth: Uzbekistan"
                className={`w-full ${styles.inputBg} rounded-lg p-2.5 text-xs`}
                value={newDestinationCategoryText}
                onChange={e => setNewDestinationCategoryText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddDestinationCategoryDraft(); } }}
              />
              <button
                type="button"
                onClick={handleAddDestinationCategoryDraft}
                className="flex items-center gap-1 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium shrink-0"
              >
                <Plus className="w-4 h-4" /> Tambah
              </button>
            </div>

            <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <button type="button" onClick={() => setShowDestinationCategoryModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}>
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveDestinationCategories}
                disabled={savingDestinationCategories}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium"
              >
                {savingDestinationCategories ? 'Menyimpan...' : 'Simpan Destinasi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL KELOLA KATEGORI MASKAPAI/TRANSPORTASI */}
      {showAirlineCategoryModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowAirlineCategoryModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <Plane className="w-5 h-5 text-emerald-500" /> Kelola Kategori Maskapai
            </h3>
            <p className={`text-[11px] ${styles.textSub} mb-4`}>
              Ubah nama maskapai yang udah ada, hapus yang nggak kepake, atau tambah maskapai baru. Perubahan ini langsung kepakai di dropdown Maskapai dan filter pencarian.
            </p>

            <div className="space-y-2 mb-4">
              {airlineCategoryDraft.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <input
                    type="text"
                    className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs`}
                    value={c.value}
                    onChange={e => handleRenameAirlineCategoryDraft(c.key, e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveAirlineCategoryDraft(c.key)}
                    className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                    title="Hapus maskapai ini"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {airlineCategoryDraft.length === 0 && (
                <p className={`text-xs ${styles.textSub}`}>Belum ada maskapai. Tambahkan minimal 1 di bawah.</p>
              )}
            </div>

            <div className="flex items-center gap-2 mb-5">
              <input
                type="text"
                placeholder="Nama maskapai baru, cth: Turkish Airlines"
                className={`w-full ${styles.inputBg} rounded-lg p-2.5 text-xs`}
                value={newAirlineCategoryText}
                onChange={e => setNewAirlineCategoryText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddAirlineCategoryDraft(); } }}
              />
              <button
                type="button"
                onClick={handleAddAirlineCategoryDraft}
                className="flex items-center gap-1 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium shrink-0"
              >
                <Plus className="w-4 h-4" /> Tambah
              </button>
            </div>

            <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <button type="button" onClick={() => setShowAirlineCategoryModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}>
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveAirlineCategories}
                disabled={savingAirlineCategories}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium"
              >
                {savingAirlineCategories ? 'Menyimpan...' : 'Simpan Maskapai'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ITINERARY PERJALANAN */}
      {showItineraryModal && selectedPackageForItinerary && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto`}>
            <button onClick={() => setShowItineraryModal(false)} className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}>
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <ListOrdered className="w-5 h-5 text-purple-500" /> Itinerary Perjalanan
            </h3>
            <p className={`text-xs ${styles.textSub} mb-4`}>
              <strong className={styles.textTitle}>{selectedPackageForItinerary.name}</strong> ({selectedPackageForItinerary.code}) &bull; {selectedPackageForItinerary.durationDays || '-'}
              <br />Susun jadwal harian biar CS/TC gampang jelasin ke customer.
            </p>

            <div className="space-y-4 mb-4">
              {itineraryDays.map((d, idx) => (
                <div key={idx} className={`${styles.innerBg} p-4 rounded-xl border space-y-2.5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-500">Hari ke-{idx + 1}</span>
                    {canManagePackages && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleMoveDay(idx, -1)} disabled={idx === 0} className={`p-1 rounded ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'} disabled:opacity-30`} title="Pindah ke atas">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => handleMoveDay(idx, 1)} disabled={idx === itineraryDays.length - 1} className={`p-1 rounded ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'} disabled:opacity-30`} title="Pindah ke bawah">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => handleRemoveDay(idx)} className="p-1 rounded text-rose-500 hover:bg-rose-500/10" title="Hapus hari ini">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <input
                    type="text"
                    placeholder="Judul singkat, cth: Jakarta - Jeddah - Madinah"
                    className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs font-medium disabled:opacity-70`}
                    value={d.title}
                    disabled={!canManagePackages}
                    onChange={e => handleDayFieldChange(idx, 'title', e.target.value)}
                  />
                  <textarea
                    rows={2}
                    placeholder="Rincian kegiatan hari ini..."
                    className={`w-full ${styles.inputBg} rounded-lg p-2 text-xs disabled:opacity-70`}
                    value={d.description}
                    disabled={!canManagePackages}
                    onChange={e => handleDayFieldChange(idx, 'description', e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="relative">
                      <BedDouble className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder="Hotel (opsional)"
                        className={`w-full ${styles.inputBg} rounded-lg pl-8 pr-2 py-2 text-xs disabled:opacity-70`}
                        value={d.hotel}
                        disabled={!canManagePackages}
                        onChange={e => handleDayFieldChange(idx, 'hotel', e.target.value)}
                      />
                    </div>
                    <div className="relative">
                      <Utensils className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder="Makan (opsional)"
                        className={`w-full ${styles.inputBg} rounded-lg pl-8 pr-2 py-2 text-xs disabled:opacity-70`}
                        value={d.meals}
                        disabled={!canManagePackages}
                        onChange={e => handleDayFieldChange(idx, 'meals', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {canManagePackages && (
              <button
                type="button"
                onClick={handleAddDay}
                className={`w-full flex items-center justify-center gap-1.5 py-2.5 mb-5 border-2 border-dashed ${isDark ? 'border-slate-700 hover:border-purple-500 text-slate-400' : 'border-slate-300 hover:border-purple-500 text-slate-500'} hover:text-purple-500 rounded-xl text-xs font-semibold transition-colors`}
              >
                <Plus className="w-4 h-4" /> Tambah Hari
              </button>
            )}

            <div className={`pt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleShareItineraryWA(selectedPackageForItinerary, itineraryDays)}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-500 hover:text-white rounded-lg text-xs font-medium transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Bagikan WA
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintItinerary(selectedPackageForItinerary, itineraryDays)}
                  className={`flex items-center justify-center gap-1.5 px-3.5 py-2 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} rounded-lg text-xs font-medium transition-colors`}
                  title="Cetak dokumen lengkap: kop surat, detail paket, Fasilitas & Layanan, deskripsi + flight, dan itinerary harian"
                >
                  <Printer className="w-3.5 h-3.5" /> Cetak Detail Paket
                </button>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowItineraryModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg text-xs`}>
                  {canManagePackages ? 'Batal' : 'Tutup'}
                </button>
                {canManagePackages && (
                  <button
                    type="button"
                    onClick={handleSaveItinerary}
                    disabled={savingItinerary}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium"
                  >
                    {savingItinerary ? 'Menyimpan...' : 'Simpan Itinerary'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
