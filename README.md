# MEXO Live 2

Nền tảng quản lý và tự động hóa **Shopee Livestream đa gian hàng**: kết nối shop qua cấp quyền chính thức Shopee Open Platform, phát video tự động 24/7 từ cụm máy chủ, tự ghim sản phẩm theo video, hẹn giờ bật/tắt, đọc và trả lời bình luận (kịch bản + AI, có lớp lọc nội dung), giám sát thời gian thực, phân quyền nhiều cấp.

Đây là bản xây lại toàn bộ hệ thống cũ (`live.mexo.vn`) theo [Brief yêu cầu](Brief_phat_trien_Shopee_Livestream.pdf), [sơ đồ kiến trúc](Kien_truc_he_thong_Shopee_Live.pdf) và [đặc tả nghiệp vụ hệ thống cũ](docs/DAC-TA-NGHIEP-VU-HE-THONG-CU.md), kèm công cụ **migrate toàn bộ dữ liệu cũ**.

---

## Kiến trúc

```
 Trình duyệt (React SPA, tiếng Việt, sáng/tối, mobile)
        │  HTTPS + cookie phiên + SSE thời gian thực
        ▼
 ┌──────────────────────────── API trung tâm (Fastify, Node 22) ─────────────────────────────┐
 │ Tài khoản & phân quyền · Gian hàng & OAuth · Sản phẩm · Video (tải tiếp được) · Mẫu phát   │
 │ Phiên live · Giỏ live & ghim · Lịch phát · Bình luận & AI · Cảnh báo · Giám sát · Báo cáo  │
 │ ─────────────── Tác vụ nền (idempotent, khóa nguyên tử trong DB) ───────────────────────── │
 │ session-engine 2s · comments 2s · reconcile 5s · scheduler 10s · servers 10s · tokens 5'    │
 │ expiry 1' · api-health 5' · egress-ip 10' · cleanup 1h · api-log-flush 2s                   │
 │ ─────────────── Shopee API Service (22 API + update_session) ───────────────────────────── │
 │ Ký HMAC-SHA256 · retry theo loại API · giãn nhịp khi 429 · circuit breaker · log từng lệnh  │
 └───────┬─────────────────────────────────────────────┬──────────────────────────────────────┘
         │ PostgreSQL (Drizzle)  + kho file video/ảnh    │ heartbeat 3s (khóa riêng từng máy)
         ▼                                               ▼
   Dữ liệu, nhật ký, giám sát                MexoStreamer 1..N  ──FFmpeg/RTMP──▶  Shopee Live
```

| Thư mục | Nội dung |
|---|---|
| `apps/api` | API trung tâm, tác vụ nền, client Shopee, Shopee giả lập, script migrate |
| `apps/web` | Giao diện quản trị (React 19, Vite, Tailwind 4, TanStack Query) |
| `apps/streamer` | MexoStreamer — máy đẩy luồng (FFmpeg concat → 1 luồng RTMP liên tục) |
| `packages/shared` | Vai trò, 11 quyền, trạng thái, nhãn tiếng Việt, tiện ích giờ VN |
| `docs/` | Đặc tả hệ thống cũ, hướng dẫn vận hành |

### Điểm thiết kế chính (đáp ứng mục XIII Brief — chống treo, phục hồi)

- **Trạng thái Shopee tách khỏi trạng thái máy phát**: `state`/`shopeeStatus` (Chưa bắt đầu, Đang chuẩn bị, Đang kết nối, Đang livestream, Đang kết thúc, Đã kết thúc, Mất kết nối, Lỗi đồng bộ, Chưa xác minh) độc lập với `streamState` (Chờ máy nhận, Chuẩn bị video, Đang đẩy hình, Lỗi, Máy mất kết nối, Đã dừng).
- **Chỉ bắt đầu phiên khi Shopee đã nhận hình** (người xem không thấy màn đen).
- **Mỗi shop 1 phiên mở** — ràng buộc ở tầng database (unique partial index), không thể tạo trùng kể cả khi nhiều tiến trình.
- **Đối soát định kỳ** với `get_session_detail`; dữ liệu quá cũ → đánh dấu "có vẻ treo" + cảnh báo; có **Đồng bộ thủ công** và **Giải phóng khóa phiên** (quản trị, sau khi xác minh; bắt buộc ghi lý do nếu không xác minh được).
- **Lịch phát idempotent**: mỗi lần phát là 1 bản ghi `(lịch, ngày)` duy nhất, được "nhận việc" bằng câu lệnh cập nhật nguyên tử → khởi động lại không bao giờ chạy trùng; lỡ giờ thì "Bỏ lỡ", không phát bù.
- **Máy phát theo mô hình trạng thái mong muốn**: khởi động lại API hoặc máy phát đều phát tiếp từ video đang dở (không phát trùng); máy mất kết nối > 60 giây → tự chuyển việc sang máy khác.
- **Retry theo loại API**: API đọc/idempotent thử lại 3 lần (backoff + jitter); `create_session`, `post_comment` chỉ thử lại khi Shopee chắc chắn chưa xử lý (429/503); không bao giờ gọi vô hạn; circuit breaker khi Shopee lỗi kéo dài.
- **Nhật ký kỹ thuật từng lệnh**: thời gian, API, shop, session, HTTP status, error code, request_id, thời gian phản hồi, số lần retry, mã tham chiếu lỗi nội bộ — đã loại token/khóa.
- **Đóng băng hệ thống** (công tắc khẩn cấp) dừng mọi tác vụ tự động, giữ nguyên video đang phát.

---

## Chạy thử nhanh (máy cá nhân, không cần cài PostgreSQL/Docker)

Yêu cầu: Node.js ≥ 20, pnpm 10.

```powershell
pnpm install
```

```powershell
pnpm migrate:legacy
```

```powershell
pnpm seed:demo
```

```powershell
pnpm dev
```

- `migrate:legacy` nhập toàn bộ `mexo-live-backup.json` (134 shop, 31.958 sản phẩm, 1.435 video, 129 mẫu, 1.375 phiên…) và ghi báo cáo + mật khẩu tạm vào `apps/api/data/legacy-import-report-*.md`.
- `seed:demo` tạo 1 shop demo đã kết nối với **Shopee giả lập**, 6 video, 1 mẫu phát đã gán sản phẩm, 3 kịch bản trả lời và 1 máy phát — in ra lệnh chạy máy phát mô phỏng.
- Mở <http://localhost:5173>, đăng nhập `admin` / `ChangeMe@2026` (bắt buộc đổi mật khẩu ở lần đầu).
- Chạy máy phát mô phỏng ở terminal khác (đặt `MEXO_SERVER_KEY` trong `apps/streamer/.env`): `pnpm dev:streamer`.

Không cần Partner ID: mặc định `SHOPEE_MODE=mock` — API tự dựng **Shopee giả lập** (trang cấp quyền, phiên live, giỏ hàng, ghim, bình luận, chỉ số, lỗi ngẫu nhiên 1% để thử retry). Client Shopee thật vẫn ký HMAC và gọi HTTP vào giả lập, nên toàn bộ đường đi được chạy thật.

---

## Triển khai production

> Bản đang chạy được deploy qua **Hub** (Docker trên server Gencloud Tafi 3): push nhánh `main` → Hub build `Dockerfile` theo `hub.yaml` (PostgreSQL do Hub tạo, `APP_SECRET` do Hub sinh). Cách deploy / rollback / xem log: xem [DEPLOY.md](DEPLOY.md). Các bước dưới đây dành cho tự triển khai bằng docker-compose.

1. **Đăng ký app trên Shopee Open Platform** (rủi ro lớn nhất — làm trước): xin quyền **Livestream API**, khai báo Redirect URL `https://<tên-miền>/connect/callback` và IP tĩnh của máy chạy API.
2. `cp .env.example .env` → chỉ cần điền `APP_SECRET` (≥ 32 ký tự, **không đổi sau khi chạy**), `PUBLIC_URL`, `BOOTSTRAP_ADMIN_PASSWORD` (và `DATABASE_URL` nếu không dùng docker-compose). **Partner ID / Partner Key, môi trường Shopee (giả lập / sandbox / live), Redirect URL, IP tĩnh, địa chỉ API cho máy phát, khóa AI** đều nhập trực tiếp trên web: *Cấu hình hệ thống → Kết nối & khóa API* (có nút kiểm tra khóa với Shopee trước khi lưu; khóa được mã hóa trong database).
3. `docker compose up -d --build` (PostgreSQL 17 + API phục vụ cả giao diện web). Đặt HTTPS phía trước (Nginx/Caddy/Cloudflare). SSE cần tắt buffer proxy cho `/api/events`.
4. Nhập dữ liệu cũ: `docker compose exec app node dist/cli/migrate-legacy.js /data/mexo-live-backup.json`.
5. **Máy phát**: vào *Máy chủ phát → Thêm máy* để lấy khóa (hiện 1 lần), rồi trên từng máy phát:
   `docker build -t mexo-streamer apps/streamer` và `docker run -d --restart unless-stopped -e MEXO_API_URL=https://<tên-miền> -e MEXO_SERVER_KEY=mxs_... -e MAX_STREAMS=40 -v /srv/cache:/cache mexo-streamer`.
6. Sao lưu: `pg_dump` hằng ngày + đồng bộ thư mục `storage/` (video, ảnh bìa) lên kho ngoài.

Khi chạy nhiều bản API sau load balancer: chỉ để `JOBS_ENABLED=true` ở **một** bản (các thao tác lịch phát/đối soát vẫn an toàn nhờ khóa nguyên tử trong DB, nhưng tránh gọi Shopee trùng lặp).

### Chuyển đổi từ hệ thống cũ (theo từng shop, chạy song song được)

1. Chạy migrate → mọi shop ở trạng thái **Cần cấp quyền lại**; 123 phiên đang live lúc backup ở trạng thái **Chưa xác minh** (khóa shop, chống tạo phiên trùng); lịch phát nhập ở trạng thái **Tạm dừng**; trả lời tự động **tắt** (shop từng bật được gắn nhóm `v1-tra-loi-tu-dong`).
2. Gửi liên kết cấp quyền cho chủ shop → shop tự kết nối, tự xác minh phiên cũ với Shopee, tự tải danh mục.
3. Tải lại video gốc (đúng tên + dung lượng → tự gắn vào video cũ), gán sản phẩm ghim cho mẫu phát (backup không có dữ liệu này).
4. **Tắt lịch phát và trả lời tự động ở hệ thống cũ cho shop đó**, rồi kích hoạt lịch và bật trả lời ở hệ thống mới.

---

## Ước lượng hạ tầng (mục XIV Brief)

Mỗi luồng 720×1280 30fps ≈ 2,5–3 Mbps ra Internet. Chi phí CPU phụ thuộc có mã hóa lại hay không:

| Quy mô (phiên đồng thời) | Máy phát (mã hóa lại libx264, ~0,6 vCPU/luồng) | Máy phát (video chuẩn hóa sẵn, phát `copy`) | Băng thông ra | API + DB |
|---|---|---|---|---|
| 50 | 1 × 32 vCPU | 1 × 4 vCPU | ~150 Mbps | 1 × 4 vCPU/8 GB + PostgreSQL 2 vCPU |
| 100 | 2 × 32 vCPU | 1 × 8 vCPU | ~300 Mbps | như trên |
| 300 | 6 × 32 vCPU | 2 × 8 vCPU (1 Gbps/máy) | ~900 Mbps | 2 vCPU API + DB 4 vCPU |
| 500 | 10 × 32 vCPU | 3 × 8 vCPU | ~1,5 Gbps | API 8 vCPU, DB 8 vCPU, tách tác vụ nền |
| 1.000 | 20 × 32 vCPU | 5–6 × 8 vCPU | ~3 Gbps | API ×2 + 1 worker nền, DB 16 vCPU |

Mở rộng theo chiều ngang: thêm máy phát chỉ cần cấp khóa mới, hệ thống tự phân bổ phiên cho máy tải thấp nhất. Giới hạn thực tế thường nằm ở **rate limit API Shopee** (giãn nhịp + ngân sách lỗi đã tích hợp) và băng thông.

---

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [docs/HUONG-DAN-VAN-HANH.md](docs/HUONG-DAN-VAN-HANH.md) | Vai trò, quy trình chuẩn, đọc tín hiệu phiên, xử lý sự cố |
| [docs/TICH-HOP-SHOPEE-API.md](docs/TICH-HOP-SHOPEE-API.md) | 22 API, ký request, chính sách retry, phân loại lỗi, việc cần xác minh |
| [docs/NGHIEM-THU.md](docs/NGHIEM-THU.md) | Kịch bản nghiệm thu và kết quả chạy thử |
| [docs/THU-VIEN-BEN-THU-BA.md](docs/THU-VIEN-BEN-THU-BA.md) | Thư viện bên thứ ba và giấy phép |
| [docs/DAC-TA-NGHIEP-VU-HE-THONG-CU.md](docs/DAC-TA-NGHIEP-VU-HE-THONG-CU.md) | Đặc tả hệ thống cũ (căn cứ xây lại) |
| `tests/acceptance/` | Kịch bản kiểm thử tự động (phát tự động, lịch, phân quyền, tải đồng thời) |

## Bảo mật

Token Shopee, khóa AI, URL đẩy luồng mã hóa AES-256-GCM · mật khẩu băm scrypt · cookie httpOnly + kiểm tra Origin · khóa tạm khi đăng nhập sai 5 lần · phân quyền kiểm tra tại backend cho từng shop · dữ liệu giữa các khách hàng tách biệt · khóa máy phát chỉ lưu bản băm, hiện 1 lần · nhật ký mọi thao tác quan trọng · log không chứa token.

## Lưu ý trước khi chạy thật

Tham số và tên trường của 22 API Shopee được đóng gói trong `apps/api/src/services/shopee/` (một chỗ duy nhất). Theo yêu cầu mục XII Brief, cần **đối chiếu với tài liệu chính thức Shopee Open Platform** (phiên bản API, tham số, rate limit, dữ liệu phản hồi) bằng tài khoản app thật trên môi trường `sandbox` trước khi bật `live`.
