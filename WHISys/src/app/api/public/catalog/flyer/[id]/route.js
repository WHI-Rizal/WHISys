import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

// Sajikan gambar flyer 1 paket sebagai file gambar biasa (bukan base64 di
// dalam JSON), supaya browser & CDN bisa menyimpannya (cache) lama.
// URL-nya diberi ?v=<updatedAt> oleh lib/catalogFlyer.js, jadi kalau flyer
// diganti, URL-nya ikut berubah dan cache lama otomatis nggak dipakai.
// Sumber data: `public_catalog` saja (publik), BUKAN collection `packages`.
export async function GET(_req, { params }) {
  try {
    const snap = await getDoc(doc(db, 'public_catalog', params.id));
    const dataUrl = snap.exists() ? snap.data().flyerImageDataUrl : '';
    const m = typeof dataUrl === 'string' ? dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/) : null;
    if (!m) {
      return new NextResponse('Flyer tidak ditemukan', { status: 404, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } });
    }
    const buf = Buffer.from(m[2], 'base64');
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': m[1],
        'Content-Length': String(buf.length),
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('Gagal menyajikan flyer katalog:', err);
    return new NextResponse('Gagal memuat flyer', { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
