/* ==========================================================================
   DRG 数据分析系统 · 模块：真实病案 DRG 分组（grouping.js）
   --------------------------------------------------------------------------
   作用：分组全流程。上传 xlsx → 逐条调用 CHS-DRG 分组器 → 生成分析行 →
        分组完成自动载入分析看板；含分组明细表分页、CSV 导出、分组进度弹窗。
   依赖：drgcode.js（chsdrg 引擎）/ drg_weights.js（权重与费率）/
        xlsx.full.min.js（读表）/ core.js（工具与刷新）
   主要函数：
     parseYmd          从出院日期字符串解析年月
     groupXlsx         把表头对象逐行转成「诊断串+手术串」并调用 chsdrg 分组
     convertReal       分组结果 → 分析行（补年月、权重、标准费用、结余、费用拆分）
     renderGroupTable  分组明细表（每页 20 行）
     renderGroupPager  分组明细分页器
     exportGroupCSV    导出分组明细 CSV
     showGroupModal / hideGroupModal  分组进度弹窗
     setupGrouping     上传、分组、自动载入分析的事件绑定
   数据：
     分组原始行 { no 住院号, name, xb, nl, dept 出院病室, doc 住院医师, los, total, dt 出院日期,
                  drug 药品费, material 耗材费, check 检查费, drg, drgName, ok }
       drug     = 西药费 + 中成药费 + 中草药费
       material = 检查用一次性医用材料费 + 治疗用一次性医用材料费 + 手术用一次性医用材料费
       check    = 病理诊断费 + 实验室诊断费 + 影像学诊断费
     分析行在原始行基础上补 { ym, m, ml, rw, drug, material, check, other, standard, balance, status }
       （真实费用优先；表里缺这三组列或值为 0 时，回退按 DRG 权重配置的比例模拟）
       （doc 字段由医师对比模块 doctor.js 使用，缺省记为「未填医师」）
   ========================================================================== */
const DISEASE_FIELDS = ["诊断编码1","诊断编码2","诊断编码3","诊断编码4","诊断编码5","诊断编码6","诊断编码7","诊断编码8","诊断编码9","诊断编码10","诊断编码11","诊断编码12","诊断编码13","诊断编码14","诊断编码15","诊断编码16","诊断编码17","诊断编码18","诊断编码19","诊断编码20","诊断编码21","诊断编码22"];
const SURGERY_FIELDS = ["手术编码1","手术编码2","手术编码3","手术编码4","手术编码5","手术编码6","手术编码7","手术编码8"];

// 作用：从出院日期字符串解析出年与月
function parseYmd(s) {
  if (s == null) return null;
  const m = String(s).match(/(\d{4})-(\d{2})/);
  return m ? { y: +m[1], mo: +m[2] } : null;
}

// 作用：逐行拼诊断码/手术码并调用 CHS-DRG 分组器，输出分组原始行
function groupXlsx(json) {
  return json.map(e => {
    const xb = e["性别"] === "男" ? 1 : 2;
    const unit = e["年龄单位"] || "岁";
    const nl = unit === "岁" ? (+e["年龄"] || 0) : 0;
    const xsrtl = unit === "天" ? (+e["年龄"] || 0) : 0;
    const xsrtz = +e["新生儿入院体重"] || 0;
    let ds = "", ss = "";
    DISEASE_FIELDS.forEach(f => { if (e[f] !== "" && e[f] != null && e[f] !== undefined) ds += "," + e[f]; });
    SURGERY_FIELDS.forEach(f => { if (e[f] !== "" && e[f] != null && e[f] !== undefined) ss += "," + e[f]; });
    ds = ds.slice(1); ss = ss.slice(1);
    let drg = "", drgName = "", ok = false;
    try {
      const res = chsdrg(ds, ss, nl, xsrtl, xb, xsrtz);
      if (res && res[0]) { drg = String(res[0]); drgName = String(res[1] || res[0]); ok = true; }
      // 个别病组分组器未给中文名（返回 null），退回显示编码，避免页面出现 "null"
      if (drgName === "null" || drgName === "undefined") drgName = drg;
    } catch (err) { /* 单条失败记为未分组 */ }
    // 费用三项：按院内口径由明细费用列相加（列名须与表头逐字一致）
    const n2 = k => +e[k] || 0;
    const drug = n2("西药费") + n2("中成药费") + n2("中草药费");
    const material = n2("检查用一次性医用材料费") + n2("治疗用一次性医用材料费") + n2("手术用一次性医用材料费");
    const check = n2("病理诊断费") + n2("实验室诊断费") + n2("影像学诊断费");
    return { no: e["住院号"], name: e["姓名"], xb: e["性别"], nl: e["年龄"], dept: e["出院病室名称"],
             doc: e["住院医师"] || "未填医师",   // 住院医师：医师维度分析的唯一依据
             los: +e["住院天数"] || 0, total: +e["总费用"] || 0, dt: e["出院日期"],
             drug, material, check,               // 真实费用拆分（0 或缺列时 convertReal 回退按比例模拟）
             drg, drgName, ok };
  });
}

// 作用：分组结果转分析行：补年月、权重、标准费用、结余与费用拆分
function convertReal() {
  const r2 = v => Math.round(v * 100) / 100;   // 真实费用保留 2 位，避免浮点长尾
  realRows = realRaw.map(r => {
    const wt = weightOf(r.drg);
    const total = r.total || 0;
    const rw = r.ok ? +wt.rw.toFixed(2) : 0;
    // 真实费用优先；缺列或为 0（旧表）时回退到 DRG 配置比例模拟
    const drug = r.drug > 0 ? r2(r.drug) : Math.round(total * wt.drugRate);
    const material = r.material > 0 ? r2(r.material) : Math.round(total * wt.materialRate);
    const check = r.check > 0 ? r2(r.check) : Math.round(total * wt.checkRate);
    const other = Math.max(0, r2(total - drug - material - check));
    const standard = +(rw * DRG_WEIGHTS.RATE).toFixed(0);
    const balance = standard - total;
    const d = parseYmd(r.dt);
    const m = d ? d.mo : 1;
    const ml = d ? d.y + "-" + String(d.mo).padStart(2, "0") : "—";
    const ym = d ? d.y + "-" + String(d.mo).padStart(2, "0") : "";
    return { m, ml, ym, dept: r.dept || "未分科室", doc: r.doc || "未填医师",
             code: r.drg || "-", name: r.drgName || "未分组",
             rw, los: r.los, total, drug, material, check, other, standard, balance,
             status: r.ok ? "正常入组" : "未入组" };
  });
}

const GROUP_PAGE_SIZE = 20;   // 分组明细每页行数
let groupPage = 0;

// 作用：分组明细分页表（每页 20 行）
function renderGroupTable() {
  const body = document.getElementById("tbodyGroup");
  const meta = document.getElementById("gTableMeta");
  const total = realRaw.length, ok = realRaw.filter(r => r.ok).length, fail = total - ok;
  document.getElementById("gTotal").textContent = km(total);
  document.getElementById("gOk").textContent = km(ok);
  document.getElementById("gFail").textContent = km(fail);
  const exportBtn = document.getElementById("btnExportGroup");
  if (exportBtn) exportBtn.disabled = total === 0;
  const pager = document.getElementById("groupPager");
  if (!total) {
    body.innerHTML = '<tr><td colspan="11" class="empty-tip">请传入病案数据</td></tr>';
    meta.textContent = "请传入病案数据";
    if (pager) pager.innerHTML = "";
    return;
  }
  const pages = Math.max(1, Math.ceil(total / GROUP_PAGE_SIZE));
  if (groupPage > pages - 1) groupPage = pages - 1;
  if (groupPage < 0) groupPage = 0;
  const list = sortTableRows(realRaw, "group");          // 表头排序（未点过表头时保持原始顺序）
  bindTableSort("tableGroup", "group", () => { groupPage = 0; renderGroupTable(); });
  const start = groupPage * GROUP_PAGE_SIZE;
  const slice = list.slice(start, start + GROUP_PAGE_SIZE);
  meta.textContent = "共 " + km(total) + " 条 · 成功分组 " + km(ok) + " · 未分组 " + km(fail) + " · 当前显示第 " + km(start + 1) + "–" + km(start + slice.length) + " 条";
  body.innerHTML = slice.map(r => `
    <tr>
      <td>${r.no ?? ""}</td><td>${r.name ?? ""}</td><td>${r.xb ?? ""}</td>
      <td class="num">${r.nl ?? ""}</td><td>${r.dept ?? ""}</td><td>${r.doc ?? ""}</td>
      <td class="num">${r.los || ""}</td><td class="num">${r.total ? yuan(r.total) : ""}</td>
      <td>${r.ok ? `<span class="badge b-info">${r.drg}</span>` : "—"}</td>
      <td class="cell-name" title="${r.drgName || ""}">${r.drgName || "—"}</td>
      <td>${r.ok ? `<span class="badge b-pos">已分组</span>` : `<span class="badge b-warn">未分组</span>`}</td>
    </tr>`).join("");
  renderGroupPager(pages, total);
}

// 作用：分组明细分页器
function renderGroupPager(pages, total) {
  const pager = document.getElementById("groupPager");
  if (!pager) return;
  if (pages <= 1) { pager.innerHTML = ""; return; }
  pager.innerHTML =
    '<button class="btn btn-ghost" id="gPrev"' + (groupPage === 0 ? " disabled" : "") + '>上一页</button>' +
    '<span class="g-pager-info">第 ' + (groupPage + 1) + " / " + pages + " 页（每页 " + GROUP_PAGE_SIZE + " 条，共 " + km(total) + " 条）</span>" +
    '<button class="btn btn-ghost" id="gNext"' + (groupPage >= pages - 1 ? " disabled" : "") + '>下一页</button>';
  const pr = pager.querySelector("#gPrev"), nx = pager.querySelector("#gNext");
  if (pr) pr.addEventListener("click", () => { if (groupPage > 0) { groupPage--; renderGroupTable(); } });
  if (nx) nx.addEventListener("click", () => { if (groupPage < pages - 1) { groupPage++; renderGroupTable(); } });
}

// 作用：导出全量分组明细 CSV（不受分页限制）
function exportGroupCSV() {
  if (!realRaw.length) return;
  const header = ["住院号", "姓名", "性别", "年龄", "科室(出院病室)", "住院医师", "住院天数", "总费用(元)", "DRG编码", "DRG名称", "分组状态"];
  const rows = realRaw.map(r => [r.no, r.name, r.xb, r.nl, r.dept, r.doc, r.los, r.total, r.ok ? r.drg : "", r.ok ? r.drgName : "", r.ok ? "已分组" : "未分组"]);
  downloadCSV("DRG分组结果明细.csv", header, rows);
}

// 作用：显示「正在分组」进度弹窗
function showGroupModal(fileName) {
  const mask = document.getElementById("groupModal");
  const sub = document.getElementById("groupModalSub");
  if (sub) sub.textContent = fileName ? "正在解析 " + fileName + " 并逐条分组" : "正在调用 CHS-DRG 分组引擎";
  if (mask) mask.classList.add("show");
}

// 作用：关闭分组进度弹窗
function hideGroupModal() {
  const mask = document.getElementById("groupModal");
  if (mask) mask.classList.remove("show");
}

// 作用：上传、开始分组、分组完成自动载入分析的事件绑定
function setupGrouping() {
  const up = document.getElementById("groupUpload");
  const fileInput = document.getElementById("groupFile");
  const log = document.getElementById("groupFileLog");
  let selected = null;
  document.getElementById("btnPickFile").addEventListener("click", () => fileInput.click());
  up.addEventListener("dragover", e => { e.preventDefault(); up.classList.add("drag"); });
  up.addEventListener("dragleave", () => up.classList.remove("drag"));
  up.addEventListener("drop", e => {
    e.preventDefault(); up.classList.remove("drag");
    if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; fileInput.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  up.addEventListener("click", e => { if (e.target !== fileInput && e.target.tagName !== "BUTTON") fileInput.click(); });
  fileInput.addEventListener("change", e => {
    selected = e.target.files && e.target.files[0];
    log.textContent = selected ? "已选择：" + selected.name : "点击或拖拽 xlsx 文件到此处上传";
  });
  document.getElementById("btnExportGroup").addEventListener("click", exportGroupCSV);
  document.getElementById("btnGroup").addEventListener("click", () => {
    if (!selected) { log.textContent = "请先选择 xlsx 文件"; return; }
    log.textContent = "正在分组，请稍候…";
    showGroupModal(selected.name);
    const reader = new FileReader();
    reader.onload = ev => {
      setTimeout(() => {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
          const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          realRaw = groupXlsx(json);
          groupPage = 0;
          convertReal();
          renderGroupTable();
          dataSource = "real";                 // 分组完成自动载入分析
          state.depts = []; state.periods = []; state.search = "";
          document.getElementById("filterSearch").value = "";
          updateSrcTag();                      // core.js
          refresh();                           // core.js：刷新各分析模块与时间/科室下拉
          document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i.dataset.module === "overview"));
          document.querySelectorAll(".module").forEach(m => m.classList.remove("active"));
          document.getElementById("module-overview").classList.add("active");
          window.dispatchEvent(new Event("resize"));
          log.textContent = "分组完成：共 " + realRaw.length + " 条，已自动载入分析";
        } catch (err) { log.textContent = "读取失败：" + (err && err.message ? err.message : err); console.error(err); }
        hideGroupModal();
      }, 60);
    };
    reader.onerror = () => { log.textContent = "文件读取失败，请重试"; hideGroupModal(); };
    reader.readAsArrayBuffer(selected);
  });
}
