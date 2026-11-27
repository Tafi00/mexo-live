# Tích hợp Shopee Open Platform

Toàn bộ lệnh gọi Shopee đi qua **một chỗ**: `apps/api/src/services/shopee/client.ts` (ký, retry, giới hạn tần suất, circuit breaker, nhật ký) và `apps/api/src/services/shopee/index.ts` (22 API, chuẩn hóa dữ liệu, quản lý token). Khi tài liệu chính thức khác với tham số đang dùng, chỉ cần sửa ở hai file này.

## Ký request

- API công khai (auth): `HMAC_SHA256(partner_key, partner_id + path + timestamp)`
- API theo shop: `HMAC_SHA256(partner_key, partner_id + path + timestamp + access_token + shop_id)`
- Host: `live` → `https://partner.shopeemobile.com`, `sandbox` → `https://partner.test-stable.shopeemobile.com`, `mock` → Shopee giả lập trong API.

## Danh sách API và chính sách gọi

| # | API | Dùng ở đâu | Retry |
|---|---|---|---|
| 1 | `livestream/get_latest_comment_list` | Đọc bình luận ~3 giây/phiên, lùi nhịp khi lỗi | 1 lần, giãn nhịp tới 60 giây, cách ly 5 phút sau 20 lỗi |
| 2 | `auth/access_token/get` | Làm mới token trước khi hết 30 phút; khi Shopee báo token sai | an toàn (3) |
| 3 | `livestream/get_session_detail` | Đối soát 15–30 giây/phiên; lấy địa chỉ đẩy luồng | an toàn |
| 4 | `livestream/update_show_item` | Ghim theo video/mốc giây; ghim tay | an toàn; tự thêm lại vào giỏ nếu Shopee báo không có trong giỏ |
| 5 | `livestream/get_session_metric` | Chỉ số 15 giây/phiên đang live | an toàn |
| 6 | `livestream/get_show_item` | Kiểm tra kết quả ghim ~1 phút/phiên | an toàn |
| 7 | `livestream/create_session` | Tạo phiên (tay / lịch / hàng loạt) | **chỉ khi 429/503** (tránh tạo trùng) |
| 8 | `livestream/end_session` | Kết thúc tay / theo lịch / tự ngắt khi hết hạn | an toàn; kiểm tra trạng thái trước để không gửi lệnh cho phiên đã kết thúc |
| 9 | `livestream/add_item_list` | Thêm giỏ (lô 20), nạp từ mẫu, tự thêm sản phẩm ghim còn thiếu | an toàn |
| 10 | `livestream/get_item_count` | Đếm giỏ | an toàn |
| 11 | `livestream/upload_image` | Ảnh bìa (JPG/PNG ≤ 2 MB) | an toàn |
| 12 | `product/get_item_list` | Sao chép danh mục (trang 100) | an toàn |
| 13 | `livestream/get_recent_item_list` | Gợi ý "dùng gần đây" | an toàn |
| 14 | `livestream/post_comment` | Trả lời tự động / thủ công | **chỉ khi 429/503** (tránh đăng trùng) |
| 15 | `livestream/get_item_list` | Đọc giỏ live | an toàn |
| 16 | `product/get_item_base_info` | Tên, SKU, ảnh, giá, tồn kho (lô 50) | an toàn |
| 17 | `product/get_model_list` | Phân loại hàng/SKU (khi mở chi tiết) | an toàn |
| 18 | `shop/get_shop_info` | Tên shop, hạn uỷ quyền, kiểm tra kết nối | an toàn |
| 19 | `auth/token/get` | Đổi `code` lấy token khi cấp quyền | không retry (mã dùng 1 lần) |
| 20 | `livestream/start_session` | Bắt đầu phiên **sau khi Shopee đã nhận hình** | an toàn |
| 21 | `product/get_item_extra_info` | Đã bán, lượt thích, đánh giá | an toàn |
| 22 | `livestream/delete_item_list` | Gỡ khỏi giỏ | an toàn |
| + | `livestream/update_session` | Sửa tiêu đề/mô tả phiên chưa bắt đầu (gửi lại ảnh bìa) | an toàn |
| + | `shop/auth_partner` | Liên kết cấp quyền (không phải lệnh gọi API) | — |

## Phân loại lỗi

| Loại | Nhận biết | Xử lý |
|---|---|---|
| `rate_limit` | HTTP 429, `error_busi_frequency` | Giãn nhịp theo shop + nhóm API (tôn trọng `Retry-After`) |
| `server` | HTTP 5xx | Retry có backoff; ≥ 50% lỗi trong 60 giây (≥ 10 lệnh) → circuit breaker mở 30 giây |
| `timeout` / `network` | Không phản hồi trong `SHOPEE_TIMEOUT_MS` | Như trên; phân biệt "lỗi mạng" với "lỗi Shopee" trong giám sát |
| `auth` | `invalid_access_token`, `error_auth` | Làm mới token 1 lần rồi gọi lại; refresh thất bại → shop "Cần cấp quyền lại" + cảnh báo |
| `permission` | `error_permission`, shop không cấp quyền | Shop "Mất quyền" + cảnh báo nghiêm trọng |
| `session_invalid` / `session_ended` | Thông báo lỗi về session | Đối soát 2 lần liên tiếp → đóng phiên nội bộ, giải phóng khóa |
| `bad_request` | Còn lại | Không retry, ghi log kèm mã tham chiếu |

Mỗi lần thử ghi 1 dòng `api_calls` (thời gian, API, shop, session, HTTP status, error code, request_id, thời lượng, số lần retry, mã tham chiếu nội bộ — đã loại token). Bảng `api_daily` tổng hợp theo ngày để theo dõi tỷ lệ thành công ≥ 90% mà Shopee yêu cầu và xuất CSV đối chiếu với Console.

## Việc cần xác minh với tài liệu chính thức trước khi bật `live`

1. Tên tham số và cấu trúc phản hồi của nhóm `livestream/*` (đặc biệt `stream_url_list`, `domain_id` cho `start_session`, `comment_list`/`next_offset`).
2. Rate limit từng API và quy định tính tỷ lệ gọi thành công.
3. Giới hạn giỏ live (100/500) và số ảnh bìa.
4. Phạm vi dữ liệu bình luận (tên người xem) theo chính sách dữ liệu Shopee.
