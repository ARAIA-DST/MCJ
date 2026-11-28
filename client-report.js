(function () {
  'use strict';

  const excelScript = new URL('vendor/exceljs-4.4.0.min.js', document.currentScript.src).href;
  const fileType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const colors = { ink: 'FF24241F', dark: 'FF34372F', accent: 'FFFFD400', white: 'FFFFFFFF',
    light: 'FFF6F5F2', muted: 'FF575D52', line: 'FFE1DED4', link: 'FF1D5294' };
  const integer = '#,##0';
  const currency = '"Rp" #,##0';
  const percentage = '0.0%';
  const dateFormat = 'dd mmm yyyy';
  let loadingExcel;

  function loadExcel() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (!loadingExcel) {
      loadingExcel = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = excelScript;
        function finish() {
          clearTimeout(timer);
          script.remove();
          if (window.ExcelJS) resolve(window.ExcelJS);
          else reject(new Error('Pembuat file Excel tidak berhasil dimuat. Coba unduh lagi.'));
        }
        const timer = setTimeout(finish, 15000);
        script.onload = finish;
        script.onerror = finish;
        document.head.appendChild(script);
      }).catch((error) => {
        loadingExcel = null;
        throw error;
      });
    }
    return loadingExcel;
  }

  function groupBy(rows, key) {
    const groups = new Map();
    rows.forEach((row) => {
      const value = String(row[key] ?? '');
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    });
    return groups;
  }

  function collect(rows, key, transform = (value) => value) {
    const values = rows.map((row) => transform(row[key])).filter((v) => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).join('\n');
  }

  function yesNo(value) {
    const key = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'ya'].includes(key)) return 'Ya';
    if (['false', '0', 'no', 'tidak'].includes(key)) return 'Tidak';
    return value ?? '';
  }

  function qualificationStatus(row) {
    if (yesNo(row.eligible) === 'Tidak') return 'Tidak qualified';
    if (yesNo(row.eligible) === 'Ya') return yesNo(row.evidence_ok) === 'Ya' ? 'Qualified' : 'Bukti belum lengkap';
    return 'Belum dinilai';
  }

  function numeric(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value ?? '').trim();
    const digits = raw.replace(/^rp\s*/i, '');
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(digits)) return Number(digits.replace(/\./g, '').replace(',', '.'));
    if (/^\d+([.,]\d+)?$/.test(digits)) return Number(digits.replace(',', '.'));
    return raw;
  }

  function intentScore(value) {
    return /^[1-5]$/.test(String(value ?? '')) ? Number(value) : null;
  }

  function excelDate(value) {
    return value ? new Date(value + 'T00:00:00Z') : null;
  }

  function mostRecent(rows, time) {
    return rows.reduce((best, row) => !best || time(row) >= time(best) ? row : best, null);
  }

  function evidenceCell(photos, kind, title) {
    const links = Array.from(new Set(photos.filter((photo) => photo.kind === kind).map((photo) => photo.url)));
    if (links.length > 1) return links.join('\n');
    return links.length ? { text: title, hyperlink: links[0] } : null;
  }

  function tint(argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }

  function reportSheet(workbook, spec) {
    const { name, title, subtitle, columns, rows } = spec;
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 5, xSplit: spec.freeze || 0, showGridLines: false }],
      properties: { defaultRowHeight: 20, tabColor: { argb: spec.accent ? colors.accent : colors.dark } }
    });
    sheet.columns = columns.map((column) => ({ width: column[1] || 23 }));
    const endOfTitle = Math.min(columns.length, 6);
    sheet.mergeCells(1, 1, 1, endOfTitle);
    sheet.mergeCells(2, 1, 2, endOfTitle);
    const titleCell = sheet.getCell('A1');
    titleCell.value = title;
    titleCell.fill = tint(colors.ink);
    titleCell.font = { name: 'Calibri', size: 19, bold: true, color: { argb: colors.white } };
    titleCell.alignment = { vertical: 'middle', indent: 1 };
    sheet.getRow(1).height = 36;
    const subtitleCell = sheet.getCell('A2');
    subtitleCell.value = subtitle;
    subtitleCell.fill = tint(colors.light);
    subtitleCell.font = { name: 'Calibri', size: 11, color: { argb: colors.muted } };
    subtitleCell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    subtitleCell.border = { bottom: { style: 'medium', color: { argb: colors.accent } } };
    sheet.getRow(2).height = 30;
    sheet.getRow(3).height = 8;

    if (spec.groups) {
      let first = 1;
      spec.groups.forEach(([group, definitions]) => {
        const last = first + definitions.length - 1;
        if (first < last) sheet.mergeCells(4, first, 4, last);
        const cell = sheet.getCell(4, first);
        cell.value = group;
        cell.fill = tint(colors.accent);
        cell.font = { name: 'Calibri', bold: true, color: { argb: colors.ink } };
        cell.alignment = { vertical: 'middle', indent: 1 };
        first = last + 1;
      });
      sheet.getRow(4).height = 23;
    }

    const header = sheet.getRow(5);
    header.values = columns.map((column) => column[0]);
    header.height = 34;
    header.eachCell((cell) => {
      cell.fill = tint(colors.dark);
      cell.font = { name: 'Calibri', bold: true, color: { argb: colors.white } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    if (rows.length && spec.filter !== false) {
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: columns.length } };
    }
    rows.forEach((values, index) => {
      const row = sheet.addRow(values);
      let lines = 1;
      columns.forEach((column, j) => {
        const cell = row.getCell(j + 1);
        const isLink = cell.value && typeof cell.value === 'object' && cell.value.hyperlink;
        cell.font = { name: 'Calibri', size: 11, color: { argb: isLink ? colors.link : colors.ink }, underline: Boolean(isLink) };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.fill = tint(index % 2 === 0 ? colors.white : colors.light);
        cell.border = { bottom: { style: 'hair', color: { argb: colors.line } } };
        if (column[2] && (typeof cell.value === 'number' || cell.value instanceof Date)) cell.numFmt = column[2];
        if (typeof cell.value === 'string') {
          const width = Math.max(10, (column[1] || 23) - 4);
          const count = cell.value.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0);
          lines = Math.max(lines, count);
        }
      });
      row.height = Math.min(120, Math.max(21, 13 * lines + 7));
    });
    if (!rows.length) {
      sheet.mergeCells(6, 1, 6, Math.min(columns.length, 4));
      sheet.getCell('A6').value = spec.empty || 'Belum ada data pada periode ini.';
      sheet.getCell('A6').font = { italic: true, color: { argb: colors.muted } };
      sheet.getCell('A6').alignment = { wrapText: true, vertical: 'middle', indent: 1 };
      sheet.getRow(6).height = 30;
    }
    return sheet;
  }

  function leadingAnswers(rows, field) {
    const answers = new Map();
    rows.forEach(({ survey }) => {
      const name = String(survey[field] || '').trim();
      if (!name || /^(belum diketahui|tidak diketahui|belum diisi)$/i.test(name)) return;
      const key = name.toLowerCase();
      const entry = answers.get(key) || { name, count: 0 };
      entry.count += 1;
      answers.set(key, entry);
    });
    const ranked = Array.from(answers.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'id'));
    const count = ranked[0]?.count ?? null;
    return [ranked.filter((entry) => entry.count === count).map((entry) => entry.name).join(', '), count];
  }

  function marketRows(surveys) {
    const groups = new Map();
    function add(city, segment, item) {
      const key = JSON.stringify([city, segment]);
      if (!groups.has(key)) groups.set(key, { city, segment, rows: [] });
      groups.get(key).rows.push(item);
    }
    surveys.forEach((item) => {
      add('Semua wilayah', 'Semua segmen', item);
      add(item.outlet.city || 'Belum tercatat', item.segment || 'Belum diklasifikasi', item);
    });
    return Array.from(groups.values()).map(({ city, segment, rows }) => {
      let stocked = 0;
      let noStock = 0;
      let unknownStock = 0;
      let validIntent = 0;
      let highIntent = 0;
      rows.forEach(({ survey }) => {
        const stock = yesNo(survey.trw_stock);
        if (stock === 'Ya') stocked += 1;
        if (stock === 'Tidak') noStock += 1;
        if (String(stock).trim().toLowerCase() === 'belum diketahui') unknownStock += 1;
        const intent = intentScore(survey.purchase_intent);
        if (intent !== null) validIntent += 1;
        if (intent >= 4) highIntent += 1;
      });
      const validStock = stocked + noStock;
      return [city, segment, rows.length, stocked, noStock, unknownStock, rows.length - validStock - unknownStock,
        validStock, validStock ? stocked / validStock : null, validIntent, highIntent, validIntent ? highIntent / validIntent : null,
        ...leadingAnswers(rows, 'competitor_brand'), ...leadingAnswers(rows, 'barrier_switching'),
        ...leadingAnswers(rows, 'preferred_sku'), ...leadingAnswers(rows, 'brand_awareness')];
    }).sort((a, b) => (a[0] === 'Semua wilayah' ? -1 : b[0] === 'Semua wilayah' ? 1 : a[0].localeCompare(b[0], 'id') || a[1].localeCompare(b[1], 'id')));
  }

  function shapeReport(data) {
    const outletMap = new Map(data.outlets.map((row) => [String(row.outlet_id), row]));
    const qualifications = groupBy(data.qualifications, 'visit_id');
    const posm = groupBy(data.posm, 'visit_id');
    const education = groupBy(data.education, 'visit_id');
    const photos = groupBy(data.evidence, 'visit_id');
    const visitsById = new Map();
    const visits = data.visits.map((visit) => {
      const key = String(visit.visit_id);
      const outlet = outletMap.get(String(visit.outlet_id)) || {};
      const qualification = mostRecent(qualifications.get(key) || [], (row) => String(row.created_at || '')) || {};
      const images = photos.get(key) || [];
      const record = {
        ...visit, outlet, qualification, qualificationStatus: qualificationStatus(qualification),
        segment: qualification.segment_final || outlet.segment_final || outlet.segment_indicative || '',
        posm: posm.get(key) || [], education: education.get(key) || [],
        front: evidenceCell(images, 'OUTLET_FRONT', 'Foto depan'),
        inside: evidenceCell(images, 'OUTLET_INSIDE', 'Foto dalam'),
        before: evidenceCell(images, 'POSM_BEFORE', 'Foto POSM sebelum'),
        after: evidenceCell(images, 'POSM_AFTER', 'Foto POSM sesudah')
      };
      visitsById.set(key, record);
      return record;
    }).sort((a, b) => b.visit_date.localeCompare(a.visit_date) || String(a.visit_id).localeCompare(String(b.visit_id)));
    const surveys = data.surveys.map((survey) => ({ ...visitsById.get(String(survey.visit_id)), survey }))
      .sort((a, b) => b.visit_date.localeCompare(a.visit_date) || String(b.survey.created_at || '').localeCompare(String(a.survey.created_at || '')));

    const surveysByOutlet = groupBy(surveys, 'outlet_id');
    const outlets = [];
    groupBy(visits, 'outlet_id').forEach((records, id) => {
      if (!id) return;
      const latest = records[0];
      const qualifiedVisit = mostRecent(records.filter((record) => record.qualification.eligible !== undefined),
        (record) => record.visit_date + (record.qualification.created_at || '')) || latest;
      const latestSurvey = (surveysByOutlet.get(id) || [])[0];
      const survey = latestSurvey?.survey || {};
      const stock = yesNo(survey.trw_stock);
      const score = intentScore(survey.purchase_intent);
      let action = '';
      if (qualifiedVisit.qualificationStatus === 'Qualified' && score >= 4 && stock === 'Tidak') {
        action = 'Konfirmasi kebutuhan SKU dan tindak lanjuti ketersediaan stok.';
      } else if (qualifiedVisit.qualificationStatus === 'Qualified' && score >= 4 && stock === 'Ya') {
        action = 'Konfirmasi SKU prioritas dan rencana restock.';
      } else if (score >= 4 && qualifiedVisit.qualificationStatus === 'Qualified') {
        action = 'Verifikasi ketersediaan stok TRW.';
      }
      outlets.push({ id, latest, qualifiedVisit, latestSurvey, count: records.length, stock, score, action });
    });
    return { visits, surveys, outlets };
  }

  async function build(data) {
    const ExcelJS = await loadExcel();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TRW Field';
    workbook.title = 'TRW Field — Laporan Survei FM';
    const period = 'Periode ' + data.from + ' s.d. ' + data.to + ' (WIB, inklusif)';
    const { visits, surveys, outlets } = shapeReport(data);
    const priorities = outlets.filter((row) => row.action);
    const market = marketRows(surveys);
    const allMarket = market[0] || [];
    const qualifiedCount = outlets.filter((row) => row.qualifiedVisit.qualificationStatus === 'Qualified').length;
    const total = data.targets;
    const summary = reportSheet(workbook, {
      name: '01 Ringkasan Program', title: 'TRW Field · Laporan Survei FM',
      subtitle: period + ' · Tanggal kunjungan sebagai dasar filter',
      columns: [['Indikator', 31], ['Realisasi periode ini', 20, integer], ['Target total program', 20, integer], ['Cara baca', 56]],
      rows: [
        ['Outlet unik dikunjungi', outlets.length, total.uniqueOutlets, 'Satu outlet dihitung sekali berdasarkan ID outlet.'],
        ['Kunjungan FM', visits.length, total.fmVisits, 'Kunjungan berulang dihitung sebagai kunjungan terpisah.'],
        ['Outlet qualified', qualifiedCount, null, 'Berdasarkan penilaian terakhir yang tersedia dalam periode.'],
        ['Respons survei FM', surveys.length, null, 'Satu baris per respons pada tab Hasil Survey Lengkap.'],
        ['Kunjungan dengan audit POSM', visits.filter((row) => row.posm.length).length, null, 'Termasuk audit tanpa perubahan POSM.'],
        ['Kunjungan dengan edukasi', visits.filter((row) => row.education.some((entry) => yesNo(entry.education_done) === 'Ya')).length, null, 'Edukasi tercatat sebagai diberikan.'],
        ['Respons dengan stok TRW', allMarket[3] || 0, null, 'Dari ' + (allMarket[7] || 0) + ' jawaban Ya atau Tidak.'],
        ['Respons dengan minat 4–5', allMarket[10] || 0, null, 'Dari ' + (allMarket[9] || 0) + ' jawaban minat yang valid.'],
        ['Outlet prioritas tindak lanjut', priorities.length, null, 'Qualified dengan minat beli 4–5 berdasarkan survei terakhir.']
      ], accent: true, filter: false
    });
    const noteRow = summary.lastRow.number + 2;
    summary.mergeCells(noteRow, 1, noteRow, 4);
    const note = summary.getCell(noteRow, 1);
    note.value = 'Tautan foto mengikuti izin berbagi Google Drive. Kolom kosong menandakan jawaban belum tercatat.';
    note.font = { italic: true, color: { argb: colors.muted } };
    note.alignment = { wrapText: true, vertical: 'middle' };
    summary.getRow(noteRow).height = 24;
    summary.mergeCells(noteRow + 1, 1, noteRow + 1, 4);
    const asOf = new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: data.timezone
    }).format(new Date(data.exported_at));
    summary.getCell(noteRow + 1, 1).value = 'Data ditarik ' + asOf + ' WIB';
    summary.getCell(noteRow + 1, 1).font = { size: 10, color: { argb: colors.muted } };

    reportSheet(workbook, {
      name: '02 Master Outlet', title: 'Master Outlet', subtitle: period + ' · Satu baris per outlet yang dikunjungi',
      freeze: 2,
      columns: [['ID outlet', 20], ['Nama outlet', 32], ['Kota', 23], ['Area', 22], ['Alamat', 42],
        ['Segmen', 22], ['Tipe outlet', 24], ['Kunjungan', 16, integer], ['Terakhir dikunjungi', 21, dateFormat],
        ['Kualifikasi', 22], ['Alasan kualifikasi', 38], ['Stok TRW', 18], ['Minat beli', 14, integer],
        ['Tanggal survei terakhir', 24, dateFormat]],
      rows: outlets.map(({ id, latest, qualifiedVisit, latestSurvey, count, stock, score }) => [
        id, latest.outlet.outlet_name, latest.outlet.city, latest.outlet.area, latest.outlet.address,
        qualifiedVisit.segment, qualifiedVisit.qualification.outlet_type || latest.outlet.type, count, excelDate(latest.visit_date),
        qualifiedVisit.qualificationStatus, qualifiedVisit.qualification.reason, stock, score, excelDate(latestSurvey?.visit_date)
      ])
    });

    reportSheet(workbook, {
      name: '03 Market Insight', title: 'Market Insight', subtitle: period + ' · Persentase dihitung dari jawaban valid',
      freeze: 2,
      columns: [['Kota', 23], ['Segmen', 23], ['Respons', 14, integer], ['Stok TRW Ya', 16, integer],
        ['Stok TRW Tidak', 18, integer], ['Stok belum diketahui', 22, integer], ['Stok kosong / lainnya', 25, integer],
        ['Jawaban stok valid', 22, integer], ['% tersedia', 16, percentage], ['Jawaban minat valid', 23, integer],
        ['Minat 4–5', 14, integer], ['% minat 4–5', 16, percentage], ['Merek pembanding terbanyak', 36], ['Respons per merek teratas', 26, integer],
        ['Hambatan terbanyak', 34], ['Respons per hambatan teratas', 25, integer],
        ['Jawaban SKU terbanyak', 36], ['Respons per jawaban SKU', 23, integer],
        ['Awareness terbanyak', 28], ['Respons per tingkat awareness', 26, integer]],
      rows: market
    });

    const visitColumns = [['Tanggal kunjungan', 22, dateFormat], ['Nama outlet', 31], ['ID kunjungan', 23],
      ['ID outlet', 20], ['Kota', 22], ['Area', 22], ['Tipe kunjungan', 20]];
    const visitCells = (row) => [excelDate(row.visit_date), row.outlet.outlet_name, row.visit_id,
      row.outlet_id, row.outlet.city, row.outlet.area, row.visit_type];
    const evidenceColumns = [['Foto depan', 22], ['Foto dalam', 22], ['Foto POSM sebelum', 24], ['Foto POSM sesudah', 24]];
    const evidenceCells = (row) => [row.front, row.inside, row.before, row.after];
    reportSheet(workbook, {
      name: '04 Kunjungan dan Bukti', title: 'Kunjungan dan Bukti', subtitle: period + ' · Tautan foto mengikuti izin Drive',
      freeze: 3,
      columns: [...visitColumns, ['Status kunjungan', 20], ['Kualifikasi', 22], ['Tindakan POSM', 26],
        ['Edukasi diberikan', 19], ...evidenceColumns],
      rows: visits.map((row) => [...visitCells(row), row.status, row.qualificationStatus, collect(row.posm, 'action'),
        collect(row.education, 'education_done', yesNo), ...evidenceCells(row)])
    });

    reportSheet(workbook, {
      name: '05 Prioritas Tindak Lanjut', title: 'Prioritas Tindak Lanjut', subtitle: period + ' · Outlet qualified dengan minat 4–5',
      freeze: 2,
      columns: [['ID outlet', 20], ['Nama outlet', 32], ['Kota', 22], ['Kualifikasi', 22], ['Minat beli', 16, integer],
        ['Stok TRW', 19], ['SKU pilihan', 36], ['Tindak lanjut yang disarankan', 50], ['Penanggung jawab', 23],
        ['Tenggat', 18, dateFormat], ['Status tindak lanjut', 23]],
      rows: priorities.map(({ id, latest, qualifiedVisit, latestSurvey, stock, score, action }) => [
        id, latest.outlet.outlet_name, latest.outlet.city, qualifiedVisit.qualificationStatus, score, stock,
        latestSurvey.survey.preferred_sku, action, null, null, null
      ]),
      empty: 'Belum ada outlet yang memenuhi kriteria prioritas pada periode ini.'
    });

    const groups = [
      ['Kunjungan', [...visitColumns, ['ID survei', 23], ['Status kunjungan', 20]]],
      ['Kualifikasi outlet', [['Segmen', 22], ['Tipe outlet', 23], ['Status kualifikasi', 22], ['Alasan kualifikasi', 44],
        ['Bukti kualifikasi lengkap', 25], ['Active bay', 15, integer], ['Stok kategori terverifikasi', 26],
        ['Jumlah merek', 17, integer], ['Jumlah SKU', 16, integer], ['Pembelian 6 bulan', 25], ['Bersedia diedukasi', 23],
        ['Rentang SKU', 39], ['Frekuensi beli', 23], ['TRW di rak', 20], ['Merek stok aktif', 33],
        ['Volume pengambilan per merek', 42], ['Merek paling laku', 24], ['Porsi merek paling laku', 26],
        ['Kategori rem dibeli', 32], ['Stok TRW saat kualifikasi', 26]]],
      ['POSM', [['Jenis POSM', 22], ['Titik POSM', 23], ['Kondisi sebelum', 24], ['Tindakan POSM', 24],
        ['Kondisi sesudah', 24], ['Persetujuan POSM', 23], ['Izin pemasangan POSM', 25]]],
      ['Edukasi', [['Edukasi diberikan', 23], ['Jenis edukasi', 24], ['Materi edukasi', 40], ['Promo dijelaskan', 22], ['Edukasi terverifikasi', 24]]],
      ['Market Insight', [['Merek kompetitor yang digunakan', 38], ['Volume sekarang', 30], ['Stok TRW', 19],
        ['Harga TRW (Rp)', 22, currency], ['Merek pembanding utama', 28], ['Harga kompetitor (Rp)', 24, currency],
        ['Harga netto & program kompetitor', 44], ['Kategori kompetitor', 35], ['Program TRW', 36], ['Sumber pembelian TRW', 26],
        ['Minat beli 1–5', 18, integer], ['Hambatan berpindah', 36], ['Alasan hambatan', 40],
        ['Frekuensi restock', 23], ['SKU pilihan', 33], ['Awareness TRW', 22], ['Persepsi kualitas', 24], ['Persepsi harga', 24],
        ['Kebutuhan belum terpenuhi', 52], ['Insight & rekomendasi', 54]]],
      ['Bukti', evidenceColumns]
    ];
    reportSheet(workbook, {
      name: '06 Hasil Survey Lengkap', title: 'Hasil Survey Lengkap', subtitle: period + ' · Satu baris per respons survei FM',
      freeze: 3, groups, columns: groups.flatMap(([, columns]) => columns),
      rows: surveys.map((row) => {
        const q = row.qualification;
        const s = row.survey;
        return [...visitCells(row), s.survey_id, row.status, row.segment, q.outlet_type || row.outlet.type,
          row.qualificationStatus, q.reason, yesNo(q.evidence_ok), numeric(q.active_bays), yesNo(q.brake_steering_stock_confirmed),
          numeric(q.brand_count), numeric(q.sku_count), q.purchase_history_signal, yesNo(q.owner_engagement),
          q.sku_range, q.purchase_frequency, yesNo(q.trw_shelf_presence), q.brake_brands_stocked, q.brand_monthly_volume,
          q.fastest_moving_brand, q.fastest_moving_pct, q.brake_categories, yesNo(q.trw_in_stock),
          collect(row.posm, 'posm_type'), collect(row.posm, 'posm_location_type'), collect(row.posm, 'condition_before'),
          collect(row.posm, 'action'), collect(row.posm, 'condition_after'), collect(row.posm, 'owner_approval', yesNo),
          collect(row.posm, 'posm_allowed', yesNo), collect(row.education, 'education_done', yesNo),
          collect(row.education, 'education_type'), collect(row.education, 'product_knowledge'),
          collect(row.education, 'promotion_explained', yesNo), collect(row.education, 'verified', yesNo),
          s.current_brand, s.current_volume, yesNo(s.trw_stock), numeric(s.trw_price), s.competitor_brand,
          numeric(s.competitor_price), s.competitor_net_program, s.competitor_categories, s.trw_campaign_program,
          s.trw_purchase_source, intentScore(s.purchase_intent), s.barrier_switching, s.barrier_reason,
          s.restock_frequency, s.preferred_sku, s.brand_awareness, s.quality_perception, s.price_perception, s.unmet_demand, s.insight,
          ...evidenceCells(row)];
      }),
      empty: 'Tidak ada respons survei FM pada periode ini.'
    });
    return new Blob([await workbook.xlsx.writeBuffer()], { type: fileType });
  }

  window.TRWClientReport = { build };
})();
