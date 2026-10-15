# v1.17.0 — Command Loop (Scores → Tasks → Notifications للميرشنت) + RE-CPA

النسخة دي بتضيف حاجتين متربطين ببعض:

1. **الداشبورد (للموظفين):** Scoring Engine بيحسب الـ Scores حسب الـ Spec، وبيطلّع Tasks لكل تيم حسب السبب. كل Task بتظهر في **My Tasks**، وكمان فوق الصفحة بتاعة السكشن بتاعها.
2. **بورتال الميرشنت:** Notifications أوتوماتيك على الـ SKUs اللي الميرشنت شغال عليها (Drop، DOH، Lock)، ولما يدوس عليها تفتحله الـ SKU نفسه. وكمان يقدر يطلب زيادة أو تمديد اللوك من جوه البورتال.

**كل الأرقام وكل التاسكات تحت تحكم الـ Admin والـ Country Manager بس، من Control → Command Loop.**

---

## النشر (من v1.16.x)

```bash
bash deploy/upgrade-v1.17.sh          # Mac / Linux
# أو على Windows:
powershell -ExecutionPolicy Bypass -File .\deploy\upgrade-v1.17.ps1
```

السكريبت بيعمل 3 حاجات:

1. بيعمل **D1 database** اسمها `taager-command-loop`، وبيحط الـ id بتاعها في `cloudflare-worker/wrangler.toml` لوحده. الجداول بتتعمل أوتوماتيك أول مرة.
2. بيعمل Deploy لووركر الداشبورد.
3. بيعمل Deploy لووركر البورتال.

**مفيش أي secret جديد**، بس لازم يكون `STAFF_SESSION_SECRET` متحط على ووركر الداشبورد (من v1.16). من غيره الـ Command Loop بيرجع رسالة واضحة إنه محتاجه. الووركرين بيكلموا بعض بنفس الـ `SERVICE_KEY` / `DASHBOARD_SERVICE_KEY` بتوع v1.16.

بعد السكريبت:

1. ارفع ملفات الموقع زي كل مرة. الصفحات اتبنت بالفعل بـ `node tools/build-pages.mjs`.
2. **Users & Roles:** اتأكد إن كل Account Manager متحطله **Linked ACM account**. ده اللي بيوصّل تاسكات الميرشنتس للـ ACM الصح. الـ ACM اللي ملوش اسم مربوط تاسكاته بتروح للـ Country Manager، وبتتعلّم "No owner".
3. **Control → Command Loop → Engine → Run now** أول مرة. بعد كده الـ Engine بيشتغل لوحده الساعة 10:00 و15:00 بتوقيت القاهرة، والمواعيد دي بتتغير من الإعدادات.
4. **بورتال الميرشنت:** افتح `/admin` → Refresh → **Notifications (Command Loop)** مرة واحدة. بعد كده بيتحدث لوحده كل 30 دقيقة.

> ووركر الداشبورد بقى عليه `[limits] cpu_ms = 300000`، لأن الـ Engine بيقرا الـ Main كله. ده محتاج **Workers Paid**، وهو نفس الـ plan اللي البورتال محتاجه أصلاً.

### لو مش هتستخدم السكريبت

```bash
cd cloudflare-worker
npx wrangler d1 create taager-command-loop     # انسخ الـ database_id
# حطه مكان PASTE-THE-D1-DATABASE-ID-HERE في wrangler.toml
npx wrangler deploy
cd ../merchant-portal && npx wrangler deploy
```

---

## Test mode (شغال من أول Deploy)

بعد الـ Deploy الـ Command Loop بيبقى في **Test mode**، يعني:

- **التاسكات:** محدش يشوف أي تاسك غير `youssef.hanafy@taager.com`. ده بيشمل My Tasks والشريط اللي فوق الصفحات.
- **الجرس:** أي Notification بتروح لنفس الإيميل بس، ومكتوب قبلها **[TEST]**، وجواها **Would go to: …** يعني كانت هتروح لمين.
- **الميرشنتس:** مش بيوصلهم أي Notifications، وزرار طلب اللوك مقفول.
- **الحسبة نفسها:** الـ Owners بيتحسبوا عادي، فإنت بتشوف في كل تاسك هي رايحة لمين.
- **Merchant preview:** تاب في Command Loop، بتكتب فيه Merchant ID وتشوف الـ Notifications اللي كانت هتوصله.

تقدر تزوّد إيميلات تانية للتجربة، أو تقفل الـ Test mode وتشغّل الكلام على الكل، من **Control ← Command Loop ← Overview ← Test mode**، وده بيبقى بموافقة.

## الدورة كلها

```
Main (Daily_Performance) + Inventory + Debundle + Availability Locking + Products Info
        │  10:00 و15:00 (أو Run now)
        ▼
Scores (Match / Merchant / SKU × Demand / CR / DR / CM3) — كل واحد قصاد تاريخه هو بس
        ▼
Diagnose (السبب) ──► Route (السكشن → التيم من Users & Roles) ──► Task + SLA
        │                                                        │
        └──► Signals للبورتال ──► Notification للميرشنت            ▼
                                                  Action → Done → Follow-up D+7 (re-score)
                                                  ≥ 70 Resolved ✅ / < 70 Reopen + Escalate
```

### مين بياخد إيه (الافتراضي، وبيتغير من Routing)

| السبب | السكشن | التيم |
|---|---|---|
| Out of stock / DOH < 4 / Single في البندل خلصان | Planner DOH | Supply Chain |
| Lock هيخلص / Lock هينتهي / طلب الميرشنت | Availability Locking | Marketplace |
| Listing issue (website status / expiry) | Inventory | Marketplace |
| Demand واقع عند أغلب التجار | Decline Matches | Marketplace |
| **CR أو DR واقع على المنتج Overall** | Analyst / Products | **Commercial** |
| Price اتغير + Drop، CM3 سالب أو واقع | Analyst / Products | Commercial |
| **CR أو DR أو Demand واقع على الميرشنت أو الماتش بس** | Merchant Performance | **الـ ACM بتاع الميرشنت** |
| رجع الاستوك → Relaunch | Merchant Performance | كل ACM ليه ميرشنتس على الـ SKU |

**التقسيم:** المنتج بيتحسب Overall لما الـ SKU Score يبقى أقل من 70 **و** الـ Drop يغطي **60% أو أكتر** من حجم الـ SKU **و** يكون عند **3 ميرشنتس على الأقل**. أقل من كده يبقى Partial: كل ACM ياخد تاسك على الميرشنتس بتوعه، والـ Commercial يشوف Watch من غير SLA. والأرقام دي كلها بتتغير من الإعدادات.

**مين بالظبط:** أي حد الرول بتاعه بيفتح السكشن ده بياخد التاسك. ولو السبب "By ACM"، بياخدها الشخص اللي الـ Linked ACM account بتاعه = الـ ACM بتاع الميرشنت في الداتا بس.

### التاسكات مربوطة ببعض

- لو الـ SKU خلصان، بتطلع **Case واحدة** لـ Supply، والميرشنتس اللي عليه بيبقوا جواها. الـ ACMs بيشوفوها في **"Other teams are on it"** من غير تاسكات مكررة.
- لما Supply يحط **ETA**، الميرشنت بيشوفه في الـ Notification بتاعة الاستوك.
- لما الاستوك يرجع، الـ Case بتتقفل لوحدها، **وبيطلع لكل ACM تاسك Relaunch** فيه الميرشنتس بتوعه. وفي نفس الوقت الميرشنت يوصله "Back in stock".
- لما الميرشنت يدوس "Ask for more" على اللوك، بتطلع تاسك في Availability Locking بالكمية المقترحة (متوسط الـ confirmed × 7 − الباقي). وقرار Marketplace بيرجع للميرشنت كـ Update، ومعاه خانة **"Reply to the merchant"** بس. أما الـ Outcome / note فداخلي، والميرشنت عمره ما يشوفه.
- تاسك Match واقعة واللوك بتاعها عليه تاسك مفتوحة بتبقى **Waiting**، ولما اللوك يتحل بتتفتح لوحدها.
- Done بيحط **Follow-up بعد 7 أيام** ويعيد حساب الـ Score: لو 70 أو أكتر يبقى Resolved، ويتحسب الـ GMV اللي رجع. لو أقل يتفتح تاني ويعمل Escalation.
- التاسك اللي تعدّي الـ SLA بتعمل Notification لصاحبها. ولو عدّت **2× SLA** بتروح للـ Admin والـ Country Manager.

---

## Control → Command Loop (Admin والـ Country Manager بس)

| التاب | فيه إيه |
|---|---|
| Overview | التاسكات المفتوحة، المتأخرة، الـ Escalated، اللي ملهاش owner، Recovery rate، الـ GMV اللي رجع، Median time to act. وجداول By section / By person / By reason، وجدول **Playbook** بيوريك أنهي Action بترجّع الـ Score أكتر. وفيه كمان زرار Run now وتحذيرات الداتا. |
| All tasks | كل التاسكات، بفلاتر. وتقدر تعمل على كذا تاسك مرة واحدة: Assign لشخص معين، تغيير الحالة، نقل لسكشن تاني، Reset SLA، تحديد Follow-up، Priority، Delete. وفيه **New task** يدوي و**Export CSV** (الـ Follow-up Log). |
| Scores | آخر Scores لكل Merchant / SKU / Match، بالـ Flags والـ Impact. |
| Scoring | الـ Threshold، والـ Watch / Recovered، والـ Guards (Min volume، Min history days، تنبيه الـ 20,000 صف)، والـ Windows لكل Score، وتشغيل أو إطفاء كل Score. |
| Diagnose & tasks | حدود الـ DOH، الـ Lock cover، Expiry، نسبة الـ Overall والـ Min merchants، الـ Follow-up days، الـ Escalation، Auto-close، الـ Relaunch، الـ Notifications، ومواعيد التشغيل. |
| Routing | لكل سبب: يشتغل ولا لأ، السكشن، By ACM، الـ SLA، وأزرار الـ Playbook. |
| Merchant notifications | تشغيل البورتال كله، وتشغيل كل قاعدة (N1 لحد N8) بأرقامها، ونافذة الميرشنت، والـ Cooldown، والـ Cap اليومي، ومدة الـ Mute، والـ Alternatives، وطلبات اللوك. |
| Exclusions | SKUs أو ميرشنتس مستبعدين لحد تاريخ معين: مفيش تاسكات ولا Notifications عليهم. |
| Engine | آخر تشغيل، إحصائيات الداتا، Data guards، وسجل التشغيلات. |

كل حفظ بيتسجل في **Activity Log**. والـ Admin والـ Country Manager بس هما اللي يقدروا يعملوا **Dismiss** لأي تاسك. الـ Dismiss بيسكّت التاسك 7 أيام، والمدة دي بتتغير.

---

## Notifications للميرشنت

| | الـ Notification | الشرط الافتراضي |
|---|---|---|
| N1 | الأوردرات وقعت على SKU | Score أقل من 70 (آخر 3 أيام قصاد D4..D10 من تاريخه هو)، وحجم 5 قطع/يوم على الأقل |
| N2 | الـ CR وقع | نفس الشرط |
| N3 | الاستوك بيخلص | DOH أقل من 4 (أقل من 2 = critical) |
| N4 | Out of stock | — |
| N5 | اللوك محتاج Update | الباقي يغطي يومين أو أقل من متوسط الـ **confirmed** اليومي |
| N6 | اللوك هينتهي | خلال 3 أيام |
| N7 | رجع الاستوك ✅ | بعد ما N3 أو N4 يتقفلوا والـ DOH يبقى 7 أو أكتر |
| N8 | الأداء رجع ✅ | بعد ما N1 أو N2 يتقفلوا والـ Score يبقى 90 أو أكتر |

- **Alert Center** فيه تابين: **Needs your action** و**Updates**. والـ Updates فيها الـ Alerts اليدوي من التيم.
- أي Notification لما يدوس عليها تفتحله **SKU drawer**: فيه آخر 14 يوم، والاستوك، والـ DOH، والـ ETA، واللوك، وطلباته، وبدائل من نفس الكاتيجوري (استوك صحي ومش مقفولة لحد).
- الـ Deep link بالشكل ده: `https://merchants.taager.app/dashboard#inv?sku=<SKU>&mid=<ID>`.
- حالة "اتقرت" بتتحفظ على السيرفر، فبتبقى واحدة على أي جهاز.
- الميرشنت **مبيشوفش** CM3، ولا أي أرقام لميرشنتس تانيين، ولا أرقام المنصة.

---

## RE-CPA (Max CPA calculator)

موجود في مكانين بنفس الحسبة بالظبط، لأن الاتنين شغالين بنفس الكود (`js/cpa-core.js`):

- **الداشبورد:** Merchants → **RE-CPA**. بتختار ميرشنت (أو تسيبها General plan)، وتضيف SKUs، وتحفظ الـ Plan للميرشنت ده. ولو الميرشنت عامل Plan من البورتال، بيظهر عندك في زرار **Merchant's own plan**.
- **بورتال الميرشنت:** تاب **RE-CPA**. الميرشنت بيحفظ الـ Plan بتاعه، ونسخة منه بتوصل للتيم أوتوماتيك.

| بيتملى لوحده | بيتكتب يدوي | بيتحسب أوتوماتيك |
|---|---|---|
| Taager price، Profit (من Products) | AVE Market | ASP = AVE Market − 99 |
| CR / DR: بتوع الميرشنت لو عنده حجم كفاية، وإلا متوسط المنتج | Actual CPA | Margin / piece = Profit + (ASP − Taager price) |
| | Num of Conversion | NDR = CR × DR (أو تكتبه بنفسك) |
| | | **Max CPA = Margin × NDR** (الـ break-even) |
| | | Safe CPA = Max CPA × (1 − 20%) |
| | | Ad spend، Delivered، **Net profit**، ROI، Break-even NDR، Break-even AVE Market |

وكمان فيه:

- **Status** لكل SKU: Profitable / Thin margin / Losing money / No margin.
- **اقتراحات مكتوبة:** تنزل الـ CPA لكام، أو ترفع السعر لكام، أو الـ NDR يوصل لكام.
- **جدول حساسية:** صافي الربح لكل 100 Conversion، على CPA ±20% و NDR ±5 نقط.

**مراجعة الشيت الأصلي:** المعادلات صح (`Top Up = (ASP − Selling) + Profit`، و`NET = NDR × Conv × Top Up − CPA × Conv`)، بس فيه 3 حاجات:

1. **Max CPA** كان مكتوب يدوي في أغلب الصفوف ومش ماشي مع الحسبة. مثلاً صف 2: مكتوب 72، والصح 316 × 0.3 = **94.8**. دلوقتي بيتحسب أوتوماتيك.
2. لما **AVE Market** يبقى فاضي، الشيت بيطلع ASP = −99 وTop Up = −499. دلوقتي بيفترض إن الميرشنت بيبيع بسعر Taager.
3. الـ **99** كان ثابت جوه المعادلة. دلوقتي بيتغير من الإعدادات.

**الإعدادات:** من Control → Command Loop → **RE-CPA** (Admin والـ Country Manager بس): مصاريف الشحن، الـ Safety %، مصدر الـ CR/DR والحد الأدنى للحجم، إظهار متوسط المنتج للميرشنت ولا لأ، وتشغيل التاب في البورتال ولا لأ.

> لو عدّلت `js/cpa-core.js` أو `css/cpa.css`، شغّل `node tools/sync-cpa.mjs` عشان البورتال ياخد نفس النسخة. الاختبارات بتتأكد إنهم متطابقين.

## Forgot your password? (صفحة لوجين الداشبورد)

في صفحة اللوجين بقى فيه **Forgot your password?**:

1. الشخص بيكتب إيميل الشغل بتاعه.
2. بيوصله إيميل فيه زرار. الزرار بيفتح الداشبورد على **Choose a new password**، فيكتب الباسورد الجديد مرتين.
3. الباسورد بيتحفظ **مشفّر** في شيت اليوزرز، وكل الـ sessions القديمة بتاعته بتتقفل.
4. بيعمل لوجين بالباسورد الجديد.

**الأمان:**
- اللينك بيشتغل **مرة واحدة** وبينتهي بعد **ساعة**.
- كل خطوة ليها Status واضح على الشاشة: **Account check** (✓ / ✕ مع السبب) و **Reset email** (✓ اتبعت لـ yo******@taager.com / ✕ مع السبب)، ومعاها عدد المحاولات الباقية (من 3 في الساعة) وعداد تنازلي لما المحاولات تخلص. ده بيوضّح إذا كان الإيميل عنده أكونت ولا لأ، واتعمل كده بطلبك.
- أقصى 3 إيميلات للشخص في الساعة، والعداد بيحسب الإيميلات اللي اتبعتت فعلاً بس.
- الإيميل كله إنجليزي، وفيه اللينك مكتوب كمان لو الزرار مشتغلش.
- الباسورد الجديد لازم يكون 8 حروف على الأقل، وفيه حروف وأرقام.

**الإيميل بيتبعت إزاي:**
- لو `RESEND_API_KEY` متحط على ووركر الداشبورد، بيتبعت عن طريق Resend من `no-reply@mail.taager.app`.
- لو مش متحط، Apps Script بيبعته من الأكونت اللي عامل الـ Deploy.

**النشر (مرة واحدة):**
1. الصق `backend/Code.gs` الجديد في Apps Script ← **Deploy ← Manage deployments ← Edit ← New version ← Deploy**. لازم تتأكد إن `WORKER_SERVICE_KEY` موجود في Script Properties (اتحط مع v1.16).
2. ارفع ووركر الداشبورد: `cd cloudflare-worker; npx wrangler deploy`.
3. ارفع ملفات الموقع (`js/auth.js` اتغير).
4. اختياري، بس أحسن عشان الإيميل ميروحش Spam: `npx wrangler secret list` جوه `cloudflare-worker`. لو `RESEND_API_KEY` مش موجود، حطه بـ `npx wrangler secret put RESEND_API_KEY` (نفس مفتاح Resend بتاع البورتال).

لو الإيميل موصلش، آخر غلطة بتتسجل في KV تحت `pwreset:lastError`.

## Supply Chain: الـ Returns الفعلية (Supply conversion بس)

صف **Returns** في Supply conversion (Supply Chain ← Inventory Aging) بقى بيتحسب من **المرتجع الفعلي** اللي اتسكان في المخزن، زي شيت EG - Inventory Aging بالظبط:
```
ملف Return_Archive_YYYY-MM ← تاب Return_RCV
SUM(Quantity) لكل Product Code، للصفوف اللي Product Condition Return = "Product is good"
```
- **مفيش أي مكان تاني في الداشبورد بيستخدمه.** الـ Purchase Plan والـ Sellthrough وغيرهم زي ما هم.
- **مين بيقراه:** الـ Apps Script backend (action `actual_returns`) بيدوّر على الملف **باسمه** للشهر الحالي، فمش محتاج تغيّر الـ URL كل شهر.
  - لو عايز تحدد ملف معين لشهر: اعمل Script property اسمها `RETURNS_ARCHIVE_2026-10` وقيمتها الـ URL.
- **الـ Worker** بيحتفظ بالنتيجة 20 دقيقة. لو الـ Apps Script فشل، أو المجموع نزل فجأة أكتر من 15%، بيعرض آخر نسخة سليمة ويكتب "Cached from …" تحت الجدول.
- **مهم:**
  1. ارفع Code.gs كـ **New version**. هيطلب **Authorize** جديد، لأنه بقى بيستخدم Drive عشان يدوّر على الملف.
  2. الأكونت اللي الـ Script شغال بيه لازم يبقى عنده **View** على ملفات Return_Archive.

## حماية الأرقام من رفرش ناقص (Last good copy)

كل مصادر Metabase بتعدّي على الـ Worker. الـ Worker بيحتفظ بآخر نسخة سليمة من كل مصدر. **لو حصلت حاجة من دول، الداشبورد يعرض آخر نسخة سليمة بدل الأرقام البايظة:**
- Metabase وقع، أو عمل timeout، أو رجّع Error / صفحة HTML / JSON فيه error.
- عدد الصفوف الكلي نزل أكتر من **15%**.
- **(Main)** أي شهر كان موجود في النسخة السليمة صفوفه نزلت أكتر من **10%** مرة واحدة. أقدم شهر مستثنى، لأنه طبيعي يطلع من الـ Query.

ولما ده يحصل:
- تحت على الشمال هيظهر: **"⚠ Cached from <التاريخ والساعة> — Main: the source returned incomplete data (2026-10 rows fell from … to …)"**، والنقطة الخضرا هتبقى برتقالي.
- لما Metabase يرجع سليم، الداشبورد بيرجع Live لوحده.
- الـ Command Loop engine بيستخدم نفس الحماية، فمش هيعمل تاسكات من داتا ناقصة، وهيكتب Warning في الـ Engine.
- **لو النقص حقيقي** (مثلاً الـ Query اتغيرت عن قصد): لو نفس النتيجة الأصغر فضلت ثابتة **12 ساعة**، بتتقبل لوحدها. أو تقدر تقبلها فوراً:
  `<WORKER_URL>/?action=metabaseAccept&gid=2099497960&email=<owner email>`
- **حالة كل مصدر:** آخر نسخة سليمة وآخر مشكلة:
  `<WORKER_URL>/?action=metabaseStatus`

## RE-CPA: الحسبة الجديدة

لما الـ ACM يضيف SKU، الأرقام دي بتتملى لوحدها:
- **CR% و DR% و NDR%:** بتوع **المنتج** (كل الميرشنتات).
- **Selling price و Profit:** من شيت Products.
- **Placed ASP:** الـ Placed GMV ÷ الـ Placed pieces بتاع المنتج.

الحسبة:
```
Margin / piece = AVE Market − (Selling price − Profit)
Max CPA        = Margin / piece × NDR
```
- لو الـ AVE Market فاضي، بيتحسب بالـ Placed ASP.
- الـ Shipping 99 مبقاش بيتطرح.

## تاسكات أقل وأهم + تاسكات Overall

**فلاتر الجودة** (من Control ← Command Loop ← Diagnose & tasks ← Fewer, more important tasks):
- **أقل حاجة 2,000 جنيه/يوم في خطر:** أي تاسك أقل من كده مش بيتعمل. ده مش بيطبق على الـ Lock requests والتاسكات اليدوية.
- **الوقعة لازم تبان يومين ورا بعض:** لو يوم واحد وحش بس، مفيش تاسك.
- **أقصى 30 تاسك جديدة في الـ Run:** الأكبر في الجنيه/يوم الأول، والباقي يستنى الـ Run اللي بعده.
- **اتقفل افتراضياً:**
  - Match dropped (الميرشنت × SKU): بدلها بقت Merchant dropped، حتى لو SKU واحد بس هو السبب.
  - Partial watch.
- **CM3 down على الـ SKU لسه شغالة**، والـ PPM اتضافت جنبها.
- **التاسكات المفتوحة اللي من الأنواع دي ومحدش اشتغل عليها هتتقفل لوحدها في الـ Run الجاي.**

**تاسكات جديدة:**
- **PPM / piece below target** (لفريق Commercial، سكشن CM3 Analyst / Products):
  - الـ PPM لكل قطعة اتسلمت، من D6 لـ D12، أقل من 80% من "Target PPM Pieces" بتاع الكاتيجوري في Category Targets.
  - لازم يكون فيه 30 قطعة اتسلمت على الأقل في الأسبوع.
- **Category down (overall)** (لفريق Commercial، سكشن Targets): الكاتيجوري كلها نازلة بنفس الـ Scoring، ومعاها أكتر SKUs نازلة.
- **ACM portfolio down (overall)** (للـ ACM نفسه، سكشن Performance ACM): كل ميرشنتات الـ ACM مع بعض نازلين، ومعاها أكتر ميرشنتات نازلة.

**جوه التاسك:** فوق خالص بيظهر الـ SKU والـ Merchant ID والـ ACM والكاتيجوري، وتقدر تدوس على أي واحد منهم عشان تنسخه.

## مين بياخد التاسك (Team) + الـ Suggested lock

**التاسك بتروح للفريق صاحب السكشن، مش لكل اللي بيفتح الصفحة.** كل سكشن تابع لفريق من الفرق اللي في الـ Sidebar:
- **Marketplace:** Availability Locking وInventory وDecline Matches...
- **Commercial:** Analyst / Products...
- **Supply Chain:** Planner DOH...
- **Account Manager:** Merchant Performance...

الـ Owners هم الناس اللي الـ Role بتاعهم في Users & Roles هو اسم الفريق ده (أو فيه اسم الفريق، زي "Marketplace Lead"). فلو الـ ACM بيفتح صفحة Availability Locking، تاسكات الـ Lock مش هتروحله.

- لو مفيش ولا واحد بالـ Role ده، التاسك بترجع للقاعدة القديمة (كل اللي بيفتح الصفحة).
- تقدر تغيّر الفريق لأي سبب من **Control ← Command Loop ← Routing ← Team**. اختيار **Auto** معناه إن الفريق بيتحدد من السكشن.

**الـ Suggested increase للـ Lock:**
```
Needed   = Avg placed/day × 7 − Lock left
Kept     = لكل Seller تاني على نفس الـ Single: الأكبر بين (Confirmed/day × 7) و(Lock left بتاعه × CR)
Free     = Stock − Kept
Max      = Free ÷ Product CR − Lock left
Suggest  = الأقل بين Needed و Max
```
- لو الاقتراح اتحدد بالستوك، هيظهر جنبه "(capped by stock)".
- لو مفيش ستوك فاضي، الاقتراح هيبقى 0 ومكتوب جنبه "raise PO / transfer first".

## ملاحظات

- **الأعمدة بتتقري بالاسم** (CREATION_DATE, TAGER_ID, PRODUCT_ID, PLACED_PIECES, CONFIRMED_PIECES, DELIVERED_PIECES, PLACED_GMV, CM3, ACM …). ولو الاسم مش موجود، بيرجع لنفس مكان العمود اللي `js/app.js` بيقراه.
- **D0 = النهارده بتوقيت القاهرة.** لو الـ Main متأخر يومين أو أكتر، الـ D0 بيترحّل ليوم بعد آخر يوم في الداتا، وبيطلع تحذير في Engine.
- **Price change:** السعر بيتقري من كويري **Products** (`1779314157`، نفس السعر اللي الداشبورد بيعرضه)، ولو مش موجود هناك بيتقري من **Products Info** (`531154071`) من صفوف مصر بس. الـ Engine بيحفظ سعر كل يوم في KV (`loop:prices`)، فأول تشغيل بيسجّل السعر بس، والتغيير بيتكشف من تاني تشغيل. الـ Website status بيتقري من نفس كويري Products، أما تاب `Data Extract` فلسه مش متوصل.
- لو Inventory أو Locks مقدرتش تتقري، الـ Run بيكمل عادي، والـ Check اللي محتاجهم بيتخطّى، وبيطلع تحذير.

## الاختبارات

```bash
cd cloudflare-worker && npm test     # 18 staff gate + 18 password reset + 76 Command Loop + RE-CPA
cd ../merchant-portal && npm test    # 27 smoke + 41 notifications + RE-CPA (حسبة الشيت صف بصف)
```
