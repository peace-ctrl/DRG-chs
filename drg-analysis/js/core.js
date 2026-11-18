/* ==========================================================================
   DRG 数据分析系统 · 核心模块（core.js）
   --------------------------------------------------------------------------
   作用：全站公共底座。提供筛选状态、聚合与格式化工具、ECharts 实例管理、
        CSV 导出、多选筛选组件、无数据空态、总刷新入口与页面初始化。
   依赖：echarts（全局）；其余业务模块 js 依赖本文件，必须在其之前加载。
   主要函数：
     sourceRows / hasData        取当前分析行；无数据返回空数组，驱动全站空态
     currentRows                 按时间(多选)/科室(多选)/关键词过滤后的分析行
     periodLabel / deptLabel     筛选条件的中文描述（用于汇报元信息与导出文件名）
     sum / aggBy / deptStat      求和、按字段分组、核心指标（例数/CMI/住院日/次均/入组率/结余）
     pct / yuan / km / p2        百分比、金额、千分位、两位小数的格式化
     initChart / charts          按容器 id 初始化 ECharts 实例并缓存
     downloadCSV / setExportData / exportTable  各明细表导出（带 BOM 的 CSV，Excel 可直接打开）
     fillPeriodOptions / fillDeptOptions / setupFilterDropdowns  时间与科室多选组件
     refresh / renderNoData      总刷新入口；无数据时各模块统一显示「请传入病案数据」
     bindEvents / init           导出、汇报、导航切换与页面初始化
   数据契约（分析行）：
     { m 数字月, ml "YYYY-MM", ym "YYYY-MM", dept 科室, code DRG编码, name DRG名称,
       rw 权重, los 住院天数, total 总费用, drug/material/check/other 费用拆分,
       standard 标准费用, balance 结余, status 入组状态 }
   说明：本文件不生成任何演示数据，必须先上传病案并完成分组才会产生分析行。
   ========================================================================== */
/* ==========================================================================
   1. 状态与筛选
   ========================================================================== */
const state = { periods: [], depts: [], search: "" };   // 空数组 = 全部
let dataSource = "preview";   // "preview" 未分组预览 | "real" 已载入真实分组数据
let realRows = [];            // 真实分组后的统一分析数据
let realRaw = [];             // 真实分组原始结果（含姓名等明细）

// 作用：按当前数据源返回分析行；未分组时返回空数组（全站显示空态）
function sourceRows() { return dataSource === "real" ? realRows : []; }
// 作用：判断是否已载入分组数据
function hasData() { return dataSource === "real" && realRows.length > 0; }

// 作用：时间筛选的中文描述：未选=数据覆盖区间，多选=已选N个月
function periodLabel() {
  const p = state.periods;
  if (!p.length) {
    const mls = [...new Set(sourceRows().map(r => r.ml))].filter(x => x && x !== "—").sort();
    if (!mls.length) return "全部时间";
    return mls.length === 1 ? mls[0] : mls[0] + " 至 " + mls[mls.length - 1];
  }
  if (p.length === 1) return p[0];
  return [...p].sort()[0] + " 等 " + p.length + " 个月";
}
// 作用：科室筛选的中文描述：未选=全部科室，多选=已选N个科室
function deptLabel() {
  const d = state.depts;
  if (!d.length) return "全部科室";
  return d.length === 1 ? d[0] : d[0] + " 等 " + d.length + " 个科室";
}
// 作用：按时间(多选)/科室(多选)/关键词过滤后的分析行
function currentRows() {
  const kw = state.search.trim().toLowerCase();
  return sourceRows().filter(r =>
    (!state.periods.length || state.periods.includes(r.ym))
    && (!state.depts.length || state.depts.includes(r.dept))
    && (!kw || r.code.toLowerCase().includes(kw) || r.name.toLowerCase().includes(kw) || r.dept.toLowerCase().includes(kw)));
}

/* ==========================================================================
   2. 聚合工具
   ========================================================================== */
// 作用：对数组中某字段求和
function sum(arr, key) { return arr.reduce((s, x) => s + x[key], 0); }
// 作用：按指定字段把行分组（返回 值→行数组 的映射）
function aggBy(rows, key) {
  const map = {};
  rows.forEach(r => {
    const k = r[key];
    map[k] = map[k] || [];
    map[k].push(r);
  });
  return map;
}
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const yuan = v => "¥" + Math.round(v).toLocaleString("zh-CN");
const km = v => Math.round(v).toLocaleString("zh-CN");
const p2 = v => (+v).toFixed(2);

// 作用：取某 DRG 的标杆配置（权重表 map，未配置时用 default 兜底并标记 configured）
function benchOf(code) {
  const m = DRG_WEIGHTS.map[code];
  const c = m || DRG_WEIGHTS.default;
  return {
    cost: +c.cost || 0, los: +c.los || 0, rw: +c.rw || 0,
    drugRate: +c.drugRate || 0, materialRate: +c.materialRate || 0, checkRate: +c.checkRate || 0,
    descr: c.descr || "", configured: !!m
  };
}

// 作用：一组行的核心指标：例数、CMI、平均住院日、次均费用、三大费用占比、消耗指数、入组率、结余
// 消耗指数口径（DRG 评价通用）：
//   时间消耗指数 = Σ实际住院天数 / Σ(该病组标杆住院日)
//   费用消耗指数 = Σ实际总费用 / Σ(该病组标杆费用)
// 都等于 1 时与标杆持平，<1 表示比标杆省（住院更短 / 花费更少）
function deptStat(rows) {
  const n = rows.length;
  const t = sum(rows, "total"), std = sum(rows, "standard");
  const norm = rows.filter(r => r.status === "正常入组").length;
  let losAct = 0, losStd = 0, feeStd = 0;
  rows.forEach(r => {
    const b = benchOf(r.code);
    losAct += r.los || 0;
    losStd += b.los;
    feeStd += b.cost;
  });
  return {
    n,
    cmi: n ? sum(rows, "rw") / n : 0,
    los: n ? sum(rows, "los") / n : 0,
    fee: n ? t / n : 0,
    timeIndex: losStd ? losAct / losStd : 0,
    feeIndex: feeStd ? t / feeStd : 0,
    drugRate: t ? sum(rows, "drug") / t : 0,
    materialRate: t ? sum(rows, "material") / t : 0,
    checkRate: t ? sum(rows, "check") / t : 0,
    normRate: n ? norm / n : 0,
    balance: std - t,
    balanceRate: std ? (std - t) / std : 0,
    std
  };
}

// 作用：消耗指数的配色——超过标杆（>1）红、优于标杆（<1）绿、正好等于 1 用正文色
function idxColor(v) { return v > 1 ? "var(--red)" : (v < 1 ? "var(--green)" : "var(--text-1)"); }

/* ==========================================================================
   表头排序：点击 <th> 在 升序 / 降序 之间切换
   用法：① 表头写 data-key="字段名"（= 行对象的属性名）
        ② 渲染函数里 const arr = sortTableRows(baseArr, "drg")
        ③ 渲染函数里 bindTableSort("tableDrg", "drg", () => { drgPage = 0; renderDrgTable(currentRows()); })
   状态存在 tableSorts 里，切换筛选/翻页都保持；点同一列再次点击反向。
   ========================================================================== */
const tableSorts = {};   // { 表标识: { key, dir } }，dir = 1 升序 / -1 降序

// 作用：按当前排序状态返回排好序的副本（未点击过表头时原样返回，保持默认排序）
function sortTableRows(arr, tableKey) {
  const st = tableSorts[tableKey];
  if (!st || !st.key) return arr;
  const k = st.key, d = st.dir;
  const num = v => typeof v === "boolean" ? (v ? 1 : 0) : (typeof v === "number" ? v : null);
  return arr.slice().sort((a, b) => {
    const va = a[k], vb = b[k];
    // 数字（含布尔）按数值比，其余按中文拼音序；空值恒排最后
    const na = num(va), nb = num(vb);
    if (na !== null && nb !== null) return d * (na - nb);
    const sa = va == null ? "" : String(va), sb = vb == null ? "" : String(vb);
    if (!sa && !sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    return d * sa.localeCompare(sb, "zh-Hans-CN", { numeric: true });
  });
}

// 作用：给表头绑定点击排序（同一张表只绑一次），并重画 ▲/▼
function bindTableSort(tableId, tableKey, onSort) {
  const table = document.getElementById(tableId);
  if (!table) return;
  if (table.dataset.sortBound !== "1") {
    table.dataset.sortBound = "1";
    table.querySelectorAll("thead th").forEach(th => {
      const key = th.dataset.key;
      if (!key) return;
      th.classList.add("sortable");
      th.title = "点击排序";
      th.addEventListener("click", () => {
        const st = tableSorts[tableKey];
        if (st && st.key === key) st.dir = -st.dir;
        else tableSorts[tableKey] = { key, dir: 1 };
        paintSortArrow(table, tableSorts[tableKey]);
        onSort();
      });
    });
  }
  paintSortArrow(table, tableSorts[tableKey]);
}

// 作用：在当前排序列的表头右侧显示 ▲（升序）/ ▼（降序）
function paintSortArrow(table, st) {
  table.querySelectorAll("thead th").forEach(th => {
    if (!th.dataset.key) return;
    let a = th.querySelector(".sort-arrow");
    if (!a) { a = document.createElement("span"); a.className = "sort-arrow"; th.appendChild(a); }
    a.textContent = (st && st.key === th.dataset.key) ? (st.dir === 1 ? "▲" : "▼") : "";
  });
}

/* ==========================================================================
   3. ECharts 基础
   ========================================================================== */
const PALETTE = ["#1667d6", "#2b7de9", "#12b5a5", "#7c4ddb", "#f59e0b", "#2ead6a", "#e4524b", "#6f87a5"];
const charts = {};
// 作用：按容器 id 初始化 ECharts 实例并存入 charts 缓存
function initChart(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const c = echarts.init(el);
  charts[id] = c;
  return c;
}
const axisLabel = { color: "#5b6b7c", fontSize: 11 };
const splitLine = { lineStyle: { color: "#eef2f8" } };
const baseGrid = { left: 12, right: 16, top: 34, bottom: 28, containLabel: true };

// 作用：效率气泡图（三个模块共用）
//   x = 时间消耗指数，y = 费用消耗指数，气泡大小 = 病例数
//   左下（都 <1）= 又省又快（绿）；右上（都 >1）= 又慢又贵（红）；跨线 = 一好一坏（橙）
// items: [{ name, timeIndex, feeIndex, n, sub }]，sub 为 tooltip 里的补充说明（如 CMI / 科室）
function renderEffBubble(chartId, items, opt) {
  const c = charts[chartId];
  if (!c) return;
  const o = opt || {};
  if (!items.length) { c.clear(); return; }
  // 病例数从大到小：气泡大小按它算，标签也优先给最大的这几个，避免挤成一团
  const list = items.slice().sort((a, b) => b.n - a.n);
  const narrow = window.innerWidth < 720;                    // 手机上点位挤，标签再少一些
  const labelCount = narrow ? Math.min(o.labelCount || 10, 5) : (o.labelCount || 10);
  const maxN = Math.max(1, ...list.map(d => d.n));
  const size = n => 10 + 30 * Math.sqrt(n / maxN);          // 面积按病例数开方，避免大小悬殊
  const color = d => (d.timeIndex <= 1 && d.feeIndex <= 1) ? "#2ead6a"
    : (d.timeIndex > 1 && d.feeIndex > 1) ? "#e4524b" : "#f59e0b";
  const data = list.map(d => ({
    name: d.name,
    value: [+d.timeIndex.toFixed(3), +d.feeIndex.toFixed(3), d.n],
    itemStyle: { color: color(d), opacity: 0.72, borderColor: "#fff", borderWidth: 1 }
  }));
  c.setOption({
    tooltip: {
      trigger: "item", confine: true,
      formatter: p => {
        const d = list[p.dataIndex];
        return `<b>${p.name}</b>` + (d.sub ? "<br/>" + d.sub : "") +
          `<br/>病例数：${km(d.n)} 例` +
          `<br/>时间消耗指数：<b>${d.timeIndex.toFixed(2)}</b>` +
          `<br/>费用消耗指数：<b>${d.feeIndex.toFixed(2)}</b>`;
      }
    },
    grid: { left: 12, right: 18, top: o.note ? 46 : 34, bottom: 30, containLabel: true },
    graphic: o.note ? [{
      type: "text", right: 14, top: 6,
      style: { text: o.note, fontSize: 11, fill: "#8a97a8" }
    }] : [],
    xAxis: {
      type: "value", name: "时间消耗指数", nameLocation: "middle", nameGap: 26,
      nameTextStyle: { color: "#5b6b7c", fontSize: 11 },
      min: v => Math.min(0.8, +(v.min * 0.95).toFixed(2)),
      max: v => Math.max(1.2, +(v.max * 1.05).toFixed(2)),
      splitLine, axisLabel, axisLine: { lineStyle: { color: "#d7e0ea" } }
    },
    yAxis: {
      type: "value", name: "费用消耗指数", nameLocation: "middle", nameGap: 34,
      nameTextStyle: { color: "#5b6b7c", fontSize: 11 },
      min: v => Math.min(0.8, +(v.min * 0.95).toFixed(2)),
      max: v => Math.max(1.2, +(v.max * 1.05).toFixed(2)),
      splitLine, axisLabel, axisLine: { show: false }
    },
    series: [{
      type: "scatter", data,
      symbolSize: v => size(v[2]),
      label: {
        show: true, position: "top", fontSize: 10, color: "#5b6b7c",
        formatter: p => p.dataIndex < labelCount ? p.name : "",
        overflow: "truncate", width: 84
      },
      labelLayout: { hideOverlap: true },   // 再兜一层：仍然重叠的标签自动隐藏
      emphasis: { scale: 1.15, itemStyle: { opacity: 1, borderColor: "#1667d6", borderWidth: 1.5 } },
      markLine: {
        silent: true, symbol: "none", animation: false,
        lineStyle: { color: "#c8d6e8", type: "dashed", width: 1 },
        label: { show: false },
        data: [{ xAxis: 1 }, { yAxis: 1 }]
      }
    }]
  }, true);
}

/* ==========================================================================
   4. 导出 CSV
   ========================================================================== */
// 作用：把二维数组导出为带 BOM 的 CSV（Excel 可直接打开）
function downloadCSV(filename, header, rows2d) {
  const esc = v => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = "\uFEFF" + [header, ...rows2d].map(row => row.map(esc).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

// 作用：导出某张明细表的全量数据
// 每条明细表在渲染时用 setExportData 登记「当前筛选 + 当前排序」的完整数组，
// 导出时直接取这份数据，所以不受分页限制（翻到第几页都不影响导出内容）。
const exportData = {};   // { 表标识: { header: 表头数组, rows: 二维数组 } }
function setExportData(key, header, rows) { exportData[key] = { header, rows }; }

// 作用：按表标识导出 CSV，文件名 = 表格名 + 当前时间筛选（便于区分口径）
function exportTable(key, name) {
  const d = exportData[key];
  if (!d || !d.rows.length) return;
  downloadCSV(name + "_" + periodLabel().replace(/\s/g, "") + ".csv", d.header, d.rows);
}

/* ==========================================================================
   5. 筛选组件与刷新
   ========================================================================== */
// 作用：刷新时间/科室多选按钮上的已选文案
function updateMsLabels() {
  const pl = document.getElementById("msPeriodLabel");
  if (pl) {
    const n = state.periods.length;
    pl.textContent = n === 0 ? "全部时间" : (n === 1 ? state.periods[0] : "已选 " + n + " 个月");
  }
  const dl = document.getElementById("msDeptLabel");
  if (dl) {
    const n = state.depts.length;
    dl.textContent = n === 0 ? "全部科室" : (n === 1 ? state.depts[0] : "已选 " + n + " 个科室");
  }
}

// 作用：给多选面板的勾选框与全选/清空绑定事件
function bindMsPanel(panel, kind) {
  panel.querySelectorAll(".ms-item input").forEach(cb => {
    cb.addEventListener("change", () => {
      const vals = [...panel.querySelectorAll(".ms-item input:checked")].map(x => x.value);
      if (kind === "period") state.periods = vals; else state.depts = vals;
      updateMsLabels();
      refresh();
    });
  });
  panel.querySelectorAll("[data-ms]").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      const all = a.dataset.ms === "all";
      panel.querySelectorAll(".ms-item input").forEach(cb => { cb.checked = all; });
      const vals = all ? [...panel.querySelectorAll(".ms-item input")].map(x => x.value) : [];
      if (kind === "period") state.periods = vals; else state.depts = vals;
      updateMsLabels();
      refresh();
    });
  });
}

// 作用：多选面板顶部「全选 / 清空」的 HTML
function msActionsHtml() {
  return '<div class="ms-actions"><a href="javascript:void(0)" data-ms="all">全选</a><a href="javascript:void(0)" data-ms="none">清空</a></div>';
}

// 作用：按数据中的科室生成多选项；选项集合不变时只同步勾选，不重建 DOM
function fillDeptOptions(rows) {
  const panel = document.getElementById("msDeptPanel");
  if (!panel) return;
  const depts = [...new Set(rows.map(r => r.dept))].sort();
  state.depts = state.depts.filter(d => depts.includes(d));
  const key = depts.join("\u0001");
  if (panel.dataset.key !== key) {
    let html = msActionsHtml();
    depts.forEach(d => {
      html += '<label class="ms-item"><input type="checkbox" value="' + d + '"><span>' + d + '</span></label>';
    });
    if (!depts.length) html += '<div class="ms-empty">请传入病案数据</div>';
    panel.innerHTML = html;
    panel.dataset.key = key;
    bindMsPanel(panel, "dept");
  }
  panel.querySelectorAll(".ms-item input").forEach(cb => {
    const on = state.depts.includes(cb.value);
    if (cb.checked !== on) cb.checked = on;
  });
  updateMsLabels();
}

// 作用：按出院年月生成时间多选项（按年分组）；同样避免重建
function fillPeriodOptions(rows) {
  const panel = document.getElementById("msPeriodPanel");
  if (!panel) return;
  const yms = [...new Set(rows.map(r => r.ym).filter(Boolean))].sort();
  state.periods = state.periods.filter(p => yms.includes(p));
  const key = yms.join("\u0001");
  if (panel.dataset.key !== key) {
    let html = msActionsHtml();
    const years = [...new Set(yms.map(y => y.slice(0, 4)))];
    years.forEach(y => {
      const ms = yms.filter(ym => ym.slice(0, 4) === y);
      html += '<div class="ms-group">' + y + ' 年</div>';
      ms.forEach(ym => {
        html += '<label class="ms-item"><input type="checkbox" value="' + ym + '"><span>' + ym + '</span></label>';
      });
    });
    if (!yms.length) html += '<div class="ms-empty">请传入病案数据</div>';
    panel.innerHTML = html;
    panel.dataset.key = key;
    bindMsPanel(panel, "period");
  }
  panel.querySelectorAll(".ms-item input").forEach(cb => {
    const on = state.periods.includes(cb.value);
    if (cb.checked !== on) cb.checked = on;
  });
  updateMsLabels();
}

// 作用：时间/科室下拉面板的开合，点击页面空白处收起
function setupFilterDropdowns() {
  [["msPeriodBtn", "msPeriodPanel"], ["msDeptBtn", "msDeptPanel"]].forEach(([b, p]) => {
    const btn = document.getElementById(b), panel = document.getElementById(p);
    if (!btn || !panel) return;
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const open = panel.classList.contains("show");
      document.querySelectorAll(".ms-panel").forEach(x => x.classList.remove("show"));
      document.querySelectorAll(".ms-btn").forEach(x => x.classList.remove("open"));
      if (!open) { panel.classList.add("show"); btn.classList.add("open"); }
    });
    panel.addEventListener("click", e => e.stopPropagation());
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".ms-panel").forEach(x => x.classList.remove("show"));
    document.querySelectorAll(".ms-btn").forEach(x => x.classList.remove("open"));
  });
}
// 作用：未传入病案数据时，各模块统一显示「请传入病案数据」
function renderNoData() {
  const g = document.getElementById("kpiGrid");
  if (g) {
    const labels = ["出院病例数", "CMI 病例组合指数", "平均住院日", "次均费用", "药占比", "耗材占比", "检查占比", "结余总额"];
    g.innerHTML = labels.map(l => `
      <div class="card kpi">
        <span class="k-label">${l}</span>
        <span class="k-value num">—</span>
        <span class="k-delta" style="color:var(--text-3)">请传入病案数据</span>
      </div>`).join("");
  }
  [["tbodyDrg", 12], ["tbodyGCost", 11], ["tbodyDept", 12], ["tbodyDoc", 13]].forEach(([id, n]) => {
    const b = document.getElementById(id);
    if (b) b.innerHTML = '<tr><td colspan="' + n + '" class="empty-tip">请传入病案数据</td></tr>';
  });
  ["drgPager", "gCostPager", "docPager"].forEach(id => { const p = document.getElementById(id); if (p) p.innerHTML = ""; });
  const gcKpi = document.getElementById("gcKpi");
  if (gcKpi) gcKpi.innerHTML = "";
  Object.values(charts).forEach(c => c && c.clear());
  const rb = document.getElementById("reportBody");
  if (rb) rb.innerHTML = '<div class="empty-tip" style="padding:16px">请传入病案数据</div>';
  const rm = document.getElementById("rMeta");
  if (rm) rm.textContent = "";
}
// 作用：总刷新入口：更新筛选项 → 过滤数据 → 驱动各模块重绘
function refresh() {
  drgPage = 0;               // 筛选变化后病种明细回到第 1 页
  gcPage = 0;                // 筛选变化后病组费用明细回到第 1 页
  docPage = 0;               // 筛选变化后医师汇总表回到第 1 页
  const src = sourceRows();
  fillDeptOptions(src);
  fillPeriodOptions(src);
  if (!src.length) { renderNoData(); return; }   // 未传入病案数据：全站提示
  const rows = currentRows();
  renderKPIs(rows);          // overview.js
  renderTrend(rows);         // overview.js
  renderStatus(rows);        // overview.js
  renderFeeStruct(rows);     // overview.js
  renderDeptShare(rows);     // overview.js
  renderDrgTop(rows);        // drg.js
  renderDrgCmi(rows);        // drg.js
  renderDrgBubble(rows);     // drg.js：时间/费用消耗指数气泡图
  renderDrgTable(rows);      // drg.js
  renderSurplus(rows);       // cost.js
  renderFeeByDept(rows);     // cost.js
  renderGroupCost(rows);     // groupcost.js：病组费用 实际 vs 标杆
  renderDeptCmi(rows);       // dept.js
  renderDeptEff(rows);       // dept.js
  renderDeptBubble(rows);    // dept.js：时间/费用消耗指数气泡图
  renderDeptTable(rows);     // dept.js
  renderDocCmi(rows);        // doctor.js
  renderDocEff(rows);        // doctor.js
  renderDocBubble(rows);     // doctor.js：时间/费用消耗指数气泡图
  renderDocTable(rows);      // doctor.js
}

/* 数据源状态标签（真实分组是否已载入） */
// 作用：更新分组区的数据状态标签
function updateSrcTag() {
  const tag = document.getElementById("dataSrcTag");
  if (!tag) return;
  if (dataSource === "real") {
    tag.textContent = "已载入真实分组数据 · " + km(realRows.length) + " 条";
    tag.classList.add("real");
  } else {
    tag.textContent = "请传入病案数据";
    tag.classList.remove("real");
  }
}

/* ==========================================================================
   6. 事件绑定
   ========================================================================== */
// 作用：顶部导出、生成汇报按钮与左侧导航切换
function bindEvents() {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      document.querySelectorAll(".module").forEach(m => m.classList.remove("active"));
      document.getElementById("module-" + item.dataset.module).classList.add("active");
      window.dispatchEvent(new Event("resize"));
    });
  });

  document.getElementById("btnReport").addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i.dataset.module === "report"));
    document.querySelectorAll(".module").forEach(m => m.classList.remove("active"));
    document.getElementById("module-report").classList.add("active");
    generateReport();        // overview.js
    document.getElementById("module-report").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  // 各明细表卡片头上的导出按钮：data-export = 表格标识，data-name = 文件名前缀
  document.querySelectorAll("[data-export]").forEach(btn => {
    btn.addEventListener("click", () => exportTable(btn.dataset.export, btn.dataset.name || "明细"));
  });

  window.addEventListener("resize", () => Object.values(charts).forEach(c => c && c.resize()));
}

/* ==========================================================================
   7. 初始化
   ========================================================================== */
// 作用：页面初始化：图表实例、事件绑定、首次渲染
function init() {
  setupFilterDropdowns();
  let searchTimer = null;
  document.getElementById("filterSearch").addEventListener("input", e => {
    state.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 300);   // 防抖，避免大数据量逐键重算
  });

  ["chartTrend", "chartStatus", "chartFeeStruct", "chartDeptShare",
   "chartDrgTop", "chartDrgCmi", "chartDrgBubble", "chartSurplus", "chartFeeByDept",
   "chartGCostFee", "chartGCostStruct",
   "chartDeptCmi", "chartDeptEff", "chartDeptBubble",
   "chartDocCmi", "chartDocEff", "chartDocBubble"].forEach(initChart);

  bindEvents();
  setupGrouping();   // grouping.js
  setupQuery();      // query.js
  renderGroupTable(); // grouping.js：未分组时表格显示「请传入病案数据」
  updateSrcTag();
  refresh();
}

document.addEventListener("DOMContentLoaded", init);
