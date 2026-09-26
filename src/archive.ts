// 染整小样补料复核台 —— 档案（订单容差、批次、补料单存档与本地持久化）

import type { Batch, FeedSheet, OrderSpec } from "./rules";

export interface Archive {
  orders: OrderSpec[];
  batches: Batch[];
  sheets: FeedSheet[];
}

const STORAGE_KEY = "hxyfront-62012-feed-review-v1";

/** 订单容差：ΔL* / Δa* / Δb* 三轴绝对值限、保温温度与允差、最低余液 */
const SEED_ORDERS: OrderSpec[] = [
  {
    orderNo: "PO-2408-018",
    customer: "澜庭家纺",
    fabric: "棉府绸 120g",
    shade: "雾霾蓝",
    holdTempC: 60,
    tempTolC: 2,
    minResidualL: 8,
    tolL: 0.8,
    tolA: 0.5,
    tolB: 0.6,
  },
  {
    orderNo: "PO-2408-021",
    customer: "云栖运动",
    fabric: "涤纶针织",
    shade: "炭黑",
    holdTempC: 130,
    tempTolC: 2,
    minResidualL: 6,
    tolL: 0.7,
    tolA: 0.4,
    tolB: 0.5,
  },
  {
    orderNo: "PO-2408-027",
    customer: "沐风户外",
    fabric: "锦棉混纺斜纹",
    shade: "军绿",
    holdTempC: 98,
    tempTolC: 3,
    minResidualL: 10,
    tolL: 0.9,
    tolA: 0.6,
    tolB: 0.7,
  },
];

const SEED_BATCHES: Batch[] = [
  { batchNo: "B-620A", orderNo: "PO-2408-018" },
  { batchNo: "B-621C", orderNo: "PO-2408-018" },
  { batchNo: "B-622D", orderNo: "PO-2408-021" },
  { batchNo: "B-624B", orderNo: "PO-2408-027" },
];

function seedSheets(): FeedSheet[] {
  return [
    {
      id: "S-0001",
      orderNo: "PO-2408-018",
      batchNo: "B-620A",
      seq: 1,
      createdAt: "2026-09-24T09:12:00.000Z",
      residualL: 12.5,
      holdTempC: 60,
      additions: [
        { dye: "活性蓝 KE-G", amountMl: 3.2 },
        { dye: "活性红 KE-3B", amountMl: 0.8 },
      ],
      feeder: "王建国",
      status: "passed",
      issues: [],
      retest: {
        reviewer: "李梅",
        dl: 0.31,
        da: -0.2,
        db: 0.45,
        at: "2026-09-24T10:05:00.000Z",
      },
      advice: [],
      retestVoid: false,
      archiveReason: null,
      supersededBy: null,
    },
    {
      id: "S-0002",
      orderNo: "PO-2408-018",
      batchNo: "B-621C",
      seq: 1,
      createdAt: "2026-09-25T08:40:00.000Z",
      residualL: 9.5,
      holdTempC: 61,
      additions: [{ dye: "活性蓝 KE-G", amountMl: 2.0 }],
      feeder: "张涛",
      status: "archived",
      issues: [],
      retest: {
        reviewer: "李梅",
        dl: 1.12,
        da: -0.15,
        db: 0.3,
        at: "2026-09-25T09:30:00.000Z",
      },
      advice: [],
      retestVoid: true,
      archiveReason: "追加用量变更，原复测失效，本单留档。",
      supersededBy: "S-0004",
    },
    {
      id: "S-0003",
      orderNo: "PO-2408-021",
      batchNo: "B-622D",
      seq: 1,
      createdAt: "2026-09-25T13:20:00.000Z",
      residualL: 7.2,
      holdTempC: 130,
      additions: [{ dye: "分散黑 ECT", amountMl: 1.6 }],
      feeder: "陈芳",
      status: "over",
      issues: [],
      retest: {
        reviewer: "赵启明",
        dl: 0.42,
        da: -0.58,
        db: 0.2,
        at: "2026-09-25T14:10:00.000Z",
      },
      advice: [
        "Δa*=-0.58 偏绿超差（限 ±0.4）：建议少量补加红相染料校正色光。",
        "请核对称料精度、浴比与保温记录，由补料人重新登记下一序号补料单后执行；本台只提供建议，不会自动追加染料。",
      ],
      retestVoid: false,
      archiveReason: null,
      supersededBy: null,
    },
    {
      id: "S-0004",
      orderNo: "PO-2408-018",
      batchNo: "B-621C",
      seq: 2,
      createdAt: "2026-09-25T11:00:00.000Z",
      residualL: 9.2,
      holdTempC: 61,
      additions: [
        { dye: "活性蓝 KE-G", amountMl: 3.0 },
        { dye: "活性黄 KE-4R", amountMl: 0.6 },
      ],
      feeder: "张涛",
      status: "awaiting",
      issues: [],
      retest: null,
      advice: [],
      retestVoid: false,
      archiveReason: null,
      supersededBy: null,
    },
    {
      id: "S-0005",
      orderNo: "PO-2408-027",
      batchNo: "B-624B",
      seq: 1,
      createdAt: "2026-09-26T08:15:00.000Z",
      residualL: 7.5,
      holdTempC: 103,
      additions: [{ dye: "酸性黄 A-4R", amountMl: 1.2 }],
      feeder: "刘洋",
      note: "凭经验先补了一管黄，余液偏少",
      status: "pending",
      issues: [
        "余液不足：当前余液 7.5L，低于订单最低要求 10.0L。",
        "保温温度偏离：登记 103℃，订单规定 98℃（允差 ±3℃）。",
      ],
      retest: null,
      advice: [],
      retestVoid: false,
      archiveReason: null,
      supersededBy: null,
    },
  ];
}

export function loadArchive(): Archive {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Archive;
      if (Array.isArray(parsed.orders) && Array.isArray(parsed.sheets)) {
        return { orders: parsed.orders, batches: parsed.batches ?? [], sheets: parsed.sheets };
      }
    }
  } catch {
    // 缓存损坏时回落到内置档案
  }
  const seeded: Archive = { orders: SEED_ORDERS, batches: SEED_BATCHES, sheets: seedSheets() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  } catch {
    // 无存储权限时仍可在内存中使用
  }
  return seeded;
}

export function saveArchive(archive: Archive): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
  } catch {
    // 忽略写入失败
  }
}

export function resetArchive(): Archive {
  const seeded: Archive = { orders: SEED_ORDERS, batches: SEED_BATCHES, sheets: seedSheets() };
  saveArchive(seeded);
  return seeded;
}

export function findOrder(archive: Archive, orderNo: string): OrderSpec | undefined {
  return archive.orders.find((o) => o.orderNo === orderNo);
}

export function batchesOf(archive: Archive, orderNo: string): Batch[] {
  return archive.batches.filter((b) => b.orderNo === orderNo);
}

export function findBatch(archive: Archive, batchNo: string): Batch | undefined {
  return archive.batches.find((b) => b.batchNo === batchNo);
}
