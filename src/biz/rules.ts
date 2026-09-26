// =============================================================
// 补料复核台 · 业务规则（纯函数，不依赖界面）
// 规则说明：
// 1. 每批只允许一张在途单（待确认/保温中/待复测/待处置 均属在途）
// 2. 三轴容差（ΔL 明度、Δa 红绿、Δb 黄蓝）按订单设定
// 3. 登记余液、追加量、保温温度、补料人（并指定复核人）
// 4. 余液不足 / 温度偏离 / 补料人兼复核人 → 留在待确认
// 5. 保温后由另一人复测，三轴全部落在订单容差内才算通过
// 6. 超限只给后续建议，不自动追加染料
// 7. 改用量使原复测失效，旧单留档，另开新单（序号顺延）
// =============================================================

/** 三轴读数（与标准样的偏差） */
export interface LabReading {
  dL: number;
  dA: number;
  dB: number;
}

/** 订单三轴容差（±） */
export interface Tolerance {
  dL: number;
  dA: number;
  dB: number;
}

/** 客户订单工艺要求 */
export interface OrderSpec {
  orderNo: string;
  customer: string;
  article: string;
  tolerance: Tolerance;
  /** 工艺要求保温温度 ℃ */
  targetTempC: number;
  /** 允许保温温度偏差 ±℃ */
  tempBandC: number;
}

/** 小样批次 */
export interface Batch {
  batchNo: string;
  orderNo: string;
  /** 当前余液 mL */
  residualMl: number;
}

/**
 * 单据状态：
 * pending   待确认（登记校验未通过，等待放行）
 * holding   在途·保温中（登记已放行）
 * remeasure 在途·待复测（保温结束，等待另一人复测）
 * passed    通过（三轴全部在容差内）
 * advised   在途·待处置（超限，仅给出后续建议）
 * archived  已归档（改用量作废的旧单 / 人工结案）
 */
export type TicketStatus =
  | "pending"
  | "holding"
  | "remeasure"
  | "passed"
  | "advised"
  | "archived";

export const ACTIVE_STATUSES: TicketStatus[] = [
  "pending",
  "holding",
  "remeasure",
  "advised",
];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  pending: "待确认",
  holding: "在途·保温中",
  remeasure: "在途·待复测",
  passed: "通过",
  advised: "超限·待处置",
  archived: "已留档",
};

export type FlagCode = "RESIDUAL_SHORT" | "TEMP_DEVIATION" | "SAME_REVIEWER";

export interface Flag {
  code: FlagCode;
  message: string;
}

export interface TicketEvent {
  at: string;
  text: string;
}

/** 补料单 */
export interface DosingTicket {
  /** 单号：FD-订单号-序号 */
  id: string;
  /** 同一订单内的序号，从 1 起 */
  seq: number;
  orderNo: string;
  batchNo: string;
  status: TicketStatus;
  /** 登记时余液 mL */
  residualAtRegMl: number;
  /** 追加量 mL */
  doseMl: number;
  /** 登记保温温度 ℃ */
  holdTempC: number;
  /** 补料人 */
  operator: string;
  /** 指定复核人 */
  reviewer: string;
  /** 登记时命中的校验问题 */
  flags: Flag[];
  /** 复测三轴读数 */
  reading?: LabReading;
  /** 复测人（必须与补料人不同） */
  measuredBy?: string;
  /** 超限后的后续建议（仅建议，不自动追加） */
  advice?: string[];
  /** 留档原因 */
  archiveReason?: string;
  /** 本单由哪张旧单改用量而来 */
  revisionOf?: string;
  createdAt: string;
  events: TicketEvent[];
}

export interface RegisterInput {
  batchNo: string;
  doseMl: number;
  holdTempC: number;
  operator: string;
  reviewer: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// ---------------- 基础校验 ----------------

/** 登记校验：余液、温度、补料人与复核人分离 */
export function checkRegistration(
  spec: OrderSpec,
  batch: Batch,
  input: RegisterInput,
): Flag[] {
  const flags: Flag[] = [];

  if (batch.residualMl < input.doseMl) {
    flags.push({
      code: "RESIDUAL_SHORT",
      message: `余液不足：现有 ${batch.residualMl}mL < 追加 ${input.doseMl}mL`,
    });
  }

  const tempDelta = Math.abs(input.holdTempC - spec.targetTempC);
  if (tempDelta > spec.tempBandC) {
    flags.push({
      code: "TEMP_DEVIATION",
      message:
        `温度偏离：登记 ${input.holdTempC}℃，工艺要求 ` +
        `${spec.targetTempC}±${spec.tempBandC}℃（偏差 ${tempDelta.toFixed(1)}℃）`,
    });
  }

  if (input.operator.trim() === input.reviewer.trim()) {
    flags.push({
      code: "SAME_REVIEWER",
      message: `补料人与复核人均为「${input.operator}」，须由另一人复核`,
    });
  }

  return flags;
}

export function isActive(ticket: DosingTicket): boolean {
  return ACTIVE_STATUSES.includes(ticket.status);
}

/** 该批次当前是否已有在途单 */
export function findActiveTicket(
  tickets: DosingTicket[],
  batchNo: string,
): DosingTicket | undefined {
  return tickets.find(
    (t) => t.batchNo === batchNo && isActive(t),
  );
}

export function nextSeq(
  tickets: DosingTicket[],
  orderNo: string,
): number {
  return tickets.filter((t) => t.orderNo === orderNo).length + 1;
}

export function ticketId(orderNo: string, seq: number): string {
  return `FD-${orderNo}-${String(seq).padStart(2, "0")}`;
}

// ---------------- 三轴复测判定 ----------------

export interface AxisVerdict {
  axis: keyof LabReading;
  label: string;
  value: number;
  limit: number;
  ok: boolean;
}

export function judgeReading(
  reading: LabReading,
  tol: Tolerance,
): { pass: boolean; axes: AxisVerdict[] } {
  const axes: AxisVerdict[] = [
    { axis: "dL", label: "ΔL 明度", value: reading.dL, limit: tol.dL, ok: Math.abs(reading.dL) <= tol.dL },
    { axis: "dA", label: "Δa 红绿", value: reading.dA, limit: tol.dA, ok: Math.abs(reading.dA) <= tol.dA },
    { axis: "dB", label: "Δb 黄蓝", value: reading.dB, limit: tol.dB, ok: Math.abs(reading.dB) <= tol.dB },
  ];
  return { pass: axes.every((a) => a.ok), axes };
}

/**
 * 超限后续建议：只给文字建议，系统绝不自动追加。
 * 建议追加量按「超出比例」估算，仅供人工参考，须另开补料单登记。
 */
export function buildAdvice(
  reading: LabReading,
  tol: Tolerance,
  doseMl: number,
): string[] {
  const advice: string[] = [];
  const { axes } = judgeReading(reading, tol);

  for (const ax of axes) {
    if (ax.ok) continue;
    const overRatio = Math.abs(ax.value) / ax.limit - 1;
    const suggestMl = Math.max(1, Math.round(doseMl * overRatio));

    if (ax.axis === "dL") {
      advice.push(
        ax.value > 0
          ? `偏浅（ΔL=${ax.value}，容差±${ax.limit}）：建议按缺口约补加主色染料 ${suggestMl}mL，并复核对色后重新保温复测。`
          : `偏深（ΔL=${ax.value}，容差±${ax.limit}）：不宜继续追加，建议返工剥色或按降级处理评估。`,
      );
    } else if (ax.axis === "dA") {
      advice.push(
        ax.value > 0
          ? `红光偏重（Δa=${ax.value}，容差±${ax.limit}）：建议复核红色组份计量，下次补料酌减红色约 ${suggestMl}mL 当量。`
          : `绿光偏重（Δa=${ax.value}，容差±${ax.limit}）：建议酌补红色组份（约 ${suggestMl}mL 当量）复配重打。`,
      );
    } else {
      advice.push(
        ax.value > 0
          ? `黄光偏重（Δb=${ax.value}，容差±${ax.limit}）：建议酌减黄色/酌补蓝色组份（约 ${suggestMl}mL 当量）复配。`
          : `蓝光偏重（Δb=${ax.value}，容差±${ax.limit}）：建议酌补黄色组份（约 ${suggestMl}mL 当量）复配重打。`,
      );
    }
  }

  advice.push("以上仅为后续建议，系统不自动追加；如采纳请走「改用量」，原单留档。");
  return advice;
}
