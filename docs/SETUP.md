# Panduan instalasi lengkap TRW Route to Preference

Aplikasi terdiri dari dua bagian: Apps Script untuk data/API dan GitHub Pages untuk frontend. Jalur manual berikut mempertahankan default project tanpa Cloud Console atau billing.

## Urutan paling singkat

1. Buat Sheet → Extensions → Apps Script → paste folder backend.
2. Run setup().
3. Isi Script Properties ADMIN_PIN (8–12 digit) → run createAdminAccount().
4. Deploy Web App: Me / Anyone → salin URL /exec.
5. GitHub variable GAS_EXEC_URL → Pages Source GitHub Actions → push main.
6. Login admin → isi master/training → generate schedule → installTriggers().
7. Uji offline, voucher, dan WhatsApp pada nomor sendiri sebelum live.

## 1. Buat database dan backend

1. Buat Google Spreadsheet kosong: TRW Route to Preference — Pilot.
2. Sheet → Extensions → Apps Script. Rename project menjadi TRW Route to Preference Backend.
3. Buat semua file .gs pada folder backend/ dengan nama yang sama; paste isi masing-masing secara utuh. Hapus myFunction bawaan. Jangan menempel ulang ke source versi lama.
4. Project Settings → Show appsscript.json. Ganti manifest dengan backend/appsscript.json.
5. Timezone Asia/Jakarta, V8. Biarkan project GCP default; jangan ubah nomor project atau enable advanced services.
6. Run setup(). Authorize sebagai owner. Sheet, header, validation, README, Config dan folder TRW_Pilot dibuat otomatis. setup() idempotent, tidak menghapus data.
7. Project Settings → Script Properties → ADMIN_PIN: PIN pribadi8–12digit.
8. Run createAdminAccount(). Username awal admin, PIN sesuai ADMIN_PIN. Sesudah bootstrap property ADMIN_PIN boleh dihapus. AUTH_PEPPER jangan dihapus: seluruh hash PIN bergantung padanya.
9. setup() membuat SPREADSHEET_ID, DRIVE_ROOT_ID, AUTH_PEPPER, WEBHOOK_SECRET secara otomatis. Script standalone dapat memakai SPREADSHEET_ID yang diisi lebih dahulu; jika kosong setup membuat Sheet baru.

Spreadsheet operasional dan folder Drive tetap privat. Jangan share file database ke field staff atau client. Semua akses melalui API/RBAC. Protection sheet bukan kerahasiaan antar editor.

## 2. Opsional: database demo

Gunakan Sheet berbeda dari live.

1. Isi Script Properties DEMO_MODE=true dan DEMO_PIN 8–12 digit.
2. Run seedDemoData(). Run ulang tidak menggandakan data.
3. Login spg1…spg5, fm1…fm5, supervisor, client memakai DEMO_PIN. Admin tetap memakai ADMIN_PIN awal.
4. Seed20 outlet,20 customer sintetis seluruhnya opt-out,3 templates, readiness dan assignment contoh. Nomor seed tidak boleh dikirimi WA. Tetap gunakan wa_link.
5. Demo training bukan approved product knowledge TRW. Ganti sebelum live; version baru memerlukan quiz dan praktik ulang.
6. Rotasi16 minggu memerlukan80 workshop unik. Roster5 FM tanpa primary duplicates memerlukan31 outlet;20seed cukup untuk maksimum3FM saat generate, sementara5assignment demo sudah disediakan.
7. Pada live set DEMO_MODE=false, hapus DEMO_PIN. Jangan seed database live.

Error “PIN harus8–12digit” berarti property ADMIN_PIN/DEMO_PIN belum diisi dengan benar. Bukan Config Sheet dan bukan source code.

## 3. Deploy Web App

1. Deploy → New deployment → gear → Web app.
2. Execute as: Me (owner).
3. Who has access: Anyone, termasuk tanpa Google login.
4. Deploy dan authorize owner.
5. Salin URL yang berakhir /exec. Contoh: https://script.google.com/macros/s/DEPLOYMENT_ID/exec
6. Buka incognito: hasil JSON ok:true, statushealthy, timezoneAsia/Jakarta.
7. Jika akses Anyone tidak tersedia, periksa kebijakan Workspace dengan admin organisasi. Jangan mengubah project GCP.

ContentService melakukan302redirect ke script.googleusercontent.com. Browser harus bisa mengakses domain tersebut dan script.google.com. Fetch menggunakan POST text/plain;charset=utf-8, credentials:omit, redirect:follow. Jangan tambahkan Authorization/custom header/application-json/no-cors/JSONP.

## 4. Upload source ke GitHub dan aktifkan Pages

1. Extract ZIP. Semua isi folder trw-route-to-preference ditempatkan di root repository.
2. Upload frontend, backend, docs, tests, scripts, package.json, package-lock.json, vite.config.js, dan .github/workflows/deploy.yml. Jangan upload node_modules, .env.local atau clasp credentials.
3. Gunakan branch main.
4. Settings → Secrets and variables → Actions → Variables → New repository variable:
   - Name: GAS_EXEC_URL
   - Value: URL /exec backend Anda.
5. URL backend bukan secret. Token WA, PIN dan pepper tidak masuk GitHub.
6. Settings → Pages → Build and deployment → Source: GitHub Actions.
7. Actions → Deploy TRW PWA to GitHub Pages → Run workflow, atau pushmain.
8. Tunggu build/deploy hijau. Settings → Pages menampilkan URL https://USERNAME.github.io/REPO/.
9. Base path project otomatis. Repo USERNAME.github.io memakai /. Untuk customdomain sesuaikan PAGES_BASE=/ dan CNAME pada workflow.
10. Buka URL live dan loginadmin.

~~~bash
git init
git add .
git commit -m "Build TRW Route to Preference"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
~~~

Tidak ada deployment ke akun Anda sampai proses autentikasi dan langkah di atas dilakukan.

## 5. Jalankan lokal

Install Node22.12+.

~~~bash
npm ci
cp .env.example .env.local
# Ganti VITE_GAS_URL dengan URL /exec Anda
npm run dev -- --host 127.0.0.1
npm run check
npm test
npm run build
npm run preview -- --host 127.0.0.1
~~~

Service worker aktif pada production build. Buka preview lalu reload setelah worker aktif untuk testoffline. ?demo=1#today adalah preview hanya-baca tanpa backend.

## 6. Master, readiness, jadwal

1. Admin → User: username, nama, role, area, PIN berbeda. client_viewer adalah penerima TRW/authorizedpartner bernama.
2. Admin → Outlet: physicalkey unik untuk satu lokasi fisik, koordinat aktual, address, workshopflag, bookinglinkHTTPS. Jangan deduplikasi hanya berdasarkan nama.
3. ImportJSON dapat digunakan untuk80outlet.
4. Admin → Approved training: minimal5questions dengan question,options[],correct(index0). Approve setelah brand menyetujui.
5. SPG/FM → quiz ≥80%; supervisor → practicalpass.
6. Config option_spg/option_fm dapat dipilih independen.
7. GenerateSPG:5 staf ready, tanggal Senin, tepat80 workshop.16 minggu ×5assignment,20 workshop baru per 4 minggu, tidak ada duplicate global.
8. GenerateFM harian:6 primer + 1 nearby backup; clusteringnearestneighbour, primer tidak berulang antar staf hari itu. Backup boleh berbagi dengan roster tim lain.
9. Supervisor rebookmissed mingguan ke tanggal dengan slot, maksimum6primer.
10. Default 5 field days/week ×16 =80 days. Target 2.400 tetap. working_days/holidays mengatur SLAworkingday.

## 7. Loyalty & WhatsApp

Default Config.wa_provider="wa_link". Supervisor/admin → voucher.send → MessageLog → BukaWA → klik link → kirim dariWhatsApp → centang sudahdikirim. Link tidak membuktikan delivered.

Fonnte:
1. Hubungkan gateway device sesuai dokumentasi/plan provider.
2. Script Properties FONNTE_TOKEN. Jangan taruh diConfig atauGitHub.
3. Config wa_provider="fonnte".
4. Incoming/status webhook: GAS_EXEC_URL?webhook=fonnte&secret=WEBHOOK_SECRET (nilai secret dariScript Properties).
5. Provider harus follow 302 dan mempertahankanquerysecret. Testnomor sendiri +STOP +delivery.
6. Fieldid/state/status mengikuti dokumentasi provider; statusunknown tidak diklaimdelivered.

MetaCloud outbound:
1. SiapkanMetaWABA/phone, approvedtemplates voucher_issued,service_reminder,win_back.
2. Properties META_ACCESS_TOKEN,META_PHONE_NUMBER_ID.
3. Config wa_provider="meta_cloud", meta_graph_version, meta_language, templatenames, meta_variable_order sesuai urutan approvedplaceholder(default8).
4. Tidak membutuhkan GoogleCloud; biaya/rulesMeta tetap berlaku.
5. DirectMetawebhook belum didukung aman dengan doGethealth-only dan signatureheader yang tidak tersediaGAS. Metaoutbound tersedia; delivered belum terverifikasi dan STOPditanganiadmin dariinboxresmi. GunakanFonnte bila STOPotomatis wajib. Jangan menerima callback Meta tanpa verifikasi.

## 8. Trigger dan end-to-end test

1. Run installTriggers() sebagaiowner. Dua trigger: runDailyReminders sekitar09.00WIB, runBackgroundJobs setiap15menit untuk continuation/outbox/retry/campaign.
2. TriggerGoogle aproksimasi;quiet hours dicek ketika dispatch:08.00≤waktu<19.00WIB.
3. Daftarkan customer dengan nomorWhatsAppsendiri, platvalid, lastservice date sehingga dueT-14. Centangoptin secaraeksplisit.
4. Run runDailyReminders(), kemudian runBackgroundJobs(). wa_link menjadi manual_pending.
5. Alternatif: Loyalty → Testnomor sendiri → confirmownership. Customer testplateB9999TST dibuat beserta consent.
6. Issuevoucher → approveclient/admin → send → WA → redeemtransactionref → redeemulang harusALREADY_REDEEMED.
7. STOPmelaluiFonnte atauadmin toggle harusmembatalkan queued/retry/manualpending.
8. Recordverifiedreturnvisit sebagai supervisor/admin: cyclereset dan pointsvisit. Purchasepoints hanya client_viewer denganreftransaksi.
9. Campaign → audienceJSON → dryrun → scheduled → runbatch. Pause/resume tersedia. Consent,caps,quiet hours berlaku.
10. Servis default6bulan perjenis; opsional projected_km_per_day +service_odometer_intervals menghasilkanestimasi due yang lebihawal. Tanpa telemetry, ini estimasi, bukan jarakaktual.

## 9. Redeploy GAS tanpa ganti URL

1. Edit source pada project yangsama.
2. Deploy → Managedeployments → pilihWebAppaktif → pensil.
3. Version → New version → Deploy.
4. DeploymentID dan URL /exec tetap. Jangan Newdeployment untukupdate biasa.
5. Ujihealth/login/write. Rollback dengan memilihversilama diManage.
6. Frontend:pushmain. Serviceworker baru menunggu appversilama ditutup; hindari reload sebelumdraft tersimpan.

## 10. Troubleshooting

| Gejala | Perbaikan |
|---|---|
| CONFIG_REQUIRED | IsiGAS_EXEC_URL dan workflowulang;lokal isi.env.local lalu restartbuild. |
| HTML/signinwall | Pastikan/exec,run as Me,Anyone,New version,incognito,Workspace policy. |
| NETWORK/CORS | GunakanfetchsimplePOST;uji domainredirect live. no-cors tidakbisa membacaJSON. |
| NOT_READY | Lulussemuaactivetrainingversion+praktik. |
| EVIDENCE_REQUIRED | POSM,planogram,stock,before/after atauexceptionphoto. |
| AUTH_EXPIRED | Loginulangakunsama;antreantetap. |
| BUSY | RetryrequestId yangsama;locksedangdipakai. |
| CONFLICT | Reviewassignment/record; jangan duplikasi data dengan requestIdbaru. |
| QUIET_HOURS/FREQUENCY_CAP | Tunggusendwindow/cap; optin bukan jalan pintas. |
| unknown message | Cekproviderhistory; retryotomatis dinonaktifkan untuk menghindaridoublesend. |

## Clasp opsional

Jalur manual sudahcukup. Bila AppsScriptAPI/clasp telahtersedia diorganisasi: npm i -g @google/clasp; clasp login; clasp clone SCRIPT_ID --rootDir backend; clasp push; clasp deploy --deploymentId EXISTING_ID. Jangan membuat standardGCP/OAuthcustom untukopsiini. Jangan commit.clasp.json ataucredential. Jika aksesAPIclasp dibatasi,pakai editormanual.
