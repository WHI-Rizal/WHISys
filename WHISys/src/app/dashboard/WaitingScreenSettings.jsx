'use client';

import React, { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { logActivity } from '../../lib/activityLog';
import { Tv, Plus, Trash2, ArrowUp, ArrowDown, Copy, Check, ExternalLink, RefreshCw, ImagePlus, Save } from 'lucide-react';

// Pengaturan LAYAR TUNGGU (TV lobby). Disimpan di settings/waiting_screen,
// ditampilin oleh /layar-tunggu lewat /api/public/waiting-screen.
// Cuma Super Admin yang boleh ubah (sesuai Firestore Rules `settings`).

const genCode = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  arr.forEach((n) => { out += chars[n % chars.length]; });
  return out;
};

const newId = () => `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const SLIDE_TYPES = {
  packages: { label: 'Jadwal & Seat Paket', color: 'text-emerald-400' },
  testimonials: { label: 'Testimoni Jamaah', color: 'text-amber-400' },
  announcement: { label: 'Pengumuman / Promo / Gambar', color: 'text-sky-400' },
  video: { label: 'Video', color: 'text-fuchsia-400' },
};

const defaultConfig = () => ({
  enabled: true,
  accessCode: genCode(),
  greeting: 'Selamat Datang di Wisata Halal Internasional',
  showClock: true,
  defaultSeconds: 12,
  slides: [
    { id: newId(), type: 'packages', enabled: true, seconds: 15, title: 'Jadwal Keberangkatan Terdekat', maxItems: 6 },
    { id: newId(), type: 'testimonials', enabled: true, seconds: 12, title: 'Kata Mereka Tentang Kami' },
    { id: newId(), type: 'announcement', enabled: true, seconds: 10, title: 'Selamat Datang', text: 'Silakan duduk dan nikmati waktu menunggu Anda. Tim kami akan segera melayani.', imageUrl: '' },
  ],
});

// Kompres gambar di browser biar muat di dokumen Firestore (maks 1MB total).
const compressImage = (file, maxDim = 1280, quality = 0.72) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Gagal membaca file.'));
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error('File bukan gambar yang valid.'));
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

export default function WaitingScreenSettings({ theme = 'dark', canEdit = false, currentUser = null }) {
  const isDark = theme === 'dark';
  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
    btn: isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700',
  };

  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  const [firstTime, setFirstTime] = useState(false);

  useEffect(() => {
    setOrigin(typeof window !== 'undefined' ? window.location.origin : '');
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'waiting_screen'));
        if (snap.exists()) {
          const d = snap.data();
          setCfg({ ...defaultConfig(), ...d, slides: Array.isArray(d.slides) ? d.slides : [] });
        } else {
          setCfg(defaultConfig());
          setFirstTime(true);
        }
      } catch (err) {
        console.error('Gagal memuat pengaturan layar tunggu:', err);
        setCfg(defaultConfig());
      }
      setLoading(false);
    })();
  }, []);

  const update = (patch) => setCfg((c) => ({ ...c, ...patch }));
  const updateSlide = (id, patch) => setCfg((c) => ({ ...c, slides: c.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const removeSlide = (id) => setCfg((c) => ({ ...c, slides: c.slides.filter((s) => s.id !== id) }));
  const moveSlide = (id, dir) => setCfg((c) => {
    const i = c.slides.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.slides.length) return c;
    const arr = c.slides.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...c, slides: arr };
  });
  const addSlide = (type) => {
    const base = { id: newId(), type, enabled: true, seconds: 12 };
    const extra = type === 'packages' ? { title: 'Jadwal Keberangkatan Terdekat', maxItems: 6 }
      : type === 'testimonials' ? { title: 'Kata Mereka Tentang Kami' }
        : type === 'video' ? { title: '', videoUrl: '', untilEnd: false, seconds: 30 }
          : { title: '', text: '', imageUrl: '' };
    setCfg((c) => ({ ...c, slides: [...c.slides, { ...base, ...extra }] }));
  };

  const handleImage = async (id, file) => {
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      updateSlide(id, { imageUrl: dataUrl });
    } catch (err) {
      alert(err.message);
    }
  };

  const link = cfg ? `${origin}/layar-tunggu?code=${cfg.accessCode}` : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { alert('Gagal menyalin. Salin manual dari kolom link.'); }
  };

  const regenerateCode = () => {
    if (!confirm('Ganti kode akses? Link lama di TV langsung berhenti jalan dan harus diganti dengan link baru. Lanjut?')) return;
    update({ accessCode: genCode() });
  };

  const handleSave = async () => {
    if (!canEdit) { alert('Cuma Super Admin yang boleh mengubah pengaturan Layar Tunggu.'); return; }
    const payload = { ...cfg, defaultSeconds: Math.max(3, Number(cfg.defaultSeconds) || 12), updatedAt: new Date().toISOString() };
    payload.slides = payload.slides.map((s) => ({ ...s, seconds: Math.max(3, Number(s.seconds) || payload.defaultSeconds) }));
    const approxBytes = JSON.stringify(payload).length;
    if (approxBytes > 900000) {
      alert(`Total ukuran slide terlalu besar (${Math.round(approxBytes / 1024)} KB, batas sekitar 900 KB). Kurangi jumlah gambar atau pakai gambar yang lebih sederhana.`);
      return;
    }
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'waiting_screen'), payload);
      setSaved(true);
      setFirstTime(false);
      setTimeout(() => setSaved(false), 2500);
      logActivity({
        userId: currentUser?.uid, userName: currentUser?.fullName || currentUser?.email, userRole: currentUser?.role,
        action: 'update', module: 'Pengaturan Sistem', targetLabel: 'Layar Tunggu',
        details: `Menyimpan pengaturan Layar Tunggu (${payload.slides.length} slide).`
      });
    } catch (err) {
      alert('Gagal menyimpan: ' + err.message);
    }
    setSaving(false);
  };

  if (loading || !cfg) {
    return <div className={`${styles.cardBg} border rounded-xl p-6 text-xs ${styles.textSub}`}>Memuat pengaturan layar tunggu...</div>;
  }

  const input = `w-full ${styles.inputBg} border rounded-lg p-2.5 text-xs focus:outline-none focus:border-emerald-500`;
  const sizeKb = Math.round(JSON.stringify(cfg).length / 1024);

  return (
    <div className={`${styles.cardBg} p-6 rounded-xl border space-y-6`}>
      <div className="border-b border-slate-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Tv className="w-4 h-4 text-emerald-400" /> Layar Tunggu (TV Lobby)
          </h4>
          <p className={`text-xs ${styles.textSub}`}>Atur isi yang tampil bergantian di layar TV lobby kantor.</p>
        </div>
        <button
          type="button" onClick={handleSave} disabled={saving || !canEdit}
          className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition-all"
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? 'Menyimpan...' : saved ? 'Tersimpan!' : 'Simpan Layar Tunggu'}
        </button>
      </div>

      {!canEdit && (
        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs">Cuma Super Admin yang bisa mengubah pengaturan ini. Kamu bisa melihatnya saja.</div>
      )}
      {firstTime && (
        <div className={`p-3 rounded-lg border text-xs ${styles.innerBg} ${styles.textSub}`}>Belum pernah disimpan. Ini isi bawaan, ubah sesuai kebutuhan lalu klik Simpan Layar Tunggu supaya link di bawah mulai bisa dipakai.</div>
      )}

      {/* LINK & KODE AKSES */}
      <div className={`p-4 rounded-xl border ${styles.innerBg} space-y-3`}>
        <div>
          <label className={`block text-[11px] font-semibold ${styles.textSub} mb-1`}>Link untuk dibuka di TV</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input readOnly value={link} className={`${input} font-mono`} onFocus={(e) => e.target.select()} />
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={copyLink} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${styles.btn}`}>
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Tersalin' : 'Salin'}
              </button>
              <a href={link} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${styles.btn}`}>
                <ExternalLink className="w-3.5 h-3.5" /> Buka
              </a>
              <button type="button" onClick={regenerateCode} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${styles.btn}`} title="Ganti kode akses">
                <RefreshCw className="w-3.5 h-3.5" /> Ganti Kode
              </button>
            </div>
          </div>
          <p className={`text-[11px] ${styles.textSub} mt-1.5`}>Siapa pun yang punya link ini bisa melihat layarnya (tanpa login), jadi jangan disebar. Kalau bocor, klik Ganti Kode lalu pasang link baru di TV. Setelah Ganti Kode, klik Simpan dulu.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3">
            <label className={`block text-[11px] font-semibold ${styles.textSub} mb-1`}>Kalimat sapaan (pojok kiri atas)</label>
            <input className={input} value={cfg.greeting || ''} onChange={(e) => update({ greeting: e.target.value })} placeholder="Selamat Datang di Wisata Halal Internasional" />
          </div>
          <div>
            <label className={`block text-[11px] font-semibold ${styles.textSub} mb-1`}>Durasi bawaan per slide (detik)</label>
            <input type="number" min="3" className={input} value={cfg.defaultSeconds} onChange={(e) => update({ defaultSeconds: e.target.value })} />
          </div>
          <label className={`flex items-center gap-2 text-xs ${styles.textTitle} mt-5 cursor-pointer`}>
            <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={cfg.showClock !== false} onChange={(e) => update({ showClock: e.target.checked })} />
            Tampilkan jam & tanggal
          </label>
          <label className={`flex items-center gap-2 text-xs ${styles.textTitle} mt-5 cursor-pointer`}>
            <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={cfg.enabled !== false} onChange={(e) => update({ enabled: e.target.checked })} />
            Layar tunggu aktif
          </label>
        </div>
      </div>

      {/* DAFTAR SLIDE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h5 className={`text-xs font-bold ${styles.textTitle}`}>Daftar Slide ({cfg.slides.length}) <span className={`font-normal ${styles.textSub}`}>- tampil berurutan dari atas ke bawah</span></h5>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(SLIDE_TYPES).map(([k, v]) => (
              <button key={k} type="button" onClick={() => addSlide(k)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium ${styles.btn}`}>
                <Plus className="w-3 h-3" /> {v.label}
              </button>
            ))}
          </div>
        </div>

        {cfg.slides.length === 0 && <p className={`text-xs ${styles.textSub}`}>Belum ada slide. Tambahkan lewat tombol di atas.</p>}

        {cfg.slides.map((s, i) => (
          <div key={s.id} className={`p-4 rounded-xl border ${styles.innerBg} ${s.enabled === false ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-bold ${SLIDE_TYPES[s.type]?.color || ''}`}>{i + 1}. {SLIDE_TYPES[s.type]?.label || s.type}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className={`flex items-center gap-1.5 text-[11px] ${styles.textSub} cursor-pointer`}>
                  <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-500" checked={s.enabled !== false} onChange={(e) => updateSlide(s.id, { enabled: e.target.checked })} /> Aktif
                </label>
                <button type="button" onClick={() => moveSlide(s.id, -1)} disabled={i === 0} className={`p-1.5 rounded-lg ${styles.btn} disabled:opacity-30`}><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => moveSlide(s.id, 1)} disabled={i === cfg.slides.length - 1} className={`p-1.5 rounded-lg ${styles.btn} disabled:opacity-30`}><ArrowDown className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => { if (confirm('Hapus slide ini?')) removeSlide(s.id); }} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-3">
              <div className="sm:col-span-3">
                <label className={`block text-[11px] ${styles.textSub} mb-1`}>Judul slide</label>
                <input className={input} value={s.title || ''} onChange={(e) => updateSlide(s.id, { title: e.target.value })} />
              </div>
              <div>
                <label className={`block text-[11px] ${styles.textSub} mb-1`}>Durasi (detik)</label>
                <input type="number" min="3" className={input} value={s.seconds ?? ''} onChange={(e) => updateSlide(s.id, { seconds: e.target.value })} />
              </div>

              {s.type === 'packages' && (
                <>
                  <div>
                    <label className={`block text-[11px] ${styles.textSub} mb-1`}>Jumlah paket ditampilkan</label>
                    <input type="number" min="1" max="12" className={input} value={s.maxItems ?? 6} onChange={(e) => updateSlide(s.id, { maxItems: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={`block text-[11px] ${styles.textSub} mb-1`}>Tampilan</label>
                    <select className={input} value={s.layout === 'cards' ? 'cards' : 'flyer'} onChange={(e) => updateSlide(s.id, { layout: e.target.value })}>
                      <option value="flyer">Flyer (gambar besar, 4 paket per halaman)</option>
                      <option value="cards">Kartu teks (tanpa gambar)</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            {s.type === 'packages' && <p className={`text-[11px] ${styles.textSub} mt-2`}>Otomatis dari paket aktif yang berangkat paling dekat: flyer, tanggal, harga mulai, dan sisa seat terbaru. Flyer diambil dari Flyer Promosi Paket di menu Paket Travel. Paket tanpa flyer tampil dengan nama saja. Kalau paketnya lebih dari 4, halaman berganti tiap slide ini muncul lagi.</p>}
            {s.type === 'testimonials' && <p className={`text-[11px] ${styles.textSub} mt-2`}>Otomatis dari ulasan jamaah bintang 4 sampai 5 yang ada ceritanya. Nama yang tampil cuma nama depan.</p>}

            {s.type === 'video' && (
              <div className="mt-3 space-y-2">
                <div>
                  <label className={`block text-[11px] ${styles.textSub} mb-1`}>Link video</label>
                  <input className={input} value={s.videoUrl || ''} onChange={(e) => updateSlide(s.id, { videoUrl: e.target.value.trim() })} placeholder="https://www.youtube.com/watch?v=...  atau link langsung file .mp4" />
                </div>
                {!/(youtube\.com|youtu\.be)/i.test(s.videoUrl || '') && (
                  <label className={`flex items-center gap-2 text-[11px] ${styles.textSub} cursor-pointer`}>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-500" checked={!!s.untilEnd} onChange={(e) => updateSlide(s.id, { untilEnd: e.target.checked })} />
                    Tampil sampai video selesai (abaikan durasi di atas)
                  </label>
                )}
                <label className={`flex items-center gap-2 text-[11px] ${styles.textSub} cursor-pointer`}>
                  <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-500" checked={!!s.sound} onChange={(e) => updateSlide(s.id, { sound: e.target.checked })} />
                  Suara aktif (butuh izin autoplay di perangkat TV, lihat petunjuk di bawah daftar slide)
                </label>
                <p className={`text-[11px] ${styles.textSub}`}>Video diputar otomatis dan diulang selama durasi slide. Tanpa "Suara aktif", video bisu. YouTube: tempel link biasa (pastikan video boleh disematkan). File: harus link langsung berakhiran .mp4 atau .webm yang bisa dibuka publik. Link Google Drive biasanya tidak bisa dipakai di sini.</p>
              </div>
            )}

            {s.type === 'announcement' && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`block text-[11px] ${styles.textSub} mb-1`}>Teks pengumuman</label>
                  <textarea rows={4} className={input} value={s.text || ''} onChange={(e) => updateSlide(s.id, { text: e.target.value })} placeholder="Isi promo, info, atau ucapan..." />
                </div>
                <div>
                  <label className={`block text-[11px] ${styles.textSub} mb-1`}>Gambar / flyer (opsional)</label>
                  {s.imageUrl ? (
                    <div className="space-y-2">
                      <img src={s.imageUrl} alt="" className="max-h-28 rounded-lg border border-slate-700" />
                      <button type="button" onClick={() => updateSlide(s.id, { imageUrl: '' })} className="text-[11px] text-rose-500 hover:underline">Hapus gambar</button>
                    </div>
                  ) : (
                    <label className={`flex items-center justify-center gap-2 p-4 rounded-lg border border-dashed cursor-pointer text-xs ${styles.textSub} hover:border-emerald-500`}>
                      <ImagePlus className="w-4 h-4" /> Pilih gambar
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleImage(s.id, e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  )}
                  <p className={`text-[10px] ${styles.textSub} mt-1`}>Gambar dikecilkan otomatis. Kalau cuma gambar tanpa teks, gambar tampil penuh seperti flyer.</p>
                </div>
              </div>
            )}
          </div>
        ))}

        <details className={`p-4 rounded-xl border ${styles.innerBg}`}>
          <summary className={`text-xs font-semibold ${styles.textTitle} cursor-pointer`}>Petunjuk: supaya video bersuara otomatis tanpa klik (Chrome/Edge di PC TV)</summary>
          <div className={`mt-3 space-y-2 text-[11px] ${styles.textSub} leading-relaxed`}>
            <p>Browser melarang suara otomatis kecuali diizinkan. Izinkan hanya untuk alamat sistem ini lewat kebijakan browser di komputer yang tersambung ke TV (sekali saja):</p>
            <p><strong className={styles.textTitle}>Chrome (Windows)</strong>: buka Registry Editor, buat key <span className="font-mono">HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist</span>. Di dalamnya buat String Value bernama <span className="font-mono">1</span> dengan isi <span className="font-mono">{origin || 'https://alamat-sistem-anda'}</span>.</p>
            <p><strong className={styles.textTitle}>Edge (Windows)</strong>: sama, tapi key-nya <span className="font-mono">HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\AutoplayAllowlist</span>.</p>
            <p>Lalu tutup semua jendela browser, buka lagi, dan cek di <span className="font-mono">chrome://policy</span> (atau <span className="font-mono">edge://policy</span>) bahwa AutoplayAllowlist sudah terbaca. Buka link layar tunggu, sebaiknya dalam mode layar penuh/kiosk, dan taruh shortcut-nya di folder Startup supaya jalan otomatis saat komputer menyala.</p>
            <p>Kalau perangkat belum diizinkan, layar tetap jalan tapi video bisu dan muncul tulisan "Tekan OK atau klik sekali untuk menyalakan suara". Setelah sekali ditekan, suara jalan terus sampai halaman dimuat ulang. Smart TV bawaan biasanya tidak bisa diatur seperti ini.</p>
          </div>
        </details>

        <p className={`text-[11px] ${styles.textSub}`}>Ukuran data slide sekarang sekitar {sizeKb} KB (batas sekitar 900 KB). Perubahan baru tampil di TV setelah klik Simpan, paling lama 5 menit karena TV refresh sendiri.</p>
      </div>
    </div>
  );
}
