# مستند جامع و مو به موی سرویس کوتاه‌کننده لینک (ShortURL Core)
## تشریح ساختار کد، معماری فنی، نحوه کارکرد الگوریتم Base64 و ساخت گام‌به‌گام

---

## فهرست مطالب
1. [معرفی کلی و معماری سیستم](#۱-معرفی-کلی-و-معماری-سیستم)
2. [تحلیل فنی: چرا Base64 مستقیم کافی نیست و چرا هشینگ لازم است؟](#۲-تحلیل-فنی-چرا-base64-مستقیم-کافی-نیست-و-چرا-هشینگ-لازم-است)
3. [الگوریتم تولید کد کوتاه (SHA-256 + برش ۶ بایت + Base64URL)](#۳-الگوریتم-تولید-کد-کوتاه-sha-256--برش-۶-بایت--base64url)
4. [مکانیسم رفع تداخل هش‌ها (Collision Resolution)](#۴-مکانیسم-رفع-تداخل-هشها-collision-resolution)
5. [طراحی و پیاده‌سازی مخزن کلید-مقدار (Key-Value Store)](#۵-طراحی-و-پیادهسازی-مخزن-کلید-مقدار-key-value-store)
6. [تشریح مو به موی کدهای پروژه (Line-by-Line Walkthrough)](#۶-تشریح-مو-به-موی-کدهای-پروژه-line-by-line-walkthrough)
   - [الف. ماژول هشینگ و اعتبارسنجی (`src/hasher.js`)](#الف-ماژول-هشینگ-و-اعتبارسنجی-srchasherjs)
   - [ب. ماژول مخزن کلید-مقدار پایدار (`src/kvStore.js`)](#ب-ماژول-مخزن-کلید-مقدار-پایدار-srckvstorejs)
   - [ج. ماژول وب‌سرور، API و ریدایرکت (`src/server.js`)](#ج-ماژول-وبسرور-api-و-ریدایرکت-srcserverjs)
   - [د. ماژول اصلی و کتابخانه‌ای (`src/index.js`)](#د-ماژول-اصلی-و-کتابخانهای-srcindexjs)
7. [مستندات کامل API (درخواست و پاسخ‌ها)](#۷-مستندات-کامل-api-درخواست-و-پاسخها)
8. [نحوه استفاده برنامه‌نویسی (Programmatic Usage)](#۸-نحوه-استفاده-برنامهنویسی-programmatic-usage)
9. [تست‌های خودکار و تضمین کیفیت (`test/shortener.test.js`)](#۹-تستهای-خودکار-و-تضمین-کیفیت-testshortenertestjs)
10. [راهنمای اجرا و فراخوانی با cURL](#۱۰-راهنمای-اجرا-و-فراخوانی-با-curl)

---

## ۱. معرفی کلی و معماری سیستم

این پروژه یک موتور خالص و مستقل (Zero-Dependency) برای کوتاه‌سازی آدرس‌های وب با تکیه بر قابلیت‌های توکار **Node.js (v18+)** است. در این سیستم هیچ وابستگی یا پکیج خارجی (`node_modules`) وجود ندارد و تمام پردازش‌ها با بالاترین سرعت و بهره‌وری حافظه اجرا می‌شوند.

### ارکان اصلی سیستم:
1. **موتور هشینگ و Base64URL (`src/hasher.js`)**: تبدیل آدرس با هر طولی به رشته‌های فشرده و استاندارد ۸ کاراکتری امن برای وب.
2. **مخزن کلید-مقدار (`src/kvStore.js`)**: ساختار درون‌حافظه‌ای با دسترسی زمان ثابت $O(1)$ و نگاشت پایدار در دیسک سخت (`data/store.json`) به شیوه اتمیک (Atomic File Write).
3. **سرور HTTP و ریدایرکت ۳۰۲ (`src/server.js`)**: پذیرش درخواست‌های RESTful و هدایت کاربران به لینک مقصد.
4. **سرویس ماژولار (`src/index.js`)**: فراهم‌سازی امکان استفاده مستقیم در قالب یک پکیج یا کتابخانه کدی بدون نیاز به اجرای سرور HTTP.

### دیاگرام تعاملی ساختار کد و جریان پردازش:

```mermaid
flowchart TD
    A[ورودی: آدرس طولانی Long URL] --> B[اعتبارسنجی و نرمال‌سازی URL]
    B --> C{آیا قبلاً ثبت شده؟}
    C -- بله --> D[بازگردانی کد کوتاه قبلی از ایندکس معکوس]
    C -- خیر --> E[محاسبه هش رمزی SHA-256]
    E --> F[برش ۶ بایت اولیه = ۴۸ بیت]
    F --> G[انکودینگ Base64URL بدون پدینگ = ۸ کاراکتر]
    G --> H{آیا کلید در KV وجود دارد؟}
    H -- تداخل Collision --> I[افزودن Salt به هش و تکرار]
    I --> E
    H -- آزاد --> J[ذخیره در Key-Value Store]
    J --> K[کش در RAM O(1)]
    J --> L[پایداری اتمیک در data/store.json]
    K --> M[خروجی: کد کوتاه و لینک ریدایرکت]
```

---

## ۲. تحلیل فنی: چرا Base64 مستقیم کافی نیست و چرا هشینگ لازم است؟

یک فرض غلط در میان برخی توسعه‌دهندگان این است که می‌توان رشته URL را مستقیماً با Base64 کوتاه کرد. در ادامه دلیل غیرممکن بودن این کار را از نظر ریاضی و معماری بررسی می‌کنیم:

### فرمول طول خروجی Base64:
انکودینگ Base64 یک الگوریتم فشرده‌ساز نیست؛ بلکه یک کدگذار ۲۴ بیت دودویی به ۳۲ بیت متنی (هر ۶ بیت یک کاراکتر ASCII) است:
$$\text{Length}_{\text{Base64}} = 4 \times \left\lceil \frac{N}{3} \right\rceil \approx \frac{4}{3} \times N \approx 1.33 \times N$$

- اگر طول یک URL معادل **۱۲۰ کاراکتر** باشد، اعمال مستقیم Base64 طول آن را به **۱۶۰ کاراکتر** می‌رساند (۳۳٪ افزایش حجم!).
- علاوه بر آن، آدرس‌های طولانی با صدها پارامتر کوئری، در صورت Base64 شدن حتی طولانی‌تر و غیرقابل خواندن می‌شوند.

### نقش کلیدی تابع هش (Cryptographic Hashing):
1. **طول ثابت (Fixed-Length Digest)**: توابع درهم‌ساز رمزی مانند **SHA-256** هر رشته متنی را (خواه ۱۰ بایت باشد، خواه ۱۰ مگابایت) به خروجی با طول ثابت **۲۵۶ بیت (۳۲ بایت)** تبدیل می‌کنند.
2. **پخشندگی آنتروپی (Avalanche Effect)**: حتی با جابجا شدن یک کاراکتر در URL، خروجی بایت‌های هش کاملاً تغییر می‌کند که برای جلوگیری از ایجاد الگوهای تکراری حیاتی است.
3. اکنون با بایت‌های یکنواخت و فشرده سر و کار داریم که می‌توان آن‌ها را به شکل بهینه Base64 کرد.

---

## ۳. الگوریتم تولید کد کوتاه (SHA-256 + برش ۶ بایت + Base64URL)

برای داشتن یک شناسه کوتاه، نیازی به مصرف تمام ۳۲ بایت هش نیست:

1. **برش ۶ بایت (48-bit Slicing)**:
   ما ۶ بایت اولیه از ۳۲ بایت خروجی SHA-256 را استخراج می‌کنیم.
2. **فضای حالات ممکن (Key Space)**:
   $$64^8 = 2^{48} = 281,474,976,710,656 \text{ کد یکتا}$$
   با انتخاب ۶ بایت، بیش از **۲۸۱ تریلیون** کلید متمایز قابل تولید است که نیاز پروژه‌های عظیم در مقیاس اینترنت را پاسخ می‌دهد.
3. **استاندارد Base64URL (RFC 4648 §5)**:
   - در Base64 معمولی کاراکترهای `+` و `/` وجود دارند که در آدرس‌های اینترنتی موجب تداخل با روت‌ها یا دایرکتوری‌ها می‌شوند.
   - همچنین علامت پدینگ `=` در انتهای آدرس‌ها نازیبا و غیرضروری است.
   - در استاندارد **Base64URL**:
     - `+` به `-` تبدیل می‌شود.
     - `/` به `_` تبدیل می‌شود.
     - علائم `=` پدینگ حذف می‌شوند.
   - چون ۶ بایت دقیقاً بر ۳ بخش‌پذیر است ($6 \div 3 = 2$ بلاک)، خروجی همواره **دقیقاً ۸ کاراکتر** بدون پدینگ خواهد بود.

```
ورودی:
https://nodejs.org/api/crypto.html

هش SHA-256 (هگزادسیمال):
c2df1c4bc2b7d519b7a...

برش ۶ بایت اول:
[0xc2, 0xdf, 0x1c, 0x4b, 0xc2, 0xb7]

خروجی Base64URL نهایی:
wt8cS8K3  (دقیقاً ۸ کاراکتر امن برای آدرس وب)
```

---

## ۴. مکانیسم رفع تداخل هش‌ها (Collision Resolution)

اگرچه احتمال برخورد دو هش در ۶ بایت بسیار کم است، اما بر اساس تئوری سالروز تولد (Birthday Paradox)، در مقیاس‌های بسیار بزرگ احتمال تصادف وجود دارد. برای تضمین یکتایی ۱۰۰٪:

1. **بررسی ایندکس معکوس (Idempotency)**:
   اگر همان URL قبلاً در مخزن ذخیره شده باشد، کد کوتاه ثبت‌شده قبلی بازگردانده می‌شود تا از تخصیص کدهای تکراری برای یک آدرس جلوگیری شود.
2. **شمارنده تداخل (Collision Counter / Salting)**:
   اگر کد کوتاه تولید شده قبلاً توسط آدرس *دیگری* اشغال شده باشد:
   ```javascript
   let counter = 0;
   do {
     shortCode = hashUrlToBase64(normalizedUrl, 6, counter > 0 ? String(counter) : '');
     counter++;
   } while (store.has(shortCode) && store.get(shortCode).originalUrl !== normalizedUrl);
   ```
   با اضافه شدن نمک `::1`، `::2` به انتهای URL، بایت‌های هش مجدداً محاسبه شده و کدی کاملاً جدید تولید می‌شود.

---

## ۵. طراحی و پیاده‌سازی مخزن کلید-مقدار (Key-Value Store)

کلاس `KeyValueStore` با رویکرد دوگانه (In-Memory + Disk Persistence) پیاده‌سازی شده است:

### ۱. ساختار هر رکورد در مخزن:
```typescript
interface LinkRecord {
  shortCode: string;          // کلید اصلی (Key)
  originalUrl: string;        // آدرس مقصد اینترنتی (Value)
  createdAt: string;          // زمان ایجاد با فرمت ISO 8601
  clicks: number;             // تعداد دفعات ریدایرکت
  lastAccessedAt: string|null;// زمان آخرین کلیک
  accessLogs: Array<{         // لاگ ۵۰ دسترسی اخیر
    timestamp: string;
    userAgent: string;
    referer: string;
    ip: string;
  }>;
  isCustom: boolean;          // آیا نام مستعار دلخواه بوده یا سیستمی
}
```

### ۲. ویژگی‌های فنی کلاس `KeyValueStore`:
- **دسترسی سریع با پیچیدگی زمانی $O(1)$**: استفاده از ساختار داده بومی `Map` جاوااسکریپت در حافظه رم، به طوری که درخواست ریدایرکت مستقیماً از حافظه بدون تاخیر دیسک خوانده می‌شود.
- **ایندکس معکوس (`urlIndex`)**: یک `Map` معکوس از `originalUrl -> shortCode` جهت جستجوی آنی آدرس‌های تکراری با سرعت $O(1)$.
- **پایداری اتمیک در دیسک (Atomic Write)**:
  برای جلوگیری از آسیب دیدن فایل دیتابیس در صورت قطع ناگهانی پروسس، نوشتن فایل در دو فاز انجام می‌شود:
  1. داده در فایل موقت `${filePath}.tmp.${Date.now()}` نوشته می‌شود.
  2. با استفاده از متد اتمیک سیستم‌عامل (`fs.rename`)، فایل موقت روی فایل اصلی جایگزین می‌گردد.
- **سیستم زمان‌بندی ذخیره (Debounced Persistence)**:
  عملیات نوشتن با یک تایمر ۱۵۰ میلی‌ثانیه‌ای مدیریت می‌شود تا تحت ترافیک‌های شدید چند صد درخواست بر ثانیه، دیسک سخت درگیر نوشتن‌های متوالی نشود.

---

## ۶. تشریح مو به موی کدهای پروژه (Line-by-Line Walkthrough)

### الف. ماژول هشینگ و اعتبارسنجی (`src/hasher.js`)

```javascript
import crypto from 'node:crypto';
```
- از ماژول استاندارد و بسیار سریع کریپتوگرافی نودجی‌اس برای محاسبات رمزی استفاده می‌شود.

```javascript
export function normalizeUrl(rawUrl) { ... }
```
- بررسی می‌کند که رشته خالی نباشد.
- در صورتی که کاربر پروتکل را وارد نکرده باشد، پیش‌فرض `https://` را اضافه می‌کند.
- با کلاس `new URL()` ساختار آدرس را بررسی کرده و اطمینان حاصل می‌کند که دامنه و فرمت صحیح است.

```javascript
export function hashUrlToBase64(url, byteLength = 6, salt = '') {
  const hash = crypto.createHash('sha256');
  hash.update(url + (salt ? `::${salt}` : ''));
  const digestBuffer = hash.digest();
  
  const slice = digestBuffer.subarray(0, byteLength);

  return slice
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```
- تابع `crypto.createHash('sha256')` با الگوریتم SHA-256 هش را تولید می‌کند.
- نمک `salt` در صورت تداخل، به انتهای URL افزوده می‌شود.
- متد `digest()` خروجی را به صورت یک بافر باینری ۳۲ بایتی بازمی‌گرداند.
- متد `subarray(0, byteLength)` ۶ بایت اولیه را بدون کپی اضافی در حافظه جدا می‌کند.
- در انتهای متد با سه دستور `replace` استاندارد، خروجی به صورت Base64URL فرمت‌بندی شده و پدینگ‌های `=` حذف می‌شوند.

```javascript
export function validateCustomAlias(alias) { ... }
```
- اجازه نمی‌دهد کاربر نام‌های رزرو شده (مانند `api`, `stats`, `health`) را انتخاب کند.
- طول نام مستعار را بین ۳ تا ۳۰ کاراکتر کنترل کرده و تنها حروف و ارقام انگلیسی و خط تیره و آندرلاین را مجاز می‌داند (`/^[a-zA-Z0-9_-]+$/`).

---

### ب. ماژول مخزن کلید-مقدار پایدار (`src/kvStore.js`)

```javascript
export class KeyValueStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.store = new Map();
    this.urlIndex = new Map();
    this.isDirty = false;
    this.flushTimeout = null;
    this.initialized = false;
  }
```
- کلاس مخزن، آدرس فایل پایدار (`filePath`) را دریافت کرده و دو ساختار `Map` برای دسترسی مستقیم $O(1)$ مقداردهی می‌کند.

```javascript
  async init() {
    if (this.initialized) return;
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      for (const item of parsed) {
        this.store.set(item.shortCode, item);
        if (!item.isCustom) this.urlIndex.set(item.originalUrl, item.shortCode);
      }
    } catch (err) {
      await this.persistImmediate();
    }
    this.initialized = true;
  }
```
- در هنگام بارگذاری، شاخه والد را با `{ recursive: true }` می‌سازد.
- داده‌های قبلی دیسک را خوانده و حافظه `Map` و ایندکس معکوس را پر می‌کند.

```javascript
  recordClick(key, meta = {}) {
    const record = this.store.get(key);
    if (!record) return null;

    record.clicks = (record.clicks || 0) + 1;
    record.lastAccessedAt = new Date().toISOString();
    record.accessLogs.unshift({
      timestamp: record.lastAccessedAt,
      userAgent: meta.userAgent || 'Unknown',
      referer: meta.referer || 'Direct',
      ip: meta.ip || '127.0.0.1'
    });
    if (record.accessLogs.length > 50) record.accessLogs.pop();
    this.schedulePersist();
    return record;
  }
```
- در هر ریدایرکت، شمارنده را افزایش داده و لاگ مراجعه اخیر را ثبت می‌کند (حفظ ۵۰ لاگ اخیر جهت جلوگیری از باد کردن دیتابیس).

```javascript
  async persistImmediate() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const data = JSON.stringify(Array.from(this.store.values()), null, 2);
    const tempPath = `${this.filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, data, 'utf-8');
    await fs.rename(tempPath, this.filePath);
    this.isDirty = false;
  }
```
- پایداری ۱۰۰٪ اتمیک با فایل موقت و متد `rename` جهت پیشگیری از داده‌های مخدوش.

---

### ج. ماژول وب‌سرور، API و ریدایرکت (`src/server.js`)

- ایجاد سرور خالص بر پایه `node:http`.
- تعریف تابع `sendJson(res, statusCode, payload)` با هدرهای CORS باز (`*`).
- تعریف روت‌های استاندارد:
  - `POST /api/shorten`: بدنه JSON حاوی `{ url, customAlias? }` را گرفته، اعتبارسنجی می‌کند و رکورد جدید را می‌سازد.
  - `GET /api/urls`: لیست تمام لینک‌ها به همراه آمار کلیک‌ها را بازمی‌گرداند.
  - `GET /api/stats/:code`: جزئیات آمار و لاگ‌های یک لینک خاص.
  - `DELETE /api/urls/:code`: حذف کلید از مخزن.
  - `GET /:code`: در صورت یافتن کلید، لاگ را ثبت کرده و پاسخ **HTTP 302** با هدر `Location` ارسال می‌کند؛ در غیر این صورت پاسخ خطای ساختاریافته JSON 404 برمی‌گرداند.

---

### د. ماژول اصلی و کتابخانه‌ای (`src/index.js`)

برای زمان‌هایی که قصد دارید بدون بالا آوردن پورت شبکه، مستقیماً از منطق کوتاه‌کننده درون اسکریپت یا پروژه‌های دیگر استفاده کنید:
- کلاس `UrlShortenerService` متدهای `shorten(url)`, `resolve(code)`, `delete(code)`, `getAll()`, `getStats()` را در اختیار قرار می‌دهد.
- تمامی ماژول‌های داخلی (`hasher`, `kvStore`, `createServer`) نیز از این فایل Re-export شده‌اند.

---

## ۷. مستندات کامل API (درخواست و پاسخ‌ها)

### ۱. کوتاه‌سازی لینک
- **آدرس:** `POST /api/shorten`
- **هدر:** `Content-Type: application/json`
- **نمونه بدنه درخواست:**
```json
{
  "url": "https://en.wikipedia.org/wiki/URL_shortening",
  "customAlias": "wiki-short" // اختیاری
}
```
- **نمونه پاسخ موفق (کد 201 یا 200):**
```json
{
  "success": true,
  "shortCode": "wiki-short",
  "shortUrl": "http://localhost:3000/wiki-short",
  "record": {
    "shortCode": "wiki-short",
    "originalUrl": "https://en.wikipedia.org/wiki/URL_shortening",
    "createdAt": "2026-09-12T08:21:56.662Z",
    "clicks": 0,
    "lastAccessedAt": null,
    "accessLogs": [],
    "isCustom": true
  }
}
```

### ۲. دریافت فهرست تمام لینک‌ها و آمار
- **آدرس:** `GET /api/urls`
- **پاسخ (200 OK):**
```json
{
  "success": true,
  "urls": [
    {
      "shortCode": "wiki-short",
      "originalUrl": "https://en.wikipedia.org/wiki/URL_shortening",
      "clicks": 4,
      "createdAt": "2026-09-12T08:21:56.662Z"
    }
  ],
  "stats": {
    "totalLinks": 1,
    "totalClicks": 4
  }
}
```

### ۳. دریافت آمار تفصیلی و لاگ‌های یک لینک
- **آدرس:** `GET /api/stats/:code`
- **پاسخ (200 OK):**
```json
{
  "success": true,
  "record": {
    "shortCode": "wiki-short",
    "originalUrl": "https://en.wikipedia.org/wiki/URL_shortening",
    "clicks": 1,
    "lastAccessedAt": "2026-09-12T08:22:15.647Z",
    "accessLogs": [
      {
        "timestamp": "2026-09-12T08:22:15.647Z",
        "userAgent": "curl/7.88.1",
        "referer": "Direct",
        "ip": "127.0.0.1"
      }
    ]
  }
}
```

### ۴. حذف لینک
- **آدرس:** `DELETE /api/urls/:code`
- **پاسخ (200 OK):**
```json
{
  "success": true,
  "message": "لینک با موفقیت حذف شد."
}
```

### ۵. ریدایرکت خودکار
- **آدرس:** `GET /:code`
- **پاسخ:**
  - **کد وضعیت:** `302 Found`
  - **هدر:** `Location: <آدرس اصلی>`
  - کاربر یا کلاینت به صورت خودکار به مقصد هدایت می‌شود.

---

## ۸. نحوه استفاده برنامه‌نویسی (Programmatic Usage)

می‌توانید مستقیماً در کدهای جاوااسکریپت بدون اجرای وب‌سرور از این کتابخانه استفاده کنید:

```javascript
import { UrlShortenerService } from './src/index.js';

// ایجاد نمونه از سرویس
const shortener = new UrlShortenerService('./data/store.json');

// ۱. کوتاه کردن یک آدرس
const result = await shortener.shorten('https://github.com/nodejs/node');
console.log('کد تولید شده:', result.shortCode); // مثلا: "x9K1mP2q"

// ۲. بازیابی آدرس اصلی و ثبت کلیک
const resolved = shortener.resolve(result.shortCode, { userAgent: 'App/1.0', ip: '10.0.0.1' });
console.log('آدرس مقصد:', resolved.originalUrl);
console.log('تعداد کلیک‌ها:', resolved.clicks);

// ۳. دریافت آمار کلی
console.log('آمار سیستم:', shortener.getStats());

// ۴. حذف لینک
shortener.delete(result.shortCode);
```

---

## ۹. تست‌های خودکار و تضمین کیفیت (`test/shortener.test.js`)

پروژه شامل ۶ فاز تست کامل است که صحت عملکرد تمامی بخش‌ها را تضمین می‌کند:

```bash
node test/shortener.test.js
```

### فازهای مورد آزمون:
1. **تست نرمال‌سازی URL**: اعتبارسنجی پروتکل‌های مجاز، افزودن خودکار https، و جلوگیری از آدرس‌های خراب.
2. **تست الگوریتم هشینگ و Base64URL**: بررسی ثبات تولید خروجی، طول دقیق ۸ کاراکتری، عدم استفاده از کاراکترهای رزرو شده و تست نمک‌گذاری.
3. **تست نام‌های مستعار دلخواه**: رد اسامی کوتاه، اسامی دارای کاراکتر غیرمجاز و کلمات رزرو شده سیستم.
4. **تست مخزن کلید-مقدار**: آزمون عملیات ذخیره، واکشی، ایندکس معکوس، افزایش شمارنده و ذخیره و بازیابی از دیسک سخت.
5. **تست وب‌سرور HTTP**: تست درخواست واقعی POST به اندپوینت `/api/shorten` و اعتبارسنجی دریافت هدر ریدایرکت `HTTP 302 Found`.
6. **تست کلاس برنامه‌نویسی `UrlShortenerService`**: تایید کارکرد به عنوان کتابخانه کدی مستقل.

---

## ۱۰. راهنمای اجرا و فراخوانی با cURL

### ۱. راه‌اندازی سرور API:
```bash
npm start
# یا:
node src/server.js
```
خروجی در ترمینال:
```
🚀 سرور API کوتاه‌کننده لینک روی پورت 3000 آماده دریافت درخواست‌ها است.
📡 آدرس پایه: http://localhost:3000
```

### ۲. نمونه دستورات cURL برای تست از طریق ترمینال:

#### الف. ایجاد یک لینک کوتاه جدید:
```bash
curl -X POST http://localhost:3000/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'
```

#### ب. ایجاد لینک با نام دلخواه:
```bash
curl -X POST http://localhost:3000/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com", "customAlias": "my-gh"}'
```

#### ج. تست ریدایرکت در ترمینال (مشاهده هدر ۳۰۲):
```bash
curl -I http://localhost:3000/my-gh
```
خروجی:
```http
HTTP/1.1 302 Found
Location: https://github.com
Cache-Control: no-cache, no-store, must-revalidate
Date: Sat, 12 Sep 2026 08:30:00 GMT
Connection: keep-alive
```

#### د. مشاهده آمار کلیک‌ها:
```bash
curl http://localhost:3000/api/urls
```
