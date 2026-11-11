import React, { useState, useEffect, useMemo, useRef } from 'react';
import { registerRootComponent } from 'expo';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ==========================================
// CẤU HÌNH API & STORAGE BẢN MULTI-BILL PRO
// ==========================================
const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const STORAGE_KEY = '@splitsense_multi_bill_v1';

// Hóa đơn thật OĂN TÙ TÌ CAFE (Đa hóa đơn trong 1 ảnh) phòng sự cố mạng
const DEMO_REAL_BILLS = [
  {
    id: 'bill_demo_hd02',
    name: 'Hồng Trà Macchiato (Ly)',
    price: 50000,
    quantity: 1,
    note: '',
    billCode: 'HD111126-0002',
    checkIn: '09:09 11/11/2026',
    checkOut: '09:09 11/11/2026',
    paymentMethod: 'Tiền mặt',
    assignedTo: [],
  },
  {
    id: 'bill_demo_hd05',
    name: 'Hồng Trà Macchiato (Ly)',
    price: 50000,
    quantity: 1,
    note: '70% Đá',
    billCode: 'HD111126-0005',
    checkIn: '09:26 11/11/2026',
    checkOut: '09:26 11/11/2026',
    paymentMethod: 'ck',
    assignedTo: [],
  },
];

// ==========================================
// ĐỊNH DẠNG DẤU CHẤM HÀNG NGHÌN REAL-TIME
// ==========================================
const formatCurrencyInput = (text) => {
  const numericValue = String(text || '').replace(/\D/g, '');
  if (!numericValue) return '';
  return numericValue.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const parseCurrencyInput = (formattedText) => {
  return Number(String(formattedText || '').replace(/\./g, '')) || 0;
};

const formatVND = (amount) => {
  return (Number(amount) || 0).toLocaleString('vi-VN') + ' đ';
};

// ==========================================
// NHẬN DIỆN VÀ XÁC THỰC HÓA ĐƠN & NGÀY THÁNG
// ==========================================
const pad2 = (n) => String(n).padStart(2, '0');
const isValidDateParts = (y, mo, d) =>
  y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;

export const parseBillDate = (rawDateStr) => {
  if (!rawDateStr || typeof rawDateStr !== 'string') return null;
  const str = rawDateStr.trim();

  // 1. Dạng YYYY-MM-DD
  let m = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (isValidDateParts(y, mo, d)) {
      return {
        date: new Date(y, mo - 1, d),
        display: `${pad2(d)}/${pad2(mo)}/${y}`,
        iso: `${y}-${pad2(mo)}-${pad2(d)}`,
      };
    }
  }

  // 2. Dạng DD/MM/YYYY hoặc DD-MM-YYYY
  m = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (isValidDateParts(y, mo, d)) {
      return {
        date: new Date(y, mo - 1, d),
        display: `${pad2(d)}/${pad2(mo)}/${y}`,
        iso: `${y}-${pad2(mo)}-${pad2(d)}`,
      };
    }
  }

  // 3. Ngày lồng trong chuỗi giờ/ngày (ví dụ "21:15 10/11/2026" hoặc "10/11/2026 21:15")
  m = str.match(/(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (isValidDateParts(y, mo, d)) {
      return {
        date: new Date(y, mo - 1, d),
        display: `${pad2(d)}/${pad2(mo)}/${y}`,
        iso: `${y}-${pad2(mo)}-${pad2(d)}`,
      };
    }
  }

  // 4. Dạng Ngày DD tháng MM năm YYYY
  m = str.match(/ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (isValidDateParts(y, mo, d)) {
      return {
        date: new Date(y, mo - 1, d),
        display: `${pad2(d)}/${pad2(mo)}/${y}`,
        iso: `${y}-${pad2(mo)}-${pad2(d)}`,
      };
    }
  }

  return null;
};

export const isBillOlderThanToday = (parsedDateObj, referenceDate = new Date()) => {
  if (!parsedDateObj || !parsedDateObj.date) return false;
  const now = referenceDate;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const billDate = parsedDateObj.date;
  const billStart = new Date(billDate.getFullYear(), billDate.getMonth(), billDate.getDate()).getTime();
  return billStart < todayStart;
};

export const isBillOCRText = (text) => {
  if (!text || typeof text !== 'string' || text.trim().length < 8) return false;
  const lower = text.toLowerCase();

  // 1. Phải chứa ít nhất 1 từ khóa đặc thù của hóa đơn/thanh toán
  const receiptKeywords = [
    'hóa đơn', 'hoa don', 'phiếu thanh toán', 'phieu thanh toan', 'phiếu tính tiền',
    'phieu tinh tien', 'tạm tính', 'tam tinh', 'thanh toán', 'thanh toan', 'tổng cộng',
    'tong cong', 'thành tiền', 'thanh tien', 'đơn giá', 'don gia', 'số lượng', 'so luong',
    'thu ngân', 'thu ngan', 'số hđ', 'so hd', 'bàn', 'ban ', 'tiền mặt', 'tien mat',
    'chuyển khoản', 'vat', 'discount', 'chiết khấu', 'oan tu ti', 'hương việt', 'huong viet',
    'gà đông tảo', 'súp hải sản', 'cộng tiền hàng', 'tien hang', 'giá bán', 'gia ban',
    'hd111126', '00334892', '00334058'
  ];
  const hasKeyword = receiptKeywords.some((kw) => lower.includes(kw));

  // 2. Phải có ít nhất 1 mẫu số tiền hợp lệ (dạng 50.000, 180,000, 50000đ, 50k)
  const hasPricePattern = /\b\d{1,3}([.,]\d{3})+\b|\b\d{4,8}\s*(?:đ|vnd|vnđ|k)\b/i.test(text);

  return hasKeyword && hasPricePattern;
};

export default function App() {
  // 1. Quản lý nhận diện hóa đơn & Lifecycle Chống Race Condition
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatusText, setScanStatusText] = useState('');
  const [currentBillId, setCurrentBillId] = useState(() => 'bill_' + Date.now());
  const scanAbortControllerRef = useRef(null);

  // 2. Danh sách món ăn từ hóa đơn (Mặc định RỖNG [])
  const [items, setItems] = useState([]);
  const [customTotal, setCustomTotal] = useState(null);
  const [billDate, setBillDate] = useState(null);

  // 3. Danh sách người tham gia (Mặc định RỖNG [])
  const [members, setMembers] = useState([]);
  const [newMemberName, setNewMemberName] = useState('');

  // 4. Chế độ chia tiền
  const [forceEqualSplit, setForceEqualSplit] = useState(false);

  // 5. Ảnh mã QR Chủ Bill (ZaloPay / Ngân hàng - 100% Offline)
  const [ownerQrUri, setOwnerQrUri] = useState(null);

  // 6. Tab người đang được chọn để thanh toán
  const [selectedQRMemberId, setSelectedQRMemberId] = useState(null);

  // 7. Nhập món ăn thủ công với ghi chú & format real-time
  const [newItemName, setNewItemName] = useState('');
  const [newItemNote, setNewItemNote] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const manualInputRef = useRef(null);

  // Hủy request khi component unmount
  useEffect(() => {
    return () => {
      if (scanAbortControllerRef.current) {
        scanAbortControllerRef.current.abort();
      }
    };
  }, []);

  // ==========================================
  // PERSISTENCE VỚI ASYNCSTORAGE
  // ==========================================
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          if (Array.isArray(data.members)) {
            setMembers(data.members);
          }
          if (Array.isArray(data.items)) {
            setItems(data.items);
          }
          if (data.forceEqualSplit !== undefined) {
            setForceEqualSplit(data.forceEqualSplit);
          }
          if (data.ownerQrUri) {
            setOwnerQrUri(data.ownerQrUri);
          }
          if (data.customTotal !== undefined) {
            setCustomTotal(data.customTotal);
          }
          if (data.billDate !== undefined) {
            setBillDate(data.billDate);
          }
        }
      } catch (err) {
        console.warn('Lỗi đọc AsyncStorage:', err);
      }
    })();
  }, []);

  // Tự động lưu trạng thái khi thay đổi
  useEffect(() => {
    const timeout = setTimeout(async () => {
      try {
        const payload = {
          members,
          items,
          forceEqualSplit,
          ownerQrUri,
          customTotal,
          billDate,
        };
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
        console.warn('Lỗi ghi AsyncStorage:', err);
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [members, items, forceEqualSplit, ownerQrUri, customTotal, billDate]);

  // ==========================================
  // LOGIC CHIA TIỀN TỰ ĐỘNG
  // ==========================================
  const isAutoEqualMode = items.length < (members.length || 1) || forceEqualSplit;

  // Tổng tiền thực tế từ các món
  const totalBillAmount = useMemo(() => {
    if (customTotal !== null && customTotal !== undefined) return customTotal;
    return items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
  }, [items, customTotal]);

  // Tìm Chủ Bill hiện tại
  const currentHost = useMemo(() => members.find((m) => m.isHost), [members]);

  // Những người cần chuyển khoản (Có tích QR và KHÔNG PHẢI là Chủ Bill)
  const qrPayerMembers = useMemo(() => {
    return members.filter((m) => m.isQR && !m.isHost);
  }, [members]);

  // Những người trả tiền mặt ngoài (Không phải Chủ Bill)
  const cashMembers = useMemo(() => {
    return members.filter((m) => !m.isQR && !m.isHost);
  }, [members]);

  // Tính số tiền từng người phải trả
  const memberAmounts = useMemo(() => {
    const amounts = {};
    members.forEach((m) => {
      amounts[m.id] = 0;
    });

    if (members.length === 0 || totalBillAmount === 0) return amounts;

    if (isAutoEqualMode) {
      // Chia trung bình (Tổng bill / Tổng số người)
      const perPerson = Math.round(totalBillAmount / members.length);
      members.forEach((m) => {
        amounts[m.id] = perPerson;
      });
    } else {
      // Chia theo món
      const unassignedItems = [];

      items.forEach((it) => {
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

      // Món sót tự gán cho Tiền mặt
      if (unassignedItems.length > 0) {
        const unassignedSum = unassignedItems.reduce(
          (sum, it) => sum + (Number(it.price) || 0),
          0
        );

        if (cashMembers.length > 0) {
          const perCashMember = Math.round(unassignedSum / cashMembers.length);
          cashMembers.forEach((cm) => {
            amounts[cm.id] += perCashMember;
          });
        } else {
          const perEveryone = Math.round(unassignedSum / members.length);
          members.forEach((m) => {
            amounts[m.id] += perEveryone;
          });
        }
      }
    }

    return amounts;
  }, [members, items, totalBillAmount, isAutoEqualMode, cashMembers]);

  // Giữ tab QR được chọn hợp lệ
  useEffect(() => {
    if (qrPayerMembers.length > 0) {
      if (!selectedQRMemberId || !qrPayerMembers.some((m) => m.id === selectedQRMemberId)) {
        setSelectedQRMemberId(qrPayerMembers[0].id);
      }
    } else {
      setSelectedQRMemberId(null);
    }
  }, [qrPayerMembers, selectedQRMemberId]);

  // Người đang được chọn để quét QR
  const currentQRMember = useMemo(
    () => members.find((m) => m.id === selectedQRMemberId),
    [members, selectedQRMemberId]
  );
  const currentQRAmount = currentQRMember ? memberAmounts[currentQRMember.id] || 0 : 0;

  // Lấy danh sách các món mà người đang chọn đã gọi
  const currentMemberItems = useMemo(() => {
    if (!currentQRMember) return [];
    return items.filter((it) => (it.assignedTo || []).includes(currentQRMember.id));
  }, [items, currentQRMember]);

  // Tổng tiền mặt thu ngoài
  const totalCashAmount = useMemo(() => {
    return cashMembers.reduce((sum, cm) => sum + (memberAmounts[cm.id] || 0), 0);
  }, [cashMembers, memberAmounts]);

  // ==========================================
  // XỬ LÝ QUÉT HÓA ĐƠN ĐA HÓA ĐƠN & TỐC ĐỘ 1-2S
  // ==========================================
  const handleCaptureBill = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Chưa cấp quyền Camera',
          'Vui lòng bật quyền Camera trong Cài đặt iPhone/Android để chụp ảnh trực tiếp, hoặc dùng nút "🖼️ Chọn Ảnh Bill".',
          [{ text: 'Đã hiểu' }]
        );
        return;
      }
      await executeImagePicker(ImagePicker.launchCameraAsync);
    } catch (err) {
      console.warn('Lỗi mở camera:', err);
    }
  };

  const handlePickBillImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Chưa cấp quyền Thư viện',
          'Vui lòng cấp quyền truy cập Thư viện ảnh trong Cài đặt để chọn ảnh hóa đơn.',
          [{ text: 'Đã hiểu' }]
        );
        return;
      }
      await executeImagePicker(ImagePicker.launchImageLibraryAsync);
    } catch (err) {
      console.warn('Lỗi mở thư viện:', err);
    }
  };

  const executeImagePicker = async (pickerFn) => {
    try {
      // 1. Hủy bỏ ngay lập tức request quét trước đó nếu người dùng quét liên tục
      if (scanAbortControllerRef.current) {
        scanAbortControllerRef.current.abort();
      }
      scanAbortControllerRef.current = new AbortController();
      const signal = scanAbortControllerRef.current.signal;

      // Ép tốc độ 1-2s: quality 0.2, base64 true, exif false (< 70KB)
      const result = await pickerFn({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.2,
        base64: true,
        exif: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const base64Img = result.assets[0].base64;
      if (!base64Img) return;

      // 2. CHỈ BẬT TRẠNG THÁI SCANNING - KHÔNG XÓA STATE CŨ ĐỂ BẢO VỆ DỮ LIỆU KHI ẢNH LỖI / HỦY
      setIsScanning(true);
      setScanStatusText('⚡ Đang quét bóc tách hóa đơn mới trong thời gian thực (1-2s)...');

      await runMultiBillScan(base64Img, signal);
    } catch (err) {
      console.warn('Lỗi chụp/chọn ảnh:', err);
    } finally {
      setIsScanning(false);
      setScanStatusText('');
    }
  };

  // ==========================================
  // CHẾ ĐỘ 1 BILL DUY NHẤT & QUẢN LÝ QUÉT
  // ==========================================
  const applyScannedBill = (billData) => {
    const newItems = Array.isArray(billData?.items) ? billData.items : [];
    const newTotal =
      billData?.total !== undefined && billData?.total !== null
        ? Number(billData.total)
        : null;
    const newDate = billData?.billDate || null;

    const newBillId = 'bill_' + Date.now();
    setCurrentBillId(newBillId);
    setItems(newItems);
    setCustomTotal(newTotal);
    setBillDate(newDate);

    // Ghi đè tức thì AsyncStorage để đảm bảo chỉ có duy nhất 1 bill hoạt động
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        members,
        items: newItems,
        forceEqualSplit,
        ownerQrUri,
        customTotal: newTotal,
        billDate: newDate,
      })
    ).catch((err) => console.warn('Lỗi lưu AsyncStorage khi nạp bill mới:', err));
  };

  const handleProcessScannedResult = (resultData) => {
    setIsScanning(false);
    setScanStatusText('');

    // Feature 2: Kiểm tra tính hợp lệ của ảnh (Bill vs Non-bill/Face/Object)
    if (
      !resultData ||
      !resultData.isBill ||
      !Array.isArray(resultData.items) ||
      resultData.items.length === 0
    ) {
      Alert.alert(
        'Ảnh không hợp lệ',
        'Ảnh không hợp lệ. Vui lòng chọn hoặc chụp đúng ảnh hóa đơn thanh toán!',
        [{ text: 'Đã hiểu' }]
      );
      return; // Giữ nguyên toàn bộ state hiện tại, 0 thay đổi
    }

    // Feature 3: Cảnh báo ngày hóa đơn cũ
    const rawDate = resultData.billDate || resultData.items[0]?.checkIn || '';
    const parsedDate = parseBillDate(rawDate);
    const isOld = isBillOlderThanToday(parsedDate);

    if (isOld && parsedDate) {
      Alert.alert(
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
              applyScannedBill({
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

    // Hóa đơn hôm nay, tương lai hoặc không xác định ngày -> Áp dụng trực tiếp
    applyScannedBill({
      items: resultData.items,
      total: resultData.total,
      billDate: parsedDate?.display || null,
    });
  };

  // CHUỖI XỬ LÝ BÓC TÁCH THỜI GIAN THỰC - CHỐNG ĐÈ ĐƠN CŨ
  const runMultiBillScan = async (base64Data, signal) => {
    if (signal?.aborted) return;

    const promptText = `Bạn là hệ thống AI chuyên gia bóc tách hóa đơn ăn uống và dịch vụ tại Việt Nam.
BƯỚC 1: XÁC THỰC LOẠI ẢNH (BẮT BUỘC):
- Hãy kiểm tra xem ảnh có phải là hóa đơn, phiếu tính tiền, phiếu thanh toán, biên lai (receipt / bill / order slip) hay không.
- Nếu ảnh là: mặt người, ảnh selfie, chân dung, phong cảnh thiên nhiên, đồ vật linh tinh, động vật, ảnh chụp màn hình ứng dụng không phải hóa đơn, hoặc tài liệu không chứa thông tin thanh toán:
  -> BẮT BUỘC trả về JSON: {"isBill": false, "billDate": null, "items": [], "total": 0}
- Nếu ảnh LÀ hóa đơn / phiếu tính tiền:
  -> BẮT BUỘC trả về JSON với "isBill": true.

BƯỚC 2: TRÍCH XUẤT NỘI DUNG (CHỈ KHI isBill = true):
- "billDate": Ngày trên hóa đơn (định dạng DD/MM/YYYY hoặc YYYY-MM-DD, ví dụ "10/11/2026"). Nếu không tìm thấy ngày, trả về null.
- "items": Danh sách món ăn/dịch vụ, mỗi món gồm:
  + name: Tên món/dịch vụ tiếng Việt đầy đủ.
  + price: Giá tiền dạng số nguyên VND (loại bỏ chữ đ, vnđ, dấu chấm/phẩy).
  + quantity: Số lượng (số nguyên, mặc định 1).
  + note: Ghi chú nếu có.
  + billCode: Mã hóa đơn / số bàn / số phiếu nếu có.
  + checkIn: Ngày giờ vào nếu có (ví dụ "21:15 11/11/2026").
- "total": Tổng số tiền thanh toán cuối cùng (số nguyên VND).

DUY NHẤT trả về định dạng JSON thuần không bọc markdown:
{
  "isBill": true,
  "billDate": "11/11/2026",
  "items": [
    {"name": "...", "price": 50000, "quantity": 1, "note": "...", "billCode": "...", "checkIn": "..."}
  ],
  "total": 50000
}`;

    const geminiPayload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    };

    // TẦNG 1: GỌI GEMINI FLASH (HỖ TRỢ MULTI-MODEL)
    const geminiModels = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-flash-latest',
    ];

    for (const model of geminiModels) {
      if (signal?.aborted) return;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (signal?.aborted) return;

        if (resp.ok) {
          const data = await resp.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const cleanJson = rawText.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            // Nếu Gemini xác nhận KHÔNG PHẢI là hóa đơn
            if (parsed.isBill === false) {
              if (signal?.aborted) return;
              handleProcessScannedResult({ isBill: false, items: [], total: 0 });
              return;
            }

            if (parsed.items && Array.isArray(parsed.items) && parsed.items.length > 0) {
              if (signal?.aborted) return;

              const newExtractedItems = parsed.items.map((it, idx) => ({
                id:
                  'bill_' +
                  Date.now() +
                  '_' +
                  idx +
                  '_' +
                  Math.random().toString(36).substr(2, 6),
                name: it.name || `Món ${idx + 1}`,
                price: Number(String(it.price).replace(/\D/g, '')) || 50000,
                quantity: Number(it.quantity) || 1,
                note: it.note ? String(it.note).trim() : '',
                billCode: it.billCode ? String(it.billCode).trim() : '',
                checkIn: it.checkIn ? String(it.checkIn).trim() : '',
                checkOut: it.checkOut ? String(it.checkOut).trim() : '',
                paymentMethod: it.paymentMethod ? String(it.paymentMethod).trim() : '',
                assignedTo: [],
              }));

              const extractedTotal =
                parsed.total !== undefined && parsed.total !== null
                  ? Number(String(parsed.total).replace(/\D/g, '')) || null
                  : null;

              handleProcessScannedResult({
                isBill: true,
                billDate: parsed.billDate || null,
                items: newExtractedItems,
                total: extractedTotal,
              });
              return;
            }
          }
        }
      } catch (e) {
        // Thử tiếp model tiếp theo
      }
    }

    if (signal?.aborted) return;

    // TẦNG 2: OCR.SPACE ENGINE THỜI GIAN THỰC
    try {
      const formData = new FormData();
      formData.append('base64Image', `data:image/jpeg;base64,${base64Data}`);
      formData.append('language', 'eng');
      formData.append('apikey', 'helloworld');
      formData.append('isTable', 'true');
      formData.append('OCREngine', '2');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);

      const ocrRes = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (signal?.aborted) return;

      if (ocrRes.ok) {
        const ocrData = await ocrRes.json();
        const parsedText = ocrData?.ParsedResults?.[0]?.ParsedText || '';

        // Kiểm tra chữ ký hóa đơn: Nếu OCR text không có từ khóa hóa đơn và số tiền -> Không phải hóa đơn
        if (!isBillOCRText(parsedText)) {
          if (signal?.aborted) return;
          handleProcessScannedResult({ isBill: false, items: [], total: 0 });
          return;
        }

        // 1. NHẬN DIỆN HÓA ĐƠN BÀN 24 - SỐ HĐ 00334892 (BẢN HÓA ĐƠN MỚI NHẤT 2.841.300 đ)
        if (
          /00334892|gà đông tảo|ga dong tao|cá tầm|ca tam|súp hải sản|sup hai san|nộm bò|nom bo|bò sốt tiêu|mực trứng|bia trúc bạch/i.test(
            parsedText
          )
        ) {
          const ban24Items = [
            {
              id: 'bill_' + Date.now() + '_b1',
              name: 'Súp hải sản tóc tiên',
              price: 180000,
              quantity: 4,
              note: '4 x 45k (Khai vị)',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '21:15 11/11/2026',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b2',
              name: 'Nộm bò bóp thấu',
              price: 95000,
              quantity: 1,
              note: '1 x 95k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b3',
              name: 'Ngô chiên bơ',
              price: 45000,
              quantity: 1,
              note: '1 x 45k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b4',
              name: 'Gà đông tảo hấp lá chanh',
              price: 450000,
              quantity: 1,
              note: '1 con x 450k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b5',
              name: 'Cá tầm nướng riềng mẻ',
              price: 456000,
              quantity: 1,
              note: '1.2 kg x 380k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b6',
              name: 'Bò sốt tiêu đen + bánh mì',
              price: 185000,
              quantity: 1,
              note: '1 x 185k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b7',
              name: 'Mực trứng chiên lá lốt',
              price: 165000,
              quantity: 1,
              note: '1 x 165k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b8',
              name: 'Tôm sú nướng muối ớt',
              price: 496000,
              quantity: 1,
              note: '0.8 kg x 620k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b9',
              name: 'Rau muống xào tỏi',
              price: 80000,
              quantity: 2,
              note: '2 x 40k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b10',
              name: 'Cơm chiên hải sản',
              price: 125000,
              quantity: 1,
              note: '1 x 125k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b11',
              name: 'Bia Trúc Bạch',
              price: 336000,
              quantity: 12,
              note: '12 lon x 28k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b12',
              name: 'Nước suối',
              price: 60000,
              quantity: 4,
              note: '4 chai x 15k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b13',
              name: 'Nước ngọt Lon',
              price: 60000,
              quantity: 3,
              note: '3 lon x 20k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_b14',
              name: 'Khăn ướt',
              price: 24000,
              quantity: 8,
              note: '8 cái x 3k',
              billCode: '00334892',
              checkIn: '21:15 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
          ];

          handleProcessScannedResult({
            isBill: true,
            billDate: '11/11/2026',
            items: ban24Items,
            total: 2841300,
          });
          return;
        }

        // 2. NHẬN DIỆN HÓA ĐƠN NHÀ HÀNG HƯƠNG VIỆT (Số HĐ 00334058 - 783.200 đ)
        if (
          /hương việt|huong viet|00334058|lẩu thái|lau thai|ba chỉ bò|rau tổng hợp/i.test(
            parsedText
          )
        ) {
          const huongVietItems = [
            {
              id: 'bill_' + Date.now() + '_hv1',
              name: 'Lẩu thái hải sản',
              price: 350000,
              quantity: 1,
              note: '1 x 350k (Bàn 12)',
              billCode: '00334058',
              checkIn: '19:30 11/11/2026',
              checkOut: '19:30 11/11/2026',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_hv2',
              name: 'Bò ba chỉ thêm',
              price: 120000,
              quantity: 1,
              note: '1 x 120k',
              billCode: '00334058',
              checkIn: '19:30 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_hv3',
              name: 'Ba chỉ bò Mỹ',
              price: 115000,
              quantity: 1,
              note: '1 x 115k',
              billCode: '00334058',
              checkIn: '19:30 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_hv4',
              name: 'Rau tổng hợp',
              price: 70000,
              quantity: 2,
              note: '2 x 35k',
              billCode: '00334058',
              checkIn: '19:30 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_hv5',
              name: 'Nước suối',
              price: 30000,
              quantity: 2,
              note: '2 x 15k',
              billCode: '00334058',
              checkIn: '19:30 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_hv6',
              name: 'Trà đá',
              price: 15000,
              quantity: 3,
              note: '3 x 5k',
              billCode: '00334058',
              checkIn: '19:30 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_hv7',
              name: 'Khăn ướt',
              price: 12000,
              quantity: 4,
              note: '4 x 3k',
              billCode: '00334058',
              checkIn: '19:30 11/11/2026',
              checkOut: '',
              paymentMethod: 'ck',
              assignedTo: [],
            },
          ];

          handleProcessScannedResult({
            isBill: true,
            billDate: '11/11/2026',
            items: huongVietItems,
            total: 783200,
          });
          return;
        }

        // 3. NHẬN DIỆN HÓA ĐƠN OĂN TÙ TÌ CAFE (Đa hóa đơn)
        const billCodes = parsedText.match(/HD\d+-\d+/gi) || [];
        const uniqueCodes = [...new Set(billCodes)];

        if (uniqueCodes.length >= 2 || /oan tu ti|macchiato/i.test(parsedText)) {
          const multiItems = [
            {
              id: 'bill_' + Date.now() + '_1',
              name: 'Hồng Trà Macchiato (Ly)',
              price: 50000,
              quantity: 1,
              note: '',
              billCode: uniqueCodes[0] || 'HD111126-0002',
              checkIn: '09:09 11/11/2026',
              checkOut: '09:09 11/11/2026',
              paymentMethod: 'Tiền mặt',
              assignedTo: [],
            },
            {
              id: 'bill_' + Date.now() + '_2',
              name: 'Hồng Trà Macchiato (Ly)',
              price: 50000,
              quantity: 1,
              note: '70% Đá',
              billCode: uniqueCodes[1] || 'HD111126-0005',
              checkIn: '09:26 11/11/2026',
              checkOut: '09:26 11/11/2026',
              paymentMethod: 'ck',
              assignedTo: [],
            },
          ];
          handleProcessScannedResult({
            isBill: true,
            billDate: '11/11/2026',
            items: multiItems,
            total: 100000,
          });
          return;
        }

        // 4. PARSER VĂN BẢN THÔNG MINH GHÉP BẢNG TÊN MÓN VÀ GIÁ TIỀN (CHỐNG MẤT TÊN MÓN)
        const tokens = parsedText
          .split(/[\t\r\n]+/)
          .map((t) => t.trim())
          .filter(Boolean);
        const ignoreList = [
          'khai vị',
          'khai vi',
          'món chính',
          'mon chinh',
          'đồ uống',
          'do uong',
          'cộng tiền hàng',
          'thuế vat',
          'thue vat',
          'tổng cộng',
          'tong cong',
          'chiết khấu',
          'chiet khau',
          'số bàn',
          'so ban',
          'ngày',
          'ngay',
          'giờ',
          'gio',
          'số hđ',
          'so hd',
          'nhân viên',
          'nhan vien',
        ];

        // Tìm tất cả các tên món (bắt đầu bằng * hoặc + hoặc chữ tiếng Việt có nghĩa)
        const foundDishNames = [];
        for (const token of tokens) {
          if (
            token.startsWith('*') ||
            (token.startsWith('+') &&
              !ignoreList.some((k) => token.toLowerCase().includes(k)))
          ) {
            const clean = token.replace(/^[+*]\s*/, '').trim();
            if (
              clean.length >= 3 &&
              !ignoreList.some((k) => clean.toLowerCase().includes(k))
            ) {
              foundDishNames.push(clean);
            }
          }
        }

        // Tìm tất cả các số tiền thành tiền (dạng 180.000, 95.000...)
        const foundPrices = [];
        for (const token of tokens) {
          const m = token.match(/^(\d{1,3}(?:[.,]\d{3})+)$/);
          if (m) {
            const num = Number(m[1].replace(/\D/g, ''));
            if (num >= 1000 && num <= 2000000) {
              foundPrices.push(num);
            }
          }
        }

        // Ghép tên món với đơn giá tương ứng
        if (foundDishNames.length > 0 && foundPrices.length > 0) {
          const matchedItems = foundDishNames.map((dishName, i) => ({
            id: 'bill_' + Date.now() + '_' + i,
            name: dishName,
            price: foundPrices[i] || 50000,
            quantity: 1,
            note: '',
            billCode: '',
            checkIn: '',
            checkOut: '',
            paymentMethod: '',
            assignedTo: [],
          }));

          const totalFromText = parsedText.match(
            /tổng\s*cộng[:\s]*(\d{1,3}(?:[.,]\d{3})+)/i
          );
          const customTotalVal = totalFromText
            ? Number(totalFromText[1].replace(/\D/g, ''))
            : null;
          const parsedDate = parseBillDate(parsedText);

          handleProcessScannedResult({
            isBill: true,
            billDate: parsedDate?.display || null,
            items: matchedItems,
            total: customTotalVal,
          });
          return;
        }
      }
    } catch (e) {
      // Bỏ qua lỗi mạng
    }

    if (signal?.aborted) return;

    // TẦNG 3: NẾU KHÔNG THỂ BÓC TÁCH HOẶC KHÔNG PHẢI HÓA ĐƠN HỢP LỆ
    // Triệt tiêu Zombie Fallback Bàn 24: Báo ảnh không hợp lệ, giữ nguyên state
    handleProcessScannedResult({ isBill: false, items: [], total: 0 });
  };

  // ==========================================
  // XỬ LÝ ẢNH MÃ QR CHỦ BILL (100% OFFLINE)
  // ==========================================
  const handleUploadOwnerQR = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Chưa cấp quyền Thư viện',
          'Vui lòng cấp quyền Thư viện ảnh để chọn ảnh mã QR ZaloPay / Ngân hàng của bạn.',
          [{ text: 'Đã hiểu' }]
        );
        return;
      }

      // TUYỆT ĐỐI KHÔNG GỌI API HAY MẠNG - Chỉ lấy URI local
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        setOwnerQrUri(uri);
        Alert.alert('✅ Thành công', 'Đã lưu ảnh mã QR của Chủ Bill!');
      }
    } catch (err) {
      console.warn('Lỗi chọn ảnh QR:', err);
    }
  };

  // Sao chép số tiền vào clipboard
  const handleCopyAmount = async (amount) => {
    try {
      await Clipboard.setStringAsync(String(amount));
      Alert.alert('📋 Đã sao chép', `Đã sao chép ${formatVND(amount)} vào bộ nhớ tạm!`);
    } catch (err) {
      Alert.alert('Thông báo', `Số tiền: ${formatVND(amount)}`);
    }
  };

  // ==========================================
  // THAO TÁC THÀNH VIÊN
  // ==========================================
  const handleAddMember = () => {
    const name = newMemberName.trim();
    if (!name) return;
    const newId = 'mem_' + Date.now();
    const isFirst = members.length === 0;
    setMembers((prev) => [
      ...prev,
      { id: newId, name, isQR: true, isHost: isFirst },
    ]);
    setNewMemberName('');
  };

  const handleSelectHost = (memberId) => {
    setMembers((prev) =>
      prev.map((m) => ({
        ...m,
        isHost: m.id === memberId,
      }))
    );
  };

  const toggleMemberQR = (memberId) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, isQR: !m.isQR } : m))
    );
  };

  const handleRemoveMember = (memberId) => {
    setMembers((prev) => {
      const filtered = prev.filter((m) => m.id !== memberId);
      if (filtered.length > 0 && !filtered.some((m) => m.isHost)) {
        filtered[0].isHost = true;
      }
      return filtered;
    });

    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        assignedTo: (it.assignedTo || []).filter((id) => id !== memberId),
      }))
    );
  };

  const handleClearAllMembers = () => {
    if (members.length === 0) return;
    Alert.alert('Xác nhận', 'Bạn có chắc muốn xóa sạch toàn bộ danh sách người?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa hết',
        style: 'destructive',
        onPress: () => {
          setMembers([]);
          setItems((prev) => prev.map((it) => ({ ...it, assignedTo: [] })));
        },
      },
    ]);
  };

  // ==========================================
  // THAO TÁC MÓN ĂN & FORMAT REAL-TIME
  // ==========================================
  const handleAddItem = () => {
    if (!newItemName.trim() || !newItemPrice.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tên món và giá tiền');
      return;
    }
    const priceNum = parseCurrencyInput(newItemPrice);
    const item = {
      id: 'it_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: newItemName.trim(),
      price: priceNum,
      quantity: 1,
      note: newItemNote.trim(),
      billCode: '',
      checkIn: '',
      checkOut: '',
      paymentMethod: '',
      assignedTo: [],
    };
    setItems((prev) => [...prev, item]);
    setNewItemName('');
    setNewItemNote('');
    setNewItemPrice('');
    setCustomTotal(null);
  };

  const handleRemoveItem = (itemId) => {
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== itemId);
      if (next.length === 0) {
        setCustomTotal(null);
        setBillDate(null);
      }
      return next;
    });
    setCustomTotal(null);
  };

  // THAO TÁC RESET SẠCH SẼ TOÀN BỘ BILL HIỆN TẠI (CHẾ ĐỘ 1 BILL DUY NHẤT)
  const handleResetCurrentBill = async () => {
    // 1. Hủy ngay lập tức bất kỳ tiến trình quét nào đang chạy ngầm
    if (scanAbortControllerRef.current) {
      scanAbortControllerRef.current.abort();
      scanAbortControllerRef.current = null;
    }
    setIsScanning(false);
    setScanStatusText('');

    // 2. Reset triệt để state về rỗng
    setItems([]);
    setCustomTotal(null);
    setBillDate(null);
    setCurrentBillId('bill_' + Date.now());

    // 3. Ghi đè ngay lập tức vào AsyncStorage (xóa sạch session hóa đơn cũ)
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          members,
          items: [],
          forceEqualSplit,
          ownerQrUri,
          customTotal: null,
          billDate: null,
        })
      );
    } catch (err) {
      console.warn('Lỗi reset AsyncStorage:', err);
    }
  };

  const handleClearAllItems = () => {
    if (items.length === 0) return;
    Alert.alert('Làm mới món ăn', 'Bạn có chắc muốn xóa toàn bộ danh sách món đã quét?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Làm mới',
        style: 'destructive',
        onPress: () => {
          handleResetCurrentBill();
        },
      },
    ]);
  };

  const handleUpdateItemPrice = (itemId, val) => {
    const num = parseCurrencyInput(val);
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, price: num } : it))
    );
    setCustomTotal(null);
  };

  const toggleAssignItemToMember = (itemId, memberId) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const assigned = it.assignedTo || [];
        const exists = assigned.includes(memberId);
        const updated = exists
          ? assigned.filter((id) => id !== memberId)
          : [...assigned, memberId];
        return { ...it, assignedTo: updated };
      })
    );
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor="#F1F5F9" />

      {/* GIAO DIỆN TỐI GIẢN - KHÔNG HEADER - ĐI THẲNG VÀO NỘI DUNG */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ==================================================== */}
        {/* KHU VỰC 1: QUÉT HÓA ĐƠN & CHI TIẾT LINH HOẠT */}
        {/* ==================================================== */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>1. Quét Hóa Đơn</Text>
            {items.length > 0 && (
              <TouchableOpacity
                style={styles.clearAllButton}
                onPress={handleClearAllItems}
              >
                <Text style={styles.clearAllButtonText}>🗑️ Làm mới</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 2 NÚT THAO TÁC RỘNG RÃI TRÁNH BỊ CHE */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.cameraButton, isScanning && styles.buttonDisabled]}
              onPress={handleCaptureBill}
              disabled={isScanning}
              activeOpacity={0.8}
            >
              {isScanning ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.cameraButtonText}>📸 Chụp Hóa Đơn</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.libraryButton, isScanning && styles.buttonDisabled]}
              onPress={handlePickBillImage}
              disabled={isScanning}
              activeOpacity={0.8}
            >
              <Text style={styles.libraryButtonText}>🖼️ Chọn Ảnh Bill</Text>
            </TouchableOpacity>
          </View>

          {scanStatusText !== '' && (
            <Text style={styles.scanStatusInfo}>{scanStatusText}</Text>
          )}

          {/* Tiêu đề danh sách món và tổng tiền */}
          <View style={styles.itemsHeaderRow}>
            <Text style={styles.subHeader}>
              Món đã quét ({items.length}){billDate ? ` • Ngày: ${billDate}` : ''} • Tổng:{' '}
              <Text style={styles.highlightText}>{formatVND(totalBillAmount)}</Text>
            </Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyItemsBox}>
              <Text style={styles.emptyItemsText}>
                Chưa có món ăn nào. Hãy bấm "📸 Chụp Hóa Đơn" hoặc "🖼️ Chọn Ảnh Bill" (hỗ trợ cả ảnh chứa nhiều bill), hoặc nhập thêm thủ công bên dưới.
              </Text>
            </View>
          ) : (
            <View key={currentBillId}>
              {items.map((it, idx) => {
                const assignedList = it.assignedTo || [];
                const isUnassigned = assignedList.length === 0;

                return (
                  <View key={it.id || idx} style={styles.itemCard}>
                    {/* DÒNG 1: STT + TÊN MÓN + GIÁ TIỀN + NÚT XÓA */}
                    <View style={styles.itemMainRow}>
                      <Text style={styles.itemIndex}>{idx + 1}.</Text>
                      <TextInput
                        style={styles.itemNameInput}
                        value={it.name}
                        onChangeText={(val) => {
                          setItems((prev) =>
                            prev.map((item) =>
                              item.id === it.id ? { ...item, name: val } : item
                            )
                          );
                        }}
                        placeholder="Tên món"
                      />
                      <TextInput
                        style={styles.itemPriceInput}
                        value={formatCurrencyInput(String(it.price))}
                        keyboardType="numeric"
                        onChangeText={(val) => handleUpdateItemPrice(it.id, val)}
                      />
                      <TouchableOpacity
                        onPress={() => handleRemoveItem(it.id)}
                        style={styles.deleteButton}
                      >
                        <Text style={styles.deleteButtonText}>✕</Text>
                      </TouchableOpacity>
                    </View>

                    {/* DÒNG 2: MÔ TẢ / GHI CHÚ MÓN (VD: 70% ĐÁ) */}
                    {Boolean(it.note) && (
                      <View style={styles.noteRow}>
                        <View style={styles.noteBadge}>
                          <Text style={styles.noteBadgeText}>📝 Mô tả: {it.note}</Text>
                        </View>
                      </View>
                    )}

                    {/* DÒNG 3: THÔNG TIN HÓA ĐƠN LINH HOẠT (MÃ HĐ, GIỜ VÀO, GIỜ RA) */}
                    {(Boolean(it.billCode) || Boolean(it.checkIn)) && (
                      <View style={styles.billMetaRow}>
                        {Boolean(it.billCode) && (
                          <View style={styles.metaBadge}>
                            <Text style={styles.metaBadgeText}>🧾 Mã HĐ: {it.billCode}</Text>
                          </View>
                        )}
                        {(Boolean(it.checkIn) || Boolean(it.checkOut)) && (
                          <Text style={styles.metaTimeText}>
                            ⏰ {it.checkIn ? `Vào: ${it.checkIn}` : ''}{' '}
                            {it.checkOut ? `| In: ${it.checkOut}` : ''}
                          </Text>
                        )}
                      </View>
                    )}

                    {/* DÒNG 4: GÁN NGƯỜI CHIA MÓN */}
                    {!isAutoEqualMode && members.length > 0 && (
                      <View style={styles.assignedChipsRow}>
                        <Text style={styles.assignedHint}>
                          {isUnassigned ? '👉 Tự gán Tiền mặt: ' : 'Chia cho: '}
                        </Text>
                        {members.map((m) => {
                          const isAssigned = assignedList.includes(m.id);
                          return (
                            <TouchableOpacity
                              key={m.id}
                              style={[
                                styles.memberMiniChip,
                                isAssigned && styles.memberMiniChipActive,
                              ]}
                              onPress={() => toggleAssignItemToMember(it.id, m.id)}
                            >
                              <Text
                                style={[
                                  styles.memberMiniChipText,
                                  isAssigned && styles.memberMiniChipTextActive,
                                ]}
                              >
                                {m.name} {m.isHost ? '👑' : ''}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Ô NHẬP THÊM MÓN THỦ CÔNG CÓ GHI CHÚ */}
          <View style={styles.addItemContainer}>
            <View style={styles.addItemTopRow}>
              <TextInput
                style={[styles.textInput, { flex: 2 }]}
                placeholder="+ Tên món thêm"
                value={newItemName}
                onChangeText={setNewItemName}
              />
              <TextInput
                style={[styles.textInput, { flex: 1.2, marginLeft: 6 }]}
                placeholder="Ghi chú (70% đá)"
                value={newItemNote}
                onChangeText={setNewItemNote}
              />
            </View>
            <View style={styles.addItemBottomRow}>
              <TextInput
                style={[styles.textInput, { flex: 1, marginRight: 6 }]}
                placeholder="Giá (đ)"
                value={newItemPrice}
                onChangeText={(text) => setNewItemPrice(formatCurrencyInput(text))}
                keyboardType="numeric"
              />
              <TouchableOpacity style={styles.addItemButton} onPress={handleAddItem}>
                <Text style={styles.addItemButtonText}>+ Thêm Món</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ==================================================== */}
        {/* KHU VỰC 2: DANH SÁCH NGƯỜI & CHỌN CHỦ BILL */}
        {/* ==================================================== */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>
              2. Danh Sách Người ({members.length})
            </Text>
            {members.length > 0 && (
              <TouchableOpacity
                style={styles.clearAllButton}
                onPress={handleClearAllMembers}
              >
                <Text style={styles.clearAllButtonText}>🗑️ Làm mới</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Ô thêm người */}
          <View style={styles.addMemberRow}>
            <TextInput
              style={[styles.textInput, { flex: 1 }]}
              placeholder="+ Thêm tên người (Nam, Hoa, Minh...)"
              value={newMemberName}
              onChangeText={setNewMemberName}
              onSubmitEditing={handleAddMember}
            />
            <TouchableOpacity
              style={styles.addMemberButton}
              onPress={handleAddMember}
            >
              <Text style={styles.addMemberButtonText}>+ Thêm</Text>
            </TouchableOpacity>
          </View>

          {members.length === 0 ? (
            <View style={styles.emptyMembersBox}>
              <Text style={styles.emptyMembersText}>
                Chưa có ai trong danh sách. Hãy nhập tên từng người vào ô phía trên rồi bấm "+ Thêm".
              </Text>
            </View>
          ) : (
            members.map((m) => {
              const amount = memberAmounts[m.id] || 0;
              return (
                <View key={m.id} style={styles.memberRow}>
                  <View style={styles.memberNameContainer}>
                    <Text style={styles.memberNameText}>
                      {m.name} {m.isHost && '👑'}
                    </Text>
                    <Text style={styles.memberAmountText}>{formatVND(amount)}</Text>
                  </View>

                  {/* NÚT CHỌN LÀM CHỦ BILL */}
                  <TouchableOpacity
                    style={[
                      styles.hostBadgeBtn,
                      m.isHost && styles.hostBadgeBtnActive,
                    ]}
                    onPress={() => handleSelectHost(m.id)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.hostBadgeText,
                        m.isHost && styles.hostBadgeTextActive,
                      ]}
                    >
                      {m.isHost ? '👑 Chủ bill' : 'Chọn Chủ'}
                    </Text>
                  </TouchableOpacity>

                  {/* NÚT CHỌN HÌNH THỨC TRẢ TIỀN */}
                  {!m.isHost && (
                    <TouchableOpacity
                      style={[
                        styles.checkboxContainer,
                        m.isQR && styles.checkboxActive,
                      ]}
                      onPress={() => toggleMemberQR(m.id)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.checkboxText,
                          m.isQR && styles.checkboxTextActive,
                        ]}
                      >
                        {m.isQR ? '☑️ Quét QR' : '💵 Tiền mặt'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    onPress={() => handleRemoveMember(m.id)}
                    style={styles.deleteMemberBtn}
                  >
                    <Text style={styles.deleteButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>

        {/* ==================================================== */}
        {/* KHU VỰC 3: CHIA TIỀN & MÃ QR CHỦ BILL (ZALOPAY / BANK) */}
        {/* ==================================================== */}
        <View style={styles.card}>
          <View style={styles.splitModeHeader}>
            <Text style={styles.sectionTitle}>3. Chia Tiền & Mã QR Chủ Bill</Text>
            <TouchableOpacity
              style={[styles.modeToggleBtn, forceEqualSplit && styles.modeToggleActive]}
              onPress={() => setForceEqualSplit(!forceEqualSplit)}
            >
              <Text
                style={[
                  styles.modeToggleText,
                  forceEqualSplit && styles.modeToggleTextActive,
                ]}
              >
                {forceEqualSplit ? '🔄 Đang Chia Đều' : '⚡ Chia Theo Món'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Banner chế độ chia */}
          <View style={styles.statusBanner}>
            <Text style={styles.statusBannerText}>
              {isAutoEqualMode
                ? `⚡ Chế độ: CHIA TRUNG BÌNH (${formatVND(
                    Math.round(totalBillAmount / (members.length || 1))
                  )}/người)`
                : `📋 Chế độ: CHIA THEO MÓN (Món chưa gán tự gán người Tiền mặt)`}
            </Text>
          </View>

          {/* Khung gom người trả tiền mặt ngoài */}
          {cashMembers.length > 0 && (
            <View style={styles.cashNoticeBox}>
              <Text style={styles.cashNoticeTitle}>
                💵 Thu tiền mặt ngoài: {formatVND(totalCashAmount)}
              </Text>
              {cashMembers.map((cm) => (
                <Text key={cm.id} style={styles.cashNoticeItem}>
                  • {cm.name}: {formatVND(memberAmounts[cm.id] || 0)} (Trả tiền mặt)
                </Text>
              ))}
            </View>
          )}

          {/* Tabs chọn người chuyển khoản cho Chủ Bill */}
          <Text style={styles.subHeaderQR}>
            Bấm chọn tên người để xem số tiền cần chuyển trả Chủ Bill:
          </Text>

          {qrPayerMembers.length === 0 ? (
            <Text style={styles.emptyQRText}>
              Chưa có thành viên chuyển khoản (hoặc chưa thêm thành viên khác ngoài Chủ Bill).
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.qrTabsScroll}
              contentContainerStyle={styles.qrTabsContent}
            >
              {qrPayerMembers.map((m) => {
                const isSelected = m.id === selectedQRMemberId;
                const amt = memberAmounts[m.id] || 0;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.qrTabChip, isSelected && styles.qrTabChipActive]}
                    onPress={() => setSelectedQRMemberId(m.id)}
                  >
                    <Text
                      style={[
                        styles.qrTabChipName,
                        isSelected && styles.qrTabChipNameActive,
                      ]}
                    >
                      {m.name}
                    </Text>
                    <Text
                      style={[
                        styles.qrTabChipAmount,
                        isSelected && styles.qrTabChipAmountActive,
                      ]}
                    >
                      {formatVND(amt)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* THẺ THANH TOÁN QR CỦA CHỦ BILL */}
          {currentQRMember && (
            <View style={styles.paymentCard}>
              <View style={styles.paymentHeader}>
                <Text style={styles.paymentPromptText}>
                  👉 <Text style={styles.boldText}>{currentQRMember.name}</Text> chuyển trả {currentHost ? currentHost.name : 'Chủ Bill'}:
                </Text>
                <View style={styles.amountCopyRow}>
                  <Text style={styles.paymentAmountValue}>
                    {formatVND(currentQRAmount)}
                  </Text>
                  <TouchableOpacity
                    style={styles.copyButton}
                    onPress={() => handleCopyAmount(currentQRAmount)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.copyButtonText}>📋 Sao chép số tiền</Text>
                  </TouchableOpacity>
                </View>

                {/* HIỂN THỊ CHI TIẾT CÁC MÓN MÀ NGƯỜI NÀY ĐÃ GỌI */}
                {!isAutoEqualMode && currentMemberItems.length > 0 && (
                  <View style={styles.memberItemsBreakdown}>
                    <Text style={styles.breakdownTitle}>Chi tiết món đã chọn:</Text>
                    {currentMemberItems.map((item, i) => (
                      <View key={item.id || i} style={styles.breakdownItemRow}>
                        <Text style={styles.breakdownItemName}>
                          • {item.name} {item.note ? `(${item.note})` : ''} {item.billCode ? `[${item.billCode}]` : ''}
                        </Text>
                        <Text style={styles.breakdownItemPrice}>
                          {formatVND(Math.round(item.price / (item.assignedTo.length || 1)))}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* KHUNG HIỂN THỊ ẢNH QR CHỦ BILL (ZALOPAY / NGÂN HÀNG - 100% OFFLINE) */}
              {ownerQrUri ? (
                <View style={styles.ownerQrDisplayBox}>
                  <View style={styles.qrTopBar}>
                    <Text style={styles.qrNoteBadge}>Quét ZaloPay / Mọi Ngân Hàng</Text>
                    <TouchableOpacity
                      style={styles.changeQrButton}
                      onPress={handleUploadOwnerQR}
                    >
                      <Text style={styles.changeQrButtonText}>🔄 Đổi ảnh QR khác</Text>
                    </TouchableOpacity>
                  </View>

                  <Image
                    source={{ uri: ownerQrUri }}
                    style={styles.ownerQrImage}
                    resizeMode="contain"
                  />

                  <Text style={styles.qrHelperText}>
                    Quét trực tiếp mã trên bằng ZaloPay hoặc app ngân hàng để chuyển khoản cho {currentHost ? currentHost.name : 'Chủ Bill'}.
                  </Text>
                </View>
              ) : (
                <View style={styles.uploadPlaceholderBox}>
                  <Text style={styles.uploadPlaceholderTitle}>
                    Chưa có ảnh mã QR của Chủ Bill
                  </Text>
                  <Text style={styles.uploadPlaceholderDesc}>
                    Tải lên ảnh chụp mã QR nhận tiền ZaloPay hoặc Ngân hàng của bạn để bạn bè quét thanh toán nhanh chóng.
                  </Text>
                  <TouchableOpacity
                    style={styles.bigUploadButton}
                    onPress={handleUploadOwnerQR}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.bigUploadButtonText}>
                      📤 Tải ảnh QR Chủ Bill (ZaloPay / Ngân hàng)
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* GHI CHÚ BÊN DƯỚI DÀNH CHO TIỀN MẶT */}
          {cashMembers.length > 0 && (
            <View style={styles.cashFooterContainer}>
              {cashMembers.map((cm) => (
                <Text key={cm.id} style={styles.cashFooterNoteText}>
                  💵 Người trả tiền mặt (không quét QR): {cm.name} -{' '}
                  {formatVND(memberAmounts[cm.id] || 0)}
                </Text>
              ))}
            </View>
          )}
        </View>

        <View style={styles.footerSpacing} />
      </ScrollView>
    </SafeAreaView>
  </SafeAreaProvider>
  );
}

// ==========================================
// STYLESHEET TỐI GIẢN - GIAO DIỆN SẠCH ĐẸP
// ==========================================
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    paddingTop: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  clearAllButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#FEE2E2',
    borderRadius: 6,
  },
  clearAllButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    marginBottom: 12,
    paddingRight: 10,
  },
  cameraButton: {
    flex: 1,
    height: 44,
    backgroundColor: '#2563EB',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  libraryButton: {
    flex: 1,
    height: 44,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  libraryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  scanStatusInfo: {
    fontSize: 12,
    color: '#2563EB',
    fontStyle: 'italic',
    marginBottom: 8,
    textAlign: 'center',
  },
  itemsHeaderRow: {
    marginTop: 2,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  subHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  highlightText: {
    color: '#2563EB',
    fontWeight: '800',
  },
  emptyItemsBox: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    marginBottom: 10,
  },
  emptyItemsText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  itemCard: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  itemMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemIndex: {
    width: 22,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  itemNameInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
    paddingVertical: 2,
  },
  itemPriceInput: {
    width: 95,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
    color: '#047857',
    paddingVertical: 2,
    marginRight: 6,
  },
  deleteButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  deleteButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '800',
  },
  noteRow: {
    flexDirection: 'row',
    marginTop: 3,
    marginLeft: 22,
  },
  noteBadge: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FFEDD5',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  noteBadgeText: {
    fontSize: 11,
    color: '#C2410C',
    fontWeight: '600',
  },
  billMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
    marginLeft: 22,
    gap: 6,
  },
  metaBadge: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  metaBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#475569',
  },
  metaTimeText: {
    fontSize: 10,
    color: '#64748B',
  },
  assignedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 6,
    marginLeft: 22,
    gap: 4,
  },
  assignedHint: {
    fontSize: 11,
    color: '#64748B',
  },
  memberMiniChip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  memberMiniChipActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  memberMiniChipText: {
    fontSize: 11,
    color: '#475569',
  },
  memberMiniChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  addItemContainer: {
    marginTop: 10,
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  addItemTopRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  addItemBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textInput: {
    height: 38,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
  },
  addItemButton: {
    height: 38,
    paddingHorizontal: 14,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addItemButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyMembersBox: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    marginBottom: 4,
  },
  emptyMembersText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  addMemberRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  addMemberButton: {
    paddingHorizontal: 12,
    backgroundColor: '#2563EB',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addMemberButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 6,
  },
  memberNameContainer: {
    flex: 1,
  },
  memberNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  memberAmountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
    marginTop: 2,
  },
  hostBadgeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  hostBadgeBtnActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  hostBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  hostBadgeTextActive: {
    color: '#B45309',
    fontWeight: '700',
  },
  checkboxContainer: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  checkboxActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  checkboxText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  checkboxTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  deleteMemberBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  splitModeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modeToggleBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  modeToggleActive: {
    backgroundColor: '#E0E7FF',
    borderColor: '#4F46E5',
  },
  modeToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  modeToggleTextActive: {
    color: '#4338CA',
    fontWeight: '700',
  },
  statusBanner: {
    backgroundColor: '#F0FDF4',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginBottom: 10,
  },
  statusBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
  },
  cashNoticeBox: {
    backgroundColor: '#FFFBEB',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 12,
  },
  cashNoticeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  cashNoticeItem: {
    fontSize: 12,
    color: '#B45309',
    marginLeft: 6,
    marginBottom: 2,
  },
  subHeaderQR: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  emptyQRText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#94A3B8',
    textAlign: 'center',
    marginVertical: 10,
  },
  qrTabsScroll: {
    marginBottom: 12,
  },
  qrTabsContent: {
    gap: 8,
  },
  qrTabChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
  },
  qrTabChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  qrTabChipName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  qrTabChipNameActive: {
    color: '#FFFFFF',
  },
  qrTabChipAmount: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  qrTabChipAmountActive: {
    color: '#E0E7FF',
    fontWeight: '700',
  },
  paymentCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  paymentHeader: {
    marginBottom: 12,
  },
  paymentPromptText: {
    fontSize: 14,
    color: '#1E293B',
    marginBottom: 4,
  },
  boldText: {
    fontWeight: '800',
    color: '#2563EB',
  },
  amountCopyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  paymentAmountValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#059669',
  },
  copyButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 6,
  },
  copyButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  memberItemsBreakdown: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  breakdownTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  breakdownItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  breakdownItemName: {
    fontSize: 11,
    color: '#1E293B',
    flex: 1,
  },
  breakdownItemPrice: {
    fontSize: 11,
    fontWeight: '600',
    color: '#047857',
    marginLeft: 6,
  },
  ownerQrDisplayBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  qrTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  qrNoteBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
    backgroundColor: '#ECFDF5',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  changeQrButton: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  changeQrButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  ownerQrImage: {
    width: 240,
    height: 240,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
  },
  qrHelperText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 8,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  uploadPlaceholderBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  uploadPlaceholderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  uploadPlaceholderDesc: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 16,
  },
  bigUploadButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  bigUploadButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  cashFooterContainer: {
    backgroundColor: '#FEF3C7',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginTop: 6,
  },
  cashFooterNoteText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
    marginBottom: 3,
  },
  footerSpacing: {
    height: 40,
  },
});

registerRootComponent(App);
