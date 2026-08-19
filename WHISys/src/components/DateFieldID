'use client';

import React from 'react';

// Browser native <input type="date"> selalu menyimpan value dalam format ISO
// (yyyy-mm-dd), tapi TAMPILANNYA (waktu nggak lagi fokus/diedit) ngikutin locale
// browser/OS si user — jadi bisa keluar sebagai mm/dd/yyyy di komputer yang locale-nya
// English (US), padahal kita mau selalu dd/mm/yyyy di seluruh sistem WHISys.
//
// Komponen ini nge-render teks tampilannya sendiri (selalu dd/mm/yyyy), sementara
// <input type="date"> aslinya tetap ada tapi disembunyikan (opacity-0) dan
// ditumpuk pas di atasnya — jadi begitu diklik, kalender picker bawaan browser tetap
// kebuka & value yang tersimpan tetap format ISO seperti biasa (kompatibel sama kode
// yang udah ada, nggak perlu ubah cara nyimpen ke Firestore).
export default function DateFieldID({
  value,
  onChange,
  required = false,
  className = '',
  nativeClassName = '',
  name,
  placeholder = 'dd/mm/yyyy'
}) {
  const displayValue = formatDDMMYYYY(value);

  return (
    <div className="relative">
      <div className={`${className} flex items-center pointer-events-none select-none`}>
        {displayValue ? <span>{displayValue}</span> : <span className="opacity-40">{placeholder}</span>}
      </div>
      <input
        type="date"
        name={name}
        required={required}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer ${nativeClassName}`}
      />
    </div>
  );
}

export function formatDDMMYYYY(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}
