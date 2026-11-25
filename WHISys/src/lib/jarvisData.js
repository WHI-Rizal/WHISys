// =====================================================================
// Logika data untuk endpoint Jarvis (BACA SAJA). Fungsi-fungsi murni +
// loader yang menerima `db` (Firebase Admin Firestore) sebagai parameter,
// jadi gampang dites dengan database tiruan.
//
// ATURAN: jangan pernah mengembalikan NIK, nomor paspor, nomor HP,
// alamat, nominal uang, HPP/margin/budget. Cuma field whitelist di bawah.
// =====================================================================

// ---------- tanggal ----------
export const todayWIB = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
export const dateOnly = (v) => {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};
export const addDays = (iso, n) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (iso, n) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return '';
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (fromIso, toIso) => Math.round((new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000);

export const clampInt = (v, def, min, max) => {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
};

// cache memori singkat (per instance) biar bot yang nanya berulang nggak bikin Firestore dibaca terus
const cacheStore = new Map();
export const cached = async (key, ttlMs, fn) => {
  const hit = cacheStore.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cacheStore.set(key, { t: Date.now(), v });
  if (cacheStore.size > 200) cacheStore.delete(cacheStore.keys().next().value);
  return v;
};

// ---------- whitelist ----------
export const isActiveBooking = (b) => (b?.status || 'active') === 'active';

export const publicPackage = (id, p, extra = {}) => ({
  id,
  code: p.code || '',
  name: p.name || '',
  type: p.type || '',
  departureDate: dateOnly(p.departureDate),
  durationDays: Number(p.durationDays) || null,
  destinationCity: p.destinationCity || '',
  airline: p.airline || '',
  catalogActive: p.isActive !== false,
  quotaTotal: Number.isFinite(Number(p.quotaTotal)) ? Number(p.quotaTotal) : null,
  quotaRemaining: Number.isFinite(Number(p.quotaRemaining)) ? Number(p.quotaRemaining) : null,
  tourLeaderCount: Array.isArray(p.tourLeaders) ? p.tourLeaders.length : 0,
  ...extra,
});

// ---------- loader ----------
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export const loadPackages = async (db) => {
  const snap = await db.collection('packages').get();
  const list = [];
  snap.forEach(d => {
    if (d.id === '_destination_categories_config') return;
    const data = d.data();
    if (data.isCategoryConfig) return;
    list.push({ id: d.id, ...data });
  });
  return list;
};

// Booking AKTIF per paket. Return Map(packageId -> booking[])
export const loadActiveBookingsByPackage = async (db, packageIds) => {
  const map = new Map(packageIds.map(id => [id, []]));
  const parts = chunk(packageIds, 10);
  const snaps = await Promise.all(parts.map(ids => db.collection('bookings').where('packageId', 'in', ids).get()));
  snaps.forEach(snap => snap.forEach(d => {
    const b = { id: d.id, ...d.data() };
    if (isActiveBooking(b) && map.has(b.packageId)) map.get(b.packageId).push(b);
  }));
  return map;
};

export const loadJamaahMap = async (db, jamaahIds) => {
  const unique = [...new Set(jamaahIds.filter(Boolean))];
  const map = new Map();
  for (const part of chunk(unique, 200)) {
    const refs = part.map(id => db.collection('jamaah').doc(id));
    const docs = await db.getAll(...refs);
    docs.forEach(d => { if (d.exists) map.set(d.id, d.data()); });
  }
  return map;
};

// ---------- penilaian ----------
const ISSUE_LABEL = {
  tidak_ada_expiry: 'tanggal expired paspor belum diisi',
  expired_sebelum_berangkat: 'paspor sudah expired sebelum tanggal berangkat',
  kurang_6_bulan: 'masa berlaku paspor kurang dari 6 bulan dari tanggal berangkat',
};
export const PASSPORT_ISSUE_LABEL = ISSUE_LABEL;

// Aturan umum: paspor harus berlaku minimal `minMonths` bulan setelah tanggal berangkat.
export const assessPassport = (jamaah, departureDate, minMonths = 6) => {
  const issues = [];
  const exp = dateOnly(jamaah?.passportExpiry);
  if (!exp) { issues.push('tidak_ada_expiry'); return issues; }
  const dep = dateOnly(departureDate);
  if (!dep) return issues;
  if (exp < dep) issues.push('expired_sebelum_berangkat');
  else if (exp < addMonths(dep, minMonths)) issues.push('kurang_6_bulan');
  return issues;
};

// Data yang dibutuhkan kolom manifest
export const assessManifestFields = (jamaah) => {
  const missing = [];
  if (!String(jamaah?.passportNumber || '').trim()) missing.push('nomor paspor');
  if (!dateOnly(jamaah?.birthDate)) missing.push('tanggal lahir');
  if (!String(jamaah?.birthPlace || '').trim()) missing.push('tempat lahir');
  if (!dateOnly(jamaah?.passportIssueDate)) missing.push('tanggal terbit paspor');
  if (!String(jamaah?.passportIssuingOffice || '').trim()) missing.push('kantor imigrasi');
  if (!jamaah?.gender) missing.push('jenis kelamin');
  return missing;
};

export const DEFAULT_REQUIRED_DOCS = ['passport', 'ktp_foto'];
export const DOC_LABELS = {
  passport: 'Paspor', ktp_foto: 'Foto KTP', family_cert: 'Kartu Keluarga', sponsor_letter: 'Surat Sponsor',
  bank_statement: 'Rekening Koran', vaccine_cert: 'Sertifikat Vaksin', visa: 'Visa', ticket: 'Tiket',
};
export const missingDocs = (booking, required = DEFAULT_REQUIRED_DOCS) => {
  const docs = booking?.documents || {};
  return required.filter(k => !docs[k]).map(k => DOC_LABELS[k] || k);
};

// Mirror aturan jatuh tempo di BookingsModule.jsx:
//  DP 2      = tanggal booking dibuat + 30 hari (hilang kalau dp2Paid)
//  Pelunasan = tanggal berangkat - 40 hari (hilang kalau pelunasanPaid)
export const paymentDues = (booking) => {
  if (booking?.paymentStatus === 'Full Payment') return [];
  const out = [];
  if (!booking?.dp2Paid) { const d = addDays(dateOnly(booking?.createdAt), 30); if (d) out.push({ stage: 'DP 2', dueDate: d }); }
  if (!booking?.pelunasanPaid) { const d = addDays(dateOnly(booking?.departureDate), -40); if (d) out.push({ stage: 'Pelunasan', dueDate: d }); }
  return out;
};

const groupKey = (b) => b.groupBookingCode || b.bookingCode || b.id;
export const tcNameFor = (b, siblings) => {
  const src = b.closingSourceName ? b : (siblings || []).find(x => x.closingSourceName && groupKey(x) === groupKey(b));
  return src ? src.closingSourceName : '';
};

// Daftar tagihan jatuh tempo, digabung per rombongan (kode grup).
export const buildPaymentReminders = (packages, bookingsByPkg, today, windowDays) => {
  const overdue = []; const dueSoon = [];
  packages.forEach(pkg => {
    const dep = dateOnly(pkg.departureDate);
    if (!dep || dep < today) return;
    const list = bookingsByPkg.get(pkg.id) || [];
    const groups = new Map();
    list.forEach(b => { const k = groupKey(b); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
    groups.forEach((members, code) => {
      const stages = new Map(); // stage -> dueDate (paling awal) untuk anggota yang belum bayar
      members.forEach(m => paymentDues({ ...m, departureDate: m.departureDate || dep }).forEach(d => {
        if (!stages.has(d.stage) || d.dueDate < stages.get(d.stage)) stages.set(d.stage, d.dueDate);
      }));
      stages.forEach((dueDate, stage) => {
        const diff = daysBetween(today, dueDate);
        const item = {
          package: pkg.name, packageCode: pkg.code || '', departureDate: dep, bookingCode: code,
          orderer: members[0].ordererName || members[0].jamaahName || '', pax: members.length,
          tc: tcNameFor(members[0], members), stage, dueDate,
          daysLate: diff < 0 ? -diff : 0, daysUntilDue: diff >= 0 ? diff : 0,
        };
        if (diff < 0) overdue.push(item);
        else if (diff <= windowDays) dueSoon.push(item);
      });
    });
  });
  overdue.sort((a, b) => b.daysLate - a.daysLate);
  dueSoon.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return { overdue, dueSoon };
};

export const cap = (arr, n = 50) => ({ total: arr.length, shown: Math.min(arr.length, n), items: arr.slice(0, n) });
