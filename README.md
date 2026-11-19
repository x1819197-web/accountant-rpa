# Buxgalter RPA (ishchi nom)

Bitta buxgalter uchun Windows desktop RPA platformasi: jarayon bir marta yozib olinadi va
tanlangan fermalar uchun ketma-ket avtomatik ijro etiladi. Texnik asos — `moliyaviy-yordam`
loyihasida sinalgan E-IMZO va Didox brauzer avtomatizatsiyasi.

## Onlayn namoyish

To'liq interfeys brauzerda ochiladi: **https://x1819197-web.github.io/accountant-rpa/**

Bu GitHub Pages nusxasi — `VITE_DEMO=1` bilan yig'ilgan. U API'siz ishlaydi: ma'lumotlar
brauzer xotirasida, runlar real vaqt bilan simulyatsiya qilinadi (Toshkent vaqti bo'yicha).
Master parol talab qilinmaydi. Haqiqiy E-IMZO, .pfx va Didox/1C bilan ishlash faqat
buxgalterning Windows kompyuterida ishlaydigan desktop versiyada bo'ladi — kalitlar tarmoqqa
chiqmaydi (BR-03, BR-08).

Ish jarayoni videosi (83 s): **https://x1819197-web.github.io/accountant-rpa/buxgalter-rpa-demo.mp4**
— yangi run yaratish, BR-03 tasdiqlash, real vaqtda ijro, scenariy tahrirlash, hisobot va jurnal.

Namoyishni lokal yig'ish:

```bash
npm run build:demo -w web
npx vite preview --mode demo -w web --port 4173   # http://localhost:4173/accountant-rpa/
```

## Vaqt va ko'rsatkichlar

Barcha sana/vaqtlar **Toshkent (UTC+5)** bo'yicha ko'rsatiladi va kun chegaralari shu mintaqa
bo'yicha hisoblanadi: bosh sahifa, runlar jadvali, jurnal, hisobotlar va Excel eksporti.
Bazada vaqtlar UTC ISO ko'rinishida saqlanadi. Ko'rsatkichlar (bugungi runlar, 7 kunlik
grafik, muvaffaqiyat foizi, tejalgan vaqt) run jurnalidan real vaqtda hisoblanadi; yangi run
boshlanganda SSE oqimi orqali sahifa qayta so'rovsiz yangilanadi.

## Ishga tushirish

Talab: Node 24+.

```bash
npm install
npm run dev        # api :3100, web :5173
npm run seed       # demo ma'lumot (12 ferma, scenariolar, 7 kunlik tarix)
```

Birinchi kirishda master parol o'rnatiladi (ekranda ko'rsatiladi).

- API: http://localhost:3100/api
- Web: http://localhost:5173

## Desktop robot (Electron)

Robot — bu alohida desktop ilova. U navbatdan bitta ferma vazifasini oladi, brauzer oynasida
qadamlarni bajaradi va holatni API'ga real vaqtda qaytaradi. E-IMZO kaliti, .pfx va parollar
faqat shu kompyuterda qoladi.

```bash
npm run dev:desktop      # main procesni yig'ib, Electron oynasini ochadi
npm run build:desktop    # faqat TypeScript main procesni yig'adi
```

Ulanish:

1. Web → **Sozlamalar → Desktop robot tokeni → Tokenni ko'rsatish** (180 kunlik token).
2. Desktop ilovada API manzilini (`http://localhost:3100`) va tokenni kiriting → **Saqlash va tekshirish**.
3. **Ishga tushirish** — robot navbatni kuzatishni boshlaydi. Token nusxasi
   `%APPDATA%\desktop\robot-config.json` faylida saqlanadi.

Yozib olish (scenario yaratish):

1. **Yozib olish** kartasida platforma va boshlang'ich URL ni tanlang.
2. **Oynani ochish va yozish** → amallarni bir marta o'zingiz bajaring (bosish, to'ldirish, tanlash).
3. **Yozishni yakunlash** → qadamlar ro'yxati chiqadi; parol/ERI paroli **maxfiy qadam** bo'lib
   qoladi, qiymati faylga yozilmaydi.
4. **Mavjud scenarioga** (yangi versiya) yoki **Yangi scenario** sifatida saqlang.
5. Web'da dry run qiling (bitta ferma), keyin live rejimga o'ting.

Scenariolarni boshqarish: kartadagi qalamcha bilan **nom / papka / tavsif** o'zgartiriladi (FR-15).
Tarixga ega scenario o'chirilmaydi (409 `SCENARIO_IN_USE`) — uni arxivlash kerak, run tarixi saqlanadi.

### Qadam turlari

| Qadam | Vazifa |
| --- | --- |
| `navigate` | URL ochish (ferma manzili uchun `{{farm.oneCUrl}}`, `{{farm.tin}}`) |
| `click` | Bosish; `irreversible` belgisi imzo/tasdiq tugmalari uchun |
| `fill` | Matn kiritish; yashirin maydonlar shifrlangan ombordan olinadi |
| `select` | Ro'yxatdan tanlash |
| `check` | Kutilgan matn/qiymatni tekshirish |
| `sign` | E-IMZO kaliti bilan imzolash (faqat tasdiqdan keyin) |
| `extract` | Sahifadan qiymat o'qib, o'zgaruvchiga yozish (FR-22) |
| `wait` | Belgilangan vaqt kutish |

**Qiymat olish → qayta ishlatish (FR-22).** `extract` qadami sahifadagi matn, maydon qiymati yoki
havolani o'qiydi va `{{nom}}` o'zgaruvchisiga yozadi. Keyingi qadamlarda (fill, check, navigate)
`{{nom}}` avtomatik almashtiriladi — masalan, yaratilgan hujjat raqamini 1C ga ko'chirish.

## Ishonchlilik sozlamalari

`Sozlamalar → Ishonchlilik`:

- **Xatoda butun runni to'xtatish** (BR-07) — bitta fermada xato bo'lsa, qolgan fermalar
  ishga tushmaydi va run `paused` holatiga o'tadi (buxgalter qo'lda davom ettiradi).
- **Fermalar orasidagi pauza** (FR-27, 0–600 s) — server keyingi ferma ishini shu vaqt
  o'tmaguncha bermaydi (`state: 'waiting'`, `retryInMs`), real saytlarga ketma-ket yuklama bo'lmaydi.

**Qo'lda tasdiqlash (FR-31).** Scenario `irreversible` yoki tasdiq talab qiladigan qadamga yetsa,
robot to'xtaydi, desktop oyna oldinga chiqadi, ovozli signal va miltillash beradi; xabar
o'chirilmaguncha davom etmaydi. Shu bilan captcha/xavfsizlik tekshiruvi ham buxgalter qo'lida hal
bo'ladi — captcha avtomatik yechilmaydi.

**Imzodan keyingi noaniqlik (NFR-09).** Live rejimda imzo yoki qaytarilmas amaldan keyin xato
bo'lsa, robot `POST_SIGN_UNCLEAR` qaytaradi va run har doim `paused` bo'ladi — buxgalter holatni
tekshirib davom ettiradi. Qaytarilmas qadamlar audit jurnaliga yoziladi (FR-35).

Demo sahifa: `http://localhost:3100/demo/didox.html` — E-IMZO modal, hujjat formasi va
`?captcha=1` bilan qo'lda tasdiqlash sinovi. Demo sahifa faqat lokal sinov uchun, real Didox emas.

Real muhitda (foydalanuvchining shaxsiy Windows kompyuterida) kerak bo'ladi: E-IMZO moduli,
`.pfx` kalit, Didox login/parol va 1C manzili. Bu kompyuterda ular yo'q — shu sabab barcha
sinovlar lokal demo sahifada bajarilgan.

## Ma'lumot

Barcha ma'lumot `data/` ichida: `app.db` (SQLite), `screenshots/`, `exports/`.
Maxfiy maydonlar AES-256-GCM bilan shifrlanadi; kalit master paroldan scrypt bilan olinadi
va faqat sessiya xotirasida turadi.

## Real va simulyatsiya

- `Sozlamalar → Ijro rejimi` = `desktop` — jarayonni Electron robot bajaradi (E-IMZO, Didox, 1C).
- `simulated` — demos va UI tekshiruvi uchun; har ferma bo'yicha haqiqiy vaqt bilan holat oqimi.

## Loyiha tuzilishi

- `apps/api` — Express + SQLite API, run hayot sikli, robot job API, demo sahifa.
- `apps/web` — React panel: fermalar, scenariolar, dry run/live, tasdiqlash, hisobotlar.
- `apps/desktop` — Electron robot: navbat, brauzer ijrosi, recorder, E-IMZO oynasi.
