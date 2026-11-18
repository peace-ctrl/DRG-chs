/* ==========================================================================
   DRG 数据分析系统 · 模块：总览看板 + 运营分析汇报（overview.js）
   --------------------------------------------------------------------------
   作用：渲染总览模块的 8 项核心指标卡与 4 张图表，并生成「运营分析汇报」的
        正文段落、汇报 KPI 与病种明细（每页 20 行，可翻页）。
   依赖：core.js（格式化/聚合工具、charts 实例、currentRows/deptStat 等）
   主要函数：
     renderKPIs      8 项 KPI：出院例数 / CMI / 平均住院日 / 次均费用 / 药·耗材·检查占比 / 结余总额
     renderTrend     月度趋势：次均费用（柱，左轴）+ CMI（折线，右副轴）
     renderStatus    费用构成饼图：药品费 / 耗材费 / 检查检验费 / 医疗服务收入
     renderFeeStruct 各科室平均住院费用与平均住院日（双折线，住院日副轴）
     renderDeptShare 科室病例占比
     renderReportDrgBlock  汇报内病种明细的分页渲染
     generateReport  生成整篇运营分析汇报（文字 + KPI + 病种明细）
   ========================================================================== */
// 作用：总览 8 项核心指标卡（例数/CMI/住院日/次均费用/药·耗材·检查占比/结余）
function renderKPIs(rows) {
  const s = deptStat(rows);
  const g = document.getElementById("kpiGrid");
  const cards = [
    { icon: "k-blue", svg: '<path d="M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z"/><path d="M12 8v8M8 12h8"/>', label: "出院病例数", value: km(s.n), sub: "同期在院管理病例" },
    { icon: "k-cyan", svg: '<path d="M5 12h3l2-7 3 14 2-7h4"/>', label: "CMI 病例组合指数", value: p2(s.cmi), sub: "反映收治疑难程度" },
    { icon: "k-blue", svg: '<path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/><path d="M12 7v5l3 2"/>', label: "平均住院日", value: s.los.toFixed(1) + "天", sub: "床日效率" },
    { icon: "k-orange", svg: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M12 10v4M9 14h6"/>', label: "次均费用", value: yuan(s.fee), sub: "按筛选口径" },
    { icon: "k-orange", svg: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/>', label: "药占比", value: pct(s.drugRate), sub: "药品费 ÷ 总费用" },
    { icon: "k-cyan", svg: '<path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M3 8v8l9 4 9-4V8"/>', label: "耗材占比", value: pct(s.materialRate), sub: "材料费 ÷ 总费用" },
    { icon: "k-blue", svg: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="7"/>', label: "检查占比", value: pct(s.checkRate), sub: "检查费 ÷ 总费用" },
    { icon: "k-red", svg: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>', label: "结余总额", value: s.balance >= 0 ? yuan(s.balance) : "-" + yuan(-s.balance), sub: s.balanceRate >= 0 ? `结余率 ${pct(s.balanceRate)}` : `超支率 ${pct(-s.balanceRate)}` }
  ];
  g.innerHTML = cards.map(c => `
    <div class="card kpi">
      <span class="k-icon ${c.icon}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${c.svg}</svg></span>
      <span class="k-label">${c.label}</span>
      <span class="k-value num">${c.value}</span>
      <span class="k-delta" style="color:var(--text-3)">${c.sub}</span>
    </div>`).join("");
}

// 作用：月度趋势图：次均费用（柱，左轴）+ CMI 病例组合指数（折线，右副轴）
function renderTrend(rows) {
  const c = charts.chartTrend; if (!c) return;
  const byM = {};
  rows.forEach(r => { byM[r.ml] = byM[r.ml] || []; byM[r.ml].push(r); });
  const labels = Object.keys(byM).sort();
  const cmi = labels.map(l => +(sum(byM[l], "rw") / byM[l].length).toFixed(2));
  const fee = labels.map(l => Math.round(sum(byM[l], "total") / byM[l].length));
  const many = labels.length > 8;                       // 月份多时旋转标签、缩小柱宽
  // CMI 副轴：围绕实际值取上下留白后取整到 0.1，避免「从 0 起」把差异压平，也避免 ECharts 自动算出怪刻度
  const cmin = Math.min(...cmi), cmax = Math.max(...cmi);
  const pad = Math.max(0.05, (cmax - cmin) * 0.3);
  const cmiLo = Math.floor((cmin - pad) * 10) / 10, cmiHi = Math.ceil((cmax + pad) * 10) / 10;
  c.setOption({
    tooltip: {
      trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: ps => {
        const i = ps[0].dataIndex;
        return labels[i] + "<br/>次均费用：" + yuan(fee[i]) + "<br/>CMI：" + cmi[i].toFixed(2) +
          "<br/>出院病例数：" + km(byM[labels[i]].length) + " 例";
      }
    },
    legend: { top: 0, left: "center", itemWidth: 12, itemHeight: 8, itemGap: 12, textStyle: { fontSize: 11, color: "#5b6b7c" } },
    grid: { left: 12, right: 12, top: 46, bottom: many ? 46 : 28, containLabel: true },
    xAxis: {
      type: "category", data: labels,
      axisLabel: { ...axisLabel, rotate: many ? 30 : 0 },
      axisLine: { lineStyle: { color: "#d7e0ea" } }, axisTick: { show: false }
    },
    yAxis: [
      { type: "value", name: "次均费用(元)", nameTextStyle: { color: "#5b6b7c", fontSize: 11, align: "left" },
        splitLine, axisLabel: { ...axisLabel, formatter: v => km(v) } },
      { type: "value", name: "CMI", nameTextStyle: { color: "#5b6b7c", fontSize: 11, align: "right" },
        min: cmiLo, max: cmiHi, splitNumber: 4, splitLine: { show: false }, axisLabel }
    ],
    series: [
      { name: "次均费用(元)", type: "bar", data: fee, barMaxWidth: 48, barCategoryGap: "45%",
        itemStyle: { color: "#1667d6", borderRadius: [3, 3, 0, 0] },
        label: { show: !many, position: "top", fontSize: 10, color: "#5b6b7c", formatter: p => km(p.value) } },
      { name: "CMI", type: "line", yAxisIndex: 1, data: cmi, smooth: true, symbolSize: 7,
        lineStyle: { color: "#12b5a5", width: 2 }, itemStyle: { color: "#12b5a5" },
        // 单月/少量月份时在点上方标注数值（多月份靠 tooltip，避免标签互相压住）
        label: { show: labels.length <= 6, position: "top", distance: 6, fontSize: 10, color: "#12b5a5",
          backgroundColor: "rgba(255,255,255,0.85)", padding: [2, 4], borderRadius: 3,
          formatter: p => (+p.value).toFixed(2) } }
    ]
  }, true);   // notMerge：清掉上一版「三联图」的 grid/series/graphic，避免残留
}

// 作用：费用构成饼图（药品费 / 耗材费 / 检查检验费 / 医疗服务收入）
function renderStatus(rows) {
  const c = charts.chartStatus; if (!c) return;
  const t = sum(rows, "total"), d = sum(rows, "drug"), m = sum(rows, "material"), k = sum(rows, "check");
  const data = [
    { name: "药品费", value: +d.toFixed(0), itemStyle: { color: "#1667d6" } },
    { name: "耗材费", value: +m.toFixed(0), itemStyle: { color: "#12b5a5" } },
    { name: "检查检验费", value: +k.toFixed(0), itemStyle: { color: "#2b7de9" } },
    { name: "医疗服务收入", value: +Math.max(0, t - d - m - k).toFixed(0), itemStyle: { color: "#c8d6e8" }, label: { color: "#5b6b7c" } }
  ].filter(x => x.value > 0);
  // 窄屏（手机/窄卡片）改为「图例横排在底部」，避免右侧图例被裁掉
  const narrow = window.innerWidth < 720;   // 用视口宽度判断，图表实例宽度在首次渲染时可能还没定下来
  c.setOption({
    tooltip: { trigger: "item", confine: true, formatter: p => `${p.name}：${yuan(p.value)}（${p.percent}%）` },
    legend: narrow
      ? { orient: "horizontal", left: "center", bottom: 0, itemWidth: 10, itemHeight: 10, itemGap: 10, textStyle: { color: "#5b6b7c", fontSize: 11 } }
      : { orient: "vertical", right: 6, top: "center", itemWidth: 10, itemHeight: 10, textStyle: { color: "#5b6b7c", fontSize: 12 } },
    series: [{
      type: "pie", radius: narrow ? ["36%", "58%"] : ["44%", "66%"], center: narrow ? ["50%", "42%"] : ["36%", "50%"],
      data, label: { show: true, position: "inside", formatter: "{d}%", fontSize: 11, color: "#fff" },
      itemStyle: { borderRadius: 4, borderColor: "#fff", borderWidth: 2 },
    }]
  });
}

// 作用：各科室平均住院费用与平均住院日（双折线，住院日用副坐标轴）
function renderFeeStruct(rows) {
  const c = charts.chartFeeStruct; if (!c) return;
  const byD = aggBy(rows, "dept");
  const deps = Object.keys(byD).sort((a, b) => deptStat(byD[b]).fee - deptStat(byD[a]).fee);
  const fee = deps.map(d => Math.round(deptStat(byD[d]).fee));
  const los = deps.map(d => +deptStat(byD[d]).los.toFixed(1));
  // 窄屏放不下 22 个科室名：隔一个显示一个，并改回 45° 短标签
  const narrow = window.innerWidth < 720;
  c.setOption({
    tooltip: {
      trigger: "axis", confine: true,
      formatter: ps => {
        const d = deps[ps[0].dataIndex]; const s = deptStat(byD[d]);
        return d + "<br/>平均住院费用：" + yuan(s.fee) + "<br/>平均住院日：" + s.los.toFixed(1) + " 天";
      }
    },
    legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11, color: "#5b6b7c" } },
    grid: { left: 14, right: 16, top: 44, bottom: narrow ? 76 : 88, containLabel: true },
    xAxis: { type: "category", data: deps, axisLabel: narrow
        ? { ...axisLabel, interval: 1, rotate: 45, fontSize: 9 }
        : { ...axisLabel, interval: 0, rotate: 90, fontSize: 9, lineHeight: 11 },
      axisLine: { lineStyle: { color: "#d7e0ea" } }, axisTick: { show: false } },
    yAxis: [
      { type: "log", min: 1000, max: 200000, splitNumber: 4, splitLine, axisLabel: { ...axisLabel, formatter: v => v >= 10000 ? (v / 10000) + "万" : v } },
      { type: "value", splitNumber: 4, splitLine: { show: false }, axisLabel }
    ],
    series: [
      { name: "平均住院费用(元)", type: "line", yAxisIndex: 0, data: fee, smooth: true, symbolSize: 5,
        areaStyle: { color: "rgba(22,103,214,0.10)" },
        lineStyle: { color: "#1667d6", width: 2 }, itemStyle: { color: "#1667d6" } },
      { name: "平均住院日(天)", type: "line", yAxisIndex: 1, data: los, smooth: true, symbolSize: 6,
        lineStyle: { color: "#12b5a5", width: 2, type: "dashed" }, itemStyle: { color: "#12b5a5" } }
    ]
  });
}

// 作用：科室病例占比图
function renderDeptShare(rows) {
  const c = charts.chartDeptShare; if (!c) return;
  const byD = aggBy(rows, "dept");
  const deps = Object.keys(byD).sort((a, b) => byD[b].length - byD[a].length);
  c.setOption({
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" } },
    grid: baseGrid,
    xAxis: { type: "value", splitLine, axisLabel },
    yAxis: { type: "category", data: deps, axisLine: { show: false }, axisTick: { show: false }, axisLabel },
    series: [{
      type: "bar", data: deps.map(d => byD[d].length), barWidth: 14,
      itemStyle: { color: "#1667d6", borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: "right", fontSize: 11, color: "#5b6b7c" }
    }]
  });
}

const REPORT_PAGE_SIZE = 20;   // 汇报中病种明细每页行数
let reportPage = 0;
let reportDrgArr = [];

// 作用：汇报内病种明细的分页渲染（每页 20 行）
function renderReportDrgBlock() {
  const wrap = document.getElementById("reportDrgWrap");
  if (!wrap) return;
  const arr = sortTableRows(reportDrgArr, "report"), total = arr.length;   // 表头排序
  setExportData("report", ["DRG编码", "病种名称", "病例数", "CMI", "次均费用(元)",
    "药占比", "耗材占比", "检查占比", "结余率", "结余/超支(元)"],
    arr.map(d => [d.code, d.name, d.n, p2(d.cmi), Math.round(d.fee),
      pct(d.drugRate), pct(d.materialRate), pct(d.checkRate), pct(d.rate), Math.round(d.bal)]));
  const eb = document.getElementById("btnReportExport");
  if (eb) eb.disabled = !total;
  if (!total) { wrap.innerHTML = '<div class="empty-tip" style="padding:12px">当前筛选条件下无数据</div>'; return; }
  const pages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
  if (reportPage > pages - 1) reportPage = pages - 1;
  if (reportPage < 0) reportPage = 0;
  const start = reportPage * REPORT_PAGE_SIZE;
  const slice = arr.slice(start, start + REPORT_PAGE_SIZE);
  const rowsHtml = slice.map(d => `
    <tr>
      <td><span class="badge b-info">${d.code}</span></td><td class="cell-name" title="${d.name}">${d.name}</td>
      <td class="num">${km(d.n)}</td><td class="num">${p2(d.cmi)}</td><td class="num">${yuan(d.fee)}</td>
      <td class="num">${pct(d.drugRate)}</td><td class="num">${pct(d.materialRate)}</td><td class="num">${pct(d.checkRate)}</td>
      <td class="num">${d.rate >= 0 ? "+" + pct(d.rate) : pct(d.rate)}</td>
      <td>${d.bal >= 0 ? `<span class="badge b-pos">结余 ${yuan(d.bal)}</span>` : `<span class="badge b-neg">超支 ${yuan(-d.bal)}</span>`}</td>
    </tr>`).join("");
  const pager = pages <= 1 ? "" :
    '<div class="g-pager"><button class="btn btn-ghost" id="reportPrev"' + (reportPage === 0 ? " disabled" : "") + '>上一页</button>' +
    '<span class="g-pager-info">第 ' + (reportPage + 1) + " / " + pages + " 页（每页 " + REPORT_PAGE_SIZE + " 条，共 " + km(total) + " 条）</span>" +
    '<button class="btn btn-ghost" id="reportNext"' + (reportPage >= pages - 1 ? " disabled" : "") + '>下一页</button></div>';
  wrap.innerHTML = '<div class="table-wrap"><table class="dtable" id="tableReport" style="min-width:1040px">' +
    '<colgroup><col style="width:8%"><col style="width:22%"><col style="width:6%"><col style="width:6%"><col style="width:10%"><col style="width:8%"><col style="width:8%"><col style="width:8%"><col style="width:9%"><col style="width:15%"></colgroup>' +
    '<thead><tr><th data-key="code">DRG编码</th><th data-key="name">病种名称</th><th class="num" data-key="n">病例数</th><th class="num" data-key="cmi">CMI</th><th class="num" data-key="fee">次均费用(元)</th><th class="num" data-key="drugRate">药占比</th><th class="num" data-key="materialRate">耗材占比</th><th class="num" data-key="checkRate">检查占比</th><th class="num" data-key="rate">结余率</th><th data-key="bal">结余/超支</th></tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody></table></div>' + pager;
  bindTableSort("tableReport", "report", () => { reportPage = 0; renderReportDrgBlock(); });
  const pr = document.getElementById("reportPrev"), nx = document.getElementById("reportNext");
  if (pr) pr.addEventListener("click", () => { if (reportPage > 0) { reportPage--; renderReportDrgBlock(); } });
  if (nx) nx.addEventListener("click", () => { if (reportPage < pages - 1) { reportPage++; renderReportDrgBlock(); } });
}

// 作用：生成整篇运营分析汇报（文字段落 + KPI + 病种明细）
function generateReport() {
  const rows = currentRows();
  if (!rows.length) {
    document.getElementById("reportBody").innerHTML = '<div class="empty-tip" style="padding:16px">请传入病案数据</div>';
    document.getElementById("rMeta").textContent = "全部时间";
    setExportData("report", [], []);
    const eb = document.getElementById("btnReportExport");
    if (eb) eb.disabled = true;
    return;
  }
  const s = deptStat(rows);
  const byG = aggBy(rows, "code");
  const byD = aggBy(rows, "dept");
  const low = rows.filter(r => r.status === "低倍率").length;
  const high = rows.filter(r => r.status === "高倍率").length;
  const noGroup = rows.filter(r => r.status === "未入组").length;
  const deptSel = deptLabel();
  const meta = `${periodLabel()} · ${deptSel} · 覆盖 ${byG ? Object.keys(byG).length : 0} 个DRG病种`;
  document.getElementById("rMeta").textContent = meta;

  const drgArr = Object.keys(byG).map(k => {
    const r = byG[k]; const std = sum(r, "standard"); const t = sum(r, "total");
    return { code: k, name: r[0].name, n: r.length, cmi: sum(r, "rw") / r.length, balance: std - t, std };
  });
  const topCase = drgArr.slice().sort((a, b) => b.n - a.n)[0];
  const topCmi = drgArr.slice().sort((a, b) => b.cmi - a.cmi)[0];
  const worstOver = drgArr.slice().sort((a, b) => a.balance - b.balance)[0];
  const bestSave = drgArr.slice().sort((a, b) => (b.balance / b.std) - (a.balance / a.std))[0];
  const deptArr = Object.keys(byD).map(d => ({ d, s: deptStat(byD[d]) }));
  const overDepts = deptArr.filter(x => x.s.balance < 0).sort((a, b) => a.s.balance - b.s.balance);
  const saveDepts = deptArr.filter(x => x.s.balance >= 0).sort((a, b) => b.s.balance - a.s.balance);

  const totalFee = sum(rows, "total");
  const drugRate = totalFee ? sum(rows, "drug") / totalFee : 0;

  let html = "";
  html += `<p class="report-para">本期共收治 <b>${km(s.n)} 例</b> 出院病例，病例组合指数（CMI）为 <b>${p2(s.cmi)}</b>，平均住院日 <b>${s.los.toFixed(1)} 天</b>，次均费用 <b>${yuan(s.fee)}</b>，药品占比 <b>${pct(drugRate)}</b>。`;
  html += `按权重折算标准费用后，整体${s.balance >= 0 ? `<span class="ok">结余 ${yuan(s.balance)}</span>` : `<span class="hl">超支 ${yuan(-s.balance)}</span>`}（结余率 ${s.balanceRate >= 0 ? "+" : ""}${pct(s.balanceRate)}）。</p>`;

  html += `<p class="report-para">入组质量方面，正常入组率 <b>${pct(s.normRate)}</b>，其中低倍率 <b>${low} 例</b>、高倍率 <b>${high} 例</b>、未入组 <b>${noGroup} 例</b>${(noGroup + high) > 0 ? "，需关注病案首页质量与编码准确性。" : "，入组情况总体平稳。"}</p>`;

  if (topCase) html += `<p class="report-para">病种分布上，<b>${topCase.code} ${topCase.name}</b> 出院病例最多（${km(topCase.n)} 例）；CMI 最高的病种为 <b>${topCmi.code} ${topCmi.name}</b>（${p2(topCmi.cmi)}），是体现收治难度的重点病种。</p>`;

  const bsRate = bestSave.balance / bestSave.std;
  html += `<p class="report-para">费用结余维度，结余率最高的病种为 <b>${bestSave.code} ${bestSave.name}</b>（结余率 ${bsRate >= 0 ? "+" : ""}${pct(bsRate)}，${bestSave.balance >= 0 ? "结余" : "超支"} ${yuan(Math.abs(bestSave.balance))}）；超支压力最大的病种为 <b>${worstOver.code} ${worstOver.name}</b>（超支 ${yuan(-worstOver.balance)}）${overDepts.length ? `。按科室看，${overDepts.map(x => x.d).join("、")} 存在费用超支` : "。"}${saveDepts.length ? `，${saveDepts.map(x => x.d).join("、")} 为结余科室` : ""}。</p>`;

  html += `<p class="report-para"><b>运营建议</b>：针对超支病种开展临床路径与耗材管控；对低倍率病例核查是否存在入院指针不严或费用过低；持续关注高权重病种的收治结构，稳定 CMI 水平。</p>`;

  html += `<div class="report-kpis">
    <div class="rk"><div class="rk-label">出院病例数</div><div class="rk-value num">${km(s.n)}</div></div>
    <div class="rk"><div class="rk-label">CMI</div><div class="rk-value num">${p2(s.cmi)}</div></div>
    <div class="rk"><div class="rk-label">平均住院日</div><div class="rk-value num">${s.los.toFixed(1)}天</div></div>
    <div class="rk"><div class="rk-label">结余率</div><div class="rk-value num" style="color:${s.balanceRate >= 0 ? "var(--green)" : "var(--red)"}">${s.balanceRate >= 0 ? "+" : ""}${pct(s.balanceRate)}</div></div>
  </div>`;

  html += `<h4>病种明细（按当前筛选）</h4><div id="reportDrgWrap"></div>`;

  document.getElementById("reportBody").innerHTML = html;

  reportDrgArr = drgArr.map(d => {
    const r = byG[d.code]; const st = deptStat(r); const t = sum(r, "total"), std = sum(r, "standard"); const rate = std ? (std - t) / std : 0; const bal = std - t;
    return { code: d.code, name: d.name, dept: r[0].dept, n: d.n, cmi: d.cmi, fee: t / r.length, rate, bal,
      drugRate: st.drugRate, materialRate: st.materialRate, checkRate: st.checkRate };
  }).sort((a, b) => b.n - a.n);
  reportPage = 0;
  renderReportDrgBlock();
}
