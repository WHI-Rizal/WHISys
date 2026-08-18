'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { Star, Send, CheckCircle2, Plane, ExternalLink } from 'lucide-react';

const GOOGLE_REVIEW_LINK = 'https://www.google.com/maps/place/Wisata+Halal+Indonesia/@-6.3127371,106.767536,17z/data=!3m1!4b1!4m6!3m5!1s0x2e69ef800cfab2df:0x6c9f79f91ef9de17!8m2!3d-6.3127424!4d106.7701109!16s%2Fg%2F11v0qsvbxm?hl=en-GB&entry=ttu';

export default function PublicFeedbackPage({ params, searchParams }) {
  const bookingCode = params?.bookingCode || '';
  const jamaahName = searchParams?.j || '';
  const packageName = searchParams?.p || '';
  const packageId = searchParams?.pid || '';

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [submittedRating, setSubmittedRating] = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
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
                <p style={{ color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.6, marginBottom: '1rem' }}>
                  Boleh bantu kami sekali lagi? Ulasan Anda di Google akan sangat membantu jamaah lain menemukan kami.
                </p>
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
                  Beri Ulasan di Google <ExternalLink size={15} />
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
      </div>
    </div>
  );
}
