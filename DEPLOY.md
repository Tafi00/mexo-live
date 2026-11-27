# Deploy (Hub)

App **mexo-live** · Docker trên server Gencloud Tafi 3 · (chưa có domain)
Hub: https://hub.tafidev.online · Key: `.hub/token` (đã ignore, không commit, không in ra). Mất key → nhờ người dùng bấm
"Copy prompt kết nối lại" trong Hub.

Cơ chế: push nhánh `main` → Hub build trên server (có cache) → chạy bản mới song song → healthcheck
→ chuyển traffic. Bản mới lỗi thì bản cũ vẫn chạy.

## Khi người dùng nói "deploy"
1. Còn thay đổi chưa commit → commit (bỏ qua file nhạy cảm như .env), message ngắn gọn.
2. `GIT_TERMINAL_PROMPT=0 git push origin main` (không bao giờ dừng chờ mật khẩu; lỗi xác thực thì báo người dùng), rồi `SHA=$(git rev-parse HEAD)`.
3. Báo Hub (an toàn nếu webhook đã nhận trước):
   `curl -fsS -m 30 -X POST https://hub.tafidev.online/api/v1/app/deploys -H "Authorization: Bearer $(cat .hub/token)" -d sha=$SHA`
4. Theo dõi: mỗi lần chờ tối đa 25 giây, gọi lại tới khi `"done": true` (build lần đầu có thể vài phút):
   `curl -fsS -m 40 "https://hub.tafidev.online/api/v1/app/deploys/$SHA?wait=25" -H "Authorization: Bearer $(cat .hub/token)"`
5. Báo người dùng ngắn gọn: trạng thái, thời gian build, % cache, URL, cảnh báo nếu có.
   Lỗi → đọc `https://hub.tafidev.online/api/v1/app/deploys/$SHA/log?tail=200` (cùng header, `curl -fsS -m 30`), chẩn đoán, sửa, deploy lại.

## Lệnh khác (cùng header Authorization)
- "rollback": `POST https://hub.tafidev.online/api/v1/app/rollback`
- "logs": `GET https://hub.tafidev.online/api/v1/app/logs?tail=200`
- "thêm env X": `PUT https://hub.tafidev.online/api/v1/app/env` với JSON `{"X":"…"}` (chỉ ghi), thêm `?deploy=1` để áp dụng ngay
- "cần vào server" / "kết nối db": xin quyền tạm thời theo mục "Xin quyền" ở `GET https://hub.tafidev.online/api/v1/guide` (chỉ xem và DB chỉ đọc được tự duyệt)
- Trạng thái app: `GET https://hub.tafidev.online/api/v1/app` · Chuẩn mới nhất: `GET https://hub.tafidev.online/api/v1/guide`
