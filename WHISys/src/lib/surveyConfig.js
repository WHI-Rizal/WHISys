// Definisi Survey Pelayanan & Kepuasan Customer (dipakai bareng oleh form
// publik /feedback/[bookingCode] dan modul dashboard Feedback & Ulasan, biar
// pertanyaan & skornya nggak beda antar dua tempat). Sumber pertanyaan:
// halaman survei di wisatahalalindonesia.id. Skala jawaban 5 tingkat,
// urutan opsi dari TERBAIK ke TERBURUK, skornya 5 sampai 1.
//
// Mau ganti daftar CS / tambah pertanyaan? Cukup edit file ini. Data lama
// tetap aman karena jawaban disimpan per `key`.

export const CS_NAMES = ['Ocha', 'Fani', 'Nita', 'Nia', 'Arbi'];

export const TL_NAMES = [
  'Fardhan Mandaria',
  'Umar Faruq',
  'Husaini/Uchen',
  'Dhydha Maryudha',
  'Mochamad Fajar Akbar',
  'Muhammad Jajuli/Ridho',
  'Surya Saputra',
  'Permady Primasandy/Sandy',
  'Elan Farhani Ramadhan/Dolet',
  'Reza Akbar Ramanda',
  'Idfi Pancani',
  'Yusup Abdul Rauf',
  'Emzy Ardiwinata',
  'Johan Prawira Sodiq',
  'Gilang Malcom Habiebie (Umroh)',
  'Surya Huda Aprila (Umroh)',
];

export const SCALE_5 = [5, 4, 3, 2, 1];

export const SURVEY_SECTIONS = [
  {
    key: 'cs',
    title: 'Survey Customer Service',
    questions: [
      { key: 'csDetail', text: 'Apakah Customer Service menjelaskan detail terkait produk?', short: 'CS: Detail Produk', options: ['Sangat Detail', 'Detail', 'Cukup Detail', 'Kurang Detail', 'Tidak Detail'] },
      { key: 'csRamah', text: 'Apakah Customer Service ramah dalam membalas pesan?', short: 'CS: Keramahan', options: ['Sangat Ramah', 'Ramah', 'Cukup Ramah', 'Kurang Ramah', 'Tidak Ramah'] },
      { key: 'csFast', text: 'Apakah Customer Service fast response saat membalas pesan?', short: 'CS: Fast Response', options: ['Sangat Fast Response', 'Fast Response', 'Cukup Fast Response', 'Kurang Fast Response', 'Tidak Fast Response'] },
    ],
  },
  {
    key: 'tl',
    title: 'Survey Tour Leader',
    questions: [
      { key: 'tlTanggungJawab', text: 'Apakah Tour Leader bertanggung jawab sepenuhnya kepada tamu?', short: 'TL: Tanggung Jawab', options: ['Sangat Bertanggung Jawab', 'Bertanggung Jawab', 'Cukup Bertanggung Jawab', 'Kurang Bertanggung Jawab', 'Tidak Bertanggung Jawab'] },
      { key: 'tlMembantu', text: 'Apakah Tour Leader sangat membantu dalam aktivitas trip?', short: 'TL: Membantu', options: ['Sangat Membantu', 'Membantu', 'Cukup Membantu', 'Kurang Membantu', 'Tidak Membantu'] },
      { key: 'tlShalat', text: 'Apakah Tour Leader mengingatkan shalat & memimpin doa setiap memulai perjalanan?', short: 'TL: Shalat & Doa', options: ['Sangat Sering', 'Sering', 'Cukup Sering', 'Jarang', 'Tidak Pernah'] },
      { key: 'tlKomunikatif', text: 'Apakah Tour Leader komunikatif & mudah dihubungi selama trip?', short: 'TL: Komunikatif', options: ['Sangat Komunikatif', 'Komunikatif', 'Cukup Komunikatif', 'Kurang Komunikatif', 'Tidak Komunikatif'] },
    ],
  },
];

// Pertanyaan berbintang 1-5 (format jawaban Q8 & Q9 di survei asli nggak
// kelihatan di halamannya, jadi dibikin bintang).
// Pertanyaan isian bebas (jamaah mengetik sendiri). Jawabannya disimpan di
// survey.<key>, bukan di answers (karena bukan skor).
export const TEXT_QUESTIONS = [
  { key: 'fasilitasText', text: 'Bagaimana penilaian terhadap fasilitas (pesawat, hotel, makanan, & transportasi)?', short: 'Penilaian Fasilitas' },
  { key: 'itineraryText', text: 'Bagaimana penilaian terhadap itinerary & destinasi perjalanan secara keseluruhan?', short: 'Penilaian Itinerary & Destinasi' },
];

// Aspek bintang dari versi survei awal (sebelum dua pertanyaan ini jadi
// isian bebas) — cuma buat nampilin data lama di dashboard.
const LEGACY_ASPECTS = [
  { key: 'fasilitas', label: 'Fasilitas (versi lama)', group: 'Fasilitas & Pengalaman' },
  { key: 'itinerary', label: 'Itinerary & Destinasi (versi lama)', group: 'Fasilitas & Pengalaman' },
];

// Semua aspek berskor, buat ringkasan di dashboard.
export const ALL_ASPECTS = [
  ...SURVEY_SECTIONS.flatMap((s) => s.questions.map((q) => ({ key: q.key, label: q.short, group: s.title }))),
  ...LEGACY_ASPECTS,
];

export const labelForScore = (qKey, score) => {
  for (const s of SURVEY_SECTIONS) {
    const q = s.questions.find((x) => x.key === qKey);
    if (q) return q.options[5 - Number(score)] || String(score);
  }
  return `${score}/5`;
};
