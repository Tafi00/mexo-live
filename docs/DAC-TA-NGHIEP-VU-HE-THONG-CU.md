# ĐẶC TẢ NGHIỆP VỤ HỆ THỐNG MEXO LIVE AI

> Tài liệu dựng lại từ hệ thống đang chạy tại `https://live.mexo.vn`, đọc qua tài khoản quản trị ngày 26/11/2026.
> Nguồn: giao diện web đã build (React), các API mà giao diện gọi, dữ liệu backup. Không có source backend gốc.
> Mục đích: làm căn cứ để xây lại hệ thống trên một source mới.

---

## 1. Tổng quan

MEXO Live AI là hệ thống **livestream bán hàng tự động trên Shopee Live** cho nhiều shop. Hệ thống:

1. Kết nối shop Shopee bằng **cấp quyền chính thức Shopee Open Platform** (OAuth: `code` + `shop_id`).
2. Cho mỗi shop một **thư viện video** và các **mẫu phát** (danh sách video theo thứ tự, mỗi video ghim 1 sản phẩm).
3. **Tự tạo phiên live** trên Shopee (thủ công hoặc theo **lịch phát**), giao cho các máy **MexoStreamer** đẩy video lên Shopee, rồi tự **bắt đầu phiên** khi Shopee đã nhận hình.
4. Khi đang phát, **tự ghim sản phẩm** theo video đang chạy và **tự trả lời bình luận** (kịch bản từ khóa + AI kiểu OpenAI), có lớp lọc nội dung.
5. Quản lý **hạn dùng dịch vụ** (theo hợp đồng), **hạn uỷ quyền Shopee**, **cảnh báo**, **máy chủ phát**, **tài khoản và phân quyền**, và **theo dõi tỷ lệ gọi API Shopee** (Shopee phạt nếu dưới 90%/ngày).

### Quy mô tại thời điểm backup
| Hạng mục | Số lượng |
|---|---|
| Shop | 134 (124 đang live lúc backup) |
| Sản phẩm (bản sao danh mục) | 31.958 |
| Video | 1.435 |
| Mẫu phát | 129 |
| Lịch phát (lần phát) | 90 |
| Phiên đã kết thúc (lịch sử) | 1.375 |
| Tài khoản | 3 (2 Quản trị viên, 1 Chủ shop) |
| Máy chủ phát | 3 khai báo (1 online, tối đa 999 luồng; 2 chưa chạy) |
| Hạn mức luồng hiển thị | 123–124 / 999 |
| Kịch bản trả lời | 0 (đang dùng AI) |

---

## 2. Kiến trúc hiện tại

```
[Trình duyệt: Web quản trị React SPA]  ──HTTPS──>  [API trung tâm live.mexo.vn/api]  ──>  Shopee Open Platform API
                                                         │      │                          (Livestream, Product, Shop)
                                                         │      └──> Dịch vụ AI (chuẩn OpenAI /chat/completions)
                                                         │
                                       khóa riêng + heartbeat vài giây/lần
                                                         │
                                          [Máy MexoStreamer 1..n] ──RTMP/đẩy hình──> Shopee Live
```

- **Frontend:** React, React Router, i18next (tiếng Việt), build bằng Vite. Đi qua Cloudflare.
- **Backend:** REST JSON tại `/api/*`, xác thực bằng phiên đăng nhập (cookie). Có kiểm tra Origin: gọi từ địa chỉ lạ thì báo lỗi.
- **Máy phát (MexoStreamer):** chương trình riêng chạy trên máy chủ phát, cấu hình bằng biến `MEXO_SERVER_KEY`, báo về (heartbeat) mỗi vài giây, có kiểm tra phiên bản tối thiểu.
- **IP tĩnh ra Internet:** Shopee chỉ nhận lệnh từ IP đã khai báo. Hệ thống kiểm tra IP ra thực tế (có nhắc tới Tailscale exit node); sai IP thì tự dừng mọi lệnh gọi Shopee.
- **Biến cấu hình phía server** thấy được qua giao diện: `API_REPLY_AI_DAILY_BUDGET` (số lượt AI mỗi shop mỗi ngày), `API_AI_ALLOW_PRIVATE_HOSTS` (cho phép AI chạy ở mạng nội bộ).
- Ghi chú trong giao diện: có một "bản demo cũ" **dùng chung Partner ID** Shopee với hệ thống này.

---

## 3. Vai trò và phân quyền

| Vai trò | Quyền |
|---|---|
| **Sysadmin** | Toàn quyền: tạo, khóa, đổi vai trò tài khoản; quản lý máy chủ phát (thêm, cấp lại khóa, thu hồi); xem **Theo dõi API Sàn** và **Theo dõi tên shop**; đặt hạn dùng "không thời hạn"; đóng băng hệ thống. Hệ thống phải luôn còn ít nhất 1 Sysadmin đang hoạt động. |
| **Quản trị viên (admin)** | Nhân viên vận hành: thấy mọi shop, kết nối shop, đặt hạn dùng (ngày cụ thể), sửa Cấu hình AI, gia hạn và chỉnh số shop tối đa của Chủ shop. Chỉ xem trang Máy chủ. Không quản lý tài khoản. |
| **Chủ shop (owner)** | Chỉ thấy shop gắn với mình; tự kết nối và cấp quyền lại shop; vận hành phiên, video, mẫu, lịch, trả lời. Chỉ xem hạn dùng, không tự gia hạn. Có **số shop tối đa** và **hạn dùng của tài khoản** (áp chung cho các shop gắn vào). |

**Quy tắc tài khoản**
- Tên đăng nhập: chữ, số và `. _ @ -`, 3–64 ký tự, không phân biệt hoa thường, không đổi được.
- Tên hiển thị tối đa 80 ký tự.
- Tạo tài khoản hoặc đặt lại mật khẩu thì sinh **mật khẩu tạm hiện một lần**; người nhận bị **buộc đổi mật khẩu** ở lần đăng nhập đầu.
- Mật khẩu mới: đủ độ dài tối thiểu, không quá phổ biến, không chứa tên đăng nhập, phải khác mật khẩu cũ. Đổi mật khẩu thì các thiết bị khác bị đăng xuất.
- Đăng nhập sai nhiều lần thì bị khóa tạm vài phút.
- Khóa tài khoản: đăng xuất ngay. Đổi vai trò: đăng xuất; chuyển sang hoặc khỏi Chủ shop thì bỏ các shop đã gắn.
- Không thao tác (khóa, đổi vai trò, đặt lại mật khẩu) lên chính tài khoản của mình.
- Gắn shop tay cho Chủ shop **bắt buộc ghi cách xác minh** (ví dụ gọi đúng số đăng ký trên Shopee). Mỗi shop chỉ có 1 người phụ trách.
- Gia hạn tài khoản Chủ shop thì hạn mới áp cho **tất cả shop đang gắn**.
- **Nhật ký hoạt động** tài khoản: đăng nhập, sai mật khẩu, đăng xuất, đổi mật khẩu, tạo, khóa, mở khóa, đặt lại, đổi vai trò, đổi shop gắn, đổi giới hạn shop, gia hạn (kể cả thao tác từ dòng lệnh).

---

## 4. Danh mục màn hình

| Đường dẫn | Màn hình | Ai thấy |
|---|---|---|
| `/login` | Đăng nhập | Tất cả |
| `/password` | Đổi mật khẩu (kể cả bắt buộc đổi) | Tất cả |
| `/` (home) | Tổng quan: danh sách shop | Admin, Sysadmin |
| `/alerts` | Cảnh báo | Admin, Sysadmin |
| `/servers` | Máy chủ phát | Xem: Admin; sửa: Sysadmin |
| `/accounts` | Tài khoản và quyền | Admin (hạn chế), Sysadmin |
| `/ai` | Cấu hình AI | Admin, Sysadmin |
| `/monitor` | Theo dõi API Sàn | Sysadmin |
| `/shop-names` | Theo dõi tên shop | Sysadmin |
| `/shops/:shopId/today` | Hôm nay của shop | Tất cả có quyền với shop |
| `/shops/:shopId/sessions`, `/sessions/:sessionId` | Phiên live, chi tiết phiên | 〃 |
| `/shops/:shopId/videos` | Thư viện video | 〃 |
| `/shops/:shopId/templates` | Mẫu phát | 〃 |
| `/shops/:shopId/schedule` | Lịch phát | 〃 |
| `/shops/:shopId/products` | Sản phẩm | 〃 |
| `/shops/:shopId/replies` | Trả lời bình luận | 〃 |
| `/shops/:shopId/history` | Lịch sử phiên | 〃 |
| `/shops/:shopId/connection` | Kết nối và hạn dùng | 〃 |

Thanh trên cùng có: ô tìm shop theo tên hoặc ID (gõ không dấu được), số luồng đang đẩy / tổng luồng, chuông cảnh báo, đổi giao diện sáng/tối, menu tài khoản.

---

## 5. Nghiệp vụ chi tiết

### 5.1 Tổng quan (danh sách shop)
- Các ô lọc: **Tất cả shop / Cần xử lý / Đang live / Có lịch phát hôm nay / Hạn dùng sắp hết / Đã ngưng**.
- Lọc theo người phụ trách. Sắp xếp: cần xử lý trước, tên A–Z, nhiều người xem nhất, hạn dùng gần nhất, hạn uỷ quyền gần nhất.
- Mỗi dòng gồm: số thứ tự, tên (tên gợi nhớ hoặc tên Shopee), Shopee ID; tình trạng (Đang live / Sẵn sàng / Cần xử lý / Lịch hh:mm / Hết hạn / Đã ngưng) và thời gian đã live; phiên hiện tại (tiêu đề, giờ bắt đầu, người xem, video x/y, link chia sẻ có nút chép); hạn dùng (còn N ngày); hạn uỷ quyền; người phụ trách.
- Tín hiệu sức khỏe phiên: **Hình** (máy chủ đang đẩy video), **Ghim** (sản phẩm ghim khớp video), **Trả lời** (tự động trả lời). Mỗi tín hiệu có 3 trạng thái: tốt, có vấn đề, đang tắt.
- Thao tác: mở phiên, **dừng đẩy hình** (có hỏi xác nhận), đặt hạn dùng, đặt tên gợi nhớ, **ngưng dịch vụ** (khi chấm dứt hợp đồng), **mở lại dịch vụ** (bắt buộc nhập hạn mới; dùng lại token cũ, không cần cấp quyền lại).
- Các việc cần xử lý: mất hình N giây; ghim lỗi do hết hàng; trả lời tự động tắt do lỗi gửi; cần kết nối lại; sắp hết hạn; đã hết hạn (khóa thao tác).

### 5.2 Kết nối shop (Shopee OAuth)
- **Admin kết nối hộ:** nhập **hạn dùng theo hợp đồng** (mặc định 1 năm), lấy **liên kết cấp quyền dùng một lần, hết hạn nhanh**, gửi cho chủ shop. Chủ shop đăng nhập Shopee bằng tài khoản shop rồi đồng ý. Shop tự hiện trong danh sách, không có bước duyệt.
- **Cách dán địa chỉ:** khi cấp quyền từ Console (API Test Tool) hoặc trang chuyển về không mở được, dán URL có `code` + `shop_id` (+ `state`). Mã hết hạn sau khoảng 10 phút. Trang chuyển về cố ý trả 404 để giữ nguyên mã trên thanh địa chỉ.
- **Chủ shop tự kết nối:** shop mới gắn vào tài khoản của họ và dùng hạn dùng của tài khoản. **Cấp quyền lại** chỉ nhận đúng shop đang chọn.
- Sau khi kết nối, hệ thống kiểm tra token Livestream (dùng được / bị từ chối / chưa kiểm tra).
- Các lỗi phải xử lý: liên kết hết hạn hoặc đã dùng (`invalid_state`); thiếu code hoặc shop_id; cấp quyền bằng **tài khoản chính** thay vì tài khoản shop; nhiều tài khoản livestream (shop đa thị trường); mã bị từ chối; shop thuộc tài khoản khác; sai shop khi cấp quyền lại; shop đã ngưng dịch vụ; vượt giới hạn số shop; thiếu hạn dùng hoặc hạn dùng đã qua.
- Redirect URL phải được đăng ký trong Shopee Open Platform Console.
- Có **hai loại hạn**:
  - **Hạn dùng:** do MEXO đặt theo hợp đồng, tính theo giờ Việt Nam.
  - **Hạn uỷ quyền:** do Shopee quyết định, tối đa 365 ngày. Hết hạn thì phải cấp quyền lại.
- Tab "Kết nối và hạn dùng" có nút **kiểm tra kết nối**: gọi 2 lệnh đọc nhẹ tới Shopee để biết cả hai quyền còn dùng được không.

### 5.3 Hạn dùng và ngưng dịch vụ
- Hết hạn dùng: vẫn **xem** được dữ liệu và **kết thúc** được phiên đang live, nhưng không thao tác khác được, không tạo hay bắt đầu phiên mới.
- Phiên đang live khi shop hết hạn: **tự ngắt sau thời gian ân hạn** (`liveCutAt`), có cảnh báo trước. Nếu Shopee không cho kết thúc thì có cảnh báo riêng.
- Ngưng dịch vụ: shop chuyển sang ô Đã ngưng, chủ shop không vào được nữa. Mở lại thì nhập hạn mới.
- Chỉ Sysadmin đặt được hạn "không thời hạn".
- Nhật ký shop ghi: ngưng dịch vụ, mở lại, đổi hạn dùng, đặt hoặc xóa tên gợi nhớ.

### 5.4 Phiên live
- **Mỗi shop chỉ có 1 phiên mở** tại một thời điểm.
- Trạng thái phiên: chưa bắt đầu → đang live → đã kết thúc. Có cờ "có vẻ bị treo".
- **Tạo phiên:** tên (bắt buộc), mô tả, ảnh bìa JPG/PNG ≤ 2 MB, mẫu phát (tùy chọn; tên mẫu được điền sẵn làm tên phiên).
- Sửa phiên chưa bắt đầu: Shopee yêu cầu gửi lại ảnh bìa khi sửa tiêu đề hoặc mô tả.
- Danh sách phiên đọc từ bản lưu ở MEXO; chỉ khi mở chi tiết hoặc bấm Làm mới mới hỏi Shopee.
- Chi tiết phiên: số người đang xem, lượt xem, xem trung bình, lượt thích, bình luận, đơn hàng; link xem; giỏ live và sản phẩm đang ghim.
- **Giỏ live:**
  - Thêm sản phẩm từ: dùng gần đây, bán chạy, toàn bộ danh mục, hoặc **dán danh sách mã/link** (mỗi dòng một sản phẩm, tối đa 1.000 mã, giữ đúng thứ tự).
  - Nạp giỏ từ mẫu phát: chỉ thêm, không xóa, theo thứ tự video, xem kế hoạch trước khi nạp.
  - Gỡ sản phẩm (nếu đang ghim thì bỏ ghim trước). Đổi thứ tự rồi lưu bằng một lệnh.
  - Giỏ tối đa 100 hoặc 500 sản phẩm tùy shop (hỏi Shopee). Bỏ qua sản phẩm hết hàng, đã có trong giỏ, không có trong danh mục, hoặc thuộc shop khác. Gửi theo lô; nếu một lô lỗi thì báo phần chưa gửi.
- Ghim hoặc bỏ ghim sản phẩm chỉ làm được khi phiên đang live; không ghim được sản phẩm hết hàng.
- **Kết thúc live:** không mở lại được. Nếu phiên đã kết thúc ở nơi khác thì không gửi lệnh. Nếu Shopee chưa xác nhận thì không bấm lại ngay.
- Phiên mở từ app Shopee hoặc Shopee Live PC: MEXO không điều khiển được.
- **Đọc bình luận:** có các trạng thái bình thường, lùi nhịp (backoff), cách ly, dừng (do token, quyền, phiên không còn, giới hạn tần suất, lỗi tạm thời).

### 5.5 Phát tự động (luồng lõi)
1. Chọn **mẫu phát** và **máy chủ phát** (máy đang kết nối, còn luồng trống).
2. Danh sách phát: các video của mẫu, **lặp vòng**, mỗi video 1 sản phẩm ghim.
3. **Kiểm tra trước khi phát** (tất cả phải đạt):
   - Phiên chưa bắt đầu và không có việc phát khác.
   - Shop còn hạn dùng.
   - Mẫu có video và mọi video đã tải lên xong.
   - Mọi video có sản phẩm ghim, sản phẩm ghim còn hàng và còn trong danh mục, mỗi video đúng 1 sản phẩm.
   - Máy chủ phát đang kết nối và còn luồng.
   - Giỏ live còn đủ chỗ (sản phẩm ghim chưa có trong giỏ sẽ được thêm trước).
4. Bấm **Bắt đầu phát tự động**: máy chủ nhận việc → chuẩn bị video → đẩy hình → **khi Shopee đã nhận hình, MEXO mới bắt đầu phiên** (trước đó người xem chỉ thấy ảnh bìa) → ghim sản phẩm theo video đang phát → trả lời bình luận.
5. Trạng thái phát: chưa phát → chờ máy nhận → chưa lên sóng (đang chuẩn bị) → đã có hình, đang bắt đầu → đang phát. Các trạng thái lỗi: Shopee chưa nhận lệnh bắt đầu, ghim lỗi, máy lỗi đẩy hình (tự chạy lại), máy mất kết nối, đã dừng theo yêu cầu.
6. **Dừng đẩy hình:** người xem thấy hình đứng, phiên vẫn mở. Bấm **Kết thúc live** thì máy phát cũng tự dừng.

### 5.6 Lịch phát
- Lịch **một lần**, **hằng ngày** hoặc **các thứ trong tuần**; có ngày kết thúc (tùy chọn).
- Mỗi lịch gồm: tiêu đề phiên, **mẫu phát (bắt buộc)**, **ảnh bìa (bắt buộc, JPEG/PNG ≤ 2 MB)**, giờ bật, giờ tắt (giờ tắt nhỏ hơn giờ bật nghĩa là tắt hôm sau). Giờ Việt Nam, định dạng 24 giờ.
- Các lịch của một shop **không được chồng khung giờ**. Giới hạn số lịch đang hoạt động và số ngày được hẹn trước.
- Tới giờ bật: tự tạo phiên với tiêu đề và ảnh bìa của lịch, rồi phát theo mẫu. Tới giờ tắt: tự kết thúc đúng phiên đó. Không đụng tới phiên tạo tay.
- Trạng thái lần phát: sắp tới, đang phát, đã chạy, bỏ lỡ, đã hủy.
- Lý do bỏ lỡ: chưa có giờ tắt, chưa có mẫu, chưa có ảnh bìa; shop đang có phiên khác; hết hạn dùng; Shopee không tạo được phiên; giao mẫu thất bại (phiên vừa tạo bị tắt); hệ thống không chạy; khởi động lại đúng lúc bật; đang đóng băng.
- Tắt: tự thử lại nếu Shopee chưa cho kết thúc; ghi nhận nếu đã tắt tay trước giờ.
- Lịch đã hủy thì không sửa được. Đang đóng băng thì bỏ lỡ, mở băng không phát bù.

### 5.7 Mẫu phát
- Gồm: tên (không trùng trong shop, không phân biệt hoa thường và dấu), ghi chú, danh sách video với **thứ tự phát** và **1 sản phẩm ghim mỗi video**. Có giới hạn số video tối đa.
- Có cảnh báo (vẫn cho lưu): video chưa sẵn sàng, sản phẩm hết hàng hoặc đã bị xóa khỏi danh mục, video đã bị xóa.
- Thao tác: tạo, sửa, **nhân bản**, xóa. Không xóa được mẫu đang được lịch phát dùng.
- Dữ liệu cũ có trường hợp video gắn nhiều sản phẩm; cách làm mới chỉ giữ sản phẩm đầu tiên.
- Ghim sản phẩm: tìm theo tên, SKU, ID, hoặc dán link sản phẩm.

### 5.8 Thư viện video
- Tải nhiều file cùng lúc hoặc kéo thả. Tên file thành tên video; thời lượng và dung lượng do hệ thống đọc từ file.
- **Tải lên tiếp tục được** (resumable): tải dở thì chọn lại đúng file để tải tiếp. Tự thử lại khi mạng chập chờn. Đóng trang thì dừng tải; chuyển mục trong ứng dụng thì vẫn tải tiếp.
- Trạng thái video: sẵn sàng, đang tải lên, đang xử lý, chưa có file, lỗi.
- Lỗi file: không có hình, sai định dạng, file hỏng, lệch dung lượng, tải dở quá lâu bị dọn, 0 byte, quá dung lượng một file, **shop hết dung lượng lưu**, kho lưu đầy, quá nhiều file tải dở.
- Tên video không trùng; không chứa `< > |`, không kết thúc bằng dấu chấm.
- Đổi tên, xóa (cả xóa hàng loạt). Không xóa được video đang nằm trong mẫu phát. Thao tác được ghi nhật ký.

### 5.9 Sản phẩm
- Danh mục **sao chép từ Shopee** về MEXO (bấm "Tải từ Shopee", có tiến độ x/y). Tìm, lọc, sắp xếp chạy trên bản sao nên không tốn lệnh gọi Shopee.
- Trường dữ liệu: id, number, tên, SKU, ảnh, giá, giá gốc, tiền tệ, tồn kho, đã bán, đánh giá, lượt thích.
- Lọc: tất cả, sắp hết hàng, hết hàng. Sắp xếp: tên, giá tăng hoặc giảm, bán chạy, tồn ít.

### 5.10 Trả lời bình luận
- Mỗi shop có công tắc **Tự động trả lời** và chọn cách xử lý câu không khớp kịch bản:
  - **Không trả lời**: chỉ trả lời câu khớp kịch bản.
  - **AI trả lời và đăng ngay.**
- **Kịch bản:** chủ đề, từ khóa (tối đa 20, khớp cả có dấu và không dấu), câu hỏi mẫu, câu trả lời (giới hạn ký tự), bật/tắt. Mỗi shop có số kịch bản tối đa. **Nhập từ bảng tính** (cột: chủ đề, từ khóa, câu hỏi mẫu, câu trả lời; trùng chủ đề thì cập nhật).
- **Đặc trưng của shop** (context riêng: bán gì, đổi trả, bảo hành, phí ship) cộng với **quy định chung** của hệ thống. Không có thông tin nào thì không bật được "đăng ngay".
- **Lớp lọc nội dung** (áp cho mọi câu đăng lên live, cả kịch bản và AI). Chặn câu có:
  - link;
  - số điện thoại;
  - kênh liên hệ ngoài Shopee (Zalo, Facebook, @tên, inbox riêng);
  - **nhắc giá** (trong live không nói giá);
  - nhắc sàn hoặc bên thứ ba;
  - lời lẽ xúc phạm;
  - khuyến mãi thiếu xác nhận.

  Kịch bản vi phạm thì bị tắt và có cảnh báo.
- **Giới hạn chống spam:** tối đa số câu mỗi phút; chờ một lúc mới trả lời lại cùng người xem; ngân sách AI mỗi shop mỗi ngày; bỏ bình luận quá cũ hoặc tồn đọng; AI tạm dừng nếu lỗi liên tiếp.
- **Thử một câu hỏi:** gõ bình luận mẫu, xem shop sẽ trả lời gì, không gửi lên Shopee.
- **Nhật ký câu đã trả lời:** lúc, bình luận, câu trả lời, trạng thái (đã đăng, bỏ qua, bị chặn), nguồn (kịch bản hoặc AI), phiên, độ trễ, lý do. **Không lưu tên người xem**; nội dung cắt ngắn và **tự xóa sau 30 ngày**.

### 5.11 Cấu hình AI (dùng chung toàn hệ thống)
- Base URL (chuẩn OpenAI, gọi `/chat/completions`), khóa API (lưu kín, chỉ hiện gợi ý), model (tải danh sách từ nhà cung cấp hoặc tự gõ), temperature 0–1,5 (khuyên 0,3–0,5).
- **Context chung** (quy định chung) có giới hạn ký tự. Hiện tại khoảng 935 ký tự, model `gpt-6.2-sol`.
- Nút "Gọi thử" hiển thị thời gian phản hồi và câu mẫu.
- Chặn địa chỉ local, mạng nội bộ hoặc http (trừ khi bật cờ server).

### 5.12 Máy chủ phát (MexoStreamer)
- Thêm máy: đặt tên, hệ thống sinh **khóa chỉ hiện một lần** (chỉ lưu bản băm). Khóa đặt vào `MEXO_SERVER_KEY` trên máy.
- Thuộc tính: tên, trạng thái, phiên bản, số luồng tối đa, số luồng đang chạy, số shop đang live, lần báo về cuối, trạng thái khóa, hạn khóa, tạm ngưng.
- Trạng thái máy: đang kết nối, mất kết nối (quá N giây không báo về), bị từ chối (phiên bản thấp hơn mức tối thiểu), chưa chạy, tạm ngưng, đã thu hồi khóa, khóa hết hạn.
- Thao tác (chỉ Sysadmin): đổi tên, tạm ngưng hoặc tiếp tục, **cấp lại khóa** (khóa cũ hết hiệu lực ngay), **thu hồi khóa**, xóa.
- Tổng số luồng = tổng luồng của các máy đang kết nối.

### 5.13 Cảnh báo
Cảnh báo lặp được gộp thành một dòng. Mức độ: nghiêm trọng hoặc cần xử lý. Bấm **Đã nhận** để ngừng nhắc. Các loại:
- Máy chủ mất kết nối; máy chủ bị từ chối (phiên bản cũ).
- Trả lời tự động tắt do lỗi gửi; shop **hết lượt AI trong ngày**.
- Shop cần kết nối lại; **quyền Shopee sắp hết hoặc đã hết**; sắp hết hạn dịch vụ.
- Ghim lỗi; phiên bị treo; phiên sẽ tự ngắt do hết hạn; không tự ngắt được.
- **Tỷ lệ lệnh gọi Shopee thấp** (theo giờ, ngày, riêng bình luận).
- Chưa tắt được phiên theo lịch; lịch không bật được.
- Kịch bản bị tắt do vi phạm nội dung.
- Tác vụ nền lỗi liên tiếp; **IP ra Internet sai** so với IP đã khai với Shopee; lỗi chương trình chưa xử lý.

### 5.14 Đóng băng hệ thống (công tắc khẩn cấp)
- **Đóng băng** (ghi lý do): dừng ngay trên mọi shop việc đọc và trả lời bình luận, gọi AI, bắt đầu phiên, ghim, bật/tắt theo lịch, tự ngắt phiên hết hạn, đồng bộ sản phẩm, làm mới token.
- **Giữ nguyên:** video đang phát; phiên trên Shopee không bị kết thúc.
- Admin thấy biểu ngữ kèm lý do; chủ shop thấy thông báo tạm dừng.
- **Mở băng:** chạy lại ngay, tắt các phiên đã quá giờ theo lịch, không phát bù lịch bị lỡ.

### 5.15 Theo dõi API Sàn (Sysadmin)
- Shopee yêu cầu tỷ lệ gọi API thành công của cả App **≥ 90% trung bình ngày**. Ngưỡng nội bộ:
  - Bình thường ≥ 97%.
  - Chú ý < 97% trong 1 giờ.
  - Nguy hiểm < 93% trong 1 giờ hoặc < 94% trong ngày.
- Xem theo khoảng thời gian (tối đa 90 ngày): biểu đồ theo ngày hoặc giờ, so với kỳ trước; nhóm theo lệnh API, theo shop, theo nhóm lỗi; danh sách từng lệnh (request_id, thời lượng).
- **Xuất CSV theo định dạng của Sàn.** **Đối chiếu** với file CSV tải từ Console Shopee (đọc ngay trong trình duyệt).
- Lệnh công khai không tính vào tỷ lệ. Nhật ký từng lệnh có thời hạn giữ; dữ liệu cũ hơn lấy từ bản tổng hợp theo ngày.
- Hệ thống **tự giãn nhịp** khi bị giới hạn tần suất, có **ngân sách lỗi** cho việc đọc bình luận, và tạm ngắt (circuit breaker) khi Shopee lỗi kéo dài.

### 5.16 Theo dõi tên shop (Sysadmin)
- Lưu tên trên Shopee, tên gợi nhớ (chỉ nhân viên MEXO thấy) và **toàn bộ lịch sử đổi tên**. Tìm theo tên cũ vẫn ra đúng shop.

---

## 6. Danh sách API (dựng lại từ giao diện)

**Xác thực:** `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/change-password`

**Shop:** `GET /api/shops` (phân trang `?page=`, 50 dòng/trang), `/api/shops/suggest`, `/api/shops/connect`, `/api/connect/link`, `/api/connect/status`, `/api/owner/connect`, `/api/owner/connect/link`, `/api/owner/shops`, `/api/owner/system`

**Theo shop** `/api/shops/{id}/...`: `alias`, `service-expiry`, `reject` (ngưng), `reopen`, `activity`, `check`, `feed/stop`, `products`, `products/sync`, `replies`, `replies/try`, `reply-rules`, `reply-rules/{rid}`, `reply-rules/import`, `history`, `videos`, `templates`, `templates/{tid}`, `schedules`, `sessions`, `sessions/{sid}/stream`, `sessions/{sid}/cart/...`

**Hệ thống:** `/api/alerts`, `/api/alerts/{id}/acknowledge`, `/api/shell/status`, `/api/system/freeze`, `/api/system/unfreeze`, `/api/platform/comment-poll`

**Máy chủ:** `/api/servers`, `/api/servers/{id}`, `/api/servers/{id}/rotate-key`, `/api/servers/{id}/revoke-key`

**Tài khoản:** `/api/accounts`, `/api/accounts/{id}`, `/api/accounts/{id}/reset-password`, `/api/accounts/{id}/role`, `/api/accounts/{id}/service-expiry`, `/api/accounts/{id}/shop-limit`, `/api/accounts/{id}/shops`

**AI:** `/api/settings/ai`, `/api/settings/ai/models`, `/api/settings/ai/test`, `/api/settings/ai/context`

**Giám sát:** `/api/monitor/summary`, `/api/monitor/daily`, `/api/monitor/by-api`, `/api/monitor/by-shop`, `/api/monitor/errors`, `/api/monitor/calls`; `/api/shop-names`, `/api/shop-names/{id}`

---

## 7. Mô hình dữ liệu (theo dữ liệu backup)

- **Shop:** id, number, name, alias, shopeeId, shopeeName, assignee, connection, state, live, session (phiên hiện tại), issue, scheduledToday, serviceExpiresOn, daysLeft, authExpiresAt, liveCutAt.
- **Product:** id, number, name, sku, imageUrl, price, originalPrice, currency, stock, sold, rating, likes. Kèm trạng thái đồng bộ: status, loaded, total, syncedAt.
- **Video:** id, number, name, durationSec, sizeBytes, uploadedBytes, sourceFileName, status, failReason, templateCount, updatedAt.
- **Template:** id, number, name, note, items[] (position, video, products), issues, videoCount, productCount, durationSec.
- **Schedule (lần phát):** key, at, date, time, endAt, status, issue, sessionId, schedule (cấu hình lặp).
- **Session (lịch sử):** id, title, description, state, stuck, createdAt, startedAt, endedAt, durationSeconds, viewers, peakViewers, orders, shareUrl, endedReason.
- **ReplySettings:** enabled, unmatched (none/live), context, contextSource, aiReady.
- **ReplyRule:** topic, keywords[], sample, answer, enabled.
- **Activity:** id, at, actor, code, params.
- **Server:** id, name, state, version, maxStreams, runningStreams, liveShops, lastHeartbeatAt, keyState, keyExpiresAt, suspended, createdAt.
- **Account:** id, username, name, role, status, serviceExpiresOn, shopCount, lastLoginAt, createdAt.

---

## 8. Phần KHÔNG có trong backup, phải làm lại khi chuyển

1. **Token Shopee của từng shop:** không xuất được. Cần **app Shopee Open Platform riêng** (partner_id/key), **xin quyền API Livestream**, khai báo redirect URL và IP tĩnh, rồi cho 134 shop cấp quyền lại. Có thể chạy song song với hệ thống cũ (mỗi app có quyền riêng), nhưng **tắt lịch phát và trả lời tự động bên cũ** cho shop đã chuyển, tránh tranh phiên và trả lời trùng.
2. **File video gốc** (1.435 video): chỉ có metadata, file nằm trên máy chủ cũ. Cần lấy lại từ người dùng hoặc từ máy phát.
3. **Phần mềm MexoStreamer:** phải viết lại phần nhận việc, chuẩn bị video và đẩy luồng (RTMP) lên Shopee Live.
4. **Mật khẩu tài khoản và khóa API AI:** đặt lại.
5. **Nhật ký giám sát API, lịch sử tên shop:** tài khoản hiện tại không đủ quyền (403).
6. **Nhật ký câu đã trả lời:** tự xóa sau 30 ngày, không đưa vào backup.
7. Tên miền `mexo.vn`, Cloudflare: cần quyền DNS.

---

## 9. Đề xuất thứ tự xây lại

1. Đăng ký app Shopee Open Platform và xin quyền Livestream API (**rủi ro lớn nhất, làm trước**).
2. Backend: auth và phân quyền 3 vai trò; shop và OAuth; hạn dùng; nhật ký.
3. Đồng bộ sản phẩm; video (tải lên tiếp tục được); mẫu phát.
4. Máy phát (worker) và giao thức heartbeat/giao việc; phát tự động; ghim theo video.
5. Lịch phát (bộ lập lịch chạy nền).
6. Đọc bình luận, kịch bản, AI, lớp lọc nội dung; giới hạn tần suất, circuit breaker.
7. Cảnh báo, đóng băng, theo dõi tỷ lệ API.
8. Nhập dữ liệu từ backup JSON; chuyển từng shop; đổi DNS.

---

## 10. Các file trong thư mục này

- `DAC-TA-NGHIEP-VU-MEXO-LIVE.md`: tài liệu này.
- `mexo-live-backup.json`: backup chính (shop, sản phẩm, video, mẫu, lịch, lịch sử, trả lời, hoạt động, máy chủ, tài khoản, cấu hình AI).
- `mexo-live-backup-bo-sung.json` (nếu có): chi tiết mẫu phát (video và sản phẩm ghim) và danh sách phiên của từng shop.
