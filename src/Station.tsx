// 染整小样补料复核台 —— 页面
// 列表按订单分组、组内按序号排列；登记 / 待确认修正 / 保温后复测 / 改用量留档。

import { useEffect, useMemo, useState } from "react";
import {
  AXIS_LABEL,
  ACTIVE_STATUSES,
  STATUS_LABEL,
  evaluateAxes,
  findActiveSheet,
  nextSeq,
  padSeq,
  reviseSheet,
  startSheet,
  submitRetest,
  totalAdditionMl,
  changeDosage,
  type AdditionItem,
  type AxisKey,
  type FeedSheet,
  type FeedSheetDraft,
  type RetestInput,
  type SheetStatus,
  type OrderSpec,
} from "./rules";
import {
  batchesOf,
  findBatch,
  findOrder,
  loadArchive,
  resetArchive,
  saveArchive,
  type Archive,
} from "./archive";

type Mode = "detail" | "new";

interface AddRow {
  dye: string;
  amount: string;
}

interface RegFormState {
  orderNo: string;
  batchNo: string;
  residual: string;
  holdTemp: string;
  feeder: string;
  note: string;
  additions: AddRow[];
}

function fmtTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString("zh-CN", { hour12: false });
}

function emptyAdditions(seed?: AdditionItem[]): AddRow[] {
  if (seed && seed.length > 0) return seed.map((a) => ({ dye: a.dye, amount: String(a.amountMl) }));
  return [{ dye: "", amount: "" }];
}

function statusBadge(status: SheetStatus) {
  return <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>;
}

export default function Station() {
  const [archive, setArchive] = useState<Archive>(() => loadArchive());
  const [orderFilter, setOrderFilter] = useState<string>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("detail");
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    saveArchive(archive);
  }, [archive]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const selected = archive.sheets.find((s) => s.id === selectedId) ?? null;

  const counts = useMemo(() => {
    const c: Record<SheetStatus, number> = {
      pending: 0,
      awaiting: 0,
      passed: 0,
      over: 0,
      archived: 0,
    };
    for (const s of archive.sheets) c[s.status] += 1;
    return c;
  }, [archive.sheets]);

  const grouped = useMemo(() => {
    return archive.orders
      .filter((o) => orderFilter === "ALL" || o.orderNo === orderFilter)
      .map((o) => ({
        order: o,
        sheets: archive.sheets
          .filter((s) => s.orderNo === o.orderNo)
          .sort((a, b) => a.seq - b.seq),
      }));
  }, [archive, orderFilter]);

  function nextId(): string {
    const max = archive.sheets.reduce((m, s) => {
      const n = parseInt(s.id.replace(/\D/g, ""), 10);
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return `S-${String(max + 1).padStart(4, "0")}`;
  }

  function notify(text: string, tone: "ok" | "err" = "ok") {
    setToast({ text, tone });
  }

  function openNew() {
    setSelectedId(null);
    setMode("new");
  }

  function openSheet(id: string) {
    setSelectedId(id);
    setMode("detail");
  }

  function handleRegister(state: RegFormState): boolean {
    const order = findOrder(archive, state.orderNo);
    const batch = findBatch(archive, state.batchNo);
    if (!order || !batch) {
      notify("请选择订单与批次。", "err");
      return false;
    }
    const blocker = findActiveSheet(archive.sheets, batch.batchNo);
    if (blocker) {
      notify(
        `批次 ${batch.batchNo} 已有在途单 ${blocker.id}（${STATUS_LABEL[blocker.status]}），每批只允许一张在途单。`,
        "err"
      );
      return false;
    }
    const draft: FeedSheetDraft = {
      orderNo: order.orderNo,
      batchNo: batch.batchNo,
      residualL: parseFloat(state.residual),
      holdTempC: parseFloat(state.holdTemp),
      additions: state.additions.map((a) => ({ dye: a.dye.trim(), amountMl: parseFloat(a.amount) })),
      feeder: state.feeder.trim(),
      note: state.note.trim(),
    };
    const sheet = startSheet(nextId(), nextSeq(archive.sheets, order.orderNo), draft, order, new Date().toISOString());
    setArchive((prev) => ({ ...prev, sheets: [...prev.sheets, sheet] }));
    openSheet(sheet.id);
    notify(
      sheet.status === "awaiting"
        ? `登记完成，${sheet.id} 已进入待复测。`
        : `${sheet.id} 留在待确认，请按提示修正后再提交。`,
      sheet.status === "awaiting" ? "ok" : "err"
    );
    return true;
  }

  function handleRevise(id: string, state: RegFormState) {
    const sheet = archive.sheets.find((s) => s.id === id);
    const order = sheet ? findOrder(archive, sheet.orderNo) : undefined;
    if (!sheet || !order) return;
    const draft: FeedSheetDraft = {
      orderNo: sheet.orderNo,
      batchNo: sheet.batchNo,
      residualL: parseFloat(state.residual),
      holdTempC: parseFloat(state.holdTemp),
      additions: state.additions.map((a) => ({ dye: a.dye.trim(), amountMl: parseFloat(a.amount) })),
      feeder: state.feeder.trim(),
      note: state.note.trim(),
    };
    const updated = reviseSheet(sheet, draft, order);
    setArchive((prev) => ({
      ...prev,
      sheets: prev.sheets.map((s) => (s.id === id ? updated : s)),
    }));
    notify(
      updated.status === "awaiting"
        ? "修正完成，重新校验通过，回到待复测。"
        : "修正后仍有待确认项，请继续处理。",
      updated.status === "awaiting" ? "ok" : "err"
    );
  }

  function handleRetest(id: string, input: RetestInput) {
    const sheet = archive.sheets.find((s) => s.id === id);
    const order = sheet ? findOrder(archive, sheet.orderNo) : undefined;
    if (!sheet || !order) return;
    const outcome = submitRetest(sheet, input, order);
    const now = new Date().toISOString();
    let next: FeedSheet = sheet;
    if (outcome.kind === "passed") {
      next = {
        ...sheet,
        status: "passed",
        issues: [],
        advice: [],
        retest: { ...input, reviewer: input.reviewer.trim(), at: now },
      };
      notify("三轴均在订单容差内，复测通过，本单关闭。");
    } else if (outcome.kind === "over") {
      next = {
        ...sheet,
        status: "over",
        issues: [],
        advice: outcome.advice,
        retest: { ...input, reviewer: input.reviewer.trim(), at: now },
      };
      notify("复测超限：仅给出后续建议，系统不会自动追加染料。", "err");
    } else {
      next = { ...sheet, status: "pending", issues: outcome.issues };
      notify("补料人不能兼任复核人，本单留在待确认。", "err");
    }
    setArchive((prev) => ({
      ...prev,
      sheets: prev.sheets.map((s) => (s.id === id ? next : s)),
    }));
  }

  function handleChangeDosage(id: string, additions: AdditionItem[]) {
    const old = archive.sheets.find((s) => s.id === id);
    const order = old ? findOrder(archive, old.orderNo) : undefined;
    if (!old || !order) return;
    if (validRows(additions).length === 0) {
      notify("请至少填写一种染料的新追加量（mL）。", "err");
      return;
    }
    const blocker = findActiveSheet(archive.sheets, old.batchNo);
    if (blocker && blocker.id !== old.id) {
      notify(`批次 ${old.batchNo} 已有在途单 ${blocker.id}，不能再开新单。`, "err");
      return;
    }
    const newId = nextId();
    const { archived, fresh } = changeDosage(old, additions, order, newId, new Date().toISOString());
    setArchive((prev) => ({
      ...prev,
      sheets: [...prev.sheets.map((s) => (s.id === old.id ? archived : s)), fresh],
    }));
    openSheet(fresh.id);
    notify(`用量已变更：${old.id} 留档且原复测失效，新单 ${fresh.id}（序号 ${padSeq(fresh.seq)}）。`);
  }

  function handleReset() {
    setArchive(resetArchive());
    setSelectedId(null);
    setMode("detail");
    notify("已恢复演示档案。");
  }

  return (
    <main className="app station">
      <header className="topbar">
        <div>
          <p className="kicker">染整实验室 · 复染补料</p>
          <h1>补料复核台</h1>
          <p className="ruleline">
            每批只允许一张在途单 · 按订单容差判定 · 保温后须由另一人复测 · 超限只给建议不自动追加 · 改用量旧单留档
          </p>
        </div>
        <div className="top-actions">
          <button className="primary" onClick={openNew}>
            ＋ 登记补料单
          </button>
          <button onClick={handleReset}>恢复演示数据</button>
        </div>
      </header>

      <section className="metrics">
        {(
          [
            ["pending", "待确认"],
            ["awaiting", "在途·待复测"],
            ["passed", "复测通过"],
            ["over", "复测超限"],
            ["archived", "旧单留档"],
          ] as [SheetStatus, string][]
        ).map(([key, label]) => (
          <article key={key} className={`metric st-${key}`}>
            <small>{label}</small>
            <strong>{counts[key]}</strong>
          </article>
        ))}
      </section>

      {toast && <div className={`toast ${toast.tone}`}>{toast.text}</div>}

      <div className="workspace">
        <aside className="panel list-panel">
          <div className="list-head">
            <h2>补料单</h2>
            <span>按订单 / 序号</span>
          </div>
          <div className="chips">
            <button className={orderFilter === "ALL" ? "on" : ""} onClick={() => setOrderFilter("ALL")}>
              全部订单
            </button>
            {archive.orders.map((o) => (
              <button
                key={o.orderNo}
                className={orderFilter === o.orderNo ? "on" : ""}
                onClick={() => setOrderFilter(o.orderNo)}
              >
                {o.orderNo}
              </button>
            ))}
          </div>
          <div className="groups">
            {grouped.map(({ order, sheets }) => (
              <div className="group" key={order.orderNo}>
                <div className="group-head">
                  <b>{order.orderNo}</b>
                  <span>
                    {order.customer} · {order.fabric} · {order.shade}
                  </span>
                </div>
                {sheets.length === 0 && <div className="group-empty">暂无补料单</div>}
                {sheets.map((s) => (
                  <button
                    key={s.id}
                    className={`sheet-row ${selectedId === s.id && mode === "detail" ? "sel" : ""}`}
                    onClick={() => openSheet(s.id)}
                  >
                    <span className="seq">#{padSeq(s.seq)}</span>
                    <span className="sheet-main">
                      <b>{s.batchNo}</b>
                      <small>
                        {s.additions.length} 种染料 · 合计 {totalAdditionMl(s.additions).toFixed(1)}mL ·{" "}
                        {fmtTime(s.createdAt).slice(5, 16)}
                      </small>
                    </span>
                    {statusBadge(s.status)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <section className="panel detail-panel">
          {mode === "new" ? (
            <RegisterForm
              archive={archive}
              defaultOrderNo={orderFilter !== "ALL" ? orderFilter : archive.orders[0]?.orderNo ?? ""}
              onCancel={() => setMode("detail")}
              onSubmit={handleRegister}
            />
          ) : selected ? (
            <SheetDetail
              key={selected.id}
              archive={archive}
              sheet={selected}
              onRevise={handleRevise}
              onRetest={handleRetest}
              onChangeDosage={handleChangeDosage}
              onOpen={openSheet}
            />
          ) : (
            <RuleBoard />
          )}
        </section>
      </div>
    </main>
  );
}

function validRows(additions: AdditionItem[]): AdditionItem[] {
  return additions.filter((a) => a.dye.trim() !== "" && Number.isFinite(a.amountMl) && a.amountMl > 0);
}

/* ---------------- 右侧规则说明（未选单时） ---------------- */

function RuleBoard() {
  return (
    <div className="ruleboard">
      <p className="kicker">操作流程</p>
      <h2>补料复核规则</h2>
      <ol>
        <li>
          <b>登记</b>：选择订单与批次，登记余液量、各染料追加量、保温温度与补料人；每个批次同时只允许一张在途单。
        </li>
        <li>
          <b>待确认</b>：余液低于订单要求、保温温度偏离允差，单据留在待确认，修正后重新校验。
        </li>
        <li>
          <b>保温后复测</b>：须由<b>补料人之外的另一人</b>登记 ΔL*、Δa*、Δb*；补料人兼复核人的，退回待确认。
        </li>
        <li>
          <b>三轴判定</b>：三轴绝对值均不超过订单容差才算复测通过；任一轴超差只给后续校正建议，不自动追加染料。
        </li>
        <li>
          <b>改用量</b>：修改已复测单据的追加量，原复测立即失效，旧单留档，并按订单下一序号另开新单。
        </li>
      </ol>
      <p className="hint">从左侧选择补料单查看详情，或点击右上角「登记补料单」。</p>
    </div>
  );
}

/* ---------------- 补料单详情 ---------------- */

interface DetailProps {
  archive: Archive;
  sheet: FeedSheet;
  onRevise: (id: string, state: RegFormState) => void;
  onRetest: (id: string, input: RetestInput) => void;
  onChangeDosage: (id: string, additions: AdditionItem[]) => void;
  onOpen: (id: string) => void;
}

function SheetDetail({ archive, sheet, onRevise, onRetest, onChangeDosage, onOpen }: DetailProps) {
  const order = findOrder(archive, sheet.orderNo);
  const [revise, setRevise] = useState(false);
  const [dosage, setDosage] = useState(false);

  if (!order) return <div>订单档案缺失。</div>;

  const successor = sheet.supersededBy
    ? archive.sheets.find((x) => x.id === sheet.supersededBy)
    : undefined;

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <p className="kicker">
            {sheet.orderNo} · {sheet.batchNo}
          </p>
          <h2>
            补料单 {sheet.id} <small>序号 #{padSeq(sheet.seq)}</small>
          </h2>
        </div>
        {statusBadge(sheet.status)}
      </div>

      <ToleranceCard sheet={sheet} orderNo={sheet.orderNo} archive={archive} />

      {sheet.issues.length > 0 && (
        <div className="issues">
          <h3>待确认原因</h3>
          <ul>
            {sheet.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      {sheet.note && (
        <p className="note">
          <b>备注：</b>
          {sheet.note}
        </p>
      )}

      <RegisteredData sheet={sheet} />

      {sheet.status === "pending" && !revise && (
        <div className="actions">
          <button className="primary" onClick={() => setRevise(true)}>
            修正登记内容
          </button>
          <span className="hint">修正余液 / 温度 / 追加量 / 补料人后重新校验，通过即回到待复测。</span>
        </div>
      )}
      {sheet.status === "pending" && revise && (
        <RegisterForm
          archive={archive}
          initial={sheet}
          onCancel={() => setRevise(false)}
          onSubmit={(state) => {
            onRevise(sheet.id, state);
            setRevise(false);
            return true;
          }}
        />
      )}

      {sheet.status === "awaiting" && <RetestForm sheet={sheet} order={order} onSubmit={onRetest} />}

      {(sheet.status === "passed" || sheet.status === "over") && (
        <RetestPanel sheet={sheet} order={order} />
      )}

      {sheet.status === "over" && !dosage && (
        <div className="actions">
          <button className="primary" onClick={() => setDosage(true)}>
            修改追加用量（原复测失效，开新单）
          </button>
          <span className="hint">系统不自动追加；如需补料请改用量后按新序号重新执行与复测。</span>
        </div>
      )}
      {sheet.status === "over" && dosage && (
        <DosageForm
          sheet={sheet}
          onCancel={() => setDosage(false)}
          onSubmit={(items) => {
            onChangeDosage(sheet.id, items);
            setDosage(false);
          }}
        />
      )}

      {sheet.status === "passed" && !dosage && (
        <div className="actions">
          <button onClick={() => setDosage(true)}>修改追加用量（留档另开新单）</button>
        </div>
      )}
      {sheet.status === "passed" && dosage && (
        <DosageForm
          sheet={sheet}
          onCancel={() => setDosage(false)}
          onSubmit={(items) => {
            onChangeDosage(sheet.id, items);
            setDosage(false);
          }}
        />
      )}

      {sheet.status === "archived" && (
        <div className="archive-box">
          <h3>旧单留档</h3>
          <p>{sheet.archiveReason ?? "用量变更，本单留档。"}</p>
          {successor && (
            <button className="link" onClick={() => onOpen(successor.id)}>
              查看后续补料单 {successor.id}（序号 #{padSeq(successor.seq)}）→
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- 订单容差卡 ---------------- */

function ToleranceCard({ archive, orderNo }: { archive: Archive; sheet: FeedSheet; orderNo: string }) {
  const o = findOrder(archive, orderNo);
  if (!o) return null;
  return (
    <div className="tolcard">
      <h3>订单容差</h3>
      <div className="tol-grid">
        <span>
          保温 <b>{o.holdTempC}℃</b> ±{o.tempTolC}℃
        </span>
        <span>
          最低余液 <b>{o.minResidualL.toFixed(1)}L</b>
        </span>
        <span>
          ΔL* <b>±{o.tolL}</b>
        </span>
        <span>
          Δa* <b>±{o.tolA}</b>
        </span>
        <span>
          Δb* <b>±{o.tolB}</b>
        </span>
      </div>
    </div>
  );
}

/* ---------------- 登记数据 ---------------- */

function RegisteredData({ sheet }: { sheet: FeedSheet }) {
  return (
    <div className="regdata">
      <h3>登记信息</h3>
      <dl>
        <div>
          <dt>余液量</dt>
          <dd>{sheet.residualL.toFixed(1)} L</dd>
        </div>
        <div>
          <dt>保温温度</dt>
          <dd>{sheet.holdTempC} ℃</dd>
        </div>
        <div>
          <dt>补料人</dt>
          <dd>{sheet.feeder}</dd>
        </div>
        <div>
          <dt>登记时间</dt>
          <dd>{fmtTime(sheet.createdAt)}</dd>
        </div>
      </dl>
      <table className="dye-table">
        <thead>
          <tr>
            <th>染料</th>
            <th className="num">追加量 (mL)</th>
          </tr>
        </thead>
        <tbody>
          {sheet.additions.map((a) => (
            <tr key={a.dye}>
              <td>{a.dye}</td>
              <td className="num">{a.amountMl.toFixed(2)}</td>
            </tr>
          ))}
          <tr className="sum">
            <td>合计</td>
            <td className="num">{totalAdditionMl(sheet.additions).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- 登记 / 修正表单 ---------------- */

interface RegisterFormProps {
  archive: Archive;
  defaultOrderNo?: string;
  initial?: FeedSheet;
  onSubmit: (state: RegFormState) => boolean | void;
  onCancel: () => void;
}

function RegisterForm({ archive, defaultOrderNo, initial, onSubmit, onCancel }: RegisterFormProps) {
  const [orderNo, setOrderNo] = useState(initial?.orderNo ?? defaultOrderNo ?? archive.orders[0]?.orderNo ?? "");
  const [batchNo, setBatchNo] = useState(initial?.batchNo ?? "");
  const [residual, setResidual] = useState(initial ? String(initial.residualL) : "");
  const [holdTemp, setHoldTemp] = useState(
    initial ? String(initial.holdTempC) : String(findOrder(archive, orderNo)?.holdTempC ?? "")
  );
  const [feeder, setFeeder] = useState(initial?.feeder ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [rows, setRows] = useState<AddRow[]>(() => emptyAdditions(initial?.additions));
  const [formError, setFormError] = useState<string | null>(null);

  const order = findOrder(archive, orderNo);
  const batches = order ? batchesOf(archive, order.orderNo) : [];
  const editing = Boolean(initial);

  function switchOrder(nextOrderNo: string) {
    setOrderNo(nextOrderNo);
    setBatchNo("");
    const o = findOrder(archive, nextOrderNo);
    if (o) setHoldTemp(String(o.holdTempC));
  }

  function submit() {
    const batch = findBatch(archive, batchNo);
    if (!order || !batch) {
      setFormError("请选择订单与批次。");
      return;
    }
    if (!Number.isFinite(parseFloat(residual))) {
      setFormError("请登记余液量（L）。");
      return;
    }
    if (!Number.isFinite(parseFloat(holdTemp))) {
      setFormError("请登记保温温度（℃）。");
      return;
    }
    if (!feeder.trim()) {
      setFormError("请登记补料人。");
      return;
    }
    const okRows = rows.filter((r) => r.dye.trim() !== "" || r.amount.trim() !== "");
    if (okRows.length === 0 || okRows.some((r) => !r.dye.trim() || !(parseFloat(r.amount) > 0))) {
      setFormError("追加量需逐行填写染料名称与大于 0 的追加量（mL）。");
      return;
    }
    if (!editing) {
      const blocker = findActiveSheet(archive.sheets, batch.batchNo);
      if (blocker) {
        setFormError(
          `批次 ${batch.batchNo} 已有在途单 ${blocker.id}（${STATUS_LABEL[blocker.status]}），不能重复登记。`
        );
        return;
      }
    }
    setFormError(null);
    onSubmit({ orderNo, batchNo, residual, holdTemp, feeder, note, additions: okRows });
  }

  return (
    <div className="form-box">
      <p className="kicker">{editing ? "待确认 · 修正登记" : "新登记"}</p>
      <h2>{editing ? `修正补料单 ${initial?.id}` : "登记补料单"}</h2>

      <div className="field-grid">
        <label>
          <span>客户订单</span>
          <select value={orderNo} disabled={editing} onChange={(e) => switchOrder(e.target.value)}>
            {archive.orders.map((o) => (
              <option key={o.orderNo} value={o.orderNo}>
                {o.orderNo} · {o.customer} · {o.shade}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>小样批次</span>
          <select value={batchNo} disabled={editing} onChange={(e) => setBatchNo(e.target.value)}>
            <option value="">请选择批次</option>
            {batches.map((b) => {
              const active = findActiveSheet(archive.sheets, b.batchNo);
              return (
                <option key={b.batchNo} value={b.batchNo} disabled={!editing && Boolean(active)}>
                  {b.batchNo}
                  {active && !editing ? `（已有在途单 ${active.id}）` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          <span>余液量 (L) {order && <em>≥ {order.minResidualL.toFixed(1)}</em>}</span>
          <input value={residual} inputMode="decimal" onChange={(e) => setResidual(e.target.value)} placeholder="如 12.5" />
        </label>
        <label>
          <span>保温温度 (℃) {order && <em>规定 {order.holdTempC} ±{order.tempTolC}</em>}</span>
          <input value={holdTemp} inputMode="decimal" onChange={(e) => setHoldTemp(e.target.value)} />
        </label>
        <label>
          <span>补料人</span>
          <input value={feeder} onChange={(e) => setFeeder(e.target.value)} placeholder="登记操作人姓名" />
        </label>
        <label>
          <span>备注（可选）</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：追加前色光现象" />
        </label>
      </div>

      <div className="rows-head">
        <span>追加染料（凭经验一次补加易过头，请逐种登记）</span>
        {!editing && (
          <button type="button" onClick={() => setRows((r) => [...r, { dye: "", amount: "" }])}>
            ＋ 增加一行
          </button>
        )}
      </div>
      <div className="add-rows">
        {rows.map((row, idx) => (
          <div className="add-row" key={idx}>
            <input
              value={row.dye}
              placeholder="染料名称"
              onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, dye: e.target.value } : x)))}
            />
            <input
              value={row.amount}
              inputMode="decimal"
              placeholder="追加量 mL"
              onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
            />
            <button
              type="button"
              className="ghost"
              onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, i) => i !== idx) : r))}
            >
              删除
            </button>
          </div>
        ))}
      </div>

      {formError && <div className="form-error">{formError}</div>}

      <div className="actions">
        <button className="primary" onClick={submit}>
          {editing ? "提交修正并重新校验" : "登记并校验"}
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

/* ---------------- 保温后复测 ---------------- */

function RetestForm({
  sheet,
  order,
  onSubmit,
}: {
  sheet: FeedSheet;
  order: OrderSpec;
  onSubmit: (id: string, input: RetestInput) => void;
}) {
  const [reviewer, setReviewer] = useState("");
  const [dl, setDl] = useState("");
  const [da, setDa] = useState("");
  const [db, setDb] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const nDl = parseFloat(dl);
    const nDa = parseFloat(da);
    const nDb = parseFloat(db);
    if (!reviewer.trim()) {
      setError("请登记复测复核人。");
      return;
    }
    if ([nDl, nDa, nDb].some((v) => !Number.isFinite(v))) {
      setError("请完整填写三轴复测值 ΔL* / Δa* / Δb*。");
      return;
    }
    setError(null);
    onSubmit(sheet.id, { reviewer: reviewer.trim(), dl: nDl, da: nDa, db: nDb });
  }

  return (
    <div className="retest-form">
      <h3>保温后复测（须由补料人之外的另一人执行）</h3>
      <p className="hint">
        补料人：<b>{sheet.feeder}</b>　|　判定限：ΔL* ±{order.tolL}、Δa* ±{order.tolA}、Δb* ±{order.tolB}
      </p>
      <div className="field-grid">
        <label>
          <span>复测复核人</span>
          <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="与补料人不同" />
        </label>
        <label>
          <span>ΔL* 明度（限 ±{order.tolL}）</span>
          <input value={dl} inputMode="decimal" onChange={(e) => setDl(e.target.value)} placeholder="如 0.31" />
        </label>
        <label>
          <span>Δa* 红绿轴（限 ±{order.tolA}）</span>
          <input value={da} inputMode="decimal" onChange={(e) => setDa(e.target.value)} placeholder="如 -0.20" />
        </label>
        <label>
          <span>Δb* 黄蓝轴（限 ±{order.tolB}）</span>
          <input value={db} inputMode="decimal" onChange={(e) => setDb(e.target.value)} placeholder="如 0.45" />
        </label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="actions">
        <button className="primary" onClick={submit}>
          提交复测
        </button>
      </div>
    </div>
  );
}

function axisRows(sheet: FeedSheet, order: NonNullable<ReturnType<typeof findOrder>>) {
  if (!sheet.retest) return [];
  const fails = evaluateAxes(sheet.retest, order);
  const map = new Map(fails.map((f) => [f.axis, f]));
  const rows: { axis: AxisKey; label: string; value: number; tol: number; pass: boolean }[] = (
    [
      ["dl", sheet.retest.dl, order.tolL],
      ["da", sheet.retest.da, order.tolA],
      ["db", sheet.retest.db, order.tolB],
    ] as [AxisKey, number, number][]
  ).map(([axis, value, tol]) => ({
    axis,
    label: AXIS_LABEL[axis],
    value,
    tol,
    pass: !map.has(axis),
  }));
  return rows;
}

function RetestPanel({ sheet, order }: { sheet: FeedSheet; order: NonNullable<ReturnType<typeof findOrder>> }) {
  if (!sheet.retest) return null;
  const rows = axisRows(sheet, order);
  const allPass = rows.every((r) => r.pass);
  return (
    <div className={`retest-panel ${allPass ? "pass" : "fail"} ${sheet.retestVoid ? "void" : ""}`}>
      <div className="retest-head">
        <h3>复测结果{sheet.retestVoid ? "（已失效）" : ""}</h3>
        <span className="hint">
          复核人：<b>{sheet.retest.reviewer}</b> · {fmtTime(sheet.retest.at)}
        </span>
      </div>
      <table className="axis-table">
        <thead>
          <tr>
            <th>色轴</th>
            <th className="num">复测值</th>
            <th className="num">订单容差</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.axis} className={r.pass ? "" : "bad"}>
              <td>{r.label}</td>
              <td className="num">
                {r.value > 0 ? "+" : ""}
                {r.value.toFixed(2)}
              </td>
              <td className="num">±{r.tol}</td>
              <td>{r.pass ? "在容差内" : "超差"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.retestVoid && <p className="void-note">用量已变更，以上复测结果失效，仅供留档追溯。</p>}
      {!allPass && !sheet.retestVoid && (
        <div className="advice">
          <h4>后续建议（不自动追加染料）</h4>
          <ul>
            {sheet.advice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------- 改用量 ---------------- */

function DosageForm({
  sheet,
  onSubmit,
  onCancel,
}: {
  sheet: FeedSheet;
  onSubmit: (items: AdditionItem[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<AddRow[]>(() => emptyAdditions(sheet.additions));
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const cleaned = rows
      .filter((r) => r.dye.trim() !== "" || r.amount.trim() !== "")
      .map((r) => ({ dye: r.dye.trim(), amountMl: parseFloat(r.amount) }));
    if (cleaned.length === 0 || cleaned.some((r) => !(r.amountMl > 0))) {
      setError("请逐行填写染料名称与大于 0 的新追加量（mL）。");
      return;
    }
    setError(null);
    onSubmit(cleaned);
  }

  return (
    <div className="dosage-box">
      <h3>修改追加用量</h3>
      <p className="hint">提交后 {sheet.id} 的原复测立即失效、单据留档，并按订单下一序号另开新补料单。</p>
      <div className="add-rows">
        {rows.map((row, idx) => (
          <div className="add-row" key={idx}>
            <input
              value={row.dye}
              placeholder="染料名称"
              onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, dye: e.target.value } : x)))}
            />
            <input
              value={row.amount}
              inputMode="decimal"
              placeholder="新追加量 mL"
              onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
            />
            <button
              type="button"
              className="ghost"
              onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, i) => i !== idx) : r))}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="ghost block" onClick={() => setRows((r) => [...r, { dye: "", amount: "" }])}>
        ＋ 增加一种染料
      </button>
      {error && <div className="form-error">{error}</div>}
      <div className="actions">
        <button className="primary" onClick={submit}>
          确认改用量并留档
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
