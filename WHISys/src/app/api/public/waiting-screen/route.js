import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminDb } from '@/lib/firebaseAdmin';

// Data buat LAYAR TUNGGU (TV lobby) — halaman /layar-tunggu. Dibuka TANPA
// login di TV, jadi dijaga pakai "kode akses" yang diatur Super Admin di
// Pengaturan Sistem > Layar Tunggu (disimpan di settings/waiting_screen).
// Pakai Admin SDK karena collection `settings` & `feedback` tertutup buat
// yang belum login. Yang dibalikin CUMA data aman buat ditampilin publik:
// jadwal/harga mulai/sisa seat paket aktif, dan testimoni (nama depan saja).
export const dynamic = 'force-dynamic';

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
};

const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || 'Jamaah';

export async function GET(request) {
  try {
    const code = (new URL(request.url).searchParams.get('code') || '').trim();
    const adb = getAdminDb();
    const cfgSnap = await adb.collection('settings').doc('waiting_screen').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : null;

    if (!cfg || !cfg.accessCode || !code || !safeEqual(code, cfg.accessCode)) {
      return NextResponse.json({ error: 'Kode akses tidak valid.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    if (cfg.enabled === false) {
      return NextResponse.json({ error: 'Layar tunggu sedang dinonaktifkan.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    const slides = (Array.isArray(cfg.slides) ? cfg.slides : []).filter((s) => s && s.enabled !== false);
    const needPackages = slides.some((s) => s.type === 'packages');
    const needTesti = slides.some((s) => s.type === 'testimonials');
    const pkgSlides = slides.filter((s) => s.type === 'packages');
    // Flyer (gambar base64) lumayan besar, jadi cuma dikirim kalau ada slide
    // jadwal yang tampilannya "flyer", dan cuma buat paket yang bakal tampil.
    const needFlyer = pkgSlides.some((s) => s.layout !== 'cards');
    const maxN = Math.min(12, Math.max(1, ...pkgSlides.map((s) => Number(s.maxItems) || 6)));

    let packages = [];
    if (needPackages) {
      const snap = await adb.collection('public_catalog').get();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => !p.departureDate || new Date(p.departureDate) >= today)
        .sort((a, b) => new Date(a.departureDate || 0) - new Date(b.departureDate || 0))
        .slice(0, maxN);
      // Sisa seat live dari `packages` (mirror katalog bisa telat).
      try {
        if (list.length > 0) {
          const refs = list.map((p) => adb.collection('packages').doc(p.id));
          const live = await adb.getAll(...refs, { fieldMask: ['quotaRemaining', 'quotaTotal', 'isActive'] });
          const liveMap = new Map(live.filter((d) => d.exists).map((d) => [d.id, d.data()]));
          list = list.filter((p) => !liveMap.has(p.id) || liveMap.get(p.id).isActive !== false)
            .map((p) => {
              const l = liveMap.get(p.id);
              return l ? { ...p, quotaRemaining: l.quotaRemaining, quotaTotal: l.quotaTotal } : p;
            });
        }
      } catch (e) { /* pakai data mirror */ }
      const priceOf = (p) => {
        const c = [p.priceMain, p.priceQuad, p.priceTriple, p.priceDouble].map(Number).filter((v) => v > 0);
        return c.length ? Math.min(...c) : null;
      };
      packages = list.map((p) => ({
        id: p.id,
        name: p.name || '',
        departureDate: p.departureDate || '',
        destinationCity: p.destinationCity || '',
        priceFrom: priceOf(p),
        quotaRemaining: p.quotaRemaining != null ? Math.max(0, Number(p.quotaRemaining) || 0) : null,
        ...(needFlyer && p.flyerImageDataUrl ? { flyerImageDataUrl: p.flyerImageDataUrl } : {}),
      }));
    }

    let testimonials = [];
    if (needTesti) {
      const snap = await adb.collection('feedback').orderBy('createdAt', 'desc').limit(80).get();
      testimonials = snap.docs.map((d) => d.data())
        .filter((f) => Number(f.rating) >= 4 && typeof f.comment === 'string' && f.comment.trim().length >= 20)
        .slice(0, 20)
        .map((f) => ({
          name: firstName(f.jamaahName),
          packageName: f.packageName || '',
          rating: Number(f.rating) || 5,
          comment: f.comment.trim().slice(0, 300),
        }));
    }

    const { accessCode, ...publicCfg } = cfg;
    return NextResponse.json({
      config: { ...publicCfg, slides },
      packages,
      testimonials,
      serverTime: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Gagal memuat layar tunggu:', err);
    return NextResponse.json({ error: 'Gagal memuat data layar tunggu.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
