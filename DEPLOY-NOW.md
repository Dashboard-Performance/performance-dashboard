# خطوات النشر

اعمل الخطوات دي بالترتيب.

## 1) Apps Script

1. افتح مشروع الـ Apps Script بتاع الداش بورد.
2. الصق `backend/Code.gs` الجديد مكان القديم كله، وبعدين Save.
3. اعمل **Deploy → Manage deployments → Edit → Version: New version → Deploy**.
4. لو طلب Authorize، وافق.
5. ملحوظة: `MailRelay.gs` ما اتغيرش، فمش محتاج تعمله حاجة.
6. **متشغلش** `removeDailyDeclineTrigger()` دلوقتي. الإيميل القديم لازم يفضل يوصل للتيم طول فترة التيست.

## 2) الـ Worker والـ Merchant Portal (PowerShell)

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
cd "C:\Users\Youssef Hanafy\Desktop\New-Ver\Performance_dashboard_v1_17_0\Performance_dashboard_v1_17_0\cloudflare-worker"
npx wrangler secret list
```

- لو `RESEND_API_KEY` موجود في اللستة، كمّل.
- لو مش موجود، شغّل `npx wrangler secret put RESEND_API_KEY` والصق الـ key من resend.com → API Keys.

```
npx wrangler deploy
cd ..\merchant-portal
npx wrangler deploy
```

## 3) الموقع

- ارفع ملفات الموقع كلها زي كل مرة: كل ملفات `.html` وفولدر `js` وفولدر `css` و`logo.png`.
- **متضيفش** فولدرات `backend` و`cloudflare-worker` و`merchant-portal` و`tools` للموقع. الـ `backend` فيه الـ secrets.

## 4) تيست الإيميل (ليك انت بس)

1. افتح الداش بورد واعمل Ctrl+F5.
2. روح على **Marketplace → Decline Matches**.
3. هتلاقي سطر مكتوب فيه "Daily email: TEST mode … to youssef.hanafy@taager.com only".
4. دوس **🧪 Test daily email (only me)** واستنى لحد دقيقتين.
5. هيوصلك إيميل subject بتاعه بيبدأ بـ **[TEST] Marketplace Decline Matches**.
   - لو السطر كتب "from the dashboard (no-reply@mail.taager.app) ✓"، يبقى كل حاجة شغالة.
   - لو كتب "via the OLD relay"، يبقى Resend مش شغال لسه، وهتلاقي السبب مكتوب في نفس السطر.
6. خلال فترة التيست، كل يوم الساعة 12:00 الداش بورد هتبعتلك نسخة [TEST] ليك انت بس. التيم هيفضل يوصله الإيميل القديم عادي.

## 5) لما تتأكد إنه تمام (بعد التيست)

1. افتح `cloudflare-worker/wrangler.toml` وغيّر `DECLINE_DIGEST = "test"` لـ `DECLINE_DIGEST = "on"`.
2. شغّل `npx wrangler deploy` من فولدر cloudflare-worker.
3. في الـ Apps Script، شغّل `removeDailyDeclineTrigger()` مرة واحدة.
4. من بكرة الساعة 12:00، التيم كله هيوصله الإيميل من الداش بورد.

## 6) بعد النشر: Command Loop

- افتح **Loop** ودوس **Run now**.
- تاسكات اللوك اللي مفيش ليها ستوك هتتنقل لـ Supply Chain.
