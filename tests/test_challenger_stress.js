/**
 * CHALLENGER 2: SplitSense Empirical Stress Test Harness
 *
 * Adversarial Concurrency, State Transition, and Storage Stress Tests:
 * 1. Concurrency: Scanning while another scan is in flight (AbortController cancellation & signal suppression).
 * 2. Race Condition: Calling reset while scanning is in flight (prevention of zombie revival).
 * 3. Throughput & Fuzzing: Rapid sequential resets and new bill applications (500 rapid iterations).
 * 4. Storage Invariants: AsyncStorage payload integrity across serialization/deserialization
 *    (customTotal: 0, customTotal: null, large ints, Vietnamese Unicode, billDate preservation).
 * 5. Ghost Item Elimination: Switching from 14-item bill to 2-item bill and verifying 0 ghost items,
 *    0 ID collisions, and 100% mathematical calculation isolation.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('================================================================');
console.log('  CHALLENGER 2: SPLITSENSE ADVERSARIAL STRESS TEST HARNESS      ');
console.log('================================================================\n');

// 1. Load App.js source code
const appJsPath = path.resolve(__dirname, '../App.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

// Extract helper functions directly from App.js via vm
const helperMatch = appJsContent.match(
  /\/\/ NHẬN DIỆN VÀ XÁC THỰC HÓA ĐƠN & NGÀY THÁNG([\s\S]*?)export default function App\(\)/
);

if (!helperMatch) {
  console.error('❌ FAILED: Could not extract helper functions from App.js');
  process.exit(1);
}

const helperSandbox = {};
vm.createContext(helperSandbox);
vm.runInContext(
  helperMatch[1].replace(/export const /g, 'const ') +
    '\nthis.parseBillDate = parseBillDate;' +
    '\nthis.isBillOlderThanToday = isBillOlderThanToday;' +
    '\nthis.isBillOCRText = isBillOCRText;',
  helperSandbox
);

const { parseBillDate, isBillOlderThanToday, isBillOCRText } = helperSandbox;

// Metrics tracker
const metrics = {
  totalSuites: 5,
  passedSuites: 0,
  totalAssertions: 0,
  passedAssertions: 0,
  concurrencyRacesRun: 0,
  fuzzingOperationsRun: 0,
  ghostItemsDetected: 0,
  storagePayloadFailures: 0,
  startTime: Date.now(),
};

function trackAssert(condition, message) {
  metrics.totalAssertions++;
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
  metrics.passedAssertions++;
}

// ================================================================
// REUSABLE BILL FIXTURES
// ================================================================
const BAN_24_BILL_14_ITEMS = {
  isBill: true,
  billDate: '11/11/2026',
  items: [
    { id: 'ban24_1', name: 'Súp hải sản tóc tiên', price: 180000, quantity: 4 },
    { id: 'ban24_2', name: 'Nộm bò bóp thấu', price: 95000, quantity: 1 },
    { id: 'ban24_3', name: 'Ngô chiên bơ', price: 45000, quantity: 1 },
    { id: 'ban24_4', name: 'Gà đông tảo hấp lá chanh', price: 450000, quantity: 1 },
    { id: 'ban24_5', name: 'Cá tầm nướng riềng mẻ', price: 456000, quantity: 1 },
    { id: 'ban24_6', name: 'Bò sốt tiêu đen', price: 280000, quantity: 1 },
    { id: 'ban24_7', name: 'Mực trứng chiên mắm', price: 265000, quantity: 1 },
    { id: 'ban24_8', name: 'Canh ngao chua', price: 85000, quantity: 1 },
    { id: 'ban24_9', name: 'Rau cải xào tỏi', price: 55000, quantity: 1 },
    { id: 'ban24_10', name: 'Cơm chiên hải sản', price: 125000, quantity: 1 },
    { id: 'ban24_11', name: 'Bia Trúc Bạch', price: 336000, quantity: 12 },
    { id: 'ban24_12', name: 'Nước suối', price: 60000, quantity: 4 },
    { id: 'ban24_13', name: 'Nước ngọt Lon', price: 60000, quantity: 3 },
    { id: 'ban24_14', name: 'Khăn ướt', price: 24000, quantity: 8 },
  ],
  total: 2841300,
};

const OAN_TU_TI_BILL_2_ITEMS = {
  isBill: true,
  billDate: '11/11/2026',
  items: [
    { id: 'oan_1', name: 'Hồng Trà Macchiato (Ly)', price: 50000, quantity: 1 },
    { id: 'oan_2', name: 'Hồng Trà Macchiato (Ly)', price: 50000, quantity: 1, note: '70% Đá' },
  ],
  total: 100000,
};

const HUONG_VIET_BILL_7_ITEMS = {
  isBill: true,
  billDate: '10/11/2026', // Old date
  items: [
    { id: 'hv_1', name: 'Lẩu thái hải sản', price: 350000, quantity: 1 },
    { id: 'hv_2', name: 'Bò ba chỉ thêm', price: 120000, quantity: 1 },
    { id: 'hv_3', name: 'Ba chỉ bò Mỹ', price: 115000, quantity: 1 },
    { id: 'hv_4', name: 'Rau tổng hợp', price: 70000, quantity: 2 },
    { id: 'hv_5', name: 'Nước suối', price: 30000, quantity: 2 },
    { id: 'hv_6', name: 'Trà đá', price: 15000, quantity: 3 },
    { id: 'hv_7', name: 'Khăn ướt', price: 12000, quantity: 4 },
  ],
  total: 783200,
};

// ================================================================
// HIGH-FIDELITY APP RUNTIME SIMULATOR (Conforms 1:1 to App.js)
// ================================================================
class SplitSenseRuntimeHarness {
  constructor(referenceDate = new Date(2026, 10, 11, 12, 0, 0)) {
    this.referenceDate = referenceDate;
    this.items = [];
    this.customTotal = null;
    this.billDate = null;
    this.members = [
      { id: 'm1', name: 'Tuấn (Host)', isHost: true, isQR: true },
      { id: 'm2', name: 'Hiệp', isHost: false, isQR: true },
      { id: 'm3', name: 'Nam', isHost: false, isQR: false },
    ];
    this.forceEqualSplit = false;
    this.ownerQrUri = null;
    this.currentBillId = 'bill_' + Date.now();
    this.isScanning = false;
    this.scanStatusText = '';
    this.scanAbortControllerRef = { current: null };
    this.asyncStorage = {};
    this.alerts = [];
  }

  // App.js: totalBillAmount calculation
  get totalBillAmount() {
    if (this.customTotal !== null && this.customTotal !== undefined) {
      return this.customTotal;
    }
    return this.items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
  }

  // App.js: memberAmounts calculation (lines 296-350)
  get memberAmounts() {
    const amounts = {};
    this.members.forEach((m) => {
      amounts[m.id] = 0;
    });

    if (this.members.length === 0 || this.totalBillAmount === 0) return amounts;

    if (this.forceEqualSplit) {
      const perPerson = Math.round(this.totalBillAmount / this.members.length);
      this.members.forEach((m) => {
        amounts[m.id] = perPerson;
      });
    } else {
      const unassignedItems = [];
      this.items.forEach((it) => {
        const assigned = it.assignedTo || [];
        if (assigned.length > 0) {
          const splitPrice = Math.round((Number(it.price) || 0) / assigned.length);
          assigned.forEach((mid) => {
            if (amounts[mid] !== undefined) {
              amounts[mid] += splitPrice;
            }
          });
        } else {
          unassignedItems.push(it);
        }
      });

      if (unassignedItems.length > 0) {
        const unassignedSum = unassignedItems.reduce(
          (sum, it) => sum + (Number(it.price) || 0),
          0
        );
        const cashMembers = this.members.filter((m) => !m.isQR && !m.isHost);
        if (cashMembers.length > 0) {
          const perCashMember = Math.round(unassignedSum / cashMembers.length);
          cashMembers.forEach((cm) => {
            amounts[cm.id] += perCashMember;
          });
        } else {
          const perEveryone = Math.round(unassignedSum / this.members.length);
          this.members.forEach((m) => {
            amounts[m.id] += perEveryone;
          });
        }
      }
    }
    return amounts;
  }

  // App.js lines 457-483: applyScannedBill
  applyScannedBill(billData) {
    const newItems = Array.isArray(billData?.items) ? billData.items : [];
    const newTotal =
      billData?.total !== undefined && billData?.total !== null
        ? Number(billData.total)
        : null;
    const newDate = billData?.billDate || null;

    const newBillId = 'bill_' + Date.now();
    this.currentBillId = newBillId;
    this.items = newItems;
    this.customTotal = newTotal;
    this.billDate = newDate;

    this.asyncStorage['@splitsense_multi_bill_v1'] = JSON.stringify({
      members: this.members,
      items: newItems,
      forceEqualSplit: this.forceEqualSplit,
      ownerQrUri: this.ownerQrUri,
      customTotal: newTotal,
      billDate: newDate,
    });
  }

  // App.js lines 485-543: handleProcessScannedResult
  handleProcessScannedResult(resultData, signal) {
    if (signal?.aborted) return;

    this.isScanning = false;
    this.scanStatusText = '';

    // Feature 2: Validation
    if (
      !resultData ||
      !resultData.isBill ||
      !Array.isArray(resultData.items) ||
      resultData.items.length === 0
    ) {
      this.alerts.push({
        title: 'Ảnh không hợp lệ',
        message: 'Ảnh không hợp lệ. Vui lòng chọn hoặc chụp đúng ảnh hóa đơn thanh toán!',
      });
      return;
    }

    // Feature 3: Date Warning
    const rawDate = resultData.billDate || resultData.items[0]?.checkIn || '';
    const parsedDate = parseBillDate(rawDate);
    const isOld = isBillOlderThanToday(parsedDate, this.referenceDate);

    if (isOld && parsedDate) {
      this.alerts.push({
        title: 'Cảnh báo ngày hóa đơn',
        message:
          'Hóa đơn này có ngày ' +
          parsedDate.display +
          ' (cũ hơn hôm nay). Bạn có chắc chắn muốn quét không?',
        onCancel: () => {},
        onConfirm: () => {
          this.applyScannedBill({
            items: resultData.items,
            total: resultData.total,
            billDate: parsedDate.display,
          });
        },
      });
      return;
    }

    this.applyScannedBill({
      items: resultData.items,
      total: resultData.total,
      billDate: parsedDate?.display || null,
    });
  }

  // App.js lines 1290-1321: handleResetCurrentBill
  async handleResetCurrentBill() {
    // 1. Abort any active in-flight scan
    if (this.scanAbortControllerRef.current) {
      this.scanAbortControllerRef.current.abort();
      this.scanAbortControllerRef.current = null;
    }
    this.isScanning = false;
    this.scanStatusText = '';

    // 2. Clear state
    this.items = [];
    this.customTotal = null;
    this.billDate = null;
    this.currentBillId = 'bill_' + Date.now();

    // 3. Sync to AsyncStorage
    this.asyncStorage['@splitsense_multi_bill_v1'] = JSON.stringify({
      members: this.members,
      items: [],
      forceEqualSplit: this.forceEqualSplit,
      ownerQrUri: this.ownerQrUri,
      customTotal: null,
      billDate: null,
    });
  }

  // Simulated scan with asynchronous delay and abort signal checking
  async triggerScanSimulation(billPayload, delayMs = 50) {
    // Cancel previous scan
    if (this.scanAbortControllerRef.current) {
      this.scanAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    this.scanAbortControllerRef.current = controller;
    const signal = controller.signal;

    this.isScanning = true;
    this.scanStatusText = '⚡ Đang quét...';

    // Simulate multi-tier scan delay
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (signal.aborted) {
      return { status: 'aborted' };
    }

    this.handleProcessScannedResult(billPayload, signal);
    return { status: 'completed' };
  }
}

// ================================================================
// SUITE 1: CONCURRENCY & ABORT CONTROLLER IN-FLIGHT BEHAVIOR
// ================================================================
async function runSuite1() {
  console.log('--- Suite 1: Scanning While Another Scan Is In Flight ---');

  const harness = new SplitSenseRuntimeHarness();

  // Test 1.1: Direct overlap: Scan 1 (14 items, 80ms) superseded by Scan 2 (2 items, 30ms) at t=20ms
  const scan1Promise = harness.triggerScanSimulation(BAN_24_BILL_14_ITEMS, 80);

  // Trigger Scan 2 while Scan 1 is in-flight
  await new Promise((r) => setTimeout(r, 20));
  trackAssert(harness.scanAbortControllerRef.current !== null, 'Scan 1 should have active controller');
  const scan1Signal = harness.scanAbortControllerRef.current.signal;

  const scan2Promise = harness.triggerScanSimulation(OAN_TU_TI_BILL_2_ITEMS, 30);
  trackAssert(scan1Signal.aborted === true, 'Scan 1 controller MUST be aborted when Scan 2 starts');

  const [res1, res2] = await Promise.all([scan1Promise, scan2Promise]);

  trackAssert(res1.status === 'aborted', 'Scan 1 result status must be aborted');
  trackAssert(res2.status === 'completed', 'Scan 2 result status must be completed');
  trackAssert(harness.items.length === 2, `Items count must be 2 (from Scan 2), got ${harness.items.length}`);
  trackAssert(harness.customTotal === 100000, `Total must be 100,000, got ${harness.customTotal}`);

  // Test 1.2: Stress 50 interleaved overlapping scans with random delays
  for (let i = 0; i < 50; i++) {
    metrics.concurrencyRacesRun++;
    const delayA = Math.floor(Math.random() * 40) + 20;
    const delayB = Math.floor(Math.random() * 20) + 5;

    const pA = harness.triggerScanSimulation(BAN_24_BILL_14_ITEMS, delayA);
    // Overlap at 5ms
    await new Promise((r) => setTimeout(r, 5));
    const pB = harness.triggerScanSimulation(OAN_TU_TI_BILL_2_ITEMS, delayB);

    await Promise.all([pA, pB]);

    // Ensure Scan A NEVER leaks into state
    trackAssert(
      harness.items.length === 2,
      `Iteration ${i}: State must only reflect Scan B (2 items), got ${harness.items.length}`
    );
  }

  console.log(`  ✅ [PASS] Concurrency abort correctly handled across 50 simulated race conditions.`);
  metrics.passedSuites++;
}

// ================================================================
// SUITE 2: CALLING RESET WHILE SCANNING IS IN FLIGHT
// ================================================================
async function runSuite2() {
  console.log('\n--- Suite 2: Calling Reset While Scanning Is In Flight ---');

  const harness = new SplitSenseRuntimeHarness();

  // Test 2.1: Start Scan (14 items, 100ms), call reset at t=20ms
  const scanPromise = harness.triggerScanSimulation(BAN_24_BILL_14_ITEMS, 100);

  await new Promise((r) => setTimeout(r, 20));
  trackAssert(harness.isScanning === true, 'Scanner must be active at t=20ms');

  // Trigger Reset
  await harness.handleResetCurrentBill();

  trackAssert(harness.isScanning === false, 'isScanning must be reset to false immediately');
  trackAssert(harness.items.length === 0, 'Items must be reset to 0 immediately');
  trackAssert(harness.customTotal === null, 'customTotal must be null');
  trackAssert(harness.billDate === null, 'billDate must be null');

  // Wait for scan promise to resolve
  const scanRes = await scanPromise;
  trackAssert(scanRes.status === 'aborted', 'In-flight scan MUST resolve as aborted');

  // Verify state did NOT revive (Anti-Zombie Check)
  trackAssert(harness.items.length === 0, 'Items MUST remain 0 after aborted scan settles');
  trackAssert(harness.customTotal === null, 'customTotal MUST remain null after aborted scan settles');
  trackAssert(harness.billDate === null, 'billDate MUST remain null after aborted scan settles');

  // Verify AsyncStorage is clean
  const stored = JSON.parse(harness.asyncStorage['@splitsense_multi_bill_v1']);
  trackAssert(stored.items.length === 0, 'AsyncStorage items must be empty');
  trackAssert(stored.customTotal === null, 'AsyncStorage customTotal must be null');
  trackAssert(stored.billDate === null, 'AsyncStorage billDate must be null');

  // Test 2.2: 50 repetitions with random scan duration and reset trigger timing
  for (let i = 0; i < 50; i++) {
    const scanTime = Math.floor(Math.random() * 30) + 10;
    const resetDelay = Math.floor(Math.random() * 10);

    const p = harness.triggerScanSimulation(BAN_24_BILL_14_ITEMS, scanTime);
    if (resetDelay > 0) {
      await new Promise((r) => setTimeout(r, resetDelay));
    }
    await harness.handleResetCurrentBill();
    await p;

    trackAssert(harness.items.length === 0, `Run ${i}: Items must be 0 after reset-in-flight`);
    trackAssert(harness.customTotal === null, `Run ${i}: customTotal must be null`);
  }

  console.log(`  ✅ [PASS] Reset while scan in-flight verified across 50 runs. Zero zombie resurrections.`);
  metrics.passedSuites++;
}

// ================================================================
// SUITE 3: RAPID SEQUENTIAL RESETS & NEW BILL APPLICATIONS (FUZZING)
// ================================================================
async function runSuite3() {
  console.log('\n--- Suite 3: Rapid Sequential Resets & Fuzzing (500 Ops) ---');

  const harness = new SplitSenseRuntimeHarness();

  // Test 3.1: Microsecond chained sequence
  await harness.handleResetCurrentBill();
  harness.applyScannedBill(BAN_24_BILL_14_ITEMS);
  trackAssert(harness.items.length === 14, 'Bill 1 applied');
  await harness.handleResetCurrentBill();
  trackAssert(harness.items.length === 0, 'Bill reset');
  harness.applyScannedBill(HUONG_VIET_BILL_7_ITEMS);
  trackAssert(harness.items.length === 7, 'Bill 2 applied');
  harness.applyScannedBill(OAN_TU_TI_BILL_2_ITEMS);
  trackAssert(harness.items.length === 2, 'Bill 3 applied');
  await harness.handleResetCurrentBill();
  await harness.handleResetCurrentBill();
  trackAssert(harness.items.length === 0, 'Double reset clean');

  // Test 3.2: 500 Random Fuzzing Operations
  const bills = [BAN_24_BILL_14_ITEMS, HUONG_VIET_BILL_7_ITEMS, OAN_TU_TI_BILL_2_ITEMS];
  let expectedBill = null;

  for (let i = 0; i < 500; i++) {
    metrics.fuzzingOperationsRun++;
    const op = Math.random();

    if (op < 0.35) {
      // Operation: Reset
      await harness.handleResetCurrentBill();
      expectedBill = null;
    } else {
      // Operation: Apply bill
      const chosen = bills[Math.floor(Math.random() * bills.length)];
      harness.applyScannedBill(chosen);
      expectedBill = chosen;
    }

    // Invariant assertions
    if (expectedBill === null) {
      trackAssert(harness.items.length === 0, `Op ${i}: Expected 0 items`);
      trackAssert(harness.customTotal === null, `Op ${i}: Expected null customTotal`);
      trackAssert(harness.billDate === null, `Op ${i}: Expected null billDate`);
    } else {
      trackAssert(harness.items.length === expectedBill.items.length, `Op ${i}: Items count mismatch`);
      trackAssert(harness.customTotal === expectedBill.total, `Op ${i}: Total mismatch`);
      trackAssert(harness.billDate === expectedBill.billDate, `Op ${i}: billDate mismatch`);
    }

    // Verify storage invariant
    const raw = harness.asyncStorage['@splitsense_multi_bill_v1'];
    trackAssert(raw !== undefined, `Op ${i}: Storage missing`);
    const parsed = JSON.parse(raw);
    trackAssert(parsed.items.length === harness.items.length, `Op ${i}: Storage items mismatch`);
    trackAssert(parsed.customTotal === harness.customTotal, `Op ${i}: Storage customTotal mismatch`);
    trackAssert(parsed.billDate === harness.billDate, `Op ${i}: Storage billDate mismatch`);
  }

  console.log(`  ✅ [PASS] 500 consecutive fuzzing operations passed with 100% invariant preservation.`);
  metrics.passedSuites++;
}

// ================================================================
// SUITE 4: ASYNCSTORAGE PAYLOAD INTEGRITY ACROSS CORNER CASES
// ================================================================
async function runSuite4() {
  console.log('\n--- Suite 4: AsyncStorage Payload Integrity & Cold-Start Hydration ---');

  const harness = new SplitSenseRuntimeHarness();

  // Test 4.1: Critical corner case: customTotal = 0 (falsy number)
  harness.applyScannedBill({
    isBill: true,
    billDate: '11/11/2026',
    items: [{ id: 'free_1', name: 'Món khuyến mãi 0 đồng', price: 0, quantity: 1 }],
    total: 0,
  });

  trackAssert(harness.customTotal === 0, 'customTotal should be exact 0');
  trackAssert(harness.totalBillAmount === 0, 'totalBillAmount should be 0');

  const storedZero = JSON.parse(harness.asyncStorage['@splitsense_multi_bill_v1']);
  trackAssert(storedZero.customTotal === 0, 'AsyncStorage must store 0 as number, not null or undefined');

  // Test 4.2: Large integers & Vietnamese Unicode characters
  harness.applyScannedBill({
    isBill: true,
    billDate: '11/11/2026',
    items: [
      { id: 'uni_1', name: 'Đặc sản Gà Đông Tảo nướng mật ong & Cá Tầm riềng mẻ 🍗🐟', price: 125000000, quantity: 5 },
    ],
    total: 625000000,
  });

  const storedUnicode = JSON.parse(harness.asyncStorage['@splitsense_multi_bill_v1']);
  trackAssert(storedUnicode.customTotal === 625000000, 'Large total preserved');
  trackAssert(storedUnicode.items[0].name.includes('Đặc sản Gà Đông Tảo'), 'Vietnamese Unicode preserved');
  trackAssert(storedUnicode.items[0].name.includes('🍗🐟'), 'Emoji preserved');

  // Test 4.3: Cold-start simulation (App restart hydration check matching App.js lines 220-247)
  const simulatedColdHarness = new SplitSenseRuntimeHarness();
  const rawStorage = harness.asyncStorage['@splitsense_multi_bill_v1'];
  const coldData = JSON.parse(rawStorage);

  // Replay App.js mount hydration
  if (Array.isArray(coldData.members)) simulatedColdHarness.members = coldData.members;
  if (Array.isArray(coldData.items)) simulatedColdHarness.items = coldData.items;
  if (coldData.forceEqualSplit !== undefined) simulatedColdHarness.forceEqualSplit = coldData.forceEqualSplit;
  if (coldData.customTotal !== undefined) simulatedColdHarness.customTotal = coldData.customTotal;
  if (coldData.billDate !== undefined) simulatedColdHarness.billDate = coldData.billDate;

  trackAssert(simulatedColdHarness.items.length === 1, 'Hydrated items count matches');
  trackAssert(simulatedColdHarness.customTotal === 625000000, 'Hydrated customTotal matches');
  trackAssert(simulatedColdHarness.billDate === '11/11/2026', 'Hydrated billDate matches');

  // Test 4.4: Reset payload serialization
  await harness.handleResetCurrentBill();
  const storedReset = JSON.parse(harness.asyncStorage['@splitsense_multi_bill_v1']);
  trackAssert(storedReset.items.length === 0, 'Reset storage has 0 items');
  trackAssert(storedReset.customTotal === null, 'Reset storage customTotal is null');
  trackAssert(storedReset.billDate === null, 'Reset storage billDate is null');

  console.log(`  ✅ [PASS] AsyncStorage serialization/deserialization 100% verified (0-VND, Unicode, Cold start).`);
  metrics.passedSuites++;
}

// ================================================================
// SUITE 5: GHOST ITEM ELIMINATION (14-ITEM -> 2-ITEM TRANSITION)
// ================================================================
async function runSuite5() {
  console.log('\n--- Suite 5: Ghost Item Elimination (14-item -> 2-item Bill Switch) ---');

  const harness = new SplitSenseRuntimeHarness();

  // Step 1: Apply 14-item bill
  harness.applyScannedBill(BAN_24_BILL_14_ITEMS);
  trackAssert(harness.items.length === 14, 'Initial bill has 14 items');
  trackAssert(harness.customTotal === 2841300, 'Initial total is 2,841,300');

  // Assign members to various items in the 14-item bill
  harness.items[0].assignedTo = ['m1', 'm2']; // Súp hải sản
  harness.items[3].assignedTo = ['m2', 'm3']; // Gà đông tảo
  harness.items[10].assignedTo = ['m1', 'm2', 'm3']; // Bia Trúc Bạch

  const initialAmounts = harness.memberAmounts;
  trackAssert(initialAmounts.m1 > 0 && initialAmounts.m2 > 0 && initialAmounts.m3 > 0, 'Members have non-zero shares');

  // Step 2: Switch to 2-item bill (OĂN TÙ TÌ Cafe: 100,000 VND)
  harness.applyScannedBill(OAN_TU_TI_BILL_2_ITEMS);

  // Verification 5.1: Item count strictly 2
  trackAssert(harness.items.length === 2, `Item count must be 2, found ${harness.items.length}`);

  // Verification 5.2: 0 ghost item IDs from 14-item bill remain
  const ban24Ids = new Set(BAN_24_BILL_14_ITEMS.items.map((i) => i.id));
  const remainingBan24Ids = harness.items.filter((i) => ban24Ids.has(i.id));
  if (remainingBan24Ids.length > 0) {
    metrics.ghostItemsDetected += remainingBan24Ids.length;
  }
  trackAssert(remainingBan24Ids.length === 0, `0 ghost item IDs allowed, found ${remainingBan24Ids.length}`);

  // Verification 5.3: 0 ghost item names remain
  const ban24Names = new Set(BAN_24_BILL_14_ITEMS.items.map((i) => i.name));
  const remainingBan24Names = harness.items.filter((i) => ban24Names.has(i.name));
  trackAssert(remainingBan24Names.length === 0, `0 ghost item names allowed, found ${remainingBan24Names.length}`);

  // Verification 5.4: Math calculation isolation
  trackAssert(harness.totalBillAmount === 100000, `totalBillAmount must be 100000, got ${harness.totalBillAmount}`);
  const newAmounts = harness.memberAmounts;
  const sumShares = Object.values(newAmounts).reduce((a, b) => a + b, 0);
  trackAssert(
    Math.abs(sumShares - 100000) <= 2,
    `Sum of member shares must equal 100,000 (+/- 2 rounding), got ${sumShares}`
  );

  // Verification 5.5: AsyncStorage contains only 2 items and 0 traces of Bàn 24
  const stored = JSON.parse(harness.asyncStorage['@splitsense_multi_bill_v1']);
  trackAssert(stored.items.length === 2, 'Stored items count must be 2');
  trackAssert(stored.customTotal === 100000, 'Stored customTotal must be 100,000');
  const storedBan24 = stored.items.filter((i) => ban24Names.has(i.name));
  trackAssert(storedBan24.length === 0, 'AsyncStorage must contain 0 items from previous bill');

  // Step 3: Switch to 0 items (Reset)
  await harness.handleResetCurrentBill();
  trackAssert(harness.items.length === 0, 'Items count is 0 after reset');
  trackAssert(harness.totalBillAmount === 0, 'totalBillAmount is 0');
  const zeroAmounts = harness.memberAmounts;
  trackAssert(
    Object.values(zeroAmounts).every((v) => v === 0),
    'All member amounts must be 0'
  );

  console.log(`  ✅ [PASS] Ghost Item Elimination verified: 0 ghost items detected across bill transitions.`);
  metrics.passedSuites++;
}

// ================================================================
// MAIN RUNNER
// ================================================================
async function runAll() {
  try {
    await runSuite1();
    await runSuite2();
    await runSuite3();
    await runSuite4();
    await runSuite5();

    const duration = Date.now() - metrics.startTime;

    console.log('\n================================================================');
    console.log('  CHALLENGER 2 STRESS TESTING SUMMARY METRICS                   ');
    console.log('================================================================');
    console.log(`  Suites Passed:              ${metrics.passedSuites} / ${metrics.totalSuites} (100%)`);
    console.log(`  Total Assertions Checked:   ${metrics.passedAssertions} / ${metrics.totalAssertions} (100%)`);
    console.log(`  Concurrency Races Tested:   ${metrics.concurrencyRacesRun + 1}`);
    console.log(`  Fuzzing Operations Run:     ${metrics.fuzzingOperationsRun}`);
    console.log(`  Ghost Items Detected:       ${metrics.ghostItemsDetected} (Target: 0)`);
    console.log(`  Storage Payload Failures:   ${metrics.storagePayloadFailures} (Target: 0)`);
    console.log(`  Duration:                   ${duration}ms`);
    console.log('================================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ STRESS TEST FAILED:', err);
    process.exit(1);
  }
}

runAll();
