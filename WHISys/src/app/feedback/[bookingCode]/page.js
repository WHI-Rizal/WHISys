'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, query, where, getDocs, limit } from 'firebase/firestore';
import { Star, Send, CheckCircle2, Plane, ExternalLink, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';

const GOOGLE_REVIEW_LINK = 'https://www.google.com/maps/place/Wisata+Halal+Indonesia/@-6.3127371,106.767536,17z/data=!3m1!4b1!4m6!3m5!1s0x2e69ef800cfab2df:0x6c9f79f91ef9de17!8m2!3d-6.3127424!4d106.7701109!16s%2Fg%2F11v0qsvbxm?hl=en-GB&entry=ttu';

export default function PublicFeedbackPage({ params }) {
  const bookingCode = params?.bookingCode || '';

  // Verifikasi kode booking ke database — jangan pernah percaya nama/paket dari
  // parameter URL, karena itu bisa diubah bebas oleh siapapun di address bar.
  const [checkingBooking, setCheckingBooking] = useState(true);
  const [verifiedBooking, setVerifiedBooking] = useState(null); // { jamaahName, packageName, packageId }
  const [bookingNotFound, setBookingNotFound] = useState(false);

  const jamaahName = verifiedBooking?.jamaahName || '';
  const packageName = verifiedBooking?.packageName || '';
  const packageId = verifiedBooking?.packageId || '';

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [submittedRating, setSubmittedRating] = useState(0);
  const [submittedComment, setSubmittedComment] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const verifyBooking = async () => {
      if (!bookingCode) {
        setBookingNotFound(true);
        setCheckingBooking(false);
        return;
      }
      try {
        const q = query(collection(db, 'bookings'), where('bookingCode', '==', bookingCode), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) {
          setBookingNotFound(true);
        } else {
          const bk = snap.docs[0].data();
          setVerifiedBooking({
            jamaahName: bk.jamaahName || '',
            packageName: bk.packageName || '',
            packageId: bk.packageId || ''
          });
        }
      } catch (err) {
        console.error('Gagal verifikasi kode booking:', err);
        setBookingNotFound(true);
      }
      setCheckingBooking(false);
    };

    verifyBooking();
  }, [bookingCode]);

  const buildAutoReviewText = () => {
    const place = packageName ? ` di program ${packageName}` : '';
    return `Pengalaman perjalanan${place} bersama Wisata Halal Indonesia sangat memuaskan. Pelayanan ramah, terorganisir, dan sesuai jadwal. Terima kasih banyak!`;
  };

  const handleCopyReview = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!verifiedBooking) return; // jaga-jaga — tombol submit harusnya sudah nggak muncul kalau booking belum terverifikasi
    setSubmitting(true);
    setError('');
    try {
      await addDoc(collection(db, 'feedback'), {
        bookingCode,
        jamaahName: jamaahName || 'Jamaah',
        packageName: packageName || 'Umum / Tidak Terkait Paket',
        packageId: packageId || null,
        rating,
        comment: comment.trim(),
        source: 'self',
        createdAt: new Date().toISOString()
      });
      setSubmittedRating(rating);
      setSubmittedComment(comment.trim());
      setSubmitted(true);
    } catch (err) {
      setError('Gagal mengirim feedback. Silakan coba lagi dalam beberapa saat.');
      console.error(err);
    }
    setSubmitting(false);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#020617',
      padding: '1.5rem',
      fontFamily: 'sans-serif'
    }}>
      <div style={{
        maxWidth: '30rem',
        width: '100%',
        backgroundColor: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '1rem',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        padding: '2rem'
      }}>
        {checkingBooking ? (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <Loader2 color="#64748b" size={32} className="animate-spin" style={{ margin: '0 auto 1rem' }} />
            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Memverifikasi kode booking...</p>
          </div>
        ) : bookingNotFound ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <AlertTriangle color="#f87171" size={40} style={{ margin: '0 auto 1rem' }} />
            <h1 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#fff', margin: '0 0 0.5rem' }}>
              Kode Booking Tidak Ditemukan
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.6 }}>
              Link ini nggak cocok dengan data booking manapun di sistem kami. Pastikan Anda membuka link yang dikirim langsung oleh tim Wisata Halal Indonesia, atau hubungi kami kalau merasa ini keliru.
            </p>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{
                width: '3rem', height: '3rem', backgroundColor: '#059669', borderRadius: '0.75rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem'
              }}>
                <Plane color="#fff" size={24} />
              </div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff', margin: 0 }}>
                {submitted ? 'Terima Kasih!' : 'Bagaimana Perjalanan Anda?'}
              </h1>
              {!submitted && (
                <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                  {jamaahName ? `Halo ${jamaahName}, ` : ''}
                  {packageName ? `ceritakan pengalaman Anda di program ${packageName}` : 'ceritakan pengalaman perjalanan Anda bersama kami'}
                </p>
              )}
            </div>

            {submitted ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <CheckCircle2 color="#10b981" size={48} style={{ margin: '0 auto 1rem' }} />
            <p style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.6 }}>
              Terima kasih sudah meluangkan waktu memberi ulasan. Masukan Anda sangat berarti buat kami terus tingkatkan kualitas layanan.
            </p>

            {submittedRating >= 4 && (
              <div style={{
                marginTop: '1.5rem', padding: '1.25rem', backgroundColor: '#1e293b',
                border: '1px solid #334155', borderRadius: '0.75rem'
              }}>
                <p style={{ color: '#fbbf24', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  ⭐ Senang Anda puas dengan perjalanannya!
                </p>
                <p style={{ color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.6, marginBottom: '0.9rem' }}>
                  Boleh bantu kami sekali lagi? Tinggal salin ulasan di bawah, lalu tempel di Google. Nggak perlu ngetik ulang.
                </p>

                <div style={{
                  backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '0.6rem',
                  padding: '0.75rem', color: '#cbd5e1', fontSize: '0.78rem', lineHeight: 1.6,
                  marginBottom: '0.75rem', textAlign: 'left'
                }}>
                  {submittedComment || buildAutoReviewText()}
                </div>

                <button
                  type="button"
                  onClick={() => handleCopyReview(submittedComment || buildAutoReviewText())}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    width: '100%', padding: '0.7rem 1rem', backgroundColor: copied ? '#065f46' : '#1e293b',
                    color: copied ? '#a7f3d0' : '#e2e8f0', fontWeight: 600, borderRadius: '0.75rem',
                    border: '1px solid #334155', cursor: 'pointer', fontSize: '0.82rem', marginBottom: '0.6rem',
                    boxSizing: 'border-box'
                  }}
                >
                  {copied ? <><Check size={15} /> Tersalin!</> : <><Copy size={15} /> Salin Teks Ulasan</>}
                </button>

                <a
                  href={GOOGLE_REVIEW_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    width: '100%', padding: '0.75rem 1rem', backgroundColor: '#fff', color: '#1e293b',
                    fontWeight: 600, borderRadius: '0.75rem', textDecoration: 'none', fontSize: '0.85rem',
                    boxSizing: 'border-box'
                  }}
                >
                  Buka Google & Tempel Ulasan <ExternalLink size={15} />
                </a>
              </div>
            )}

            <p style={{ color: '#475569', fontSize: '0.75rem', marginTop: '1rem' }}>
              PT Wisata Halal Indonesia
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ textAlign: 'center', margin: '1.5rem 0' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Rating Keseluruhan
              </label>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setRating(n)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    <Star
                      size={36}
                      color={n <= rating ? '#fbbf24' : '#334155'}
                      fill={n <= rating ? '#fbbf24' : 'none'}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Cerita / Masukan Anda (Opsional)
              </label>
              <textarea
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Ceritakan pengalaman Anda: pelayanan, hotel, transportasi, tour leader, dll..."
                style={{
                  width: '100%', padding: '0.75rem 1rem', backgroundColor: '#1e293b', border: '1px solid #334155',
                  borderRadius: '0.75rem', color: '#fff', outline: 'none', boxSizing: 'border-box', resize: 'vertical',
                  fontFamily: 'inherit', fontSize: '0.85rem'
                }}
              />
            </div>

            {error && (
              <div style={{
                marginBottom: '1rem', padding: '0.65rem', backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '0.5rem', color: '#f87171', fontSize: '0.8rem'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%', padding: '0.875rem 1rem', backgroundColor: submitting ? '#065f46' : '#059669',
                color: '#fff', fontWeight: 600, borderRadius: '0.75rem', border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '0.5rem', fontSize: '0.9rem'
              }}
            >
              <Send size={16} /> {submitting ? 'Mengirim...' : 'Kirim Ulasan'}
            </button>
          </form>
        )}
          </>
        )}
      </div>
    </div>
  );
}
