/* ==========================================================================
   DRG 数据分析系统 · 模块：单条查询（query.js）
   --------------------------------------------------------------------------
   作用：单个病例即时分组。手输诊断/手术编码（支持多行）、编码联想下拉、
        编码自动映射为中文名称、调用分组器返回 DRG 编码与名称；
        分组成功后同时展示该病组在 drg_weights.js 中的标杆指标
        （RW / 标杆次均费用 / 标杆住院日 / 药·耗材·检查占比 / 说明）。
   依赖：drgcode.js（chsdrg）、code_dict.js（CODE_DICT 编码→名称）
   主要函数：
     splitCodes    把多行/逗号分隔的编码拆成数组
     renderName    把编码映射成中文名称显示到名称栏
     showSuggest   输入编码时的候选下拉（点击即填入并收起）
     setupQuery    查询按钮、清空、名称联动的事件绑定
   说明：该模块不依赖上传数据，可独立使用。
   ========================================================================== */
// 作用：把多行/逗号分隔的编码字符串拆成数组
function splitCodes(text) {
  return text.split(/[,，;；\n\r\t ]+/).map(s => s.trim()).filter(Boolean);
}

// 作用：把编码映射成中文名称写入名称栏
function renderName(boxId, codes, dict) {
  const box = document.getElementById(boxId);
  if (!codes.length) { box.innerHTML = ""; return; }
  box.innerHTML = codes.map(c => {
    const name = dict[c];
    return `<div class="nb-row${name ? "" : " nb-miss"}">${name || "（未收录）"}</div>`;
  }).join("");
}

// 作用：输入编码时的候选下拉（点击即填入并收起）
function showSuggest(ta, dict, boxId) {
  const box = ta.parentNode.querySelector(".code-suggest");
  if (box) box.remove();
  const val = ta.value;
  const parts = val.split(/[,，;；\n\r\t ]+/);
  const last = (parts[parts.length - 1] || "").trim();
  if (!last) return;
  const matches = Object.keys(dict).filter(k => k.indexOf(last) === 0).slice(0, 8);
  if (!matches.length) return;
  const sug = document.createElement("div");
  sug.className = "code-suggest";
  ta.insertAdjacentElement("afterend", sug);
  sug.innerHTML = matches.map(k =>
    `<div class="cs-item" data-code="${k}"><b>${k}</b><span title="${dict[k]}">${dict[k]}</span></div>`).join("");
  sug.querySelectorAll(".cs-item").forEach(it => {
    it.addEventListener("mousedown", ev => ev.preventDefault());
    it.addEventListener("click", () => {
      const code = it.getAttribute("data-code");
      const parts2 = val.split(/[,，;；\n\r\t ]+/);
      parts2[parts2.length - 1] = code;
      const delim = val.includes("\n") ? "\n" : ",";
      ta.value = parts2.join(delim);
      ta.focus();
      const s = ta.parentNode.querySelector(".code-suggest");
      if (s) s.remove();
      renderName(boxId, splitCodes(ta.value), dict);
    });
  });
}

// 作用：单条查询模块的交互绑定
function setupQuery() {
  const card = document.getElementById("queryResultCard");
  const defs = [
    ["qDiag", "diagNameBox", CODE_DICT.diag],
    ["qSurg", "surgNameBox", CODE_DICT.surg]
  ];

  defs.forEach(([taId, boxId, dict]) => {
    const ta = document.getElementById(taId);
    ta.addEventListener("input", () => {
      renderName(boxId, splitCodes(ta.value), dict);
      showSuggest(ta, dict, boxId);
    });
  });

  const clear = () => {
    ["qDiag", "qSurg", "qAge", "qWeight"].forEach(id => { document.getElementById(id).value = ""; });
    ["diagNameBox", "surgNameBox"].forEach(id => { document.getElementById(id).innerHTML = ""; });
    card.style.display = "none";
  };  document.getElementById("btnQueryClear").addEventListener("click", clear);
  document.getElementById("btnQuery").addEventListener("click", () => {
    const diag = document.getElementById("qDiag").value.trim();
    const surg = document.getElementById("qSurg").value.trim();
    const unit = document.getElementById("qAgeUnit").value;
    const age = +document.getElementById("qAge").value || 0;
    const nl = unit === "岁" ? age : 0;
    const xsrtl = unit === "天" ? age : 0;
    const xb = document.getElementById("qSex").value === "男" ? 1 : 2;
    const xsrtz = +document.getElementById("qWeight").value || 0;
    const ds = splitCodes(diag).join(",");
    const ss = splitCodes(surg).join(",");
    if (!ds && !ss) { alert("请至少输入诊断编码或手术编码"); return; }
    let code = "-", name = "无匹配分组", ok = false;
    try {
      const res = chsdrg(ds, ss, nl, xsrtl, xb, xsrtz);
      if (res && res[0]) {
        code = String(res[0]); name = String(res[1] || res[0]); ok = true;
        if (name === "null" || name === "undefined") name = code;   // 个别病组无中文名，退回编码
      }
    } catch (err) { name = "分组器执行出错"; }
    document.getElementById("qResCode").textContent = code;
    document.getElementById("qResName").textContent = name;
    const st = document.getElementById("qResStatus");
    st.textContent = ok ? "分组成功" : "未匹配";
    st.style.color = ok ? "var(--green)" : "var(--red)";
    document.getElementById("qResultMeta").textContent =
      "诊断 " + (ds ? ds.split(",").length + " 条" : "—") + " · 手术 " + (ss ? ss.split(",").length + " 条" : "—") + " · 年龄" + (unit === "岁" ? nl + "岁" : xsrtl + "天") + " · " + (xb === 1 ? "男" : "女");
    // 病组标杆指标（来自 drg_weights.js 的 map；未单独配置的病组回退 default 兜底值）
    const benchIds = ["qResRw", "qResCost", "qResLos", "qResDrug", "qResMat", "qResChk", "qResDescr"];
    if (ok) {
      const W = typeof DRG_WEIGHTS !== "undefined" ? DRG_WEIGHTS : null;   // const 声明，不在 window 上
      const inMap = !!(W && W.map && W.map[code]);
      const e = W ? (W.map[code] || W.default) : {};
      document.getElementById("qResRw").textContent = e.rw != null ? (+e.rw).toFixed(4) : "—";
      document.getElementById("qResCost").textContent = e.cost != null ? yuan(e.cost) : "—";
      document.getElementById("qResLos").textContent = e.los != null ? (+e.los).toFixed(2) + " 天" : "—";
      document.getElementById("qResDrug").textContent = e.drugRate != null ? pct(e.drugRate) : "—";
      document.getElementById("qResMat").textContent = e.materialRate != null ? pct(e.materialRate) : "—";
      document.getElementById("qResChk").textContent = e.checkRate != null ? pct(e.checkRate) : "—";
      document.getElementById("qResDescr").textContent = e.descr ? (e.descr + (inMap ? "" : "（未单独配置，兜底值）")) : "—";
    } else {
      benchIds.forEach(id => { document.getElementById(id).textContent = "—"; });
    }
    card.style.display = "block";
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}
