import { db } from './firebase';
import { collection, addDoc } from 'firebase/firestore';

// Riwayat Aktivitas Sistem — nyatet aksi-aksi PENTING yang dilakuin semua
// user (login/logout, tambah/edit/hapus data inti: booking, setoran/
// pembayaran, jamaah, paket, vendor, dan perubahan user/role), buat
// keperluan audit Super Admin. Ini SENGAJA nggak nyatet tiap klik kecil
// (buka modal, ganti filter, dll) — cuma aksi yang beneran mengubah data
// atau akses.
//
// Collection: 'activity_logs'. Firestore Rules-nya:
//   allow create: if isLoggedIn();
//   allow read: if isSuperAdmin();
//   allow update, delete: if false;
// (siapa aja yang login boleh NULIS log aktivitas dia sendiri, tapi cuma
// Super Admin yang boleh BACA riwayatnya, dan log-nya immutable — nggak
// bisa diubah/dihapus siapapun, termasuk Super Admin, biar tetap valid
// buat audit).
//
// Dipanggil best-effort: kalau gagal (misalnya lagi offline sebentar),
// nggak boleh sampai bikin aksi utamanya (simpan booking, dst) ikut gagal
// — makanya errornya cuma di-console.error, nggak di-throw ulang.
export const logActivity = async ({ userId, userName, userRole, action, module, targetLabel, details }) => {
  try {
    await addDoc(collection(db, 'activity_logs'), {
      userId: userId || null,
      userName: userName || 'Tidak diketahui',
      userRole: userRole || '-',
      action: action || 'lainnya', // 'login' | 'logout' | 'create' | 'update' | 'delete' | 'lainnya'
      module: module || '-', // label modul, cth: 'Booking & Manifest'
      targetLabel: targetLabel || '',
      details: details || '',
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Gagal mencatat log aktivitas:', err);
  }
};
