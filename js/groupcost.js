/* ==========================================================================
   DRG 数据分析系统 · 模块：病组费用分析（groupcost.js）
   --------------------------------------------------------------------------
   作用：把「病组（DRG）的实际费用」与「权重表里的标杆数据」对照，回答
        “这个病组比标杆贵/便宜多少、贵在药品还是耗材”这类问题。
   依赖：core.js（aggBy / sum / deptStat 等工具、charts 实例、currentRows）
        drg_weights.js（DRG_WEIGHTS.map 的 cost 标杆次均、los 标杆住院日、
                        drugRate/materialRate/checkRate 标杆费用结构）
   主要函数：
     buildGroupCost   按病组汇总 实际 vs 标杆（费用/住院日/三项结构占比/结余）
     renderGroupCost  本模块统一入口：KPI + 2 图 + 明细表
     renderGCostKpi   4 项对比卡：覆盖病组 / 次均费用 / 费用偏差总额 / 平均住院日
     renderGCostFee   病组次均费用 vs 标杆（病例数 Top 12）
     renderGCostStruct 病组费用结构偏差（实际占比 − 标杆占比，百分点）
     renderGCostTable 病组费用分析明细表（每页 20 组）
   注：benchOf() 已上移到 core.js（deptStat 算消耗指数也要用），此处不再重复定义。
   ========================================================================== */
const GC_PAGE_SIZE = 20;   // 病组费用明细每页行数
let gcPage = 0;

// 作用：按病组汇总「实际值」「标杆值」「结余」，供 KPI / 图 / 表共用
function buildGroupCost(rows) {
  const byG = aggBy(rows, "code");
  return Object.keys(byG).map(k => {
    const r = byG[k], n = r.length, t = sum(r, "total"), std = sum(r, "standard");
    const b = benchOf(k);
    const fee = n ? t / n : 0;
    return {
      code: k, name: r[0].name, dept: r[0].dept, n,
      fee, bfee: b.cost,
      diff: fee - b.cost,                                  // 次均费用偏差（元）
      diffRate: b.cost ? (fee - b.cost) / b.cost : 0,       // 偏差率
      totalDiff: t - b.cost * n,                            // 该病组偏差总额（元）
      standard: n ? std / n : 0,                            // 次均标准费用（rw × RATE）
      balance: std - t,                                     // 结余 = 标准费用 − 实际费用
      balanceRate: std ? (std - t) / std : 0,               // 结余率
      los: n ? sum(r, "los") / n : 0, blos: b.los,
      drugRate: t ? sum(r, "drug") / t : 0,
      materialRate: t ? sum(r, "material") / t : 0,
      checkRate: t ? sum(r, "check") / t : 0,
      bDrug: b.drugRate, bMat: b.materialRate, bChk: b.checkRate,
      configured: b.configured
    };
  });
}

// 作用：本模块统一入口（core.js 的 refresh() 只调这一个）
function renderGroupCost(rows) {
  renderGCostKpi(rows);
  renderGCostFee(rows);
  renderGCostStruct(rows);
  renderGCostTable(rows);
}

// 作用：4 项对比卡（覆盖病组 / 次均费用 / 费用偏差总额 / 平均住院日）
function renderGCostKpi(rows) {
  const g = document.getElementById("gcKpi");
  if (!g) return;
  if (!rows.length) { g.innerHTML = ""; return; }
  const arr = buildGroupCost(rows);
  const n = rows.length;
  const act = sum(rows, "total");
  const bench = arr.reduce((s, d) => s + d.bfee * d.n, 0);
  const dev = act - bench;
  const devRate = bench ? dev / bench : 0;
  const los = sum(rows, "los") / n;
  const blos = arr.reduce((s, d) => s + d.blos * d.n, 0) / n;
  const confN = arr.filter(d => d.configured).length;
  const over = arr.filter(d => d.diff > 0).length;
  const wan = v => (v / 10000).toFixed(1) + "万";
  const cards = [
    { icon: "k-blue", svg: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      label: "覆盖病组数", value: km(arr.length) + " 个", color: "",
      sub: `标杆已配置 ${km(confN)} 个 · 高于标杆 ${km(over)} 个` },
    { icon: "k-orange", svg: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M12 10v4M9 14h6"/>',
      label: "实际次均费用", value: yuan(act / n), color: "",
      sub: `标杆 ${yuan(bench / n)} · ${devRate >= 0 ? "高于 " : "低于 "}${pct(Math.abs(devRate))}` },
    { icon: dev >= 0 ? "k-red" : "k-green", svg: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
      label: "费用偏差总额", value: (dev >= 0 ? "+" : "-") + "¥" + wan(Math.abs(dev)), color: dev >= 0 ? "var(--red)" : "var(--green)",
      sub: `实际 ${wan(act)} · 标杆 ${wan(bench)}` },
    { icon: "k-cyan", svg: '<path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/><path d="M12 7v5l3 2"/>',
      label: "平均住院日", value: los.toFixed(1) + "天", color: "",
      sub: `标杆 ${blos.toFixed(1)} 天 · ${los >= blos ? "多 " : "少 "}${Math.abs(los - blos).toFixed(1)} 天` }
  ];
  g.innerHTML = cards.map(c => `
    <div class="card kpi">
      <span class="k-icon ${c.icon}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${c.svg}</svg></span>
      <span class="k-label">${c.label}</span>
      <span class="k-value num"${c.color ? ` style="color:${c.color}"` : ""}>${c.value}</span>
      <span class="k-delta" style="color:var(--text-3)">${c.sub}</span>
    </div>`).join("");
}

// 作用：病组次均费用 vs 标杆费用（按病例数取 Top 12）
function renderGCostFee(rows) {
  const c = charts.chartGCostFee; if (!c) return;
  const arr = buildGroupCost(rows).sort((a, b) => b.n - a.n).slice(0, 12).reverse();
  c.setOption({
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: ps => {
        const d = arr[ps[0].dataIndex];
        return `${d.code} ${d.name}<br/>病例数 ${km(d.n)} 例<br/>实际次均 ${yuan(d.fee)}<br/>标杆费用 ${yuan(d.bfee)}<br/>偏差 ${d.diff >= 0 ? "+" : "-"}${yuan(Math.abs(d.diff))}（${d.diffRate >= 0 ? "+" : ""}${pct(d.diffRate)}）`;
      } },
    legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: "#5b6b7c", fontSize: 11 } },
    grid: { left: 12, right: 20, top: 30, bottom: 24, containLabel: true },
    xAxis: { type: "value", splitLine, axisLabel: { formatter: v => km(v), ...axisLabel } },
    yAxis: { type: "category", data: arr.map(d => d.code), axisLine: { show: false }, axisTick: { show: false }, axisLabel },
    series: [
      { name: "实际次均", type: "bar", data: arr.map(d => +d.fee.toFixed(0)), barWidth: 6, barGap: "30%", itemStyle: { color: "#1667d6", borderRadius: [0, 3, 3, 0] } },
      { name: "标杆费用", type: "bar", data: arr.map(d => +d.bfee.toFixed(0)), barWidth: 6, itemStyle: { color: "#c8d6e8", borderRadius: [0, 3, 3, 0] } }
    ]
  });
}

// 作用：病组费用结构偏差图（实际占比 − 标杆占比，单位：百分点）
function renderGCostStruct(rows) {
  const c = charts.chartGCostStruct; if (!c) return;
  const arr = buildGroupCost(rows).sort((a, b) => b.n - a.n).slice(0, 10).reverse();
  const pp = (a, b) => +(((a - b) * 100).toFixed(1));
  c.setOption({
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      valueFormatter: v => (v > 0 ? "+" : "") + v + " 个百分点" },
    legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: "#5b6b7c", fontSize: 11 } },
    grid: { left: 12, right: 16, top: 30, bottom: 24, containLabel: true },
    xAxis: { type: "value", splitLine, axisLabel: { formatter: v => v + "pp", ...axisLabel },
      axisLine: { show: true, lineStyle: { color: "#d7e0ea" } } },
    yAxis: { type: "category", data: arr.map(d => d.code), axisLine: { show: false }, axisTick: { show: false }, axisLabel },
    series: [
      { name: "药品", type: "bar", barWidth: 7, data: arr.map(d => pp(d.drugRate, d.bDrug)), itemStyle: { color: "#1667d6" } },
      { name: "耗材", type: "bar", barWidth: 7, data: arr.map(d => pp(d.materialRate, d.bMat)), itemStyle: { color: "#12b5a5" } },
      { name: "检查", type: "bar", barWidth: 7, data: arr.map(d => pp(d.checkRate, d.bChk)), itemStyle: { color: "#2b7de9" } }
    ]
  });
}

// 作用：病组费用分析明细表（实际 vs 标杆，按偏差总额从高到低）
function renderGCostTable(rows) {
  const body = document.getElementById("tbodyGCost");
  const pager = document.getElementById("gCostPager");
  if (!body) return;
  let arr = buildGroupCost(rows).sort((a, b) => b.totalDiff - a.totalDiff);
  arr = sortTableRows(arr, "gcost");                    // 表头排序（未点过时按偏差总额降序）
  bindTableSort("tableGCost", "gcost", () => { gcPage = 0; renderGCostTable(currentRows()); });
  // 导出用全量数据（不受分页限制）：表格里的「实/标」双值在 CSV 里拆成两列，便于再做计算
  setExportData("gcost", ["DRG编码", "病组名称", "病例数", "实际次均(元)", "标杆费用(元)",
    "结余率", "结余/超支(元)", "实际住院日", "标杆住院日",
    "药占比(实际)", "药占比(标杆)", "耗材占比(实际)", "耗材占比(标杆)", "检查占比(实际)", "检查占比(标杆)"],
    arr.map(d => [d.code, d.name, d.n, Math.round(d.fee), Math.round(d.bfee),
      pct(d.balanceRate), Math.round(d.balance), d.los.toFixed(1), d.blos.toFixed(1),
      pct(d.drugRate), pct(d.bDrug), pct(d.materialRate), pct(d.bMat), pct(d.checkRate), pct(d.bChk)]));
  if (!arr.length) {
    body.innerHTML = '<tr><td colspan="11" class="empty-tip">当前筛选条件下无数据</td></tr>';
    if (pager) pager.innerHTML = "";
    return;
  }
  const pages = Math.max(1, Math.ceil(arr.length / GC_PAGE_SIZE));
  if (gcPage > pages - 1) gcPage = pages - 1;
  if (gcPage < 0) gcPage = 0;
  const start = gcPage * GC_PAGE_SIZE;
  const slice = arr.slice(start, start + GC_PAGE_SIZE);
  // 与标杆比较上色：高于标杆=红（费用/住院日/占比超标），低于标杆=绿
  const tone = (a, b) => a > b ? "var(--red)" : (a < b ? "var(--green)" : "var(--text-1)");
  // 「实际 / 标杆」双值单元格（占比与住院日共用），实际值上色、标杆值保持灰色
  const cell = (a, b, d = 1) => `<td class="num"><span style="color:${tone(a, b)}">${typeof a === "number" ? a.toFixed(d) : a}</span><span style="color:var(--text-3);font-size:11px"> / ${typeof b === "number" ? b.toFixed(d) : b}</span></td>`;
  const pctCell = (a, b) => `<td class="num"><span style="color:${tone(a, b)}">${pct(a)}</span><span style="color:var(--text-3);font-size:11px"> / ${pct(b)}</span></td>`;
  body.innerHTML = slice.map(d => `
    <tr>
      <td><span class="badge b-info">${d.code}</span></td>
      <td class="cell-name" title="${d.name}">${d.name}${d.configured ? "" : '<span style="color:var(--text-3);font-size:11px">（兜底标杆）</span>'}</td>
      <td class="num">${km(d.n)}</td>
      <td class="num"><b style="color:${tone(d.fee, d.bfee)}">${yuan(d.fee)}</b></td>
      <td class="num" style="color:var(--text-3)">${yuan(d.bfee)}</td>
      <td class="num" style="color:${d.balanceRate >= 0 ? "var(--green)" : "var(--red)"}">${d.balanceRate >= 0 ? "+" : ""}${pct(d.balanceRate)}</td>
      <td>${d.balance >= 0 ? `<span class="badge b-pos">结余 ${yuan(d.balance)}</span>` : `<span class="badge b-neg">超支 ${yuan(-d.balance)}</span>`}</td>
      ${cell(d.los, d.blos, 1)}
      ${pctCell(d.drugRate, d.bDrug)}${pctCell(d.materialRate, d.bMat)}${pctCell(d.checkRate, d.bChk)}
    </tr>`).join("");
  renderGCostPager(pages, arr.length, start, slice.length);
}

// 作用：病组费用明细分页器
function renderGCostPager(pages, total, start, shown) {
  const pager = document.getElementById("gCostPager");
  if (!pager) return;
  if (pages <= 1) { pager.innerHTML = ""; return; }
  pager.innerHTML =
    '<button class="btn btn-ghost" id="gcPrev"' + (gcPage === 0 ? " disabled" : "") + '>上一页</button>' +
    '<span class="g-pager-info">第 ' + (gcPage + 1) + " / " + pages + " 页（每页 " + GC_PAGE_SIZE + " 组，共 " + km(total) + " 组，当前 " + km(start + 1) + "–" + km(start + shown) + "）</span>" +
    '<button class="btn btn-ghost" id="gcNext"' + (gcPage >= pages - 1 ? " disabled" : "") + '>下一页</button>';
  const pr = pager.querySelector("#gcPrev"), nx = pager.querySelector("#gcNext");
  if (pr) pr.addEventListener("click", () => { if (gcPage > 0) { gcPage--; renderGCostTable(currentRows()); } });
  if (nx) nx.addEventListener("click", () => { if (gcPage < pages - 1) { gcPage++; renderGCostTable(currentRows()); } });
}
