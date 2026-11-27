# Kịch bản nghiệm thu (mục XVII Brief)

Các kịch bản tự động nằm trong `tests/acceptance/`, chạy với API đang chạy (`pnpm dev`) ở chế độ Shopee giả lập, máy phát mô phỏng (`pnpm dev:streamer`) và dữ liệu demo (`pnpm seed:demo`).

```powershell
node tests/acceptance/01-phat-tu-dong.mjs admin <mật-khẩu> <id-shop-demo>
```

```powershell
node tests/acceptance/02-lich-phat.mjs admin <mật-khẩu> <id-shop-demo>
```

```powershell
node tests/acceptance/03-phan-quyen-va-tai-video.mjs admin <mật-khẩu>
```

Kịch bản tải (`04-tai-dong-thoi.mjs`) chạy trên một API riêng có dữ liệu tách biệt — xem hướng dẫn ở đầu file.

## Kết quả chạy ngày 27/11/2026 (môi trường giả lập)

| Tiêu chí Brief | Kịch bản | Kết quả |
|---|---|---|
| Kết nối gian hàng bằng cấp quyền chính thức | Liên kết dùng 1 lần → trang cấp quyền → trang chuyển về; dán địa chỉ; cấp quyền lại đúng shop | Đạt (60 shop kết nối trong 2,9 giây) |
| Tạo, bắt đầu, kết thúc livestream | 01 | Đạt — chỉ bắt đầu phiên Shopee sau khi máy phát đã đẩy hình ~6 giây |
| Tự động phát video theo danh sách | 01, 04 | Đạt — phát lặp, chuyển video tay, phát tiếp đúng vị trí sau khởi động lại |
| Tự động ghim sản phẩm đúng kịch bản | 01, 04 | Đạt — ghim theo video và theo mốc giây; 60/60 phiên ghim đúng |
| Hẹn giờ bắt đầu và kết thúc chính xác | 02 | Đạt — bật trễ 6 giây, tắt trễ 7 giây (chu kỳ lập lịch 10 giây), đúng phiên của lịch |
| Không tạo trùng lịch khi khởi động lại | 02 (API khởi động lại giữa lần phát) | Đạt — lần phát giữ trạng thái, tự tắt đúng giờ |
| Chặn lịch chồng khung giờ / phiên trùng | 01, 02 | Đạt (409 `schedule_overlap`, `session_open`) |
| Đọc và trả lời bình luận theo giới hạn | 01 | Đạt — trả lời theo kịch bản, bỏ qua bình luận chứa số điện thoại/Zalo |
| Quản lý tài khoản con và phân quyền đúng phạm vi | 03 | Đạt (24/24 kiểm tra) |
| Không truy cập chéo dữ liệu giữa khách hàng | 03 | Đạt — 404 với shop/sản phẩm/phiên của khách khác |
| Tải video tiếp được | 03 | Đạt — tiếp tục đúng byte, không ghi trùng khi lệch offset |
| Khôi phục phiên bị treo sau khi xác minh | Thủ công: phiên "Chưa xác minh" từ hệ thống cũ tự xác minh sau khi cấp quyền lại | Đạt |
| Xử lý khi API Shopee lỗi / không phản hồi | 04 với lỗi giả lập 2% (429, 500) | Đạt — 97,9% lệnh thành công tính cả lần thử lỗi; mọi phiên vẫn chạy |
| Kiểm thử tải | 04 — 60 phiên đồng thời | Đạt — 60/60 lên sóng trong ~28 giây; vòng điều khiển < 1 giây/lượt |
| Có đầy đủ log | Nhật ký phiên, nhật ký hệ thống, nhật ký từng lệnh API kèm request_id/mã tham chiếu | Đạt |

## Chưa kiểm được trong môi trường này

- Gọi Shopee thật (cần Partner ID + quyền Livestream API) — chạy lại 01–03 với `SHOPEE_MODE=sandbox`.
- Đẩy RTMP thật bằng FFmpeg (máy hiện tại chưa cài FFmpeg) — chạy máy phát `STREAMER_MODE=ffmpeg` trên máy có FFmpeg.
- Vận hành liên tục 72 giờ và tải 300–1.000 phiên — cần hạ tầng tương ứng (xem bảng ước lượng trong README).
