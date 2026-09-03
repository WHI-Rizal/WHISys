import { db } from './firebase';
import { doc, runTransaction, collection, getDocs } from 'firebase/firestore';

// ============================================================================
// Generator kode customer (CSTxxxxxx) yang AMAN dari race condition.
// ============================================================================
// Sebelumnya, kode CST berikutnya dihitung manual di tiap komponen (Booking
// & Jamaah masing-masing punya salinan fungsi sendiri): ambil daftar jamaah
// yang UDAH di-fetch ke state React, cari nomor CST tertinggi, lalu +1 —
// semuanya di sisi client, TANPA koordinasi ke Firestore.
//
// Itu penyebab bug "kode CST duplikat / booking tercreate dobel" yang
// dilaporkan TC: kalau ada 2 proses hampir bersamaan (misal TC nge-tap
// tombol submit dua kali gara-gara koneksi HP lambat, atau 2 TC beda HP
// input booking di waktu yang sama), KEDUANYA baca "nomor tertinggi saat
// ini" dari data yang SAMA (belum ke-update sama proses yang duluan
// nyimpen), jadi keduanya menghitung kode berikutnya yang SAMA PERSIS —
// dua dokumen jamaah beda tersimpan dengan customerCode identik.
//
// Fix-nya: pindahkan penomoran ke SATU dokumen counter di Firestore
// (`counters/jamaah_customer_code`) dan ambil nomor berikutnya lewat
// Firestore Transaction (`runTransaction`). Transaction menjamin baca+tulis
// counter itu ATOMIK — kalau 2 proses jalan bersamaan, Firestore otomatis
// nge-retry salah satunya sampai keduanya kebagian nomor yang BEDA. Nggak
// mungkin lagi dapet kode yang sama walau submit-nya kejadian di detik yang
// sama persis, dari device manapun.
// ============================================================================

const COUNTER_COLLECTION = 'counters';
const COUNTER_DOC_ID = 'jamaah_customer_code';
const BASE_NUMBER = 2000; // sama seperti konvensi lama: nomor mulai dari CST002001

// Dipanggil HANYA sebagai fallback baseline kalau dokumen counter-nya belum
// pernah dibuat sama sekali (migrasi pertama kali fitur ini jalan) — scan
// collection jamaah yang SUDAH ADA buat cari nomor CST tertinggi yang udah
// kepake, biar counter baru ini nggak mulai dari angka yang udah beririsan
// sama data lama. Query ini di luar transaction (transaction Firestore
// nggak bisa jalanin query collection, cuma baca dokumen spesifik) — tapi
// tetap aman dari race karena transaction di bawah bakal otomatis retry
// kalau ada proses lain yang keduluan nulis counter-nya duluan.
async function computeFallbackBaseline() {
  let maxNum = BASE_NUMBER;
  try {
    const snap = await getDocs(collection(db, 'jamaah'));
    snap.forEach((d) => {
      const code = d.data()?.customerCode;
      if (code && typeof code === 'string' && code.startsWith('CST')) {
        const numPart = parseInt(code.replace('CST', ''), 10);
        if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
      }
    });
  } catch (err) {
    console.error('Gagal menghitung baseline kode customer:', err);
  }
  return maxNum;
}

/**
 * Ambil SATU kode CSTxxxxxx baru, dijamin unik walau dipanggil bersamaan
 * dari banyak tempat/device. Selalu di-`await`, jangan dipakai sinkron.
 * @returns {Promise<string>} contoh: "CST002006"
 */
export async function getNextCustomerCode() {
  const counterRef = doc(db, COUNTER_COLLECTION, COUNTER_DOC_ID);
  const fallbackBaseline = await computeFallbackBaseline();

  const nextNumber = await runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const last = counterSnap.exists()
      ? (Number(counterSnap.data().lastNumber) || fallbackBaseline)
      : fallbackBaseline;
    const next = last + 1;
    transaction.set(
      counterRef,
      { lastNumber: next, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    return next;
  });

  return `CST${String(nextNumber).padStart(6, '0')}`;
}
