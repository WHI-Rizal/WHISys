'use client';

import { useEffect, useRef, useState } from 'react';

// ============================================================================
// LAYAR TUNGGU (TV lobby kantor) — dibuka di browser TV lewat link:
//   /layar-tunggu?code=KODE_AKSES
// Isi slide, urutan, durasi, dan kode akses diatur Super Admin di
// Pengaturan Sistem > Layar Tunggu. Data diambil dari
// /api/public/waiting-screen dan di-refresh otomatis tiap 5 menit, jadi TV
// nggak perlu di-reload manual. Ukuran huruf pakai satuan `em` dari lebar
// layar biar rapi di TV ukuran apa pun.
// ============================================================================

const REFRESH_MS = 5 * 60 * 1000;
const TZ = 'Asia/Jakarta';

const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const fmtDate = (iso) => {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(d);
};

const C = {
  bg: '#04101f', panel: '#0b1b30', line: '#16304f', text: '#f1f5f9', sub: '#94a3b8',
  green: '#10b981', gold: '#fbbf24', red: '#f87171',
};

function SeatBadge({ n }) {
  if (n == null) return null;
  let label = `Sisa ${n} seat`; let color = C.green;
  if (n <= 0) { label = 'Penuh'; color = C.red; }
  else if (n <= 5) { label = `Tinggal ${n} seat`; color = C.gold; }
  return (
    <span style={{ display: 'inline-block', padding: '0.25em 0.8em', borderRadius: '999px', fontSize: '0.8em', fontWeight: 700, color, border: `0.12em solid ${color}`, background: `${color}1a` }}>
      {label}
    </span>
  );
}

function PackagesSlide({ slide, packages }) {
  const list = packages.slice(0, Number(slide.maxItems) || 6);
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: '2.2em', margin: '0 0 0.6em', color: C.gold }}>{slide.title || 'Jadwal Keberangkatan Terdekat'}</h2>
      {list.length === 0 ? (
        <p style={{ color: C.sub, fontSize: '1.2em' }}>Belum ada jadwal keberangkatan aktif.</p>
      ) : (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: list.length > 4 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: '1em', alignContent: 'start' }}>
          {list.map((p) => (
            <div key={p.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: '1em', padding: '1em 1.2em', display: 'flex', flexDirection: 'column', gap: '0.5em' }}>
              <div style={{ fontSize: '1.15em', fontWeight: 700, lineHeight: 1.25 }}>{p.name}</div>
              <div style={{ color: C.sub, fontSize: '0.95em' }}>{fmtDate(p.departureDate)}</div>
              <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em' }}>
                <div>
                  {p.priceFrom ? (<><div style={{ color: C.sub, fontSize: '0.7em' }}>Mulai dari</div><div style={{ color: C.green, fontWeight: 800, fontSize: '1.1em' }}>{rp(p.priceFrom)}</div></>) : null}
                </div>
                <SeatBadge n={p.quotaRemaining} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TestimonialSlide({ slide, item }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 6%' }}>
      <h2 style={{ fontSize: '1.6em', margin: '0 0 1em', color: C.gold }}>{slide.title || 'Kata Mereka Tentang Kami'}</h2>
      {item ? (
        <>
          <div style={{ fontSize: '2.2em', color: C.gold, letterSpacing: '0.15em' }}>{'★'.repeat(item.rating)}</div>
          <p style={{ fontSize: '1.9em', lineHeight: 1.45, margin: '0.6em 0', fontStyle: 'italic' }}>&ldquo;{item.comment}&rdquo;</p>
          <div style={{ fontSize: '1.2em', fontWeight: 700 }}>{item.name}</div>
          <div style={{ color: C.sub, fontSize: '0.95em' }}>{item.packageName}</div>
        </>
      ) : (
        <p style={{ color: C.sub, fontSize: '1.2em' }}>Belum ada testimoni.</p>
      )}
    </div>
  );
}

// Ambil ID video YouTube dari berbagai bentuk link (watch, youtu.be, shorts, embed).
function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

function VideoSlide({ slide, onEnded, soundOk }) {
  const yt = youtubeId(slide.videoUrl);
  const muted = !(slide.sound && soundOk);
  const vref = useRef(null);
  // Video file: kalau diminta bersuara tapi browser nolak, putar bisu saja
  // (tetap jalan) dan tunggu izin dari klik/tombol remote.
  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    v.muted = muted;
    const pr = v.play();
    if (pr && pr.catch) pr.catch(() => { v.muted = true; v.play().catch(() => {}); });
  }, [muted, slide.videoUrl]);
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '0.8em' }}>
      {slide.title && <h2 style={{ fontSize: '1.8em', margin: 0, color: C.gold }}>{slide.title}</h2>}
      <div style={{ flex: 1, minHeight: 0, borderRadius: '1em', overflow: 'hidden', background: '#000' }}>
        {yt ? (
          <iframe
            key={muted ? 'm' : 'u'}
            title="video"
            src={`https://www.youtube.com/embed/${yt}?autoplay=1&mute=${muted ? 1 : 0}&controls=0&loop=1&playlist=${yt}&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3`}
            allow="autoplay; encrypted-media; picture-in-picture"
            style={{ width: '100%', height: '100%', border: 0, pointerEvents: 'none' }}
          />
        ) : slide.videoUrl ? (
          <video
            ref={vref}
            src={slide.videoUrl} autoPlay muted={muted} playsInline loop={!slide.untilEnd}
            onEnded={onEnded}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.sub, fontSize: '1.4em' }}>Link video belum diisi.</div>
        )}
      </div>
    </div>
  );
}

function AnnouncementSlide({ slide }) {
  const hasImg = !!slide.imageUrl;
  const hasText = !!(slide.title || slide.text);
  if (hasImg && !hasText) {
    return <img src={slide.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '1em' }} />;
  }
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', gap: '2em', alignItems: 'center' }}>
      {hasImg && (
        <div style={{ flex: '1 1 50%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={slide.imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '1em' }} />
        </div>
      )}
      <div style={{ flex: '1 1 50%', textAlign: hasImg ? 'left' : 'center', padding: hasImg ? 0 : '0 8%' }}>
        {slide.title && <h2 style={{ fontSize: hasImg ? '2.6em' : '3.4em', margin: '0 0 0.4em', color: C.gold, lineHeight: 1.15 }}>{slide.title}</h2>}
        {slide.text && <p style={{ fontSize: hasImg ? '1.5em' : '1.9em', lineHeight: 1.5, margin: 0, whiteSpace: 'pre-line', color: C.text }}>{slide.text}</p>}
      </div>
    </div>
  );
}

export default function LayarTunggu() {
  const [code, setCode] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [idx, setIdx] = useState(0);
  const [testiPick, setTestiPick] = useState(0);
  const [now, setNow] = useState(new Date());
  const testiCounter = useRef(0);
  // Izin suara: true kalau browser/perangkat sudah mengizinkan autoplay
  // bersuara (hasil probe), atau kalau ada klik/tombol remote sekali.
  const [autoplayAllowed, setAutoplayAllowed] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const soundOk = autoplayAllowed || unlocked;

  useEffect(() => {
    try { setCode(new URLSearchParams(window.location.search).get('code') || ''); } catch (e) { /* abaikan */ }
  }, []);

  useEffect(() => {
    // Probe: coba putar audio kosong tanpa interaksi. Kalau lolos, berarti
    // perangkat ini sudah diizinkan autoplay dengan suara.
    try {
      const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
      const pr = a.play();
      if (pr && pr.then) pr.then(() => setAutoplayAllowed(true)).catch(() => {});
    } catch (e) { /* abaikan */ }
    const unlock = () => setUnlocked(true);
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!code) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/public/waiting-screen?code=${encodeURIComponent(code)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { if (!cancelled) setError(json.error || 'Gagal memuat.'); return; }
        if (!cancelled) { setData(json); setError(''); }
      } catch (e) {
        // koneksi putus sementara: tetap tampilkan data terakhir
        if (!cancelled && !data) setError('Gagal terhubung. Mencoba lagi...');
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const slides = data?.config?.slides || [];
  const current = slides.length > 0 ? slides[idx % slides.length] : null;

  const nextSlide = () => setIdx((i) => (i + 1) % Math.max(1, slides.length));

  // Pindah slide sesuai durasi masing-masing. Video file (bukan YouTube)
  // yang diset "sampai selesai" pindah lewat event onEnded, timer di sini
  // cuma jadi pengaman (maks 3 menit) kalau videonya gagal diputar.
  useEffect(() => {
    if (slides.length < 2) return undefined;
    const untilEnd = current?.type === 'video' && current?.untilEnd && !youtubeId(current?.videoUrl);
    const secs = untilEnd ? 180 : Math.max(3, Number(current?.seconds) || Number(data?.config?.defaultSeconds) || 10);
    const t = setTimeout(() => setIdx((i) => (i + 1) % slides.length), secs * 1000);
    return () => clearTimeout(t);
  }, [idx, slides.length, current, data]);

  // Tiap kali slide testimoni muncul, ganti ke testimoni berikutnya
  useEffect(() => {
    if (current?.type === 'testimonials') {
      setTestiPick(testiCounter.current);
      testiCounter.current += 1;
    }
  }, [idx, current?.type]);

  const clock = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(now).replace('.', ':');
  const dateLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(now);
  const cfg = data?.config || {};
  const testimonials = data?.testimonials || [];
  const needSound = slides.some((x) => x.type === 'video' && x.sound);
  const testiItem = testimonials.length ? testimonials[testiPick % testimonials.length] : null;

  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, background: C.bg, color: C.text, fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', fontSize: 'min(1.15vw, 2.1vh)', display: 'flex', flexDirection: 'column', cursor: 'none', overflow: 'hidden' }}>
      <style>{`@keyframes lt-fade{from{opacity:0;transform:translateY(0.6em)}to{opacity:1;transform:none}}`}</style>
      {children}
    </div>
  );

  if (!code) return shell(<div style={{ margin: 'auto', color: C.sub, fontSize: '1.6em' }}>Kode akses belum ada di link ini.</div>);
  if (error && !data) return shell(<div style={{ margin: 'auto', color: C.red, fontSize: '1.6em', textAlign: 'center', padding: '2em' }}>{error}</div>);
  if (!data) return shell(<div style={{ margin: 'auto', color: C.sub, fontSize: '1.6em' }}>Memuat...</div>);

  return shell(
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2em 2.5em', borderBottom: `1px solid ${C.line}` }}>
        <div>
          <div style={{ fontSize: '0.8em', letterSpacing: '0.2em', color: C.green, fontWeight: 700 }}>WISATA HALAL INTERNASIONAL</div>
          {cfg.greeting && <div style={{ fontSize: '1.5em', fontWeight: 700, marginTop: '0.15em' }}>{cfg.greeting}</div>}
        </div>
        {cfg.showClock !== false && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '3em', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{clock}</div>
            <div style={{ color: C.sub, fontSize: '1em', marginTop: '0.2em' }}>{dateLabel}</div>
          </div>
        )}
      </div>

      <div key={current ? `${current.id}-${idx}` : 'none'} style={{ flex: 1, minHeight: 0, padding: '2em 2.5em', animation: 'lt-fade 0.7s ease both' }}>
        {!current ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.sub, fontSize: '1.6em' }}>
            Belum ada slide yang aktif.
          </div>
        ) : current.type === 'packages' ? (
          <PackagesSlide slide={current} packages={data.packages || []} />
        ) : current.type === 'video' ? (
          <VideoSlide slide={current} onEnded={nextSlide} soundOk={soundOk} />
        ) : current.type === 'testimonials' ? (
          <TestimonialSlide slide={current} item={testiItem} />
        ) : (
          <AnnouncementSlide slide={current} />
        )}
      </div>

      {needSound && !soundOk && (
        <div style={{ position: 'fixed', right: '2em', bottom: '2em', padding: '0.7em 1.2em', borderRadius: '999px', background: 'rgba(15,23,42,0.92)', border: `1px solid ${C.gold}`, color: C.gold, fontSize: '1em', fontWeight: 600 }}>
          Tekan OK atau klik sekali untuk menyalakan suara
        </div>
      )}

      {slides.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5em', padding: '0 0 1em' }}>
          {slides.map((s, i) => (
            <span key={s.id || i} style={{ width: i === idx % slides.length ? '2em' : '0.6em', height: '0.6em', borderRadius: '999px', background: i === idx % slides.length ? C.green : C.line, transition: 'all 0.4s' }} />
          ))}
        </div>
      )}
    </>
  );
}
