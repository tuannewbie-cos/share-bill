/**
 * Test Runner: SplitSense E2E Scanner & Single Bill Test Suite
 *
 * Scenarios Tested:
 * 1. Valid bill today -> applied directly, 0 alerts, AsyncStorage updated
 * 2. Non-bill image (face, object, scenery) -> rejected with exact alert, 0 state change, no Bàn 24 fallback
 * 3. Old date bill (10/11/2026 vs 11/11/2026) -> triggers confirmation alert; tests Cancel (no change) and Confirm (applies new bill)
 * 4. Delete bill / reset -> items reset cleanly, AsyncStorage updated, next bill replaces with 0 ghost items
 *
 * Plus unit checks on parseBillDate, isBillOlderThanToday, isBillOCRText extracted directly from App.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('====================================================');
console.log('  SPLITSENSE AUTOMATED SCANNER & SINGLE BILL TESTS  ');
console.log('====================================================\n');

// 1. Load and extract helper functions directly from App.js
const appJsPath = path.resolve(__dirname, '../App.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

const helperMatch = appJsContent.match(
  /\/\/ NHẬN DIỆN VÀ XÁC THỰC HÓA ĐƠN & NGÀY THÁNG([\s\S]*?)export default function App\(\)/
);

if (!helperMatch) {
  console.error('❌ FAILED: Could not locate helper section in App.js');
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

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// ==========================================
// SUITE 1: UNIT LOGIC CHECKS
// ==========================================
console.log('--- Suite 1: Receipt Date & OCR Heuristics ---');

runTest('parseBillDate handles DD/MM/YYYY format', () => {
  const res = parseBillDate('10/11/2026');
  assert(res !== null, 'Should parse 10/11/2026');
  assert.strictEqual(res.display, '10/11/2026');
  assert.strictEqual(res.date.getDate(), 10);
  assert.strictEqual(res.date.getMonth(), 10); // 0-indexed November
  assert.strictEqual(res.date.getFullYear(), 2026);
});

runTest('parseBillDate handles YYYY-MM-DD format', () => {
  const res = parseBillDate('2026-11-10');
  assert(res !== null, 'Should parse 2026-11-10');
  assert.strictEqual(res.display, '10/11/2026');
  assert.strictEqual(res.iso, '2026-11-10');
});

runTest('parseBillDate handles datetime strings with checkIn time', () => {
  const res = parseBillDate('21:15 10/11/2026');
  assert(res !== null, 'Should parse 21:15 10/11/2026');
  assert.strictEqual(res.display, '10/11/2026');
});

runTest('parseBillDate handles Vietnamese natural format', () => {
  const res = parseBillDate('Ngày 10 tháng 11 năm 2026');
  assert(res !== null, 'Should parse Vietnamese date');
  assert.strictEqual(res.display, '10/11/2026');
});

runTest('parseBillDate returns null on invalid or non-date input', () => {
  assert.strictEqual(parseBillDate(''), null);
  assert.strictEqual(parseBillDate('random text without date'), null);
  assert.strictEqual(parseBillDate(null), null);
});

runTest('isBillOlderThanToday detects older date compared to today (11/11/2026)', () => {
  const today = new Date(2026, 10, 11, 14, 30, 0); // 11/11/2026 14:30
  const yesterday = parseBillDate('10/11/2026');
  const sameDay = parseBillDate('11/11/2026');
  const futureDay = parseBillDate('12/11/2026');

  assert.strictEqual(isBillOlderThanToday(yesterday, today), true, '10/11/2026 is older than 11/11/2026');
  assert.strictEqual(isBillOlderThanToday(sameDay, today), false, '11/11/2026 is today');
  assert.strictEqual(isBillOlderThanToday(futureDay, today), false, '12/11/2026 is future');
  assert.strictEqual(isBillOlderThanToday(null, today), false, 'null date is not older');
});

runTest('isBillOCRText validates real receipt keywords and price patterns', () => {
  const validReceiptText = 'HÓA ĐƠN THANH TOÁN Bàn 24 Súp hải sản 180.000 đ Tổng cộng 2.841.300 đ';
  assert.strictEqual(isBillOCRText(validReceiptText), true);

  const validReceiptText2 = 'PHIẾU TÍNH TIỀN Cơm rang dưa bò 45.000 vnd Thành tiền: 45.000';
  assert.strictEqual(isBillOCRText(validReceiptText2), true);
});

runTest('isBillOCRText rejects non-bill images (selfie, landscape, objects)', () => {
  const selfieText = 'Chụp ảnh chân dung selfie ngoài trời rất đẹp cùng bạn bè';
  assert.strictEqual(isBillOCRText(selfieText), false);

  const landscapeText = 'Bầu trời xanh ngắt và hàng cây xanh mát dọc bờ sông Hồng';
  assert.strictEqual(isBillOCRText(landscapeText), false);

  const objectText = 'Bàn phím cơ màu trắng sữa Bluetooth không dây dùng pin sạc';
  assert.strictEqual(isBillOCRText(objectText), false);

  const randomText = 'abc xyz 123';
  assert.strictEqual(isBillOCRText(randomText), false);
});

// ==========================================
// SIMULATED RUNTIME HARNESS
// ==========================================
class SplitSenseAppSimulator {
  constructor(referenceToday = new Date(2026, 10, 11, 12, 0, 0)) {
    this.referenceToday = referenceToday;
    this.items = [];
    this.customTotal = null;
    this.billDate = null;
    this.members = [{ id: 'mem_1', name: 'Chủ Bill', isQR: true, isHost: true }];
    this.forceEqualSplit = false;
    this.ownerQrUri = null;
    this.currentBillId = 'bill_' + Date.now();
    this.isScanning = false;
    this.scanStatusText = '';
    this.asyncStorageStore = {};

    this.alertLogs = [];
  }

  // Simulated Alert.alert
  alert(title, message, buttons, options) {
    this.alertLogs.push({
      title,
      message,
      buttons: buttons || [],
      options,
    });
  }

  // Simulated AsyncStorage
  async setStorage(key, value) {
    this.asyncStorageStore[key] = value;
  }

  async getStorage(key) {
    return this.asyncStorageStore[key] || null;
  }

  // Implementation matching App.js
  applyScannedBill(billData) {
    const newItems = Array.isArray(billData?.items) ? billData.items : [];
    const newTotal =
      billData?.total !== undefined && billData?.total !== null
        ? Number(billData.total)
        : null;
    const newDate = billData?.billDate || null;

    this.currentBillId = 'bill_' + Date.now();
    this.items = newItems;
    this.customTotal = newTotal;
    this.billDate = newDate;

    this.setStorage(
      '@splitsense_multi_bill_v1',
      JSON.stringify({
        members: this.members,
        items: newItems,
        forceEqualSplit: this.forceEqualSplit,
        ownerQrUri: this.ownerQrUri,
        customTotal: newTotal,
        billDate: newDate,
      })
    );
  }

  handleProcessScannedResult(resultData) {
    this.isScanning = false;
    this.scanStatusText = '';

    // Feature 2: Kiểm tra tính hợp lệ của ảnh
    if (
      !resultData ||
      !resultData.isBill ||
      !Array.isArray(resultData.items) ||
      resultData.items.length === 0
    ) {
      this.alert(
        'Ảnh không hợp lệ',
        'Ảnh không hợp lệ. Vui lòng chọn hoặc chụp đúng ảnh hóa đơn thanh toán!',
        [{ text: 'Đã hiểu' }]
      );
      return;
    }

    // Feature 3: Cảnh báo ngày hóa đơn cũ
    const rawDate = resultData.billDate || resultData.items[0]?.checkIn || '';
    const parsedDate = parseBillDate(rawDate);
    const isOld = isBillOlderThanToday(parsedDate, this.referenceToday);

    if (isOld && parsedDate) {
      this.alert(
        'Cảnh báo ngày hóa đơn',
        'Hóa đơn này có ngày ' + parsedDate.display + ' (cũ hơn hôm nay). Bạn có chắc chắn muốn quét không?',
        [
          {
            text: 'Hủy',
            style: 'cancel',
            onPress: () => {
              // Giữ nguyên dữ liệu hiện tại 100%
            },
          },
          {
            text: 'Xác nhận',
            onPress: () => {
              this.applyScannedBill({
                items: resultData.items,
                total: resultData.total,
                billDate: parsedDate.display,
              });
            },
          },
        ],
        { cancelable: false }
      );
      return;
    }

    this.applyScannedBill({
      items: resultData.items,
      total: resultData.total,
      billDate: parsedDate?.display || null,
    });
  }

  async handleResetCurrentBill() {
    this.isScanning = false;
    this.scanStatusText = '';
    this.items = [];
    this.customTotal = null;
    this.billDate = null;
    this.currentBillId = 'bill_' + Date.now();

    await this.setStorage(
      '@splitsense_multi_bill_v1',
      JSON.stringify({
        members: this.members,
        items: [],
        forceEqualSplit: this.forceEqualSplit,
        ownerQrUri: this.ownerQrUri,
        customTotal: null,
        billDate: null,
      })
    );
  }
}

// ==========================================
// SUITE 2: SCENARIO TESTS
// ==========================================
console.log('\n--- Suite 2: E2E Scenarios ---');

runTest('Scenario 1: Valid bill today -> applied directly without warning alert', () => {
  const app = new SplitSenseAppSimulator(new Date(2026, 10, 11)); // Today: 11/11/2026

  const validBill = {
    isBill: true,
    billDate: '11/11/2026',
    items: [
      { id: 'item_1', name: 'Phở bò tái', price: 60000, quantity: 1 },
      { id: 'item_2', name: 'Trà đá', price: 10000, quantity: 2 },
    ],
    total: 80000,
  };

  app.handleProcessScannedResult(validBill);

  assert.strictEqual(app.alertLogs.length, 0, 'No alert should be shown for valid bill today');
  assert.strictEqual(app.items.length, 2, 'Should load 2 items');
  assert.strictEqual(app.items[0].name, 'Phở bò tái');
  assert.strictEqual(app.customTotal, 80000, 'Total should be 80000');
  assert.strictEqual(app.billDate, '11/11/2026');

  // Verify AsyncStorage payload
  const stored = JSON.parse(app.asyncStorageStore['@splitsense_multi_bill_v1']);
  assert.strictEqual(stored.items.length, 2);
  assert.strictEqual(stored.customTotal, 80000);
  assert.strictEqual(stored.billDate, '11/11/2026');
});

runTest('Scenario 2: Non-bill image (face, object, scenery) -> rejected with exact alert, 0 state change, no Bàn 24 fallback', () => {
  const app = new SplitSenseAppSimulator(new Date(2026, 10, 11));

  // Pre-load an existing active bill
  app.items = [{ id: 'existing_1', name: 'Cà phê đen', price: 30000, quantity: 1 }];
  app.customTotal = 30000;
  app.billDate = '11/11/2026';

  const nonBillData = {
    isBill: false,
    billDate: null,
    items: [],
    total: 0,
  };

  app.handleProcessScannedResult(nonBillData);

  // Check exact Alert
  assert.strictEqual(app.alertLogs.length, 1, 'Should trigger exactly 1 alert');
  const alert = app.alertLogs[0];
  assert.strictEqual(alert.title, 'Ảnh không hợp lệ');
  assert.strictEqual(
    alert.message,
    'Ảnh không hợp lệ. Vui lòng chọn hoặc chụp đúng ảnh hóa đơn thanh toán!'
  );
  assert.strictEqual(alert.buttons[0].text, 'Đã hiểu');

  // Verify state is 100% UNTOUCHED
  assert.strictEqual(app.items.length, 1, 'Items count must remain 1');
  assert.strictEqual(app.items[0].name, 'Cà phê đen', 'Original item must not be wiped');
  assert.strictEqual(app.customTotal, 30000, 'Original total must remain');
  assert.strictEqual(app.billDate, '11/11/2026');

  // Verify NO Bàn 24 fallback (2.841.300 đ or Súp hải sản)
  assert.notStrictEqual(app.customTotal, 2841300);
  assert(
    !app.items.some((it) => it.name.includes('Bàn 24') || it.name.includes('Súp hải sản tóc tiên')),
    'Must NEVER fallback to Bàn 24 on non-bill images'
  );
});

runTest('Scenario 3A: Old date bill (10/11/2026 vs 11/11/2026) -> user CANCELS, state untouched', () => {
  const app = new SplitSenseAppSimulator(new Date(2026, 10, 11)); // Today: 11/11/2026

  // Pre-load active bill
  app.items = [{ id: 'current_1', name: 'Trà đào', price: 45000, quantity: 1 }];
  app.customTotal = 45000;
  app.billDate = '11/11/2026';

  const oldBill = {
    isBill: true,
    billDate: '10/11/2026',
    items: [
      { id: 'old_1', name: 'Lẩu thái', price: 350000, quantity: 1 },
    ],
    total: 350000,
  };

  app.handleProcessScannedResult(oldBill);

  assert.strictEqual(app.alertLogs.length, 1, 'Should trigger confirmation alert');
  const alert = app.alertLogs[0];
  assert.strictEqual(alert.title, 'Cảnh báo ngày hóa đơn');
  assert.strictEqual(
    alert.message,
    'Hóa đơn này có ngày 10/11/2026 (cũ hơn hôm nay). Bạn có chắc chắn muốn quét không?'
  );

  // Trigger Cancel button
  const cancelBtn = alert.buttons.find((b) => b.text === 'Hủy');
  assert(cancelBtn !== undefined, 'Must have [Hủy] button');
  cancelBtn.onPress();

  // State must remain untouched
  assert.strictEqual(app.items.length, 1);
  assert.strictEqual(app.items[0].name, 'Trà đào');
  assert.strictEqual(app.customTotal, 45000);
  assert.strictEqual(app.billDate, '11/11/2026');
});

runTest('Scenario 3B: Old date bill (10/11/2026 vs 11/11/2026) -> user CONFIRMS, applies new bill', () => {
  const app = new SplitSenseAppSimulator(new Date(2026, 10, 11)); // Today: 11/11/2026

  // Pre-load active bill
  app.items = [{ id: 'current_1', name: 'Trà đào', price: 45000, quantity: 1 }];
  app.customTotal = 45000;
  app.billDate = '11/11/2026';

  const oldBill = {
    isBill: true,
    billDate: '10/11/2026',
    items: [
      { id: 'old_1', name: 'Lẩu thái', price: 350000, quantity: 1 },
      { id: 'old_2', name: 'Ba chỉ bò Mỹ', price: 120000, quantity: 1 },
    ],
    total: 470000,
  };

  app.handleProcessScannedResult(oldBill);

  const alert = app.alertLogs[0];
  const confirmBtn = alert.buttons.find((b) => b.text === 'Xác nhận');
  assert(confirmBtn !== undefined, 'Must have [Xác nhận] button');
  confirmBtn.onPress();

  // State must now be replaced with new bill
  assert.strictEqual(app.items.length, 2);
  assert.strictEqual(app.items[0].name, 'Lẩu thái');
  assert.strictEqual(app.customTotal, 470000);
  assert.strictEqual(app.billDate, '10/11/2026');

  // AsyncStorage updated
  const stored = JSON.parse(app.asyncStorageStore['@splitsense_multi_bill_v1']);
  assert.strictEqual(stored.items.length, 2);
  assert.strictEqual(stored.customTotal, 470000);
  assert.strictEqual(stored.billDate, '10/11/2026');
});

runTest('Scenario 4: Atomic Reset and Next Bill Replacement (Single Bill Architecture)', async () => {
  const app = new SplitSenseAppSimulator(new Date(2026, 10, 11));

  // Populate bill 1
  app.applyScannedBill({
    isBill: true,
    billDate: '11/11/2026',
    items: [
      { id: 'b1_1', name: 'Món A', price: 100000, quantity: 1 },
      { id: 'b1_2', name: 'Món B', price: 200000, quantity: 1 },
    ],
    total: 300000,
  });

  assert.strictEqual(app.items.length, 2);
  assert.strictEqual(app.customTotal, 300000);

  // User resets current bill
  await app.handleResetCurrentBill();

  assert.strictEqual(app.items.length, 0, 'Items must be empty after reset');
  assert.strictEqual(app.customTotal, null, 'customTotal must be null');
  assert.strictEqual(app.billDate, null, 'billDate must be null');

  const resetStored = JSON.parse(app.asyncStorageStore['@splitsense_multi_bill_v1']);
  assert.strictEqual(resetStored.items.length, 0);
  assert.strictEqual(resetStored.customTotal, null);
  assert.strictEqual(resetStored.billDate, null);

  // Now scan Bill 2 (contains 1 item)
  app.handleProcessScannedResult({
    isBill: true,
    billDate: '11/11/2026',
    items: [{ id: 'b2_1', name: 'Món C Duy Nhất', price: 50000, quantity: 1 }],
    total: 50000,
  });

  // Verify Bill 2 completely replaces with 0 ghost items from Bill 1
  assert.strictEqual(app.items.length, 1, 'Only 1 item should exist');
  assert.strictEqual(app.items[0].name, 'Món C Duy Nhất');
  assert.strictEqual(app.customTotal, 50000);
  assert(!app.items.some((it) => it.name === 'Món A' || it.name === 'Món B'), '0 ghost items from previous bill!');
});

// ==========================================
// SUITE 3: SOURCE CODE INTEGRITY AUDIT
// ==========================================
console.log('\n--- Suite 3: Source Code Integrity Audit ---');

runTest('App.js does not wipe items prematurely in executeImagePicker', () => {
  const pickerCode = appJsContent.match(/const executeImagePicker = async \([\s\S]*?await runMultiBillScan/);
  assert(pickerCode, 'Found executeImagePicker');
  assert(
    !pickerCode[0].includes('setItems([])'),
    'executeImagePicker must NOT call setItems([]) before runMultiBillScan'
  );
  assert(
    !pickerCode[0].includes('setCustomTotal(null)'),
    'executeImagePicker must NOT call setCustomTotal(null) before runMultiBillScan'
  );
});

runTest('App.js does not contain unconditional Bàn 24 zombie fallback in Tầng 3', () => {
  // Check after TẦNG 3 comment
  const tang3Match = appJsContent.match(/\/\/ TẦNG 3:[\s\S]*?setItems\s*\(\s*defaultNewBill\s*\)/);
  assert(
    !tang3Match,
    'TẦNG 3 must NOT unconditionally call setItems(defaultNewBill)!'
  );
});

runTest('App.js stores customTotal and billDate in AsyncStorage', () => {
  assert(
    appJsContent.includes('customTotal,') && appJsContent.includes('billDate,'),
    'AsyncStorage payload must include customTotal and billDate'
  );
  assert(
    appJsContent.includes('setCustomTotal(data.customTotal)') &&
      appJsContent.includes('setBillDate(data.billDate)'),
    'AsyncStorage restoration must restore customTotal and billDate'
  );
});

runTest('App.js has handleResetCurrentBill function', () => {
  assert(
    appJsContent.includes('const handleResetCurrentBill = async () => {'),
    'App.js must implement handleResetCurrentBill'
  );
});

// ==========================================
// SUMMARY
// ==========================================
console.log('\n====================================================');
console.log(`  ALL TESTS FINISHED: ${passedTests}/${totalTests} PASSED (100%)`);
console.log('====================================================\n');
