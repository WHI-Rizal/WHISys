import { getAdminDb } from '@/lib/firebaseAdmin';
import { authorizeJarvis, jarvisJson, logJarvis } from '@/lib/jarvisAuth';
import {
  cached, clampInt, dateOnly, loadPackages, loadActiveBookingsByPackage, loadJamaahMap,
  assessPassport, assessManifestFields, missingDocs, DEFAULT_REQUIRED_DOCS, DOC_LABELS,
  PASSPORT_ISSUE_LABEL, publicPackage, cap,
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
    const packageId = (sp.get('packageId') || '').trim();
    const code = (sp.get('code') || '').trim().toLowerCase();
    const minMonths = clampInt(sp.get('minMonths'), 6, 0, 12);
    const docsRequired = parseDocs(sp.get('docs'));
    if (!packageId && !code) return jarvisJson({ error: 'Isi packageId atau code paket.' }, 400);
    logJarvis('manifest', { packageId, code, minMonths, docsRequired });

    const result = await cached(`manifest|${packageId}|${code}|${minMonths}|${docsRequired.join(',')}`, 60000, async () => {
      const db = getAdminDb();
      const pkgs = await loadPackages(db);
      const pkg = pkgs.find(p => (packageId ? p.id === packageId : String(p.code || '').toLowerCase() === code));
      if (!pkg) return { notFound: true };
      const bookings = (await loadActiveBookingsByPackage(db, [pkg.id])).get(pkg.id) || [];
      const jamaahMap = await loadJamaahMap(db, bookings.map(b => b.jamaahId));
      const dep = dateOnly(pkg.departureDate);

      const perRoom = {}; let roomUnset = 0; let roomNoNumber = 0;
      const noJamaahRecord = []; const passportProblems = []; const fieldGaps = []; const docGaps = []; const noPassport = [];
      bookings.forEach(b => {
        const who = { name: b.jamaahName || '', bookingCode: b.groupBookingCode || b.bookingCode || '' };
        if (b.roomType) perRoom[b.roomType] = (perRoom[b.roomType] || 0) + 1; else roomUnset++;
        if (!String(b.roomLabel || '').trim()) roomNoNumber++;
        const j = jamaahMap.get(b.jamaahId);
        if (!j) { noJamaahRecord.push(who); }
        else {
          if (!String(j.passportNumber || '').trim()) noPassport.push(who);
          const issues = assessPassport(j, dep, minMonths);
          if (issues.length) passportProblems.push({ ...who, passportExpiry: dateOnly(j.passportExpiry) || null, masalah: issues.map(i => PASSPORT_ISSUE_LABEL[i]) });
          const gaps = assessManifestFields(j);
          if (gaps.length) fieldGaps.push({ ...who, kurang: gaps });
        }
        const md = missingDocs(b, docsRequired);
        if (md.length) docGaps.push({ ...who, belumAda: md });
      });

      const groups = new Set(bookings.map(b => b.groupBookingCode || b.bookingCode || b.id));
      const ready = noJamaahRecord.length === 0 && passportProblems.length === 0 && fieldGaps.length === 0 && roomUnset === 0;
      return {
        package: publicPackage(pkg.id, pkg),
        totals: { activePeserta: bookings.length, groups: groups.size, tourLeaders: Array.isArray(pkg.tourLeaders) ? pkg.tourLeaders.length : 0 },
        rooms: { perType: perRoom, typeNotSet: roomUnset, roomNumberEmpty: roomNoNumber },
        needsAttention: {
          noJamaahRecord: cap(noJamaahRecord),
          passportProblems: cap(passportProblems),
          manifestFieldGaps: cap(fieldGaps),
          documentsMissing: { required: docsRequired.map(k => DOC_LABELS[k]), ...cap(docGaps) },
        },
        passportNumberEmptyCount: noPassport.length,
        manifestReady: ready,
        manifestReadyNote: 'true kalau semua peserta punya data jamaah, paspor sah, kolom manifest lengkap, dan tipe kamar terisi. Nomor kamar dan dokumen tidak ikut dihitung.',
      };
    });
    if (result.notFound) return jarvisJson({ error: 'Paket tidak ditemukan.' }, 404);
    return jarvisJson(result);
  } catch (err) {
    console.error('[jarvis] manifest error:', err);
    return jarvisJson({ error: 'Gagal membaca data manifest.' }, 500);
  }
}

