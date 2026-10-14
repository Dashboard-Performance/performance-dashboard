// The merchant's dashboard page (/dashboard): the staff dashboard's own design (sidebar, top bar, panels, tables — css/style.css + css/tower.css)
// with two tabs: "Over View" (their own numbers) and "Merchant Target" (Merchant Targets + Merchant Segmentation & Projections).
// Nothing here is secret: the browser only talks to this Worker's /api/* endpoints. No inline script and no style="" (CSP).
import { SHARED_JS } from "./ui.js";

export const DASH_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Taager · Merchant dashboard</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/dash.css">
<script src="/static/dash.js" defer></script>
</head>
<body>
<div class="shell">
  <aside class="sidebar hover-glow">
    <div class="sidebar-brand"><div class="brand-title"><span class="bt-name">Center Control<small>Taager Performance</small></span></div></div>
    <nav class="sidebar-nav">
      <a class="nav-item active" id="navOv" data-view="ov"><span class="nav-icon"></span>Over View</a>
      <a class="nav-item" id="navTg" data-view="tg"><span class="nav-icon"></span>Merchant Target</a>
      <a class="nav-item" id="navSp" data-view="sp"><span class="nav-icon"></span>Sales Plan</a>
      <a class="nav-item" id="navInv" data-view="inv"><span class="nav-icon"></span>Inventory</a>
      <a class="nav-item hidden" id="navInc" data-view="inc"><span class="nav-icon"></span>Incentives Tracker</a>
      <a class="nav-item" id="navAl" data-view="al"><span class="nav-icon"></span>Alert Center<span class="mp-badge hidden" id="alBadge">0</span></a>
    </nav>
    <div class="sidebar-footer">
      <div id="twStatus"><div id="sidebarStatus">Live System Sync</div><div id="sidebarUpdated"></div><div id="sidebarVersion">Auto-refresh: 30 min</div></div>
      <div class="mp-acct"><div class="mp-av" id="acAv">T</div><div class="mp-ainfo"><div class="mp-aname" id="mName">Your store</div><div class="mp-arole" id="mIds">Merchant</div></div><button type="button" class="mp-pw" id="outBtn2" title="Sign out" aria-label="Sign out"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/></svg></button></div>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <div class="topbar-title"><h1 id="pgTitle">Over View</h1><p id="pgSub">Your demand, pipeline &amp; delivery numbers</p></div>
      <div class="topbar-actions">
        <div class="filter-group" id="monthWrap"><select id="monthSel" aria-label="Month"></select></div>
        <button class="btn btn-outline tw-iconbtn" id="themeBtn" type="button" title="Light / dark" aria-label="Switch theme"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg></button>
        <div class="mp-menu">
          <button class="btn btn-outline" id="menuBtn" type="button" aria-haspopup="true">Account ▾</button>
          <div class="mp-menu-list hidden" id="menuList">
            <div class="mp-who" id="whoEmail"></div>
            <button type="button" id="chgBtn">Change password</button>
            <button type="button" id="outBtn">Sign out</button>
          </div>
        </div>
      </div>
    </header>
    <main class="content">
      <div class="mp-note hidden" id="dataNote"></div>

      <div id="viewOv" class="view-section active-view">
        <section class="ov-hero hover-glow">
          <div class="ov-hero-l">
            <div id="ovRing" class="ov-ring"></div>
            <div class="ov-eq">
              <div class="ov-chip"><span>CR</span><b id="crVal">0%</b><small>Confirmed ÷ Placed</small></div>
              <i>&times;</i>
              <div class="ov-chip"><span>DR</span><b id="drVal">0%</b><small>Delivered ÷ Confirmed</small></div>
            </div>
          </div>
          <div class="ov-hero-r">
            <div class="ov-tile k-blue"><span class="ov-lbl">Placed Pieces</span><b class="ov-val" id="vPlaced">0</b><div class="ov-sub" id="oPlaced"></div><div class="ov-sub" id="rPlaced">Run Rate: —</div><div class="ov-spark" id="sPlaced"></div></div>
            <div class="ov-tile k-purple"><span class="ov-lbl">Confirmed Pieces</span><b class="ov-val" id="vConfirmed">0</b><div class="ov-sub" id="oConfirmed"></div><div class="ov-sub" id="rConfirmed">Run Rate: —</div><div class="ov-spark" id="sConfirmed"></div></div>
            <div class="ov-tile k-accent"><span class="ov-lbl">Delivered Pieces</span><b class="ov-val" id="vDelivered">0</b><div class="ov-sub" id="oDelivered"></div><div class="ov-sub" id="rDelivered">Run Rate: —</div><div class="ov-spark" id="sDelivered"></div></div>
            <div class="ov-tile k-green"><span class="ov-lbl">Delivered GMV</span><b class="ov-val text-green" id="vGmv">EGP 0</b><div class="ov-sub">&nbsp;</div><div class="ov-sub" id="rGmv">Run Rate: —</div><div class="ov-spark" id="sGmv"></div></div>
          </div>
        </section>
        <div class="ov-row">
          <div class="panel chart-panel hover-glow">
            <div class="panel-head-modern">
              <div class="panel-title-wrapper border-blue"><h2>Daily Pipeline</h2><p id="pipeSub">Confirmed Pieces (bars) vs Placed Pieces (line) per day</p></div>
              
            </div>
            <div class="mp-chart" id="pipeChart"></div>
          </div>
          <div class="panel hover-glow">
            <div class="panel-head-modern"><div class="panel-title-wrapper border-orange"><h2>Avg Placed Pcs</h2><p id="avgSub">Placed pieces ÷ days in the month</p></div></div>
            <div class="ov-aov">
              <div class="ov-aov-v" id="avgVal">0</div><div class="ov-sub">pieces per day</div>
              <div class="ov-spark ov-spark-wide" id="avgSpark"></div>
              <div class="ov-aov-rows">
                <div><span>Placed pieces</span><b id="avgPcs">—</b></div>
                <div><span>Days counted</span><b id="avgDays">—</b></div>
                <div><span>Previous month</span><b id="avgPrev">—</b></div>
                <div><span>Change vs previous month</span><b id="avgChg">—</b></div>
                <div><span>Best month</span><b id="avgBest">—</b></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="viewTg" class="view-section hidden">
        <section class="table-section mt-4">
          <div class="panel table-panel hover-glow">
            <div class="panel-head-modern">
              <div class="panel-title-wrapper border-blue"><h2>Merchant Targets</h2><p>Your monthly Placed and Delivered GMV targets vs actuals, MTD target and month-end run rate</p></div>
              <div class="table-controls"><input id="tgSearch" class="mp-search" type="search" placeholder="Search Merchant..." autocomplete="off" spellcheck="false"></div>
            </div>
            <div class="table-responsive">
              <table class="data-table" id="tgTable">
                <thead><tr>
                  <th data-k="index" title="Row number.">#</th><th data-k="id" title="Merchant's unique ID.">ID</th><th data-k="name" title="Merchant's name.">Merchant Name</th>
                  <th data-k="targetPlaced" class="num" title="Monthly placed-orders target.">Target Placed</th>
                  <th data-k="mtdTargetPlaced" class="num" title="Placed target pro-rated to the days elapsed until yesterday.">MTD Target Placed</th>
                  <th data-k="placed" class="num" title="Actual placed orders.">Placed</th>
                  <th data-k="placedRunRate" class="num" title="Projected end-of-month placed orders at the current daily pace.">Placed Run Rate (EOM)</th>
                  <th data-k="placedAchievedPct" class="num" title="Placed ÷ monthly target.">Placed vs Target %</th>
                  <th data-k="placedMtdPct" class="num" title="Placed ÷ MTD target.">Placed vs MTD %</th>
                  <th data-k="targetGmv" class="num" title="Monthly delivered-GMV target.">Target GMV</th>
                  <th data-k="mtdTargetGmv" class="num" title="GMV target pro-rated to the days elapsed until yesterday.">MTD Target GMV</th>
                  <th data-k="deliveredGmv" class="num" title="Actual delivered GMV.">Delivered GMV</th>
                  <th data-k="runRate" class="num" title="Projected end-of-month delivered GMV at the current daily pace.">GMV Run Rate (EOM)</th>
                  <th data-k="achievedPct" class="num" title="Delivered GMV ÷ monthly target.">GMV vs Target %</th>
                  <th data-k="gmvMtdPct" class="num" title="Delivered GMV ÷ MTD target.">GMV vs MTD %</th>
                </tr></thead>
                <tbody id="tgBody"></tbody>
              </table>
            </div>
            <div class="table-footer"><span id="tgCount">0 Merchants</span><div class="pager"><button id="tgPrev" class="btn btn-outline small" type="button">Prev</button><span id="tgInd">Page 1 of 1</span><button id="tgNext" class="btn btn-outline small" type="button">Next</button></div></div>
          </div>
        </section>

        <section class="table-section mt-4">
          <div class="panel table-panel hover-glow">
            <div class="panel-head-modern">
              <div class="panel-title-wrapper border-orange"><h2>Merchant Segmentation &amp; Projections</h2><p>Current segment vs projected EOM segment based on Confirmed Orders Run Rate</p></div>
              <div class="table-controls"><input id="sgSearch" class="mp-search" type="search" placeholder="Search Merchant..." autocomplete="off" spellcheck="false"></div>
            </div>
            <div class="table-responsive">
              <table class="data-table" id="sgTable">
                <thead><tr>
                  <th data-k="index" title="Row number.">#</th><th data-k="id" title="Merchant's unique ID.">ID</th><th data-k="name" title="Merchant's name.">Merchant Name</th>
                  <th data-k="currentSegment" title="Merchant's segment, from the merchant classification data.">Current Segment</th>
                  <th data-k="segConfirmed" class="num" title="Confirmed orders for the selected month.">Confirmed Orders</th>
                  <th data-k="rrConfirmed" class="num" title="Projected month-end confirmed orders, extrapolated from the daily average so far this month.">RR Confirmed (EOM)</th>
                  <th data-k="projectedSegment" title="Segment the merchant would land in if the projected month-end run rate holds.">Projected Segment</th>
                </tr></thead>
                <tbody id="sgBody"></tbody>
              </table>
            </div>
            <div class="table-footer"><span id="sgCount">0 Merchants</span><div class="pager"><button id="sgPrev" class="btn btn-outline small" type="button">Prev</button><span id="sgInd">Page 1 of 1</span><button id="sgNext" class="btn btn-outline small" type="button">Next</button></div></div>
          </div>
        </section>
      </div>

      <div id="viewSp" class="view-section hidden">
        <section class="mb-4">
          <div class="metrics-grid"><div class="metric-card hover-glow"><div class="metric-title">Total Matches <span class="icon-box"></span></div><div class="metric-value" id="spTotal">0</div><div class="metric-sub text-dim">Active products in your plan</div></div><div class="metric-card hover-glow highlight-card"><div class="metric-title text-green">On Track (Achieved MTD) <span class="icon-check"></span></div><div class="metric-value text-green" id="spAch">0</div><div class="metric-sub text-dim">Matches hitting target</div></div><div class="metric-card hover-glow"><div class="metric-title text-red">Missed Target MTD <span class="icon-trend"></span></div><div class="metric-value text-red" id="spMiss">0</div><div class="metric-sub text-dim">Needs attention</div></div><div class="metric-card hover-glow"><div class="metric-title text-blue">Overall MTD Achievement <span class="icon-calendar"></span></div><div class="metric-value text-blue" id="spOvAct">0</div><div class="metric-sub text-dim">Target MTD: <span id="spOvTgt">0</span></div></div></div>
          <div class="metrics-grid mt-4"><div class="metric-card hover-glow"><div class="metric-title text-red">Critical <span class="icon-trend"></span></div><div class="metric-value text-red" id="spCrit">0</div><div class="metric-sub text-dim">% of MTD: 0% – 50%</div></div><div class="metric-card hover-glow"><div class="metric-title text-blue">Good <span class="icon-check"></span></div><div class="metric-value text-blue" id="spGood">0</div><div class="metric-sub text-dim">% of MTD: 50% – 85%</div></div><div class="metric-card hover-glow"><div class="metric-title text-green">Excellent <span class="icon-check"></span></div><div class="metric-value text-green" id="spExc">0</div><div class="metric-sub text-dim">% of MTD: 85% – 100%</div></div><div class="metric-card hover-glow highlight-card"><div class="metric-title text-purple">Upside <span class="icon-calendar"></span></div><div class="metric-value text-purple" id="spUp">0</div><div class="metric-sub text-dim">% of MTD: 100%+</div></div></div>
        </section>
        <section class="table-section mt-4">
          <div class="panel table-panel hover-glow">
            <div class="panel-head-modern">
              <div class="panel-title-wrapper border-purple"><h2>Sales Plan Tracking</h2><p>Placed / Confirmed / Delivered / GMV — Target MTD, Run Rate &amp; Achievement % per SKU</p></div>
              <div class="table-controls"><input id="spSearch" class="mp-search" type="search" placeholder="Search Product or Category..." autocomplete="off" spellcheck="false"></div>
            </div>
            <div class="table-responsive">
              <table class="data-table sp-one" id="spTable">
                <thead>
                  <tr>
                    <th rowspan="2" data-k="productId" title="Product identifier.">Product ID</th>
                    <th rowspan="2" data-k="productName" title="Product name.">Product Name</th>
                    <th rowspan="2" data-k="merchantName" class="sp-mcol" title="Merchant.">Merchant</th>
                    <th rowspan="2" data-k="category" title="Product category.">Category</th>
                    <th colspan="4" class="center" title="Pieces placed on orders for this SKU.">Placed Pieces</th>
                    <th colspan="4" class="center" title="Pieces confirmed for this SKU.">Confirmed Pieces</th>
                    <th colspan="4" class="center" title="Pieces delivered for this SKU.">Delivered Pieces</th>
                    <th colspan="4" class="center" title="Delivered revenue for this SKU.">Delivered GMV</th>
                    <th rowspan="2" data-k="crPct" class="num" title="Confirmed ÷ Placed for this SKU (CR_2_DAY). Used to derive the Confirmed MTD Target from the Placed target.">CR%</th>
                    <th rowspan="2" data-k="drPct" class="num" title="Delivered ÷ Confirmed for this SKU (DR_5_DAYS). Used to derive the Delivered MTD Target.">DR%</th>
                    <th rowspan="2" data-k="ndrPct" class="num" title="CR% × DR% for this SKU.">NDR%</th>
                    <th rowspan="2" data-k="asp" class="num" title="Average selling price for this SKU. Used to derive the Delivered GMV MTD Target.">ASP</th>
                    <th rowspan="2" data-k="wowPct" class="center" title="Change in Confirmed Pieces this week vs last week.">WoW (Confirmed)</th>
                    <th rowspan="2" data-k="mtdAchievedPct" class="center" title="Overall performance tier based on Confirmed Pieces achievement %.">Status</th>
                  </tr>
                  <tr><th data-k="placedMtdTarget" class="num text-dim" title="Month-to-date target: daily target × days elapsed until yesterday.">MTD Target</th><th data-k="placedMtdActual" class="num" title="Actual pieces achieved so far this month, until yesterday.">Actual</th><th data-k="placedRunRate" class="num" title="Projected month-end close at the current daily pace.">Run Rate</th><th data-k="placedAchievedPct" class="num" title="Actual ÷ MTD Target, as a percentage.">Ach%</th><th data-k="confirmedMtdTarget" class="num text-dim" title="Month-to-date target: daily target × days elapsed until yesterday.">MTD Target</th><th data-k="confirmedMtdActual" class="num" title="Actual pieces achieved so far this month, until yesterday.">Actual</th><th data-k="confirmedRunRate" class="num" title="Projected month-end close at the current daily pace.">Run Rate</th><th data-k="confirmedAchievedPct" class="num" title="Actual ÷ MTD Target, as a percentage.">Ach%</th><th data-k="deliveredMtdTarget" class="num text-dim" title="Month-to-date target: daily target × days elapsed until yesterday.">MTD Target</th><th data-k="deliveredMtdActual" class="num" title="Actual pieces achieved so far this month, until yesterday.">Actual</th><th data-k="deliveredRunRate" class="num" title="Projected month-end close at the current daily pace.">Run Rate</th><th data-k="deliveredAchievedPct" class="num" title="Actual ÷ MTD Target, as a percentage.">Ach%</th><th data-k="gmvMtdTarget" class="num text-dim" title="Month-to-date target: daily target × days elapsed until yesterday.">MTD Target</th><th data-k="gmvMtdActual" class="num" title="Actual GMV achieved so far this month, until yesterday.">Actual</th><th data-k="gmvRunRate" class="num" title="Projected month-end close at the current daily pace.">Run Rate</th><th data-k="gmvAchievedPct" class="num" title="Actual ÷ MTD Target, as a percentage.">Ach%</th></tr>
                </thead>
                <tbody id="spBody"></tbody>
              </table>
            </div>
            <div class="table-footer"><span id="spCount">0 SKUs</span><div class="pager"><button id="spPrev" class="btn btn-outline small" type="button">Prev</button><span id="spInd">Page 1 of 1</span><button id="spNext" class="btn btn-outline small" type="button">Next</button></div></div>
          </div>
        </section>
      </div>
      <div id="viewInv" class="view-section hidden">
        <section class="mb-4">
          <div class="metrics-grid">
            <div class="metric-card hover-glow"><div class="metric-title">Your SKUs <span class="icon-box"></span></div><div class="metric-value" id="invTotal">0</div><div class="metric-sub text-dim">Products you sell or have a plan for</div></div>
            <div class="metric-card hover-glow"><div class="metric-title text-green">In Stock <span class="icon-check"></span></div><div class="metric-value text-green" id="invIn">0</div><div class="metric-sub text-dim">Stock available at Taager</div></div>
            <div class="metric-card hover-glow"><div class="metric-title text-orange">Low Cover <span class="icon-trend"></span></div><div class="metric-value text-orange" id="invLow">0</div><div class="metric-sub text-dim">In stock, but under 7 days of cover</div></div>
            <div class="metric-card hover-glow"><div class="metric-title text-red">Out of Stock <span class="icon-box"></span></div><div class="metric-value text-red" id="invOut">0</div><div class="metric-sub text-dim">No stock available</div></div>
          </div>
        </section>
        <section class="table-section mt-4">
          <div class="panel table-panel hover-glow">
            <div class="panel-head-modern">
              <div class="panel-title-wrapper border-green"><h2>Inventory</h2><p>Stock and days of cover (DOH) for your SKUs, with your own recent demand</p></div>
              <div class="table-controls"><input id="invSearch" class="mp-search" type="search" placeholder="Search SKU, Product or Category..." autocomplete="off" spellcheck="false"></div>
            </div>
            <div class="table-responsive">
              <table class="data-table" id="invTable">
                <thead><tr>
                  <th data-k="skuId" title="Product identifier.">SKU ID</th>
                  <th data-k="skuName" title="Product name.">Product Name</th>
                  <th data-k="category" title="Product category.">Category</th>
                  <th data-k="stock" class="num" title="Units available at Taager right now.">Stock</th>
                  <th data-k="doh" class="num" title="Days of cover: stock divided by the average daily confirmed demand of the last 3 days.">DOH</th>
                  <th data-k="availability" title="Availability on the Taager catalogue.">Availability</th>
                  <th data-k="placedYday" class="num" title="Your placed orders for this SKU yesterday.">Placed (Yday)</th>
                  <th data-k="confYday" class="num" title="Your confirmed orders for this SKU yesterday.">Confirmed (Yday)</th>
                  <th data-k="avg3d" class="num" title="Your average confirmed orders per day, last 3 days.">Avg Conf / Day (3d)</th>
                  <th data-k="avg15d" class="num" title="Your average confirmed orders per day, last 15 days.">Avg Conf / Day (15d)</th>
                  <th data-k="trend" title="3-day average vs 15-day average: Hot above +20%, Cooling below -20%.">Trend</th>
                  <th data-k="placed30" class="num" title="Your placed orders for this SKU in the last 30 days.">Placed (30d)</th>
                </tr></thead>
                <tbody id="invBody"></tbody>
              </table>
            </div>
            <div class="table-footer"><span id="invCount">0 SKUs</span><div class="pager"><button id="invPrev" class="btn btn-outline small" type="button">Prev</button><span id="invInd">Page 1 of 1</span><button id="invNext" class="btn btn-outline small" type="button">Next</button></div></div>
          </div>
        </section>
      </div>

      <div id="viewInc" class="view-section hidden">
        <section class="mb-4">
          <div class="panel-head-modern mp-mb12"><div class="panel-title-wrapper border-purple"><h2>Your Incentive</h2><p>Monthly Confirmed Orders target &amp; bonus — Actual (MTD) vs. Run Rate for <span id="incMonth">this month</span></p></div></div>
          <div class="metrics-grid">
            <div class="metric-card hover-glow"><div class="metric-title">Incentive Accounts <span class="icon-box"></span></div><div class="metric-value" id="incTotal">0</div><div class="metric-sub text-dim">Your Merchant IDs on the incentive plan</div></div>
            <div class="metric-card hover-glow"><div class="metric-title text-green">Achieved Target (Actual) <span class="icon-check"></span></div><div class="metric-value text-green" id="incAch">0 / 0</div><div class="metric-sub text-dim">MTD Confirmed Orders ≥ Target</div></div>
            <div class="metric-card hover-glow"><div class="metric-title text-blue">Projected to Achieve (Run Rate) <span class="icon-trend"></span></div><div class="metric-value text-blue" id="incOn">0 / 0</div><div class="metric-sub text-dim">Includes accounts already achieved</div></div>
            <div class="metric-card hover-glow"><div class="metric-title text-red">At Risk <span class="icon-box"></span></div><div class="metric-value text-red" id="incRisk">0</div><div class="metric-sub text-dim">Run Rate still below Target</div></div>
            <div class="metric-card hover-glow"><div class="metric-title text-green">Earned Bonus (Actual) <span class="icon-check"></span></div><div class="metric-value text-green" id="incEarned">EGP 0</div><div class="metric-sub text-dim">Extra Orders (MTD) × Bonus/Order</div></div>
            <div class="metric-card hover-glow"><div class="metric-title text-purple">Bonus (Target) <span class="icon-check"></span></div><div class="metric-value text-purple" id="incBt">EGP 0</div><div class="metric-sub text-dim">Target × Bonus/Order, if Run Rate hits target</div></div>
            <div class="metric-card hover-glow"><div class="metric-title text-orange">Total Bonus <span class="icon-check"></span></div><div class="metric-value text-orange" id="incTb">EGP 0</div><div class="metric-sub text-dim">Bonus (Target) + Earned Bonus (MTD)</div></div>
          </div>
        </section>
        <section class="table-section mt-4">
          <div class="panel table-panel hover-glow">
            <div class="panel-head-modern">
              <div class="panel-title-wrapper border-purple"><h2>Incentive — Detail</h2><p>Target Confirmed Orders vs. Actual (MTD) &amp; Run Rate, with the bonus earned and projected</p></div>
              <div class="table-controls"><input id="incSearch" class="mp-search" type="search" placeholder="Search Merchant ID or Name..." autocomplete="off" spellcheck="false"></div>
            </div>
            <div class="table-responsive">
              <table class="data-table" id="incTable">
                <thead><tr>
                  <th data-k="id" title="Merchant identifier.">Merchant ID</th>
                  <th data-k="name" title="Merchant name.">Merchant Name</th>
                  <th data-k="tier" title="Your incentive tier.">Tier</th>
                  <th data-k="target" class="num" title="Target Confirmed Orders for this month.">Target Confirmed</th>
                  <th data-k="targetMtd" class="num text-dim" title="Target pro-rated to today (Target ÷ days in month × days elapsed) — the pace needed so far.">Target Confirmed MTD</th>
                  <th data-k="mtd" class="num text-green" title="Confirmed Orders so far this month.">Confirmed (MTD)</th>
                  <th data-k="runRate" class="num text-orange" title="MTD Confirmed Orders projected to the end of the month.">Run Rate (EOM)</th>
                  <th data-k="attActual" class="num" title="Confirmed (MTD) ÷ Target.">Attainment % (Actual)</th>
                  <th data-k="attRun" class="num" title="Run Rate (EOM) ÷ Target.">Attainment % (Run Rate)</th>
                  <th data-k="status" title="Achieved = already hit the target. On Track = projected to hit it by the end of the month. At Risk = projected to miss it.">Status</th>
                  <th data-k="bonusPerOrder" class="num text-dim" title="Bonus per confirmed order.">Bonus / Order</th>
                  <th data-k="extra" class="num text-green" title="Orders confirmed above the target so far.">Extra Orders (MTD)</th>
                  <th data-k="earned" class="num text-green" title="Extra Orders × Bonus per order.">Earned Bonus (MTD)</th>
                  <th data-k="bonusTarget" class="num text-purple" title="If the run rate is projected to hit the target: Target × Bonus per order. Zero otherwise.">Bonus (Target)</th>
                  <th data-k="totalBonus" class="num text-orange" title="Bonus (Target) + Earned Bonus (MTD).">Total Bonus</th>
                </tr></thead>
                <tbody id="incBody"></tbody>
              </table>
            </div>
            <div class="table-footer"><span id="incCount">0 Accounts</span><div class="pager"><button id="incPrev" class="btn btn-outline small" type="button">Prev</button><span id="incInd">Page 1 of 1</span><button id="incNext" class="btn btn-outline small" type="button">Next</button></div></div>
          </div>
        </section>
      </div>

      <div id="viewAl" class="view-section hidden">
        <section class="mb-4">
          <div class="panel-head-modern mp-mb12"><div class="panel-title-wrapper border-orange"><h2>Alert Center</h2><p>Updates and alerts from your Taager team</p></div><div class="table-controls"><button class="btn btn-outline small" id="alRead" type="button">Mark all as read</button></div></div>
          <div id="alList" class="mp-alerts"></div>
        </section>
      </div>
      <p class="mp-foot" id="foot"></p>
    </main>
  </div>
</div>

<div class="mp-modal hidden" id="chgModal" role="dialog" aria-modal="true" aria-labelledby="chgTitle">
  <form id="chgForm" novalidate>
    <h2 id="chgTitle">Change password</h2>
    <label>Current password<input id="cCur" type="password" autocomplete="current-password" required></label>
    <label>New password<input id="cNew" type="password" autocomplete="new-password" required></label>
    <label>Repeat new password<input id="cNew2" type="password" autocomplete="new-password" required></label>
    <div class="mp-msg" id="cMsg" role="alert"></div>
    <div class="mp-btns"><button class="btn btn-outline" type="button" id="chgCancel">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
  </form>
</div>
</body></html>`;

export const DASH_JS = SHARED_JS + String.raw`
// Same definitions as the staff dashboard (js/app.js): CR = Confirmed ÷ Placed, DR = Delivered ÷ Confirmed, NDR = CR × DR;
// targets use tgtTiming / tgtMetrics; segments use getSegmentLogic. Row = [month, placedOrders, confirmedOrders, deliveredOrders,
// placedPcs, confirmedPcs, deliveredPcs, deliveredGmv, segmentLabel].
var D = { rows: [], merchants: [], byId: [], updatedAt: "" }, INV = null, INC = null, AL = null, TG = {}, SP = {}, SPB = {}, pipeMetric = "pieces", curView = "ov", PAGE_SIZE = 10;
var fmtInt = new Intl.NumberFormat("en-US");
function fmtPct(n) { return (n || 0).toFixed(1) + "%"; }
function fmtMoney(n) { if (!n) return "EGP 0"; var s = n < 0 ? "-" : "", a = Math.abs(n); if (a >= 1e6) return s + "EGP " + (a / 1e6).toFixed(2) + "M"; if (a >= 1e3) return s + "EGP " + Math.round(a / 1e3) + "K"; return s + "EGP " + Math.round(a); }
function cInt(n) { return fmtInt.format(Math.round(n || 0)); }
var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function monthTitle(k) { var p = k.split("-"); return MONTHS[+p[1] - 1] + " " + p[0]; }
function shortMonth(k) { var p = k.split("-"); return MONTHS[+p[1] - 1].slice(0, 3) + " " + p[0].slice(2); }
function daysIn(k) { var p = k.split("-"); return new Date(+p[0], +p[1], 0).getDate(); }
function daysCounted(k) { var now = new Date(); if (k !== ymd(now).slice(0, 7)) return daysIn(k); return Math.max(1, now.getDate() - 1); }
function note(t) { var n = $("dataNote"); if (!t) { n.classList.add("hidden"); return; } n.textContent = t; n.classList.remove("hidden"); }

// ---- load
function start() {
  api("/api/me").then(function (me) { $("whoEmail").textContent = me.email; loadData(); }).catch(function () { location.replace("/"); });
}
function loadData() {
  note("");
  return api("/api/data").then(function (d) {
    D = d; TG = {}; SP = {}; SPB = {};
    var names = d.merchants.map(function (m) { return m.name; }).filter(Boolean);
    $("mName").textContent = names.length ? names.join(" · ") : "Your store"; $("acAv").textContent = (names[0] || "T").trim().charAt(0).toUpperCase() || "T";
    $("mIds").textContent = "Merchant · ID " + d.merchants.map(function (m) { return m.id; }).join(", ");
    $("sidebarUpdated").textContent = "Live — updated " + new Date(d.updatedAt).toLocaleString();
    $("foot").textContent = "Numbers updated " + new Date(d.updatedAt).toLocaleString();
    fillMonths();
    if (!d.rows.length) note("No orders yet for your Merchant ID. If this looks wrong, contact your Taager account manager.");
    loadExtras();
    return refresh();
  }).catch(function (e) { if (e.status === 401) { location.replace("/"); return; } note(e.message); });
}
function fillMonths() {
  var set = {}; D.rows.forEach(function (r) { set[r[0]] = 1; });
  var cur = ymd(new Date()).slice(0, 7); set[cur] = 1;
  var keys = Object.keys(set).sort().reverse(), sel = $("monthSel"), keep = sel.value;
  sel.innerHTML = keys.map(function (k) { return '<option value="' + k + '">' + monthTitle(k) + "</option>"; }).join("");
  sel.value = keep && set[keep] ? keep : cur;
}
function refresh() {
  var k = $("monthSel").value;
  renderOverview(); renderAll();
  var jobs = [];
  if (!TG[k]) jobs.push(api("/api/targets?month=" + encodeURIComponent(k)).then(function (t) {
    TG[k] = t; if ($("monthSel").value === k) { renderAll(); if (t.note) note(t.note); }
  }).catch(function (e) { if (e.status === 401) { location.replace("/"); return; } note("Targets could not be loaded: " + e.message); }));
  if (!SP[k]) jobs.push(api("/api/salesplan?month=" + encodeURIComponent(k)).then(function (t) {
    SP[k] = t; delete SPB[k]; if ($("monthSel").value === k) { renderAll(); if (t.note) note(t.note); }
  }).catch(function (e) { if (e.status === 401) { location.replace("/"); return; } SP[k] = { plans: [], act: [], stats: {}, today: null, note: "Sales Plan could not be loaded: " + e.message }; renderAll(); }));
  return Promise.all(jobs);
}

// ---- tabs
var TITLES = { ov: ["Over View", "Your demand, pipeline & delivery numbers"], tg: ["Merchant Target", "Targets vs actuals, and segment projections"], sp: ["Sales Plan", "Your SKU targets vs actuals, run rate and status"], inv: ["Inventory", "Stock and days of cover for your SKUs"], inc: ["Incentives Tracker", "Your monthly confirmed-orders target and bonus"], al: ["Alert Center", "Updates and alerts from your Taager team"] };
function go(v) {
  if (curView === "al" && v !== "al") markAlertsRead();
  curView = v;
  document.querySelectorAll(".sidebar-nav .nav-item").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-view") === v); });
  ["ov", "tg", "sp", "inv", "inc", "al"].forEach(function (x) { var e = $("view" + x[0].toUpperCase() + x.slice(1)); e.classList.toggle("hidden", x !== v); e.classList.toggle("active-view", x === v); });
  $("monthWrap").classList.toggle("hidden", v === "inv" || v === "inc" || v === "al");
  $("pgTitle").textContent = TITLES[v][0]; $("pgSub").textContent = TITLES[v][1];
  if (v === "ov") renderOverview();
  if (v === "al") renderAlerts();
}
document.querySelector(".sidebar-nav").addEventListener("click", function (e) { var a = e.target.closest(".nav-item"); if (a) go(a.getAttribute("data-view")); });

// ---- Over View
function rowsOf(k) { return D.rows.filter(function (r) { return r[0] === k; }); }
function sumRows(rows) { var T = { po: 0, co: 0, do: 0, pp: 0, cp: 0, dp: 0, gmv: 0 }; rows.forEach(function (r) { T.po += r[1]; T.co += r[2]; T.do += r[3]; T.pp += r[4]; T.cp += r[5]; T.dp += r[6]; T.gmv += r[7]; }); return T; }
function monthsUpTo(k, n) { var o = {}; D.rows.forEach(function (r) { o[r[0]] = 1; }); var all = Object.keys(o).sort().filter(function (m) { return m <= k; }); return all.slice(-n); }
function monthSum(m) { return sumRows(rowsOf(m)); }
function spark(values, color) {
  if (!values || values.length < 2) return "";
  var w = 150, h = 30, max = Math.max.apply(null, values), min = Math.min.apply(null, values), span = (max - min) || 1;
  var pts = values.map(function (v, i) { return [(i * (w - 2) / (values.length - 1)) + 1, h - 3 - ((v - min) / span) * (h - 6)]; });
  var line = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("");
  return '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + line + "L" + (w - 1) + " " + h + 'L1 ' + h + 'Z" fill="' + color + '" opacity=".14"/><path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
}
function ring(pct) {
  var S = 200, r = 82, c = S / 2, circ = 2 * Math.PI * r, len = circ * 0.75, v = Math.max(0, Math.min(100, pct || 0)) / 100, rot = "rotate(135 " + c + " " + c + ")";
  return '<svg viewBox="0 0 ' + S + " " + S + '" width="' + S + '" height="' + S + '" role="img" aria-label="Net delivery rate ' + pct.toFixed(1) + '%">' +
    '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--line-light)" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + len + " " + circ + '" transform="' + rot + '"/>' +
    '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + Math.max(2, len * v) + " " + circ + '" transform="' + rot + '"/>' +
    '<text x="' + c + '" y="' + (c + 6) + '" text-anchor="middle" font-size="38" font-weight="800" fill="var(--text)">' + pct.toFixed(1) + '%</text>' +
    '<text x="' + c + '" y="' + (c + 30) + '" text-anchor="middle" font-size="12" fill="var(--text-dim)">Net delivery rate</text></svg>';
}
function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function renderOverview() {
  if (!D.rows) return;
  var k = $("monthSel").value, T = sumRows(rowsOf(k)), set = function (id, v) { $(id).textContent = v; };
  var cr = T.po ? T.co / T.po : 0, dr = T.co ? T.do / T.co : 0;
  $("ovRing").innerHTML = ring(cr * dr * 100);
  set("crVal", fmtPct(cr * 100)); set("drVal", fmtPct(dr * 100));
  set("vPlaced", cInt(T.pp)); set("vConfirmed", cInt(T.cp)); set("vDelivered", cInt(T.dp));
  set("oPlaced", cInt(T.po) + " orders"); set("oConfirmed", cInt(T.co) + " orders"); set("oDelivered", cInt(T.do) + " orders");
  set("vGmv", fmtMoney(T.gmv));
  if (k === ymd(new Date()).slice(0, 7)) {
    var f = daysIn(k) / daysCounted(k);
    set("rPlaced", "Run Rate: " + cInt(T.pp * f) + " by EOM"); set("rConfirmed", "Run Rate: " + cInt(T.cp * f) + " by EOM");
    set("rDelivered", "Run Rate: " + cInt(T.dp * f) + " by EOM"); set("rGmv", "Run Rate: " + fmtMoney(T.gmv * f) + " by EOM");
  } else ["rPlaced", "rConfirmed", "rDelivered", "rGmv"].forEach(function (id) { set(id, "Full month"); });
  var ms = monthsUpTo(k, 6), sums = ms.map(monthSum);
  $("sPlaced").innerHTML = spark(sums.map(function (x) { return x.pp; }), "#60a5fa");
  $("sConfirmed").innerHTML = spark(sums.map(function (x) { return x.cp; }), "#8b5cf6");
  $("sDelivered").innerHTML = spark(sums.map(function (x) { return x.dp; }), "#2dd4a8");
  $("sGmv").innerHTML = spark(sums.map(function (x) { return x.gmv; }), "#10b981");
  renderPipe(k);
  // avg placed pieces per day
  var days = daysCounted(k), avg = T.pp / days, all = monthsUpTo(k, 12), per = all.map(function (m) { return monthSum(m).pp / daysCounted(m); });
  set("avgVal", cInt(avg)); set("avgPcs", cInt(T.pp)); set("avgDays", String(days));
  var pm = all.length > 1 ? all[all.length - 2] : "", pa = pm ? monthSum(pm).pp / daysCounted(pm) : 0;
  set("avgPrev", pm ? shortMonth(pm) + " · " + cInt(pa) + "/day" : "—");
  set("avgChg", pm && pa ? ((avg - pa) / pa * 100 >= 0 ? "+" : "") + ((avg - pa) / pa * 100).toFixed(1) + "%" : "—");
  var bi = -1, bv = -1; per.forEach(function (v, i) { if (v > bv) { bv = v; bi = i; } });
  set("avgBest", bi >= 0 ? shortMonth(all[bi]) + " · " + cInt(bv) + "/day" : "—");
  $("avgSpark").innerHTML = spark(per, "#f59e0b");
}
function dailyOf(k) {
  var out = {};
  (D.byId || []).forEach(function (m) { (m.daily || []).forEach(function (r) { if (r[0].slice(0, 7) === k) { var o = out[r[0]] || (out[r[0]] = [r[0], 0, 0, 0, 0, 0, 0, 0]); for (var i = 1; i < 8; i++) o[i] += r[i]; } }); });
  return out;
}
function renderPipe(k) {
  var box = $("pipeChart"), isP = pipeMetric === "pieces";
  $("pipeSub").textContent = isP ? "Confirmed Pieces (bars) vs Placed Pieces (line) per day" : "Confirmed Orders (bars) vs Placed Orders (line) per day";
  var dm = dailyOf(k), tot = daysIn(k), n = tot, now = new Date(), cp = k.split("-");
  if (+cp[0] === now.getFullYear() && +cp[1] - 1 === now.getMonth()) n = Math.min(tot, now.getDate());
  else { n = 0; for (var q = 1; q <= tot; q++) if (dm[k + "-" + String(q).padStart(2, "0")]) n = q; }
  var data = [], any = false;
  for (var d = 1; d <= n; d++) {
    var key = k + "-" + String(d).padStart(2, "0"), r = dm[key]; if (r) any = true;
    data.push({ d: d, key: key, c: r ? (isP ? r[5] : r[2]) : 0, p: r ? (isP ? r[4] : r[1]) : 0, has: !!r });
  }
  if (!any) { box.innerHTML = '<div class="mp-empty">' + (D.dailyOn ? "No daily numbers for " + monthTitle(k) + " yet." : "Daily numbers are not switched on yet.") + "</div>"; return; }
  var W = Math.max(320, box.clientWidth || 640), H = 340, L = 52, R = 14, Tp = 26, B = 32, iw = W - L - R, ih = H - Tp - B;
  var mx = niceMax(Math.max.apply(null, data.map(function (x) { return Math.max(x.c, x.p); })) || 1), bw = Math.max(6, Math.min(46, iw / n * 0.62)), svg = "";
  var fs = iw / n >= 30 ? 11 : iw / n >= 22 ? 10 : 9, showVal = iw / n >= 20;
  function cmp(v) { v = Math.round(v); return v >= 10000 ? (v / 1000).toFixed(0) + "K" : v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(v); }
  for (var i = 0; i <= 4; i++) { var y = Tp + ih - (ih * i / 4); svg += '<line class="mp-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text class="mp-ax" x="' + (L - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + fmtInt.format(Math.round(mx * i / 4)) + "</text>"; }
  var pts = [], step = iw / n >= 18 ? 1 : 2;
  data.forEach(function (x, i) {
    var cx = L + iw * (i + 0.5) / n, hc = ih * x.c / mx;
    svg += '<rect class="mp-bar" x="' + (cx - bw / 2) + '" y="' + (Tp + ih - hc) + '" width="' + bw + '" height="' + Math.max(0, hc) + '" rx="3"/>';
    if (showVal && x.has && hc > fs + 8) svg += '<text x="' + cx + '" y="' + (Tp + ih - hc + fs + 4) + '" text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="#06231a">' + cmp(x.c) + "</text>";
    if (x.d === 1 || x.d % step === 0 || x.d === n) svg += '<text class="mp-ax" x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle">' + x.d + "</text>";
    if (x.has) pts.push([cx, Tp + ih - ih * x.p / mx, x.p]);
  });
  svg += '<path class="mp-line" d="' + pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("") + '"/>';
  pts.forEach(function (p) { svg += '<circle class="mp-dot" cx="' + p[0] + '" cy="' + p[1] + '" r="3.5"/>'; if (showVal) svg += '<text class="mp-ax" x="' + p[0] + '" y="' + (p[1] - 9) + '" text-anchor="middle" font-size="' + fs + '" font-weight="700">' + cmp(p[2]) + "</text>"; });
  data.forEach(function (x, i) { var x0 = L + iw * i / n; svg += '<rect class="mp-hov" x="' + x0 + '" y="' + Tp + '" width="' + (iw / n) + '" height="' + ih + '"><title>' + x.key + " — Confirmed " + fmtInt.format(Math.round(x.c)) + " · Placed " + fmtInt.format(Math.round(x.p)) + "</title></rect>"; });
  box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img">' + svg + '</svg><div class="mp-legend"><span><i></i>Confirmed</span><span><i class="l"></i>Placed</span></div>';
}

// ---- Merchant Targets (js/app.js tgtTiming / tgtMetrics / renderTgtView)
function tgtTiming(k) {
  var p = k.split("-"), y = +p[0], m = +p[1] - 1, now = new Date(), totalDays = new Date(y, m + 1, 0).getDate(), elapsed = totalDays, cur = false;
  if (m === now.getMonth() && y === now.getFullYear()) { elapsed = now.getDate() || 1; cur = true; }
  return { elapsedDays: elapsed, totalDays: totalDays, mtdDays: cur ? Math.max(1, elapsed - 1) : totalDays };
}
function tgtMetrics(targetGmv, targetPlaced, deliveredGmv, placed, t) {
  var mtdG = (targetGmv / t.totalDays) * t.mtdDays, mtdP = (targetPlaced / t.totalDays) * t.mtdDays;
  return {
    targetGmv: targetGmv, targetPlaced: targetPlaced, mtdTargetGmv: mtdG, mtdTargetPlaced: mtdP,
    runRate: (deliveredGmv / t.elapsedDays) * t.totalDays, placedRunRate: (placed / t.elapsedDays) * t.totalDays,
    achievedPct: targetGmv > 0 ? (deliveredGmv / targetGmv) * 100 : 0, gmvMtdPct: mtdG > 0 ? (deliveredGmv / mtdG) * 100 : 0,
    placedAchievedPct: targetPlaced > 0 ? (placed / targetPlaced) * 100 : 0, placedMtdPct: mtdP > 0 ? (placed / mtdP) * 100 : 0
  };
}
function tgtRows(k) {
  var T = (TG[k] && TG[k].targets) || {}, t = tgtTiming(k), out = [];
  (D.byId || []).forEach(function (m) {
    var placed = 0, gmv = 0, tg = T[m.id] || { gmv: 0, placed: 0 };
    m.rows.forEach(function (r) { if (r[0] === k) { placed += r[1]; gmv += r[7]; } });
    if (!(tg.gmv > 0 || tg.placed > 0)) return;
    var o = tgtMetrics(tg.gmv, tg.placed, gmv, placed, t); o.id = m.id; o.name = m.name || tg.name || m.id; o.placed = placed; o.deliveredGmv = gmv; out.push(o);
  });
  return out;
}
function pctCell(v, has) {
  if (!has) return '<td class="num text-dim">-</td>';
  var c = v >= 100 ? "green" : (v < 50 ? "red" : (v < 80 ? "orange" : "blue"));
  return '<td class="num"><div class="pv c-' + c + '">' + v.toFixed(1) + '%</div><div class="progress-bar"><div class="progress-fill ' + c + " w" + Math.max(0, Math.min(100, Math.round(v))) + '"></div></div></td>';
}
function tgtRowHtml(m, n) {
  var hp = m.targetPlaced > 0, hg = m.targetGmv > 0;
  return '<tr><td class="text-dim">#' + n + '</td><td class="font-mono text-dim">' + esc(m.id) + '</td><td class="font-bold text-light">' + esc(m.name) + "</td>" +
    '<td class="num text-dim font-bold">' + (hp ? cInt(m.targetPlaced) : "-") + '</td><td class="num text-dim">' + (hp ? cInt(m.mtdTargetPlaced) : "-") + '</td><td class="num text-blue font-bold">' + cInt(m.placed) + '</td><td class="num font-bold text-light">' + cInt(m.placedRunRate) + "</td>" +
    pctCell(m.placedAchievedPct, hp) + pctCell(m.placedMtdPct, hp) +
    '<td class="num text-dim font-bold">' + (hg ? fmtMoney(m.targetGmv) : "-") + '</td><td class="num text-dim">' + (hg ? fmtMoney(m.mtdTargetGmv) : "-") + '</td><td class="num text-green font-bold">' + fmtMoney(m.deliveredGmv) + '</td><td class="num font-bold text-light">' + fmtMoney(m.runRate) + "</td>" +
    pctCell(m.achievedPct, hg) + pctCell(m.gmvMtdPct, hg) + "</tr>";
}

// ---- Merchant Segmentation & Projections (js/app.js getSegmentLogic / getSegBadgeClass, segElapsedDays)
function getSegmentLogic(o) { if (o === 0) return "In active"; if (o < 5) return "Low Value"; if (o < 50) return "Occasional"; if (o < 150) return "Promising"; if (o < 300) return "Potential Loyalist"; if (o < 1000) return "Loyal Merchants"; return "Champions"; }
function segClass(s) {
  s = s ? s.toLowerCase() : "";
  if (s.indexOf("champions") >= 0) return "seg-champions"; if (s.indexOf("loyal") >= 0) return "seg-loyal"; if (s.indexOf("potential") >= 0) return "seg-potential";
  if (s.indexOf("promising") >= 0) return "seg-promising"; if (s.indexOf("occasional") >= 0) return "seg-occasional"; if (s.indexOf("low value") >= 0) return "seg-lowvalue"; return "seg-inactive";
}
function segRows(k) {
  var t = tgtTiming(k), now = new Date(), cur = k === ymd(now).slice(0, 7);
  var segElapsed = cur ? Math.max(t.elapsedDays - 1, 1) : t.elapsedDays, out = [];
  (D.byId || []).forEach(function (m) {
    var conf = 0, seg = "";
    m.rows.forEach(function (r) { if (r[0] === k) { conf += r[2]; if (r[8]) seg = r[8]; } });
    var rr = (conf / segElapsed) * t.totalDays;
    out.push({ id: m.id, name: m.name || m.id, currentSegment: seg || "In active", segConfirmed: conf, rrConfirmed: rr, projectedSegment: getSegmentLogic(rr) });
  });
  return out;
}
function segRowHtml(m, n) {
  return '<tr><td class="text-dim">#' + n + '</td><td class="font-mono text-dim">' + esc(m.id) + '</td><td class="font-bold text-light">' + esc(m.name) + '</td><td><span class="seg-badge ' + segClass(m.currentSegment) + '">' + esc(m.currentSegment) + '</span></td><td class="num font-bold text-light">' + cInt(m.segConfirmed) + '</td><td class="num font-bold text-blue">' + cInt(m.rrConfirmed) + '</td><td><span class="seg-badge ' + segClass(m.projectedSegment) + '">' + esc(m.projectedSegment) + "</span></td></tr>";
}


// ---- Sales Plan (ported from js/app.js: getMpSalesPlanFinalStatus, mpSpBuildMetric, prepareMpSalesPlanData, mpSpMetricCellsHtml)
function spStatus(pct) {
  if (pct <= 0) return { text: "No Achievement", cls: "gray" };
  if (pct < 50) return { text: "Critical", cls: "red" };
  if (pct < 70) return { text: "Needs Improvement", cls: "orange" };
  if (pct < 85) return { text: "Fair", cls: "yellow" };
  if (pct < 95) return { text: "Good", cls: "blue" };
  if (pct < 105) return { text: "Excellent", cls: "green" };
  if (pct < 120) return { text: "Overachiever", cls: "green" };
  return { text: "Upside", cls: "purple" };
}
function spMetric(dailyTarget, mtdActual, daysUntilYesterday, elapsedDays, monthDays, mtdOverride) {
  var mtdTarget = (mtdOverride !== undefined && mtdOverride !== null) ? mtdOverride : dailyTarget * daysUntilYesterday;
  var monthlyTarget = dailyTarget * monthDays, gap = mtdTarget - mtdActual, runRate = (mtdActual / elapsedDays) * monthDays;
  var achievedPct = mtdTarget > 0 ? (mtdActual / mtdTarget) * 100 : (mtdActual > 0 ? 100 : 0);
  var runRatePct = monthlyTarget > 0 ? (runRate / monthlyTarget) * 100 : (runRate > 0 ? 100 : 0);
  return { dailyTarget: dailyTarget, mtdTarget: mtdTarget, monthlyTarget: monthlyTarget, mtdActual: mtdActual, gap: gap, runRate: runRate, runRatePct: runRatePct, achievedPct: achievedPct, status: spStatus(achievedPct) };
}
function dayAdd(s, n) { var d = new Date(Date.parse(s + "T00:00:00Z") + n * 864e5); return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
function spBuild(k) {
  if (SPB[k]) return SPB[k];
  var P = SP[k], out = { rows: [], sum: { total: 0, ach: 0, miss: 0, tgt: 0, act: 0, crit: 0, good: 0, exc: 0, up: 0 } };
  if (!P || !P.today) return out;
  var today = P.today, tp = today.split("-"), monthDays = new Date(+tp[0], +tp[1], 0).getDate(), elapsed = +tp[2] || 1, dUY = Math.max(1, elapsed - 1);
  var startThis = dayAdd(today, -7), startLast = dayAdd(today, -14), cutoff = dayAdd(today, -5), gmvMature = Math.max(0, elapsed - 5), gmvRR = Math.max(1, gmvMature);
  var acc = {};
  (P.act || []).forEach(function (r) {
    var key = r[1] + "|" + r[2], o = acc[key] || (acc[key] = { placed: 0, confirmed: 0, delivered: 0, gmv: 0, tw: 0, lw: 0 }), d = r[0];
    if (d < today) { o.placed += r[3]; o.confirmed += r[4]; o.delivered += r[5]; if (d <= cutoff) o.gmv += r[6]; }   // stops at yesterday; GMV only for days older than the CM3 lag (5 days)
    if (d >= startThis) o.tw += r[4]; else if (d >= startLast) o.lw += r[4];
  });
  (P.plans || []).forEach(function (pl) {
    var sku = pl[0], mid = pl[3], orig = pl[5] || 0, newT = pl[6], flag = pl[7] || "", upd = pl[8] || "";
    var daily = newT !== null && newT !== undefined ? newT : orig;
    if (!(daily > 0 || newT === 0)) return;               // a plan row with no target at all is not part of the plan
    var raw = acc[sku + "|" + mid] || { placed: 0, confirmed: 0, delivered: 0, gmv: 0, tw: 0, lw: 0 };
    function targetDaysFor(n) {                           // new match: from the update day; changed target: old target before, new target from the update day
      if (!(upd && upd.slice(0, 7) === today.slice(0, 7))) return null;
      var updDay = +upd.slice(8, 10), before = Math.max(0, Math.min(n, updDay - 1)), after = Math.max(0, n - (updDay - 1));
      if (/new/i.test(flag)) return daily * after;
      if (newT !== null && newT !== undefined) return orig * before + newT * after;
      return null;
    }
    var ovP = targetDaysFor(dUY), ovG = targetDaysFor(gmvMature), st = (P.stats && P.stats[sku + "|" + mid]) || [0, 0, 0];
    var cr = st[0] || 0, dr = st[1] || 0, asp = st[2] || 0, crF = cr / 100, drF = dr / 100;
    var cDaily = daily * crF, dDaily = cDaily * drF, gDaily = dDaily * asp;
    var ov = function (m) { return ovP === null ? null : ovP * m; };
    var pM = spMetric(daily, raw.placed, dUY, elapsed, monthDays, ov(1));
    var cM = spMetric(cDaily, raw.confirmed, dUY, elapsed, monthDays, ov(crF));
    var dM = spMetric(dDaily, raw.delivered, dUY, elapsed, monthDays, ov(crF * drF));
    var gM = spMetric(gDaily, raw.gmv, gmvMature, gmvRR, monthDays, ovG === null ? null : ovG * crF * drF * asp);
    var zero = !(daily > 0), pct = cM.achievedPct;
    if (!zero) {
      if (pct < 50) out.sum.crit++; else if (pct < 85) out.sum.good++; else if (pct < 100) out.sum.exc++; else out.sum.up++;
      out.sum.total++; if (cM.mtdActual >= cM.mtdTarget) out.sum.ach++; else out.sum.miss++;
      out.sum.tgt += cM.mtdTarget; out.sum.act += cM.mtdActual;
    }
    var wowPct = 0; if (raw.lw > 0) wowPct = ((raw.tw - raw.lw) / raw.lw) * 100; else if (raw.tw > 0) wowPct = 100;
    var w = wowPct > 10 ? ["spike", "📈"] : wowPct < -10 ? ["decline", "📉"] : ["stable", "➖"];
    out.rows.push({
      productId: sku, productName: pl[1], category: pl[2], tagerId: mid, merchantName: pl[4] || mid, name: pl[1], id: sku,
      metrics: { placed: pM, confirmed: cM, delivered: dM, gmv: gM },
      placedMtdTarget: pM.mtdTarget, placedMtdActual: pM.mtdActual, placedRunRate: pM.runRate, placedAchievedPct: pM.achievedPct,
      confirmedMtdTarget: cM.mtdTarget, confirmedMtdActual: cM.mtdActual, confirmedRunRate: cM.runRate, confirmedAchievedPct: cM.achievedPct,
      deliveredMtdTarget: dM.mtdTarget, deliveredMtdActual: dM.mtdActual, deliveredRunRate: dM.runRate, deliveredAchievedPct: dM.achievedPct,
      gmvMtdTarget: gM.mtdTarget, gmvMtdActual: gM.mtdActual, gmvRunRate: gM.runRate, gmvAchievedPct: gM.achievedPct,
      mtdAchievedPct: pct, finalStatus: cM.status, crPct: cr, drPct: dr, ndrPct: (cr * dr) / 100, asp: asp, wowPct: wowPct, wowClass: w[0], wowIcon: w[1]
    });
  });
  return (SPB[k] = out);
}
function spRows(k) { return spBuild(k).rows; }
function spCells(m, money) {
  var f = function (v) { return money ? fmtMoney(v) : cInt(v); };
  var ach = m.achievedPct >= 100 ? "green" : (m.achievedPct >= 85 ? "orange" : "red"), rr = m.runRatePct >= 100 ? "green" : (m.runRatePct >= 85 ? "orange" : "red");
  return '<td class="num text-dim">' + f(m.mtdTarget) + '</td><td class="num font-bold">' + f(m.mtdActual) + '</td><td class="num"><span class="badge-outline ' + rr + '" title="Projected month-end close vs the full monthly target">' + f(m.runRate) + '</span></td><td class="num"><span class="badge-outline ' + ach + '">' + fmtPct(m.achievedPct) + "</span></td>";
}
function spRowHtml(m) {
  var crC = m.crPct >= 60 ? "green" : (m.crPct >= 50 ? "orange" : "red"), drC = m.drPct >= 35 ? "green" : (m.drPct >= 20 ? "orange" : "red"), ndC = m.ndrPct >= 25 ? "green" : (m.ndrPct >= 15 ? "orange" : "red");
  return '<tr><td class="font-mono text-dim">' + esc(m.productId) + '</td><td class="font-bold truncate-cell" title="' + esc(m.productName) + '">' + esc(m.productName) + '</td><td class="truncate-cell sp-mcol" title="' + esc(m.merchantName) + '">' + esc(m.merchantName) + '</td><td class="text-dim">' + esc(m.category) + "</td>" +
    spCells(m.metrics.placed, false) + spCells(m.metrics.confirmed, false) + spCells(m.metrics.delivered, false) + spCells(m.metrics.gmv, true) +
    '<td class="num"><span class="badge-outline ' + crC + '">' + fmtPct(m.crPct) + '</span></td><td class="num"><span class="badge-outline ' + drC + '">' + fmtPct(m.drPct) + '</span></td><td class="num"><span class="badge-outline ' + ndC + '">' + fmtPct(m.ndrPct) + "</span></td>" +
    '<td class="num">' + (m.asp ? fmtMoney(m.asp) : '<span class="text-dim">-</span>') + '</td><td class="center"><span class="badge-status ' + m.wowClass + '">' + m.wowIcon + " " + (m.wowPct > 0 ? "+" : "") + m.wowPct.toFixed(1) + '%</span></td><td class="center"><span class="badge-outline ' + m.finalStatus.cls + '">' + m.finalStatus.text + "</span></td></tr>";
}
function renderSpSummary(k) {
  var S = spBuild(k).sum, set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
  set("spTotal", fmtInt.format(S.total)); set("spAch", fmtInt.format(S.ach)); set("spMiss", fmtInt.format(S.miss));
  set("spOvAct", fmtInt.format(Math.round(S.act))); set("spOvTgt", fmtInt.format(Math.round(S.tgt)));
  set("spCrit", fmtInt.format(S.crit)); set("spGood", fmtInt.format(S.good)); set("spExc", fmtInt.format(S.exc)); set("spUp", fmtInt.format(S.up));
  $("spTable").classList.toggle("sp-one", !(D.merchants && D.merchants.length > 1));
}

// ---- generic sortable / searchable / paged table
function mkTable(o) {
  var st = { sortKey: o.sortKey, sortDir: o.sortDir, page: 0 };
  function render() {
    var k = $("monthSel").value, term = $(o.search).value.trim().toLowerCase();
    var rows = o.rows(k).filter(function (m) { return !term || (o.match ? o.match(m, term) : (String(m.name).toLowerCase().indexOf(term) >= 0 || String(m.id).indexOf(term) >= 0)); });
    var dir = st.sortDir === "asc" ? 1 : -1, key = st.sortKey;
    rows.sort(function (a, b) { var av = a[key], bv = b[key]; if (typeof av === "string") return av.localeCompare(bv) * dir; return ((av || 0) - (bv || 0)) * dir; });
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); if (st.page > pages - 1) st.page = pages - 1;
    var start = st.page * PAGE_SIZE, html = "";
    rows.slice(start, start + PAGE_SIZE).forEach(function (m, i) { html += o.row(m, start + i + 1); });
    if (!html) html = '<tr class="emptyrow"><td colspan="' + o.cols + '">' + o.empty(k) + "</td></tr>";
    $(o.body).innerHTML = html;
    $(o.count).textContent = fmtInt.format(rows.length) + (o.unit || " Merchants"); $(o.ind).textContent = "Page " + (st.page + 1) + " of " + pages;
    $(o.prev).disabled = st.page === 0; $(o.next).disabled = st.page >= pages - 1;
    document.querySelectorAll("#" + o.table + " thead th").forEach(function (th) { th.classList.toggle("sorted", th.getAttribute("data-k") === st.sortKey); });
  }
  $(o.search).addEventListener("input", function () { st.page = 0; render(); });
  $(o.prev).addEventListener("click", function () { if (st.page > 0) { st.page--; render(); } });
  $(o.next).addEventListener("click", function () { st.page++; render(); });
  $(o.table).querySelector("thead").addEventListener("click", function (e) {
    var th = e.target.closest("th"); if (!th) return; var k = th.getAttribute("data-k"); if (!k || k === "index") return;
    if (st.sortKey === k) st.sortDir = st.sortDir === "asc" ? "desc" : "asc"; else { st.sortKey = k; st.sortDir = (k === "name" || k === "id" || k === "currentSegment" || k === "projectedSegment" || k === "productId" || k === "productName" || k === "merchantName" || k === "category" || k === "skuId" || k === "skuName" || k === "availability" || k === "trend" || k === "tier" || k === "status") ? "asc" : "desc"; }
    st.page = 0; render();
  });
  return { render: render, reset: function () { st.page = 0; } };
}
var tgT = mkTable({ table: "tgTable", body: "tgBody", count: "tgCount", ind: "tgInd", prev: "tgPrev", next: "tgNext", search: "tgSearch", sortKey: "targetGmv", sortDir: "desc", cols: 15, rows: tgtRows, row: tgtRowHtml,
  empty: function (k) { return TG[k] ? "No targets are set for your account in " + esc(monthTitle(k)) + "." : "Loading…"; } });
var sgT = mkTable({ table: "sgTable", body: "sgBody", count: "sgCount", ind: "sgInd", prev: "sgPrev", next: "sgNext", search: "sgSearch", sortKey: "segConfirmed", sortDir: "desc", cols: 7, rows: segRows, row: segRowHtml,
  empty: function () { return "No merchant data yet."; } });
var spT = mkTable({ table: "spTable", body: "spBody", count: "spCount", ind: "spInd", prev: "spPrev", next: "spNext", search: "spSearch", sortKey: "confirmedMtdActual", sortDir: "desc", cols: 22, unit: " SKUs", rows: spRows, row: spRowHtml,
  match: function (m, t) { return String(m.productId).toLowerCase().indexOf(t) >= 0 || String(m.productName).toLowerCase().indexOf(t) >= 0 || String(m.category).toLowerCase().indexOf(t) >= 0 || String(m.merchantName).toLowerCase().indexOf(t) >= 0; },
  empty: function (k) { var P = SP[k]; if (!P) return "Loading…"; if (P.note) return esc(P.note); if (!P.today) return "No Sales Plan data for " + esc(monthTitle(k)) + " yet."; return "No Sales Plan targets are set for your account."; } });
function renderAll() { tgT.render(); sgT.render(); spT.render(); renderSpSummary($("monthSel").value); renderInventory(); renderIncentives(); }

// ---- Inventory (only this merchant's SKUs; the numbers are prepared on the server)
function invRows() {
  return ((INV && INV.rows) || []).map(function (r) {
    var avg3 = r[8] / 3, avg15 = r[9] / 15, ratio = avg15 > 0 ? avg3 / avg15 : (avg3 > 0 ? 2 : 1);
    return { skuId: String(r[0]), skuName: r[1], category: r[2], stock: r[3], doh: r[4], availability: r[5], placedYday: r[6], confYday: r[7], avg3d: avg3, avg15d: avg15, trend: ratio > 1.2 ? "Hot" : ratio < 0.8 ? "Cooling" : "Stable", placed30: r[10] };
  });
}
function invOut(m) { return m.stock <= 0 || m.availability === "Out of Stock"; }
function invRowHtml(m) {
  var tc = m.trend === "Hot" ? "spike" : m.trend === "Cooling" ? "decline" : "stable";
  return "<tr><td class='font-mono text-dim'>" + esc(m.skuId) + "</td><td class='truncate-cell font-bold text-light' title='" + esc(m.skuName) + "'>" + esc(m.skuName) + "</td><td class='text-dim'>" + esc(m.category) + "</td>" +
    "<td class='num'><span class='badge-outline " + (m.stock > 10 ? "green" : "red") + "'>" + cInt(m.stock) + "</span></td><td class='num font-bold text-dim'>" + cInt(m.doh) + "</td>" +
    "<td><span class='badge-outline " + (m.availability === "Out of Stock" ? "red" : "blue") + "'>" + esc(m.availability) + "</span></td>" +
    "<td class='num text-dim'>" + cInt(m.placedYday) + "</td><td class='num text-blue font-bold'>" + cInt(m.confYday) + "</td><td class='num text-orange font-bold'>" + m.avg3d.toFixed(1) + "</td><td class='num text-purple font-bold'>" + m.avg15d.toFixed(1) + "</td>" +
    "<td><span class='badge-status " + tc + "'>" + m.trend + "</span></td><td class='num text-dim'>" + cInt(m.placed30) + "</td></tr>";
}
var invT = mkTable({ table: "invTable", body: "invBody", count: "invCount", ind: "invInd", prev: "invPrev", next: "invNext", search: "invSearch", sortKey: "doh", sortDir: "asc", cols: 12, unit: " SKUs", rows: invRows, row: invRowHtml,
  match: function (m, t) { return m.skuId.toLowerCase().indexOf(t) >= 0 || String(m.skuName).toLowerCase().indexOf(t) >= 0 || String(m.category).toLowerCase().indexOf(t) >= 0; },
  empty: function () { return !INV ? "Loading…" : (INV.note ? esc(INV.note) : "No SKUs found for your account yet."); } });
function renderInventory() {
  var rows = invRows(), set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
  var out = rows.filter(invOut).length, low = rows.filter(function (m) { return !invOut(m) && m.doh < 7; }).length;
  set("invTotal", fmtInt.format(rows.length)); set("invOut", fmtInt.format(out)); set("invLow", fmtInt.format(low)); set("invIn", fmtInt.format(rows.length - out));
  invT.render();
}

// ---- Incentives Tracker (the tab only exists for merchants that are on an incentive plan)
function incRows() { return (INC && INC.rows) || []; }
function incRowHtml(r) {
  var lab = r.status === "achieved" ? "Target Achieved" : r.status === "on-track" ? "On Track (Run Rate)" : "At Risk", cls = r.status === "achieved" ? "spike" : r.status === "on-track" ? "new-match" : "decline";
  return "<tr><td class='font-mono'>" + esc(r.id) + "</td><td class='truncate-cell font-bold text-light'>" + esc(r.name) + "</td><td>" + esc(r.tier || "-") + "</td><td class='num'>" + cInt(r.target) + "</td><td class='num text-dim'>" + cInt(r.targetMtd) + "</td>" +
    "<td class='num text-green font-bold'>" + cInt(r.mtd) + "</td><td class='num text-orange'>" + cInt(r.runRate) + "</td><td class='num'>" + fmtPct(r.attActual) + "</td><td class='num'>" + fmtPct(r.attRun) + "</td><td><span class='badge-status " + cls + "'>" + lab + "</span></td>" +
    "<td class='num text-dim'>" + fmtMoney(r.bonusPerOrder) + "</td><td class='num text-green'>" + cInt(r.extra) + "</td><td class='num text-green font-bold'>" + fmtMoney(r.earned) + "</td><td class='num text-purple'>" + fmtMoney(r.bonusTarget) + "</td><td class='num text-orange font-bold'>" + fmtMoney(r.totalBonus) + "</td></tr>";
}
var incT = mkTable({ table: "incTable", body: "incBody", count: "incCount", ind: "incInd", prev: "incPrev", next: "incNext", search: "incSearch", sortKey: "attRun", sortDir: "desc", cols: 15, unit: " Accounts", rows: incRows, row: incRowHtml,
  match: function (m, t) { return String(m.id).toLowerCase().indexOf(t) >= 0 || String(m.name).toLowerCase().indexOf(t) >= 0; },
  empty: function () { return "No incentive data yet."; } });
function renderIncentives() {
  var rows = incRows(), has = rows.length > 0, set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
  $("navInc").classList.toggle("hidden", !has);
  if (!has) { if (curView === "inc") go("ov"); return; }
  var sum = function (k) { return rows.reduce(function (a, r) { return a + (r[k] || 0); }, 0); };
  var ach = rows.filter(function (r) { return r.status === "achieved"; }).length, on = rows.filter(function (r) { return r.status !== "at-risk"; }).length;
  set("incMonth", monthTitle(INC.month)); set("incTotal", fmtInt.format(rows.length)); set("incAch", ach + " / " + rows.length); set("incOn", on + " / " + rows.length); set("incRisk", fmtInt.format(rows.length - on));
  set("incEarned", fmtMoney(sum("earned"))); set("incBt", fmtMoney(sum("bonusTarget"))); set("incTb", fmtMoney(sum("totalBonus")));
  incT.render();
}

// ---- Alert Center (alerts the Taager team sent to merchants; read state is kept in this browser only)
var AL_KEY = "mp_alerts_read";
function alRead() { try { return JSON.parse(localStorage.getItem(AL_KEY) || "{}") || {}; } catch (e) { return {}; } }
function markAlertsRead() { var r = alRead(); ((AL && AL.alerts) || []).forEach(function (a) { r[a.id] = 1; }); try { localStorage.setItem(AL_KEY, JSON.stringify(r)); } catch (e) {} updateBadge(); }
function unreadCount() { var r = alRead(); return ((AL && AL.alerts) || []).filter(function (a) { return !r[a.id]; }).length; }
function updateBadge() { var n = unreadCount(), b = $("alBadge"); b.textContent = n > 9 ? "9+" : String(n); b.classList.toggle("hidden", n === 0); }
var AL_LINKS = { ov: "Over View", tg: "Merchant Target", sp: "Sales Plan", inv: "Inventory", inc: "Incentives Tracker" };
function renderAlerts() {
  var list = (AL && AL.alerts) || [], r = alRead(), html = "";
  list.forEach(function (a) {
    var when = a.at ? new Date(a.at).toLocaleString() : "", un = !r[a.id];
    html += "<div class='mp-alert " + esc(a.severity) + (un ? " unread" : "") + "'><div class='mp-alert-h'><span class='mp-alert-t'>" + esc(a.title) + "</span>" + (un ? "<span class='mp-alert-new'>New</span>" : "") + "<span class='mp-alert-d'>" + esc(when) + "</span></div><div class='mp-alert-b'>" + esc(a.body) + "</div>" +
      (AL_LINKS[a.link] && (a.link !== "inc" || incRows().length) ? "<div class='mp-alert-go'><button type='button' class='btn btn-outline small' data-go='" + esc(a.link) + "'>Open " + esc(AL_LINKS[a.link]) + "</button></div>" : "") + "</div>";
  });
  if (!html) html = "<div class='mp-empty'>" + (AL && AL.unavailable ? "Alerts could not be loaded right now. Please try again in a few minutes." : AL ? "No alerts right now. Important updates from your Taager team will show up here." : "Loading…") + "</div>";
  $("alList").innerHTML = html; updateBadge();
}
function loadExtras() {
  var fail = function (e) { if (e && e.status === 401) { location.replace("/"); return true; } return false; };
  api("/api/inventory").then(function (d) { INV = d; renderInventory(); }).catch(function (e) { if (fail(e)) return; INV = { rows: [], note: "Inventory could not be loaded: " + e.message }; renderInventory(); });
  api("/api/incentives").then(function (d) { INC = d; renderIncentives(); }).catch(function (e) { fail(e); });
  api("/api/alerts").then(function (d) { AL = d; renderAlerts(); }).catch(function (e) { if (fail(e)) return; AL = { alerts: [], unavailable: true }; renderAlerts(); });
}

// ---- wiring
$("monthSel").addEventListener("change", function () { tgT.reset(); sgT.reset(); spT.reset(); refresh(); });
$("alRead").addEventListener("click", function () { markAlertsRead(); renderAlerts(); });
$("alList").addEventListener("click", function (e) { var b = e.target.closest("[data-go]"); if (b) go(b.getAttribute("data-go")); });
var rsT = 0; window.addEventListener("resize", function () { clearTimeout(rsT); rsT = setTimeout(function () { if (curView === "ov" && D.rows) renderPipe($("monthSel").value); }, 150); });
$("menuBtn").addEventListener("click", function (e) { e.stopPropagation(); $("menuList").classList.toggle("hidden"); });
document.addEventListener("click", function () { $("menuList").classList.add("hidden"); });
function signOut() { api("/api/logout", { body: {} }).finally(function () { location.replace("/"); }); }
$("outBtn").addEventListener("click", signOut); $("outBtn2").addEventListener("click", signOut);
$("chgBtn").addEventListener("click", function () { ["cCur", "cNew", "cNew2"].forEach(function (i) { $(i).value = ""; }); msg("cMsg", ""); $("chgModal").classList.remove("hidden"); $("cCur").focus(); });
$("chgCancel").addEventListener("click", function () { $("chgModal").classList.add("hidden"); });
$("chgForm").addEventListener("submit", function (e) {
  e.preventDefault();
  if ($("cNew").value !== $("cNew2").value) { msg("cMsg", "The two new passwords are different.", "err"); return; }
  msg("cMsg", "Saving…");
  api("/api/password/change", { body: { current: $("cCur").value, next: $("cNew").value } })
    .then(function () { msg("cMsg", "Password changed ✓", "ok"); setTimeout(function () { $("chgModal").classList.add("hidden"); }, 900); })
    .catch(function (er) { msg("cMsg", er.message, "err"); });
});
function msg(id, text, cls) { var e = $(id); if (!e) return; e.textContent = text || ""; e.className = "mp-msg" + (cls ? " " + cls : ""); }
document.addEventListener("visibilitychange", function () { if (!document.hidden) loadData(); });
// the numbers are rebuilt on the server every 30 minutes — pick them up automatically while the page stays open
setInterval(function () { if (!document.hidden) loadData(); }, 30 * 60 * 1000);
start();
`;
