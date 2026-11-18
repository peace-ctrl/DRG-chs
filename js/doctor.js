/* ==========================================================================
   DRG 数据分析系统 · 模块：住院医师对比（doctor.js）
   --------------------------------------------------------------------------
   作用：以「住院医师」为维度的分组分析。把每条已分组的病案归到其主治的
        住院医师名下，统计医师层面的 CMI、工作量、住院日、次均费用、药/耗材/
        检查三大费用占比与结余，用于评价医师收治病例的疑难程度与资源消耗。
   依赖：core.js（aggBy/deptStat 等聚合工具、charts、currentRows）
   数据来源：分析行的 doc 字段（由 grouping.js 从病案表「住院医师」列写入，
            缺省记为「未填医师」）
   主要函数：
     renderDocCmi    各住院医师 CMI 对比（取病例数前 12 名，避免 x 轴过密）
     renderDocEff    医师效率对比（平均住院日 / 次均费用）
     buildDocArr     组装医师汇总数组（含主要科室），按病例数降序
     renderDocTable  医师汇总表（含药/耗材/检查占比，每页 20 行）
     renderDocPager  医师汇总表分页器
   ========================================================================== */
const DOC_PAGE_SIZE = 20;   // 医师汇总表每页行数
let docPage = 0;            // 当前页码（0 起）
let docArr = [];            // 当前筛选条件下的医师汇总数组（分页用）

// 作用：各住院医师 CMI 对比图（取病例数前 12 名）
function renderDocCmi(rows) {
  const c = charts.chartDocCmi; if (!c) return;
  buildDocArr(rows);
  const top = docArr.slice(0, 12);            // 只画前 12 名，保证横轴标签可读
  c.setOption({
    tooltip: {
      trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: p => {
        const d = top[p[0].dataIndex];
        return d.name + "<br/>主要科室：" + d.mainDept + "<br/>病例数：" + km(d.s.n) + " 例<br/>CMI：" + p2(d.s.cmi);
      }
    },
    grid: baseGrid,
    xAxis: { type: "category", data: top.map(d => d.name), axisLabel: { ...axisLabel, interval: 0, rotate: 30 }, axisLine: { lineStyle: { color: "#d7e0ea" } }, axisTick: { show: false } },
    yAxis: { type: "value", splitLine, axisLabel },
    series: [{
      type: "bar", data: top.map(d => +d.s.cmi.toFixed(2)), barWidth: 18,
      itemStyle: { color: "#1667d6", borderRadius: [3, 3, 0, 0] },
      label: { show: true, position: "top", fontSize: 11, color: "#5b6b7c" }
    }]
  });
}

// 作用：医师效率对比图（左轴平均住院日、右轴次均费用，同一 x 轴上并排柱）
function renderDocEff(rows) {
  const c = charts.chartDocEff; if (!c) return;
  buildDocArr(rows);
  const top = docArr.slice(0, 12);
  const los = top.map(d => d.s.los.toFixed(1));
  const fee = top.map(d => +(d.s.fee / 10000).toFixed(2));
  c.setOption({
    tooltip: {
      trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: p => {
        const d = top[p[0].dataIndex];
        return d.name + "<br/>平均住院日：" + d.s.los.toFixed(1) + " 天<br/>次均费用：" + yuan(d.s.fee);
      }
    },
    legend: { top: 0, right: 6, itemWidth: 10, itemHeight: 10, itemGap: 14, textStyle: { fontSize: 11, color: "#5b6b7c" } },
    grid: { left: 14, right: 44, top: 40, bottom: 62, containLabel: true },
    xAxis: { type: "category", data: top.map(d => d.name), axisLabel: { ...axisLabel, interval: 0, rotate: 30 }, axisLine: { lineStyle: { color: "#d7e0ea" } }, axisTick: { show: false } },
    yAxis: [
      { type: "value", name: "住院日(天)", splitLine, axisLabel, nameTextStyle: { color: "#5b6b7c", fontSize: 11 } },
      { type: "value", splitLine: { show: false }, axisLabel, nameTextStyle: { color: "#5b6b7c", fontSize: 11 } }
    ],
    series: [
      { name: "平均住院日", type: "bar", yAxisIndex: 0, data: los, barWidth: 12, itemStyle: { color: "#12b5a5", borderRadius: [3, 3, 0, 0] } },
      { name: "次均费用(万元)", type: "bar", yAxisIndex: 1, data: fee, barWidth: 12, itemStyle: { color: "#2b7de9", borderRadius: [3, 3, 0, 0] } }
    ]
  });
}
// 作用：组装医师汇总数组（含主要科室），按病例数降序
function buildDocArr(rows) {
  const byDoc = aggBy(rows, "doc");
  docArr = Object.keys(byDoc).map(name => {
    const list = byDoc[name];
    const s = deptStat(list);
    // 主要科室：该医师收治病例最多的科室
    const cnt = {};
    list.forEach(r => { cnt[r.dept] = (cnt[r.dept] || 0) + 1; });
    const mainDept = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || "—";
    return { name, mainDept, s };
  }).sort((a, b) => b.s.n - a.s.n);   // 病例数多的排前面
  return docArr;
}

// 作用：医师效率气泡图（x 时间消耗指数 / y 费用消耗指数 / 气泡大小=病例数，取病例数 Top 30）
function renderDocBubble(rows) {
  buildDocArr(rows);
  const items = docArr.slice(0, 30).map(d => ({
    name: d.name, n: d.s.n, timeIndex: d.s.timeIndex, feeIndex: d.s.feeIndex,
    sub: "主要科室 " + d.mainDept + " · CMI " + d.s.cmi.toFixed(2)
  }));
  renderEffBubble("chartDocBubble", items);
}

// 作用：住院医师分组汇总表（每页 20 行）
function renderDocTable(rows) {
  const body = document.getElementById("tbodyDoc");
  if (!body) return;
  buildDocArr(rows);
  // 展开成扁平行对象（字段名与表头 data-key 对应），医师姓名放在 doc 字段
  let list = docArr.map(d => ({ doc: d.name, mainDept: d.mainDept, n: d.s.n, cmi: d.s.cmi, los: d.s.los, fee: d.s.fee,
    timeIndex: d.s.timeIndex, feeIndex: d.s.feeIndex,
    drugRate: d.s.drugRate, materialRate: d.s.materialRate, checkRate: d.s.checkRate,
    balanceRate: d.s.balanceRate, balance: d.s.balance }));
  list = sortTableRows(list, "doc");                   // 表头排序（未点过时按病例数降序）
  bindTableSort("tableDoc", "doc", () => { docPage = 0; renderDocTable(currentRows()); });
  // 导出用全量数据（不受分页限制），列与表格一致
  setExportData("doc", ["住院医师", "主要科室", "病例数", "CMI", "平均住院日", "次均费用(元)",
    "时间消耗指数", "费用消耗指数", "药占比", "耗材占比", "检查占比", "结余率", "结余/超支(元)"],
    list.map(s => [s.doc, s.mainDept, s.n, p2(s.cmi), s.los.toFixed(1), Math.round(s.fee),
      s.timeIndex.toFixed(2), s.feeIndex.toFixed(2),
      pct(s.drugRate), pct(s.materialRate), pct(s.checkRate), pct(s.balanceRate), Math.round(s.balance)]));
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="13" class="empty-tip">当前筛选条件下无数据</td></tr>';
    renderDocPager(0);
    return;
  }
  const pages = Math.max(1, Math.ceil(list.length / DOC_PAGE_SIZE));
  if (docPage > pages - 1) docPage = pages - 1;
  if (docPage < 0) docPage = 0;
  const start = docPage * DOC_PAGE_SIZE;
  const slice = list.slice(start, start + DOC_PAGE_SIZE);
  body.innerHTML = slice.map(s => {
    return `
    <tr>
      <td><b>${s.doc}</b></td><td>${s.mainDept}</td><td class="num">${km(s.n)}</td>
      <td class="num">${p2(s.cmi)}</td><td class="num">${s.los.toFixed(1)}</td><td class="num">${yuan(s.fee)}</td>
      <td class="num" style="color:${idxColor(s.timeIndex)}">${s.timeIndex.toFixed(2)}</td>
      <td class="num" style="color:${idxColor(s.feeIndex)}">${s.feeIndex.toFixed(2)}</td>
      <td class="num">${pct(s.drugRate)}</td><td class="num">${pct(s.materialRate)}</td><td class="num">${pct(s.checkRate)}</td>
      <td class="num">${s.balanceRate >= 0 ? "+" + pct(s.balanceRate) : pct(s.balanceRate)}</td>
      <td>${s.balance >= 0 ? `<span class="badge b-pos">结余 ${yuan(s.balance)}</span>` : `<span class="badge b-neg">超支 ${yuan(-s.balance)}</span>`}</td>
    </tr>`;
  }).join("");
  renderDocPager(pages, list.length, start, slice.length);
}

// 作用：医师汇总表分页器
function renderDocPager(pages, total, start, shown) {
  const pager = document.getElementById("docPager");
  if (!pager) return;
  if (!pages || pages <= 1) { pager.innerHTML = ""; return; }
  pager.innerHTML =
    '<button class="btn btn-ghost" id="docPrev"' + (docPage === 0 ? " disabled" : "") + '>上一页</button>' +
    '<span class="g-pager-info">第 ' + (docPage + 1) + " / " + pages + " 页（每页 " + DOC_PAGE_SIZE +
    " 位，当前 " + km(start + 1) + "–" + km(start + shown) + "，共 " + km(total) + " 位医师）</span>" +
    '<button class="btn btn-ghost" id="docNext"' + (docPage >= pages - 1 ? " disabled" : "") + '>下一页</button>';
  const pr = pager.querySelector("#docPrev"), nx = pager.querySelector("#docNext");
  if (pr) pr.addEventListener("click", () => { if (docPage > 0) { docPage--; renderDocTable(currentRows()); } });
  if (nx) nx.addEventListener("click", () => { if (docPage < pages - 1) { docPage++; renderDocTable(currentRows()); } });
}
