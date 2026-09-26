// =============================================================
// 补料复核台 · 档案（种子数据 + 台账存取）
// 负责：订单容差档案、批次余液、人员名册、补料单台账及全部
// 状态流转（登记 / 放行 / 保温完成 / 复测 / 改用量留档）。
// =============================================================

import {
  ActionResult,
  Batch,
  buildAdvice,
  checkRegistration,
  DosingTicket,
  findActiveTicket,
  isActive,
  judgeReading,
  LabReading,
  nextSeq,
  OrderSpec,
  RegisterInput,
  ticketId,
} from "./rules";

export interface ArchiveState {
  orders: OrderSpec[];
  batches: Batch[];
  staff: string[];
  tickets: DosingTicket[];
}

export interface Archive {
  getState(): ArchiveState;
  subscribe(listener: () => void): () => void;
  /** 登记补料单：每批仅一张在途单；命中校验则留在待确认 */
  register(input: RegisterInput): ActionResult & { ticket?: DosingTicket };
  /** 待确认单放行（确认人不得为补料人） */
  confirmPending(id: string, confirmer: string): ActionResult;
  /** 保温完成，转入待复测 */
  finishHold(id: string): ActionResult;
  /** 另一人复测：三轴全在容差内才通过，超限只给建议 */
  remeasure(id: string, reviewer: string, reading: LabReading): ActionResult;
  /** 改用量：原复测失效，旧单留档，按新用量另开一单 */
  reviseDose(id: string, patch: Omit<RegisterInput, "batchNo">): ActionResult & { ticket?: DosingTicket };
  /** 超限单人工结案归档 */
  closeAdvised(id: string, note: string): ActionResult;
}

// ---------------- 种子档案 ----------------

const seedOrders: OrderSpec[] = [
  {
    orderNo: "SO-2609-118",
    customer: "华隆服饰",
    article: "棉府绸 120g",
    tolerance: { dL: 0.6, dA: 0.5, dB: 0.5 },
    targetTempC: 60,
    tempBandC: 2,
  },
  {
    orderNo: "SO-2609-121",
    customer: "铭远家纺",
    article: "涤纶针织",
    tolerance: { dL: 0.8, dA: 0.6, dB: 0.6 },
    targetTempC: 130,
    tempBandC: 3,
  },
  {
    orderNo: "SO-2609-124",
    customer: "青禾户外",
    article: "锦纶塔丝隆",
    tolerance: { dL: 0.5, dA: 0.4, dB: 0.4 },
    targetTempC: 98,
    tempBandC: 2,
  },
];

const seedBatches: Batch[] = [
  { batchNo: "B-2609-31", orderNo: "SO-2609-118", residualMl: 320 },
  { batchNo: "B-2609-32", orderNo: "SO-2609-118", residualMl: 90 },
  { batchNo: "B-2609-33", orderNo: "SO-2609-121", residualMl: 210 },
  { batchNo: "B-2609-34", orderNo: "SO-2609-124", residualMl: 150 },
];

const seedStaff = ["王建国", "李秀兰", "赵明", "陈静"];

const seedTickets: DosingTicket[] = [
  {
    id: ticketId("SO-2609-118", 1),
    seq: 1,
    orderNo: "SO-2609-118",
    batchNo: "B-2609-31",
    status: "archived",
    residualAtRegMl: 380,
    doseMl: 40,
    holdTempC: 60,
    operator: "王建国",
    reviewer: "李秀兰",
    flags: [],
    reading: { dL: 0.9, dA: 0.2, dB: -0.1 },
    measuredBy: "李秀兰",
    advice: buildAdvice({ dL: 0.9, dA: 0.2, dB: -0.1 }, seedOrders[0].tolerance, 40),
    archiveReason: "改用量作废：复测 ΔL 超限，原复测失效，另开 FD-SO-2609-118-02",
    createdAt: "2026-09-24 09:12",
    events: [
      { at: "2026-09-24 09:12", text: "王建国 登记补料 40mL，保温 60℃" },
      { at: "2026-09-24 10:05", text: "保温完成，待复测" },
      { at: "2026-09-24 10:40", text: "李秀兰 复测 ΔL 0.9 超限，转待处置" },
      { at: "2026-09-24 11:02", text: "改用量，本单留档" },
    ],
  },
  {
    id: ticketId("SO-2609-118", 2),
    seq: 2,
    orderNo: "SO-2609-118",
    batchNo: "B-2609-31",
    status: "passed",
    residualAtRegMl: 340,
    doseMl: 20,
    holdTempC: 60,
    operator: "王建国",
    reviewer: "李秀兰",
    flags: [],
    reading: { dL: 0.3, dA: -0.2, dB: 0.1 },
    measuredBy: "李秀兰",
    revisionOf: ticketId("SO-2609-118", 1),
    createdAt: "2026-09-24 11:05",
    events: [
      { at: "2026-09-24 11:05", text: "由 FD-SO-2609-118-01 改用量开出，补料 20mL" },
      { at: "2026-09-24 11:50", text: "保温完成，待复测" },
      { at: "2026-09-24 12:20", text: "李秀兰 复测三轴均在容差内，通过" },
    ],
  },
  {
    id: ticketId("SO-2609-121", 1),
    seq: 1,
    orderNo: "SO-2609-121",
    batchNo: "B-2609-33",
    status: "remeasure",
    residualAtRegMl: 230,
    doseMl: 20,
    holdTempC: 130,
    operator: "赵明",
    reviewer: "陈静",
    flags: [],
    createdAt: "2026-09-26 08:30",
    events: [
      { at: "2026-09-26 08:30", text: "赵明 登记补料 20mL，保温 130℃" },
      { at: "2026-09-26 09:10", text: "保温完成，待复测" },
    ],
  },
  {
    id: ticketId("SO-2609-124", 1),
    seq: 1,
    orderNo: "SO-2609-124",
    batchNo: "B-2609-34",
    status: "pending",
    residualAtRegMl: 150,
    doseMl: 35,
    holdTempC: 92,
    operator: "李秀兰",
    reviewer: "李秀兰",
    flags: checkRegistration(
      seedOrders[2],
      seedBatches[3],
      { batchNo: "B-2609-34", doseMl: 35, holdTempC: 92, operator: "李秀兰", reviewer: "李秀兰" },
    ),
    createdAt: "2026-09-26 09:20",
    events: [
      { at: "2026-09-26 09:20", text: "李秀兰 登记补料 35mL，保温 92℃，校验未过留待确认" },
    ],
  },
];

// ---------------- 台账 ----------------

function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function createArchive(initial?: ArchiveState): Archive {
  let state: ArchiveState = initial ?? {
    orders: seedOrders,
    batches: seedBatches.map((b) => ({ ...b })),
    staff: seedStaff,
    tickets: seedTickets,
  };
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((l) => l());
  const fail = (error: string): ActionResult => ({ ok: false, error });
  const ok: ActionResult = { ok: true };

  const findTicket = (id: string) => state.tickets.find((t) => t.id === id);
  const specOf = (orderNo: string) => {
    const spec = state.orders.find((o) => o.orderNo === orderNo);
    if (!spec) throw new Error(`订单档案缺失：${orderNo}`);
    return spec;
  };
  const batchOf = (batchNo: string) => state.batches.find((b) => b.batchNo === batchNo);

  function replaceTicket(next: DosingTicket) {
    state = {
      ...state,
      tickets: state.tickets.map((t) => (t.id === next.id ? next : t)),
    };
  }

  function pushEvent(ticket: DosingTicket, text: string): DosingTicket {
    return { ...ticket, events: [...ticket.events, { at: now(), text }] };
  }

  /** 开具新单（登记或改用量共用），命中校验则留在待确认 */
  function openTicket(
    input: RegisterInput,
    revisionOf?: DosingTicket,
  ): ActionResult & { ticket?: DosingTicket } {
    const batch = batchOf(input.batchNo);
    if (!batch) return fail(`批次不存在：${input.batchNo}`);
    if (input.doseMl <= 0) return fail("追加量须大于 0");
    if (!input.operator.trim()) return fail("请填写补料人");
    if (!input.reviewer.trim()) return fail("请指定复核人");

    // 每批只允许一张在途单（改用量场景下旧单已先归档）
    const active = findActiveTicket(state.tickets, input.batchNo);
    if (active) {
      return fail(`批次 ${input.batchNo} 已有在途单 ${active.id}，须先处置完毕`);
    }

    const spec = specOf(batch.orderNo);
    const flags = checkRegistration(spec, batch, input);
    const seq = nextSeq(state.tickets, batch.orderNo);
    const ticket: DosingTicket = {
      id: ticketId(batch.orderNo, seq),
      seq,
      orderNo: batch.orderNo,
      batchNo: batch.batchNo,
      status: flags.length > 0 ? "pending" : "holding",
      residualAtRegMl: batch.residualMl,
      doseMl: input.doseMl,
      holdTempC: input.holdTempC,
      operator: input.operator.trim(),
      reviewer: input.reviewer.trim(),
      flags,
      revisionOf: revisionOf?.id,
      createdAt: now(),
      events: [
        {
          at: now(),
          text: revisionOf
            ? `由 ${revisionOf.id} 改用量开出，${input.operator} 登记补料 ${input.doseMl}mL`
            : `${input.operator} 登记补料 ${input.doseMl}mL，保温 ${input.holdTempC}℃` +
              (flags.length > 0 ? "，校验未过留待确认" : ""),
        },
      ],
    };

    // 追加量自余液中扣减（余液不足的单据留在待确认，放行时才真正扣减）
    const deduct = flags.some((f) => f.code === "RESIDUAL_SHORT") ? 0 : input.doseMl;
    state = {
      ...state,
      batches: state.batches.map((b) =>
        b.batchNo === batch.batchNo ? { ...b, residualMl: b.residualMl - deduct } : b,
      ),
      tickets: [...state.tickets, ticket],
    };
    emit();
    return { ok: true, ticket };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    register(input) {
      return openTicket(input);
    },

    confirmPending(id, confirmer) {
      const ticket = findTicket(id);
      if (!ticket) return fail("单据不存在");
      if (ticket.status !== "pending") return fail("仅待确认单可放行");
      if (!confirmer.trim()) return fail("请选择确认人");
      if (confirmer.trim() === ticket.operator) return fail("确认人不得与补料人为同一人");

      const batch = batchOf(ticket.batchNo);
      const short = ticket.flags.some((f) => f.code === "RESIDUAL_SHORT");
      if (short && batch && batch.residualMl < ticket.doseMl) {
        return fail(`余液仍不足（${batch.residualMl}mL），请先补充母液或改用量`);
      }

      let next: DosingTicket = {
        ...ticket,
        status: "holding",
        // 补料人兼复核人的，确认人接任复核人
        reviewer:
          ticket.reviewer === ticket.operator ? confirmer.trim() : ticket.reviewer,
      };
      next = pushEvent(next, `${confirmer} 确认放行，转保温`);
      replaceTicket(next);

      // 登记时因余液不足未扣减的，放行时补扣
      if (short && batch) {
        state = {
          ...state,
          batches: state.batches.map((b) =>
            b.batchNo === batch.batchNo ? { ...b, residualMl: b.residualMl - ticket.doseMl } : b,
          ),
        };
      }
      emit();
      return ok;
    },

    finishHold(id) {
      const ticket = findTicket(id);
      if (!ticket) return fail("单据不存在");
      if (ticket.status !== "holding") return fail("仅保温中的单据可转复测");
      replaceTicket(pushEvent({ ...ticket, status: "remeasure" }, "保温完成，待复测"));
      emit();
      return ok;
    },

    remeasure(id, reviewer, reading) {
      const ticket = findTicket(id);
      if (!ticket) return fail("单据不存在");
      if (ticket.status !== "remeasure") return fail("仅待复测单可录入复测");
      if (!reviewer.trim()) return fail("请选择复测人");
      if (reviewer.trim() === ticket.operator) {
        return fail("复测人不得与补料人为同一人");
      }

      const spec = specOf(ticket.orderNo);
      const { pass } = judgeReading(reading, spec.tolerance);
      let next: DosingTicket = {
        ...ticket,
        reading,
        measuredBy: reviewer.trim(),
        status: pass ? "passed" : "advised",
        advice: pass ? undefined : buildAdvice(reading, spec.tolerance, ticket.doseMl),
      };
      next = pushEvent(
        next,
        pass
          ? `${reviewer} 复测三轴均在容差内，通过`
          : `${reviewer} 复测超限，转待处置（仅给建议，不自动追加）`,
      );
      replaceTicket(next);
      emit();
      return ok;
    },

    reviseDose(id, patch) {
      const ticket = findTicket(id);
      if (!ticket) return fail("单据不存在");
      if (!isActive(ticket)) return fail("仅在途单可改用量");

      // 旧单留档：原复测随之失效
      let archived: DosingTicket = {
        ...ticket,
        status: "archived",
        archiveReason:
          "改用量作废" +
          (ticket.reading ? "：原复测结果失效" : "") +
          `，另开新单（${patch.doseMl}mL）`,
      };
      archived = pushEvent(archived, "改用量，本单留档");
      replaceTicket(archived);

      const opened = openTicket(
        { batchNo: ticket.batchNo, ...patch },
        ticket,
      );
      if (!opened.ok) {
        // 开新单失败不应发生（旧单已归档），兜底提示
        return fail(opened.error ?? "改用量失败");
      }
      return { ok: true, ticket: opened.ticket };
    },

    closeAdvised(id, note) {
      const ticket = findTicket(id);
      if (!ticket) return fail("单据不存在");
      if (ticket.status !== "advised") return fail("仅超限待处置单可结案");
      let next: DosingTicket = {
        ...ticket,
        status: "archived",
        archiveReason: note.trim() || "超限人工结案（返工/降级另行处理）",
      };
      next = pushEvent(next, `结案归档：${next.archiveReason}`);
      replaceTicket(next);
      emit();
      return ok;
    },
  };
}
