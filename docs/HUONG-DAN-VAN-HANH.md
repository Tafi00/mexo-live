# Hướng dẫn vận hành MEXO Live 2

## 1. Vai trò

| Vai trò | Làm được |
|---|---|
| **Quản trị hệ thống** | Mọi việc: tài khoản (kể cả quản trị viên), máy chủ phát, giám sát API, cấu hình, đóng băng hệ thống, đặt hạn "không thời hạn", giải phóng khóa phiên bắt buộc |
| **Quản trị viên** | Vận hành mọi shop: kết nối hộ, đặt hạn dùng, ngưng/mở lại dịch vụ, cấu hình AI, quản lý tài khoản chủ shop. Chỉ xem máy chủ và giám sát API |
| **Chủ shop** | Shop của mình: tự kết nối/cấp quyền lại, video, mẫu, lịch, phiên, trả lời. Tạo **nhân viên** và phân quyền. Chỉ xem hạn dùng |
| **Nhân viên** | Chỉ những shop được giao và những quyền được cấp (11 quyền: xem shop, kết nối, tạo phiên, bắt đầu/kết thúc, video, sản phẩm, ghim, lịch, trả lời bình luận, báo cáo, mẫu phát) |

## 2. Quy trình chuẩn cho một shop mới

1. **Gian hàng → Kết nối shop**: nhập hạn dùng theo hợp đồng → *Tạo liên kết cấp quyền* → gửi cho chủ shop (liên kết dùng 1 lần, hết hạn sau 15 phút). Chủ shop đăng nhập Shopee bằng **tài khoản shop** và đồng ý.
2. Hệ thống tự tải **danh mục sản phẩm** (tab *Sản phẩm*, có tiến độ x/y).
3. **Video**: kéo thả nhiều file. Mạng chập chờn hoặc đóng nhầm tab → chọn lại đúng file để tải tiếp.
4. **Mẫu phát**: điền *Thông tin khi phát* (tiêu đề live, **ảnh bìa**), thêm video, kéo thả thứ tự, chọn sản phẩm ghim cho từng video. Có *Gán sản phẩm nhanh*: dán danh sách mã/link theo thứ tự video. Muốn đổi sản phẩm giữa video thì thêm mốc giây.
5. **Bình luận**: nhập *Đặc trưng của shop*, thêm kịch bản (hoặc nhập từ Excel), dùng *Thử một câu hỏi*, rồi bật *Tự động trả lời*.
6. **Lịch phát**: chỉ cần chọn mẫu và giờ bật/tắt (giờ tắt nhỏ hơn giờ bật = tắt hôm sau). Tiêu đề và ảnh bìa để trống sẽ dùng của mẫu phát.

## 3. Lên live

**Phát ngay** (nút chính ở đầu trang shop, ở từng mẫu phát, hoặc menu của shop trong danh sách): chọn mẫu → hệ thống tự kiểm tra (ảnh bìa, kết nối, hạn dùng, video, sản phẩm ghim, máy chủ, giỏ live) → một nút *Phát ngay*. Hệ thống tạo phiên trên Shopee → thêm sản phẩm ghim vào giỏ → giao máy chủ phát → **khi Shopee đã nhận hình mới bắt đầu phiên** → ghim sản phẩm theo video → trả lời bình luận.

- Nhiều shop cùng lúc: chọn các shop trong *Gian hàng* → *Bắt đầu phát*.
- *Tạo phiên thủ công* (nâng cao): chỉ tạo phiên trên Shopee, chưa phát — dùng khi muốn chuẩn bị giỏ hàng trước.
- **Dừng đẩy hình**: người xem thấy hình đứng, phiên vẫn mở. **Kết thúc live**: không mở lại được; máy phát tự dừng.
- **Trả lời tự động theo phiên**: trong trang phiên có thể *Bật/Tắt* riêng cho phiên đó. Thứ tự ưu tiên: phiên → mẫu phát → cài đặt của shop.

## 4. Đọc tín hiệu sức khỏe phiên

| Tín hiệu | Xanh | Đỏ | Xám |
|---|---|---|---|
| **Hình** | Máy đang đẩy hình | Máy lỗi/mất kết nối (tự chạy lại, quá 60 giây tự chuyển máy khác) | Chưa phát / đã dừng |
| **Ghim** | Sản phẩm ghim khớp video | Ghim lỗi (thường do hết hàng) | Chưa ghim |
| **Trả lời** | Tự động trả lời hoạt động | Gửi lỗi (5 lần liên tiếp → tự tắt + cảnh báo) | Đang tắt |

## 5. Xử lý sự cố

| Tình huống | Cách xử lý |
|---|---|
| Phiên "có vẻ bị treo" / "Lỗi đồng bộ" | Mở phiên → **Đồng bộ trạng thái**. Nếu Shopee xác nhận đã kết thúc, hệ thống tự đóng phiên |
| Phiên treo chặn tạo phiên mới | Quản trị → **Giải phóng khóa phiên** (sau khi xác minh). Quản trị hệ thống có thể giải phóng bắt buộc kèm lý do khi Shopee không phản hồi |
| Lịch "Bỏ lỡ" | Xem lý do trong lịch (shop đang có phiên khác, mất kết nối, mẫu không đạt, hệ thống đóng băng…). Lịch bỏ lỡ không phát bù |
| Shop "Cần cấp quyền lại" | Gửi liên kết cấp quyền lại cho chủ shop (chỉ nhận đúng shop đó) |
| Tỷ lệ API Shopee thấp | *Giám sát API* → xem nhóm lỗi, API, shop gây lỗi. Shopee yêu cầu ≥ 90%/ngày |
| Sự cố diện rộng | *Cấu hình → Đóng băng hệ thống*: dừng mọi tác vụ tự động, giữ video đang phát. Mở băng khi ổn định |
| Quên mật khẩu quản trị | Trên máy chủ: `pnpm create-admin <tên>` → in mật khẩu tạm |

## 6. Cảnh báo

Cảnh báo lặp được gộp (×N). Bấm **Đã nhận** để ngừng nhắc; cảnh báo tự đóng khi điều kiện hết. Mức *Nghiêm trọng* cần xử lý ngay (mất hình, phiên treo, máy chủ mất kết nối, tỷ lệ API < 93%).
