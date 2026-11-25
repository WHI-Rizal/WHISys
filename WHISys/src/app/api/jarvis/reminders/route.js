import { getAdminDb } from '@/lib/firebaseAdmin';
import { authorizeJarvis, jarvisJson, logJarvis } from '@/lib/jarvisAuth';
import {
  todayWIB, addDays, dateOnly, clampInt, cached, cap, loadPackages, loadActiveBookingsByPackage, loadJamaahMap,
  assessPassport, missingDocs, buildPaymentReminders, DEFAULT_REQUIRED_DOCS, DOC_LABELS, PASSPORT_ISSUE_LABEL,
} from '@/lib/jarvisData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const parseDocs = (raw) => {
  if (!raw) return DEFAULT_REQUIRED_DOCS;
  const list = raw.split(',').map(s => s.trim()).filter(k => DOC_LABELS[k]);
  return list.length ? list : DEFAULT_REQUIRED_DOCS;
};

export async function GET(req) {
  const denied = authorizeJarvis(req);
  if (denied) return denied;
  try {
    const sp = new URL(req.url).searchParams;
    const type = ['all', 'passport', 'documents', 'payments'].includes(sp.get('type')) ? sp.get('type') : 'all';
    const packageId = (sp.get('packageId') || '').trim();
    const days = clampInt(sp.get('days'), 7, 0, 60);
    const horizon = clampInt(sp.get('horizon'), 120, 1, 730);
    const docsDays = clampInt(sp.get('docsDays'), 60, 1, 730);
    const minMonths = clampInt(sp.get('minMonths'), 6, 0, 12);
    const docsRequired = parseDocs(sp.get('docs'));
    logJarvis('reminders', { type, packageId, days, horizon, docsDays, minMonths, docsRequired });

    const key = `reminders|${type}|${packageId}|${days}|${horizon}|${docsDays}|${minMonths}|${docsRequired.join(',')}`;
    const result = await cached(key, 60000, async () => {
      const db = getAdminDb();
      const today = todayWIB();
      const until = addDays(today, horizon);
      let pkgs = (await loadPackages(db)).filter(p => { const d = dateOnly(p.departureDate); return d && d >= today && d <= until; });
      if (packageId) pkgs = (await loadPackages(db)).filter(p => p.id === packageId);
      pkgs.sort((a, b) => dateOnly(a.departureDate).localeCompare(dateOnly(b.departureDate)));
      const bookingMap = await loadActiveBookingsByPackage(db, pkgs.map(p => p.id));
      const out = { today, horizonDays: horizon, packagesChecked: pkgs.map(p => ({ code: p.code || '', name: p.name || '', departureDate: dateOnly(p.departureDate) })) };

      if (type === 'all' || type === 'passport') {
        const ids = []; pkgs.forEach(p => (bookingMap.get(p.id) || []).forEach(b => ids.push(b.jamaahId)));
        const jm = await loadJamaahMap(db, ids);
        const items = [];
        pkgs.forEach(p => (bookingMap.get(p.id) || []).forEach(b => {
          const j = jm.get(b.jamaahId);
          if (!j) return;
          const issues = assessPassport(j, p.departureDate, minMonths);
          if (issues.length) items.push({
            package: p.name || '', departureDate: dateOnly(p.departureDate), name: b.jamaahName || '',
            bookingCode: b.groupBookingCode || b.bookingCode || '', passportExpiry: dateOnly(j.passportExpiry) || null,
            masalah: issues.map(i => PASSPORT_ISSUE_LABEL[i]),
          });
        }));
        out.passport = { rule: `paspor harus berlaku minimal ${minMonths} bulan setelah tanggal berangkat`, ...cap(items) };
      }

      if (type === 'all' || type === 'documents') {
        const docsUntil = addDays(today, docsDays);
        const items = [];
        pkgs.filter(p => dateOnly(p.departureDate) <= docsUntil).forEach(p => (bookingMap.get(p.id) || []).forEach(b => {
          const md = missingDocs(b, docsRequired);
          if (md.length) items.push({
            package: p.name || '', departureDate: dateOnly(p.departureDate), name: b.jamaahName || '',
            bookingCode: b.groupBookingCode || b.bookingCode || '', belumAda: md,
          });
        }));
        out.documents = { required: docsRequired.map(k => DOC_LABELS[k]), checkedDepartingWithinDays: docsDays, ...cap(items) };
      }

      if (type === 'all' || type === 'payments') {
        const { overdue, dueSoon } = buildPaymentReminders(pkgs, bookingMap, today, days);
        out.payments = {
          note: 'Tanpa nominal. DP 2 jatuh tempo 30 hari setelah booking dibuat, Pelunasan 40 hari sebelum berangkat. Satu baris per rombongan dan tahap.',
          overdue: cap(overdue), dueWithinDays: days, dueSoon: cap(dueSoon),
        };
      }
      return out;
    });
    return jarvisJson(result);
  } catch (err) {
    console.error('[jarvis] reminders error:', err);
    return jarvisJson({ error: 'Gagal membaca data pengingat.' }, 500);
  }
}
