/* ==========================================================================
   DRG 数据分析系统 · 模块：病种分布（drg.js）
   --------------------------------------------------------------------------
   作用：病种维度分析。病种例数排行、病种 CMI 对比、病种效率气泡图、病种明细表（每页 20 行）。
   依赖：core.js（汇总/格式化工具、charts、currentRows、renderEffBubble）
   主要函数：
     renderDrgTop    病种例数 Top 柱状图
     renderDrgCmi    病种 CMI 对比图
     renderDrgBubble 病种效率气泡图（时间/费用消耗指数，气泡=病例数，取病例数 Top 20）
     renderDrgTable  病种明细分页表（病例数/CMI/住院日/次均费用/两大消耗指数/三大费用占比/结余）
     renderDrgPager  病种明细分页器
   ========================================================================== */
const DRG_PAGE_SIZE = 20;   // 病种明细每页行数
let drgPage = 0;

// 作用：病种例数 Top 柱状图
function renderDrgTop(rows) {
  const c = charts.chartDrgTop; if (!c) return;
  const byG = aggBy(rows, "code");
  const arr = Object.keys(byG).map(k => ({ code: k, name: byG[k][0].name, n: byG[k].length }))
    .sort((a, b) => b.n - a.n).slice(0, 10);
  c.setOption({
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" } },
    grid: baseGrid,
    xAxis: { type: "value", splitLine, axisLabel },
    yAxis: { type: "category", data: arr.map(d => d.code + " " + d.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...axisLabel, width: 150, overflow: "truncate" } },
    series: [{
      type: "bar", data: arr.map(d => d.n), barWidth: 13,
      itemStyle: { color: "#1667d6", borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: "right", fontSize: 11, color: "#5b6b7c" }
    }]
  });
}

// 作用：病种 CMI 对比图
function renderDrgCmi(rows) {
  const c = charts.chartDrgCmi; if (!c) return;
  const byG = aggBy(rows, "code");
  const arr = Object.keys(byG).map(k => {
    const r = byG[k];
    return { code: k, name: r[0].name, cmi: sum(r, "rw") / r.length };
  }).sort((a, b) => b.cmi - a.cmi).slice(0, 10);
  c.setOption({
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" } },
    grid: baseGrid,
    xAxis: { type: "value", splitLine, axisLabel },
    yAxis: { type: "category", data: arr.map(d => d.code + " " + d.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...axisLabel, width: 150, overflow: "truncate" } },
    series: [{
      type: "bar", data: arr.map(d => +d.cmi.toFixed(2)), barWidth: 13,
      itemStyle: { color: "#12b5a5", borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: "right", fontSize: 11, color: "#5b6b7c" }
    }]
  });
}

// 作用：病种效率气泡图（x 时间消耗指数 / y 费用消耗指数 / 气泡大小=病例数）
function renderDrgBubble(rows) {
  const byG = aggBy(rows, "code");
  const items = Object.keys(byG).map(k => {
    const r = byG[k], s = deptStat(r);
    // 图上标签只写 DRG 编码（病组名太长会把图糊住），全名放 tooltip
    return { name: k, n: r.length,
      timeIndex: s.timeIndex, feeIndex: s.feeIndex,
      sub: r[0].name + " · CMI " + s.cmi.toFixed(2) + " · 次均 " + yuan(s.fee) };
  }).sort((a, b) => b.n - a.n).slice(0, 20);   // 病组多，只画病例数前 20，避免糊成一团
  renderEffBubble("chartDrgBubble", items, { labelCount: 12 });
}

// 作用：病种明细分页表（病例数/CMI/住院日/次均费用/两大消耗指数/三大费用占比/结余）
function renderDrgTable(rows) {
  const byG = aggBy(rows, "code");
  let arr = Object.keys(byG).map(k => {
    const r = byG[k]; const s = deptStat(r);
    return { code: k, name: r[0].name, n: r.length, cmi: s.cmi, los: s.los, fee: s.fee,
      timeIndex: s.timeIndex, feeIndex: s.feeIndex,
      drugRate: s.drugRate, materialRate: s.materialRate, checkRate: s.checkRate, balance: s.balance };
  }).sort((a, b) => b.n - a.n);
  arr = sortTableRows(arr, "drg");                       // 表头排序（未点过表头时保持按病例数降序）
  bindTableSort("tableDrg", "drg", () => { drgPage = 0; renderDrgTable(currentRows()); });
  // 导出用全量数据（不受分页限制），列与表格一致
  setExportData("drg", ["DRG编码", "病种名称", "病例数", "CMI", "平均住院日", "次均费用(元)",
    "时间消耗指数", "费用消耗指数", "药占比", "耗材占比", "检查占比", "结余/超支(元)"],
    arr.map(d => [d.code, d.name, d.n, p2(d.cmi), d.los.toFixed(1), Math.round(d.fee),
      d.timeIndex.toFixed(2), d.feeIndex.toFixed(2),
      pct(d.drugRate), pct(d.materialRate), pct(d.checkRate), Math.round(d.balance)]));

  const body = document.getElementById("tbodyDrg");
  const pager = document.getElementById("drgPager");
  if (!arr.length) {
    body.innerHTML = '<tr><td colspan="12" class="empty-tip">当前筛选条件下无数据</td></tr>';
    if (pager) pager.innerHTML = "";
    return;
  }
  const pages = Math.max(1, Math.ceil(arr.length / DRG_PAGE_SIZE));
  if (drgPage > pages - 1) drgPage = pages - 1;
  if (drgPage < 0) drgPage = 0;
  const start = drgPage * DRG_PAGE_SIZE;
  const slice = arr.slice(start, start + DRG_PAGE_SIZE);

  body.innerHTML = slice.map(d => `
    <tr>
      <td><span class="badge b-info">${d.code}</span></td>
      <td class="cell-name" title="${d.name}">${d.name}</td>
      <td class="num">${km(d.n)}</td><td class="num">${p2(d.cmi)}</td>
      <td class="num">${d.los.toFixed(1)}</td><td class="num">${yuan(d.fee)}</td>
      <td class="num" style="color:${idxColor(d.timeIndex)}">${d.timeIndex.toFixed(2)}</td>
      <td class="num" style="color:${idxColor(d.feeIndex)}">${d.feeIndex.toFixed(2)}</td>
      <td class="num">${pct(d.drugRate)}</td><td class="num">${pct(d.materialRate)}</td><td class="num">${pct(d.checkRate)}</td>
      <td>${d.balance >= 0 ? `<span class="badge b-pos">结余 ${yuan(d.balance)}</span>` : `<span class="badge b-neg">超支 ${yuan(-d.balance)}</span>`}</td>
    </tr>`).join("");

  renderDrgPager(pages, arr.length, start, slice.length);
}

// 作用：病种明细分页器（上一页/下一页/页码信息）
function renderDrgPager(pages, total, start, shown) {
  const pager = document.getElementById("drgPager");
  if (!pager) return;
  if (pages <= 1) { pager.innerHTML = ""; return; }
  pager.innerHTML =
    '<button class="btn btn-ghost" id="drgPrev"' + (drgPage === 0 ? " disabled" : "") + '>上一页</button>' +
    '<span class="g-pager-info">第 ' + (drgPage + 1) + " / " + pages + " 页（每页 " + DRG_PAGE_SIZE + " 条，共 " + km(total) + " 条，当前 " + km(start + 1) + "–" + km(start + shown) + " 条）</span>" +
    '<button class="btn btn-ghost" id="drgNext"' + (drgPage >= pages - 1 ? " disabled" : "") + '>下一页</button>';
  const pr = pager.querySelector("#drgPrev"), nx = pager.querySelector("#drgNext");
  if (pr) pr.addEventListener("click", () => { if (drgPage > 0) { drgPage--; renderDrgTable(currentRows()); } });
  if (nx) nx.addEventListener("click", () => { if (drgPage < pages - 1) { drgPage++; renderDrgTable(currentRows()); } });
}
