/* ==========================================================================
   DRG 数据分析系统 · 模块：科室对比（dept.js）
   --------------------------------------------------------------------------
   作用：科室维度分析。科室 CMI 对比、科室效率（住院日与次均费用）、科室汇总表。
   依赖：core.js（汇总/格式化工具、charts、currentRows）
   主要函数：
     renderDeptCmi   科室 CMI 对比图
     renderDeptEff   科室效率散点/柱状图（平均住院日、次均费用）
     renderDeptTable 科室汇总表（例数/CMI/住院日/次均费用/三大费用占比/结余率/结余）
   ========================================================================== */
// 作用：科室 CMI 对比图
function renderDeptCmi(rows) {
  const c = charts.chartDeptCmi; if (!c) return;
  const byD = aggBy(rows, "dept");
  const deps = Object.keys(byD).sort((a, b) => deptStat(byD[b]).cmi - deptStat(byD[a]).cmi);
  const narrow = window.innerWidth < 720;   // 窄屏：22 个科室在 ~370px 内放不下全部标签，隔一个显示一个
  c.setOption({
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" } },
    grid: { left: 34, right: 18, top: 34, bottom: 6, containLabel: true },   // 左侧留出斜排标签向左伸出的余量
    xAxis: {
      type: "category", data: deps,
      // 22 个科室挤在约 470px 内，横排标签必然重叠：45° 斜排 + 全量显示
      axisLabel: { ...axisLabel, fontSize: narrow ? 10 : 11, interval: narrow ? 1 : 0,
        rotate: 45, margin: 8, align: "right", verticalAlign: "middle" },
      axisLine: { lineStyle: { color: "#d7e0ea" } }, axisTick: { show: false }
    },
    yAxis: { type: "value", splitLine, axisLabel },
    series: [{
      type: "bar", data: deps.map(d => +deptStat(byD[d]).cmi.toFixed(2)), barWidth: 20,
      itemStyle: { color: "#1667d6", borderRadius: [3, 3, 0, 0] },
      label: { show: true, position: "top", fontSize: 11, color: "#5b6b7c" },
      labelLayout: { hideOverlap: true }        // 柱多时数值标签互相压住，重叠的自动隐藏（悬浮可见）
    }]
  });
}

// 作用：科室效率图（左轴平均住院日、右轴次均费用，同一 x 轴上并排柱）
function renderDeptEff(rows) {
  const c = charts.chartDeptEff; if (!c) return;
  const byD = aggBy(rows, "dept");
  const deps = Object.keys(byD).sort((a, b) => deptStat(byD[b]).los - deptStat(byD[a]).los);
  const los = deps.map(d => deptStat(byD[d]).los.toFixed(1));
  const fee = deps.map(d => +(deptStat(byD[d]).fee / 10000).toFixed(2));
  const narrow = window.innerWidth < 720;
  c.setOption({
    tooltip: {
      trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: p => {
        const d = deps[p[0].dataIndex];
        return d + "<br/>平均住院日：" + deptStat(byD[d]).los.toFixed(1) + " 天<br/>次均费用：" + yuan(deptStat(byD[d]).fee);
      }
    },
    legend: { top: 0, right: 6, itemWidth: 10, itemHeight: 10, itemGap: 14, textStyle: { fontSize: 11, color: "#5b6b7c" } },
    grid: { left: 34, right: 48, top: 40, bottom: 6, containLabel: true },
    xAxis: {
      type: "category", data: deps,
      axisLabel: { ...axisLabel, fontSize: narrow ? 10 : 11, interval: narrow ? 1 : 0,
        rotate: 45, margin: 8, align: "right", verticalAlign: "middle" },
      axisLine: { lineStyle: { color: "#d7e0ea" } }, axisTick: { show: false }
    },
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
// 作用：科室效率气泡图（x 时间消耗指数 / y 费用消耗指数 / 气泡大小=病例数）
// 注：重症医学科这类科室两个指数都远高于 1（本例 2.35 / 2.81），留在图上会把其余科室压成一团，
//     所以超过 2 的离群科室不画，改为在图右上角标注，数据在下方表格里仍可查。
function renderDeptBubble(rows) {
  const byD = aggBy(rows, "dept");
  const items = Object.keys(byD).map(d => {
    const s = deptStat(byD[d]);
    return { name: d, n: s.n, timeIndex: s.timeIndex, feeIndex: s.feeIndex,
      sub: "CMI " + s.cmi.toFixed(2) + " · 平均住院日 " + s.los.toFixed(1) + " 天 · 次均 " + yuan(s.fee) };
  });
  const main = items.filter(d => d.timeIndex <= 2 && d.feeIndex <= 2);
  const out = items.filter(d => d.timeIndex > 2 || d.feeIndex > 2);
  const note = out.length
    ? "已隐藏离群科室：" + out.map(d => `${d.name}（时间 ${d.timeIndex.toFixed(2)} / 费用 ${d.feeIndex.toFixed(2)}）`).join("、")
    : "";
  renderEffBubble("chartDeptBubble", main, { labelCount: 10, note });
}
// 作用：科室汇总表
function renderDeptTable(rows) {
  const byD = aggBy(rows, "dept");
  const body = document.getElementById("tbodyDept");
  // 展开成扁平行对象，字段名与表头 data-key 对应，便于统一排序
  let arr = Object.keys(byD).map(d => {
    const s = deptStat(byD[d]);
    return { dept: d, n: s.n, cmi: s.cmi, los: s.los, fee: s.fee,
      timeIndex: s.timeIndex, feeIndex: s.feeIndex,
      drugRate: s.drugRate, materialRate: s.materialRate, checkRate: s.checkRate,
      balanceRate: s.balanceRate, balance: s.balance };
  });
  arr = sortTableRows(arr, "dept");                    // 表头排序（未点过时保持原始科室顺序）
  bindTableSort("tableDept", "dept", () => renderDeptTable(currentRows()));
  // 导出用全量数据（科室表不分页），列与表格一致
  setExportData("dept", ["科室", "病例数", "CMI", "平均住院日", "次均费用(元)",
    "时间消耗指数", "费用消耗指数", "药占比", "耗材占比", "检查占比", "结余率", "结余/超支(元)"],
    arr.map(s => [s.dept, s.n, p2(s.cmi), s.los.toFixed(1), Math.round(s.fee),
      s.timeIndex.toFixed(2), s.feeIndex.toFixed(2),
      pct(s.drugRate), pct(s.materialRate), pct(s.checkRate), pct(s.balanceRate), Math.round(s.balance)]));
  if (!arr.length) { body.innerHTML = '<tr><td colspan="12" class="empty-tip">当前筛选条件下无数据</td></tr>'; return; }
  body.innerHTML = arr.map(s => {
    return `
    <tr>
      <td><b>${s.dept}</b></td><td class="num">${km(s.n)}</td><td class="num">${p2(s.cmi)}</td>
      <td class="num">${s.los.toFixed(1)}</td><td class="num">${yuan(s.fee)}</td>
      <td class="num" style="color:${idxColor(s.timeIndex)}">${s.timeIndex.toFixed(2)}</td>
      <td class="num" style="color:${idxColor(s.feeIndex)}">${s.feeIndex.toFixed(2)}</td>
      <td class="num">${pct(s.drugRate)}</td><td class="num">${pct(s.materialRate)}</td><td class="num">${pct(s.checkRate)}</td>
      <td class="num">${s.balanceRate >= 0 ? "+" + pct(s.balanceRate) : pct(s.balanceRate)}</td>
      <td>${s.balance >= 0 ? `<span class="badge b-pos">结余 ${yuan(s.balance)}</span>` : `<span class="badge b-neg">超支 ${yuan(-s.balance)}</span>`}</td>
    </tr>`;
  }).join("");
}
