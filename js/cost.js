/* ==========================================================================
   DRG 数据分析系统 · 模块：费用分析（cost.js）
   --------------------------------------------------------------------------
   作用：科室层面的费用维度分析——科室结余/超支对比、各科室费用结构。
         （病组 vs 标杆的 KPI、两张图、明细表在 groupcost.js，两者同属「费用分析」模块）
   依赖：core.js（汇总/格式化工具、charts、currentRows）
   主要函数：
     renderSurplus   科室结余/超支柱状图
     renderFeeByDept 科室费用结构堆叠图
   ========================================================================== */
// 作用：科室结余/超支对比图
function renderSurplus(rows) {
  const c = charts.chartSurplus; if (!c) return;
  const byD = aggBy(rows, "dept");
  const deps = Object.keys(byD);
  const vals = deps.map(d => { const s = deptStat(byD[d]); return +s.balance.toFixed(0); });
  const order = deps.slice().sort((a, b) => deptStat(byD[b]).balance - deptStat(byD[a]).balance);
  c.setOption({
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: ps => { const v = ps[0].value; return `${ps[0].name}<br/>${v >= 0 ? "结余 " : "超支 "}¥${Math.abs(v).toLocaleString("zh-CN")}`; } },
    grid: baseGrid,
    xAxis: { type: "value", splitLine, axisLabel: { formatter: v => (v / 10000) + "万", ...axisLabel } },
    yAxis: { type: "category", data: order, axisLine: { show: false }, axisTick: { show: false }, axisLabel },
    series: [{
      type: "bar", data: order.map(d => vals[deps.indexOf(d)]), barWidth: 14,
      itemStyle: { color: p => p.value >= 0 ? "#2ead6a" : "#e4524b", borderRadius: 2 },
      label: { show: true, position: "right", fontSize: 11, color: "#5b6b7c",
        formatter: p => (p.value >= 0 ? "+" : "") + (p.value / 10000).toFixed(1) + "万" }
    }]
  });
}

// 作用：科室次均费用与标准费用对比图
function renderFeeByDept(rows) {
  const c = charts.chartFeeByDept; if (!c) return;
  const byD = aggBy(rows, "dept");
  const deps = Object.keys(byD).sort((a, b) => sum(byD[b], "total") - sum(byD[a], "total"));
  const parts = name => deps.map(d => {
    const t = sum(byD[d], "total") || 1;
    return +(sum(byD[d], name) / t * 100).toFixed(1);
  });
  c.setOption({
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" } },
    legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: "#5b6b7c", fontSize: 11 } },
    grid: { left: 12, right: 16, top: 30, bottom: 24, containLabel: true },
    xAxis: { type: "value", splitLine, axisLabel: { formatter: "{value}%", ...axisLabel } },
    yAxis: { type: "category", data: deps, axisLine: { show: false }, axisTick: { show: false }, axisLabel },
    series: [
      { name: "药品费", type: "bar", stack: "f", data: parts("drug"), itemStyle: { color: "#1667d6" }, barWidth: 16 },
      { name: "耗材费", type: "bar", stack: "f", data: parts("material"), itemStyle: { color: "#12b5a5" } },
      { name: "检查检验费", type: "bar", stack: "f", data: parts("check"), itemStyle: { color: "#2b7de9" } },
      { name: "医疗服务收入", type: "bar", stack: "f", data: parts("other"), itemStyle: { color: "#c8d6e8" } },
    ]
  });
}
