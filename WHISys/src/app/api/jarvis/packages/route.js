import { getAdminDb } from '@/lib/firebaseAdmin';
import { authorizeJarvis, jarvisJson, logJarvis } from '@/lib/jarvisAuth';
import {
  todayWIB, addDays, dateOnly, clampInt, cached, publicPackage,
  loadPackages, loadActiveBookingsByPackage,
} from '@/lib/jarvisData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const trim = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) + '...' : t; };

export async function GET(req) {
  const denied = authorizeJarvis(req);
  if (denied) return denied;
  try {
    const sp = new URL(req.url).searchParams;
    const q = (sp.get('q') || '').trim().toLowerCase();
    const id = (sp.get('id') || '').trim();
    const code = (sp.get('code') || '').trim().toLowerCase();
    const days = clampInt(sp.get('days'), 365, 1, 1500);
    const includePast = sp.get('includePast') === '1';
    const activeOnly = sp.get('catalog') === 'active';
    const limit = clampInt(sp.get('limit'), 20, 1, 50);
    logJarvis('packages', { q, id, code, days, includePast, activeOnly, limit });

    const key = `packages|${q}|${id}|${code}|${days}|${includePast}|${activeOnly}|${limit}`;
    const result = await cached(key, 60000, async () => {
      const db = getAdminDb();
      const today = todayWIB();
      const until = addDays(today, days);
      let list = await loadPackages(db);
      const detail = !!(id || code);
      if (id) list = list.filter(p => p.id === id);
      else if (code) list = list.filter(p => String(p.code || '').toLowerCase() === code);
      else {
        list = list.filter(p => {
          const dep = dateOnly(p.departureDate);
          if (!dep) return false;
          if (!includePast && dep < today) return false;
          return dep <= until;
        });
        if (activeOnly) list = list.filter(p => p.isActive !== false);
        if (q) list = list.filter(p => [p.name, p.code, p.destinationCity, p.type].some(v => String(v || '').toLowerCase().includes(q)));
      }
      list.sort((a, b) => dateOnly(a.departureDate).localeCompare(dateOnly(b.departureDate)));
      const total = list.length;
      list = list.slice(0, limit);

      const bookingMap = await loadActiveBookingsByPackage(db, list.map(p => p.id));
      const items = list.map(p => {
        const bookings = bookingMap.get(p.id) || [];
        const groups = new Set(bookings.map(b => b.groupBookingCode || b.bookingCode || b.id));
        const quotaTotal = Number.isFinite(Number(p.quotaTotal)) ? Number(p.quotaTotal) : null;
        const extra = {
          activeBookings: bookings.length,
          groups: groups.size,
          seatsLeftBySystem: Number.isFinite(Number(p.quotaRemaining)) ? Number(p.quotaRemaining) : null,
          seatsLeftComputed: quotaTotal === null ? null : quotaTotal - bookings.length,
        };
        const out = publicPackage(p.id, p, extra);
        if (detail) {
          out.prices = {
            main: Number(p.priceMain) || null, quad: Number(p.priceQuad) || null, triple: Number(p.priceTriple) || null,
            double: Number(p.priceDouble) || null, child: Number(p.priceChild) || null,
          };
          out.flights = Array.isArray(p.flightSegments) ? p.flightSegments : [];
          out.priceIncludes = Array.isArray(p.priceIncludes) ? p.priceIncludes : (p.priceIncludes || '');
          out.priceExcludes = Array.isArray(p.priceExcludes) ? p.priceExcludes : (p.priceExcludes || '');
          out.specialNote = trim(p.specialNote, 1500);
          out.itinerary = (Array.isArray(p.itinerary) ? p.itinerary : []).map((d, i) => ({
            day: d.day || i + 1, title: d.title || '', meals: d.meals || '', hotel: d.hotel || '', description: trim(d.description, 400),
          }));
        }
        return out;
      });
      return { today, total, shown: items.length, items };
    });
    return jarvisJson(result);
  } catch (err) {
    console.error('[jarvis] packages error:', err);
    return jarvisJson({ error: 'Gagal membaca data paket.' }, 500);
  }
}
