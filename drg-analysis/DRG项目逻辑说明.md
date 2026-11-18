# DRG 数据分析系统 · 项目逻辑说明

> 目的：看懂整个项目的数据怎么流动、每个 js 干什么、每个字段从哪来、怎么改。
> 改动前请先读第 6 章「新增字段的完整改动清单」和第 9 章「常见坑」。

---

## 1. 目录与文件职责

```
drg-analysis/
├─ DRG数据分析系统.html     页面骨架（导航、各模块 HTML、脚本加载顺序）
├─ css/style.css            全部样式（含表格、分页器、多选面板、弹窗）
├─ js/
│  ├─ echarts.min.js        第三方图表库（勿改）
│  ├─ drgcode.js            你自己的 CHS-DRG 分组器 3.28MB（勿改）
│  ├─ xlsx.full.min.js      SheetJS，读写 xlsx（勿改）
│  ├─ code_dict.js          编码字典：{diag: 36609 条, surg: 14167 条}（自动生成，勿手改）
│  ├─ drg_weights.js        ★ 权重/标杆配置——你要改的就是这里（RATE 权重单价 · map 病组标杆）
│  ├─ core.js               公共底座：状态、筛选、聚合（含消耗指数）、格式化、图表实例、气泡图、CSV 导出、刷新入口
│  ├─ overview.js           总览看板 6 KPI + 4 图 + 运营分析汇报
│  ├─ drg.js                病种分布（病种例数 / CMI / 效率气泡图 / 明细表 12 列）
│  ├─ cost.js               费用分析·科室层面（科室结余图 / 科室费用结构图）
│  ├─ groupcost.js          费用分析·病组层面（KPI / 病组费用对比 / 结构偏差 / 病组费用与结余明细）
│  │                        ※ 与 cost.js 同属侧栏「费用分析」一个模块，页面顺序：KPI → 科室两图 → 病组两图 → 明细表（11 列）
│  ├─ dept.js               科室对比（CMI / 效率 / 效率气泡图 / 汇总表 12 列）
│  ├─ doctor.js             医师对比（CMI / 效率 / 效率气泡图 / 汇总表 13 列，每页 20 位）
│  ├─ grouping.js           真实分组：上传 → 调分组器 → 生成分析数据 → 明细表/导出
│  └─ query.js              单条查询（不依赖上传数据，可独立用；结果卡展示病组标杆指标）
└─ _shots/                  截图与验证副本（非交付物，可整目录删除）
```

### 依赖与加载顺序（顺序不能乱）

```
echarts → drgcode（分组引擎）→ xlsx（读表）→ code_dict（字典）
      → drg_weights（权重/标杆）→ core（底座）
      → overview → drg → cost → groupcost → dept → doctor → grouping → query
```

为什么不能乱：后面的文件直接调用前面文件里定义的**全局函数/变量**（如 `deptStat`、`charts`、`weightOf`、`chsdrg`）。
`core.js` 的 `init()` 在所有文件加载完后由 `DOMContentLoaded` 触发，因此各模块的 `renderXxx` 必须在此之前已被定义。

---

## 2. 数据流总览

```
① 用户上传 xlsx
        ↓  SheetJS 解析（grouping.js · setupGrouping）
② 表头对象数组 json（一行 = 一个对象，key = Excel 表头文字）
        ↓  groupXlsx(json)  逐行拼诊断码/手术码，调用 chsdrg
③ realRaw[]   分组原始行（含姓名、住院号、住院医师等明细字段）
        ↓  convertReal()   补权重、标准费用、费用拆分、结余、年月、状态
④ realRows[]  分析行（全站分析都用它）
        ↓  currentRows()   按 时间/科室/关键词 过滤
⑤ 各模块 render(rows)  图 + 表 + KPI
```

同时 `dataSource` 从 `"preview"` 变为 `"real"`，`sourceRows()` 才开始返回数据；
未分组时 `sourceRows()` 返回 `[]`，`refresh()` 走 `renderNoData()` → 全站「请传入病案数据」。

**分组完成后自动做的事**（`setupGrouping` 的回调里）：
`realRaw = groupXlsx(json)` → `convertReal()` → `renderGroupTable()` → `dataSource="real"` → 清空筛选 → `updateSrcTag()` → `refresh()` → 自动切到「总览看板」。

---

## 3. 数据结构与字段字典

### 3.1 `realRaw[]` —— 分组原始行（含明细，供分组明细表与 CSV）

| 字段 | 含义 | 来源 |
|---|---|---|
| `no` | 住院号 | 表头 `住院号` |
| `name` | 姓名 | 表头 `姓名` |
| `xb` | 性别（**存的是「男/女」原文**） | 表头 `性别` |
| `nl` | 年龄原文 | 表头 `年龄` |
| `dept` | 科室 | 表头 `出院病室名称` |
| `doc` | 住院医师 | 表头 `住院医师`，空则 `未填医师` |
| `los` | 住院天数 | 表头 `住院天数` |
| `total` | 总费用 | 表头 `总费用` |
| `drug` | 药品费用 | `西药费 + 中成药费 + 中草药费` |
| `material` | 材料费 | `检查用一次性医用材料费 + 治疗用一次性医用材料费 + 手术用一次性医用材料费` |
| `check` | 检查费用 | `病理诊断费 + 实验室诊断费 + 影像学诊断费` |
| `dt` | 出院日期（字符串，如 `2022-10-12 08:20:00`） | 表头 `出院日期` |
| `drg` | DRG 编码 | `chsdrg()` 返回值 `[0]` |
| `drgName` | DRG 名称 | `chsdrg()` 返回值 `[1]` |
| `ok` | 是否分组成功 | `chsdrg` 是否返回编码 |

### 3.2 `realRows[]` —— 分析行（所有分析模块的输入）

| 字段 | 含义 | 计算方式 |
|---|---|---|
| `m` | 数字月 | 从 `dt` 取月份 |
| `ml` / `ym` | `"YYYY-MM"` | 从 `dt` 取，无日期时 `ml="—"`、`ym=""` |
| `dept` / `doc` | 科室 / 医师 | 来自 `realRaw`，空值兜底 |
| `code` / `name` | DRG 编码 / 名称 | `drg` / `drgName`，空则 `-` / `未分组` |
| `rw` | 权重 | `weightOf(drg).rw`，未分组为 0 |
| `los` | 住院天数 | 原值 |
| `total` | 总费用 | 原值 |
| `drug` | 药品费 | **真实值**：`西药费+中成药费+中草药费`；缺列/为 0 时回退 `total × drugRate` |
| `material` | 耗材费 | **真实值**：三项一次性医用材料费之和；缺失回退 `total × materialRate` |
| `check` | 检查检验费 | **真实值**：`病理+实验室+影像学诊断费`；缺失回退 `total × checkRate` |
| `other` | 其他费用 | `max(0, total - drug - material - check)` |
| `standard` | 标准费用 | `rw × DRG_WEIGHTS.RATE` |
| `balance` | 结余 | `standard - total`（正=结余，负=超支） |
| `status` | 入组状态 | 目前只有 `正常入组` / `未入组` |

### 3.3 全局状态（core.js）

| 变量 | 说明 |
|---|---|
| `state = {periods:[], depts:[], search:""}` | 空数组 = 全部；`periods` 存 `"YYYY-MM"`，`depts` 存科室名 |
| `dataSource` | `"preview"`（未分组）/ `"real"`（已载入） |
| `realRows` / `realRaw` | 见上 |
| `charts` | `{容器id: ECharts实例}` |
| 各模块分页状态 | `groupPage`、`drgPage`、`gcPage`、`reportPage`、`docPage`（均 0 起） |

---

## 4. 各 js 函数清单

### core.js（公共底座）

| 函数 | 作用 |
|---|---|
| `sourceRows()` | 当前数据源的分析行；未分组返回 `[]` |
| `hasData()` | 是否已载入分组数据 |
| `currentRows()` | 按 `periods / depts / search` 过滤后的行（search 匹配编码/病种名/科室） |
| `periodLabel()` / `deptLabel()` | 筛选条件的中文描述（用于汇报标题与导出文件名） |
| `sum(arr,key)` | 字段求和 |
| `aggBy(rows,key)` | 按字段分组 → `{值: 行数组}` |
| `deptStat(rows)` | 核心指标：`{n, cmi, los, fee, timeIndex, feeIndex, drugRate, materialRate, checkRate, normRate, balance, balanceRate, std}` |
| `benchOf(code)` | 取某 DRG 的标杆配置（读 `DRG_WEIGHTS.map`，未配置用 `default` 兜底并标记 `configured`） |
| `idxColor(v)` | 消耗指数配色：>1 红、<1 绿、=1 用正文色 |
| `renderEffBubble(id, items, opt)` | 三个模块共用的效率气泡图：x=时间消耗指数、y=费用消耗指数、气泡大小=病例数；四象限配色（双低绿 / 双高红 / 跨线橙）；`opt.note` 在图右上角写备注（用于说明被隐藏的离群点）；标签只给病例数前 N 个并自动避让 |
| `pct / yuan / km / p2` | 百分比 / 金额 / 千分位 / 两位小数 |
| `sortTableRows(arr, 表标识)` | 按表头排序状态排序（未点过表头则原样返回），见 9.1 |
| `bindTableSort(表id, 表标识, onSort)` | 绑定表头点击排序并画 ▲/▼（幂等） |
| `paintSortArrow(表, 状态)` | 在当前排序列画箭头 |
| `initChart(id)` | 初始化 ECharts 并存入 `charts` |
| `downloadCSV(fn, header, rows2d)` | 导出带 BOM 的 CSV（Excel 直接打开不乱码） |
| `setExportData(表标识, header, rows)` | 各明细表渲染时登记「当前筛选 + 当前排序」的完整数组，供导出使用（与分页无关） |
| `exportTable(表标识, 表名)` | 按登记的数据导出 CSV，文件名 = `表名_时间口径.csv`；没有数据时静默返回 |
| `updateMsLabels / bindMsPanel / fillPeriodOptions / fillDeptOptions / setupFilterDropdowns` | 时间、科室多选组件（勾选不重建 DOM，避免连续勾选中断） |
| `renderNoData()` | 无数据时各模块统一空态（KPI、4 张表、分页器、图表、汇报） |
| `refresh()` | **总刷新入口**，改动数据后调用它即可重绘全站 |
| `updateSrcTag()` | 分组区状态标签（已载入 N 条 / 请传入病案数据） |
| `bindEvents()` | 导航切换、生成汇报、所有 `[data-export]` 导出按钮（含各表头部按钮）、窗口 resize |
| `init()` | 图表实例 → 事件 → `setupGrouping` → `setupQuery` → 首屏渲染 |

`refresh()` 的执行顺序（重要）：

```
复位 drgPage/gcPage/docPage（分组表由 grouping.js 自己复位 groupPage）
→ fillDeptOptions/fillPeriodOptions（按数据动态生成筛选项）
→ 无数据 → renderNoData() 并 return
→ rows = currentRows()
→ renderKPIs / renderTrend / renderStatus / renderFeeStruct / renderDeptShare   (overview)
→ renderDrgTop / renderDrgCmi / renderDrgBubble / renderDrgTable                 (drg)
→ renderSurplus / renderFeeByDept                                               (cost)
→ renderGroupCost                                                               (groupcost)
→ renderDeptCmi / renderDeptEff / renderDeptBubble / renderDeptTable              (dept)
→ renderDocCmi / renderDocEff / renderDocBubble / renderDocTable                  (doctor)
```

### grouping.js（真实分组）

| 函数 | 作用 |
|---|---|
| `groupXlsx(json)` | 逐行读表头字段 → 拼诊断串/手术串 → `chsdrg()` → 返回 `realRaw` |
| `convertReal()` | `realRaw` → `realRows`（**无返回值，直接给全局 `realRows` 赋值**） |
| `renderGroupTable()` | 分组明细表（11 列，每页 20 行）、统计 总数/成功/未分组 |
| `renderGroupPager()` | 分组明细分页器 |
| `exportGroupCSV()` | 导出全量分组明细（不受分页限制） |
| `showGroupModal / hideGroupModal` | 「正在分组」进度弹窗 |
| `setupGrouping()` | 选择/拖拽文件、开始分组、分组完成自动载入 |

`groupXlsx` 里各组件的**取值规则**（改字段必看）：

```js
xb    = 性别 === "男" ? 1 : 2
nl    = 年龄单位为「岁」时取 年龄，否则 0
xsrtl = 年龄单位为「天」时取 年龄（新生儿天龄），否则 0
xsrtz = 新生儿入院体重
ds    = 诊断编码1..22 中存在值的拼成 "码1,码2,..."
ss    = 手术编码1..8  中存在值的拼成 "码1,码2,..."
chsdrg(ds, ss, nl, xsrtl, xb, xsrtz) → [DRG编码, DRG名称]
```

> 诊断/手术列名写死在 `DISEASE_FIELDS` / `SURGERY_FIELDS` 两个常量里（文件顶部）。表头改名时改这里。

### overview.js（总览 + 汇报）

| 函数 | 作用 | 数据字段 |
|---|---|---|
| `renderKPIs` | 8 项 KPI 卡（例数/CMI/住院日/次均费用/药·耗材·检查占比/结余） | `deptStat(rows)` |
| `renderTrend` | 月度趋势：次均费用（柱，左轴 元）+ CMI（折线，右副轴）；副轴按实际值上下留白后取整到 0.1（不是从 0 起，否则差异被压平）；月份 > 8 时隐藏数据标签并旋转 x 轴标签，避免重叠；`setOption(opt, true)` 清掉旧的三联图配置 | `ml`、`rw`、`total` |
| `renderStatus` | 费用构成饼图（药品/耗材/检查/医疗服务收入） | `drug`、`material`、`check`、`total` |
| `renderFeeStruct` | 各科室平均住院费用与平均住院日双折线（住院日副轴；按次均费用降序，费用轴为**对数刻度**，因重症医学科次均 ¥117k 远高于其他科室 2k~15k，线性轴会把其余科室压成平线） | `dept`、`los`、`total` |
| `renderDeptShare` | 科室病例占比 | `dept` |
| `renderReportDrgBlock` | 汇报内病种明细分页（20 行；10 列：编码/名称/病例数/CMI/次均费用/药·耗材·检查占比/结余率/结余，口径与「病种明细表」一致，无科室列） | 由 `generateReport` 组装的 `reportDrgArr` |
| `generateReport` | 生成 5 段文字 + KPI + 病种明细 | 全部 |

> 注意：`status` 目前只产出「正常入组 / 未入组」，因此入组质量图里「低倍率 / 高倍率」恒为 0。要启用需要自己加倍率判定规则（见第 8 章）。

### drg.js / cost.js / dept.js / doctor.js

> `cost.js` 与 `groupcost.js` 同属侧栏「费用分析」一个模块（`#module-cost`）：
> 上半部分是科室层面的两张图，下半部分是病组 vs 标杆的 KPI、两张图和一张明细表
> （病组费用与结余明细，11 列：编码/名称/病例数/实际次均/标杆/结余率/结余/住院日/药·耗材·检查 实标）。
> 原来单独的「病种结余明细」表已并入这张表，`renderCostTable` 已删除。
> 两个 js 文件仍是各自独立的渲染函数，只是挂在同一个 section 里，`refresh()` 依次调用即可。

| 文件 | 函数 | 图形/表格要点 |
|---|---|---|
| drg.js | `renderDrgTop` / `renderDrgCmi` / `renderDrgBubble` / `renderDrgTable` / `renderDrgPager` | 病种 Top10、CMI Top10、效率气泡图（病例数 Top 20，标签只写 DRG 编码）、明细 12 列 20 行/页（含时间/费用消耗指数） |
| cost.js | `renderSurplus` / `renderFeeByDept` | 科室结余横向柱、科室费用结构堆叠柱 |
| groupcost.js | `buildGroupCost` / `renderGroupCost`（内部再分 `renderGCostKpi` / `renderGCostFee` / `renderGCostStruct` / `renderGCostTable` / `renderGCostPager`） | 实际 vs 标杆：4 项对比卡、病组次均费用对比图（病例数 Top 12）、结构偏差图（百分点）、明细表 11 列 20 组/页（列宽用像素、名称列可换行；实际值高于标杆=红、低于=绿） |
| dept.js | `renderDeptCmi` / `renderDeptEff` / `renderDeptBubble` / `renderDeptTable` | 科室 CMI、效率双 Y 轴并排柱、效率气泡图（两指数都 >2 的离群科室不画并注明）、汇总 12 列（含时间/费用消耗指数） |
| doctor.js | `renderDocCmi` / `renderDocEff` / `renderDocBubble` / `buildDocArr` / `renderDocTable` / `renderDocPager` | 医师 CMI（前 12 名）、效率双轴、效率气泡图（病例数 Top 30）、汇总 13 列 20 行/页（含时间/费用消耗指数）；`主要科室` = 该医师收治最多的科室 |

### query.js（单条查询）

| 函数 | 作用 |
|---|---|
| `splitCodes(text)` | 按逗号/分号/换行/空格拆分编码 |
| `renderName(boxId, codes, dict)` | 编码 → 中文名（`CODE_DICT.diag` / `.surg`），未收录显示「（未收录）」 |
| `showSuggest(ta, dict, boxId)` | 输入时的联想下拉（前缀匹配，最多 8 条，点击填入并收起） |
| `setupQuery()` | 查询 / 清空 / 名称联动绑定；查询调用与分组同一个 `chsdrg` |

查询结果卡分两块：上排「DRG 编码 / 名称 / 分组状态」，下排「病组标杆指标」直接读
`DRG_WEIGHTS.map[code]`（未单独配置的病组回退 `DRG_WEIGHTS.default`，并在说明里标注
「未单独配置，兜底值」），逐项显示 `rw` / `cost` / `los` / `drugRate` / `materialRate` /
`checkRate` / `descr`。注意 `DRG_WEIGHTS` 是 `const` 声明，**不在 window 上**，
取值要用 `typeof DRG_WEIGHTS !== "undefined"` 判断，不能写 `window.DRG_WEIGHTS`。

---

## 5. 关键取值链路：从 Excel 表头到页面数字

以某一行为例：

```
Excel 列「总费用」= 8000、西药费 1500、中成药费 300、中草药费 0 …
   ↓ groupXlsx  → realRaw.total = +e["总费用"] = 8000
                   realRaw.drug = 西药费+中成药费+中草药费 = 1800
                   realRaw.material / realRaw.check 同理由各自明细列相加
   ↓ convertReal
      wt = weightOf(drg)              // {rw, drugRate, materialRate, checkRate}
      rw = ok ? wt.rw : 0
      drug = 1800                     // 真实值优先；为 0 或缺列才用 8000 × 0.30 模拟
      material = 表里三项材料费之和
      check = 表里三项诊断费之和
      other = 8000 - 1800 - material - check
      standard = rw × 6800
      balance = standard - 8000
   ↓ currentRows()（按筛选）
   ↓ deptStat(rows)
      cmi = Σrw / n        los = Σlos / n        fee = Σtotal / n
      drugRate = Σdrug / Σtotal
      normRate = 正常入组数 / n
      balance = Σstandard - Σtotal
```

**每个指标的定义只写在 `core.js` 的 `deptStat()` 一处**，各模块都调用它——改口径只改这里。

---

## 6. 新增字段的完整改动清单（以「药品费用」为例）

**现状（已实现）**：`drug / material / check` 已改为读表里的真实明细列相加（口径见 3.1），
只有当这几列为空或全 0（旧表格）时才回退到 `total × 各占比` 模拟。下面是这类改动的通用步骤，
以后再加新字段（如「护理费」「床位费」）照此办理即可。

### ① 把真实值读进来 —— `grouping.js` · `groupXlsx`

在返回对象里加字段（列名必须与 Excel 表头**逐字一致**）：

```js
const n2 = k => +e[k] || 0;                       // 表头取值，空值当 0
const drug = n2("西药费") + n2("中成药费") + n2("中草药费");
return { no: e["住院号"], name: e["姓名"], ...,
         drug,                                    // ← 组合口径的费用
         ... };
```

同时更新文件头的「数据契约」注释。

### ② 决定"真实值优先、缺失回退" —— `grouping.js` · `convertReal`

```js
const realDrug = r.drug;                                  // 表格里有没有值
const drug = (realDrug != null && realDrug > 0)
  ? realDrug                                               // 有真实值就用真实的
  : Math.round(total * wt.drugRate);                        // 没有才按比例模拟
```

注意：`realRaw` 里如果没有这一列，`r.drug` 会是 `undefined`，上面的判断会自然回退，不会报错。

### ③ 检查 `other` 是否变负数 —— `convertReal`

```js
const other = Math.max(0, total - drug - material - check);
```

已有 `Math.max(0, ...)` 保护，但如果真实药费 + 耗材 + 检查之和**大于**总费用（口径不一致时会发生），`other` 会一直是 0 而掩盖问题。建议改成：

```js
const other = Math.max(0, total - drug - material - check);
// 如需排查口径：if (drug + material + check > total) 计数并 console.warn
```

### ④ 口径确认 —— `core.js` · `deptStat`

`drugRate` 已经是 `Σdrug / Σtotal`，换成真实值后自动生效，**不用改**。
但要想清楚：**`total`（总费用）里是否包含药费**。若表里 `总费用` 已是全口径，占比按上面算就对了；若 `total` 是"除药费外"的口径，就要把分母改成 `total + drug`。

### ⑤ 页面里的"其他费用"已更名"医疗服务收入"（口径不变）

总览费用构成饼图（`renderStatus`）与 `cost.js` 的科室费用结构堆叠柱均按
`Σ(total − drug − material − check)` 或 `Σother / Σtotal` 计算，只是显示名改成
「医疗服务收入」；`drg_weights.js` 注释里的"其他费用"指同一笔钱。

### ⑥ 页面上的展示（按需要选做）

- **分组明细表**（`grouping.js` · `renderGroupTable`）：加 `<td>`；同时把 HTML 里 `#tableGroup` 的 `<colgroup>` 与 `<th>` 同步加上，**所有列宽百分比之和必须仍为 100%**，`colspan` 也要跟着 +1。
- **分组明细 CSV**（`exportGroupCSV`）：`header` 与 `rows` 两处都要加，顺序保持一致。
- **病种/科室/医师汇总表**：`deptStat()` 已提供 `drugRate` / `materialRate` / `checkRate`（合计占比口径为 各费用/总费用），直接 `pct(s.xxxRate)` 即可。
- **筛选器**：如果要按药占比筛选，需在 `state` 加字段并在 `currentRows()` 里加过滤条件。

### ⑦ 自检

1. 上传样例表 → 分组 → 看分组明细与"费用分析"页数字；
2. 抽查一条：`drug` 是否等于表里药费；
3. 「总览看板 → 费用结构」四段相加是否 ~100%；
4. 导出 CSV 列是否与表头对齐。

---

## 7. 新增一个分析模块的做法

1. **HTML**：侧栏加一个 `<button class="nav-item" data-module="xxx">`；复制一份 `<section class="module" id="module-xxx">`，放图表容器与表格（容器 id 要新起，如 `chartXxx`、`tbodyXxx`、`xxxPager`）。
2. **新 js 文件**（如 `js/xxx.js`）：按现有风格写 `renderXxx(rows)`，只依赖 `core.js` 的 `aggBy / deptStat / charts / currentRows`；表格分页参照 `renderGCostTable`（常量 20、页码变量、`renderXxxPager`）。
3. **`core.js`** 三处挂接：
   - `refresh()` 里加 `renderXxx(rows);`（并在开头复位分页变量）；
   - `renderNoData()` 的表格数组加 `["tbodyXxx", 列数]`、分页器数组加 `"xxxPager"`；
   - `init()` 的图表初始化列表加容器 id。
4. **HTML** 里 `<script src="js/xxx.js">` 放在 `core.js` 之后、`query.js` 之前。
5. 侧栏与文件头的模块编号、注释一并更新。

---

## 8. 想加"高倍率/低倍率"判定

现在 `status` 只有两种值。要真正区分，在 `convertReal()` 里按费用倍率改判：

```js
// 例：实际费用 / 标准费用 的比值
const ratio = standard ? total / standard : 1;
let status = "正常入组";
if (!r.ok) status = "未入组";
else if (ratio > 3) status = "高倍率";     // 阈值按院内口径调整
else if (ratio < 0.4) status = "低倍率";
```

改完入组质量的呈现位置只剩「运营分析汇报」的文字段落（按 `status` 统计）；总览 KPI 与入组质量图已按需替换为费用占比与费用构成，不再展示入组率。

---

## 9. 常见坑

1. **`convertReal()` 没有返回值**，它直接给全局 `realRows` 赋值——写 `realRows = convertReal()` 会得到 `undefined`。
2. **表头字段名必须逐字一致**：`出院病室名称`、`住院医师`、`诊断编码1`… 差一个字就读不到（结果是空/兜底值，不会报错）。
3. **`weightOf()` / `benchOf()` 都读 `drg_weights.js` 的 `map`**：`map` 里没有的编码会落到 `default`（rw=1.0、cost=2000、los=8.6），CMI 与标杆对比会失真。新增病组记得补 `map`（现有 871 个编码已配置）。
4. **`RATE` 必须与生成 `map.rw` 时用的基准一致**：`map` 里每条都满足 `cost ÷ rw = 7818`，说明这批权重是按「7818 元 = 1 个权重」折算的；而 `RATE` 现在是 6800，于是 `standard = rw × 6800` 会系统性比 `map.cost`（标杆）低约 13%，全站结余会显示成大额超支。改成 `RATE: 7818` 后，`standard` 才与标杆同口径（见第 11 章）。
5. **分页常量都是 20**（`GROUP_PAGE_SIZE / DRG_PAGE_SIZE / COST_PAGE_SIZE / GC_PAGE_SIZE / REPORT_PAGE_SIZE / DOC_PAGE_SIZE`），改一处不影响其他表。
6. **改表格列数要同步四处**：`<colgroup>` 宽度（合计 100%）、`<th>`、行模板 `<td>`、空态 `colspan`；`core.js` 的 `renderNoData()` 里也要同步 colspan。
   列宽可以写百分比，也可以写像素——**含「实 / 标」双值或长金额的表建议写像素**（病组费用表就是像素），百分比宽度在窄屏会把数字裁成「15.9% / 2…」。
7. **所有刷新都走 `refresh()`**：改了数据/筛选后不要自己单独调某个 `renderXxx`，否则分页与筛选项会不同步。
8. **CSV 带 BOM**：`downloadCSV` 已加 `\uFEFF`，Excel 才能正确识别中文，不要去掉。
9. **`charts` 里实例只初始化一次**，反复 `echarts.init` 会告警；新图表在 `init()` 里登记即可。
10. **`doc` 缺失兜底为「未填医师」**，会给医师表增加一行"未填医师"，属预期行为。
11. **导出都走登记制**：每张表在渲染时用 `setExportData` 登记全量数组，`exportTable` 只负责取数导出；`grouping.js` 的分组明细例外，直接导出 `realRaw`。导出不受分页影响，但**受当前筛选与当前排序**影响。
12. **表头排序依赖 `data-key`**：`<th data-key="字段名">` 里的字段名必须与行对象的属性名逐字一致，否则点了没反应（也不会报错）。新表要接排序，见第 9.1 节。

13. **类目多的柱状图，横轴标签要斜排**：`grid-2` 里半栏卡片只有约 470px，22 个科室横排标签（`interval: 0`）会挤成一团。统一做法：`rotate: 45` + `align: "right"` + `verticalAlign: "middle"`，`grid.left` 留 34px 给标签向左伸出的部分（否则首尾被卡片边界裁掉），`containLabel: true` 自动撑开底部；窄屏（`innerWidth < 720`，约 370px）再降为 `interval: 1`（隔一个显示）与 `fontSize: 10`。柱顶数值标签加 `labelLayout: { hideOverlap: true }`，重叠的自动隐藏。参考 `dept.js` 的 `renderDeptCmi` / `renderDeptEff`。

### 9.1 表头排序怎么做（新增表时照抄）

排序能力是通用的一套，逻辑全在 `core.js`：

| 函数 | 作用 |
|---|---|
| `sortTableRows(arr, 表标识)` | 按当前排序状态返回排好序的副本；没点过表头时原样返回（保留各表默认排序） |
| `bindTableSort(表id, 表标识, onSort)` | 给带 `data-key` 的表头绑点击事件，并在当前列右侧画 ▲/▼；重复调用不会重复绑 |
| `tableSorts` | 排序状态 `{ 表标识: { key, dir } }`，`dir=1` 升序 / `-1` 降序 |

接入三步：

1. **表头加 `data-key`**（值 = 该列对应的行对象属性名）：
   ```html
   <th class="num" data-key="fee">次均费用(元)</th>
   ```
2. **渲染函数里先排序再分页**：
   ```js
   let arr = Object.keys(byG).map(...).sort(默认排序);
   arr = sortTableRows(arr, "drg");
   ```
3. **绑事件，并在排序后回到第 1 页**（同时也是重渲染的入口）：
   ```js
   bindTableSort("tableDrg", "drg", () => { drgPage = 0; renderDrgTable(currentRows()); });
   ```

细节：
- 数值（含布尔，`true=1`）按数值比；字符串按 `zh-Hans-CN` 拼音序、`numeric:true`（`AA2` 排在 `AA19` 前面）；**空值恒排最后**。
- 「实际/标杆」这种双值列（病组费用表的住院日、三项占比）按**实际值**排序。
- 同一列再点一次反向；点别的列则换列并从升序开始。
- 排序状态与筛选、翻页无关：翻页保持排序，切换筛选后排序仍在（但页码会回到第 1 页）。
- 汇报里的病种明细表是每次渲染动态生成的，所以 `bindTableSort` 放在 `wrap.innerHTML = ...` 之后（表 id `tableReport`）。

---

### 9.2 给一张表加「导出CSV」

导出是一套通用链路：按钮 → `exportTable` → `exportData`（登记好的全量数组）→ `downloadCSV`。

1. **卡片头加按钮**（`data-export` = 表标识，`data-name` = 文件名前缀），不用写 js：
   ```html
   <div class="card-tools">
     <span class="card-sub">卡片右侧的说明文字</span>
     <button class="btn btn-ghost btn-sm" data-export="dept" data-name="科室综合对比">导出CSV</button>
   </div>
   ```
   按钮由 `core.js` 的 `bindEvents()` 里 `document.querySelectorAll("[data-export]")` 统一绑定。
2. **渲染函数里登记数据**：放在「排序之后、分页切片之前」，保证导出顺序 = 表头当前排序。
   ```js
   setExportData("dept", ["科室", "病例数", "CMI", ...], arr.map(s => [s.dept, s.n, p2(s.cmi), ...]));
   ```
   登记的是**全量**数组，所以导出的永远是整张表，不是当前页。
3. **口径**：`pct()` 格式化后的字符串直接进 CSV（Excel 按文本显示，够用）；金额用 `Math.round()` 输出纯数字，便于在 Excel 里再求和。
4. 现有表标识：`drg` / `gcost` / `dept` / `doc` / `report`；分组明细仍走 `grouping.js` 的 `exportGroupCSV`（数据源是 `realRaw`）。

## 10. 一页速查

| 我想改… | 去改 |
|---|---|
| DRG 权重、标杆费用/住院日/结构占比、权重单价 | `js/drg_weights.js` 的 `map` / `default` / `RATE`（含义见第 11 章） |
| 药品/耗材/检查的费用口径 | `grouping.js` 的 `groupXlsx`（三组明细列相加） |
| 病组费用分析（实际 vs 标杆，属「费用分析」模块的下半部分） | `js/groupcost.js`：`buildGroupCost` 算数据，四个 `renderGCostXxx` 管展示 |
| 新增/改名 Excel 字段 | `grouping.js` 的 `groupXlsx`（返回字段）+ `convertReal`（分析字段） |
| 指标口径（CMI、药占比、结余率…） | `core.js` 的 `deptStat()` |
| 筛选逻辑 | `core.js` 的 `currentRows()` 与 `state` |
| 某张图的数据/样式 | 对应模块 js 的 `renderXxx` |
| 表格列与分页 | 模块 js 的 `renderXxxTable` + HTML 的 `<colgroup>` |
| 空态文案 | `core.js` 的 `renderNoData()` / 各 `renderXxxTable` 内的 `empty-tip` |
| 导出内容 | 各表渲染函数里的 `setExportData(...)`（列定义与数据都在这行）+ `grouping.js` 的 `exportGroupCSV` |
| 整体样式 | `css/style.css` |

---

## 11. drg_weights.js 三个字段怎么用

| 字段 | 含义 | 用在哪 |
|---|---|---|
| `RATE` | **权重单价**（元 / 1 个权重）。标准费用 `standard = rw × RATE`，`balance = standard − total`。相当于医保为该 DRG 支付的「每权重单价」，改费率时只改这一个数 | CMI→钱的换算：标准费用、结余/超支、结余率 |
| `map[编码].rw` | 病组权重（相对资源消耗），用于 `CMI = Σrw ÷ 例数` | 病种/科室/医师 CMI、标准费用 |
| `map[编码].cost` | **标杆次均费用**（该病组应有的次均费用），本例中 `cost = rw × 7818` | 病组费用分析：实际次均 vs 标杆（表内不再显示偏差额/偏差率，改用红/绿表示高于/低于标杆；偏差仍用于 KPI 与两张图） |
| `map[编码].los` | 标杆平均住院日 | 病组费用分析：实际住院日 vs 标杆 |
| `map[编码].drugRate / materialRate / checkRate` | 标杆费用结构占比（同时作为缺失真实费用时的回退比例） | 结构偏差图、`convertReal` 回退 |

> 一句话：`rw` 决定「该病组值多少权重」，`RATE` 决定「1 个权重值多少钱」，`cost/los/结构占比` 是「这个病组本该长什么样」的标杆。
> 本项目中 `cost ÷ rw` 恒为 7818，故 `RATE` 建议同步为 7818，否则结余口径与标杆不一致。

---
