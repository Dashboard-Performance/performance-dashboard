# نشر v1.16.0 — الداشبورد + بورتال الميرشنت

النسخة دي فيها جزئين، وكل جزء ليه سيرفر لوحده:

| | الداشبورد (للموظفين) | بورتال الميرشنت |
|---|---|---|
| مين يدخل | إيميلات `@taager.com` وأي حد الأدمن ضافه برول موظف | الميرشنتس اللي ليهم حساب في البورتال |
| السيرفر | `cloudflare-worker/` (نفس الووركر الحالي) | `merchant-portal/` (Worker جديد خالص) |
| الداتا | كل الكويريز | **كويري واحدة بس**: Merchant Segmentation (`5761d362…`) |

> رتّب الخطوات زي ما هي. لما الـ `STAFF_SESSION_SECRET` يتحط، كل الموظفين هيعملوا لوجين مرة واحدة تاني.

---

## أولاً: الداشبورد (الموظفين)

### 1) Apps Script (`backend/Code.gs`)
1. الصق `Code.gs` الجديد مكان القديم.
2. **Project Settings → Script Properties**، ضيف:
   - `API_KEYS` = نفس قيمة `ADMIN_KEY` بتاع الووركر (عشان Users & Roles يقرا اليوزرز). المفتاح القديم `Admin-Panal-Center` مبقاش شغال.
   - `SERVICE_KEY` = نص عشوائي طويل (32 حرف مثلاً). بعده، قراءة الشيتات من Apps Script هتبقى للووركر بس.
   - `WORKER_SERVICE_KEY` = نفس قيمة `SERVICE_KEY` بتاع الووركر (الخطوة الجاية).
3. **Deploy → Manage deployments → Edit → New version**.

الباسوردات القديمة اللي متخزنة نص عادي هتتحول لـ hash لوحدها أول ما كل واحد يعمل لوجين.

### 2) الووركر (`cloudflare-worker/`)
```bash
cd cloudflare-worker
npx wrangler secret put STAFF_SESSION_SECRET      # 32+ حرف عشوائي — ده اللي بيشغّل قفل الموظفين
npx wrangler secret put SERVICE_KEY               # 16+ حرف — نفس WORKER_SERVICE_KEY في Apps Script
npx wrangler secret put APPS_SCRIPT_SERVICE_KEY   # نفس SERVICE_KEY بتاع Apps Script
npx wrangler secret put COMPUTED_API_KEYS         # لو فيه حد برة بيقرا الـ Computed API (مفتاح 12+ حرف)
npx wrangler deploy
npm test   # اختياري: 18 اختبار لقفل الموظفين
```
بعد كده:
- أي query أو شيت أو داتا من الووركر محتاجة لوجين موظف، والووركر هو اللي بيتأكد منه.
- الميرشنت مايقدرش يعمل لوجين في الداشبورد خالص.
- رول Admin / Country Manager بيتحفظ بس لإيميلات `@taager.com`.
- لينكات Metabase اتشالت من كود المتصفح وبقت جوه الووركر.

### 3) الموقع
ارفع ملفات الموقع زي كل مرة. لو عدّلت `index.html` بعد كده، شغّل:
```bash
node tools/build-pages.mjs
```
عشان صفحات التابات (`target-acm.html`, `inventory.html`, …) تتبني منه.

### 4) بعد ما تتأكد إن كله شغال — قفل المصادر القديمة
لينكات Metabase الـ public كانت جوه كود المتصفح من نسخ قديمة، فاعتبرها مكشوفة:
1. في Metabase، لكل سؤال: اقفل الـ public sharing وافتحه تاني → بيطلع لينك جديد.
2. حط اللينكات الجديدة في الووركر:
   ```bash
   npx wrangler secret put METABASE_LINKS
   # {"2099497960":"https://metabase.taager.com/api/public/card/<الجديد>/query/csv", "620123165":"…"}
   ```
   (أي gid مش موجود هنا بيستخدم اللينك القديم المكتوب في الووركر.)
3. شيتات جوجل: خلّي الـ sharing **Restricted**. Apps Script بيقراها بصلاحيتك، فمش هيتأثر.

---

## ثانياً: بورتال الميرشنت (`merchant-portal/`)

### 1) أول مرة
```bash
cd merchant-portal
npx wrangler kv namespace create PORTAL_KV     # حط الـ id في wrangler.toml
npx wrangler secret put ADMIN_KEY              # 16+ حرف — بيفتح /admin (مختلف عن مفتاح الداشبورد)
npx wrangler secret put SESSION_SECRET         # 32+ حرف عشوائي
npx wrangler secret put MERCHANT_QUERY_URL     # https://metabase.taager.com/public/question/5761d362-9da0-4f6a-9c83-2d569d8c5f38
npx wrangler secret put DASHBOARD_SERVICE_KEY  # نفس SERVICE_KEY بتاع ووركر الداشبورد (لزرار الاستيراد)
npx wrangler deploy
npm test   # اختياري: 27 اختبار
```
اختياري: إيميلات تلقائية (لينك الباسورد + نسيت الباسورد). حط `RESEND_API_KEY` كـ secret و`MAIL_FROM` و`PORTAL_URL` في `wrangler.toml`.

البورتال محتاج **Workers Paid plan** عشان قراية الكويري كل ساعة.

### 2) تشغيل
1. افتح `https://<البورتال>/admin` وحط الـ `ADMIN_KEY`.
2. دوس **Refresh now**. بعد دقيقة اتأكد من **Check the column mapping**: كل خانة لازم تكون قدام العمود الصح في الكويري.
3. دوس **Import merchants from the dashboard**. ده بيعمل حساب لكل ميرشنت متسجل في Users & Roles، ويطلّع لكل واحد لينك يختار بيه الباسورد (صالح 72 ساعة).
4. ابعت لكل ميرشنت اللينك بتاعه. ولو الإيميلات متظبطة، بيتبعتوا لوحدهم.
5. حط لينك البورتال في `js/tower.js` في `MERCHANT_PORTAL_URL`، عشان أي ميرشنت يفتح الداشبورد يلاقي زرار يوديه للبورتال.

### الميرشنت بيشوف إيه
من الكويري دي بس، ولشهر يختاره: CR × DR (Net delivery rate)، و Placed / Confirmed / Delivered Pieces (والأوردرات)، و Delivered GMV مع Run Rate للشهر الحالي، و Monthly Pipeline، و Avg Placed Pcs في اليوم.

الكويري شهرية (مش يومية ومن غير كاتيجوري)، فشارت الأيام وتقسيمة الكاتيجوري اللي في Over View الداشبورد مش موجودين في البورتال.

السيرفر بيشيل اسم الـ ACM والـ Segment والبلد قبل ما يخزن أي حاجة.
