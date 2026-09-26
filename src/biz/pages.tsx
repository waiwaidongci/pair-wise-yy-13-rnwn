// =============================================================
// 补料复核台 · 页面（全部界面组件）
// 布局：规则条 → 指标 → 登记台 / 在途工作台 → 单据台账
// （按订单筛选、按序号排序）→ 规则说明。
// =============================================================

import { useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import { Archive, ArchiveState } from "./archive";
import {
  checkRegistration,
  DosingTicket,
  findActiveTicket,
  isActive,
  judgeReading,
  OrderSpec,
  STATUS_LABEL,
  TicketStatus,
} from "./rules";

const signed = (n: number) => (n > 0 ? "+" : "") + n.toFixed(2);

export function ReviewStationPage({ store }: { store: Archive }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);

  const active = state.tickets.filter(isActive);
  const measured = state.tickets.filter((t) => t.reading);
  const passed = state.tickets.filter((t) => t.status === "passed");
  const passRate = measured.length
    ? Math.round((passed.length / measured.length) * 100)
    : 0;

  return (
    <main className="app">
      <section className="hero">
        <p>染整小样复染 · 补料复核台</p>
        <h1>补料复核台</h1>
        <span>
          每批只允许一张在途单；登记余液、追加量、保温温度与补料人，余液不足、
          温度偏离或补料人兼复核人时留在待确认。保温后由另一人复测，三轴
          （ΔL / Δa / Δb）全部落在订单容差内才算通过；超限只给后续建议，
          不自动追加。改用量会使原复测失效，旧单留档。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>在途单</small>
          <strong>{active.length}</strong>
        </article>
        <article>
          <small>待确认</small>
          <strong>{active.filter((t) => t.status === "pending").length}</strong>
        </article>
        <article>
          <small>超限待处置</small>
          <strong>{active.filter((t) => t.status === "advised").length}</strong>
        </article>
        <article>
          <small>复测通过率</small>
          <strong>{passRate}%</strong>
        </article>
      </section>

      <section className="workspace">
        <RegisterPanel state={state} store={store} />
        <ActiveBoard state={state} store={store} />
      </section>

      <TicketLedger state={state} />
      <RulesPanel />
    </main>
  );
}

// ---------------- 登记台 ----------------

function RegisterPanel({ state, store }: { state: ArchiveState; store: Archive }) {
  const [batchNo, setBatchNo] = useState(state.batches[0]?.batchNo ?? "");
  const batch = state.batches.find((b) => b.batchNo === batchNo);
  const spec = batch ? state.orders.find((o) => o.orderNo === batch.orderNo) : undefined;

  const [doseMl, setDoseMl] = useState("20");
  const [holdTempC, setHoldTempC] = useState(String(spec?.targetTempC ?? 60));
  const [operator, setOperator] = useState(state.staff[0] ?? "");
  const [reviewer, setReviewer] = useState(state.staff[1] ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const blocking = findActiveTicket(state.tickets, batchNo);
  const dose = Number(doseMl);
  const temp = Number(holdTempC);

  const flags = useMemo(() => {
    if (!spec || !batch || !Number.isFinite(dose) || !Number.isFinite(temp)) return [];
    return checkRegistration(spec, batch, {
      batchNo,
      doseMl: dose,
      holdTempC: temp,
      operator,
      reviewer,
    });
  }, [spec, batch, batchNo, dose, temp, operator, reviewer]);

  const pickBatch = (no: string) => {
    setBatchNo(no);
    const b = state.batches.find((x) => x.batchNo === no);
    const s = b && state.orders.find((o) => o.orderNo === b.orderNo);
    if (s) setHoldTempC(String(s.targetTempC));
    setMessage(null);
  };

  const submit = () => {
    if (!Number.isFinite(dose) || dose <= 0) {
      setMessage({ ok: false, text: "追加量须为大于 0 的数字" });
      return;
    }
    if (!Number.isFinite(temp)) {
      setMessage({ ok: false, text: "保温温度须为数字" });
      return;
    }
    const r = store.register({ batchNo, doseMl: dose, holdTempC: temp, operator, reviewer });
    setMessage(
      r.ok
        ? {
            ok: true,
            text:
              r.ticket!.status === "pending"
                ? `已登记 ${r.ticket!.id}，校验未过，留在待确认`
                : `已登记 ${r.ticket!.id}，进入保温`,
          }
        : { ok: false, text: r.error ?? "登记失败" },
    );
  };

  return (
    <aside className="panel">
      <h2>补料登记</h2>
      <div className="form-stack">
        <label>
          <span>小样批次（每批限一张在途单）</span>
          <select value={batchNo} onChange={(e) => pickBatch(e.target.value)}>
            {state.batches.map((b) => (
              <option key={b.batchNo} value={b.batchNo}>
                {b.batchNo} · {b.orderNo} · 余液 {b.residualMl}mL
              </option>
            ))}
          </select>
        </label>

        {spec && batch && (
          <p className="hint">
            {spec.customer} · {spec.article}；工艺保温 {spec.targetTempC}±
            {spec.tempBandC}℃；容差 ΔL±{spec.tolerance.dL} / Δa±
            {spec.tolerance.dA} / Δb±{spec.tolerance.dB}
          </p>
        )}

        <div className="field-grid">
          <label>
            <span>追加量（mL）</span>
            <input value={doseMl} onChange={(e) => setDoseMl(e.target.value)} inputMode="decimal" />
          </label>
          <label>
            <span>保温温度（℃）</span>
            <input value={holdTempC} onChange={(e) => setHoldTempC(e.target.value)} inputMode="decimal" />
          </label>
          <label>
            <span>补料人</span>
            <select value={operator} onChange={(e) => setOperator(e.target.value)}>
              {state.staff.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            <span>指定复核人</span>
            <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
              {state.staff.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>

        {blocking && (
          <p className="notice warn">
            该批已有在途单 {blocking.id}（{STATUS_LABEL[blocking.status]}），须先处置完毕。
          </p>
        )}
        {flags.map((f) => (
          <p key={f.code} className="notice warn">
            {f.message} → 登记后将留在待确认
          </p>
        ))}
        {message && (
          <p className={`notice ${message.ok ? "ok" : "bad"}`}>{message.text}</p>
        )}

        <button className="primary" disabled={!!blocking} onClick={submit}>
          登记补料单
        </button>
      </div>
    </aside>
  );
}

// ---------------- 在途工作台 ----------------

function ActiveBoard({ state, store }: { state: ArchiveState; store: Archive }) {
  const active = state.tickets.filter(isActive);
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>在途工作台</p>
          <h2>待处理补料单（{active.length}）</h2>
        </div>
      </div>
      {active.length === 0 && <p className="hint">当前没有在途单，可在左侧登记。</p>}
      <div className="records">
        {active.map((t) => (
          <TicketCard
            key={t.id}
            ticket={t}
            spec={state.orders.find((o) => o.orderNo === t.orderNo)!}
            state={state}
            store={store}
          />
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>;
}

function TicketCard({
  ticket,
  spec,
  state,
  store,
}: {
  ticket: DosingTicket;
  spec: OrderSpec;
  state: ArchiveState;
  store: Archive;
}) {
  const [mode, setMode] = useState<"none" | "revise">("none");
  const [msg, setMsg] = useState<string | null>(null);

  const tell = (r: { ok: boolean; error?: string }) =>
    setMsg(r.ok ? null : r.error ?? "操作失败");

  return (
    <article className="ticket">
      <header>
        <div>
          <h3>
            {ticket.id} <StatusBadge status={ticket.status} />
          </h3>
          <p>
            批次 {ticket.batchNo} · {ticket.orderNo} · 登记余液 {ticket.residualAtRegMl}mL ·
            追加 {ticket.doseMl}mL · 保温 {ticket.holdTempC}℃（工艺 {spec.targetTempC}±
            {spec.tempBandC}℃） · 补料人 {ticket.operator} · 复核人 {ticket.reviewer}
          </p>
          {ticket.revisionOf && <p className="hint">由 {ticket.revisionOf} 改用量开出</p>}
        </div>
      </header>

      {ticket.flags.length > 0 && (
        <ul className="flags">
          {ticket.flags.map((f) => (
            <li key={f.code}>{f.message}</li>
          ))}
        </ul>
      )}

      {ticket.status === "pending" && (
        <ConfirmRow ticket={ticket} state={state} store={store} onResult={tell} />
      )}

      {ticket.status === "holding" && (
        <div className="actions">
          <button className="primary" onClick={() => tell(store.finishHold(ticket.id))}>
            保温完成，转复测
          </button>
        </div>
      )}

      {ticket.status === "remeasure" && (
        <RemeasureForm ticket={ticket} state={state} store={store} onResult={tell} />
      )}

      {ticket.status === "advised" && ticket.advice && (
        <div className="advice">
          <b>后续建议（不自动追加）：</b>
          <ul>
            {ticket.advice.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <CloseRow store={store} ticket={ticket} onResult={tell} />
        </div>
      )}

      {msg && <p className="notice bad">{msg}</p>}

      <div className="actions">
        <button onClick={() => setMode(mode === "revise" ? "none" : "revise")}>
          {mode === "revise" ? "收起改用量" : "改用量（旧单留档）"}
        </button>
      </div>
      {mode === "revise" && (
        <ReviseForm ticket={ticket} state={state} store={store} onResult={tell} />
      )}

      <details className="events">
        <summary>流转记录（{ticket.events.length}）</summary>
        <ul>
          {ticket.events.map((e, i) => (
            <li key={i}>
              {e.at} — {e.text}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function ConfirmRow({
  ticket,
  state,
  store,
  onResult,
}: {
  ticket: DosingTicket;
  state: ArchiveState;
  store: Archive;
  onResult: (r: { ok: boolean; error?: string }) => void;
}) {
  const candidates = state.staff.filter((s) => s !== ticket.operator);
  const [confirmer, setConfirmer] = useState(candidates[0] ?? "");
  return (
    <div className="actions">
      <select value={confirmer} onChange={(e) => setConfirmer(e.target.value)}>
        {candidates.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <button
        className="primary"
        onClick={() => onResult(store.confirmPending(ticket.id, confirmer))}
      >
        确认放行（确认人不得为补料人）
      </button>
    </div>
  );
}

function RemeasureForm({
  ticket,
  state,
  store,
  onResult,
}: {
  ticket: DosingTicket;
  state: ArchiveState;
  store: Archive;
  onResult: (r: { ok: boolean; error?: string }) => void;
}) {
  const others = state.staff.filter((s) => s !== ticket.operator);
  const [reviewer, setReviewer] = useState(
    others.includes(ticket.reviewer) ? ticket.reviewer : others[0] ?? "",
  );
  const [dL, setDL] = useState("0");
  const [dA, setDA] = useState("0");
  const [dB, setDB] = useState("0");

  const submit = () => {
    const reading = { dL: Number(dL), dA: Number(dA), dB: Number(dB) };
    if (Object.values(reading).some((v) => !Number.isFinite(v))) {
      onResult({ ok: false, error: "三轴读数须为数字" });
      return;
    }
    onResult(store.remeasure(ticket.id, reviewer, reading));
  };

  return (
    <div className="remeasure">
      <label>
        <span>复测人（须非补料人 {ticket.operator}）</span>
        <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
          {others.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {(["dL", "dA", "dB"] as const).map((axis) => (
        <label key={axis}>
          <span>{axis === "dL" ? "ΔL 明度" : axis === "dA" ? "Δa 红绿" : "Δb 黄蓝"}</span>
          <input
            value={axis === "dL" ? dL : axis === "dA" ? dA : dB}
            onChange={(e) =>
              axis === "dL" ? setDL(e.target.value) : axis === "dA" ? setDA(e.target.value) : setDB(e.target.value)
            }
            inputMode="decimal"
          />
        </label>
      ))}
      <button className="primary" onClick={submit}>
        提交复测（按订单容差判定）
      </button>
    </div>
  );
}

function ReviseForm({
  ticket,
  state,
  store,
  onResult,
}: {
  ticket: DosingTicket;
  state: ArchiveState;
  store: Archive;
  onResult: (r: { ok: boolean; error?: string }) => void;
}) {
  const [doseMl, setDoseMl] = useState(String(ticket.doseMl));
  const [holdTempC, setHoldTempC] = useState(String(ticket.holdTempC));
  const [operator, setOperator] = useState(ticket.operator);
  const [reviewer, setReviewer] = useState(ticket.reviewer);

  const submit = () => {
    const dose = Number(doseMl);
    const temp = Number(holdTempC);
    if (!Number.isFinite(dose) || dose <= 0) {
      onResult({ ok: false, error: "新追加量须为大于 0 的数字" });
      return;
    }
    if (!Number.isFinite(temp)) {
      onResult({ ok: false, error: "保温温度须为数字" });
      return;
    }
    const r = store.reviseDose(ticket.id, { doseMl: dose, holdTempC: temp, operator, reviewer });
    onResult(r);
  };

  return (
    <div className="remeasure revise">
      <p className="hint">
        改用量后本单（含原复测结果）立即失效并留档，按新用量另开一单。
      </p>
      <label>
        <span>新追加量（mL）</span>
        <input value={doseMl} onChange={(e) => setDoseMl(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        <span>保温温度（℃）</span>
        <input value={holdTempC} onChange={(e) => setHoldTempC(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        <span>补料人</span>
        <select value={operator} onChange={(e) => setOperator(e.target.value)}>
          {state.staff.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        <span>指定复核人</span>
        <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
          {state.staff.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <button className="primary" onClick={submit}>
        确认改用量并开新单
      </button>
    </div>
  );
}

function CloseRow({
  ticket,
  store,
  onResult,
}: {
  ticket: DosingTicket;
  store: Archive;
  onResult: (r: { ok: boolean; error?: string }) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="actions">
      <input
        placeholder="结案说明（如：返工剥色 / 降级处理）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button onClick={() => onResult(store.closeAdvised(ticket.id, note))}>
        结案归档
      </button>
    </div>
  );
}

// ---------------- 单据台账（按订单和序号查看） ----------------

function TicketLedger({ state }: { state: ArchiveState }) {
  const [orderNo, setOrderNo] = useState("ALL");
  const [status, setStatus] = useState<"ALL" | TicketStatus>("ALL");
  const [seqDesc, setSeqDesc] = useState(false);

  const rows = state.tickets
    .filter((t) => orderNo === "ALL" || t.orderNo === orderNo)
    .filter((t) => status === "ALL" || t.status === status)
    .sort((a, b) =>
      a.orderNo === b.orderNo
        ? seqDesc
          ? b.seq - a.seq
          : a.seq - b.seq
        : a.orderNo.localeCompare(b.orderNo),
    );

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>单据台账</p>
          <h2>按订单和序号查看（{rows.length}）</h2>
        </div>
        <div className="actions">
          <select value={orderNo} onChange={(e) => setOrderNo(e.target.value)}>
            <option value="ALL">全部订单</option>
            {state.orders.map((o) => (
              <option key={o.orderNo} value={o.orderNo}>
                {o.orderNo} · {o.customer}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as "ALL" | TicketStatus)}>
            <option value="ALL">全部状态</option>
            {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button onClick={() => setSeqDesc(!seqDesc)}>
            序号{seqDesc ? "降序" : "升序"}
          </button>
        </div>
      </div>

      <div className="ledger">
        <table>
          <thead>
            <tr>
              <th>序号</th>
              <th>单号</th>
              <th>批次</th>
              <th>状态</th>
              <th>追加/温度</th>
              <th>补料人 → 复核人</th>
              <th>复测三轴（对照订单容差）</th>
              <th>留档原因</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const spec = state.orders.find((o) => o.orderNo === t.orderNo)!;
              return (
                <tr key={t.id} className={t.status === "archived" ? "archived" : ""}>
                  <td>#{t.seq}</td>
                  <td>
                    {t.id}
                    {t.revisionOf && <div className="hint">改自 {t.revisionOf}</div>}
                  </td>
                  <td>{t.batchNo}</td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td>
                    {t.doseMl}mL / {t.holdTempC}℃
                  </td>
                  <td>
                    {t.operator} → {t.measuredBy ?? t.reviewer}
                  </td>
                  <td>
                    {t.reading ? (
                      <span className="axes">
                        {judgeReading(t.reading, spec.tolerance).axes.map((a) => (
                          <span key={a.axis} className={`axis ${a.ok ? "ok" : "bad"}`}>
                            {a.axis} {signed(a.value)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="hint">未复测</span>
                    )}
                  </td>
                  <td className="reason">{t.archiveReason ?? "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="hint">
                  当前筛选下没有单据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------- 规则说明 ----------------

function RulesPanel() {
  const rules = [
    "每批只允许一张在途单：待确认、保温中、待复测、超限待处置均占用在途名额。",
    "容差按订单设定：三轴 ΔL（明度）、Δa（红绿）、Δb（黄蓝）各有 ± 限值。",
    "登记必填余液、追加量、保温温度、补料人，并指定复核人。",
    "余液不足、保温温度偏离工艺范围、补料人兼复核人，任一命中即留在待确认，须他人确认放行。",
    "保温完成后由另一人复测，三轴全部落在订单容差内才算通过。",
    "超限只给出后续建议（补加方向与参考量），系统不自动追加染料。",
    "改用量会使原复测失效：旧单留档可查，按新用量另开新单，序号顺延。",
  ];
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>业务规则</p>
          <h2>复核台规则</h2>
        </div>
      </div>
      <ol className="rules">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ol>
    </section>
  );
}
