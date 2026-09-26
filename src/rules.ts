// 染整小样补料复核台 —— 业务规则（纯函数，不含页面与存储逻辑）
//
// 状态流转：
//   登记 -> 余液/温度/追加量校验通过 -> awaiting 待复测
//         -> 任一不通过            -> pending 待确认（修正后重新校验）
//   保温后由另一人复测：
//         复核人 === 补料人        -> 退回 pending 待确认
//         三轴全部在订单容差内     -> passed 复测通过（关单）
//         任一轴超差              -> over 复测超限（仅给后续建议，不自动追加）
//   改用量（已复测单）：原单 archived 留档且原复测失效，另开下一序号新单。

export interface OrderSpec {
  orderNo: string;
  customer: string;
  fabric: string;
  shade: string;
  holdTempC: number; // 订单规定保温温度 ℃
  tempTolC: number; // 保温温度允差 ±℃
  minResidualL: number; // 最低余液量 L（低于即“余液不足”）
  tolL: number; // ΔL* 容差（绝对值）
  tolA: number; // Δa* 容差
  tolB: number; // Δb* 容差
}

export interface Batch {
  batchNo: string;
  orderNo: string;
}

export interface AdditionItem {
  dye: string; // 染料
  amountMl: number; // 追加量 mL
}

export type AxisKey = "dl" | "da" | "db";

export const AXIS_LABEL: Record<AxisKey, string> = {
  dl: "ΔL* 明度",
  da: "Δa* 红绿轴",
  db: "Δb* 黄蓝轴",
};

export interface RetestInput {
  reviewer: string;
  dl: number;
  da: number;
  db: number;
}

export interface RetestResult extends RetestInput {
  at: string; // 复测时间 ISO
}

export type SheetStatus =
  | "pending" // 待确认
  | "awaiting" // 待复测（在途）
  | "passed" // 复测通过（关单）
  | "over" // 复测超限（关单，仅给建议）
  | "archived"; // 旧单留档

export const STATUS_LABEL: Record<SheetStatus, string> = {
  pending: "待确认",
  awaiting: "待复测",
  passed: "复测通过",
  over: "复测超限",
  archived: "已留档",
};

/** 在途单：仅这两种状态占用批次名额 */
export const ACTIVE_STATUSES: SheetStatus[] = ["pending", "awaiting"];

export interface FeedSheetDraft {
  orderNo: string;
  batchNo: string;
  residualL: number; // 余液 L
  holdTempC: number; // 保温温度 ℃
  additions: AdditionItem[]; // 追加量
  feeder: string; // 补料人
  note?: string;
}

export interface FeedSheet extends FeedSheetDraft {
  id: string;
  seq: number; // 订单内序号
  createdAt: string;
  status: SheetStatus;
  issues: string[]; // 待确认原因
  retest: RetestResult | null;
  advice: string[]; // 超限后续建议
  retestVoid: boolean; // 原复测是否因用量变更失效
  archiveReason: string | null;
  supersededBy: string | null; // 被哪张新单替代
}

export function padSeq(seq: number): string {
  return String(seq).padStart(2, "0");
}

export function totalAdditionMl(items: AdditionItem[]): number {
  return items.reduce((sum, item) => sum + (item.amountMl || 0), 0);
}

function validAdditions(items: AdditionItem[]): AdditionItem[] {
  return items.filter(
    (item) => item.dye.trim() !== "" && Number.isFinite(item.amountMl) && item.amountMl > 0
  );
}

function num(v: number): string {
  return Number.isFinite(v) ? String(v) : "--";
}

/** 登记环节校验：余液、保温温度、追加量、补料人。返回待确认原因（空数组即通过） */
export function registrationIssues(
  d: Pick<FeedSheetDraft, "residualL" | "holdTempC" | "additions" | "feeder">,
  order: OrderSpec
): string[] {
  const issues: string[] = [];

  if (validAdditions(d.additions).length === 0) {
    issues.push("追加量未登记：至少填写一种染料及其追加量（mL）。");
  }
  if (!Number.isFinite(d.residualL) || d.residualL < order.minResidualL) {
    issues.push(
      `余液不足：当前余液 ${num(d.residualL)}L，低于订单最低要求 ${order.minResidualL.toFixed(1)}L。`
    );
  }
  if (
    !Number.isFinite(d.holdTempC) ||
    Math.abs(d.holdTempC - order.holdTempC) > order.tempTolC
  ) {
    issues.push(
      `保温温度偏离：登记 ${num(d.holdTempC)}℃，订单规定 ${order.holdTempC}℃（允差 ±${order.tempTolC}℃）。`
    );
  }
  if (!d.feeder.trim()) {
    issues.push("补料人未登记。");
  }
  return issues;
}

export function startSheet(
  id: string,
  seq: number,
  draft: FeedSheetDraft,
  order: OrderSpec,
  nowIso: string
): FeedSheet {
  const additions = validAdditions(draft.additions);
  const issues = registrationIssues({ ...draft, additions }, order);
  return {
    ...draft,
    additions,
    note: draft.note?.trim() || undefined,
    id,
    seq,
    createdAt: nowIso,
    status: issues.length > 0 ? "pending" : "awaiting",
    issues,
    retest: null,
    advice: [],
    retestVoid: false,
    archiveReason: null,
    supersededBy: null,
  };
}

/** 每批只允许一张在途单：返回该批当前占用名额的补料单 */
export function findActiveSheet(
  sheets: FeedSheet[],
  batchNo: string
): FeedSheet | undefined {
  return sheets.find(
    (s) => s.batchNo === batchNo && ACTIVE_STATUSES.includes(s.status)
  );
}

export function nextSeq(sheets: FeedSheet[], orderNo: string): number {
  return sheets.reduce((max, s) => (s.orderNo === orderNo ? Math.max(max, s.seq) : max), 0) + 1;
}

export interface AxisFail {
  axis: AxisKey;
  value: number;
  tol: number;
}

/** 三轴容差判定：|Δ| 不得超过订单容差 */
export function evaluateAxes(
  v: Pick<RetestInput, "dl" | "da" | "db">,
  order: OrderSpec
): AxisFail[] {
  const fails: AxisFail[] = [];
  const rows: [AxisKey, number, number][] = [
    ["dl", v.dl, order.tolL],
    ["da", v.da, order.tolA],
    ["db", v.db, order.tolB],
  ];
  for (const [axis, value, tol] of rows) {
    if (Math.abs(value) > tol) fails.push({ axis, value, tol });
  }
  return fails;
}

/** 超限后续建议（只给建议，不自动追加染料） */
export function buildAdvice(fails: AxisFail[]): string[] {
  const tips: string[] = [];
  for (const f of fails) {
    const v = f.value.toFixed(2);
    if (f.axis === "dl") {
      tips.push(
        f.value > 0
          ? `ΔL*=+${v} 超出 +${f.tol}，色光偏浅：建议按原配方同比例小幅追加染料，严禁凭经验一次性补加。`
          : `ΔL*=${v} 超出 -${f.tol}，颜色偏深：建议延长保温或加强皂洗后再观察，暂不追加染料。`
      );
    } else if (f.axis === "da") {
      tips.push(
        f.value > 0
          ? `Δa*=+${v} 偏红超差（限 ±${f.tol}）：建议核减红相染料，或补加少量绿相校正色光。`
          : `Δa*=${v} 偏绿超差（限 ±${f.tol}）：建议少量补加红相染料校正色光。`
      );
    } else {
      tips.push(
        f.value > 0
          ? `Δb*=+${v} 偏黄超差（限 ±${f.tol}）：建议少量补加蓝相染料校正色光。`
          : `Δb*=${v} 偏蓝超差（限 ±${f.tol}）：建议少量补加黄相染料校正色光。`
      );
    }
  }
  tips.push(
    "请核对称料精度、浴比与保温记录，由补料人重新登记下一序号补料单后执行；本台只提供建议，不会自动追加染料。"
  );
  return tips;
}

export type RetestOutcome =
  | { kind: "passed" }
  | { kind: "over"; advice: string[] }
  | { kind: "pending"; issues: string[] };

/** 保温后复测：先查补料人/复核人分离，再判三轴容差 */
export function submitRetest(
  sheet: FeedSheet,
  input: RetestInput,
  order: OrderSpec
): RetestOutcome {
  const reviewer = input.reviewer.trim();
  if (reviewer && reviewer === sheet.feeder.trim()) {
    return {
      kind: "pending",
      issues: [
        `补料人兼复核人：复核人「${reviewer}」与补料人相同，保温后须由另一人复测，本单留在待确认。`,
      ],
    };
  }
  const fails = evaluateAxes(input, order);
  if (fails.length === 0) return { kind: "passed" };
  return { kind: "over", advice: buildAdvice(fails) };
}

/** 待确认单修正登记内容后重新校验；通过则回到待复测 */
export function reviseSheet(
  sheet: FeedSheet,
  patch: FeedSheetDraft,
  order: OrderSpec
): FeedSheet {
  const additions = validAdditions(patch.additions);
  const merged: FeedSheet = { ...sheet, ...patch, additions };
  const issues = registrationIssues(merged, order);
  return {
    ...merged,
    issues,
    status: issues.length > 0 ? "pending" : "awaiting",
  };
}

/**
 * 改用量：已复测的单修改追加量后，原复测失效、旧单留档，
 * 复制登记信息生成下一序号新单（仍受每批一张在途单约束）。
 */
export function changeDosage(
  old: FeedSheet,
  newAdditions: AdditionItem[],
  order: OrderSpec,
  newId: string,
  nowIso: string
): { archived: FeedSheet; fresh: FeedSheet } {
  const additions = validAdditions(newAdditions);
  const archived: FeedSheet = {
    ...old,
    status: "archived",
    retestVoid: old.retest !== null,
    archiveReason: "追加用量变更，原复测失效，本单留档。",
    supersededBy: newId,
  };
  const fresh = startSheet(
    newId,
    old.seq + 1,
    {
      orderNo: old.orderNo,
      batchNo: old.batchNo,
      residualL: old.residualL,
      holdTempC: old.holdTempC,
      additions,
      feeder: old.feeder,
      note: old.note,
    },
    order,
    nowIso
  );
  return { archived, fresh };
}
