# Security model

Session token UUID acak berlaku 12 jam; token hash disimpan di Sessions. Cache maksimal enam jam, tetapi Sheet tetap memeriksa expiry/revocation. Pengguna aktif dan role aktual dibaca server setiap request. PIN 8–12 digit menggunakan salted SHA-256 dan AUTH_PEPPER pada Script Properties. Login dibatasi delapan percobaan per username per 15 menit.

Seluruh write menggunakan ScriptLock dan journal yang dapat diputar ulang. Server memvalidasi enum, panjang, tipe, range, ownership, metadata, dan dependency evidence. Range reads/writes dibatch. Formula injection dan CSV formula escaped. Frontend meng-escape data; ikon/SVG statis, tanpa HTML pihak ketiga atau CDN.

Token hanya pada JSON body, tidak di query. CORS bukan authentication. Raw spreadsheet/folder privat: sheet protection membatasi edit, tidak merahasiakan isi dari editor. Client memperoleh aggregate dashboard, lead summaries yang ditugaskan, serta voucher approval tanpa customer/contact/code.

Field staff dapat mencatat PII tetapi retrieval registry dimasking dan dibatasi ownership. LeadContacts hanya supervisor/admin. Private photo dapat dibaca lewat photo.read dengan role/ownership checks.

Consent menyimpan opt-in, timestamp, source, actor, text version, evidence. STOP menormalisasi nomor dan mencabut izin semua kendaraan terkait. Dispatch lock memeriksa ulang consent tepat sebelum provider call. Provider delivery dan manual link yang sudah dibuka tidak dapat ditarik.

Fonnte callback memakai high entropy query secret/TLS, hanya pada provider dashboard. GAS tidak menyediakan header HMAC verification; Meta callback tanpa signature ditolak. Secrets tidak masuk Config, frontend, atau GitHub. Quiet hours, caps, approval, eligibility, expiry, dan single-use diperiksa server. Invalid voucher attempts tetap menambah durable rate counter.

Customer export/erase admin-only. Linked logs dan request responses direduksi, registry dan matched LeadContacts dihapus; arsip/trash/export eksternal perlu prosedur owner. Atur retention dan jalankan archiveMonthly(). Arsip tidak sama dengan pemusnahan.

PIN di test fixture sintetis. Production tidak mempunyai kredensial bawaan. Gunakan PIN berbeda, editor database terbatas, HTTPS, dan perangkat yang terkunci.
